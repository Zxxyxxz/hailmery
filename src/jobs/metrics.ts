// Nightly metrics ingestion + learning loop (Chunk 7).
//
// Wired to the "0 3 * * *" cron in src/index.ts (after runMailSync). For every
// active tenant it runs five steps, each isolated so one failure never blocks
// the rest of the fleet:
//
//   1 processMetricsQueue  — drain due metrics_queue rows; per-draft adapter
//                            fetchMetrics() → content_metrics (errors never
//                            block the queue; the row is marked fetched anyway).
//   2 syncGscKeywords      — GSC keyword data per site (google creds) → upsert
//                            gsc_keywords, flagging >3× average impressions.
//   3 syncUmamiPageviews   — Umami pageviews per published blog draft → upsert
//                            content_metrics window='7d'.
//   4 scorePerformance     — performance_score for every draft published in the
//                            last 30 days, relative to the channel median.
//   5 tagGoldenExamples    — top-decile outperformers (score > 1.0) get tagged
//                            and promoted into golden_example document_chunks so
//                            generation retrieves them (closes the learning loop).
//
// The job reads API keys from process.env (mirrored from Worker secrets by
// mirrorEnvToProcess) for the golden-example embeddings.

import { sql } from 'drizzle-orm';
import type { NeonDatabase } from 'drizzle-orm/neon-serverless';
import { makeDb } from '../db/client.js';
import { getAllActiveTenants, withTenantDb } from '../lib/tenant.js';
import { loadSecret, resolveAdapter } from '../lib/credentials.js';
import { embedOne } from '../corpus/embedder.js';
import { GscAdapter, flagHighPerformers, type GscRow } from '../adapters/gsc.js';
import { UmamiAdapter } from '../adapters/umami.js';
import { mirrorEnvToProcess, type PipelineEnv } from '../workflows/types.js';

type Db = NeonDatabase<Record<string, unknown>>;

// GSC OAuth client config is a Worker-level secret, not per-tenant; both fields
// are optional so a PipelineEnv (which lacks them) still satisfies MetricsEnv.
export type MetricsEnv = PipelineEnv & {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
};

const QUEUE_BATCH = 100;
const GSC_LOOKBACK_DAYS = 7;
const UMAMI_LOOKBACK_DAYS = 7;
const SCORE_WINDOW_DAYS = 30;
const GOLDEN_DECILE = 0.1;

export interface NightlyMetricsResult {
  tenants: number;
  queueProcessed: number;
  gscKeywords: number;
  umamiUpserts: number;
  scored: number;
  golden: number;
}

// ── entry point ───────────────────────────────────────────────────────
export async function runNightlyMetrics(env: MetricsEnv): Promise<NightlyMetricsResult> {
  mirrorEnvToProcess(env);
  const db = makeDb(env.DATABASE_URL);
  const tenants = await getAllActiveTenants(db);

  const result: NightlyMetricsResult = {
    tenants: tenants.length,
    queueProcessed: 0,
    gscKeywords: 0,
    umamiUpserts: 0,
    scored: 0,
    golden: 0,
  };

  for (const tenant of tenants) {
    try {
      result.queueProcessed += await processMetricsQueue(env, db, tenant.id);
    } catch (err) {
      logErr('queue', tenant.id, err);
    }
    try {
      result.gscKeywords += await syncGscKeywords(env, db, tenant.id);
    } catch (err) {
      logErr('gsc', tenant.id, err);
    }
    try {
      result.umamiUpserts += await syncUmamiPageviews(env, db, tenant.id);
    } catch (err) {
      logErr('umami', tenant.id, err);
    }
    try {
      result.scored += await scorePerformance(db, tenant.id);
    } catch (err) {
      logErr('score', tenant.id, err);
    }
    try {
      result.golden += await tagGoldenExamples(env, db, tenant.id);
    } catch (err) {
      logErr('golden', tenant.id, err);
    }
  }

  console.log(
    `[metrics] nightly run — tenants=${result.tenants} queue=${result.queueProcessed} ` +
      `gsc=${result.gscKeywords} umami=${result.umamiUpserts} scored=${result.scored} golden=${result.golden}`,
  );
  return result;
}

function logErr(step: string, tenantId: string, err: unknown): void {
  console.error(`[metrics:${step}] tenant ${tenantId} failed:`, err instanceof Error ? err.message : err);
}

// ── STEP 1 — process metrics_queue ────────────────────────────────────
interface QueueRow extends Record<string, any> {
  id: string;
  draft_id: string;
  window: string;
  channel: string;
  published_ref: string | null;
}

export async function processMetricsQueue(env: MetricsEnv, db: Db, tenantId: string): Promise<number> {
  // Pull due, unfetched rows joined to their draft so we know the channel.
  const due = await withTenantDb(db, tenantId, async (tx) => {
    const r = await tx.execute<QueueRow>(sql`
      SELECT mq.id, mq.draft_id, mq."window", cd.channel, cd.published_ref
      FROM marketing.metrics_queue mq
      JOIN marketing.content_drafts cd ON cd.id = mq.draft_id
      WHERE mq.tenant_id = ${tenantId}
        AND mq.fetched = false
        AND mq.fetch_at <= now()
      ORDER BY mq.fetch_at ASC
      LIMIT ${QUEUE_BATCH}
    `);
    return r.rows;
  });

  let processed = 0;
  for (const row of due) {
    try {
      const resolved = await resolveAdapter({
        db,
        tenantId,
        channel: row.channel,
        secretsKey: env.SECRETS_KEY,
      });
      if ('resolved' in resolved) {
        // The adapter keys off the platform's external id (stored at publish
        // time); fall back to the internal draft id when no ref was recorded.
        const externalId = row.published_ref || row.draft_id;
        const metrics = await resolved.resolved.adapter.fetchMetrics(externalId);
        await upsertContentMetric(db, tenantId, {
          draftId: row.draft_id,
          window: row.window,
          impressions: metrics.impressions,
          clicks: metrics.clicks,
          engagement: metrics.engagement,
          attributedLeads: metrics.attributedLeads,
        });
      }
      // No adapter / no credentials → nothing to fetch; still mark fetched so
      // the queue drains rather than re-attempting forever.
    } catch (err) {
      console.error(
        `[metrics:queue] draft ${row.draft_id} (${row.channel}) fetch failed — marking fetched anyway:`,
        err instanceof Error ? err.message : err,
      );
    } finally {
      await markFetched(db, tenantId, row.id);
      processed++;
    }
  }
  return processed;
}

async function markFetched(db: Db, tenantId: string, queueId: string): Promise<void> {
  await withTenantDb(db, tenantId, async (tx) => {
    await tx.execute(sql`
      UPDATE marketing.metrics_queue
      SET fetched = true
      WHERE id = ${queueId} AND tenant_id = ${tenantId}
    `);
  });
}

interface MetricUpsert {
  draftId: string;
  window: string;
  impressions: number;
  clicks: number;
  engagement: number;
  attributedLeads: number;
}

// Upsert one row per (tenant, draft, window) — re-runs refresh in place.
export async function upsertContentMetric(db: Db, tenantId: string, m: MetricUpsert): Promise<void> {
  await withTenantDb(db, tenantId, async (tx) => {
    await tx.execute(sql`
      INSERT INTO marketing.content_metrics
        (tenant_id, draft_id, "window", impressions, clicks, engagement, attributed_leads, fetched_at)
      VALUES (
        ${tenantId}, ${m.draftId}, ${m.window}::marketing.metrics_window,
        ${m.impressions}, ${m.clicks}, ${m.engagement}, ${m.attributedLeads}, now()
      )
      ON CONFLICT (tenant_id, draft_id, "window") DO UPDATE SET
        impressions = EXCLUDED.impressions,
        clicks = EXCLUDED.clicks,
        engagement = EXCLUDED.engagement,
        attributed_leads = EXCLUDED.attributed_leads,
        fetched_at = now()
    `);
  });
}

// ── STEP 2 — GSC keyword sync ─────────────────────────────────────────
interface SiteRow extends Record<string, any> {
  id: string;
  domain: string;
}

export async function syncGscKeywords(env: MetricsEnv, db: Db, tenantId: string): Promise<number> {
  // Tenant-level Google credential (stored under platform='google').
  const secret = await loadSecret(db, tenantId, 'google', env.SECRETS_KEY);
  if (!secret || !secret.refreshToken || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return 0; // GSC not connected for this tenant — skip silently.
  }

  const sites = await withTenantDb(db, tenantId, async (tx) => {
    const r = await tx.execute<SiteRow>(
      sql`SELECT id, domain FROM marketing.sites WHERE tenant_id = ${tenantId}`,
    );
    return r.rows;
  });

  const adapter = new GscAdapter({
    accessToken: secret.accessToken,
    refreshToken: secret.refreshToken,
    extra: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET },
  });

  const weekOf = mondayOfWeek();
  let upserted = 0;

  for (const site of sites) {
    const siteUrl = toGscSiteUrl(site.domain);
    let rows: GscRow[];
    try {
      rows = await adapter.fetchKeywordData(siteUrl, GSC_LOOKBACK_DAYS);
    } catch (err) {
      console.error(`[metrics:gsc] ${siteUrl} fetch failed:`, err instanceof Error ? err.message : err);
      continue;
    }
    if (rows.length === 0) continue;

    // High performers: > 3× the average impressions across the week's rows.
    const highKeys = new Set(flagHighPerformers(rows).map((r) => `${r.query} ${r.page}`));

    await withTenantDb(db, tenantId, async (tx) => {
      for (const r of rows) {
        const isHigh = highKeys.has(`${r.query} ${r.page}`);
        await tx.execute(sql`
          INSERT INTO marketing.gsc_keywords
            (tenant_id, site_id, query, page_url, impressions, clicks, ctr, position,
             is_high_performer, fetched_at, week_of)
          VALUES (
            ${tenantId}, ${site.id}, ${r.query}, ${r.page}, ${r.impressions}, ${r.clicks},
            ${r.ctr}, ${r.position}, ${isHigh}, now(), ${weekOf}::date
          )
          ON CONFLICT (tenant_id, site_id, query, page_url, week_of) DO UPDATE SET
            impressions = EXCLUDED.impressions,
            clicks = EXCLUDED.clicks,
            ctr = EXCLUDED.ctr,
            position = EXCLUDED.position,
            is_high_performer = EXCLUDED.is_high_performer,
            fetched_at = now()
        `);
        upserted++;
      }
    });
  }
  return upserted;
}

function toGscSiteUrl(domain: string): string {
  if (domain.startsWith('http://') || domain.startsWith('https://') || domain.startsWith('sc-domain:')) {
    return domain;
  }
  return `https://${domain}/`;
}

// ── STEP 3 — Umami pageview sync ──────────────────────────────────────
interface BlogDraftRow extends Record<string, any> {
  id: string;
  slug: string | null;
}

export async function syncUmamiPageviews(env: MetricsEnv, db: Db, tenantId: string): Promise<number> {
  const secret = await loadSecret(db, tenantId, 'umami', env.SECRETS_KEY);
  // Umami connection config lives in the encrypted profile map (baseUrl, username,
  // password, websiteId) since it isn't a single bearer token.
  const cfg = (secret?.profileMap ?? null) as Record<string, string> | null;
  if (!secret || !cfg?.baseUrl || !cfg?.username || !cfg?.password || !cfg?.websiteId) {
    return 0; // Umami not connected — skip silently.
  }

  const adapter = new UmamiAdapter({
    accessToken: secret.accessToken,
    extra: {
      baseUrl: cfg.baseUrl,
      username: cfg.username,
      password: cfg.password,
      websiteId: cfg.websiteId,
    },
  });

  // Published blog drafts we can attribute pageviews to (matched by slug in URL).
  const blogDrafts = await withTenantDb(db, tenantId, async (tx) => {
    const r = await tx.execute<BlogDraftRow>(sql`
      SELECT id, payload->>'slug' AS slug
      FROM marketing.content_drafts
      WHERE tenant_id = ${tenantId}
        AND channel IN ('blog', 'wix-blog')
        AND status IN ('published', 'measured')
    `);
    return r.rows;
  });
  if (blogDrafts.length === 0) return 0;

  let pageviewEntries: Array<{ x: string; y: number }> = [];
  try {
    pageviewEntries = await adapter.getPageViews(cfg.websiteId, '', UMAMI_LOOKBACK_DAYS);
  } catch (err) {
    console.error(`[metrics:umami] pageviews fetch failed:`, err instanceof Error ? err.message : err);
    return 0;
  }

  let upserted = 0;
  for (const draft of blogDrafts) {
    if (!draft.slug) continue;
    // Sum pageview buckets whose url path contains the draft slug.
    const views = pageviewEntries
      .filter((e) => typeof e.x === 'string' && e.x.includes(draft.slug as string))
      .reduce((sum, e) => sum + (e.y ?? 0), 0);
    if (views <= 0) continue;
    await upsertContentMetric(db, tenantId, {
      draftId: draft.id,
      window: '7d',
      impressions: views,
      clicks: 0,
      engagement: views,
      attributedLeads: 0,
    });
    upserted++;
  }
  return upserted;
}

// ── STEP 4 — performance scoring ──────────────────────────────────────
// performance_score = (clicks*3 + engagement*2 + impressions) / channel median,
// for every draft published in the last 30 days. Metrics are aggregated as the
// MAX per metric across a draft's windows (later windows are cumulative supersets).
export async function scorePerformance(db: Db, tenantId: string): Promise<number> {
  const rows = await withTenantDb(db, tenantId, async (tx) => {
    const r = await tx.execute<{ id: string }>(sql`
      WITH pub AS (
        SELECT cd.id AS draft_id, cd.channel
        FROM marketing.content_drafts cd
        WHERE cd.tenant_id = ${tenantId}
          AND cd.status IN ('published', 'measured')
          AND COALESCE(
                (SELECT max(pl.published_at) FROM marketing.publish_log pl WHERE pl.draft_id = cd.id),
                cd.publish_at, cd.updated_at
              ) >= now() - ${`${SCORE_WINDOW_DAYS} days`}::interval
      ),
      m AS (
        SELECT cm.draft_id,
               max(cm.impressions) AS impressions,
               max(cm.clicks) AS clicks,
               max(cm.engagement) AS engagement
        FROM marketing.content_metrics cm
        WHERE cm.tenant_id = ${tenantId}
        GROUP BY cm.draft_id
      ),
      scored AS (
        SELECT p.draft_id, p.channel,
               (COALESCE(m.clicks,0)*3 + COALESCE(m.engagement,0)*2 + COALESCE(m.impressions,0))::numeric AS raw_score
        FROM pub p LEFT JOIN m ON m.draft_id = p.draft_id
      ),
      baselines AS (
        SELECT channel, percentile_cont(0.5) WITHIN GROUP (ORDER BY raw_score) AS median
        FROM scored WHERE raw_score > 0 GROUP BY channel
      )
      UPDATE marketing.content_drafts cd
      SET performance_score = CASE
            WHEN b.median IS NULL OR b.median = 0 THEN NULL
            ELSE round((s.raw_score / b.median)::numeric, 4)
          END,
          updated_at = now()
      FROM scored s
      LEFT JOIN baselines b ON b.channel = s.channel
      WHERE cd.id = s.draft_id AND cd.tenant_id = ${tenantId}
      RETURNING cd.id
    `);
    return r.rows;
  });
  return rows.length;
}

// ── STEP 5 — golden-example tagging + promotion ───────────────────────
interface GoldenRow extends Record<string, any> {
  id: string;
  channel: string;
  payload: Record<string, any>;
}

export async function tagGoldenExamples(env: MetricsEnv, db: Db, tenantId: string): Promise<number> {
  mirrorEnvToProcess(env);

  // Top decile of scored drafts, requiring score > 1.0 (outperformed baseline).
  const winners = await withTenantDb(db, tenantId, async (tx) => {
    const cnt = await tx.execute<{ n: string }>(sql`
      SELECT count(*)::int AS n FROM marketing.content_drafts
      WHERE tenant_id = ${tenantId} AND performance_score IS NOT NULL
    `);
    const total = Number(cnt.rows[0]?.n ?? 0);
    if (total === 0) return [];
    const limit = Math.max(1, Math.ceil(total * GOLDEN_DECILE));

    // Clear stale flags first so demotions take effect, then re-tag the top set.
    await tx.execute(sql`
      UPDATE marketing.content_drafts
      SET is_golden_example = false
      WHERE tenant_id = ${tenantId} AND is_golden_example = true
    `);

    const r = await tx.execute<GoldenRow>(sql`
      UPDATE marketing.content_drafts
      SET is_golden_example = true, updated_at = now()
      WHERE id IN (
        SELECT id FROM marketing.content_drafts
        WHERE tenant_id = ${tenantId}
          AND performance_score > 1.0
        ORDER BY performance_score DESC
        LIMIT ${limit}
      )
      RETURNING id, channel, payload
    `);
    return r.rows;
  });

  // Promote each winner into a golden_example document + chunk so generation's
  // RAG retrieval (generation/context.ts) surfaces it. Best-effort: an embedding
  // failure leaves the flag set but skips the chunk.
  let promoted = 0;
  for (const draft of winners) {
    try {
      await promoteGoldenExample(db, tenantId, draft);
      promoted++;
    } catch (err) {
      console.error(
        `[metrics:golden] promote draft ${draft.id} failed (flag kept):`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return winners.length;
}

/** Extract the human-facing prose from a draft payload for embedding. */
export function goldenTextOf(payload: Record<string, any>): string {
  const parts = [payload.title, payload.subject, payload.previewText, payload.excerpt, payload.body, payload.text]
    .filter((s) => typeof s === 'string' && s.trim().length > 0);
  return parts.join('\n\n').trim();
}

async function promoteGoldenExample(db: Db, tenantId: string, draft: GoldenRow): Promise<void> {
  const text = goldenTextOf(draft.payload ?? {});
  if (!text) return;

  // Idempotent: one golden document per source draft. Skip embedding entirely
  // if it already exists (re-runs of the nightly pass are cheap).
  const sourceFilename = `golden/${draft.id}.md`;
  const existing = await withTenantDb(db, tenantId, async (tx) => {
    const r = await tx.execute<{ id: string }>(sql`
      SELECT id FROM marketing.documents
      WHERE tenant_id = ${tenantId} AND source_filename = ${sourceFilename} LIMIT 1
    `);
    return r.rows[0] ?? null;
  });
  if (existing) return;

  const embedding = await embedOne(text.slice(0, 8000));
  if (!embedding.every((n) => Number.isFinite(n))) {
    throw new Error('golden-example embedding contained non-finite values');
  }
  const vec = sql.raw(`'[${embedding.join(',')}]'::vector`);

  await withTenantDb(db, tenantId, async (tx) => {
    const doc = await tx.execute<{ id: string }>(sql`
      INSERT INTO marketing.documents
        (tenant_id, source, source_filename, document_type, r2_key, mime_type, version)
      VALUES (
        ${tenantId}, 'git', ${sourceFilename}, 'golden_example',
        ${`golden/${draft.id}`}, 'text/markdown', 1
      )
      ON CONFLICT (tenant_id, source_filename) DO NOTHING
      RETURNING id
    `);
    const docId = doc.rows[0]?.id;
    if (!docId) return; // lost an upsert race — another run already promoted it.

    await tx.execute(sql`
      INSERT INTO marketing.document_chunks
        (tenant_id, document_id, chunk_index, chunk_text, embedding, section_title, superseded)
      VALUES (
        ${tenantId}, ${docId}, 0, ${text.slice(0, 8000)}, ${vec},
        ${`golden:${draft.channel}`}, false
      )
    `);
  });
  console.log(`[metrics:golden] promoted draft ${draft.id} (${draft.channel}) → golden_example`);
}

// ── helpers ───────────────────────────────────────────────────────────
/** Monday (UTC) of the current week as YYYY-MM-DD — the gsc_keywords bucket key. */
export function mondayOfWeek(d: Date = new Date()): string {
  const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = dt.getUTCDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  dt.setUTCDate(dt.getUTCDate() + diff);
  return dt.toISOString().slice(0, 10);
}
