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
    domain: 'ofsecman.io',
    brandVoice: {
      audience:
        'security leaders and practitioners at enterprises and SMBs — CISOs, security operations managers, DevSecOps engineers, and compliance officers, plus budget-constrained CFO/IT directors and government/military (air-gapped) buyers',
      tone: 'urgent and consequential, authoritative and data-backed, technical but accessible through analogy, action-oriented and strategic',
      avoid: [
        'generic AI-marketing slop (revolutionary, game-changing, disruptive, seamless, next-generation, cutting-edge, leverage as a verb, paradigm shift)',
        'hedging language (might, could, may help, we believe, potentially) — omit a fact rather than soften it',
        'vague generalizations (many enterprises, some companies, most CISOs, often, generally) — use the corpus statistics instead',
        'calling the product a "tool", a "dashboard", a "scanner", or its alerts "tickets" — OSM is a platform / Executive Command Center that emits OSM Issues',
        'inventing customer names, case studies, certifications, pricing, or SLA numbers (none are verified in the corpus)',
      ],
      always: [
        'lead with the stakes (the Big Data problem, 40,000+ vulns/year, the 270-day gap, the 48-hour breach window), then resolve with the AISecOps Autonomous Workforce',
        'anchor every pitch on one of the three headaches: People, Money, or Complexity',
        'use the two signature analogies — the "collision sensor for cyber threats" and the "Virtual AI Security Team"',
        'frame technical capability as business impact via the Executive Command Center, OSM AI Memory, and Real Risk Score',
        'present output as an actionable OSM Issue (Attacker Scenario + Detection & Prevention Guidance + Complete Remediation Plan), never a list of alerts',
        'cite specific corpus numbers (up to 94% noise auto-triaged, every-15-minute cadence, 83+ tools replaced, 4X ROI) where they fit naturally',
      ],
      preferred: {
        'AISecOps Autonomous Workforce': 'AI tool / AI feature',
        '5 Specialized AI Agents': 'the AI / our algorithm',
        'Executive Command Center': 'dashboard',
        'OSM AI Memory': 'database / knowledge base',
        'Continuous Offensive Security': 'scanning / continuous scanning',
        'Continuous Threat Exposure Management (CTEM)': 'vulnerability management',
        'OSM Issue': 'alert / ticket / finding',
        'Real Risk Score': 'CVSS score / risk rating',
        'Asset Composition Analysis': 'inventory scan',
        'Priority Actions': 'top alerts',
        'vendor-independent': 'agnostic tool',
        'Collision Sensor (for cyber threats)': 'early-warning system',
      },
      summary:
        'OSM sells a paradigm shift — "you can only defend against AI with AI" — using vivid, concrete analogies (the collision sensor, the virtual AI security team) backed by hard numbers. The voice is urgent, authoritative, technical-but-accessible, and strategic. It is the vendor-independent AI-powered CTEM platform that unifies Network, Web, Container, and Source Code risk into one Executive Command Center, run by an AISecOps Autonomous Workforce of 5 Specialized AI Agents. Companion product APIRE.IO secures GenAI traffic; together they are a dual-platform offering. Real brand domain is ofsecman.io.',
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
