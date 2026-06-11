// Verify a published APIRE Wix post renders as real Ricos (no literal markdown).
//   pnpm exec tsx --env-file=.env scripts/wix-verify-post.mjs <slug-substr> [<slug-substr> ...]
import { makeDb } from '../src/db/client.ts';
import { loadSecret } from '../src/lib/credentials.ts';

const APIRE = '6daebc34-7fd0-4542-8527-cfcd125a5f72';
const BLOG = 'https://www.wixapis.com/blog/v3';
const db = makeDb(process.env.DATABASE_URL);
const s = await loadSecret(db, APIRE, 'wix-blog', process.env.SECRETS_KEY);
const headers = { Authorization: s.accessToken, 'wix-site-id': s.profileMap.wixSiteId };

const wanted = process.argv.slice(2);
const pathOf = (u) => (typeof u === 'object' ? `${u?.path ?? ''}` : (u ?? ''));
const posts = (await (await fetch(`${BLOG}/draft-posts?paging.limit=100&fieldsets=URL`, { headers })).json()).draftPosts ?? [];

for (const sub of wanted) {
  const p = posts.find((x) => pathOf(x.url).includes(sub));
  if (!p) { console.log(`\n❌ ${sub}: not found`); continue; }
  const post = (await (await fetch(`${BLOG}/draft-posts/${p.id}?fieldsets=RICH_CONTENT`, { headers })).json()).draftPost ?? {};
  const nodes = post.richContent?.nodes ?? [];
  const types = {};
  const leaks = [];
  (function w(ns) { for (const n of ns ?? []) {
    types[n.type] = (types[n.type] ?? 0) + 1;
    const t = (n.nodes ?? []).filter((c) => c.type === 'TEXT').map((c) => c.textData?.text ?? '').join('');
    if (/(^|\s)#{1,6}\s|\*\*|^\s*---\s*$|\[[^\]]+\]\([^)]+\)/.test(t)) leaks.push(`${n.type}: ${t.slice(0, 56)}`);
    if (n.nodes) w(n.nodes);
  } })(nodes);
  const cover = post.media?.wixMedia?.image?.id;
  const ok = (types.HEADING > 0 || types.BULLETED_LIST > 0) && leaks.length === 0;
  console.log(`\n${ok ? '✅' : '❌'} ${pathOf(p.url)}  [${p.status}]`);
  console.log(`   types: ${JSON.stringify(types)}`);
  console.log(`   inline image: ${types.IMAGE > 0 ? 'yes' : 'no'}   cover media: ${cover ? 'yes (' + cover.slice(0, 28) + '…)' : 'no'}`);
  console.log(`   literal-markdown leaks: ${leaks.length}`);
  leaks.slice(0, 5).forEach((h) => console.log(`      • ${h}`));
}
process.exit(0);
