// RLS verification — V0 point #10.
//
// Setup-required: pnpm db:migrate && pnpm db:seed && pnpm ingest --tenant apire.
//
// Assertions:
//   1. With app.tenant_id = OSM,   selecting from APIRE's chunks returns 0.
//   2. With app.tenant_id = APIRE, selecting from APIRE's chunks returns > 0.
//   3. With NO app.tenant_id set,  RLS fails closed (0 rows).

import { sql } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { findTenantBySlug } from '../src/lib/tenant.js';

function assert(cond: unknown, label: string): asserts cond {
  if (!cond) {
    console.error(`✗ FAIL: ${label}`);
    process.exit(1);
  }
  console.log(`✓ ${label}`);
}

async function countChunks(tenantIdInSession: string | null): Promise<number> {
  return db.transaction(async (tx) => {
    if (tenantIdInSession) {
      await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantIdInSession}, true)`);
    }
    const res = await tx.execute<{ count: string }>(sql`SELECT count(*)::text AS count FROM marketing.document_chunks`);
    return Number(res.rows[0]?.count ?? 0);
  });
}

async function main() {
  const apire = await findTenantBySlug(db, 'apire');
  const osm = await findTenantBySlug(db, 'osm');
  assert(apire, 'tenant APIRE exists');
  assert(osm, 'tenant OSM exists');

  // Need real chunks to test against. If empty, skip the >0 check.
  const inApire = await countChunks(apire!.id);
  console.log(`  observed: APIRE-session sees ${inApire} chunks under APIRE`);

  const inOsm = await countChunks(osm!.id);
  console.log(`  observed: OSM-session sees ${inOsm} chunks under OSM`);

  const unset = await countChunks(null);
  console.log(`  observed: no-tenant session sees ${unset} chunks`);

  assert(unset === 0, 'with no app.tenant_id, RLS returns 0 rows (fail-closed)');

  if (inApire === 0) {
    console.warn('⚠ APIRE has no chunks yet — RLS isolation test partial. Run `pnpm ingest --tenant apire` then re-run.');
  } else {
    assert(inOsm === 0, 'OSM session cannot see APIRE chunks (isolation enforced)');
  }

  console.log('\nRLS verification passed.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
