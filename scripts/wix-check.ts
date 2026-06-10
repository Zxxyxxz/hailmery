// scripts/wix-check.ts — confirm a published Wix post exists in the tenant's
// actual Wix site, using the SAME wixSiteId the publish adapter used (decrypted
// from tenant_secrets, which may differ from .env WIX_SITE_ID).
//
//   tsx --env-file=.env scripts/wix-check.ts <tenantId> [titleSubstr]

import { Pool } from '@neondatabase/serverless';
import { decryptSecret } from '../src/lib/secrets.js';

const tenantId = process.argv[2];
const titleSub = (process.argv[3] ?? '').toLowerCase();
if (!tenantId) {
  console.error('usage: tsx --env-file=.env scripts/wix-check.ts <tenantId> [titleSubstr]');
  process.exit(1);
}

const url = process.env.DATABASE_URL!;
const key = process.env.SECRETS_KEY!;
const pool = new Pool({ connectionString: url });
const client = await pool.connect();
let apiKey = '';
let siteId = '';
try {
  await client.query('BEGIN');
  await client.query("SELECT set_config('app.rls_bypass', 'true', true)");
  const r = await client.query(
    "SELECT encrypted_access_token, encrypted_profile_map FROM marketing.tenant_secrets WHERE tenant_id=$1 AND platform='wix-blog' LIMIT 1",
    [tenantId],
  );
  await client.query('COMMIT');
  if (!r.rows[0]) throw new Error('no wix-blog secret for tenant');
  apiKey = await decryptSecret(r.rows[0].encrypted_access_token, key);
  const profile = JSON.parse(await decryptSecret(r.rows[0].encrypted_profile_map, key));
  siteId = profile.wixSiteId;
  console.error(`[wix-check] using wixSiteId=${siteId}`);
} finally {
  client.release();
  await pool.end();
}

async function listPosts(path: string, label: string) {
  const res = await fetch(`https://www.wixapis.com/blog/v3/${path}`, {
    headers: { Authorization: apiKey, 'wix-site-id': siteId },
  });
  const txt = await res.text();
  let data: any;
  try {
    data = JSON.parse(txt);
  } catch {
    console.log(`${label}: HTTP ${res.status} (non-JSON) ${txt.slice(0, 200)}`);
    return;
  }
  const posts = (data.posts ?? data.draftPosts ?? []).map((p: any) => ({
    id: p.id,
    title: p.title,
    status: p.status,
    firstPublished: p.firstPublishedDate,
  }));
  const filtered = titleSub ? posts.filter((p: any) => (p.title ?? '').toLowerCase().includes(titleSub)) : posts;
  console.log(`${label} (HTTP ${res.status}): ${filtered.length} match / ${posts.length} total`);
  for (const p of filtered.slice(0, 5)) console.log('  ', JSON.stringify(p));
}

await listPosts('posts?paging.limit=20&fieldsets=URL', 'PUBLISHED posts');
await listPosts('draft-posts?paging.limit=20', 'DRAFT posts');
process.exit(0);
