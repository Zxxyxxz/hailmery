// One-shot migration runner.
//
//   pnpm db:migrate
//
// 1. Creates the `marketing` schema if missing.
// 2. Pushes the Drizzle schema (idempotent via drizzle-kit push).
// 3. Applies src/db/rls.sql (extensions + HNSW index + RLS policies).
//
// We delegate (2) to `drizzle-kit push` because it diffs the schema and
// emits the right DDL. Run that yourself first (`pnpm db:push`) then run
// this script to layer the RLS policies on top. We keep them separate
// because drizzle-kit doesn't manage RLS yet.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Pool } from '@neondatabase/serverless';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');

  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();

  try {
    console.log('[migrate] ensuring marketing schema exists');
    await client.query('CREATE SCHEMA IF NOT EXISTS marketing');

    console.log('[migrate] applying rls.sql');
    const rlsSql = await readFile(join(__dirname, 'rls.sql'), 'utf-8');
    await client.query(rlsSql);

    console.log('[migrate] done');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
