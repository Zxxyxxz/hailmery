// Seeds the two V0 tenants (OSM and APIRE) and a default site + brand-voice
// config per tenant. Bypasses RLS by setting row_security = off for the
// duration of the seed transaction.
//
//   pnpm db:seed

import { Pool } from '@neondatabase/serverless';

const SEED = [
  {
    slug: 'apire',
    name: 'APIRE',
    domain: 'apire.io',
    brandVoice: {
      audience: 'EU CISOs and security architects at mid-to-large enterprises',
      tone: 'authoritative, technical, calm under pressure',
      avoid: ['hype', 'AI marketing buzzwords without grounding', 'generic CTAs'],
      always: [
        'reference EU regulatory frame when relevant (NIS2, EU AI Act)',
        'distinguish DLP from gen-AI data protection',
        'tie features to concrete threats from the corpus',
      ],
    },
  },
  {
    slug: 'osm',
    name: 'OSM',
    domain: 'osm.com',
    brandVoice: {
      audience: 'TBD — fill in once Baran confirms OSM positioning',
      tone: 'TBD',
      avoid: [],
      always: [],
    },
  },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');

  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    // Bypass tenant_isolation policy for the duration of the seed via the
    // explicit `app.rls_bypass` GUC. This is the only place we use it.
    await client.query("SELECT set_config('app.rls_bypass', 'true', true)");

    for (const t of SEED) {
      // Insert/find tenant
      const tRes = await client.query<{ id: string }>(
        `INSERT INTO marketing.tenants (name, slug, plan)
         VALUES ($1, $2, 'starter')
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [t.name, t.slug]
      );
      const tenantId = tRes.rows[0].id;
      console.log(`[seed] tenant ${t.slug} → ${tenantId}`);

      // Insert/find site
      const sRes = await client.query<{ id: string }>(
        `INSERT INTO marketing.sites (tenant_id, domain, timezone)
         VALUES ($1, $2, 'Europe/Istanbul')
         ON CONFLICT (tenant_id, domain) DO UPDATE SET timezone = EXCLUDED.timezone
         RETURNING id`,
        [tenantId, t.domain]
      );
      const siteId = sRes.rows[0].id;
      console.log(`[seed] site ${t.domain} → ${siteId}`);

      // Upsert site_config
      await client.query(
        `INSERT INTO marketing.site_config (site_id, tenant_id, brand_voice)
         VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (site_id) DO UPDATE SET
           brand_voice = EXCLUDED.brand_voice,
           updated_at = now()`,
        [siteId, tenantId, JSON.stringify(t.brandVoice)]
      );

      // Default evergreen campaign per tenant (idempotent)
      const campRes = await client.query(
        `SELECT id FROM marketing.campaigns
         WHERE tenant_id = $1 AND name = 'Default Evergreen' AND type = 'evergreen'
         LIMIT 1`,
        [tenantId]
      );
      if (campRes.rows.length === 0) {
        await client.query(
          `INSERT INTO marketing.campaigns (tenant_id, site_id, name, type, status)
           VALUES ($1, $2, 'Default Evergreen', 'evergreen', 'active')`,
          [tenantId, siteId]
        );
      }
      console.log(`[seed] default evergreen campaign for ${t.slug}`);
    }

    await client.query('COMMIT');
    console.log('[seed] done');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
