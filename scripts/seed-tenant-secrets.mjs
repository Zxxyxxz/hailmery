// Seeds real platform credentials into marketing.tenant_secrets for a tenant.
//
// Tokens are read from the environment and encrypted with the app's AES-GCM
// `encryptSecret` (lib/secrets.ts) before storage — the DB never sees plaintext.
// Idempotent: re-running upserts on the (tenant_id, platform) primary key.
// Bypasses RLS the same way src/db/seed.ts does (app.rls_bypass = true).
//
//   tsx --env-file=.env scripts/seed-tenant-secrets.mjs [tenant-slug]
//
// Default tenant slug: apire

import { Pool } from '@neondatabase/serverless';
import { encryptSecret } from '../src/lib/secrets.ts';

const SLUG = process.argv[2] ?? 'apire';

// platform -> { envVar, scopes, expiresInterval }
//   expiresInterval: a Postgres interval string, or null for non-expiring tokens.
const PLATFORMS = [
  {
    platform: 'hubspot',
    envVar: 'HUBSPOT_API_KEY', // .env exposes the HubSpot token as HUBSPOT_API_KEY
    scopes: [
      'crm.objects.contacts.read',
      'crm.objects.contacts.write',
      'timeline.events.write',
    ],
    expiresInterval: '1 year',
  },
  {
    platform: 'sendgrid',
    envVar: 'SENDGRID_API_KEY',
    scopes: ['mail.send', 'marketing.contacts'],
    expiresInterval: '1 year',
  },
  {
    platform: 'buffer',
    envVar: 'BUFFER_ACCESS_TOKEN',
    scopes: null, // Buffer access tokens carry no granular scope strings
    expiresInterval: null, // Buffer access tokens do not expire
  },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  const key = process.env.SECRETS_KEY;
  if (!key) throw new Error('SECRETS_KEY not set');

  // Buffer publishes through per-tenant channel ids. BUFFER_PROFILE_MAP holds
  // every tenant's ids keyed as `${channel}_${slug}` (e.g. "linkedin_apire");
  // we store, per tenant, only that tenant's entries re-keyed by bare channel.
  const tenantProfileMap = () => {
    const raw = process.env.BUFFER_PROFILE_MAP;
    if (!raw) throw new Error('BUFFER_PROFILE_MAP not set (needed for platform "buffer")');
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('BUFFER_PROFILE_MAP is not valid JSON');
    }
    const suffix = `_${SLUG}`;
    const out = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (k.endsWith(suffix)) out[k.slice(0, -suffix.length)] = v;
    }
    if (Object.keys(out).length === 0) {
      throw new Error(`BUFFER_PROFILE_MAP has no entries for tenant "${SLUG}" (expected keys like "linkedin_${SLUG}")`);
    }
    return out;
  };

  // Encrypt every token up front so a missing env var fails before we touch the DB.
  const rows = [];
  for (const p of PLATFORMS) {
    const token = process.env[p.envVar];
    if (!token) throw new Error(`${p.envVar} not set (needed for platform "${p.platform}")`);
    const row = { ...p, ciphertext: await encryptSecret(token, key), profileMapCipher: null };
    if (p.platform === 'buffer') {
      const map = tenantProfileMap();
      row.profileMapCipher = await encryptSecret(JSON.stringify(map), key);
      console.log(`  buffer profile map for ${SLUG}: ${JSON.stringify(map)}`);
    }
    rows.push(row);
  }

  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.rls_bypass', 'true', true)");
    // Additive + idempotent — keeps the seed self-contained vs. a separate migration.
    await client.query('ALTER TABLE marketing.tenant_secrets ADD COLUMN IF NOT EXISTS encrypted_profile_map text');

    const t = await client.query(
      'SELECT id FROM marketing.tenants WHERE slug = $1',
      [SLUG],
    );
    if (t.rows.length === 0) throw new Error(`No tenant with slug "${SLUG}"`);
    const tenantId = t.rows[0].id;

    for (const r of rows) {
      await client.query(
        `INSERT INTO marketing.tenant_secrets
           (tenant_id, platform, encrypted_access_token, encrypted_profile_map,
            token_expires_at, scopes, updated_at)
         VALUES
           ($1, $2, $3, $4,
            CASE WHEN $5::text IS NULL THEN NULL ELSE NOW() + $5::interval END,
            $6::text[], NOW())
         ON CONFLICT (tenant_id, platform) DO UPDATE SET
           encrypted_access_token = EXCLUDED.encrypted_access_token,
           encrypted_profile_map  = EXCLUDED.encrypted_profile_map,
           token_expires_at       = EXCLUDED.token_expires_at,
           scopes                 = EXCLUDED.scopes,
           updated_at             = NOW()`,
        [tenantId, r.platform, r.ciphertext, r.profileMapCipher, r.expiresInterval, r.scopes],
      );
      console.log(`  upserted ${SLUG}/${r.platform}`);
    }

    await client.query('COMMIT');
    console.log(`\nDone. ${rows.length} credential(s) stored for tenant "${SLUG}".`);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
