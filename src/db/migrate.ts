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

    // Enum value additions for ALREADY-created types. `ALTER TYPE ... ADD VALUE`
    // can't be used in the same transaction it's added, and rls.sql runs as one
    // implicit transaction — so each addition runs here as its own autocommit
    // statement. IF NOT EXISTS makes them idempotent (no-op on fresh DBs, where
    // rls.sql's CREATE TYPE already lists the value). Constants only — no input.
    const enumAdditions: Array<{ type: string; value: string }> = [
      { type: 'marketing.recommendation_type', value: 'seo_opportunity' },
    ];
    for (const { type, value } of enumAdditions) {
      console.log(`[migrate] ensuring enum value ${type} += '${value}'`);
      await client.query(`ALTER TYPE ${type} ADD VALUE IF NOT EXISTS '${value}'`);
    }

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
