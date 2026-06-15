// JSON API surface for the approval-queue dashboard (Cloudflare Pages app).
//
// Every tenant-scoped route:
//   - reads the tenant from the X-Tenant-ID header (UUID-validated)
//   - runs all queries inside withTenantDb(), which sets the app.tenant_id
//     session var so RLS policies apply
//   - returns errors as { error, code } with an appropriate status
//
// Mounted at /api by src/index.ts.

import { Hono } from 'hono';
import type { Context } from 'hono';
import { sql } from 'drizzle-orm';
import { makeDb } from '../db/client.js';
import { withTenantDb, assertUuid, findFirstSiteForTenant, loadPlatformToken } from '../lib/tenant.js';
import { encryptSecret, decryptSecret } from '../lib/secrets.js';
import { loadSecret, loadProfileMap } from '../lib/credentials.js';
import { resolveEmailRecipients } from '../services/recipients.js';
import { brandGuardian } from '../agents/guardian.js';
import { runGenerationPipeline } from '../workflows/generation.js';
import { publishSingleDraft } from '../workflows/publish.js';
import type { PipelineEnv, GenerationParams, TriggerReason } from '../workflows/types.js';
import { generateWeeklyIntelligenceBrief } from '../jobs/intelligence.js';
import { generateRecommendations } from '../jobs/recommendations.js';
import { importBufferHistory } from '../jobs/import-buffer.js';
import type { MetricsEnv } from '../jobs/metrics.js';
import { generateSocial, SOCIAL_CHANNELS } from '../generation/social.js';
import { generateBlog } from '../generation/blog.js';
import { generateEmail } from '../generation/email.js';
import { generateImage, type ImageType } from '../generation/image.js';
import { insertDraft, estimateTextCostCents } from '../generation/context.js';
import {
  extractText,
  extensionOf,
  isSupportedExtension,
} from '../corpus/extract.js';
import { embedChunks, replaceDocumentChunks } from '../corpus/ingest.js';
import { putObject, getObject, deleteObject } from '../lib/storage.js';
import {
  GOOGLE_PLATFORM,
  GOOGLE_SCOPES,
  generateOAuthState,
  verifyOAuthState,
  buildGoogleConsentUrl,
  exchangeCodeForTokens,
  fetchGoogleEmail,
  storeGoogleCredential,
  refreshGoogleAccessToken,
} from '../lib/google-oauth.js';
import { GscAdapter } from '../adapters/gsc.js';
import { AdapterHttpError } from '../adapters/index.js';
import { syncGscKeywords, toGscSiteUrl } from '../jobs/metrics.js';

type ApiEnv = {
  DATABASE_URL: string;
  ANTHROPIC_API_KEY: string;
  OPENAI_API_KEY: string;
  SECRETS_KEY: string;
  IDEOGRAM_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  // Google OAuth client config — used by the /api/auth/google/* routes (token
  // exchange + refresh) and the GSC debug sync. Worker secrets, optional so the
  // Node CLI path still type-checks.
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  IMAGE_PROVIDER?: string;
  R2_PUBLIC_BASE_URL?: string;
  // R2 bucket for uploaded corpus documents (see wrangler.toml). Optional so the
  // route can fall back to local disk when run outside the Worker runtime.
  R2?: R2Bucket;
  GENERATION_WORKFLOW?: import('../workflows/types.js').WorkflowBinding;
  PUBLISH_WORKFLOW?: import('../workflows/types.js').WorkflowBinding;
};

const TRIGGER_REASONS = new Set<TriggerReason>(['cron', 'campaign_created', 'manual', 'leadorch_event']);

type Row = Record<string, any>;

const DRAFT_STATUSES = new Set([
  'generating',
  'pending_review',
  'approved',
  'scheduled',
  'published',
  'measured',
  'dismissed',
  'failed',
]);

// Upload pipeline constraints (Chunk 8). Document types mirror the
// marketing.document_type enum; the upload route casts the validated value into
// it so a bad type can never reach the DB.
const DOCUMENT_TYPES = new Set([
  'product_doc',
  'marketing',
  'brand_guideline',
  'company_info',
  'competitor',
  'persona',
  'golden_example',
  'sales_deck',
]);
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB

function mimeForExt(ext: string): string {
  switch (ext) {
    case 'pdf':
      return 'application/pdf';
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'md':
      return 'text/markdown';
    default:
      return 'text/plain';
  }
}

export const api = new Hono<{ Bindings: ApiEnv }>();

// Make the worker's bound secrets visible to the Node-style getters in
// lib/ai.ts (anthropic()/openai() read process.env). nodejs_compat gives us a
// mutable process.env in the worker runtime.
api.use('*', async (c, next) => {
  if (c.env.ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = c.env.ANTHROPIC_API_KEY;
  if (c.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = c.env.OPENAI_API_KEY;
  if (c.env.GOOGLE_API_KEY) process.env.GOOGLE_API_KEY = c.env.GOOGLE_API_KEY;
  if (c.env.IDEOGRAM_API_KEY) process.env.IDEOGRAM_API_KEY = c.env.IDEOGRAM_API_KEY;
  if (c.env.IMAGE_PROVIDER) process.env.IMAGE_PROVIDER = c.env.IMAGE_PROVIDER;
  await next();
});

// ── helpers ─────────────────────────────────────────────────────────

function err(c: Context, status: 400 | 401 | 404 | 422 | 500 | 502, code: string, message: string) {
  return c.json({ error: message, code }, status);
}

/** Pull + validate the tenant id; returns undefined when absent/invalid. */
function tenantOf(c: Context): string | undefined {
  const id = c.req.header('X-Tenant-ID');
  if (!id) return undefined;
  try {
    assertUuid(id, 'X-Tenant-ID');
  } catch {
    return undefined;
  }
  return id;
}

function normalizeDraft(r: Row) {
  const payload = (r.payload ?? {}) as Record<string, any>;
  const gs =
    typeof payload.guardianScore === 'number'
      ? payload.guardianScore
      : typeof payload.guardian_score === 'number'
        ? payload.guardian_score
        : null;
  return {
    id: r.id,
    channel: r.channel,
    status: r.status,
    campaignId: r.campaign_id ?? null,
    campaignName: r.campaign_name ?? null,
    pillar: r.pillar ?? null,
    publishAt: r.publish_at ?? null,
    guardianScore: gs,
    scoreHuman: r.score_human ?? null,
    dismissReason: r.dismiss_reason ?? null,
    failedReason: r.failed_reason ?? null,
    publishedRef: r.published_ref ?? null,
    payload,
    assets: (r.assets ?? {}) as Record<string, any>,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ── GET /api/tenants ────────────────────────────────────────────────
// Fleet-wide list for the tenant switcher (runs with rls_bypass).

api.get('/tenants', async (c) => {
  const db = makeDb(c.env.DATABASE_URL);
  const rows = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.rls_bypass', 'true', true)`);
    const r = await tx.execute<Row>(sql`
      SELECT t.id, t.name, t.slug, s.id AS site_id, s.domain
      FROM marketing.tenants t
      LEFT JOIN LATERAL (
        SELECT id, domain FROM marketing.sites
        WHERE tenant_id = t.id ORDER BY created_at LIMIT 1
      ) s ON true
      ORDER BY t.created_at
    `);
    return r.rows;
  });
  return c.json(
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      siteId: r.site_id ?? null,
      domain: r.domain ?? null,
    })),
  );
});

// ── GET /api/assets/:key ────────────────────────────────────────────
// Public, unauthenticated asset proxy. Streams a generated image straight from
// R2 by its full (tenant-namespaced) object key. The `{.+}` regex param keeps
// the slashes in the key (assets/<tenant>/<draft>/<type>.png). This is what lets
// a Buffer/social post attach a real, fetchable HTTPS image URL — Buffer cannot
// attach a base64 data: URI. No auth by design: the key is unguessable +
// tenant-namespaced and the bytes are non-sensitive marketing imagery.
api.get('/assets/:key{.+}', async (c) => {
  const key = c.req.param('key');
  if (!key) return err(c, 404, 'not_found', 'asset not found');
  if (!c.env.R2) return err(c, 404, 'not_found', 'asset storage unavailable');

  const obj = await c.env.R2.get(key);
  if (!obj) return err(c, 404, 'not_found', 'asset not found');

  const contentType = obj.httpMetadata?.contentType ?? 'image/png';
  return new Response(obj.body, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
});

// ── GET /api/drafts ─────────────────────────────────────────────────

api.get('/drafts', async (c) => {
  const tenantId = tenantOf(c);
  if (!tenantId) return err(c, 400, 'missing_tenant', 'Valid X-Tenant-ID header required');

  const status = c.req.query('status');
  const campaignId = c.req.query('campaign_id');
  const month = c.req.query('month'); // YYYY-MM

  // status accepts one OR a comma-separated list (e.g. "approved,scheduled").
  const statuses = status
    ? status.split(',').map((s) => s.trim()).filter(Boolean)
    : [];
  const badStatus = statuses.find((s) => !DRAFT_STATUSES.has(s));
  if (badStatus) return err(c, 422, 'bad_status', `Unknown status: ${badStatus}`);
  if (campaignId) {
    try {
      assertUuid(campaignId, 'campaign_id');
    } catch {
      return err(c, 422, 'bad_campaign_id', 'campaign_id must be a UUID');
    }
  }

  const db = makeDb(c.env.DATABASE_URL);
  const rows = await withTenantDb(db, tenantId, async (tx) => {
    const conds = [sql`cd.tenant_id = ${tenantId}`];
    if (statuses.length === 1) {
      conds.push(sql`cd.status = ${statuses[0]}::marketing.draft_status`);
    } else if (statuses.length > 1) {
      conds.push(
        sql`cd.status = ANY(ARRAY[${sql.join(
          statuses.map((s) => sql`${s}`),
          sql`, `,
        )}]::marketing.draft_status[])`,
      );
    }
    if (campaignId) conds.push(sql`cd.campaign_id = ${campaignId}`);
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      const start = `${month}-01`;
      conds.push(
        sql`cd.publish_at >= ${start}::timestamptz AND cd.publish_at < (${start}::timestamptz + interval '1 month')`,
      );
    }
    const r = await tx.execute<Row>(sql`
      SELECT cd.id, cd.channel, cd.status, cd.campaign_id, cd.pillar, cd.publish_at,
             cd.payload, cd.assets, cd.score_human, cd.dismiss_reason,
             cd.failed_reason, cd.published_ref,
             cd.created_at, cd.updated_at,
             c.name AS campaign_name
      FROM marketing.content_drafts cd
      LEFT JOIN marketing.campaigns c ON c.id = cd.campaign_id
      WHERE ${sql.join(conds, sql` AND `)}
      ORDER BY cd.publish_at ASC NULLS LAST
    `);
    return r.rows;
  });

  return c.json({ drafts: rows.map(normalizeDraft) });
});

// ── PATCH /api/drafts/:id ───────────────────────────────────────────

api.patch('/drafts/:id', async (c) => {
  const tenantId = tenantOf(c);
  if (!tenantId) return err(c, 400, 'missing_tenant', 'Valid X-Tenant-ID header required');
  const id = c.req.param('id');
  try {
    assertUuid(id, 'id');
  } catch {
    return err(c, 422, 'bad_id', 'draft id must be a UUID');
  }

  const body = await c.req.json<Record<string, any>>().catch(() => null);
  if (!body) return err(c, 400, 'invalid_json', 'Request body must be JSON');
  if (body.status && !DRAFT_STATUSES.has(body.status))
    return err(c, 422, 'bad_status', `Unknown status: ${body.status}`);

  const db = makeDb(c.env.DATABASE_URL);

  // 1. Load the current payload so we can merge edits without clobbering keys.
  const existing = await withTenantDb(db, tenantId, async (tx) => {
    const r = await tx.execute<Row>(sql`
      SELECT payload, channel FROM marketing.content_drafts
      WHERE id = ${id} AND tenant_id = ${tenantId} LIMIT 1
    `);
    return r.rows[0] ?? null;
  });
  if (!existing) return err(c, 404, 'not_found', 'Draft not found');

  const merged: Record<string, any> = {
    ...(existing.payload ?? {}),
    ...(body.payload ?? {}),
  };

  // 2. Optionally re-run the Brand Guardian on the edited text (best-effort —
  //    a missing API key or model error must not block the save).
  if (body.rerunGuardian) {
    const draftText = [merged.title, merged.subject, merged.previewText, merged.body, merged.text]
      .filter((s) => typeof s === 'string' && s.length)
      .join('\n\n');
    if (draftText) {
      try {
        const report = await brandGuardian({ db, tenantId, draftText });
        merged.guardianScore = report.score;
        merged.guardianNotes = report.notes;
      } catch (e) {
        console.error('[api] guardian re-run failed:', (e as Error).message);
      }
    }
  }

  // 3. Apply the update.
  const updated = await withTenantDb(db, tenantId, async (tx) => {
    const sets = [sql`updated_at = now()`, sql`payload = ${JSON.stringify(merged)}::jsonb`];
    if (body.status) sets.push(sql`status = ${body.status}::marketing.draft_status`);
    if ('publishAt' in body) sets.push(sql`publish_at = ${body.publishAt}::timestamptz`);
    if ('dismissReason' in body) sets.push(sql`dismiss_reason = ${body.dismissReason}`);

    await tx.execute(sql`
      UPDATE marketing.content_drafts
      SET ${sql.join(sets, sql`, `)}
      WHERE id = ${id} AND tenant_id = ${tenantId}
    `);

    const r = await tx.execute<Row>(sql`
      SELECT cd.id, cd.channel, cd.status, cd.campaign_id, cd.pillar, cd.publish_at,
             cd.payload, cd.assets, cd.score_human, cd.dismiss_reason,
             cd.failed_reason, cd.published_ref,
             cd.created_at, cd.updated_at, c.name AS campaign_name
      FROM marketing.content_drafts cd
      LEFT JOIN marketing.campaigns c ON c.id = cd.campaign_id
      WHERE cd.id = ${id} AND cd.tenant_id = ${tenantId} LIMIT 1
    `);
    return r.rows[0];
  });

  return c.json({ draft: normalizeDraft(updated) });
});

// ── GET /api/drafts/:id/preview ─────────────────────────────────────
// Email-draft send preview: returns the subject/sender/body plus the resolved
// recipient COUNT (it resolves the list from HubSpot/SendGrid contacts but never
// sends). The dashboard shows "This email will send to N contacts" before the
// operator clicks Publish. A resolution failure (platform not connected, no
// contacts) returns 200 with recipientCount=null and a human listError so the
// card can surface the problem instead of erroring out.

api.get('/drafts/:id/preview', async (c) => {
  const tenantId = tenantOf(c);
  if (!tenantId) return err(c, 400, 'missing_tenant', 'Valid X-Tenant-ID header required');
  const id = c.req.param('id');
  try {
    assertUuid(id, 'id');
  } catch {
    return err(c, 422, 'bad_id', 'draft id must be a UUID');
  }

  const db = makeDb(c.env.DATABASE_URL);
  const draft = await withTenantDb(db, tenantId, async (tx) => {
    const r = await tx.execute<Row>(sql`
      SELECT id, channel, payload FROM marketing.content_drafts
      WHERE id = ${id} AND tenant_id = ${tenantId} LIMIT 1
    `);
    return r.rows[0] ?? null;
  });
  if (!draft) return err(c, 404, 'not_found', 'Draft not found');
  if (draft.channel !== 'email')
    return err(c, 422, 'bad_channel', 'Preview is only available for email drafts');

  const payload = (draft.payload ?? {}) as Record<string, any>;

  let recipientCount: number | null = null;
  let capped = false;
  let listError: string | null = null;
  try {
    const resolved = await resolveEmailRecipients({
      db,
      tenantId,
      secretsKey: c.env.SECRETS_KEY,
      payload,
    });
    recipientCount = resolved.recipients.length;
    capped = resolved.capped;
  } catch (e) {
    listError = e instanceof Error ? e.message : String(e);
  }

  return c.json({
    subject: payload.subject ?? null,
    htmlBody: payload.html_body ?? null,
    fromEmail: payload.from_email ?? null,
    fromName: payload.from_name ?? null,
    emailType: payload.emailType ?? null,
    listSource: payload.list_source ?? null,
    recipientCount,
    capped,
    listError,
    previewOnly: true,
  });
});

// ── GET /api/campaigns ──────────────────────────────────────────────

api.get('/campaigns', async (c) => {
  const tenantId = tenantOf(c);
  if (!tenantId) return err(c, 400, 'missing_tenant', 'Valid X-Tenant-ID header required');

  const db = makeDb(c.env.DATABASE_URL);
  const rows = await withTenantDb(db, tenantId, async (tx) => {
    const r = await tx.execute<Row>(sql`
      SELECT c.id, c.name, c.type, c.status, c.goal_type, c.goal_value,
             c.launch_date, c.audience_brief, c.language_config, c.channel_config,
             c.voice_modifier, c.created_at,
             (SELECT count(*) FROM marketing.content_drafts d
                WHERE d.campaign_id = c.id AND d.status = 'pending_review') AS pending,
             (SELECT count(*) FROM marketing.content_drafts d
                WHERE d.campaign_id = c.id AND d.status = 'approved') AS approved,
             (SELECT count(*) FROM marketing.content_drafts d
                WHERE d.campaign_id = c.id AND d.status IN ('published','measured')) AS published,
             (SELECT count(*) FROM marketing.content_drafts d
                WHERE d.campaign_id = c.id) AS total,
             COALESCE((
               SELECT sum(cm.attributed_leads)
               FROM marketing.content_metrics cm
               JOIN marketing.content_drafts d2 ON d2.id = cm.draft_id
               WHERE d2.campaign_id = c.id
             ), 0) AS attributed_leads,
             (SELECT array_agg(DISTINCT d3.channel)
                FROM marketing.content_drafts d3 WHERE d3.campaign_id = c.id) AS channels
      FROM marketing.campaigns c
      WHERE c.tenant_id = ${tenantId}
      ORDER BY c.created_at
    `);
    return r.rows;
  });

  return c.json({
    campaigns: rows.map((r) => {
      const channelConfig = (r.channel_config ?? {}) as Record<string, any>;
      const channels: string[] =
        (r.channels as string[] | null) ?? Object.keys(channelConfig);
      return {
        id: r.id,
        name: r.name,
        type: r.type,
        status: r.status,
        goalType: r.goal_type,
        goalValue: r.goal_value ?? null,
        launchDate: r.launch_date ?? null,
        audienceBrief: r.audience_brief ?? {},
        languageConfig: r.language_config ?? {},
        channelConfig,
        voiceModifier: r.voice_modifier ?? null,
        channels: channels.filter(Boolean),
        counts: {
          pending: Number(r.pending),
          approved: Number(r.approved),
          published: Number(r.published),
          total: Number(r.total),
        },
        attributedLeads: Number(r.attributed_leads),
        createdAt: r.created_at,
      };
    }),
  });
});

// ── POST /api/campaigns ─────────────────────────────────────────────

api.post('/campaigns', async (c) => {
  const tenantId = tenantOf(c);
  if (!tenantId) return err(c, 400, 'missing_tenant', 'Valid X-Tenant-ID header required');
  const body = await c.req.json<Record<string, any>>().catch(() => null);
  if (!body || !body.name) return err(c, 422, 'bad_input', 'name is required');

  const db = makeDb(c.env.DATABASE_URL);
  const created = await withTenantDb(db, tenantId, async (tx) => {
    const siteRows = await tx.execute<Row>(sql`
      SELECT id FROM marketing.sites WHERE tenant_id = ${tenantId} ORDER BY created_at LIMIT 1
    `);
    const siteId = siteRows.rows[0]?.id;
    if (!siteId) throw new Error('no_site');

    const audienceBrief = JSON.stringify(body.audienceBrief ? { text: body.audienceBrief } : {});
    const languageConfig = JSON.stringify(body.language ? { language: body.language } : {});
    const channelConfig = JSON.stringify(body.channelConfig ?? {});

    const r = await tx.execute<Row>(sql`
      INSERT INTO marketing.campaigns
        (tenant_id, site_id, name, type, goal_type, goal_value, launch_date,
         audience_brief, language_config, channel_config, voice_modifier, status)
      VALUES (
        ${tenantId}, ${siteId}, ${body.name},
        ${body.type ?? 'evergreen'}::marketing.campaign_type,
        ${body.goalType ?? 'custom'}::marketing.campaign_goal_type,
        ${body.goalValue ?? null},
        ${body.launchDate ?? null}::timestamptz,
        ${audienceBrief}::jsonb, ${languageConfig}::jsonb, ${channelConfig}::jsonb,
        ${body.voiceModifier ?? null},
        'active'
      )
      RETURNING id, name, type, status, goal_type, goal_value, launch_date,
                audience_brief, language_config, channel_config, voice_modifier, created_at
    `);
    return r.rows[0];
  }).catch((e: Error) => {
    if (e.message === 'no_site') return null;
    throw e;
  });

  if (!created) return err(c, 422, 'no_site', 'Tenant has no site to attach the campaign to');

  // NOTE: the first-batch generation trigger (Strategist → specialist agents)
  // is enqueued here in V1 via the Generation Workflow. V0 returns the created
  // campaign immediately; the scheduled generation tick tops up its queue.

  const channelConfig = (created.channel_config ?? {}) as Record<string, any>;
  return c.json(
    {
      campaign: {
        id: created.id,
        name: created.name,
        type: created.type,
        status: created.status,
        goalType: created.goal_type,
        goalValue: created.goal_value ?? null,
        launchDate: created.launch_date ?? null,
        audienceBrief: created.audience_brief ?? {},
        languageConfig: created.language_config ?? {},
        channelConfig,
        voiceModifier: created.voice_modifier ?? null,
        channels: Object.keys(channelConfig),
        counts: { pending: 0, approved: 0, published: 0, total: 0 },
        attributedLeads: 0,
        createdAt: created.created_at,
      },
    },
    201,
  );
});

// ── PATCH /api/campaigns/:id ────────────────────────────────────────

api.patch('/campaigns/:id', async (c) => {
  const tenantId = tenantOf(c);
  if (!tenantId) return err(c, 400, 'missing_tenant', 'Valid X-Tenant-ID header required');
  const id = c.req.param('id');
  try {
    assertUuid(id, 'id');
  } catch {
    return err(c, 422, 'bad_id', 'campaign id must be a UUID');
  }
  const body = await c.req.json<Record<string, any>>().catch(() => null);
  if (!body) return err(c, 400, 'invalid_json', 'Request body must be JSON');

  const db = makeDb(c.env.DATABASE_URL);
  const updated = await withTenantDb(db, tenantId, async (tx) => {
    const sets = [sql`updated_at = now()`];
    if (body.status) sets.push(sql`status = ${body.status}::marketing.campaign_status`);
    if (typeof body.name === 'string') sets.push(sql`name = ${body.name}`);
    if ('goalValue' in body) sets.push(sql`goal_value = ${body.goalValue}`);
    if (body.channelConfig)
      sets.push(sql`channel_config = ${JSON.stringify(body.channelConfig)}::jsonb`);

    const r = await tx.execute<Row>(sql`
      UPDATE marketing.campaigns SET ${sql.join(sets, sql`, `)}
      WHERE id = ${id} AND tenant_id = ${tenantId}
      RETURNING id, name, type, status, goal_type, goal_value, launch_date,
                channel_config, voice_modifier, created_at
    `);
    return r.rows[0] ?? null;
  });

  if (!updated) return err(c, 404, 'not_found', 'Campaign not found');
  const channelConfig = (updated.channel_config ?? {}) as Record<string, any>;
  return c.json({
    campaign: {
      id: updated.id,
      name: updated.name,
      type: updated.type,
      status: updated.status,
      goalType: updated.goal_type,
      goalValue: updated.goal_value ?? null,
      launchDate: updated.launch_date ?? null,
      audienceBrief: {},
      languageConfig: {},
      channelConfig,
      voiceModifier: updated.voice_modifier ?? null,
      channels: Object.keys(channelConfig),
      counts: { pending: 0, approved: 0, published: 0, total: 0 },
      attributedLeads: 0,
      createdAt: updated.created_at,
    },
  });
});

// ── GET / PATCH /api/sites/:id/config ───────────────────────────────

api.get('/sites/:id/config', async (c) => {
  const tenantId = tenantOf(c);
  if (!tenantId) return err(c, 400, 'missing_tenant', 'Valid X-Tenant-ID header required');
  const siteId = c.req.param('id');
  try {
    assertUuid(siteId, 'site id');
  } catch {
    return err(c, 422, 'bad_id', 'site id must be a UUID');
  }

  const db = makeDb(c.env.DATABASE_URL);
  const row = await withTenantDb(db, tenantId, async (tx) => {
    const r = await tx.execute<Row>(sql`
      SELECT sc.brand_voice, s.domain
      FROM marketing.site_config sc
      JOIN marketing.sites s ON s.id = sc.site_id
      WHERE sc.site_id = ${siteId} AND sc.tenant_id = ${tenantId} LIMIT 1
    `);
    return r.rows[0] ?? null;
  });
  if (!row) return err(c, 404, 'not_found', 'Site config not found');
  return c.json({ siteId, domain: row.domain, brandVoice: row.brand_voice ?? {} });
});

api.patch('/sites/:id/config', async (c) => {
  const tenantId = tenantOf(c);
  if (!tenantId) return err(c, 400, 'missing_tenant', 'Valid X-Tenant-ID header required');
  const siteId = c.req.param('id');
  try {
    assertUuid(siteId, 'site id');
  } catch {
    return err(c, 422, 'bad_id', 'site id must be a UUID');
  }
  const body = await c.req.json<Record<string, any>>().catch(() => null);
  if (!body || typeof body.brandVoice !== 'object')
    return err(c, 422, 'bad_input', 'brandVoice object required');

  const db = makeDb(c.env.DATABASE_URL);
  const row = await withTenantDb(db, tenantId, async (tx) => {
    const r = await tx.execute<Row>(sql`
      UPDATE marketing.site_config
      SET brand_voice = ${JSON.stringify(body.brandVoice)}::jsonb, updated_at = now()
      WHERE site_id = ${siteId} AND tenant_id = ${tenantId}
      RETURNING brand_voice
    `);
    return r.rows[0] ?? null;
  });
  if (!row) return err(c, 404, 'not_found', 'Site config not found');
  return c.json({ siteId, domain: null, brandVoice: row.brand_voice ?? {} });
});

// ── GET /api/documents ──────────────────────────────────────────────

api.get('/documents', async (c) => {
  const tenantId = tenantOf(c);
  if (!tenantId) return err(c, 400, 'missing_tenant', 'Valid X-Tenant-ID header required');
  const db = makeDb(c.env.DATABASE_URL);
  const rows = await withTenantDb(db, tenantId, async (tx) => {
    const r = await tx.execute<Row>(sql`
      SELECT d.id, d.source_filename, d.document_type, d.version, d.ingested_at,
             (SELECT count(*) FROM marketing.document_chunks dc
                WHERE dc.document_id = d.id AND dc.superseded = false) AS chunk_count
      FROM marketing.documents d
      WHERE d.tenant_id = ${tenantId} AND d.superseded_at IS NULL
      ORDER BY d.ingested_at DESC
    `);
    return r.rows;
  });
  return c.json({
    documents: rows.map((r) => ({
      id: r.id,
      sourceFilename: r.source_filename,
      documentType: r.document_type,
      version: r.version,
      ingestedAt: r.ingested_at,
      chunkCount: Number(r.chunk_count),
    })),
  });
});

// ── GET /api/documents/:id ──────────────────────────────────────────
// Single document — powers the dashboard's ingestion-progress polling.

api.get('/documents/:id', async (c) => {
  const tenantId = tenantOf(c);
  if (!tenantId) return err(c, 400, 'missing_tenant', 'Valid X-Tenant-ID header required');
  const id = c.req.param('id');
  try {
    assertUuid(id, 'id');
  } catch {
    return err(c, 422, 'bad_id', 'document id must be a UUID');
  }

  const db = makeDb(c.env.DATABASE_URL);
  const row = await withTenantDb(db, tenantId, async (tx) => {
    const r = await tx.execute<Row>(sql`
      SELECT d.id, d.source_filename, d.document_type, d.version, d.ingested_at,
             d.extraction_status, d.r2_key, d.chunk_count
      FROM marketing.documents d
      WHERE d.id = ${id} AND d.tenant_id = ${tenantId}
      LIMIT 1
    `);
    return r.rows[0] ?? null;
  });
  if (!row) return err(c, 404, 'not_found', 'document not found');

  return c.json({
    document: {
      id: row.id,
      sourceFilename: row.source_filename,
      documentType: row.document_type,
      version: row.version,
      ingestedAt: row.ingested_at,
      extractionStatus: row.extraction_status,
      r2Key: row.r2_key,
      chunkCount: row.chunk_count == null ? null : Number(row.chunk_count),
    },
  });
});

// ── POST /api/documents/upload ──────────────────────────────────────
// Full ingestion pipeline, synchronously: validate → store to R2 → extract text
// → chunk (512/64) → embed (text-embedding-3-small) → upsert document_chunks →
// stamp the document row. Returns the chunk count so the caller knows the
// corpus is queryable immediately. Extraction failures degrade to a partial
// success (status='failed') instead of a 5xx — the file is still stored.

api.post('/documents/upload', async (c) => {
  const tenantId = tenantOf(c);
  if (!tenantId) return err(c, 400, 'missing_tenant', 'Valid X-Tenant-ID header required');

  // STEP 1 — receive + validate.
  const form = await c.req.parseBody().catch(() => null);
  const file = form?.file;
  if (!(file instanceof File)) return err(c, 422, 'no_file', 'multipart "file" field required');

  const rawType = typeof form?.document_type === 'string' ? form.document_type : '';
  const documentType = rawType || 'product_doc';
  if (!DOCUMENT_TYPES.has(documentType)) {
    return err(c, 422, 'bad_document_type', `document_type must be one of: ${[...DOCUMENT_TYPES].join(', ')}`);
  }

  const filename = file.name;
  const ext = extensionOf(filename);
  if (!isSupportedExtension(ext)) {
    return err(c, 422, 'bad_file_type', 'file must be .pdf, .docx, .md, or .txt');
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength === 0) return err(c, 422, 'empty_file', 'uploaded file is empty');
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    return err(c, 422, 'file_too_large', 'max file size is 10MB');
  }
  const mime = file.type || mimeForExt(ext);

  const db = makeDb(c.env.DATABASE_URL);

  // Record the document row first so we have its id for the R2 key. Re-uploading
  // the same filename reuses the existing row (and id) and bumps the version.
  const documentId = await withTenantDb(db, tenantId, async (tx) => {
    const r = await tx.execute<Row>(sql`
      INSERT INTO marketing.documents
        (tenant_id, source, source_filename, document_type, r2_key, mime_type, version, extraction_status)
      VALUES (
        ${tenantId}, 'upload', ${filename}, ${documentType}::marketing.document_type,
        '', ${mime}, 1, 'pending'
      )
      ON CONFLICT (tenant_id, source_filename) DO UPDATE SET
        version = marketing.documents.version + 1,
        document_type = EXCLUDED.document_type,
        mime_type = EXCLUDED.mime_type,
        extraction_status = 'pending',
        superseded_at = NULL
      RETURNING id
    `);
    return r.rows[0].id as string;
  });

  const r2Key = `corpus/${tenantId}/${documentId}/${filename}`;

  // STEP 2 — store the original to R2 (local-disk fallback when unbound).
  await putObject(c.env.R2, r2Key, bytes, mime);

  // STEP 3 — extract text. A failure here is a partial success: the file is
  // stored, but the row is marked failed and no chunks are written.
  let text: string;
  try {
    text = await extractText(bytes, filename);
  } catch (e) {
    return markFailed(c, db, tenantId, documentId, r2Key, filename, documentType, e);
  }
  if (!text.trim()) {
    return markFailed(c, db, tenantId, documentId, r2Key, filename, documentType, new Error('no extractable text in file'));
  }

  // STEP 4 — chunk + embed (outside the tx; embedding is a network call).
  let chunks: string[];
  let embeddings: number[][];
  try {
    ({ chunks, embeddings } = await embedChunks(text));
  } catch (e) {
    return markFailed(c, db, tenantId, documentId, r2Key, filename, documentType, e);
  }

  // STEP 5 — supersede old chunks, insert fresh ones, stamp the document.
  const chunkCount = await withTenantDb(db, tenantId, async (tx) => {
    const n = await replaceDocumentChunks(tx, { tenantId, documentId, chunks, embeddings });
    await tx.execute(sql`
      UPDATE marketing.documents
      SET ingested_at = now(), chunk_count = ${n}, r2_key = ${r2Key},
          extraction_status = 'ingested', superseded_at = NULL
      WHERE id = ${documentId} AND tenant_id = ${tenantId}
    `);
    return n;
  });

  // STEP 6 — respond.
  return c.json(
    {
      document_id: documentId,
      filename,
      document_type: documentType,
      chunk_count: chunkCount,
      r2_key: r2Key,
      status: 'ingested',
    },
    201,
  );
});

/** Mark a document's ingest failed and return a 200 partial-success response. */
async function markFailed(
  c: Context,
  db: ReturnType<typeof makeDb>,
  tenantId: string,
  documentId: string,
  r2Key: string,
  filename: string,
  documentType: string,
  e: unknown,
) {
  const error = e instanceof Error ? e.message : String(e);
  console.error(`[upload] extraction failed for ${filename} (${documentId}):`, error);
  await withTenantDb(db, tenantId, async (tx) => {
    await tx.execute(sql`
      UPDATE marketing.documents
      SET extraction_status = 'failed', r2_key = ${r2Key}, chunk_count = NULL
      WHERE id = ${documentId} AND tenant_id = ${tenantId}
    `);
  });
  return c.json(
    {
      document_id: documentId,
      filename,
      document_type: documentType,
      chunk_count: 0,
      r2_key: r2Key,
      status: 'failed',
      error,
    },
    200,
  );
}

// ── POST /api/documents/:id/reingest ────────────────────────────────
// Re-runs extraction + chunking + embedding from the stored R2 object, bumps
// the document version, and supersedes the previous chunks. Powers the Corpus
// tab's "Re-ingest" button.

api.post('/documents/:id/reingest', async (c) => {
  const tenantId = tenantOf(c);
  if (!tenantId) return err(c, 400, 'missing_tenant', 'Valid X-Tenant-ID header required');
  const id = c.req.param('id');
  try {
    assertUuid(id, 'id');
  } catch {
    return err(c, 422, 'bad_id', 'document id must be a UUID');
  }

  const db = makeDb(c.env.DATABASE_URL);
  const doc = await withTenantDb(db, tenantId, async (tx) => {
    const r = await tx.execute<Row>(sql`
      SELECT id, source_filename, r2_key, document_type
      FROM marketing.documents
      WHERE id = ${id} AND tenant_id = ${tenantId}
      LIMIT 1
    `);
    return r.rows[0] ?? null;
  });
  if (!doc) return err(c, 404, 'not_found', 'document not found');

  const filename = doc.source_filename as string;
  const r2Key = doc.r2_key as string;
  const documentType = doc.document_type as string;

  // Download the original from storage.
  const bytes = await getObject(c.env.R2, r2Key);
  if (!bytes) {
    return err(c, 422, 'file_missing', 'original file is not in storage — re-upload it first');
  }

  // Extract → embed (extraction failure = partial success, version unchanged).
  let text: string;
  try {
    text = await extractText(bytes, filename);
    if (!text.trim()) throw new Error('no extractable text in file');
  } catch (e) {
    return markFailed(c, db, tenantId, id, r2Key, filename, documentType, e);
  }

  let chunks: string[];
  let embeddings: number[][];
  try {
    ({ chunks, embeddings } = await embedChunks(text));
  } catch (e) {
    return markFailed(c, db, tenantId, id, r2Key, filename, documentType, e);
  }

  const result = await withTenantDb(db, tenantId, async (tx) => {
    const n = await replaceDocumentChunks(tx, { tenantId, documentId: id, chunks, embeddings });
    const upd = await tx.execute<Row>(sql`
      UPDATE marketing.documents
      SET version = version + 1, ingested_at = now(), chunk_count = ${n},
          extraction_status = 'ingested', superseded_at = NULL
      WHERE id = ${id} AND tenant_id = ${tenantId}
      RETURNING version
    `);
    return { chunkCount: n, version: Number(upd.rows[0].version) };
  });

  return c.json({
    document_id: id,
    filename,
    document_type: documentType,
    chunk_count: result.chunkCount,
    version: result.version,
    r2_key: r2Key,
    status: 'ingested',
  });
});

// ── DELETE /api/documents/:id ───────────────────────────────────────
// Removes the R2 object, soft-deletes the chunks, then deletes the document
// row (the FK cascade clears the chunks for good).

api.delete('/documents/:id', async (c) => {
  const tenantId = tenantOf(c);
  if (!tenantId) return err(c, 400, 'missing_tenant', 'Valid X-Tenant-ID header required');
  const id = c.req.param('id');
  try {
    assertUuid(id, 'id');
  } catch {
    return err(c, 422, 'bad_id', 'document id must be a UUID');
  }

  const db = makeDb(c.env.DATABASE_URL);

  // Look up the r2_key first so we can clear the stored object.
  const r2Key = await withTenantDb(db, tenantId, async (tx) => {
    const r = await tx.execute<Row>(sql`
      SELECT r2_key FROM marketing.documents
      WHERE id = ${id} AND tenant_id = ${tenantId} LIMIT 1
    `);
    return (r.rows[0]?.r2_key as string | undefined) ?? null;
  });
  if (r2Key === null) return err(c, 404, 'not_found', 'document not found');

  // Best-effort R2 delete — never block the DB cleanup on a storage hiccup.
  try {
    await deleteObject(c.env.R2, r2Key);
  } catch (e) {
    console.error(`[delete] R2 delete failed for ${r2Key}:`, e);
  }

  await withTenantDb(db, tenantId, async (tx) => {
    // Soft-delete chunks (audit trail), then delete the doc — the FK cascade
    // removes the chunk rows so nothing is orphaned.
    await tx.execute(sql`
      UPDATE marketing.document_chunks
      SET superseded = true
      WHERE document_id = ${id} AND tenant_id = ${tenantId}
    `);
    await tx.execute(sql`
      DELETE FROM marketing.documents WHERE id = ${id} AND tenant_id = ${tenantId}
    `);
  });
  return c.json({ ok: true });
});

// ── Connections — connect-wizard backend ────────────────────────────
// Real per-platform connection status (validated against the live provider API,
// cached 5 min), self-serve connect/disconnect for the API-key platforms, and a
// SendGrid sending-domain authentication guide.
//
// Security: a raw API key only ever exists in memory — it is validated with a
// live call, then AES-GCM encrypted (lib/secrets) before it touches the DB. We
// never log a key or token. Every query carries an explicit tenant_id predicate
// and runs inside withTenantDb (RLS).

type ConnType = 'api_key' | 'oauth' | 'managed';

interface ConnectionPlatform {
  id: string; // stable id shared with the dashboard (dashboard/src/lib/platforms.ts)
  secretPlatform: string; // tenant_secrets.platform key
  type: ConnType;
  canConnect: boolean; // true → self-serve connect flow exists
  probe: boolean; // true → make a live validation call
}

// Platforms whose status this endpoint determines. The OAuth-native cards
// (LinkedIn/X/Meta) have no credential to check and are rendered statically by
// the dashboard, so they are intentionally omitted here.
const CONNECTION_PLATFORMS: ConnectionPlatform[] = [
  { id: 'buffer', secretPlatform: 'buffer', type: 'api_key', canConnect: true, probe: true },
  { id: 'hubspot', secretPlatform: 'hubspot', type: 'api_key', canConnect: true, probe: true },
  { id: 'sendgrid', secretPlatform: 'sendgrid', type: 'api_key', canConnect: true, probe: true },
  { id: 'wix', secretPlatform: 'wix-blog', type: 'managed', canConnect: false, probe: false },
  // Google stores its grant under platform='google' (the metrics job reads the
  // same key); an earlier draft used 'gsc' here and the status check never saw
  // the token. `probe: false` — we trust the stored expiry instead of hitting
  // Google on every dashboard load (the connections handler surfaces the email +
  // active scopes from the stored row).
  { id: 'google', secretPlatform: GOOGLE_PLATFORM, type: 'oauth', canConnect: true, probe: false },
];

// Platforms a tenant can connect/disconnect with an API key via the wizard.
const API_KEY_PLATFORMS = new Set(['buffer', 'hubspot', 'sendgrid']);
// Platforms the disconnect route may delete — the API-key set plus Google, whose
// credential is removed the same way (delete the tenant_secrets row) even though
// it's acquired via OAuth rather than a pasted key.
const DISCONNECTABLE_PLATFORMS = new Set([...API_KEY_PLATFORMS, GOOGLE_PLATFORM]);
const PLATFORM_LABEL: Record<string, string> = {
  buffer: 'Buffer',
  hubspot: 'HubSpot',
  sendgrid: 'SendGrid',
};

// ── live validation probes ──────────────────────────────────────────
// A probe authenticates a token against the provider and (when possible) reads a
// display account. Tri-state so the caller can distinguish a definitively bad
// key (invalid) from a transient outage (uncertain) — we never mark a tenant
// disconnected just because the provider was briefly unreachable.
type ProbeStatus = 'valid' | 'invalid' | 'uncertain';
interface ProbeResult {
  status: ProbeStatus;
  account: string | null;
}

// Buffer's GraphQL API has no `viewer`; the authenticated account is `account`
// (verified live: `{ account { id email name } }` returns the connected user).
async function probeBuffer(token: string): Promise<ProbeResult> {
  let res: Response;
  try {
    res = await fetch('https://api.buffer.com/graphql', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ account { id email name } }' }),
    });
  } catch {
    return { status: 'uncertain', account: null };
  }
  if (res.status === 401 || res.status === 403) return { status: 'invalid', account: null };
  if (!res.ok) return { status: 'uncertain', account: null };
  const body = (await res.json().catch(() => null)) as
    | { data?: { account?: { id?: string; email?: string; name?: string } }; errors?: unknown[] }
    | null;
  const account = body?.data?.account;
  if (!account?.id) {
    // A schema-valid query that returns no account with errors present means the
    // token was rejected; no body at all is a transient/unreadable response.
    return { status: body?.errors ? 'invalid' : 'uncertain', account: null };
  }
  return { status: 'valid', account: account.email ?? account.name ?? account.id };
}

async function probeHubspot(token: string): Promise<ProbeResult> {
  // Validate against the scope the connect UI actually asks Baran to grant
  // (contacts — mirrors HubSpotAdapter.quotaState). The account-info API is a
  // *different* scope a correctly-scoped private-app token may lack; using it to
  // validate would 403 and misread a perfectly valid key as invalid.
  let res: Response;
  try {
    res = await fetch('https://api.hubapi.com/crm/v3/objects/contacts?limit=1', {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    return { status: 'uncertain', account: null };
  }
  if (res.status === 401 || res.status === 403) return { status: 'invalid', account: null };
  if (!res.ok) return { status: 'uncertain', account: null };
  // Friendly "Portal NNN" label is best-effort: account-info is a separate scope,
  // so a 403 here must not downgrade an otherwise-valid token.
  let account: string | null = null;
  try {
    const ar = await fetch('https://api.hubapi.com/account-info/v3/details', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (ar.ok) {
      const aj = (await ar.json().catch(() => null)) as { portalId?: number } | null;
      account = aj?.portalId != null ? `Portal ${aj.portalId}` : null;
    }
  } catch {
    /* best-effort label only */
  }
  return { status: 'valid', account };
}

// SendGrid's /user/profile carries no email (just { type, userid }); the account
// email lives at /user/email, fetched best-effort for a friendlier label.
async function probeSendgrid(token: string): Promise<ProbeResult> {
  let res: Response;
  try {
    res = await fetch('https://api.sendgrid.com/v3/user/profile', {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    return { status: 'uncertain', account: null };
  }
  if (res.status === 401 || res.status === 403) return { status: 'invalid', account: null };
  if (!res.ok) return { status: 'uncertain', account: null };
  let account: string | null = null;
  try {
    const er = await fetch('https://api.sendgrid.com/v3/user/email', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (er.ok) {
      const ej = (await er.json().catch(() => null)) as { email?: string } | null;
      account = ej?.email ?? null;
    }
  } catch {
    /* best-effort — a valid key without the email scope still counts as connected */
  }
  return { status: 'valid', account };
}

function probePlatform(platform: string, token: string): Promise<ProbeResult> {
  switch (platform) {
    case 'buffer':
      return probeBuffer(token);
    case 'hubspot':
      return probeHubspot(token);
    case 'sendgrid':
      return probeSendgrid(token);
    default:
      return Promise.resolve({ status: 'uncertain', account: null });
  }
}

// SendGrid sending-domain (whitelabel) status for the tenant's site domain.
interface DomainStatus {
  registered: boolean;
  verified: boolean;
}
async function sendgridDomainStatus(token: string, domain: string | null): Promise<DomainStatus | null> {
  if (!domain) return null;
  try {
    const res = await fetch('https://api.sendgrid.com/v3/whitelabel/domains?limit=50', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const arr = (await res.json().catch(() => null)) as Array<{ domain: string; valid?: boolean }> | null;
    if (!Array.isArray(arr)) return null;
    const hit = arr.find((d) => d.domain === domain);
    if (!hit) return { registered: false, verified: false };
    return { registered: true, verified: hit.valid === true };
  } catch {
    return null;
  }
}

// ── 5-minute in-memory validation cache (per isolate) ───────────────
interface CachedStatus {
  connected: boolean;
  account: string | null;
  lastValidated: string | null;
  domain?: string | null;
  domainRegistered?: boolean;
  domainVerified?: boolean;
}
const CONNECTION_CACHE = new Map<string, { value: CachedStatus; expires: number }>();
const CONNECTION_TTL_MS = 5 * 60 * 1000;
const connCacheKey = (tenantId: string, platform: string) => `${tenantId}:${platform}`;
function bustConnectionCache(tenantId: string, platform: string) {
  CONNECTION_CACHE.delete(connCacheKey(tenantId, platform));
}

// ── Google OAuth (one grant → GSC today, GA4/Ads later) ─────────────
// Flow: the dashboard opens /api/auth/google/start in a popup → we redirect to
// Google's consent screen with an HMAC-signed `state` (CSRF guard) → Google
// redirects back to /api/auth/google/callback → we verify state, exchange the
// code, encrypt + store the tokens, and postMessage the result to the opener.
// No token ever reaches the browser; only the account email + scopes do.

// Render the popup's terminal HTML. The result is delivered via postMessage with
// the payload JSON-encoded AND HTML-escaped so neither a Google-supplied `error`
// string nor an account email can break out of the <script> (defense in depth —
// emails never contain these, but the error param is attacker-influenced).
function oauthPopupHtml(payload: Record<string, unknown>): string {
  const json = JSON.stringify(payload)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Connecting…</title></head>
<body style="font-family:system-ui;background:#0b0b0f;color:#9ca3af;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
<p>You can close this window.</p>
<script>(function(){try{window.opener&&window.opener.postMessage(${json},'*');}catch(e){}window.close();})();</script>
</body></html>`;
}

// GET /api/auth/google/start?tenant=<uuid> — kick off consent. tenant comes as a
// query param (this is a top-level browser navigation, not an XHR with headers).
api.get('/auth/google/start', async (c) => {
  const tenantId = c.req.query('tenant');
  if (!tenantId) return c.text('tenant required', 400);
  try {
    assertUuid(tenantId, 'tenant');
  } catch {
    return c.text('invalid tenant', 400);
  }
  const clientId = c.env.GOOGLE_CLIENT_ID;
  if (!clientId) return c.text('Google OAuth is not configured on this server', 500);

  const state = await generateOAuthState(c.env.SECRETS_KEY, { tenantId });
  return c.redirect(buildGoogleConsentUrl(clientId, state));
});

// GET /api/auth/google/callback — Google redirects here with ?code&state (or
// ?error on denial). Returns popup HTML in every case so the window always
// closes and the opener is notified.
api.get('/auth/google/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  const oauthError = c.req.query('error');

  if (oauthError) {
    return c.html(oauthPopupHtml({ type: 'google-oauth-error', error: oauthError.slice(0, 80) }));
  }
  if (!code || !state) {
    return c.html(oauthPopupHtml({ type: 'google-oauth-error', error: 'missing_params' }));
  }

  const payload = await verifyOAuthState(c.env.SECRETS_KEY, state);
  const tenantId = typeof payload?.tenantId === 'string' ? payload.tenantId : null;
  if (!tenantId) {
    return c.html(oauthPopupHtml({ type: 'google-oauth-error', error: 'invalid_state' }));
  }
  try {
    assertUuid(tenantId, 'tenant');
  } catch {
    return c.html(oauthPopupHtml({ type: 'google-oauth-error', error: 'invalid_state' }));
  }

  const clientId = c.env.GOOGLE_CLIENT_ID;
  const clientSecret = c.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return c.html(oauthPopupHtml({ type: 'google-oauth-error', error: 'oauth_not_configured' }));
  }

  let tokens;
  try {
    tokens = await exchangeCodeForTokens({ code, clientId, clientSecret });
  } catch (e) {
    console.error('[oauth/google] token exchange failed:', (e as Error).message);
    return c.html(oauthPopupHtml({ type: 'google-oauth-error', error: 'token_exchange_failed' }));
  }

  const email = await fetchGoogleEmail(tokens.access_token);
  const scopes = tokens.scope ? tokens.scope.split(' ') : GOOGLE_SCOPES;
  const db = makeDb(c.env.DATABASE_URL);

  // A usable grant needs a refresh token (access_type=offline + prompt=consent
  // normally guarantees one). If Google omits it AND there's no stored refresh
  // token to fall back on, refuse to write — otherwise the row would look
  // "connected" forever while the ~1h access token expires and the nightly sync
  // silently skips. The user revokes prior access (myaccount.google.com) and
  // reconnects to obtain a fresh refresh token.
  if (!tokens.refresh_token) {
    const existing = await loadSecret(db, tenantId, GOOGLE_PLATFORM, c.env.SECRETS_KEY);
    if (!existing?.refreshToken) {
      return c.html(oauthPopupHtml({ type: 'google-oauth-error', error: 'no_refresh_token' }));
    }
    // else: a re-consent that reused an existing grant — storeGoogleCredential's
    // COALESCE keeps the stored refresh token.
  }

  try {
    await storeGoogleCredential({
      db,
      tenantId,
      secretsKey: c.env.SECRETS_KEY,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
      expiresInSec: tokens.expires_in,
      email,
      scopes,
    });
  } catch (e) {
    console.error('[oauth/google] store failed:', (e as Error).message);
    return c.html(oauthPopupHtml({ type: 'google-oauth-error', error: 'store_failed' }));
  }

  bustConnectionCache(tenantId, GOOGLE_PLATFORM);
  return c.html(oauthPopupHtml({ type: 'google-oauth-success', account: email, scopes }));
});

// POST /api/debug/sync-gsc — manually trigger the GSC keyword sync for the
// tenant (X-Tenant-ID header) and report verification status. Surfaces the
// verified-site list so an unverified property (the usual cause of a 403) is
// obvious: the sync silently skips a site it can't read, so we diagnose it here.
api.post('/debug/sync-gsc', async (c) => {
  const tenantId = tenantOf(c);
  if (!tenantId) return err(c, 400, 'missing_tenant', 'Valid X-Tenant-ID header required');

  const env = c.env as unknown as MetricsEnv;
  const clientId = c.env.GOOGLE_CLIENT_ID;
  const clientSecret = c.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return err(c, 500, 'oauth_not_configured', 'GOOGLE_CLIENT_ID/SECRET are not set on the Worker');
  }

  const db = makeDb(c.env.DATABASE_URL);
  const secret = await loadSecret(db, tenantId, GOOGLE_PLATFORM, c.env.SECRETS_KEY);
  if (!secret?.refreshToken) {
    return err(c, 400, 'not_connected', 'Google is not connected for this tenant — connect it in Settings → Platforms first.');
  }

  // Refresh the (stale) stored access token before any API call.
  let accessToken: string;
  try {
    accessToken = await refreshGoogleAccessToken({
      db,
      tenantId,
      secret,
      secretsKey: c.env.SECRETS_KEY,
      clientId,
      clientSecret,
    });
  } catch (e) {
    return err(c, 502, 'token_refresh_failed', `${(e as Error).message} — try disconnecting and reconnecting Google.`);
  }

  // The tenant's sites and which are verified in GSC (from the /sites list).
  const sites = await withTenantDb(db, tenantId, async (tx) => {
    const r = await tx.execute<Row>(sql`SELECT id, domain FROM marketing.sites WHERE tenant_id = ${tenantId}`);
    return r.rows;
  });

  let verifiedSites: Array<{ url: string; permission: string }> = [];
  try {
    const adapter = new GscAdapter({
      accessToken,
      refreshToken: secret.refreshToken,
      extra: { clientId, clientSecret },
    });
    const q = await adapter.quotaState();
    verifiedSites = (q.details.verifiedSites as Array<{ url: string; permission: string }>) ?? [];
  } catch (e) {
    if (e instanceof AdapterHttpError) {
      return err(c, 502, 'gsc_error', `Search Console responded ${e.status}. Reconnect Google or check API access.`);
    }
    return err(c, 502, 'gsc_unreachable', `Could not reach Search Console: ${(e as Error).message}`);
  }

  // Exact match against what the sync actually queries (toGscSiteUrl → the
  // URL-prefix form) plus the domain-property form — an unanchored substring
  // would falsely "verify" an unrelated property like https://myapire.io/.
  const siteStatus = sites.map((s) => {
    const domain = String(s.domain);
    const want = toGscSiteUrl(domain);
    return {
      domain,
      verified: verifiedSites.some((v) => v.url === want || v.url === `sc-domain:${domain}`),
    };
  });
  const unverified = siteStatus.filter((s) => !s.verified).map((s) => s.domain);

  // Run the real sync (idempotent upsert). It logs + skips per-site failures, so
  // the count reflects only sites it could read.
  let synced = 0;
  let syncError: string | null = null;
  try {
    synced = await syncGscKeywords(env, db, tenantId);
  } catch (e) {
    syncError = e instanceof Error ? e.message : String(e);
  }

  return c.json({
    connected: true,
    account: googleCredentialFromSecretEmail(secret),
    verifiedSites,
    siteStatus,
    synced,
    syncError,
    ...(unverified.length
      ? {
          warning: `Not verified in Google Search Console: ${unverified.join(', ')}. Add the property at search.google.com/search-console (use the same Google account you connected), then re-run this sync.`,
        }
      : {}),
  });
});

/** Pull the account email out of a loaded Google secret's profile map. */
function googleCredentialFromSecretEmail(secret: { profileMap: Record<string, string> | null }): string | null {
  const email = secret.profileMap?.email;
  return typeof email === 'string' ? email : null;
}

// ── GET /api/connections ────────────────────────────────────────────
api.get('/connections', async (c) => {
  const tenantId = tenantOf(c);
  if (!tenantId) return err(c, 400, 'missing_tenant', 'Valid X-Tenant-ID header required');
  const db = makeDb(c.env.DATABASE_URL);
  const key = c.env.SECRETS_KEY;

  const rows = await withTenantDb(db, tenantId, async (tx) => {
    const r = await tx.execute<Row>(sql`
      SELECT platform, updated_at, encrypted_access_token, encrypted_profile_map, scopes
      FROM marketing.tenant_secrets
      WHERE tenant_id = ${tenantId}
    `);
    return r.rows;
  });
  const bySecret = new Map<string, Row>();
  for (const s of rows) bySecret.set(String(s.platform).toLowerCase(), s);

  const site = await findFirstSiteForTenant(db, tenantId);
  const tenantDomain = site?.domain ?? null;

  const connections = await Promise.all(
    CONNECTION_PLATFORMS.map(async (p) => {
      const row = bySecret.get(p.secretPlatform);
      const cipher = (row?.encrypted_access_token as string | null) ?? null;
      const hasCred = !!cipher;
      const lastSyncAt = (row?.updated_at as string | null) ?? null;
      // Surface Buffer's channel→id map so the connect modal can show what's
      // already mapped. Decrypted here because the row carries it whether or not
      // a token is currently present (the map survives a disconnect).
      let profileMap: Record<string, string> | undefined;
      if (p.id === 'buffer') {
        const pmCipher = (row?.encrypted_profile_map as string | null) ?? null;
        if (pmCipher) {
          try {
            profileMap = JSON.parse(await decryptSecret(pmCipher, key));
          } catch {
            profileMap = undefined; // rotated key / malformed — omit
          }
        }
      }
      const base = {
        platform: p.id,
        connectionType: p.type,
        canConnect: p.canConnect,
        lastSyncAt,
        ...(profileMap ? { profileMap } : {}),
      };

      // Managed/OAuth platforms: connected = a credential exists (no live call).
      if (!p.probe) {
        // Google (OAuth): surface the stored account email + granted scopes so
        // the card can render "Connected · email" and the active sub-services,
        // without hitting Google on every dashboard load.
        let account: string | null = null;
        let scopes: string[] | undefined;
        if (p.id === 'google' && hasCred) {
          scopes = (row?.scopes as string[] | null) ?? [];
          const pmCipher = (row?.encrypted_profile_map as string | null) ?? null;
          if (pmCipher) {
            try {
              const pm = JSON.parse(await decryptSecret(pmCipher, key)) as { email?: string };
              account = typeof pm.email === 'string' ? pm.email : null;
            } catch {
              account = null; // rotated key / malformed — still connected, no label
            }
          }
        }
        return {
          ...base,
          connected: hasCred,
          account,
          lastValidated: hasCred ? lastSyncAt : null,
          ...(scopes !== undefined ? { scopes } : {}),
        };
      }
      if (!hasCred) {
        return { ...base, connected: false, account: null, lastValidated: null };
      }

      const ck = connCacheKey(tenantId, p.id);
      const cached = CONNECTION_CACHE.get(ck);
      if (cached && cached.expires > Date.now()) {
        return { ...base, ...cached.value };
      }

      let value: CachedStatus;
      try {
        const token = await decryptSecret(cipher as string, key);
        const probe = await probePlatform(p.id, token);
        if (probe.status === 'valid') {
          value = { connected: true, account: probe.account, lastValidated: new Date().toISOString() };
        } else if (probe.status === 'invalid') {
          value = { connected: false, account: null, lastValidated: null };
        } else {
          // Credential exists but validation couldn't complete — keep it
          // connected with an uncertain (null) lastValidated rather than flapping.
          value = { connected: true, account: null, lastValidated: null };
        }
        if (p.id === 'sendgrid' && value.connected) {
          const ds = await sendgridDomainStatus(token, tenantDomain);
          value.domain = tenantDomain;
          value.domainRegistered = ds?.registered ?? false;
          value.domainVerified = ds?.verified ?? false;
        }
      } catch {
        // Credential exists but the validation threw → assume connected, uncertain.
        value = { connected: true, account: null, lastValidated: null };
      }
      CONNECTION_CACHE.set(ck, { value, expires: Date.now() + CONNECTION_TTL_MS });
      return { ...base, ...value };
    }),
  );

  return c.json({ connections });
});

// ── POST /api/connections/:platform/connect ─────────────────────────
// Validate an API key with a live call, then encrypt + store it. The raw key
// only exists in memory for the validation; the DB only ever sees ciphertext.
api.post('/connections/:platform/connect', async (c) => {
  const tenantId = tenantOf(c);
  if (!tenantId) return err(c, 400, 'missing_tenant', 'Valid X-Tenant-ID header required');
  const platform = c.req.param('platform').toLowerCase();
  if (!API_KEY_PLATFORMS.has(platform)) {
    return err(c, 422, 'unsupported_platform', `${platform} cannot be connected with an API key`);
  }
  const body = await c.req.json<Record<string, any>>().catch(() => null);
  const apiKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : '';
  if (!apiKey) return err(c, 422, 'missing_api_key', 'apiKey is required');
  const label = PLATFORM_LABEL[platform];

  // 1. Validate the raw key with a live call BEFORE storing anything.
  let probe: ProbeResult;
  try {
    probe = await probePlatform(platform, apiKey);
  } catch {
    probe = { status: 'uncertain', account: null };
  }
  if (probe.status === 'invalid') {
    return err(c, 400, 'invalid_credential', `That ${label} key was rejected — double-check it and try again.`);
  }
  if (probe.status === 'uncertain') {
    return err(c, 400, 'validation_unavailable', `Couldn't reach ${label} to validate the key. Try again in a moment.`);
  }

  const db = makeDb(c.env.DATABASE_URL);
  const key = c.env.SECRETS_KEY;

  // 2. Buffer publishes through per-channel ids; merge any provided profile map
  //    into the existing one so a partial update never drops other channels' ids.
  let profileMapCipher: string | null = null;
  if (platform === 'buffer' && body?.profileMap && typeof body.profileMap === 'object') {
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(body.profileMap as Record<string, unknown>)) {
      if (typeof v === 'string' && v.trim()) clean[k.toLowerCase().trim()] = v.trim();
    }
    if (Object.keys(clean).length) {
      // Read the map directly (not loadSecret) so it survives a reconnect right
      // after a disconnect, when the access token has been cleared.
      const existing = await loadProfileMap(db, tenantId, 'buffer', key);
      const merged = { ...(existing ?? {}), ...clean };
      profileMapCipher = await encryptSecret(JSON.stringify(merged), key);
    }
  }

  // 3. Encrypt + store. The raw key leaves memory here only as ciphertext.
  const cipher = await encryptSecret(apiKey, key);
  await withTenantDb(db, tenantId, async (tx) => {
    await tx.execute(sql`
      INSERT INTO marketing.tenant_secrets
        (tenant_id, platform, encrypted_access_token, encrypted_profile_map, updated_at)
      VALUES (${tenantId}, ${platform}, ${cipher}, ${profileMapCipher}, now())
      ON CONFLICT (tenant_id, platform) DO UPDATE SET
        encrypted_access_token = EXCLUDED.encrypted_access_token,
        encrypted_profile_map = COALESCE(EXCLUDED.encrypted_profile_map, marketing.tenant_secrets.encrypted_profile_map),
        updated_at = now()
    `);
  });
  bustConnectionCache(tenantId, platform);

  return c.json({ ok: true, account: probe.account, message: `${label} connected` });
});

// ── POST /api/connections/:platform/disconnect ──────────────────────
api.post('/connections/:platform/disconnect', async (c) => {
  const tenantId = tenantOf(c);
  if (!tenantId) return err(c, 400, 'missing_tenant', 'Valid X-Tenant-ID header required');
  const platform = c.req.param('platform').toLowerCase();
  if (!DISCONNECTABLE_PLATFORMS.has(platform)) {
    return err(c, 422, 'unsupported_platform', `${platform} cannot be disconnected here`);
  }
  const body = await c.req.json<Record<string, any>>().catch(() => null);
  if (body?.confirm !== true) {
    return err(c, 400, 'confirmation_required', 'Set confirm:true to disconnect');
  }
  const db = makeDb(c.env.DATABASE_URL);
  // Clear the credential but PRESERVE encrypted_profile_map. The map is
  // non-secret channel→id config (Buffer); deleting the whole row here used to
  // wipe the LinkedIn channel mapping, so a later reconnect (api key only) came
  // back with no targets and publishes failed with "No Buffer channel/profile id
  // mapped". Nulling just the token marks the platform disconnected (connected =
  // a token exists) while the mapping survives for the next reconnect.
  await withTenantDb(db, tenantId, async (tx) => {
    await tx.execute(sql`
      UPDATE marketing.tenant_secrets
      SET encrypted_access_token = NULL,
          encrypted_refresh_token = NULL,
          token_expires_at = NULL,
          scopes = NULL,
          updated_at = now()
      WHERE tenant_id = ${tenantId} AND platform = ${platform}
    `);
  });
  bustConnectionCache(tenantId, platform);
  return c.json({ ok: true });
});

// ── GET /api/connections/sendgrid/domain-auth ───────────────────────
// The CNAME records Baran adds to his sending domain. SendGrid stores domain
// authentications account-wide; we match the tenant's site domain. If it isn't
// registered yet we register it (subdomain "em", automatic security) so there
// are records to hand back. Only fired when the dashboard opens the modal.
function sgRecord(r: { type?: string; host?: string; data?: string; valid?: boolean } | undefined | null) {
  if (!r) return null;
  return {
    type: (r.type ?? 'cname').toUpperCase(),
    name: r.host ?? '',
    value: r.data ?? '',
    valid: r.valid === true,
  };
}

api.get('/connections/sendgrid/domain-auth', async (c) => {
  const tenantId = tenantOf(c);
  if (!tenantId) return err(c, 400, 'missing_tenant', 'Valid X-Tenant-ID header required');
  const db = makeDb(c.env.DATABASE_URL);
  const token = await loadPlatformToken(db, tenantId, 'sendgrid', c.env.SECRETS_KEY);
  if (!token) return err(c, 400, 'not_connected', 'SendGrid is not connected');
  const site = await findFirstSiteForTenant(db, tenantId);
  const domain = site?.domain ?? null;
  if (!domain) return err(c, 422, 'no_domain', 'Tenant has no site domain');

  let list: Array<Record<string, any>>;
  try {
    const res = await fetch('https://api.sendgrid.com/v3/whitelabel/domains?limit=50', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return err(c, 502, 'sendgrid_error', `SendGrid responded ${res.status}`);
    const j = await res.json().catch(() => null);
    list = Array.isArray(j) ? j : [];
  } catch {
    return err(c, 502, 'sendgrid_unreachable', 'Could not reach SendGrid');
  }

  let domainAuth = list.find((d) => d.domain === domain);
  if (!domainAuth) {
    try {
      const res = await fetch('https://api.sendgrid.com/v3/whitelabel/domains', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, subdomain: 'em', automatic_security: true }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) return err(c, 502, 'sendgrid_create_failed', `SendGrid could not register ${domain}`);
      domainAuth = j as Record<string, any>;
    } catch {
      return err(c, 502, 'sendgrid_unreachable', 'Could not reach SendGrid');
    }
  }

  const dns = (domainAuth?.dns ?? {}) as Record<string, any>;
  return c.json({
    domain,
    id: domainAuth?.id ?? null,
    registered: true,
    verified: domainAuth?.valid === true,
    records: {
      mail: sgRecord(dns.mail_cname),
      dkim1: sgRecord(dns.dkim1),
      dkim2: sgRecord(dns.dkim2),
    },
  });
});

// ── POST /api/connections/sendgrid/verify-domain ────────────────────
// Asks SendGrid to re-check the domain's DNS now (after Baran adds the records).
api.post('/connections/sendgrid/verify-domain', async (c) => {
  const tenantId = tenantOf(c);
  if (!tenantId) return err(c, 400, 'missing_tenant', 'Valid X-Tenant-ID header required');
  const db = makeDb(c.env.DATABASE_URL);
  const token = await loadPlatformToken(db, tenantId, 'sendgrid', c.env.SECRETS_KEY);
  if (!token) return err(c, 400, 'not_connected', 'SendGrid is not connected');
  const site = await findFirstSiteForTenant(db, tenantId);
  const domain = site?.domain ?? null;
  if (!domain) return err(c, 422, 'no_domain', 'Tenant has no site domain');

  let domainId: number | null = null;
  try {
    const res = await fetch('https://api.sendgrid.com/v3/whitelabel/domains?limit=50', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const j = await res.json().catch(() => null);
    const hit = Array.isArray(j) ? j.find((d: Record<string, any>) => d.domain === domain) : null;
    domainId = hit?.id ?? null;
  } catch {
    return err(c, 502, 'sendgrid_unreachable', 'Could not reach SendGrid');
  }
  if (!domainId) {
    return err(c, 400, 'not_registered', `${domain} isn't registered in SendGrid yet — open the domain auth guide first`);
  }

  try {
    const res = await fetch(`https://api.sendgrid.com/v3/whitelabel/domains/${domainId}/validate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    const j = (await res.json().catch(() => null)) as
      | { valid?: boolean; validation_results?: unknown }
      | null;
    bustConnectionCache(tenantId, 'sendgrid');
    return c.json({
      domain,
      valid: j?.valid === true,
      validationResults: j?.validation_results ?? null,
    });
  } catch {
    return err(c, 502, 'sendgrid_unreachable', 'Could not reach SendGrid');
  }
});

// ── POST /api/generate ──────────────────────────────────────────────
// Trigger the GenerationWorkflow for a campaign. Powers the dashboard
// "Generate more content" button and the campaign card's generate action.
// Returns immediately with the workflow instance id; drafts appear in the
// queue as the pipeline completes.

api.post('/generate', async (c) => {
  const tenantId = tenantOf(c);
  if (!tenantId) return err(c, 400, 'missing_tenant', 'Valid X-Tenant-ID header required');

  const body = await c.req.json<Record<string, any>>().catch(() => null);
  if (!body || !body.campaignId) return err(c, 422, 'bad_input', 'campaignId is required');
  try {
    assertUuid(body.campaignId, 'campaignId');
  } catch {
    return err(c, 422, 'bad_campaign_id', 'campaignId must be a UUID');
  }

  const triggerReason: TriggerReason = TRIGGER_REASONS.has(body.triggerReason)
    ? body.triggerReason
    : 'manual';
  const channels = Array.isArray(body.channels)
    ? body.channels.map((s: unknown) => String(s).toLowerCase())
    : undefined;

  const params: GenerationParams = {
    tenantId,
    campaignId: body.campaignId,
    triggerReason,
    channels,
  };
  const env = c.env as unknown as PipelineEnv;

  try {
    if (env.GENERATION_WORKFLOW) {
      const instance = await env.GENERATION_WORKFLOW.create({ params });
      return c.json({ workflowId: instance.id, message: 'Generation started' });
    }
    // No workflow binding (some local-dev setups): run inline out-of-band.
    c.executionCtx.waitUntil(
      runGenerationPipeline(env, params).catch((e) =>
        console.error('[api/generate] inline pipeline failed:', e instanceof Error ? e.message : e),
      ),
    );
    return c.json({ workflowId: 'inline', message: 'Generation started (inline)' });
  } catch (e) {
    return err(c, 500, 'generate_failed', (e as Error).message);
  }
});

// ── POST /api/publish/:draftId ──────────────────────────────────────
// Immediate publish of a single approved draft (bypasses the 15-min cron).
// Returns the live adapter result — or the exact failure reason.

api.post('/publish/:draftId', async (c) => {
  const tenantId = tenantOf(c);
  if (!tenantId) return err(c, 400, 'missing_tenant', 'Valid X-Tenant-ID header required');
  const draftId = c.req.param('draftId');
  try {
    assertUuid(draftId, 'draftId');
  } catch {
    return err(c, 422, 'bad_id', 'draftId must be a UUID');
  }

  const env = c.env as unknown as PipelineEnv;
  let outcome;
  try {
    outcome = await publishSingleDraft(env, tenantId, draftId);
  } catch (e) {
    return err(c, 500, 'publish_failed', (e as Error).message);
  }
  if (!outcome.found) return err(c, 404, 'not_found', 'Draft not found');

  return c.json(
    {
      draftId,
      channel: outcome.channel,
      status: outcome.status === 'published' ? 'published' : 'failed',
      published_ref: outcome.publishedRef ?? null,
      error: outcome.error ?? null,
    },
    outcome.status === 'published' ? 200 : 422,
  );
});

// ── GET /api/queue-status ───────────────────────────────────────────
// Header stats bar for the review queue.

api.get('/queue-status', async (c) => {
  const tenantId = tenantOf(c);
  if (!tenantId) return err(c, 400, 'missing_tenant', 'Valid X-Tenant-ID header required');

  const db = makeDb(c.env.DATABASE_URL);
  const row = await withTenantDb(db, tenantId, async (tx) => {
    const r = await tx.execute<Row>(sql`
      SELECT
        count(*) FILTER (WHERE status = 'pending_review')                         AS pending,
        count(*) FILTER (WHERE status = 'approved')                               AS approved,
        count(*) FILTER (WHERE status = 'scheduled')                              AS scheduled,
        count(*) FILTER (WHERE status = 'failed')                                 AS failed,
        (SELECT count(*) FROM marketing.publish_log
           WHERE tenant_id = ${tenantId}
             AND published_at >= date_trunc('day', now()))                        AS published_today
      FROM marketing.content_drafts
      WHERE tenant_id = ${tenantId}
    `);
    return r.rows[0];
  });

  return c.json({
    pending: Number(row?.pending ?? 0),
    approved: Number(row?.approved ?? 0),
    scheduled: Number(row?.scheduled ?? 0),
    published_today: Number(row?.published_today ?? 0),
    failed: Number(row?.failed ?? 0),
  });
});

// ── GET /api/intelligence ───────────────────────────────────────────
// Latest weekly intelligence brief for the tenant — powers the
// "This week's topics" card on the campaigns page. Returns { brief: null }
// when none has been generated yet.

function normalizeBrief(r: Row | null) {
  if (!r) return null;
  return {
    id: r.id,
    weekOf: r.week_of,
    status: r.status,
    generatedAt: r.generated_at,
    topics: Array.isArray(r.topics) ? r.topics : [],
  };
}

api.get('/intelligence', async (c) => {
  const tenantId = tenantOf(c);
  if (!tenantId) return err(c, 400, 'missing_tenant', 'Valid X-Tenant-ID header required');

  const db = makeDb(c.env.DATABASE_URL);
  const row = await withTenantDb(db, tenantId, async (tx) => {
    const r = await tx.execute<Row>(sql`
      SELECT id, week_of, topics, status, generated_at
      FROM marketing.intelligence_briefs
      WHERE tenant_id = ${tenantId}
      ORDER BY week_of DESC
      LIMIT 1
    `);
    return r.rows[0] ?? null;
  });

  return c.json({ brief: normalizeBrief(row) });
});

// ── POST /api/intelligence/refresh ──────────────────────────────────
// Re-runs the weekly research for the current week on demand (the card's
// "Refresh" button). Awaits the live model + web-search call and returns the
// fresh brief.

api.post('/intelligence/refresh', async (c) => {
  const tenantId = tenantOf(c);
  if (!tenantId) return err(c, 400, 'missing_tenant', 'Valid X-Tenant-ID header required');

  const db = makeDb(c.env.DATABASE_URL);
  try {
    const result = await generateWeeklyIntelligenceBrief({ db, tenantId });
    const row = await withTenantDb(db, tenantId, async (tx) => {
      const r = await tx.execute<Row>(sql`
        SELECT id, week_of, topics, status, generated_at
        FROM marketing.intelligence_briefs
        WHERE id = ${result.briefId} AND tenant_id = ${tenantId} LIMIT 1
      `);
      return r.rows[0] ?? null;
    });
    return c.json({ brief: normalizeBrief(row) });
  } catch (e) {
    return err(c, 500, 'intelligence_failed', (e as Error).message);
  }
});

// ── Recommendations ─────────────────────────────────────────────────
// The "tells me what to do" layer. The nightly job (src/jobs/recommendations.ts)
// writes up to 5 ranked, data-backed actions per tenant per week; these routes
// surface this week's pending set, let the dashboard refresh on demand (awaits a
// live Sonnet call, ~5-10s), and mark a recommendation actioned/dismissed.

function normalizeRecommendation(r: Row) {
  return {
    id: r.id,
    type: r.type,
    title: r.title,
    description: r.description,
    reasoning: r.reasoning,
    actionType: r.action_type,
    actionParams: (r.action_params ?? {}) as Record<string, unknown>,
    priorityScore: Number(r.priority_score ?? 5),
    dataSnapshot: (r.data_snapshot ?? {}) as Record<string, unknown>,
    status: r.status,
    weekOf: r.week_of,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
  };
}

const RECOMMENDATION_STATUSES = new Set(['pending', 'actioned', 'dismissed']);

// GET /api/recommendations — this week's pending, non-expired set (top 5 by priority).
api.get('/recommendations', async (c) => {
  const tenantId = tenantOf(c);
  if (!tenantId) return err(c, 400, 'missing_tenant', 'Valid X-Tenant-ID header required');

  const db = makeDb(c.env.DATABASE_URL);
  const rows = await withTenantDb(db, tenantId, async (tx) => {
    const r = await tx.execute<Row>(sql`
      SELECT id, type, title, description, reasoning, action_type, action_params,
             priority_score, data_snapshot, status, week_of, expires_at, created_at
      FROM marketing.recommendations
      WHERE tenant_id = ${tenantId}
        AND status = 'pending'
        AND expires_at >= now()
      ORDER BY priority_score DESC, created_at ASC
      LIMIT 5
    `);
    return r.rows;
  });

  return c.json({ recommendations: rows.map(normalizeRecommendation) });
});

// POST /api/recommendations/refresh — re-run the engine for this tenant now.
api.post('/recommendations/refresh', async (c) => {
  const tenantId = tenantOf(c);
  if (!tenantId) return err(c, 400, 'missing_tenant', 'Valid X-Tenant-ID header required');

  const db = makeDb(c.env.DATABASE_URL);
  try {
    const result = await generateRecommendations({ db, tenantId });
    if (result.skipped) {
      return c.json({ recommendations: [], skipped: true, reason: result.reason ?? 'insufficient_data' });
    }
    const rows = await withTenantDb(db, tenantId, async (tx) => {
      const r = await tx.execute<Row>(sql`
        SELECT id, type, title, description, reasoning, action_type, action_params,
               priority_score, data_snapshot, status, week_of, expires_at, created_at
        FROM marketing.recommendations
        WHERE tenant_id = ${tenantId}
          AND status = 'pending'
          AND expires_at >= now()
        ORDER BY priority_score DESC, created_at ASC
        LIMIT 5
      `);
      return r.rows;
    });
    return c.json({ recommendations: rows.map(normalizeRecommendation), skipped: false });
  } catch (e) {
    return err(c, 500, 'recommendations_failed', (e as Error).message);
  }
});

// PATCH /api/recommendations/:id — mark actioned | dismissed.
api.patch('/recommendations/:id', async (c) => {
  const tenantId = tenantOf(c);
  if (!tenantId) return err(c, 400, 'missing_tenant', 'Valid X-Tenant-ID header required');

  const id = c.req.param('id');
  try {
    assertUuid(id, 'id');
  } catch {
    return err(c, 422, 'bad_id', 'recommendation id must be a UUID');
  }

  const body = await c.req.json<Record<string, any>>().catch(() => null);
  const status = typeof body?.status === 'string' ? body.status : '';
  if (!RECOMMENDATION_STATUSES.has(status)) {
    return err(c, 422, 'bad_status', 'status must be pending, actioned, or dismissed');
  }

  const db = makeDb(c.env.DATABASE_URL);
  const updated = await withTenantDb(db, tenantId, async (tx) => {
    const r = await tx.execute<Row>(sql`
      UPDATE marketing.recommendations
      SET status = ${status}::marketing.recommendation_status
      WHERE id = ${id} AND tenant_id = ${tenantId}
      RETURNING id
    `);
    return r.rows[0] ?? null;
  });
  if (!updated) return err(c, 404, 'not_found', 'recommendation not found');

  return c.json({ ok: true, id, status });
});

// ── Analytics ───────────────────────────────────────────────────────
// Real performance data for the Analytics dashboard. Effective publish date is
// COALESCE(publish_log.published_at, publish_at, updated_at) because V1 records
// the canonical publish time in publish_log, not on content_drafts. Channels are
// normalised (twitter → x, wix-blog → blog) so the four main channels aggregate
// cleanly.

const CHANNEL_NORM = sql`CASE
  WHEN lower(cd.channel) IN ('x', 'twitter') THEN 'x'
  WHEN lower(cd.channel) IN ('blog', 'wix-blog') THEN 'blog'
  ELSE lower(cd.channel)
END`;

const EFFECTIVE_PUBLISHED_AT = sql`COALESCE(
  (SELECT max(pl.published_at) FROM marketing.publish_log pl WHERE pl.draft_id = cd.id),
  cd.publish_at, cd.updated_at
)`;

function previewOf(payload: Record<string, any>): string {
  const t = payload.title ?? payload.subject ?? payload.text ?? payload.excerpt ?? '';
  const s = typeof t === 'string' ? t.trim() : '';
  return s.length > 90 ? `${s.slice(0, 90)}…` : s;
}

// GET /api/analytics/summary — stat cards + 14-day chart + channel performance.
api.get('/analytics/summary', async (c) => {
  const tenantId = tenantOf(c);
  if (!tenantId) return err(c, 400, 'missing_tenant', 'Valid X-Tenant-ID header required');

  const db = makeDb(c.env.DATABASE_URL);
  const data = await withTenantDb(db, tenantId, async (tx) => {
    const counts = await tx.execute<Row>(sql`
      SELECT
        count(*) FILTER (WHERE status = 'pending_review')                 AS pending,
        count(*) FILTER (WHERE status IN ('published', 'measured'))       AS published,
        avg((payload->>'guardianScore')::numeric)
          FILTER (WHERE payload ? 'guardianScore')                        AS avg_guardian
      FROM marketing.content_drafts
      WHERE tenant_id = ${tenantId}
    `);

    // Posts published per day per channel over the last 14 days.
    const byDay = await tx.execute<Row>(sql`
      SELECT to_char(date_trunc('day', ${EFFECTIVE_PUBLISHED_AT}), 'YYYY-MM-DD') AS day,
             ${CHANNEL_NORM} AS channel,
             count(*)::int AS n
      FROM marketing.content_drafts cd
      WHERE cd.tenant_id = ${tenantId}
        AND cd.status IN ('published', 'measured')
        AND ${EFFECTIVE_PUBLISHED_AT} >= now() - interval '14 days'
      GROUP BY day, channel
      ORDER BY day
    `);

    // Channel performance — posts + avg impressions + engagement rate, from
    // content_metrics aggregated per draft (MAX across windows) then per channel.
    const channelPerf = await tx.execute<Row>(sql`
      WITH per_draft AS (
        SELECT cd.id, ${CHANNEL_NORM} AS channel,
               COALESCE(max(cm.impressions), 0) AS impressions,
               COALESCE(max(cm.clicks), 0) AS clicks,
               COALESCE(max(cm.engagement), 0) AS engagement,
               bool_or(cm.id IS NOT NULL) AS has_metrics
        FROM marketing.content_drafts cd
        LEFT JOIN marketing.content_metrics cm ON cm.draft_id = cd.id
        WHERE cd.tenant_id = ${tenantId}
          AND cd.status IN ('published', 'measured')
        GROUP BY cd.id, channel
      )
      SELECT channel,
             count(*)::int AS posts,
             round(avg(impressions))::int AS avg_impressions,
             round(avg(engagement))::int AS avg_engagement,
             CASE WHEN sum(impressions) > 0
                  THEN round(sum(engagement)::numeric / sum(impressions), 4)
                  ELSE 0 END AS engagement_rate
      FROM per_draft
      GROUP BY channel
    `);

    return { counts: counts.rows[0], byDay: byDay.rows, channelPerf: channelPerf.rows };
  });

  const channelOrder = ['linkedin', 'blog', 'x', 'email'];
  const perfByChannel = new Map<string, Row>();
  for (const r of data.channelPerf) perfByChannel.set(String(r.channel), r);

  return c.json({
    pending_count: Number(data.counts?.pending ?? 0),
    published_count: Number(data.counts?.published ?? 0),
    avg_guardian:
      data.counts?.avg_guardian != null ? Number(Number(data.counts.avg_guardian).toFixed(2)) : null,
    published_by_day: data.byDay.map((r) => ({
      day: r.day,
      channel: r.channel,
      count: Number(r.n),
    })),
    channel_performance: channelOrder.map((ch) => {
      const r = perfByChannel.get(ch);
      return {
        channel: ch,
        posts: Number(r?.posts ?? 0),
        avgImpressions: Number(r?.avg_impressions ?? 0),
        avgEngagement: Number(r?.avg_engagement ?? 0),
        engagementRate: Number(r?.engagement_rate ?? 0),
      };
    }),
  });
});

// GET /api/analytics/top-content — top 10 published drafts by performance_score
// (falling back to impressions when unscored).
api.get('/analytics/top-content', async (c) => {
  const tenantId = tenantOf(c);
  if (!tenantId) return err(c, 400, 'missing_tenant', 'Valid X-Tenant-ID header required');

  const db = makeDb(c.env.DATABASE_URL);
  const rows = await withTenantDb(db, tenantId, async (tx) => {
    const r = await tx.execute<Row>(sql`
      SELECT cd.id, cd.channel, cd.payload, cd.performance_score,
             cd.payload->>'guardianScore' AS guardian_score,
             ${EFFECTIVE_PUBLISHED_AT} AS published_at,
             COALESCE(m.impressions, 0) AS impressions,
             COALESCE(m.clicks, 0) AS clicks,
             COALESCE(m.engagement, 0) AS engagement,
             (m.draft_id IS NOT NULL) AS has_metrics
      FROM marketing.content_drafts cd
      LEFT JOIN LATERAL (
        SELECT cm.draft_id,
               max(cm.impressions) AS impressions,
               max(cm.clicks) AS clicks,
               max(cm.engagement) AS engagement
        FROM marketing.content_metrics cm
        WHERE cm.draft_id = cd.id
        GROUP BY cm.draft_id
      ) m ON true
      WHERE cd.tenant_id = ${tenantId}
        AND cd.status IN ('published', 'measured')
      ORDER BY cd.performance_score DESC NULLS LAST,
               m.impressions DESC NULLS LAST,
               (cd.payload->>'guardianScore')::numeric DESC NULLS LAST
      LIMIT 10
    `);
    return r.rows;
  });

  const hasMetrics = rows.some((r) => r.has_metrics === true);
  return c.json({
    hasMetrics,
    items: rows.map((r) => ({
      id: r.id,
      channel: r.channel,
      preview: previewOf((r.payload ?? {}) as Record<string, any>),
      publishedAt: r.published_at,
      impressions: Number(r.impressions),
      clicks: Number(r.clicks),
      engagement: Number(r.engagement),
      performanceScore: r.performance_score != null ? Number(r.performance_score) : null,
      guardianScore: r.guardian_score != null ? Number(r.guardian_score) : null,
    })),
  });
});

// GET /api/analytics/keywords — top 20 GSC keywords by impressions.
api.get('/analytics/keywords', async (c) => {
  const tenantId = tenantOf(c);
  if (!tenantId) return err(c, 400, 'missing_tenant', 'Valid X-Tenant-ID header required');

  const db = makeDb(c.env.DATABASE_URL);
  const rows = await withTenantDb(db, tenantId, async (tx) => {
    const r = await tx.execute<Row>(sql`
      SELECT query, page_url, impressions, clicks, ctr, position, is_high_performer, week_of
      FROM marketing.gsc_keywords
      WHERE tenant_id = ${tenantId}
      ORDER BY impressions DESC
      LIMIT 20
    `);
    return r.rows;
  });

  return c.json({
    keywords: rows.map((r) => ({
      query: r.query,
      page: r.page_url,
      impressions: Number(r.impressions),
      clicks: Number(r.clicks),
      ctr: r.ctr != null ? Number(r.ctr) : 0,
      position: r.position != null ? Number(r.position) : 0,
      isHighPerformer: r.is_high_performer === true,
      weekOf: r.week_of,
    })),
  });
});

// ── POST /api/generate-now ──────────────────────────────────────────
// One-shot generation from a topic — powers the "Create now" modal on the queue
// page (and the intelligence topic cards). Runs the right generator inline based
// on channel, optionally attaches a paired image, and returns the new draft id.
// Body: { topic, channel?, campaignId?, toneOverride?, generateImage? }.
//   channel defaults to linkedin; generateImage defaults to true.

const SOCIAL_NOW = new Set<string>(SOCIAL_CHANNELS as readonly string[]);
const IMAGE_TYPE_FOR_CHANNEL = (channel: string): ImageType =>
  channel === 'blog' || channel === 'wix-blog'
    ? 'blog_header'
    : channel === 'email'
      ? 'email_header'
      : 'social_square';

async function tenantNameOf(
  db: ReturnType<typeof makeDb>,
  tenantId: string,
): Promise<string> {
  return withTenantDb(db, tenantId, async (tx) => {
    const r = await tx.execute<Row>(
      sql`SELECT name FROM marketing.tenants WHERE id = ${tenantId} LIMIT 1`,
    );
    return (r.rows[0]?.name as string) ?? 'the brand';
  });
}

api.post('/generate-now', async (c) => {
  const tenantId = tenantOf(c);
  if (!tenantId) return err(c, 400, 'missing_tenant', 'Valid X-Tenant-ID header required');

  const body = await c.req.json<Record<string, any>>().catch(() => null);
  const topic = typeof body?.topic === 'string' ? body.topic.trim() : '';
  if (!topic) return err(c, 422, 'bad_input', 'topic is required');

  const channel = (typeof body?.channel === 'string' ? body.channel : 'linkedin').toLowerCase();
  const isBlog = channel === 'blog' || channel === 'wix-blog';
  const isEmail = channel === 'email';
  if (!isBlog && !isEmail && !SOCIAL_NOW.has(channel)) {
    return err(c, 422, 'bad_channel', `Unsupported channel: ${channel}`);
  }

  const voiceModifier =
    typeof body?.toneOverride === 'string' && body.toneOverride.trim()
      ? body.toneOverride.trim()
      : undefined;
  let campaignId: string | null = null;
  if (typeof body?.campaignId === 'string' && body.campaignId) {
    try {
      assertUuid(body.campaignId, 'campaignId');
      campaignId = body.campaignId;
    } catch {
      return err(c, 422, 'bad_campaign_id', 'campaignId must be a UUID');
    }
  }
  const wantImage = body?.generateImage !== false; // default ON

  const db = makeDb(c.env.DATABASE_URL);
  try {
    let draftId: string;
    let guardianScore: number | null = null;

    if (isBlog) {
      const tenantName = await tenantNameOf(db, tenantId);
      const blog = await generateBlog({ db, tenantId, tenantName, topic });
      const guardian = await brandGuardian({ db, tenantId, draftText: blog.body });
      guardianScore = guardian.score;
      const site = await findFirstSiteForTenant(db, tenantId);
      if (!site) return err(c, 422, 'no_site', 'Tenant has no site to attach the draft to');
      draftId = await insertDraft({
        db,
        tenantId,
        siteId: site.id,
        campaignId,
        channel: 'blog',
        payload: {
          kind: 'blog',
          topic,
          title: blog.frontmatter.title,
          slug: blog.frontmatter.slug,
          excerpt: blog.frontmatter.excerpt,
          tags: blog.frontmatter.tags,
          body: blog.body,
          guardianScore: guardian.score,
          guardianNotes: guardian.notes,
          flagged: guardian.flagged,
          sources: blog.sources,
        },
        costCents: estimateTextCostCents(blog.usage),
      });
    } else if (isEmail) {
      const res = await generateEmail({
        db,
        tenantId,
        emailType: 'newsletter',
        topic,
        campaignId,
        voiceModifier,
      });
      if (!res.draftId) return err(c, 500, 'generate_now_failed', 'email produced no draft');
      draftId = res.draftId;
      guardianScore = res.guardianScore;
    } else {
      const res = await generateSocial({ db, tenantId, topic, channel, campaignId, voiceModifier });
      draftId = res.draftId;
      guardianScore = res.guardianScore;
    }

    // Best-effort paired image — never fails the draft creation.
    let imageUrl: string | null = null;
    let imageSkipped: boolean | null = null;
    let imageError: string | null = null;
    if (wantImage) {
      try {
        const img = await generateImage({
          db,
          tenantId,
          draftId,
          imageType: IMAGE_TYPE_FOR_CHANNEL(channel),
          r2: c.env.R2,
          publicBaseUrl: c.env.R2_PUBLIC_BASE_URL,
        });
        imageSkipped = img.skipped;
        imageUrl = img.skipped ? null : img.url;
      } catch (e) {
        imageError = (e as Error).message;
        console.error('[generate-now] image generation failed (non-fatal):', imageError);
      }
    }

    return c.json(
      { draftId, channel, guardianScore, imageGenerated: !!imageUrl, imageSkipped, imageUrl, imageError },
      201,
    );
  } catch (e) {
    return err(c, 500, 'generate_now_failed', (e as Error).message);
  }
});

// ── POST /api/import/buffer-history ─────────────────────────────────
// Import the tenant's already-published Buffer posts (sent + real metrics) as
// `measured` drafts, then score + promote the top performers to golden examples —
// seeding the learning loop with months of real engagement. Powers the Settings
// → Import History tab. Body: { profiles: string[], dryRun?: boolean }.
//
// Runs synchronously and returns the full summary so the UI can show real counts.
// A dry run only fetches + de-dups + counts (no writes). For very large tenants
// (many hundreds of posts) prefer the CLI (scripts/import-buffer-history.mjs),
// which has no 30s Worker CPU limit; the import is idempotent, so a timed-out run
// can simply be re-run to completion.

const IMPORT_CHANNELS = new Set(['linkedin', 'x', 'twitter', 'instagram', 'facebook', 'tiktok', 'pinterest']);

api.post('/import/buffer-history', async (c) => {
  const tenantId = tenantOf(c);
  if (!tenantId) return err(c, 400, 'missing_tenant', 'Valid X-Tenant-ID header required');

  const body = await c.req.json<Record<string, any>>().catch(() => null);
  // Accept `profiles` (task spec) or `channels`; default to LinkedIn.
  const raw = Array.isArray(body?.profiles)
    ? body.profiles
    : Array.isArray(body?.channels)
      ? body.channels
      : ['linkedin'];
  const profiles = [...new Set(raw.map((s: unknown) => String(s).toLowerCase().trim()).filter(Boolean))];
  if (profiles.length === 0) return err(c, 422, 'bad_input', 'profiles must be a non-empty array');
  const badChannel = profiles.find((p) => !IMPORT_CHANNELS.has(p));
  if (badChannel) return err(c, 422, 'bad_channel', `Unsupported channel: ${badChannel}`);
  const dryRun = body?.dryRun === true;

  const db = makeDb(c.env.DATABASE_URL);
  const env = c.env as unknown as MetricsEnv;
  try {
    const summary = await importBufferHistory({ db, env, tenantId, channels: profiles, dryRun });
    return c.json({
      fetched: summary.fetched,
      imported: summary.imported,
      skipped: summary.skipped,
      scored: summary.scored,
      goldenExamples: summary.goldenExamples,
      dryRun: summary.dryRun,
      channels: summary.channels,
      topPerformers: summary.topPerformers,
    });
  } catch (e) {
    return err(c, 500, 'import_failed', (e as Error).message);
  }
});
