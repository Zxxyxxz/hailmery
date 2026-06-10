// scripts/profile.ts — decrypt + print a tenant's platform profile map keys.
//   tsx --env-file=.env scripts/profile.ts <tenantId> <platform>
import { Pool } from '@neondatabase/serverless';
import { decryptSecret } from '../src/lib/secrets.js';

const tenantId = process.argv[2];
const platform = process.argv[3] ?? 'buffer';
const url = process.env.DATABASE_URL!;
const key = process.env.SECRETS_KEY!;
const pool = new Pool({ connectionString: url });
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query("SELECT set_config('app.rls_bypass', 'true', true)");
  const r = await client.query(
    'SELECT encrypted_profile_map FROM marketing.tenant_secrets WHERE tenant_id=$1 AND platform=$2 LIMIT 1',
    [tenantId, platform],
  );
  await client.query('COMMIT');
  if (!r.rows[0]?.encrypted_profile_map) {
    console.log(`no profile map for ${platform}`);
  } else {
    const map = JSON.parse(await decryptSecret(r.rows[0].encrypted_profile_map, key));
    console.log(`${platform} profile map keys:`, Object.keys(map).join(', '));
  }
} finally {
  client.release();
  await pool.end();
}
process.exit(0);
