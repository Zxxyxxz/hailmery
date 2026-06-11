// Honest-state verification for the analytics dashboard (Session 4, Item 4).
//   pnpm exec tsx --env-file=.env scripts/_analytics-truth.mjs
//
// Reports the true data-source state for APIRE: real rows per channel, GSC,
// intelligence briefs, golden-example chunks, and publish_log — so the truth
// table reflects production exactly, with no fabricated numbers.

import { sql } from 'drizzle-orm';
import { makeDb } from '../src/db/client.ts';
import { withTenantDb, findTenantBySlug } from '../src/lib/tenant.ts';

const db = makeDb(process.env.DATABASE_URL);
const apire = await findTenantBySlug(db, 'apire');
if (!apire) throw new Error('APIRE tenant not found');
const TID = apire.id;
const rows = (r) => r.rows ?? [];

const out = await withTenantDb(db, TID, async (tx) => {
  const metrics = rows(await tx.execute(sql`
    SELECT cd.channel,
           count(*)::int AS rows,
           count(DISTINCT cm.draft_id)::int AS drafts,
           max(cm.impressions) AS max_impr,
           sum(cm.impressions) AS sum_impr,
           sum(cm.engagement) AS sum_eng,
           array_agg(DISTINCT cm."window"::text ORDER BY cm."window"::text) AS windows,
           to_char(max(cm.fetched_at),'YYYY-MM-DD HH24:MI') AS last_fetch
    FROM marketing.content_metrics cm
    JOIN marketing.content_drafts cd ON cd.id = cm.draft_id AND cd.tenant_id = ${TID}
    WHERE cm.tenant_id = ${TID}
    GROUP BY cd.channel ORDER BY cd.channel
  `));
  const gsc = rows(await tx.execute(sql`SELECT count(*)::int AS n FROM marketing.gsc_keywords WHERE tenant_id = ${TID}`))[0];
  const brief = rows(await tx.execute(sql`
    SELECT to_char(week_of,'YYYY-MM-DD') AS week_of, to_char(generated_at,'YYYY-MM-DD HH24:MI') AS generated_at,
           status, jsonb_array_length(topics) AS topic_count
    FROM marketing.intelligence_briefs WHERE tenant_id = ${TID}
    ORDER BY generated_at DESC LIMIT 1
  `))[0];
  const golden = rows(await tx.execute(sql`
    SELECT count(DISTINCT d.id)::int AS docs, count(dc.id)::int AS chunks
    FROM marketing.documents d
    LEFT JOIN marketing.document_chunks dc ON dc.document_id = d.id AND dc.tenant_id = ${TID}
    WHERE d.tenant_id = ${TID} AND d.document_type = 'golden_example'
  `))[0];
  const flagged = rows(await tx.execute(sql`
    SELECT count(*) FILTER (WHERE is_golden_example) AS golden_flagged,
           count(*) FILTER (WHERE performance_score IS NOT NULL) AS scored
    FROM marketing.content_drafts WHERE tenant_id = ${TID}
  `))[0];
  const plog = rows(await tx.execute(sql`
    SELECT channel, count(*)::int AS n, to_char(max(published_at),'YYYY-MM-DD') AS last
    FROM marketing.publish_log WHERE tenant_id = ${TID}
    GROUP BY channel ORDER BY channel
  `));
  return { metrics, gsc, brief, golden, flagged, plog };
});

const m = new Map(out.metrics.map((r) => [r.channel, r]));
const rowFor = (ch) => m.get(ch);
const fmt = (ch) => {
  const r = rowFor(ch);
  if (!r || r.rows === 0) return { rows: 0, note: '' };
  return { rows: r.rows, note: `maxImpr=${r.max_impr} sumEng=${r.sum_eng} windows=${(r.windows || []).join('/')}` };
};

console.log(`\nHAILMERY ANALYTICS — HONEST STATE (tenant APIRE ${TID})`);
console.log('='.repeat(64));
console.log('\nDATA SOURCES (content_metrics):');
console.log('Channel    | Real? | Source           | Rows | Notes');
console.log('-'.repeat(72));
const spec = [
  ['email', '✅ REAL', 'SendGrid webhook', 'Opens/clicks from real sends'],
  ['linkedin', '⚠️ REAL*', 'Buffer GraphQL', '*cumulative, not windowed'],
  ['twitter', '❌ EMPTY', 'No source yet', 'X native adapter V2'],
  ['x', '❌ EMPTY', 'No source yet', 'X native adapter V2'],
  ['blog', '❌ EMPTY', 'No source yet', 'Umami/GA4 V2'],
  ['instagram', '❌ EMPTY', 'No source yet', 'native adapter V2'],
];
for (const [ch, real, src, note] of spec) {
  const f = fmt(ch);
  console.log(`${ch.padEnd(10)} | ${real.padEnd(7)} | ${src.padEnd(16)} | ${String(f.rows).padStart(4)} | ${f.note || note}`);
}
console.log(`gsc        | ❌ EMPTY | Not wired        | ${String(out.gsc?.n ?? 0).padStart(4)} | OAuth V2`);

console.log('\nLEARNING LOOP:');
console.log(`  Golden-example docs in corpus: ${out.golden?.docs ?? 0} (chunks: ${out.golden?.chunks ?? 0})`);
console.log(`  Drafts flagged is_golden_example: ${out.flagged?.golden_flagged ?? 0}`);
console.log(`  Drafts with performance_score:   ${out.flagged?.scored ?? 0}`);

console.log('\nPUBLISH LOG (real publishes):');
for (const p of out.plog) console.log(`  ${p.channel.padEnd(10)} → ${p.n} (last ${p.last})`);

console.log('\nINTELLIGENCE:');
if (out.brief) console.log(`  Latest brief: week_of=${out.brief.week_of} generated=${out.brief.generated_at} status=${out.brief.status} topics=${out.brief.topic_count}`);
else console.log('  No briefs yet.');

console.log('\nRaw content_metrics per channel:');
for (const r of out.metrics) console.log(`  ${r.channel.padEnd(10)} rows=${r.rows} drafts=${r.drafts} sumImpr=${r.sum_impr} sumEng=${r.sum_eng} windows=${(r.windows||[]).join('/')} lastFetch=${r.last_fetch}`);
console.log('');
process.exit(0);
