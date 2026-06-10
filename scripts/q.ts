// scripts/q.ts — ad-hoc SQL inspector against the configured DATABASE_URL.
//
//   tsx --env-file=.env scripts/q.ts "<sql>" [tenantId]
//
// Runs inside a transaction with app.rls_bypass=true (or the given tenant
// context) so inspection sees the same rows the Worker does. Read-only
// discipline is on the caller — it executes whatever SQL you pass. Prints the
// resolved DB role + row count to stderr and the rows as JSON to stdout.

import { Pool } from '@neondatabase/serverless';

const sqlText = process.argv[2];
const tenantId = process.argv[3];
if (!sqlText) {
  console.error('usage: tsx --env-file=.env scripts/q.ts "<sql>" [tenantId]');
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL not set');

const pool = new Pool({ connectionString: url });
const client = await pool.connect();
try {
  await client.query('BEGIN');
  if (tenantId) {
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
  } else {
    await client.query("SELECT set_config('app.rls_bypass', 'true', true)");
  }
  const who = await client.query('SELECT current_user');
  const res = await client.query(sqlText);
  await client.query('COMMIT');
  console.error(`[q] role=${who.rows[0].current_user} rows=${res.rowCount ?? 0}`);
  console.log(JSON.stringify(res.rows, null, 2));
} catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('[q] error:', (e as Error).message);
  process.exit(1);
} finally {
  client.release();
  await pool.end();
}
