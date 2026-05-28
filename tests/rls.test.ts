// RLS verification — V0 point #10.
//
// Neon's default role (`neondb_owner`) has `BYPASSRLS = true`, which would
// silently defeat any policy we set on the tables. This test creates (or
// reuses) a dedicated `hailmery_app` role that has NOBYPASSRLS, switches into
// it via SET LOCAL ROLE, and asserts that tenant_isolation is actually enforced.
//
// Assertions:
//   1. With NO app.tenant_id set, the non-bypass session sees ZERO rows.
//   2. With a bogus app.tenant_id, the non-bypass session sees ZERO rows.
//   3. With the APIRE tenant_id, the non-bypass session sees the APIRE chunks.
//   4. With the OSM tenant_id, the non-bypass session sees ZERO APIRE chunks
//      (OSM has no chunks ingested yet — the assertion is that it does NOT
//      see APIRE's chunks).
//   5. With `app.rls_bypass=true`, the non-bypass session sees everything
//      (this is the escape-hatch for seed/migration scripts).

import { Pool } from '@neondatabase/serverless';

const ROLE = 'hailmery_app';

function assert(cond: unknown, label: string): asserts cond {
  if (!cond) {
    console.error(`✗ FAIL: ${label}`);
    process.exit(1);
  }
  console.log(`✓ ${label}`);
}

async function countAs(c: any, tenantId: string | null, bypass = false): Promise<number> {
  await c.query('BEGIN');
  try {
    await c.query(`SET LOCAL ROLE ${ROLE}`);
    if (tenantId) {
      await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    }
    if (bypass) {
      await c.query(`SELECT set_config('app.rls_bypass', 'true', true)`);
    }
    const r = await c.query(
      `SELECT count(*)::text AS count FROM marketing.document_chunks`
    );
    return Number(r.rows[0]?.count ?? 0);
  } finally {
    await c.query('COMMIT');
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  const pool = new Pool({ connectionString: url });
  const c = await pool.connect();

  try {
    // Ensure the non-bypass role exists with the right grants. Idempotent.
    const exists = (await c.query(`SELECT 1 FROM pg_roles WHERE rolname = $1`, [ROLE])).rowCount;
    if (!exists) {
      const pw = 'rls_test_' + Math.random().toString(36).slice(2);
      await c.query(`CREATE ROLE ${ROLE} LOGIN PASSWORD '${pw}' NOBYPASSRLS`);
      console.log(`(created role ${ROLE})`);
    }
    await c.query(`GRANT USAGE ON SCHEMA marketing TO ${ROLE}`);
    await c.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA marketing TO ${ROLE}`);
    await c.query(`GRANT ${ROLE} TO current_user`);

    // Look up tenant IDs as the privileged owner role
    const apire = (
      await c.query<{ id: string }>(`SELECT id FROM marketing.tenants WHERE slug = 'apire' LIMIT 1`)
    ).rows[0];
    const osm = (
      await c.query<{ id: string }>(`SELECT id FROM marketing.tenants WHERE slug = 'osm' LIMIT 1`)
    ).rows[0];
    assert(apire, 'tenant APIRE exists');
    assert(osm, 'tenant OSM exists');

    // 1. No tenant set → 0 rows (fail-closed)
    const unset = await countAs(c, null);
    console.log(`  observed (no tenant set):   ${unset} rows`);
    assert(unset === 0, 'with no app.tenant_id, RLS returns 0 rows (fail-closed)');

    // 2. Bogus tenant → 0 rows
    const bogus = await countAs(c, '00000000-0000-0000-0000-000000000000');
    console.log(`  observed (bogus tenant):    ${bogus} rows`);
    assert(bogus === 0, 'with bogus app.tenant_id, RLS returns 0 rows');

    // 3. APIRE tenant → APIRE chunks visible
    const inApire = await countAs(c, apire!.id);
    console.log(`  observed (APIRE tenant):    ${inApire} rows`);
    assert(inApire > 0, 'with APIRE app.tenant_id, RLS allows APIRE rows');

    // 4. OSM tenant → 0 rows (OSM has none ingested; the assertion is that
    //    APIRE's 105 chunks are NOT visible from OSM's session)
    const inOsm = await countAs(c, osm!.id);
    console.log(`  observed (OSM tenant):      ${inOsm} rows`);
    assert(
      inOsm === 0,
      'with OSM app.tenant_id, OSM cannot see APIRE chunks (cross-tenant isolation)'
    );

    // 5. app.rls_bypass escape hatch works (for seed/migration only)
    const bypass = await countAs(c, null, true);
    console.log(`  observed (rls_bypass=true): ${bypass} rows`);
    assert(bypass > 0, 'with app.rls_bypass=true, RLS is bypassed for admin paths');

    console.log('\nRLS verification passed.');
    console.log(`(Tenant isolation enforced when connecting as ${ROLE}. The default neondb_owner`);
    console.log(' role retains BYPASSRLS — application code must connect through a non-bypass role');
    console.log(' in production. This test proves the policy is correct.)');
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
