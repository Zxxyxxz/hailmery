// Tenant-scoped query helpers.
//
// Every operation that touches `marketing.*` should go through `withTenantDb`
// — it opens a transaction, sets the `app.tenant_id` session variable that
// RLS policies key off, and rolls back cleanly on error.

import { sql } from 'drizzle-orm';
import type { NeonDatabase } from 'drizzle-orm/neon-serverless';
import { decryptSecret } from './secrets.js';

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
 * Returns every tenant. V0 has no soft-delete / active flag, so "active" means
 * "exists" — kept as a named helper so callers (e.g. scheduled jobs) read
 * intentionally and we can add a status filter later without touching them.
 * Runs with rls_bypass because no single-tenant context applies to a fleet-wide
 * scan.
 */
export async function getAllActiveTenants(
  db: NeonDatabase<Record<string, unknown>>
): Promise<Array<{ id: string }>> {
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.rls_bypass', 'true', true)`);
    const rows = await tx.execute<{ id: string }>(
      sql`SELECT id FROM marketing.tenants ORDER BY created_at`
    );
    return rows.rows;
  });
  return result;
}

/**
 * True if the tenant has a stored secret for the given platform with a
 * non-null access token.
 */
export async function hasPlatformSecret(
  db: NeonDatabase<Record<string, unknown>>,
  tenantId: string,
  platform: string
): Promise<boolean> {
  assertUuid(tenantId, 'tenantId');
  return withTenantDb(db, tenantId, async (tx) => {
    const rows = await tx.execute<{ ok: boolean }>(
      sql`SELECT 1 AS ok FROM marketing.tenant_secrets
          WHERE tenant_id = ${tenantId}
            AND platform = ${platform}
            AND encrypted_access_token IS NOT NULL
          LIMIT 1`
    );
    return rows.rows.length > 0;
  });
}

/**
 * Loads and decrypts a platform access token for a tenant. Returns null when
 * no secret row exists. Throws if the row exists but has no token.
 */
export async function loadPlatformToken(
  db: NeonDatabase<Record<string, unknown>>,
  tenantId: string,
  platform: string,
  keyB64: string
): Promise<string | null> {
  assertUuid(tenantId, 'tenantId');
  const ciphertext = await withTenantDb(db, tenantId, async (tx) => {
    const rows = await tx.execute<{ encrypted_access_token: string | null }>(
      sql`SELECT encrypted_access_token FROM marketing.tenant_secrets
          WHERE tenant_id = ${tenantId} AND platform = ${platform}
          LIMIT 1`
    );
    return rows.rows[0]?.encrypted_access_token ?? null;
  });
  if (ciphertext == null) return null;
  return decryptSecret(ciphertext, keyB64);
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
