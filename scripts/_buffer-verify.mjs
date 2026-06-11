// Verify Buffer fetchMetrics() returns real engagement (not the empty stub) and
// backfill the real numbers into content_metrics for APIRE's published social
// posts. Uses the SAME resolveAdapter path processMetricsQueue uses.
//   pnpm exec tsx --env-file=.env scripts/_buffer-verify.mjs
// Never prints the access token.

import { sql } from 'drizzle-orm';
import { makeDb } from '../src/db/client.ts';
import { withTenantDb } from '../src/lib/tenant.ts';
import { resolveAdapter } from '../src/lib/credentials.ts';
import { upsertContentMetric, scorePerformance, tagGoldenExamples } from '../src/jobs/metrics.ts';

const APIRE = '6daebc34-7fd0-4542-8527-cfcd125a5f72';
const env = {
  DATABASE_URL: process.env.DATABASE_URL,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? '',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? '',
  SECRETS_KEY: process.env.SECRETS_KEY ?? '',
};
const BACKFILL = process.argv.includes('--backfill');

const db = makeDb(env.DATABASE_URL);

// Published social drafts with a recorded Buffer post id.
const drafts = await withTenantDb(db, APIRE, async (tx) => {
  const r = await tx.execute(sql`
    SELECT id, channel, published_ref
    FROM marketing.content_drafts
    WHERE tenant_id = ${APIRE}
      AND channel IN ('linkedin','twitter','x','instagram')
      AND status IN ('published','measured')
      AND published_ref IS NOT NULL AND published_ref <> ''
    ORDER BY channel
  `);
  return r.rows;
});
console.log(`Found ${drafts.length} published social drafts with a published_ref.\n`);

// Resolve the Buffer adapter once (token is shared across social channels).
const resolved = await resolveAdapter({ db, tenantId: APIRE, channel: 'linkedin', secretsKey: env.SECRETS_KEY });
if (!('resolved' in resolved)) { console.error('resolveAdapter failed:', resolved.reason); process.exit(1); }
const adapter = resolved.resolved.adapter;

console.log('=== fetchMetrics() per published social post ===');
let realCount = 0;
for (const d of drafts) {
  const m = await adapter.fetchMetrics(d.published_ref);
  const nonZero = m.impressions || m.clicks || m.engagement;
  if (nonZero) realCount++;
  console.log(`  ${d.channel.padEnd(9)} draft=${d.id.slice(0, 8)} ref=${d.published_ref} -> ${JSON.stringify(m)}${nonZero ? '  ◀ REAL' : ''}`);

  if (BACKFILL && nonZero) {
    // Persist the cumulative Buffer numbers under window '24h' — the same
    // upsert processMetricsQueue performs, just driven directly so we don't
    // disturb the unrelated blog/email queue rows due tonight. Only non-zero
    // results are written (mirrors the processMetricsQueue zero-skip) so stale
    // NOT_FOUND refs don't re-create the zero-stub rows the cleanup deleted.
    await upsertContentMetric(db, APIRE, {
      draftId: d.id,
      window: '24h',
      impressions: m.impressions,
      clicks: m.clicks,
      engagement: m.engagement,
      attributedLeads: m.attributedLeads,
    });
  }
}
console.log(`\n${realCount} post(s) returned real (non-zero) engagement — the stub would have returned all zeros.`);

if (BACKFILL) {
  console.log('\n=== backfilled into content_metrics; re-scoring on the fuller dataset ===');
  const scored = await scorePerformance(db, APIRE);
  const golden = await tagGoldenExamples(env, db, APIRE);
  console.log(`  scored=${scored} golden=${golden}`);
}
process.exit(0);
