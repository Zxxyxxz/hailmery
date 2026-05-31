// PublishWorkflow — every 15 minutes, publishes approved drafts whose
// publish_at has passed.
//
// Steps (each a step.do() block in the Workflow; also callable inline):
//   1 loadDueForPublish   — approved + publish_at <= now (≤50/run)
//   2 checkTokenHealth     — refresh near-expiry, fail-and-skip expired
//   3 checkCadence         — per-channel rate limits; over-limit drafts slide
//   4 publishDraft         — adapter.publish + publish_log + image backfill
//   5 updateMetricsEnqueue — queue 1h + 24h metrics fetches
//
// As with generation, steps pass plain JSON and rebuild db/adapters from env —
// AsyncLocalStorage does not cross a step boundary.

import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { sql } from 'drizzle-orm';
import type { NeonDatabase } from 'drizzle-orm/neon-serverless';
import type { ContentDraft } from '../db/schema.js';
import { makeDb } from '../db/client.js';
import { withTenantDb } from '../lib/tenant.js';
import { resolveAdapter, channelToSecretPlatform, normalizeChannel, loadSecret } from '../lib/credentials.js';
import { generateImage } from '../generation/image.js';
import { mirrorEnvToProcess, type PipelineEnv, type PublishParams } from './types.js';

type Db = NeonDatabase<Record<string, unknown>>;

const DUE_LIMIT = 50; // cap per run so a large backlog can't time out the workflow
const NEAR_EXPIRY_MS = 24 * 60 * 60 * 1000;
const IMAGE_BACKFILL_CHANNELS = new Set(['linkedin', 'instagram', 'x']);

export interface DueDraft {
  id: string;
  tenantId: string;
  channel: string;
  campaignId: string | null;
  // `any`-valued (not `unknown`) so DueDraft satisfies the Workflow step.do()
  // Serializable<T> constraint — `unknown` could be a Date, which it rejects.
  payload: Record<string, any>;
  assets: Record<string, any>;
  publishAt: string | null;
}

export interface PublishOutcome {
  draftId: string;
  channel: string;
  status: 'published' | 'failed' | 'delayed';
  publishedRef?: string;
  error?: string;
  delayUntil?: string;
}

// ── step 1 — loadDueForPublish ────────────────────────────────────────
export async function loadDueForPublish(
  env: PipelineEnv,
  tenantId?: string | null,
): Promise<DueDraft[]> {
  const db = makeDb(env.DATABASE_URL);
  const map = (rows: Record<string, any>[]): DueDraft[] =>
    rows.map((r) => ({
      id: String(r.id),
      tenantId: String(r.tenant_id),
      channel: String(r.channel),
      campaignId: r.campaign_id ?? null,
      payload: (r.payload ?? {}) as Record<string, any>,
      assets: (r.assets ?? {}) as Record<string, any>,
      publishAt: r.publish_at ?? null,
    }));

  if (tenantId) {
    const rows = await withTenantDb(db, tenantId, async (tx) => {
      const r = await tx.execute<Record<string, any>>(sql`
        SELECT id, tenant_id, channel, campaign_id, payload, assets, publish_at
        FROM marketing.content_drafts
        WHERE tenant_id = ${tenantId}
          AND status = 'approved'
          AND publish_at IS NOT NULL
          AND publish_at <= now()
        ORDER BY publish_at ASC
        LIMIT ${DUE_LIMIT}
      `);
      return r.rows;
    });
    return map(rows);
  }

  // Fleet-wide: no single-tenant context applies, so scan with rls_bypass.
  const rows = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.rls_bypass', 'true', true)`);
    const r = await tx.execute<Record<string, any>>(sql`
      SELECT id, tenant_id, channel, campaign_id, payload, assets, publish_at
      FROM marketing.content_drafts
      WHERE status = 'approved'
        AND publish_at IS NOT NULL
        AND publish_at <= now()
      ORDER BY publish_at ASC
      LIMIT ${DUE_LIMIT}
    `);
    return r.rows;
  });
  return map(rows);
}

// ── token refresh stub ────────────────────────────────────────────────
// Real per-platform OAuth refresh lands in V2. For now we log and report
// whether a refresh would have been attempted.
async function refreshToken(platform: string, tenantId: string): Promise<boolean> {
  console.log(`[publish] token refresh needed for platform=${platform} tenant=${tenantId} (stub — implement OAuth refresh in V2)`);
  return false;
}

// ── step 2 — checkTokenHealth ─────────────────────────────────────────
// Returns the drafts that are clear to publish, plus the outcomes for any
// dropped because their platform token has already expired.
export async function checkTokenHealth(
  env: PipelineEnv,
  drafts: DueDraft[],
): Promise<{ healthy: DueDraft[]; failed: PublishOutcome[] }> {
  const db = makeDb(env.DATABASE_URL);
  const now = Date.now();

  // Resolve expiry once per (tenant, platform).
  const seen = new Map<string, Awaited<ReturnType<typeof loadSecret>>>();
  const keyOf = (t: string, p: string) => `${t}:${p}`;

  const healthy: DueDraft[] = [];
  const failed: PublishOutcome[] = [];

  for (const draft of drafts) {
    const platform = channelToSecretPlatform(draft.channel);
    const k = keyOf(draft.tenantId, platform);
    if (!seen.has(k)) seen.set(k, await loadSecret(db, draft.tenantId, platform, env.SECRETS_KEY));
    const secret = seen.get(k) ?? null;

    const expiresAt = secret?.expiresAt ? secret.expiresAt.getTime() : null;
    if (expiresAt !== null && expiresAt <= now) {
      await markFailed(db, draft, 'token_expired');
      failed.push({ draftId: draft.id, channel: draft.channel, status: 'failed', error: 'token_expired' });
      continue;
    }
    if (expiresAt !== null && expiresAt - now <= NEAR_EXPIRY_MS) {
      await refreshToken(platform, draft.tenantId); // best-effort; publish proceeds with current token
    }
    healthy.push(draft);
  }
  return { healthy, failed };
}

// ── step 3 — checkCadence ─────────────────────────────────────────────
interface CadenceRule {
  windowSql: ReturnType<typeof sql>;
  limit: number;
  channels: string[]; // publish_log.channel values that count toward this rule
  scope: 'tenant' | 'campaign';
}

function cadenceRuleFor(channel: string): CadenceRule | null {
  const c = normalizeChannel(channel); // x → twitter
  if (c === 'linkedin') return { windowSql: sql`interval '1 day'`, limit: 1, channels: ['linkedin'], scope: 'tenant' };
  if (c === 'tiktok') return { windowSql: sql`interval '1 day'`, limit: 20, channels: ['tiktok'], scope: 'tenant' };
  if (c === 'twitter') return null; // X: no enforced limit
  if (c === 'instagram' || c === 'facebook')
    return { windowSql: sql`interval '1 day'`, limit: 25, channels: ['instagram', 'facebook'], scope: 'tenant' };
  if (c === 'blog' || c === 'wix-blog')
    return { windowSql: sql`interval '1 day'`, limit: 1, channels: ['blog', 'wix-blog'], scope: 'tenant' };
  return null;
}

function isNewsletter(draft: DueDraft): boolean {
  return draft.channel === 'email' && draft.payload?.emailType === 'newsletter';
}

export async function checkCadence(
  env: PipelineEnv,
  drafts: DueDraft[],
): Promise<{ ready: DueDraft[]; delayed: PublishOutcome[] }> {
  const db = makeDb(env.DATABASE_URL);
  const ready: DueDraft[] = [];
  const delayed: PublishOutcome[] = [];

  for (const draft of drafts) {
    // Email newsletter: max 1 per week per campaign.
    if (isNewsletter(draft)) {
      const count = await withTenantDb(db, draft.tenantId, async (tx) => {
        const r = await tx.execute<{ n: string }>(sql`
          SELECT count(*)::int AS n
          FROM marketing.publish_log pl
          JOIN marketing.content_drafts cd ON cd.id = pl.draft_id
          WHERE pl.tenant_id = ${draft.tenantId}
            AND cd.campaign_id = ${draft.campaignId}
            AND pl.channel = 'email'
            AND pl.published_at >= now() - interval '7 days'
        `);
        return Number(r.rows[0]?.n ?? 0);
      });
      if (count >= 1) {
        const until = await slidePublishAt(db, draft, 7);
        delayed.push({ draftId: draft.id, channel: draft.channel, status: 'delayed', delayUntil: until, error: 'cadence:newsletter_weekly' });
        continue;
      }
      ready.push(draft);
      continue;
    }

    const rule = cadenceRuleFor(draft.channel);
    if (!rule) {
      ready.push(draft);
      continue;
    }

    const count = await withTenantDb(db, draft.tenantId, async (tx) => {
      const r = await tx.execute<{ n: string }>(sql`
        SELECT count(*)::int AS n FROM marketing.publish_log
        WHERE tenant_id = ${draft.tenantId}
          AND channel = ANY(ARRAY[${sql.join(rule.channels.map((c) => sql`${c}`), sql`, `)}]::text[])
          AND published_at >= now() - ${rule.windowSql}
      `);
      return Number(r.rows[0]?.n ?? 0);
    });

    if (count >= rule.limit) {
      const until = await slidePublishAt(db, draft, 1);
      delayed.push({ draftId: draft.id, channel: draft.channel, status: 'delayed', delayUntil: until, error: `cadence:${draft.channel}_limit` });
      continue;
    }
    ready.push(draft);
  }
  return { ready, delayed };
}

// Push publish_at out by `days`, keeping status='approved'. Returns the new ISO.
async function slidePublishAt(db: Db, draft: DueDraft, days: number): Promise<string> {
  const until = await withTenantDb(db, draft.tenantId, async (tx) => {
    const r = await tx.execute<{ publish_at: string }>(sql`
      UPDATE marketing.content_drafts
      SET publish_at = now() + (${days} * interval '1 day'), updated_at = now()
      WHERE id = ${draft.id} AND tenant_id = ${draft.tenantId}
      RETURNING publish_at
    `);
    return r.rows[0]?.publish_at;
  });
  console.log(`[publish] draft ${draft.id} (${draft.channel}) delayed — cadence limit; next slot ${until}`);
  return String(until);
}

// ── step 4 — publishDraft ─────────────────────────────────────────────
export async function publishDraft(env: PipelineEnv, draft: DueDraft): Promise<PublishOutcome> {
  mirrorEnvToProcess(env);
  const db = makeDb(env.DATABASE_URL);

  const resolved = await resolveAdapter({
    db,
    tenantId: draft.tenantId,
    channel: draft.channel,
    secretsKey: env.SECRETS_KEY,
  });
  if ('reason' in resolved) {
    await markFailed(db, draft, resolved.reason);
    return { draftId: draft.id, channel: draft.channel, status: 'failed', error: resolved.reason };
  }

  // The adapter reads draft.channel + draft.payload. Normalise the channel
  // (x → twitter) so the Buffer profile lookup keys line up.
  const draftForAdapter = {
    id: draft.id,
    tenantId: draft.tenantId,
    channel: normalizeChannel(draft.channel),
    payload: draft.payload,
    assets: draft.assets,
    publishAt: draft.publishAt,
  } as unknown as ContentDraft;

  try {
    const result = await resolved.resolved.adapter.publish(draftForAdapter);
    const ref = result.url || result.externalId || '';

    await withTenantDb(db, draft.tenantId, async (tx) => {
      await tx.execute(sql`
        UPDATE marketing.content_drafts
        SET status = 'published', published_ref = ${ref}, failed_reason = NULL, updated_at = now()
        WHERE id = ${draft.id} AND tenant_id = ${draft.tenantId}
      `);
      await tx.execute(sql`
        INSERT INTO marketing.publish_log (tenant_id, channel, draft_id)
        VALUES (${draft.tenantId}, ${draft.channel}, ${draft.id})
      `);
    });

    // Backfill a paired image when the post had none (best-effort, configured
    // runtimes only). Awaited but isolated — an image failure never unwinds a
    // successful publish.
    const hasImage = Object.keys(draft.assets ?? {}).length > 0;
    if (!hasImage && IMAGE_BACKFILL_CHANNELS.has(draft.channel.toLowerCase()) && env.IDEOGRAM_API_KEY) {
      try {
        await generateImage({
          db,
          tenantId: draft.tenantId,
          draftId: draft.id,
          imageType: 'social_square',
          r2: env.ASSETS,
          publicBaseUrl: env.R2_PUBLIC_BASE_URL,
        });
      } catch (err) {
        console.error('[publish] post-publish image backfill failed (non-fatal):', err instanceof Error ? err.message : err);
      }
    }

    return { draftId: draft.id, channel: draft.channel, status: 'published', publishedRef: ref };
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    await markFailed(db, draft, message);
    return { draftId: draft.id, channel: draft.channel, status: 'failed', error: message };
  }
}

async function markFailed(db: Db, draft: DueDraft, reason: string): Promise<void> {
  await withTenantDb(db, draft.tenantId, async (tx) => {
    await tx.execute(sql`
      UPDATE marketing.content_drafts
      SET status = 'failed', failed_reason = ${reason.slice(0, 500)}, updated_at = now()
      WHERE id = ${draft.id} AND tenant_id = ${draft.tenantId}
    `);
  });
}

// ── step 5 — updateMetricsEnqueue ─────────────────────────────────────
// One row per fetch window (1h + 24h). Chunk 7's metrics job drains them.
export async function updateMetricsEnqueue(
  env: PipelineEnv,
  published: Array<{ tenantId: string; draftId: string }>,
): Promise<number> {
  if (published.length === 0) return 0;
  const db = makeDb(env.DATABASE_URL);

  // Group by tenant so each insert runs in that tenant's RLS context.
  const byTenant = new Map<string, string[]>();
  for (const p of published) {
    const arr = byTenant.get(p.tenantId) ?? [];
    arr.push(p.draftId);
    byTenant.set(p.tenantId, arr);
  }

  let inserted = 0;
  for (const [tenantId, draftIds] of byTenant) {
    await withTenantDb(db, tenantId, async (tx) => {
      for (const draftId of draftIds) {
        await tx.execute(sql`
          INSERT INTO marketing.metrics_queue (tenant_id, draft_id, fetch_at, "window")
          VALUES
            (${tenantId}, ${draftId}, now() + interval '1 hour',  '1h'::marketing.metrics_window),
            (${tenantId}, ${draftId}, now() + interval '24 hours', '24h'::marketing.metrics_window)
        `);
        inserted += 2;
      }
    });
  }
  return inserted;
}

// ── single-draft immediate publish (powers POST /api/publish/:draftId) ─
// Bypasses the cron wait and the cadence slide — an operator clicking "Publish
// now" has made the scheduling decision themselves. Token expiry is still
// honoured. Returns the live adapter result (or the exact error).
export async function publishSingleDraft(
  env: PipelineEnv,
  tenantId: string,
  draftId: string,
): Promise<PublishOutcome & { found: boolean }> {
  const db = makeDb(env.DATABASE_URL);
  const draft = await withTenantDb(db, tenantId, async (tx) => {
    const r = await tx.execute<Record<string, any>>(sql`
      SELECT id, tenant_id, channel, campaign_id, payload, assets, publish_at, status
      FROM marketing.content_drafts
      WHERE id = ${draftId} AND tenant_id = ${tenantId} LIMIT 1
    `);
    return r.rows[0] ?? null;
  });
  if (!draft) return { found: false, draftId, channel: '', status: 'failed', error: 'not_found' };

  const due: DueDraft = {
    id: String(draft.id),
    tenantId: String(draft.tenant_id),
    channel: String(draft.channel),
    campaignId: draft.campaign_id ?? null,
    payload: (draft.payload ?? {}) as Record<string, any>,
    assets: (draft.assets ?? {}) as Record<string, any>,
    publishAt: draft.publish_at ?? null,
  };

  // Honour hard token expiry even on a manual publish.
  const { healthy, failed } = await checkTokenHealth(env, [due]);
  if (failed.length) return { found: true, ...failed[0] };

  const outcome = await publishDraft(env, healthy[0]);
  if (outcome.status === 'published') {
    await updateMetricsEnqueue(env, [{ tenantId, draftId }]);
  }
  return { found: true, ...outcome };
}

/** Run the publish pipeline inline (no Workflow runtime). */
export async function runPublishPipeline(
  env: PipelineEnv,
  params: PublishParams,
): Promise<{ published: number; failed: number; delayed: number; outcomes: PublishOutcome[] }> {
  const due = await loadDueForPublish(env, params.tenantId ?? null);
  const { healthy, failed: tokenFailed } = await checkTokenHealth(env, due);
  const { ready, delayed } = await checkCadence(env, healthy);

  const outcomes: PublishOutcome[] = [...tokenFailed, ...delayed];
  const publishedRefs: Array<{ tenantId: string; draftId: string }> = [];
  for (const draft of ready) {
    const outcome = await publishDraft(env, draft);
    outcomes.push(outcome);
    if (outcome.status === 'published') publishedRefs.push({ tenantId: draft.tenantId, draftId: draft.id });
  }
  await updateMetricsEnqueue(env, publishedRefs);

  return {
    published: publishedRefs.length,
    failed: outcomes.filter((o) => o.status === 'failed').length,
    delayed: delayed.length,
    outcomes,
  };
}

export class PublishWorkflow extends WorkflowEntrypoint<PipelineEnv, PublishParams> {
  async run(event: WorkflowEvent<PublishParams>, step: WorkflowStep): Promise<unknown> {
    const env = this.env;
    const tenantId = event.payload?.tenantId ?? null;

    const due = await step.do('loadDueForPublish', () => loadDueForPublish(env, tenantId));
    if (due.length === 0) return { published: 0, failed: 0, delayed: 0 };

    const tokenHealth = await step.do('checkTokenHealth', () => checkTokenHealth(env, due));
    const cadence = await step.do('checkCadence', () => checkCadence(env, tokenHealth.healthy));

    // Publish each ready draft in its own step so a single adapter failure (or
    // a retry) is isolated to that draft.
    const published: Array<{ tenantId: string; draftId: string }> = [];
    const outcomes: PublishOutcome[] = [...tokenHealth.failed, ...cadence.delayed];
    for (const draft of cadence.ready) {
      const outcome = await step.do(`publishDraft:${draft.id}`, () => publishDraft(env, draft));
      outcomes.push(outcome);
      if (outcome.status === 'published') published.push({ tenantId: draft.tenantId, draftId: draft.id });
    }

    await step.do('updateMetricsEnqueue', () => updateMetricsEnqueue(env, published));

    return {
      published: published.length,
      failed: outcomes.filter((o) => o.status === 'failed').length,
      delayed: cadence.delayed.length,
    };
  }
}
