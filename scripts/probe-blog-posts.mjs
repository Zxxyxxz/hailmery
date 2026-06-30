// Probe the live Wix List Posts API + DB merge for the new GET /api/blog/posts
// route, against APIRE's real credentials — no deploy needed.
//   pnpm exec tsx --env-file=.env scripts/probe-blog-posts.mjs
import { makeDb } from '../src/db/client.ts';
import { withTenantDb } from '../src/lib/tenant.ts';
import { loadSecret } from '../src/lib/credentials.ts';
import { sql } from 'drizzle-orm';

const APIRE = '6daebc34-7fd0-4542-8527-cfcd125a5f72';
const db = makeDb(process.env.DATABASE_URL);
const s = await loadSecret(db, APIRE, 'wix-blog', process.env.SECRETS_KEY);
if (!s?.accessToken || !s.profileMap?.wixSiteId) {
  console.log('NOT CONNECTED:', { hasToken: !!s?.accessToken, siteId: s?.profileMap?.wixSiteId });
  process.exit(0);
}
const headers = { Authorization: s.accessToken, 'wix-site-id': s.profileMap.wixSiteId, 'Content-Type': 'application/json' };

// ── Step B: page published posts exactly like the route ──
const wixPosts = [];
const PAGE = 100;
let metaSample = null;
for (let offset = 0; offset < 5000; offset += PAGE) {
  const params = new URLSearchParams({ 'paging.limit': String(PAGE), 'paging.offset': String(offset), fieldsets: 'URL' });
  const resp = await fetch(`https://www.wixapis.com/blog/v3/posts?${params}`, { headers });
  if (!resp.ok) { console.log('WIX ERROR', resp.status, await resp.text()); process.exit(1); }
  const data = await resp.json();
  if (!metaSample) metaSample = data.metaData ?? data.pagingMetadata ?? Object.keys(data);
  const batch = data.posts ?? [];
  wixPosts.push(...batch);
  const total = data.metaData?.total;
  if (batch.length < PAGE) break;
  if (typeof total === 'number' && offset + batch.length >= total) break;
}

console.log('\n=== WIX LIST POSTS ===');
console.log('count:', wixPosts.length);
console.log('metaData/keys sample:', JSON.stringify(metaSample));
const sample = wixPosts[0] ?? {};
console.log('sample post keys:', Object.keys(sample));
console.log('sample post:', JSON.stringify({
  id: sample.id, title: sample.title, slug: sample.slug,
  firstPublishedDate: sample.firstPublishedDate, lastPublishedDate: sample.lastPublishedDate, url: sample.url,
}, null, 2));

// ── Step C: hailmery published blog drafts (same SQL + RLS as the route) ──
const rows = await withTenantDb(db, APIRE, async (tx) => {
  const r = await tx.execute(sql`
    SELECT cd.id AS draft_id, cd.published_ref AS published_ref,
           cd.payload->>'title' AS title, cd.payload->>'slug' AS slug,
           cd.guardian_breakdown AS guardian_breakdown,
           cd.payload->>'guardianScore' AS payload_guardian_score,
           cd.campaign_id AS campaign_id, cam.name AS campaign_name,
           (SELECT MAX(pl.published_at) FROM marketing.publish_log pl
             WHERE pl.draft_id = cd.id AND pl.tenant_id = ${APIRE}) AS published_at
    FROM marketing.content_drafts cd
    LEFT JOIN marketing.campaigns cam ON cam.id = cd.campaign_id AND cam.tenant_id = ${APIRE}
    WHERE cd.tenant_id = ${APIRE} AND lower(cd.channel) IN ('blog','wix-blog')
      AND cd.status = 'published'
    ORDER BY published_at DESC NULLS LAST`);
  return r.rows;
});

console.log('\n=== HAILMERY PUBLISHED BLOG DRAFTS ===');
console.log('count:', rows.length);
for (const r of rows) {
  console.log(`  - draft ${String(r.draft_id).slice(0, 8)} | ref=${JSON.stringify(r.published_ref)} | slug=${JSON.stringify(r.slug)} | title=${JSON.stringify(r.title)} | gb.overall=${r.guardian_breakdown?.overall} | payloadScore=${r.payload_guardian_score} | pubAt=${r.published_at}`);
}

// ── Step D: replicate the merge/match logic ──
const lastSlug = (x) => { if (!x) return null; const c = String(x).split(/[?#]/)[0].replace(/\/+$/, ''); const seg = c.split('/').pop() ?? ''; return seg ? seg.toLowerCase() : null; };
const normTitle = (x) => { if (!x) return null; const t = String(x).trim().toLowerCase(); return t || null; };
const wixUrl = (wp) => { const u = wp.url; if (typeof u === 'string') return u || null; if (u && (u.base || u.path)) return `${u.base ?? ''}${u.path ?? ''}` || null; return null; };

const byKey = new Map();
const add = (k, row) => { if (k && !byKey.has(k)) byKey.set(k, row); };
for (const row of rows) {
  if (row.published_ref) { add(`id:${row.published_ref}`, row); const rs = lastSlug(row.published_ref); if (rs) add(`slug:${rs}`, row); }
  if (row.slug) add(`slug:${String(row.slug).toLowerCase()}`, row);
  const t = normTitle(row.title); if (t) add(`title:${t}`, row);
}
const match = (wp) => {
  const url = wixUrl(wp), us = lastSlug(url), tk = normTitle(wp.title);
  return byKey.get(`id:${wp.id}`) ?? (url ? byKey.get(`id:${url}`) : undefined)
    ?? (wp.slug ? byKey.get(`slug:${String(wp.slug).toLowerCase()}`) : undefined)
    ?? (us ? byKey.get(`slug:${us}`) : undefined) ?? (tk ? byKey.get(`title:${tk}`) : undefined);
};

let hailmery = 0;
const matchedTitles = [];
for (const wp of wixPosts) { const m = match(wp); if (m) { hailmery++; matchedTitles.push(wp.title); } }

console.log('\n=== MERGE RESULT ===');
console.log('total:', wixPosts.length, '| hailmery:', hailmery, '| preExisting:', wixPosts.length - hailmery);
console.log('matched hailmery posts:', JSON.stringify(matchedTitles, null, 2));
process.exit(0);
