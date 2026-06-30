// Dispose of the stale / unrepairable drafts surfaced by the failed-draft
// investigation, per the confirmed plan. Three action groups:
//
//   A. DISMISS 6 failed drafts by EXPLICIT id (each must currently be 'failed').
//   B. REVIVE the blog draft d1a8a897 to 'pending_review' (clear publish_at +
//      failed_reason) — its content is real and the adapter bug is already fixed.
//   C. DISMISS every pending_review X/Twitter draft (X is NOT connected in
//      APIRE's Buffer, so they can't publish) — by an explicit tenant+status+
//      channel query.
//
// Dry-run by default; pass --commit to write. Every statement carries an
// explicit tenant_id predicate AND a status guard (rls_bypass is on only so
// app.tenant_id need not be set per query). All writes run in one transaction
// that ROLLs BACK on any surprise. Reversible: prior statuses are recorded below.
//
//   npx tsx --env-file=.env scripts/dismiss-failed-drafts.mjs            # dry-run
//   npx tsx --env-file=.env scripts/dismiss-failed-drafts.mjs --commit   # write

import { Pool } from '@neondatabase/serverless';

const APIRE = '6daebc34-7fd0-4542-8527-cfcd125a5f72';
const COMMIT = process.argv.includes('--commit');
const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) { console.error('DATABASE_URL must be set (--env-file=.env)'); process.exit(1); }

// A. dismiss these failed drafts by id (only if still status='failed').
const DISMISS_FAILED = [
  { id: 'ab8df85e-0b2c-4dfd-8ce5-d191a6688ab3', reason: 'missing_email_body_pre_session11' },      // email, undefined .replace (pre-guard) + no body
  { id: '4fa68327-5711-466c-871b-e8c86ff090d9', reason: 'missing_email_body_pre_session11' },      // email, guard fired + no body
  { id: 'aa91f390-2bb9-4fae-8e5e-d0655de86747', reason: 'scheduled_time_passed_auto_dismissed' },  // linkedin, past dueAt
  { id: '02b47821-cdef-43d9-b153-3c372cd786df', reason: 'scheduled_time_passed_auto_dismissed' },  // linkedin, map wiped→restored + window passed
  { id: '8f9786df-b369-4d28-ac6e-e9e0ce3ce736', reason: 'x_not_connected_in_buffer_auto_dismissed' }, // twitter, no X channel
  { id: '5e286ba7-20c4-495e-b95c-bebde31a4e21', reason: 'x_not_connected_in_buffer_auto_dismissed' }, // x, no X channel
];

// B. revive blog draft (only if still status='failed').
const REVIVE_TO_PENDING = ['d1a8a897-df1a-42a6-978d-8a7c73974ede'];

// C. dismiss all pending_review X/Twitter drafts (query-based).
const PENDING_X_REASON = 'x_not_connected_in_buffer_auto_dismissed';
const EXPECTED_PENDING_X = 11; // sanity check against the diagnostic (7 twitter + 4 x)

async function main() {
  const pool = new Pool({ connectionString: DB_URL });
  const client = await pool.connect();
  try {
    await client.query("SELECT set_config('app.rls_bypass', 'true', false)");
    if (COMMIT) await client.query('BEGIN');
    console.log(`\n${COMMIT ? '*** COMMIT (writing) ***' : '--- DRY RUN (no writes) ---'}\n`);

    // ── A. dismiss failed by id ───────────────────────────────────────
    console.log(`A. DISMISS ${DISMISS_FAILED.length} failed drafts by id`);
    for (const d of DISMISS_FAILED) {
      const cur = await client.query(
        `SELECT status, channel, left(failed_reason,80) AS r, payload->>'title' AS title
           FROM marketing.content_drafts WHERE id = $1 AND tenant_id = $2`, [d.id, APIRE]);
      const row = cur.rows[0];
      if (!row) { console.log(`   ! ${d.id} NOT FOUND — skipped`); continue; }
      console.log(`   • ${d.id} [${row.channel}] '${row.status}'→'dismissed'  reason='${d.reason}'  was: ${row.r}`);
      if (COMMIT) {
        const u = await client.query(
          `UPDATE marketing.content_drafts SET status='dismissed', dismiss_reason=$3, updated_at=now()
            WHERE id=$1 AND tenant_id=$2 AND status='failed'`, [d.id, APIRE, d.reason]);
        if (u.rowCount !== 1) throw new Error(`A: ${d.id} updated ${u.rowCount} rows (not failed anymore?) — rollback`);
      }
    }

    // ── B. revive blog draft ──────────────────────────────────────────
    console.log(`\nB. REVIVE ${REVIVE_TO_PENDING.length} blog draft to pending_review`);
    for (const id of REVIVE_TO_PENDING) {
      const cur = await client.query(
        `SELECT status, channel, publish_at, payload->>'title' AS title
           FROM marketing.content_drafts WHERE id=$1 AND tenant_id=$2`, [id, APIRE]);
      const row = cur.rows[0];
      if (!row) { console.log(`   ! ${id} NOT FOUND — skipped`); continue; }
      console.log(`   • ${id} [${row.channel}] '${row.status}'→'pending_review'  clear publish_at(${row.publish_at?.toISOString?.() ?? row.publish_at}) + failed_reason`);
      console.log(`       title: ${row.title ?? '(none)'}`);
      if (COMMIT) {
        const u = await client.query(
          `UPDATE marketing.content_drafts
              SET status='pending_review', publish_at=NULL, failed_reason=NULL, updated_at=now()
            WHERE id=$1 AND tenant_id=$2 AND status='failed'`, [id, APIRE]);
        if (u.rowCount !== 1) throw new Error(`B: ${id} updated ${u.rowCount} rows — rollback`);
      }
    }

    // ── C. dismiss pending_review X/Twitter drafts ────────────────────
    const pend = await client.query(
      `SELECT id, channel, payload->>'title' AS title
         FROM marketing.content_drafts
        WHERE tenant_id=$1 AND status='pending_review' AND lower(channel) IN ('x','twitter')
        ORDER BY channel, id`, [APIRE]);
    console.log(`\nC. DISMISS ${pend.rows.length} pending_review X/Twitter drafts (expected ${EXPECTED_PENDING_X})  reason='${PENDING_X_REASON}'`);
    if (pend.rows.length !== EXPECTED_PENDING_X)
      console.log(`   ⚠️  count ${pend.rows.length} != expected ${EXPECTED_PENDING_X} — review before committing`);
    // Per-id updates (not a bulk sweep) so each carries its own status guard +
    // rowCount===1 check — 1:1 auditability, and a concurrent status change on
    // any single row rolls the whole transaction back.
    for (const r of pend.rows) {
      console.log(`   • ${r.id} [${r.channel}] '${'pending_review'}'→'dismissed'  ${r.title ?? '(none)'}`);
      if (COMMIT) {
        const u = await client.query(
          `UPDATE marketing.content_drafts SET status='dismissed', dismiss_reason=$3, updated_at=now()
            WHERE id=$1 AND tenant_id=$2 AND status='pending_review'`, [r.id, APIRE, PENDING_X_REASON]);
        if (u.rowCount !== 1) throw new Error(`C: ${r.id} updated ${u.rowCount} rows (status changed under us?) — rollback`);
      }
    }
    if (COMMIT) console.log(`   → dismissed ${pend.rows.length} pending X/Twitter drafts`);

    if (COMMIT) { await client.query('COMMIT'); console.log('\n✅ Committed (single transaction).'); }
    else console.log('\n(no changes written — re-run with --commit to apply)');
  } catch (e) {
    if (COMMIT) { try { await client.query('ROLLBACK'); } catch {} }
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
