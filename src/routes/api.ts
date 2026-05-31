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
import { withTenantDb, assertUuid } from '../lib/tenant.js';
import { brandGuardian } from '../agents/guardian.js';

type ApiEnv = {
  DATABASE_URL: string;
  ANTHROPIC_API_KEY: string;
  OPENAI_API_KEY: string;
  SECRETS_KEY: string;
};

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

export const api = new Hono<{ Bindings: ApiEnv }>();

// Make the worker's bound secrets visible to the Node-style getters in
// lib/ai.ts (anthropic()/openai() read process.env). nodejs_compat gives us a
// mutable process.env in the worker runtime.
api.use('*', async (c, next) => {
  if (c.env.ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = c.env.ANTHROPIC_API_KEY;
  if (c.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = c.env.OPENAI_API_KEY;
  await next();
});

// ── helpers ─────────────────────────────────────────────────────────

function err(c: Context, status: 400 | 401 | 404 | 422 | 500, code: string, message: string) {
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

// ── GET /api/drafts ─────────────────────────────────────────────────

api.get('/drafts', async (c) => {
  const tenantId = tenantOf(c);
  if (!tenantId) return err(c, 400, 'missing_tenant', 'Valid X-Tenant-ID header required');

  const status = c.req.query('status');
  const campaignId = c.req.query('campaign_id');
  const month = c.req.query('month'); // YYYY-MM

  if (status && !DRAFT_STATUSES.has(status))
    return err(c, 422, 'bad_status', `Unknown status: ${status}`);
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
    if (status) conds.push(sql`cd.status = ${status}::marketing.draft_status`);
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
             cd.created_at, cd.updated_at, c.name AS campaign_name
      FROM marketing.content_drafts cd
      LEFT JOIN marketing.campaigns c ON c.id = cd.campaign_id
      WHERE cd.id = ${id} AND cd.tenant_id = ${tenantId} LIMIT 1
    `);
    return r.rows[0];
  });

  return c.json({ draft: normalizeDraft(updated) });
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

// ── POST /api/documents/upload ──────────────────────────────────────
// Stores document metadata and queues ingestion. The R2 write + chunk/embed
// pipeline is wired in V1 (workflows/ingestion.ts); V0 records the row so the
// corpus list reflects the upload immediately.

api.post('/documents/upload', async (c) => {
  const tenantId = tenantOf(c);
  if (!tenantId) return err(c, 400, 'missing_tenant', 'Valid X-Tenant-ID header required');

  const form = await c.req.parseBody().catch(() => null);
  const file = form?.file;
  if (!(file instanceof File)) return err(c, 422, 'no_file', 'multipart "file" field required');

  const filename = file.name;
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const mime =
    file.type ||
    (ext === 'pdf' ? 'application/pdf' : ext === 'md' ? 'text/markdown' : 'text/plain');
  const r2Key = `tenant/${tenantId}/corpus/${filename}`;

  const db = makeDb(c.env.DATABASE_URL);
  const row = await withTenantDb(db, tenantId, async (tx) => {
    const r = await tx.execute<Row>(sql`
      INSERT INTO marketing.documents
        (tenant_id, source, source_filename, document_type, r2_key, mime_type, version)
      VALUES (${tenantId}, 'upload', ${filename}, 'product_doc', ${r2Key}, ${mime}, 1)
      ON CONFLICT (tenant_id, source_filename)
        DO UPDATE SET version = marketing.documents.version + 1,
                      ingested_at = now(), superseded_at = NULL, r2_key = EXCLUDED.r2_key
      RETURNING id, source_filename, document_type, version, ingested_at
    `);
    return r.rows[0];
  });

  return c.json(
    {
      document: {
        id: row.id,
        sourceFilename: row.source_filename,
        documentType: row.document_type,
        version: row.version,
        ingestedAt: row.ingested_at,
        chunkCount: 0,
      },
    },
    201,
  );
});

// ── DELETE /api/documents/:id ───────────────────────────────────────

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
  await withTenantDb(db, tenantId, async (tx) => {
    await tx.execute(sql`
      DELETE FROM marketing.document_chunks
      WHERE document_id = ${id} AND tenant_id = ${tenantId}
    `);
    await tx.execute(sql`
      DELETE FROM marketing.documents WHERE id = ${id} AND tenant_id = ${tenantId}
    `);
  });
  return c.json({ ok: true });
});

// ── GET /api/connections ────────────────────────────────────────────
// Connection status per platform — connected = a tenant_secrets row with a
// non-null access token exists. The OAuth/connect flows are wired later.

const PLATFORMS: Array<{ label: string; keys: string[] }> = [
  { label: 'HubSpot', keys: ['hubspot'] },
  { label: 'SendGrid', keys: ['sendgrid'] },
  { label: 'Buffer', keys: ['buffer'] },
  { label: 'LinkedIn', keys: ['linkedin'] },
  { label: 'X', keys: ['twitter', 'x'] },
  { label: 'Meta', keys: ['meta', 'facebook', 'instagram'] },
  { label: 'TikTok', keys: ['tiktok'] },
  { label: 'Google Analytics', keys: ['ga4', 'google-analytics'] },
  { label: 'Google Search Console', keys: ['gsc'] },
  { label: 'Google Ads', keys: ['google-ads'] },
  { label: 'Google Business Profile', keys: ['gbp'] },
];

api.get('/connections', async (c) => {
  const tenantId = tenantOf(c);
  if (!tenantId) return err(c, 400, 'missing_tenant', 'Valid X-Tenant-ID header required');
  const db = makeDb(c.env.DATABASE_URL);
  const secrets = await withTenantDb(db, tenantId, async (tx) => {
    const r = await tx.execute<Row>(sql`
      SELECT platform, updated_at FROM marketing.tenant_secrets
      WHERE tenant_id = ${tenantId} AND encrypted_access_token IS NOT NULL
    `);
    return r.rows;
  });
  const byKey = new Map<string, Row>();
  for (const s of secrets) byKey.set(String(s.platform).toLowerCase(), s);

  return c.json({
    connections: PLATFORMS.map((p) => {
      const hit = p.keys.map((k) => byKey.get(k)).find(Boolean);
      return {
        platform: p.label,
        connected: !!hit,
        account: null,
        lastSyncAt: hit?.updated_at ?? null,
      };
    }),
  });
});
