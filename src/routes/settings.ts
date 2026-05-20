// /settings/brand-voice — read + write site_config.brand_voice for a tenant.
// V0 surface is a single server-rendered page; V1 graduates to React.

import { html, raw } from 'hono/html';
import type { Context } from 'hono';
import { sql } from 'drizzle-orm';
import type { NeonDatabase } from 'drizzle-orm/neon-serverless';
import { withTenantDb, findFirstSiteForTenant } from '../lib/tenant.js';
import { siteConfig } from '../db/schema.js';
import { eq } from 'drizzle-orm';

type Tenant = { id: string; name: string; slug: string };

export async function brandVoicePage(
  c: Context,
  db: NeonDatabase<Record<string, unknown>>,
  tenant: Tenant
) {
  const site = await findFirstSiteForTenant(db, tenant.id);
  if (!site) return c.text(`No site configured for tenant ${tenant.slug}`, 404);

  const currentBrandVoice = await withTenantDb(db, tenant.id, async (tx) => {
    const rows = await tx
      .select({ bv: siteConfig.brandVoice })
      .from(siteConfig)
      .where(eq(siteConfig.siteId, site.id))
      .limit(1);
    return (rows[0]?.bv ?? {}) as Record<string, unknown>;
  });

  const json = JSON.stringify(currentBrandVoice, null, 2);

  return c.html(html`<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>hailmery · brand voice · ${tenant.name}</title>
    <style>
      body { font-family: system-ui; max-width: 880px; margin: 3em auto; padding: 0 1.5em; color: #111 }
      h1 { margin: 0 0 0.4em 0; font-size: 1.6em }
      .meta { color: #666; margin-bottom: 1.8em }
      textarea { width: 100%; min-height: 480px; font-family: ui-monospace, monospace; font-size: 13px; padding: 12px; border: 1px solid #ccc; border-radius: 6px }
      button { padding: 10px 18px; background: #111; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 14px }
      button:hover { background: #333 }
      .nav a { margin-right: 1em }
    </style>
  </head>
  <body>
    <div class="nav"><a href="/">← home</a></div>
    <h1>Brand voice — ${tenant.name}</h1>
    <div class="meta">tenant <code>${tenant.slug}</code> · site <code>${site.domain}</code></div>
    <p>Edit the JSON below. This object is loaded into every generation prompt under the brand voice block. Keep it small and high-signal.</p>
    <form method="post" action="/settings/brand-voice?tenant=${tenant.slug}">
      <textarea name="brand_voice">${json}</textarea>
      <div style="margin-top: 1em"><button type="submit">Save</button></div>
    </form>
  </body>
</html>`);
}

export async function brandVoiceSave(
  c: Context,
  db: NeonDatabase<Record<string, unknown>>,
  tenant: Tenant
) {
  const site = await findFirstSiteForTenant(db, tenant.id);
  if (!site) return c.text(`No site configured for tenant ${tenant.slug}`, 404);

  const form = await c.req.parseBody();
  const rawJson = String(form.brand_voice ?? '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (err) {
    return c.text(`Invalid JSON: ${(err as Error).message}`, 400);
  }

  await withTenantDb(db, tenant.id, async (tx) => {
    await tx
      .update(siteConfig)
      .set({ brandVoice: parsed as Record<string, unknown>, updatedAt: new Date() })
      .where(eq(siteConfig.siteId, site.id));
  });

  return c.redirect(`/settings/brand-voice?tenant=${tenant.slug}&saved=1`);
}
