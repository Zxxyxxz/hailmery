// One-off: restore the Buffer profile map for a single tenant WITHOUT touching
// the access token. The disconnect endpoint used to DELETE the whole
// tenant_secrets row, so a disconnect → reconnect wiped the LinkedIn channel
// mapping and publishes failed with "No Buffer channel/profile id mapped".
// This re-encrypts and writes ONLY encrypted_profile_map for the given row.
//
//   tsx --env-file=.env scripts/restore-buffer-profile-map.mjs
//
// Idempotent: re-running just re-writes the same map. Encryption uses the same
// AES-GCM SECRETS_KEY the worker uses, so the worker can decrypt it at runtime.

import { Pool } from '@neondatabase/serverless';
import { encryptSecret, decryptSecret } from '../src/lib/secrets.ts';

const TENANT_ID = '6daebc34-7fd0-4542-8527-cfcd125a5f72'; // APIRE
const PLATFORM = 'buffer';
const PROFILE_MAP = {
  linkedin: '6935634729ea336fd65bb60e',
};

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  const key = process.env.SECRETS_KEY;
  if (!key) throw new Error('SECRETS_KEY not set');

  const cipher = await encryptSecret(JSON.stringify(PROFILE_MAP), key);

  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.rls_bypass', 'true', true)");

    // The row + access token must already exist — we only restore the map.
    const before = await client.query(
      `SELECT encrypted_access_token IS NOT NULL AS has_token, encrypted_profile_map
         FROM marketing.tenant_secrets
        WHERE tenant_id = $1 AND platform = $2`,
      [TENANT_ID, PLATFORM],
    );
    if (before.rows.length === 0) {
      throw new Error(
        `No ${PLATFORM} row for tenant ${TENANT_ID} — cannot restore (re-create needs the access token).`,
      );
    }
    console.log(
      `before: has_token=${before.rows[0].has_token}, profile_map_present=${before.rows[0].encrypted_profile_map != null}`,
    );

    const res = await client.query(
      `UPDATE marketing.tenant_secrets
          SET encrypted_profile_map = $1, updated_at = NOW()
        WHERE tenant_id = $2 AND platform = $3`,
      [cipher, TENANT_ID, PLATFORM],
    );
    if (res.rowCount !== 1) throw new Error(`Expected to update exactly 1 row, updated ${res.rowCount}`);

    // Round-trip: read back, decrypt, confirm it matches AND the token survived.
    const after = await client.query(
      `SELECT encrypted_access_token IS NOT NULL AS has_token, encrypted_profile_map
         FROM marketing.tenant_secrets
        WHERE tenant_id = $1 AND platform = $2`,
      [TENANT_ID, PLATFORM],
    );
    const decrypted = JSON.parse(await decryptSecret(after.rows[0].encrypted_profile_map, key));
    console.log(`after:  has_token=${after.rows[0].has_token}, decrypted=${JSON.stringify(decrypted)}`);
    if (!after.rows[0].has_token) throw new Error('access token went missing — aborting (rolled back)');
    if (JSON.stringify(decrypted) !== JSON.stringify(PROFILE_MAP)) {
      throw new Error('round-trip mismatch — decrypted map != intended');
    }

    await client.query('COMMIT');
    console.log('\nDone. Buffer profile map restored (access token untouched).');
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
