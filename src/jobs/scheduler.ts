// Scheduled jobs, invoked from the Worker `scheduled` handler and routed by
// cron expression (see wrangler.toml + src/index.ts):
//
//   */15 * * * *  → runPublishTick      (publish approved drafts that are due)
//   0   */6 * * * → runGenerationTick    (top up campaign queues below target)
//   0   3   * * * → runNightlyTick       (mail sync + metrics placeholder)
//
// Triggers fire the matching Cloudflare Workflow when its binding is present,
// and fall back to running the pipeline inline otherwise (so the cron path
// still works in local-dev configs without workflow bindings).

import { sql } from 'drizzle-orm';
import { makeDb } from '../db/client.js';
import { getAllActiveTenants, hasPlatformSecret } from '../lib/tenant.js';
import {
  syncContactsToSendGrid,
  resolveMailSyncDeps,
  type MailSyncEnv,
} from '../services/mailsync.js';
import { runGenerationPipeline } from '../workflows/generation.js';
import { runPublishPipeline } from '../workflows/publish.js';
import type { PipelineEnv, GenerationParams } from '../workflows/types.js';

const QUEUE_TARGET = 5;
const QUEUE_STATUSES = ['pending_review', 'approved', 'scheduled'] as const;

export type SchedulerEnv = MailSyncEnv & PipelineEnv;

// ── triggers (workflow binding when present, inline fallback otherwise) ──

async function triggerGeneration(env: SchedulerEnv, params: GenerationParams): Promise<string> {
  if (env.GENERATION_WORKFLOW) {
    const instance = await env.GENERATION_WORKFLOW.create({ params });
    return instance.id;
  }
  await runGenerationPipeline(env, params);
  return 'inline';
}

export async function triggerPublish(env: SchedulerEnv, tenantId?: string | null): Promise<string> {
  if (env.PUBLISH_WORKFLOW) {
    const instance = await env.PUBLISH_WORKFLOW.create({ params: { tenantId: tenantId ?? null } });
    return instance.id;
  }
  await runPublishPipeline(env, { tenantId: tenantId ?? null });
  return 'inline';
}

// ── */15 — publish tick ─────────────────────────────────────────────
// One fleet-wide PublishWorkflow run; loadDueForPublish handles all tenants
// (≤50 drafts/run) when tenantId is null.
export async function runPublishTick(env: SchedulerEnv): Promise<void> {
  try {
    const id = await triggerPublish(env, null);
    console.log(`[scheduler] publish tick → ${id}`);
  } catch (err) {
    console.error('[scheduler] publish tick failed:', err instanceof Error ? err.message : err);
  }
}

// ── 0 */6 — generation tick ─────────────────────────────────────────
// For every active campaign of every active tenant, trigger generation when
// any configured channel is below the queue target.
export async function runGenerationTick(env: SchedulerEnv): Promise<void> {
  const db = makeDb(env.DATABASE_URL);
  const tenants = await getAllActiveTenants(db);

  for (const tenant of tenants) {
    try {
      // Active campaigns + a (campaign_id, channel) → live-count map in one pass.
      const { campaigns, counts } = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenant.id}, true)`);
        const camps = await tx.execute<Record<string, any>>(sql`
          SELECT id, channel_config FROM marketing.campaigns
          WHERE tenant_id = ${tenant.id} AND status = 'active'
        `);
        const cnt = await tx.execute<Record<string, any>>(sql`
          SELECT campaign_id, channel, count(*)::int AS n
          FROM marketing.content_drafts
          WHERE tenant_id = ${tenant.id}
            AND status = ANY(ARRAY[${sql.join(QUEUE_STATUSES.map((s) => sql`${s}`), sql`, `)}]::marketing.draft_status[])
          GROUP BY campaign_id, channel
        `);
        return { campaigns: camps.rows, counts: cnt.rows };
      });

      const countMap = new Map<string, number>();
      for (const r of counts) countMap.set(`${r.campaign_id}:${r.channel}`, Number(r.n));

      for (const camp of campaigns) {
        const channelConfig = (camp.channel_config ?? {}) as Record<string, unknown>;
        const channels = Object.keys(channelConfig).map((c) => c.toLowerCase());
        const needs = channels.some((ch) => (countMap.get(`${camp.id}:${ch}`) ?? 0) < QUEUE_TARGET);
        if (!needs) continue;

        const id = await triggerGeneration(env, {
          tenantId: tenant.id,
          campaignId: String(camp.id),
          triggerReason: 'cron',
        });
        console.log(`[scheduler] generation tick → tenant ${tenant.id} campaign ${camp.id} → ${id}`);
      }
    } catch (err) {
      console.error(`[scheduler] generation tick failed for tenant ${tenant.id}:`, err instanceof Error ? err.message : err);
    }
  }
}

// ── 0 3 — nightly tick ──────────────────────────────────────────────
export async function runNightlyTick(env: SchedulerEnv): Promise<void> {
  await runMailSync(env);
  // Metrics job lands in Chunk 7 — it will drain marketing.metrics_queue rows
  // whose fetch_at <= now(). Placeholder until then.
  console.log('[scheduler] nightly metrics job placeholder (Chunk 7)');
}

// Runs the HubSpot -> SendGrid contact sync for every tenant that has both
// platforms connected. Invoked from the nightly tick.
export async function runMailSync(env: MailSyncEnv): Promise<void> {
  const db = makeDb(env.DATABASE_URL);
  const tenants = await getAllActiveTenants(db);

  for (const tenant of tenants) {
    const [hasHubSpot, hasSendGrid] = await Promise.all([
      hasPlatformSecret(db, tenant.id, 'hubspot'),
      hasPlatformSecret(db, tenant.id, 'sendgrid'),
    ]);
    if (!hasHubSpot || !hasSendGrid) continue;

    try {
      const deps = await resolveMailSyncDeps(env, tenant.id);
      await syncContactsToSendGrid(tenant.id, deps);
    } catch (err) {
      console.error(
        `[mailsync] tenant ${tenant.id} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}
