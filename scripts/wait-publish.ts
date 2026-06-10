// scripts/wait-publish.ts — poll a draft until the cron auto-publishes it.
//   tsx --env-file=.env scripts/wait-publish.ts <draftId> [timeoutMin]
import { Pool } from '@neondatabase/serverless';

const draftId = process.argv[2];
const timeoutMs = Number(process.argv[3] ?? 22) * 60 * 1000;
const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
const start = Date.now();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function check() {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.rls_bypass','true',true)");
    const d = await c.query(
      'SELECT status::text AS status, published_ref, failed_reason FROM marketing.content_drafts WHERE id=$1',
      [draftId],
    );
    const p = await c.query(
      'SELECT channel, published_at::text FROM marketing.publish_log WHERE draft_id=$1 ORDER BY published_at DESC LIMIT 1',
      [draftId],
    );
    await c.query('COMMIT');
    return { d: d.rows[0], log: p.rows[0] ?? null };
  } finally {
    c.release();
  }
}

while (Date.now() - start < timeoutMs) {
  const r = await check();
  const mins = ((Date.now() - start) / 60000).toFixed(1);
  console.log(`[+${mins}m] status=${r.d?.status} ref=${r.d?.published_ref ?? '-'} failed=${r.d?.failed_reason ?? '-'} log=${r.log ? JSON.stringify(r.log) : 'none'}`);
  if ((r.d?.status === 'published' || r.d?.status === 'measured') && r.log) {
    console.log('RESULT: PUBLISHED_BY_CRON', JSON.stringify(r));
    await pool.end();
    process.exit(0);
  }
  if (r.d?.status === 'failed') {
    console.log('RESULT: FAILED', JSON.stringify(r));
    await pool.end();
    process.exit(2);
  }
  await sleep(30000);
}
console.log('RESULT: TIMEOUT — not published within window');
await pool.end();
process.exit(1);
