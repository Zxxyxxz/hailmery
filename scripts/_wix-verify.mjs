// Verify the just-published APIRE blog post has cover media attached.
//   pnpm exec tsx --env-file=.env scripts/_wix-verify.mjs
// Never prints the API key.

import { makeDb } from '../src/db/client.ts';
import { loadSecret } from '../src/lib/credentials.ts';

const APIRE = '6daebc34-7fd0-4542-8527-cfcd125a5f72';
const BLOG = 'https://www.wixapis.com/blog/v3';
const db = makeDb(process.env.DATABASE_URL);
const s = await loadSecret(db, APIRE, 'wix-blog', process.env.SECRETS_KEY);
const headers = { Authorization: s.accessToken, 'Content-Type': 'application/json', 'wix-site-id': s.profileMap.wixSiteId };

// List recent draft posts and find the one we just published (NIS2 gateway).
const list = await fetch(`${BLOG}/draft-posts?paging.limit=25&fieldsets=URL`, { headers });
const lj = await list.json();
const posts = lj.draftPosts ?? [];
const match = posts.find((p) => /AI gateway|NIS2/i.test(p.title ?? '')) ?? posts[0];
if (!match) { console.log('No draft posts found:', JSON.stringify(lj).slice(0, 300)); process.exit(1); }

// Get full detail (media is returned on the draft post object).
const got = await fetch(`${BLOG}/draft-posts/${match.id}?fieldsets=URL`, { headers });
const gj = await got.json();
const post = gj.draftPost ?? match;

console.log('Wix post id:   ', post.id);
console.log('Title:         ', post.title);
console.log('Status:        ', post.status);
console.log('URL:           ', post.url ? `${post.url.base ?? ''}${post.url.path ?? ''}` : '(n/a)');
console.log('media:         ', JSON.stringify(post.media ?? null));
const img = post.media?.wixMedia?.image;
console.log(img?.id ? `\n✅ COVER IMAGE ATTACHED — wixMedia.image.id=${img.id}\n   url=${img.url}` : '\n❌ NO COVER MEDIA on the post');
process.exit(0);
