// Verifies all platform connections with REAL API calls against the stored
// (decrypted) credentials — not just "is a row present" but "does the live API
// accept it". Read-only: it never writes the DB and never prints secret values
// (only account labels / ids / counts / booleans the APIs return).
//
//   npx tsx --env-file=.env scripts/verify-connections.mjs
//
// Keep this script — it's the health-check for all platform connections.

import { Pool } from '@neondatabase/serverless';
import { decryptSecret } from '../src/lib/secrets.ts';

const TENANTS = [
  { id: '6daebc34-7fd0-4542-8527-cfcd125a5f72', name: 'APIRE' },
  { id: '4cc53768-a7c3-4869-8250-f73b244ca315', name: 'OSM' },
];

const KEY = process.env.SECRETS_KEY;
const DB_URL = process.env.DATABASE_URL;
const G_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const G_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
if (!KEY || !DB_URL) {
  console.error('SECRETS_KEY and DATABASE_URL must be set (run with --env-file=.env)');
  process.exit(1);
}

const bearer = (t) => ({ Authorization: `Bearer ${t}` });
const short = (e) => String(e?.message ?? e).slice(0, 120);

async function loadSecret(client, tenantId, platform) {
  const r = await client.query(
    `SELECT encrypted_access_token, encrypted_refresh_token, encrypted_profile_map,
            scopes, token_expires_at
       FROM marketing.tenant_secrets
      WHERE tenant_id = $1 AND platform = $2`,
    [tenantId, platform],
  );
  const row = r.rows[0];
  if (!row || !row.encrypted_access_token) return null;
  const accessToken = await decryptSecret(row.encrypted_access_token, KEY);
  const refreshToken = row.encrypted_refresh_token
    ? await decryptSecret(row.encrypted_refresh_token, KEY)
    : null;
  let profileMap = null;
  if (row.encrypted_profile_map) {
    try {
      profileMap = JSON.parse(await decryptSecret(row.encrypted_profile_map, KEY));
    } catch {
      /* malformed / rotated key */
    }
  }
  return {
    accessToken,
    refreshToken,
    profileMap,
    scopes: row.scopes ?? null,
    expiresAt: row.token_expires_at ? new Date(row.token_expires_at) : null,
  };
}

async function verifyBuffer(s) {
  if (!s) return { ok: false, error: 'not connected (no credential)' };
  try {
    const res = await fetch('https://api.buffer.com/graphql', {
      method: 'POST',
      headers: { ...bearer(s.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ account { id email name } }' }),
    });
    if (res.status === 401 || res.status === 403) return { ok: false, error: `auth rejected (${res.status})` };
    const body = await res.json().catch(() => null);
    const acct = body?.data?.account;
    if (!acct?.id) return { ok: false, error: body?.errors ? 'token rejected' : `unexpected response (${res.status})` };
    const keys = Object.keys(s.profileMap ?? {});
    return {
      ok: true,
      account: acct.email ?? acct.name ?? acct.id,
      detail: `LinkedIn: ${s.profileMap?.linkedin ? 'mapped ✅' : 'NOT mapped ❌'}${keys.length ? ` (keys: ${keys.join(', ')})` : ''}`,
    };
  } catch (e) {
    return { ok: false, error: `network: ${short(e)}` };
  }
}

async function verifyHubspot(s) {
  if (!s) return { ok: false, error: 'not connected (no credential)' };
  try {
    const res = await fetch('https://api.hubapi.com/crm/v3/objects/contacts?limit=1', { headers: bearer(s.accessToken) });
    if (res.status === 401 || res.status === 403) return { ok: false, error: `auth rejected (${res.status})` };
    if (!res.ok) return { ok: false, error: `http ${res.status}` };
    let portal = null;
    try {
      const ar = await fetch('https://api.hubapi.com/account-info/v3/details', { headers: bearer(s.accessToken) });
      if (ar.ok) {
        const aj = await ar.json().catch(() => null);
        portal = aj?.portalId != null ? `Portal ${aj.portalId}` : null;
      }
    } catch { /* best-effort label */ }
    let count = null;
    try {
      const sr = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/search', {
        method: 'POST',
        headers: { ...bearer(s.accessToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 1 }),
      });
      if (sr.ok) {
        const sj = await sr.json().catch(() => null);
        if (typeof sj?.total === 'number') count = sj.total;
      }
    } catch { /* best-effort count */ }
    return { ok: true, account: portal, detail: `Contacts: ${count == null ? 'reachable' : `${count} found`}` };
  } catch (e) {
    return { ok: false, error: `network: ${short(e)}` };
  }
}

async function verifySendgrid(s) {
  if (!s) return { ok: false, error: 'not connected (no credential)' };
  try {
    const res = await fetch('https://api.sendgrid.com/v3/user/profile', { headers: bearer(s.accessToken) });
    if (res.status === 401 || res.status === 403) return { ok: false, error: `auth rejected (${res.status})` };
    if (!res.ok) return { ok: false, error: `http ${res.status}` };
    let email = null;
    try {
      const er = await fetch('https://api.sendgrid.com/v3/user/email', { headers: bearer(s.accessToken) });
      if (er.ok) email = (await er.json().catch(() => null))?.email ?? null;
    } catch { /* best-effort label */ }
    let webhook = { enabled: null, url: null };
    try {
      const wr = await fetch('https://api.sendgrid.com/v3/user/webhooks/event/settings', { headers: bearer(s.accessToken) });
      if (wr.ok) {
        const wj = await wr.json().catch(() => null);
        webhook = { enabled: wj?.enabled === true, url: wj?.url ?? null };
      } else {
        webhook = { enabled: null, url: null, error: `http ${wr.status}` };
      }
    } catch (e) { webhook = { enabled: null, url: null, error: short(e) }; }
    let domains = [];
    try {
      const dr = await fetch('https://api.sendgrid.com/v3/whitelabel/domains?limit=50', { headers: bearer(s.accessToken) });
      if (dr.ok) {
        const dj = await dr.json().catch(() => null);
        if (Array.isArray(dj)) domains = dj.map((d) => ({ domain: d.domain, verified: d.valid === true }));
      }
    } catch { /* best-effort */ }
    return { ok: true, account: email, webhook, domains };
  } catch (e) {
    return { ok: false, error: `network: ${short(e)}` };
  }
}

async function verifyGoogle(s) {
  if (!s) return { ok: false, error: 'not connected — reconnect via browser OAuth', manual: true };
  let accessToken = s.accessToken;
  let refreshed = false;
  const stale = !s.expiresAt || s.expiresAt.getTime() < Date.now() + 5 * 60 * 1000;
  if (stale) {
    if (!s.refreshToken) return { ok: false, error: 'token stale and no refresh token — reconnect via browser OAuth', manual: true };
    if (!G_CLIENT_ID || !G_CLIENT_SECRET) return { ok: false, error: 'GOOGLE_CLIENT_ID/SECRET not in .env — cannot refresh' };
    try {
      const tr = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          refresh_token: s.refreshToken,
          client_id: G_CLIENT_ID,
          client_secret: G_CLIENT_SECRET,
          grant_type: 'refresh_token',
        }),
      });
      if (!tr.ok) return { ok: false, error: `token refresh failed (${tr.status}) — may need reconnect`, manual: tr.status === 400 };
      const tj = await tr.json().catch(() => null);
      if (!tj?.access_token) return { ok: false, error: 'refresh returned no access_token' };
      accessToken = tj.access_token;
      refreshed = true;
    } catch (e) {
      return { ok: false, error: `refresh network: ${short(e)}` };
    }
  }
  try {
    const res = await fetch('https://searchconsole.googleapis.com/webmasters/v3/sites', { headers: bearer(accessToken) });
    if (res.status === 401 || res.status === 403) return { ok: false, error: `GSC auth rejected (${res.status})`, refreshed };
    if (!res.ok) return { ok: false, error: `GSC http ${res.status}`, refreshed };
    const body = await res.json().catch(() => null);
    const sites = (body?.siteEntry ?? []).map((e) => ({ siteUrl: e.siteUrl, level: e.permissionLevel }));
    const apire = sites.find((x) => /apire\.io/i.test(x.siteUrl));
    return {
      ok: true,
      account: s.profileMap?.email ?? null,
      refreshed,
      detail: `GSC: ${sites.length} site(s)${apire ? `, apire.io: ${apire.level !== 'siteUnverifiedUser' ? 'verified ✅' : 'unverified ❌'}` : ', apire.io: not in list'}`,
      sites: sites.map((x) => x.siteUrl),
    };
  } catch (e) {
    return { ok: false, error: `GSC network: ${short(e)}`, refreshed };
  }
}

function mark(r) {
  return r.ok ? '✅' : (r.manual ? '⚠️ ' : '❌');
}

async function main() {
  const pool = new Pool({ connectionString: DB_URL });
  const client = await pool.connect();
  const report = {};
  try {
    await client.query("SELECT set_config('app.rls_bypass', 'true', false)");
    for (const t of TENANTS) {
      const [buf, hub, sg, goog] = await Promise.all([
        loadSecret(client, t.id, 'buffer'),
        loadSecret(client, t.id, 'hubspot'),
        loadSecret(client, t.id, 'sendgrid'),
        loadSecret(client, t.id, 'google'),
      ]);
      report[t.name] = {
        buffer: await verifyBuffer(buf),
        hubspot: await verifyHubspot(hub),
        sendgrid: await verifySendgrid(sg),
        google: await verifyGoogle(goog),
      };
    }
  } finally {
    client.release();
    await pool.end();
  }

  console.log('\n=== HAILMERY CONNECTION VERIFICATION ===');
  for (const [name, r] of Object.entries(report)) {
    console.log(`\n${name}`);
    console.log('─'.repeat(72));
    const b = r.buffer, h = r.hubspot, s = r.sendgrid, g = r.google;
    console.log(`Buffer    ${mark(b)}  ${b.account ?? b.error ?? ''}  ${b.detail ?? ''}`.trimEnd());
    console.log(`HubSpot   ${mark(h)}  ${h.account ?? h.error ?? ''}  ${h.detail ?? ''}`.trimEnd());
    const sgDom = s.ok ? `Domains: ${s.domains?.length ? s.domains.map((d) => `${d.domain} ${d.verified ? '✅' : '⚠️'}`).join(', ') : 'none'} · Webhook: ${s.webhook?.enabled === true ? 'ON ✅' : s.webhook?.enabled === false ? 'OFF ⚠️' : `unknown${s.webhook?.error ? ` (${s.webhook.error})` : ''}`}` : '';
    console.log(`SendGrid  ${mark(s)}  ${s.account ?? s.error ?? ''}`.trimEnd());
    if (s.ok) console.log(`             ${sgDom}`);
    console.log(`Google    ${mark(g)}  ${g.account ?? g.error ?? ''}  ${g.detail ?? ''}${g.refreshed ? ' (token refreshed)' : ''}`.trimEnd());
    if (g.ok && g.sites?.length) console.log(`             sites: ${g.sites.join(', ')}`);
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
