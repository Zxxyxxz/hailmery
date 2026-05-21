// Tenant-scoped query helpers.
//
// Every operation that touches `marketing.*` should go through `withTenantDb`
// — it opens a transaction, sets the `app.tenant_id` session variable that
// RLS policies key off, and rolls back cleanly on error.

import { sql } from 'drizzle-orm';
import type { NeonDatabase } from 'drizzle-orm/neon-serverless';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertUuid(s: string, label = 'value'): asserts s is string {
  if (!UUID_RE.test(s)) throw new Error(`${label} is not a UUID: ${s}`);
}

export async function withTenantDb<T>(
  db: NeonDatabase<Record<string, unknown>>,
  tenantId: string,
  fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>
): Promise<T> {
  assertUuid(tenantId, 'tenantId');
  return db.transaction(async (tx) => {
    // `set_config(setting, value, is_local)` — is_local=true scopes to the tx.
    // We use the function form (not `SET LOCAL`) because it accepts parameters.
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}

/**
 * Looks up a tenant by slug without RLS (because no tenant context is set
 * at the time of lookup). Wraps in a transaction with row_security off.
 */
export async function findTenantBySlug(
  db: NeonDatabase<Record<string, unknown>>,
  slug: string
): Promise<{ id: string; name: string; slug: string } | null> {
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.rls_bypass', 'true', true)`);
    const rows = await tx.execute<{ id: string; name: string; slug: string }>(
      sql`SELECT id, name, slug FROM marketing.tenants WHERE slug = ${slug} LIMIT 1`
    );
    return rows.rows[0] ?? null;
  });
  return result;
}

/**
 * Looks up the first site for a tenant (V0 assumes one site per tenant).
 */
export async function findFirstSiteForTenant(
  db: NeonDatabase<Record<string, unknown>>,
  tenantId: string
): Promise<{ id: string; domain: string } | null> {
  return withTenantDb(db, tenantId, async (tx) => {
    const rows = await tx.execute<{ id: string; domain: string }>(
      sql`SELECT id, domain FROM marketing.sites WHERE tenant_id = ${tenantId} LIMIT 1`
    );
    return rows.rows[0] ?? null;
  });
}
