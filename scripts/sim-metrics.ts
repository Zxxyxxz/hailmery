// Simulated nightly metrics pass (Chunk 7 demo / Part 5).
//
//   pnpm tsx --env-file=.env scripts/sim-metrics.ts
//
// Seeds realistic placeholder content_metrics for APIRE's published drafts, then
// runs the full runNightlyMetrics() pipeline (queue drain → score → golden tag)
// so the Analytics dashboard renders against real rows.

import { sql } from 'drizzle-orm';
import { makeDb } from '../src/db/client.js';
import { withTenantDb, findTenantBySlug } from '../src/lib/tenant.js';
import { upsertContentMetric, runNightlyMetrics, type MetricsEnv } from '../src/jobs/metrics.js';

const env: MetricsEnv = {
  DATABASE_URL: process.env.DATABASE_URL!,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? '',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? '',
  SECRETS_KEY: process.env.SECRETS_KEY ?? '',
};

const rnd = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

async function main() {
  const db = makeDb(env.DATABASE_URL);
  const apire = await findTenantBySlug(db, 'apire');
  if (!apire) throw new Error('APIRE tenant not found');

  const drafts = await withTenantDb(db, apire.id, async (tx) => {
    const r = await tx.execute<{ id: string; channel: string }>(sql`
      SELECT id, channel FROM marketing.content_drafts
      WHERE tenant_id = ${apire.id} AND status IN ('published', 'measured')
      ORDER BY channel
    `);
    return r.rows;
  });

  console.log(`Seeding placeholder metrics for ${drafts.length} published drafts:`);
  for (const d of drafts) {
    const impressions = rnd(50, 500);
    const clicks = rnd(2, 40);
    const engagement = rnd(1, 20);
    await upsertContentMetric(db, apire.id, {
      draftId: d.id,
      window: '7d',
      impressions,
      clicks,
      engagement,
      attributedLeads: rnd(0, 3),
    });
    console.log(`  ${d.channel.padEnd(9)} ${d.id.slice(0, 8)} → impr=${impressions} clicks=${clicks} eng=${engagement}`);
  }

  console.log('\nRunning runNightlyMetrics()…');
  const result = await runNightlyMetrics(env);
  console.log('Result:', result);

  const scored = await withTenantDb(db, apire.id, async (tx) => {
    const r = await tx.execute(sql`
      SELECT cd.channel,
             round(cd.performance_score, 3) AS score,
             cd.is_golden_example AS golden,
             cm.impressions, cm.clicks, cm.engagement
      FROM marketing.content_drafts cd
      LEFT JOIN marketing.content_metrics cm ON cm.draft_id = cd.id AND cm."window" = '7d'
      WHERE cd.tenant_id = ${apire.id} AND cd.performance_score IS NOT NULL
      ORDER BY cd.performance_score DESC
    `);
    return r.rows;
  });
  console.log('\nScored drafts (desc):');
  console.table(scored);

  const golden = await withTenantDb(db, apire.id, async (tx) => {
    const r = await tx.execute<{ n: string }>(sql`
      SELECT count(*)::int AS n FROM marketing.documents
      WHERE tenant_id = ${apire.id} AND document_type = 'golden_example'
    `);
    return Number(r.rows[0]?.n ?? 0);
  });
  console.log(`\ngolden_example documents now in corpus: ${golden}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
