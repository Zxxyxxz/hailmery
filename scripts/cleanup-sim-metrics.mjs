// One-shot cleanup of simulated analytics data (Session 4, Item 1).
//
//   pnpm exec tsx --env-file=.env scripts/cleanup-sim-metrics.mjs
//
// Removes every fabricated row scripts/sim-metrics.ts seeded into
// marketing.content_metrics and un-promotes the golden_example documents that
// were learned from those fake numbers, then re-scores on the real data that
// remains (SendGrid email opens/clicks; Buffer social metrics once wired).
//
// WHAT COUNTS AS FAKE (verified against production on 2026-06-11):
//   • Every window='7d' content_metrics row. sim-metrics is the ONLY writer of
//     '7d' rows (Umami, the only other '7d' source, is not connected), and they
//     all carry inflated round numbers (impressions 180-489) fetched in the
//     single sim run. This includes 2 rows on the EMAIL channel — kept by a
//     naive "keep all email" rule, but they corrupt the email averages because
//     /api/analytics/summary takes MAX(impressions) across a draft's windows.
//   • Non-email content_metrics that are ALL-ZERO (impressions/clicks/engagement
//     /attributed_leads all 0) — EMPTY_METRICS stubs written by
//     processMetricsQueue against adapters with no real fetch. STEP 1b is scoped
//     to all-zero rows ONLY, so a real Buffer social metric (e.g. LinkedIn
//     impressions=67 written at window='24h' once fetchMetrics is wired) is
//     preserved, never deleted.
//
// WHAT IS KEPT: email rows at window != '7d' — the real SendGrid webhook metrics
// (modest 1-3 impressions/event) written by services/mailsync.ts at window='1h';
// plus any non-email row carrying real (non-zero) engagement.
//
// Idempotent + order-independent: safe to run before OR after the Buffer
// backfill; re-running deletes nothing real and just re-reports + re-scores.
// Runs as the BYPASSRLS neondb_owner (tsx --env-file=.env), so RLS is NOT a
// backstop — every statement below MUST (and does) carry an explicit tenant_id
// predicate.

import { sql } from 'drizzle-orm';
import { makeDb } from '../src/db/client.ts';
import { getAllActiveTenants, withTenantDb } from '../src/lib/tenant.ts';
import { scorePerformance, tagGoldenExamples } from '../src/jobs/metrics.ts';

const env = {
  DATABASE_URL: process.env.DATABASE_URL,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? '',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? '',
  SECRETS_KEY: process.env.SECRETS_KEY ?? '',
};
if (!env.DATABASE_URL) throw new Error('DATABASE_URL not set');

const rows = (r) => r.rows ?? [];

async function reportMetrics(db, tenantId, label) {
  return withTenantDb(db, tenantId, async (tx) => {
    const r = await tx.execute(sql`
      SELECT cd.channel, cm."window", count(*)::int AS n,
             min(cm.impressions) AS min_impr, max(cm.impressions) AS max_impr
      FROM marketing.content_metrics cm
      JOIN marketing.content_drafts cd ON cd.id = cm.draft_id AND cd.tenant_id = ${tenantId}
      WHERE cm.tenant_id = ${tenantId}
      GROUP BY cd.channel, cm."window"
      ORDER BY cd.channel, cm."window"
    `);
    console.log(`  [${label}] content_metrics for tenant ${tenantId.slice(0, 8)}:`);
    if (rows(r).length === 0) console.log('    (none)');
    for (const x of rows(r)) {
      console.log(`    ${String(x.channel).padEnd(10)} ${String(x.window).padEnd(4)} n=${x.n}  impr=${x.min_impr}..${x.max_impr}`);
    }
    return rows(r);
  });
}

async function main() {
  const db = makeDb(env.DATABASE_URL);
  const tenants = await getAllActiveTenants(db);
  console.log(`Cleaning simulated metrics for ${tenants.length} tenant(s).\n`);

  let totalMetricsDeleted = 0;
  let totalGoldenDocsDeleted = 0;
  let totalFlagsReset = 0;

  for (const t of tenants) {
    const tid = t.id;
    console.log(`──────── tenant ${tid} ────────`);
    await reportMetrics(db, tid, 'before');

    // STEP 1a — delete the fabricated window='7d' rows (all channels).
    const del7d = await withTenantDb(db, tid, async (tx) =>
      rows(await tx.execute(sql`
        DELETE FROM marketing.content_metrics cm
        USING marketing.content_drafts cd
        WHERE cm.tenant_id = ${tid}
          AND cd.id = cm.draft_id AND cd.tenant_id = ${tid}
          AND cm."window" = '7d'
        RETURNING cd.channel AS channel
      `)),
    );
    const by7d = {};
    for (const x of del7d) by7d[x.channel] = (by7d[x.channel] ?? 0) + 1;
    console.log(`  STEP 1a — deleted ${del7d.length} fabricated 7d rows:`, JSON.stringify(by7d));

    // STEP 1b — delete non-email ALL-ZERO stub rows only. The all-zero predicate
    // guarantees a real Buffer social metric (any non-zero field) is preserved.
    const delStub = await withTenantDb(db, tid, async (tx) =>
      rows(await tx.execute(sql`
        DELETE FROM marketing.content_metrics cm
        USING marketing.content_drafts cd
        WHERE cm.tenant_id = ${tid}
          AND cd.id = cm.draft_id AND cd.tenant_id = ${tid}
          AND cd.channel <> 'email'
          AND cm.impressions = 0 AND cm.clicks = 0 AND cm.engagement = 0
          AND COALESCE(cm.attributed_leads, 0) = 0
        RETURNING cd.channel AS channel
      `)),
    );
    const byStub = {};
    for (const x of delStub) byStub[x.channel] = (byStub[x.channel] ?? 0) + 1;
    console.log(`  STEP 1b — deleted ${delStub.length} non-email all-zero stub rows:`, JSON.stringify(byStub));
    totalMetricsDeleted += del7d.length + delStub.length;

    // STEP 2 — un-promote golden_example documents learned from fake metrics.
    // These are synthetic auto-promotions (source='git', source_filename
    // 'golden/<draftId>.md') created by tagGoldenExamples — NOT human-uploaded
    // corpus docs, so the honest cleanup deletes them outright (no original
    // type to revert to). Chunks go first (explicit; the FK would also cascade).
    const delChunks = await withTenantDb(db, tid, async (tx) =>
      rows(await tx.execute(sql`
        DELETE FROM marketing.document_chunks dc
        USING marketing.documents d
        WHERE dc.tenant_id = ${tid}
          AND d.id = dc.document_id AND d.tenant_id = ${tid}
          AND d.document_type = 'golden_example'
          AND d.source = 'git'
          AND d.source_filename LIKE 'golden/%'
        RETURNING dc.id
      `)),
    );
    const delDocs = await withTenantDb(db, tid, async (tx) =>
      rows(await tx.execute(sql`
        DELETE FROM marketing.documents d
        WHERE d.tenant_id = ${tid}
          AND d.document_type = 'golden_example'
          AND d.source = 'git'
          AND d.source_filename LIKE 'golden/%'
        RETURNING d.source_filename AS f
      `)),
    );
    totalGoldenDocsDeleted += delDocs.length;
    console.log(`  STEP 2 — deleted ${delDocs.length} golden_example doc(s) + ${delChunks.length} chunk(s):`,
      JSON.stringify(delDocs.map((d) => d.f)));

    // Reset the stale is_golden_example flags on drafts (tagGoldenExamples will
    // re-set the real winners below; this guarantees a clean slate regardless).
    const resetFlags = await withTenantDb(db, tid, async (tx) =>
      rows(await tx.execute(sql`
        UPDATE marketing.content_drafts
        SET is_golden_example = false, updated_at = now()
        WHERE tenant_id = ${tid} AND is_golden_example = true
        RETURNING id
      `)),
    );
    totalFlagsReset += resetFlags.length;
    console.log(`  STEP 2 — reset ${resetFlags.length} is_golden_example flag(s).`);

    await reportMetrics(db, tid, 'after');
    console.log('');
  }

  // STEP 3 — re-score on the clean (real-only) data. scorePerformance nulls out
  // the fake scores (no metrics → no channel baseline → NULL); tagGoldenExamples
  // clears flags and re-promotes only genuine top-decile outperformers (score
  // > 1.0) from the data that survives.
  console.log('──────── STEP 3 — re-score on real data ────────');
  let scored = 0;
  let golden = 0;
  for (const t of tenants) {
    const s = await scorePerformance(db, t.id);
    const g = await tagGoldenExamples(env, db, t.id);
    scored += s;
    golden += g;
    console.log(`  tenant ${t.id.slice(0, 8)} → scored=${s} golden=${g}`);
  }

  // STEP 4 — honest final state.
  console.log('\n════════ HONEST STATE AFTER CLEANUP ════════');
  console.log(`content_metrics rows deleted:  ${totalMetricsDeleted}`);
  console.log(`golden_example docs deleted:   ${totalGoldenDocsDeleted}`);
  console.log(`is_golden_example flags reset: ${totalFlagsReset}`);
  console.log(`re-scored drafts:              ${scored}`);
  console.log(`golden examples (real data):   ${golden}`);
  console.log('\nRemaining content_metrics per channel/window:');
  for (const t of tenants) await reportMetrics(db, t.id, 'final');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
