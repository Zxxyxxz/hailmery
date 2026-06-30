// READ-ONLY: list every channel connected to a tenant's Buffer account, so we
// can find the X/Twitter channel id to add to the profile map. Uses the TENANT'S
// stored+decrypted Buffer token (the one the worker actually publishes with) —
// NOT process.env.BUFFER_ACCESS_TOKEN, which may belong to a different account.
//
// Buffer's GraphQL channel-listing shape isn't documented; we try several
// candidate queries and print whichever returns channels, plus a root
// introspection fallback so we can iterate if none match.
//
//   npx tsx --env-file=.env scripts/find-buffer-channels.mjs [tenantId]

import { Pool } from '@neondatabase/serverless';
import { decryptSecret } from '../src/lib/secrets.ts';

const APIRE = '6daebc34-7fd0-4542-8527-cfcd125a5f72';
const TENANT = process.argv[2] || APIRE;
const KEY = process.env.SECRETS_KEY;
const DB_URL = process.env.DATABASE_URL;
const ENDPOINT = 'https://api.buffer.com/graphql';
if (!KEY || !DB_URL) { console.error('SECRETS_KEY and DATABASE_URL must be set (--env-file=.env)'); process.exit(1); }

async function loadBufferToken(client, tenantId) {
  const r = await client.query(
    `SELECT encrypted_access_token, encrypted_profile_map FROM marketing.tenant_secrets
      WHERE tenant_id = $1 AND platform = 'buffer'`, [tenantId]);
  const row = r.rows[0];
  if (!row?.encrypted_access_token) return null;
  let profileMap = null;
  if (row.encrypted_profile_map) {
    try { profileMap = JSON.parse(await decryptSecret(row.encrypted_profile_map, KEY)); } catch {}
  }
  return { token: await decryptSecret(row.encrypted_access_token, KEY), profileMap };
}

async function gql(token, query) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

// Root Query exposes top-level `channels`. The `Channel` type has id/name/service
// (serviceType/url are NOT fields on it). We introspect Channel first to surface
// every available field, then select the valid ones.
const CHANNEL_FIELDS = `{ __type(name: "Channel") { fields { name type { name kind ofType { name } } } } }`;

async function main() {
  const pool = new Pool({ connectionString: DB_URL });
  const client = await pool.connect();
  try {
    await client.query("SELECT set_config('app.rls_bypass', 'true', false)");
    const cred = await loadBufferToken(client, TENANT);
    if (!cred) { console.error(`No Buffer credential for tenant ${TENANT}`); process.exit(1); }
    console.log(`tenant ${TENANT} buffer profileMap keys: ${Object.keys(cred.profileMap ?? {}).join(', ') || '(none)'}`);
    console.log(`profileMap: ${JSON.stringify(cred.profileMap ?? {})}\n`);

    // 1) Introspect the Channel type so we know exactly which fields exist.
    const intro = await gql(cred.token, CHANNEL_FIELDS);
    const fields = intro.body?.data?.__type?.fields ?? [];
    const fieldNames = fields.map((f) => f.name);
    console.log(`Channel type fields: ${fieldNames.join(', ') || '(introspection failed)'}\n`);

    // 2) `channels` needs input: ChannelsInput! — introspect its required fields.
    const ci = await gql(cred.token, `{ __type(name: "ChannelsInput") { inputFields { name type { name kind ofType { name kind } } } } }`);
    const ciFields = ci.body?.data?.__type?.inputFields ?? [];
    console.log(`ChannelsInput fields: ${ciFields.map((f) => `${f.name}:${f.type?.ofType?.name ?? f.type?.name ?? f.type?.kind}`).join(', ')}\n`);

    // 3) Resolve APIRE's organizationId from the known LinkedIn channel.
    const linkedinId = cred.profileMap?.linkedin;
    let organizationId = null;
    // Variable-bound channel() call resolves the org that owns the LinkedIn channel.
    const ogRes = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cred.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `query($input: ChannelInput!){ channel(input:$input){ id organizationId service } }`,
        variables: { input: { id: linkedinId } },
      }),
    });
    const ogBody = await ogRes.json().catch(() => null);
    organizationId = ogBody?.data?.channel?.organizationId ?? null;
    console.log(`resolved organizationId from linkedin channel: ${organizationId} (service=${ogBody?.data?.channel?.service})\n`);

    // 4) Select scalar fields useful for identifying the X account.
    const want = ['id', 'name', 'displayName', 'service', 'serviceId', 'organizationId', 'descriptor', 'isDisconnected', 'isLocked'];
    const sel = want.filter((f) => fieldNames.includes(f));
    if (!sel.includes('id')) sel.unshift('id');
    const query = `query($input: ChannelsInput!){ channels(input:$input){ ${sel.join(' ')} } }`;
    console.log(`query: ${query}\n  input: { organizationId: ${organizationId} }\n`);

    const res2 = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cred.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { input: organizationId ? { organizationId } : {} } }),
    });
    const status = res2.status;
    const body = await res2.json().catch(() => null);
    const channels = body?.data?.channels;
    if (Array.isArray(channels) && channels.length) {
      console.log(`=== ${channels.length} CHANNEL(S) (HTTP ${status}) ===`);
      for (const c of channels) console.log(`  ${JSON.stringify(c)}`);
      const x = channels.filter((c) => /twitter|^x$/i.test(String(c.service ?? '')));
      console.log(`\nX/Twitter channel(s): ${x.length ? JSON.stringify(x) : 'NONE FOUND'}`);
    } else {
      console.log(`No channels returned (HTTP ${status}). errors=${JSON.stringify(body?.errors ?? null)}`);
      console.log('full body:', JSON.stringify(body, null, 2));
    }
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
