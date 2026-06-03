// Cloudflare Worker entry — Hono app for the V0 admin surface.
//
// V0 routes:
//   GET  /                          — health + tenant list
//   GET  /settings/brand-voice      — form (HTML) for the selected tenant
//   POST /settings/brand-voice      — save brand_voice JSON
//
// All other surfaces (approval queue, calendar, analytics, connections) are V1+.

import { Hono } from 'hono';
import { html } from 'hono/html';
import { cors } from 'hono/cors';
import { makeDb } from './db/client.js';
import { findTenantBySlug } from './lib/tenant.js';
import { brandVoicePage, brandVoiceSave } from './routes/settings.js';
import { api } from './routes/api.js';
import { runPublishTick, runGenerationTick, runNightlyTick } from './jobs/scheduler.js';
import type { SchedulerEnv } from './jobs/scheduler.js';
import { runIntelligenceTick } from './jobs/intelligence.js';
import {
  processSendGridWebhookEvents,
  resolveMailSyncDeps,
  verifySendGridSignature,
  SENDGRID_SIGNATURE_HEADER,
  SENDGRID_TIMESTAMP_HEADER,
} from './services/mailsync.js';
import type { SendGridEvent } from './adapters/sendgrid.js';
import { assertUuid } from './lib/tenant.js';

type Env = {
  DATABASE_URL: string;
  OPENAI_API_KEY: string;
  ANTHROPIC_API_KEY: string;
  SENDGRID_WEBHOOK_SECRET: string;
  SECRETS_KEY: string;
  HUBSPOT_EVENT_TEMPLATE_ID?: string;
  IDEOGRAM_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  // GSC OAuth client config — used by the nightly metrics job to refresh the
  // tenant's Google access token before pulling Search Console keyword data.
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  IMAGE_PROVIDER?: string;
  R2_PUBLIC_BASE_URL?: string;
  // R2 bucket binding (wrangler.toml [[r2_buckets]]). Optional so the Node CLI
  // path (no Worker runtime) type-checks; the upload route falls back to local
  // disk when it's absent.
  R2?: R2Bucket;
  ENVIRONMENT?: string;
  // Cloudflare Workflow bindings (see wrangler.toml [[workflows]]).
  GENERATION_WORKFLOW?: import('./workflows/types.js').WorkflowBinding;
  PUBLISH_WORKFLOW?: import('./workflows/types.js').WorkflowBinding;
};

const app = new Hono<{ Bindings: Env }>();

// CORS for the dashboard dev server (Vite proxies /api in dev, but allow direct
// cross-origin access too — e.g. the deployed Pages app hitting the Worker).
app.use(
  '/api/*',
  cors({
    origin: (origin) =>
      /^https?:\/\/localhost:\d+$/.test(origin) || origin.endsWith('.pages.dev')
        ? origin
        : '',
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'X-Tenant-ID'],
  }),
);

// Dashboard JSON API (approval queue, calendar, campaigns, settings).
app.route('/api', api);

app.get('/', async (c) => {
  return c.html(html`<!doctype html>
<html>
  <head><meta charset="utf-8"><title>hailmery</title></head>
  <body style="font-family: system-ui; max-width: 720px; margin: 4em auto; padding: 0 1em">
    <h1>hailmery — V0</h1>
    <p>AI marketing command center. V0 ships the multi-tenant scaffold and the content-quality proof.</p>
    <h2>Tools</h2>
    <ul>
      <li><a href="/settings/brand-voice?tenant=apire">Edit APIRE brand voice</a></li>
      <li><a href="/settings/brand-voice?tenant=osm">Edit OSM brand voice</a></li>
    </ul>
    <p>Use the CLI for content generation: <code>pnpm gen blog --tenant apire "topic"</code></p>
  </body>
</html>`);
});

app.get('/settings/brand-voice', async (c) => {
  const db = makeDb(c.env.DATABASE_URL);
  const slug = c.req.query('tenant');
  if (!slug) return c.text('Missing ?tenant', 400);
  const tenant = await findTenantBySlug(db, slug);
  if (!tenant) return c.text(`No tenant '${slug}'`, 404);
  return brandVoicePage(c, db, tenant);
});

app.post('/settings/brand-voice', async (c) => {
  const db = makeDb(c.env.DATABASE_URL);
  const slug = c.req.query('tenant');
  if (!slug) return c.text('Missing ?tenant', 400);
  const tenant = await findTenantBySlug(db, slug);
  if (!tenant) return c.text(`No tenant '${slug}'`, 404);
  return brandVoiceSave(c, db, tenant);
});

// ──────────────────────────────────────────────────────────────────
// POST /webhooks/sendgrid — SendGrid Event Webhook ingest.
//   - verifies the ECDSA signature against SENDGRID_WEBHOOK_SECRET
//   - resolves tenant from the X-Tenant-ID header
//   - processes events out-of-band via waitUntil and returns 200 fast
//     (SendGrid retries for up to 24h on any non-200)
// ──────────────────────────────────────────────────────────────────
app.post('/webhooks/sendgrid', async (c) => {
  const raw = await c.req.text();

  const signature = c.req.header(SENDGRID_SIGNATURE_HEADER);
  const timestamp = c.req.header(SENDGRID_TIMESTAMP_HEADER);
  const secret = c.env.SENDGRID_WEBHOOK_SECRET;
  if (!secret) return c.text('webhook not configured', 500);

  const valid = await verifySendGridSignature(
    secret,
    raw,
    signature ?? '',
    timestamp ?? '',
  );
  if (!valid) return c.text('invalid signature', 401);

  const tenantId = c.req.header('X-Tenant-ID');
  if (!tenantId) return c.text('missing X-Tenant-ID', 400);
  try {
    assertUuid(tenantId, 'X-Tenant-ID');
  } catch {
    return c.text('invalid X-Tenant-ID', 400);
  }

  let events: SendGridEvent[];
  try {
    const parsed = JSON.parse(raw);
    events = Array.isArray(parsed) ? (parsed as SendGridEvent[]) : [];
  } catch {
    return c.text('invalid JSON', 400);
  }

  c.executionCtx.waitUntil(
    (async () => {
      try {
        const deps = await resolveMailSyncDeps(c.env, tenantId);
        await processSendGridWebhookEvents(tenantId, events, deps);
      } catch (err) {
        console.error('[sendgrid webhook] processing failed:', err);
      }
    })(),
  );

  return c.text('ok', 200);
});

// Cloudflare Workflows must be exported (by class_name) from the entry module.
export { GenerationWorkflow } from './workflows/generation.js';
export { PublishWorkflow } from './workflows/publish.js';

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    const schedEnv = env as unknown as SchedulerEnv;
    switch (event.cron) {
      case '*/15 * * * *':
        ctx.waitUntil(runPublishTick(schedEnv));
        break;
      case '0 */6 * * *':
        ctx.waitUntil(runGenerationTick(schedEnv));
        break;
      case '0 3 * * *':
        ctx.waitUntil(runNightlyTick(schedEnv));
        break;
      case '0 8 * * 1':
        ctx.waitUntil(runIntelligenceTick(schedEnv));
        break;
      default:
        console.warn(`[scheduled] no handler for cron '${event.cron}'`);
    }
  },
};
