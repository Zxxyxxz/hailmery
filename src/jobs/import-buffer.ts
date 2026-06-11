// Historical Buffer content import (Session 7).
//
// Imports a tenant's already-published social posts from Buffer into hailmery as
// `measured` content_drafts + real content_metrics, then scores them and promotes
// the top performers to golden examples — seeding the learning loop with months of
// real engagement instead of a handful of recent posts.
//
// Shared by scripts/import-buffer-history.mjs (CLI, no time limit) and
// POST /api/import/buffer-history (dashboard trigger). Both paths run the exact
// same logic so behaviour can't drift.
//
// Idempotent / safely re-runnable. A Buffer post is skipped when a draft already
// references it by published_ref (a post hailmery published itself, e.g. the
// 67-impression LinkedIn post) OR by payload.buffer_post_id (a prior import). Both
// are checked because the two paths record the Buffer id in different places.
//
// Scoring uses scorePerformance with a FULL-history window so months-old posts —
// the bulk of the value — are scored, not just the last 30 days (the nightly cron
// would otherwise silently skip ~85% of APIRE's back-catalogue).

import { sql } from 'drizzle-orm';
import type { NeonDatabase } from 'drizzle-orm/neon-serverless';
import { withTenantDb, findFirstSiteForTenant, assertUuid } from '../lib/tenant.js';
import { resolveAdapter } from '../lib/credentials.js';
import { BufferAdapter, type BufferHistoricalPost } from '../adapters/buffer.js';
import { scorePerformance, tagGoldenExamples, type MetricsEnv } from './metrics.js';

type Db = NeonDatabase<Record<string, unknown>>;

// Buffer-backed social channels whose history we can import. (Blog/email are not
// Buffer-published, so they're excluded.)
const IMPORTABLE_CHANNELS = new Set([
  'linkedin',
  'x',
  'twitter',
  'instagram',
  'facebook',
  'tiktok',
  'pinterest',
]);

// Score the FULL history on import (~years of posts), not the nightly 30-day
// window — most imported posts are months old and would otherwise go unscored
// (and therefore never become golden examples).
const FULL_HISTORY_DAYS = 36500;

export interface ImportChannelResult {
  channel: string;
  channelId: string | null;
  fetched: number;
  imported: number;
  skipped: number;
  error?: string;
}

export interface ImportTopPerformer {
  draftId: string;
  channel: string;
  performanceScore: number | null;
  impressions: number;
  engagement: number;
  preview: string;
}

export interface ImportBufferResult {
  tenantId: string;
  dryRun: boolean;
  fetched: number;
  imported: number;
  skipped: number;
  scored: number;
  goldenExamples: number;
  channels: ImportChannelResult[];
  topPerformers: ImportTopPerformer[];
}

export interface ImportBufferOptions {
  db: Db;
  /** Needs SECRETS_KEY (decrypt Buffer creds) + embedding keys (golden promotion). */
  env: MetricsEnv;
  tenantId: string;
  /** UI/CLI channel keys, e.g. ['linkedin'] (or ['x'], which aliases to twitter). */
  channels: string[];
  /** Fetch + de-dup + count only; write nothing. */
  dryRun?: boolean;
}

export async function importBufferHistory(opts: ImportBufferOptions): Promise<ImportBufferResult> {
  const { db, env, tenantId, dryRun = false } = opts;
  assertUuid(tenantId, 'tenantId');

  const channels = [...new Set(opts.channels.map((c) => c.toLowerCase().trim()).filter(Boolean))];
  if (channels.length === 0) throw new Error('no channels specified');
  const bad = channels.find((c) => !IMPORTABLE_CHANNELS.has(c));
  if (bad) throw new Error(`channel "${bad}" is not an importable Buffer channel`);

  // site_id is NOT NULL on content_drafts — every imported draft needs one.
  const site = await findFirstSiteForTenant(db, tenantId);
  if (!site) throw new Error(`tenant ${tenantId} has no site to attach imported drafts to`);

  // Group imports under the tenant's evergreen campaign when one exists. The
  // column is nullable, so a tenant with no campaigns still imports fine.
  const campaignId = await resolveDefaultCampaignId(db, tenantId);

  const result: ImportBufferResult = {
    tenantId,
    dryRun,
    fetched: 0,
    imported: 0,
    skipped: 0,
    scored: 0,
    goldenExamples: 0,
    channels: [],
    topPerformers: [],
  };

  for (const channel of channels) {
    const cr: ImportChannelResult = { channel, channelId: null, fetched: 0, imported: 0, skipped: 0 };
    try {
      // Resolve the Buffer adapter + the tenant's channel id from its decrypted
      // profile map — the same credential path the publish/metrics jobs use.
      const resolved = await resolveAdapter({ db, tenantId, channel, secretsKey: env.SECRETS_KEY });
      if (!('resolved' in resolved)) throw new Error(resolved.reason);
      const adapter = resolved.resolved.adapter;
      if (!(adapter instanceof BufferAdapter)) {
        throw new Error(`channel ${channel} did not resolve to a Buffer adapter`);
      }
      const channelId = resolved.resolved.secret.profileMap?.[channel] ?? null;
      if (!channelId) throw new Error(`no Buffer channel id mapped for "${channel}"`);
      cr.channelId = channelId;

      // Fetch every already-sent post for this channel.
      const posts = await adapter.listHistoricalPosts(channelId);
      cr.fetched = posts.length;
      result.fetched += posts.length;

      // Drop posts already present, then collapse any intra-run duplicates. A
      // post is "already present" when its Buffer id OR its permalink is in the
      // seen set: hailmery's own publish pipeline records published_ref as the
      // post id (scheduled) OR the permalink (shared immediately), and a prior
      // import records the id in payload.buffer_post_id — `seen` holds all three.
      const seen = await loadExistingBufferIds(db, tenantId, channel);
      const fresh: BufferHistoricalPost[] = [];
      const takenThisRun = new Set<string>();
      for (const p of posts) {
        if (!p.id) continue;
        if (seen.has(p.id)) continue;
        if (p.externalLink && seen.has(p.externalLink)) continue;
        if (takenThisRun.has(p.id)) continue; // paginated overlap → don't double-insert
        takenThisRun.add(p.id);
        fresh.push(p);
      }
      cr.skipped = posts.length - fresh.length;
      result.skipped += cr.skipped;

      if (dryRun) {
        cr.imported = fresh.length; // would-import
        result.imported += fresh.length;
      } else {
        const inserted = await insertImportedPosts(db, tenantId, {
          siteId: site.id,
          campaignId,
          channel,
          posts: fresh,
        });
        cr.imported = inserted;
        result.imported += inserted;
      }
    } catch (e) {
      cr.error = e instanceof Error ? e.message : String(e);
      console.error(`[import-buffer] tenant ${tenantId} channel ${channel} failed:`, cr.error);
    }
    result.channels.push(cr);
  }

  // Score + promote on the full history — only when we actually wrote new rows.
  if (!dryRun && result.imported > 0) {
    try {
      result.scored = await scorePerformance(db, tenantId, FULL_HISTORY_DAYS);
      result.goldenExamples = await tagGoldenExamples(env, db, tenantId);
    } catch (e) {
      console.error(
        `[import-buffer] scoring/golden tagging failed for ${tenantId}:`,
        e instanceof Error ? e.message : e,
      );
    }
  }

  // Surface the current top imported performers either way (a dry run shows
  // what's already there; a real run shows the freshly scored set).
  result.topPerformers = await loadTopPerformers(db, tenantId, channels, 5);

  return result;
}

// ── helpers ───────────────────────────────────────────────────────────

/** Evergreen campaign id when present, else any campaign for the tenant, else null. */
async function resolveDefaultCampaignId(db: Db, tenantId: string): Promise<string | null> {
  return withTenantDb(db, tenantId, async (tx) => {
    const ever = await tx.execute<{ id: string }>(sql`
      SELECT id FROM marketing.campaigns
      WHERE tenant_id = ${tenantId} AND type = 'evergreen'
      ORDER BY created_at LIMIT 1
    `);
    if (ever.rows[0]) return ever.rows[0].id;
    const any = await tx.execute<{ id: string }>(sql`
      SELECT id FROM marketing.campaigns
      WHERE tenant_id = ${tenantId}
      ORDER BY created_at LIMIT 1
    `);
    return any.rows[0]?.id ?? null;
  });
}

/** The 'x' UI key and Buffer's 'twitter' service are the same channel — alias them. */
function channelAliases(channel: string): string[] {
  if (channel === 'x' || channel === 'twitter') return ['x', 'twitter'];
  return [channel];
}

/**
 * Identifiers already in hailmery for this channel — `published_ref` (which the
 * publish pipeline sets to the Buffer post id OR the post permalink) and
 * `payload.buffer_post_id` (set by prior imports). The caller matches each
 * Buffer post against this set by both its id and its permalink, so hailmery's
 * own published posts are skipped regardless of which form published_ref took.
 */
async function loadExistingBufferIds(db: Db, tenantId: string, channel: string): Promise<Set<string>> {
  const aliases = channelAliases(channel);
  return withTenantDb(db, tenantId, async (tx) => {
    const r = await tx.execute<{ ref: string | null; bpid: string | null }>(sql`
      SELECT published_ref AS ref, payload->>'buffer_post_id' AS bpid
      FROM marketing.content_drafts
      WHERE tenant_id = ${tenantId}
        AND channel = ANY(ARRAY[${sql.join(
          aliases.map((a) => sql`${a}`),
          sql`, `,
        )}]::text[])
    `);
    const set = new Set<string>();
    for (const row of r.rows) {
      if (row.ref) set.add(row.ref);
      if (row.bpid) set.add(row.bpid);
    }
    return set;
  });
}

/** Safe ISO timestamp from a Buffer date string; null when absent/unparseable. */
function toIsoOrNull(s: string | null): string | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

interface InsertArgs {
  siteId: string;
  campaignId: string | null;
  channel: string;
  posts: BufferHistoricalPost[];
}

/**
 * Insert measured drafts + their content_metrics in a single per-channel
 * transaction (mirrors syncGscKeywords' loop-in-one-tx pattern). Atomic per
 * channel: any failure rolls the channel back, and the dedup makes a re-run safe.
 */
async function insertImportedPosts(db: Db, tenantId: string, args: InsertArgs): Promise<number> {
  const { siteId, campaignId, channel, posts } = args;
  if (posts.length === 0) return 0;

  return withTenantDb(db, tenantId, async (tx) => {
    let n = 0;
    for (const p of posts) {
      const payload = {
        text: p.text,
        buffer_post_id: p.id, // dedup key (also stored as published_ref below)
        buffer_external_link: p.externalLink ?? null,
        imported_from: 'buffer_history',
        original_published_at: p.sentAt,
        service_type: p.serviceType,
        engagement_rate: p.rawMetrics.engagementRate ?? null,
        buffer_metrics: p.rawMetrics,
      };
      const publishAt = toIsoOrNull(p.sentAt);

      const ins = await tx.execute<{ id: string }>(sql`
        INSERT INTO marketing.content_drafts
          (tenant_id, campaign_id, site_id, channel, status, payload,
           publish_at, published_ref, cost_cents)
        VALUES (
          ${tenantId}, ${campaignId}, ${siteId}, ${channel},
          'measured'::marketing.draft_status,
          ${JSON.stringify(payload)}::jsonb,
          ${publishAt}::timestamptz,
          ${p.id}, 0
        )
        RETURNING id
      `);
      const draftId = ins.rows[0]?.id;
      if (!draftId) continue;

      // Real engagement at window '7d' (cumulative-since-publish; the import has
      // no per-window breakdown). Upsert keeps a re-run refreshing in place.
      await tx.execute(sql`
        INSERT INTO marketing.content_metrics
          (tenant_id, draft_id, "window", impressions, clicks, engagement, attributed_leads, fetched_at)
        VALUES (
          ${tenantId}, ${draftId}, '7d'::marketing.metrics_window,
          ${p.metrics.impressions}, ${p.metrics.clicks}, ${p.metrics.engagement}, 0, now()
        )
        ON CONFLICT (tenant_id, draft_id, "window") DO UPDATE SET
          impressions = EXCLUDED.impressions,
          clicks = EXCLUDED.clicks,
          engagement = EXCLUDED.engagement,
          fetched_at = now()
      `);
      n++;
    }
    return n;
  });
}

/** Top imported posts by performance_score (then impressions) — for the summary. */
async function loadTopPerformers(
  db: Db,
  tenantId: string,
  channels: string[],
  limit: number,
): Promise<ImportTopPerformer[]> {
  const aliases = [...new Set(channels.flatMap(channelAliases))];
  return withTenantDb(db, tenantId, async (tx) => {
    const r = await tx.execute<{
      id: string;
      channel: string;
      performance_score: string | null;
      text: string | null;
      impressions: number;
      engagement: number;
    }>(sql`
      SELECT cd.id, cd.channel, cd.performance_score,
             cd.payload->>'text' AS text,
             COALESCE(max(cm.impressions), 0) AS impressions,
             COALESCE(max(cm.engagement), 0) AS engagement
      FROM marketing.content_drafts cd
      LEFT JOIN marketing.content_metrics cm
        ON cm.draft_id = cd.id AND cm.tenant_id = ${tenantId}
      WHERE cd.tenant_id = ${tenantId}
        AND cd.status = 'measured'
        AND cd.payload->>'imported_from' = 'buffer_history'
        AND cd.channel = ANY(ARRAY[${sql.join(
          aliases.map((a) => sql`${a}`),
          sql`, `,
        )}]::text[])
      GROUP BY cd.id, cd.channel, cd.performance_score, cd.payload
      ORDER BY cd.performance_score DESC NULLS LAST, max(cm.impressions) DESC NULLS LAST
      LIMIT ${limit}
    `);
    return r.rows.map((row) => {
      const text = (row.text ?? '').trim().replace(/\s+/g, ' ');
      return {
        draftId: row.id,
        channel: row.channel,
        performanceScore: row.performance_score != null ? Number(row.performance_score) : null,
        impressions: Number(row.impressions),
        engagement: Number(row.engagement),
        preview: text.length > 120 ? `${text.slice(0, 120)}…` : text,
      };
    });
  });
}
