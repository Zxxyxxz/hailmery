// Republish the hailmery-generated APIRE blog posts in place with corrected
// Ricos (Session 6 markdown→Ricos fix). Updates each existing draft post's
// richContent via PATCH and re-publishes — preserving the post URL, cover image,
// and the inline body image (reused from the current post).
//
//   pnpm exec tsx --env-file=.env scripts/wix-republish.mjs        # dry run (no writes)
//   pnpm exec tsx --env-file=.env scripts/wix-republish.mjs --apply
//
// Scope is inherently limited to our content_drafts rows (the 90+ Wix-native
// posts are not in our DB and are never touched). Never prints the API key.

import { toRicos, buildInlineImageNode, insertInlineImageNode } from '../src/adapters/wix-blog.ts';
import { makeDb } from '../src/db/client.ts';
import { loadSecret } from '../src/lib/credentials.ts';

const APPLY = process.argv.includes('--apply');
const APIRE = '6daebc34-7fd0-4542-8527-cfcd125a5f72';
const BLOG = 'https://www.wixapis.com/blog/v3';
const db = makeDb(process.env.DATABASE_URL);
const s = await loadSecret(db, APIRE, 'wix-blog', process.env.SECRETS_KEY);
const headers = { Authorization: s.accessToken, 'Content-Type': 'application/json', 'wix-site-id': s.profileMap.wixSiteId };

const slugOf = (url) => (url ?? '').split('/post/')[1]?.replace(/[/?#].*$/, '') ?? '';
const pathOf = (u) => (typeof u === 'object' ? `${u?.path ?? ''}` : (u ?? ''));

function findImageNode(nodes) {
  let found = null;
  (function w(ns) { for (const n of ns ?? []) { if (n.type === 'IMAGE' && !found) found = n; if (n.nodes) w(n.nodes); } })(nodes);
  return found;
}
function nodeTypes(nodes) {
  const t = {};
  (function w(ns) { for (const n of ns ?? []) { t[n.type] = (t[n.type] ?? 0) + 1; if (n.nodes) w(n.nodes); } })(nodes);
  return t;
}
function literalLeaks(nodes) {
  const hits = [];
  (function w(ns) { for (const n of ns ?? []) {
    const txt = (n.nodes ?? []).filter((c) => c.type === 'TEXT').map((c) => c.textData?.text ?? '').join('');
    if (/(^|\s)#{1,6}\s|\*\*|^\s*---\s*$/.test(txt)) hits.push(`${n.type}: ${txt.slice(0, 60)}`);
    if (n.nodes) w(n.nodes);
  } })(nodes);
  return hits;
}

// The 3 hailmery-published posts (status=published, has a Wix URL).
const rows = await db.execute(
  "SELECT id, payload->>'title' AS title, payload->>'body' AS body, published_ref FROM marketing.content_drafts WHERE channel IN ('wix-blog','blog') AND status='published' AND published_ref IS NOT NULL ORDER BY updated_at DESC",
);
const drafts = rows.rows ?? rows;

// Map slug → Wix draft-post id.
const list = await fetch(`${BLOG}/draft-posts?paging.limit=100&fieldsets=URL`, { headers });
const posts = (await list.json()).draftPosts ?? [];

console.log(`Mode: ${APPLY ? 'APPLY (live writes)' : 'DRY RUN (no writes)'}\n`);

for (const d of drafts) {
  const slug = slugOf(d.published_ref);
  const wix = posts.find((p) => pathOf(p.url).includes(slug));
  console.log(`\n=== ${d.title}`);
  console.log(`    db_draft=${d.id}  slug=${slug}`);
  if (!wix) { console.log('    ❌ no matching Wix draft-post — skipping'); continue; }

  // Fetch current richContent (to reuse the existing inline IMAGE node) + media.
  const cur = await (await fetch(`${BLOG}/draft-posts/${wix.id}?fieldsets=RICH_CONTENT`, { headers })).json();
  const curPost = cur.draftPost ?? {};
  const beforeTypes = nodeTypes(curPost.richContent?.nodes ?? []);
  const existingImg = findImageNode(curPost.richContent?.nodes ?? []);
  const coverId = curPost.media?.wixMedia?.image?.id;

  // Build corrected Ricos; re-insert the inline image (reuse existing node, or
  // rebuild from the cover media id) before the first H2.
  const doc = toRicos(d.body);
  if (existingImg) insertInlineImageNode(doc.nodes, existingImg);
  else if (coverId) insertInlineImageNode(doc.nodes, buildInlineImageNode(coverId, d.title, d.title));

  const afterTypes = nodeTypes(doc.nodes);
  const beforeLeaks = literalLeaks(curPost.richContent?.nodes ?? []).length;
  const afterLeaks = literalLeaks(doc.nodes).length;
  console.log(`    wix_id=${wix.id}  status=${wix.status}`);
  console.log(`    before: types=${JSON.stringify(beforeTypes)} literalLeaks=${beforeLeaks}`);
  console.log(`    after:  types=${JSON.stringify(afterTypes)} literalLeaks=${afterLeaks}  inlineImage=${!!(existingImg || coverId)}`);

  if (!APPLY) continue;

  // PATCH richContent, then publish (re-publishes the live post in place).
  const patch = await fetch(`${BLOG}/draft-posts/${wix.id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ draftPost: { id: wix.id, richContent: { nodes: doc.nodes } } }),
  });
  if (!patch.ok) { console.log(`    ❌ PATCH failed: HTTP ${patch.status} ${(await patch.text()).slice(0, 200)}`); continue; }
  const pub = await fetch(`${BLOG}/draft-posts/${wix.id}/publish`, { method: 'POST', headers });
  if (!pub.ok) { console.log(`    ❌ publish failed: HTTP ${pub.status} ${(await pub.text()).slice(0, 200)}`); continue; }

  // Verify: re-fetch and confirm real nodes + zero literal markdown.
  const ver = await (await fetch(`${BLOG}/draft-posts/${wix.id}?fieldsets=RICH_CONTENT`, { headers })).json();
  const vNodes = ver.draftPost?.richContent?.nodes ?? [];
  const vTypes = nodeTypes(vNodes);
  const vLeaks = literalLeaks(vNodes);
  const ok = (vTypes.HEADING > 0 || vTypes.BULLETED_LIST > 0) && vLeaks.length === 0;
  console.log(`    ${ok ? '✅' : '❌'} republished: types=${JSON.stringify(vTypes)} literalLeaks=${vLeaks.length}`);
  console.log(`    live: ${pathOf(wix.url) ? 'https://www.apire.io' + pathOf(wix.url) : d.published_ref}`);
  if (vLeaks.length) vLeaks.slice(0, 4).forEach((h) => console.log(`       • still literal: ${h}`));
}
process.exit(0);
