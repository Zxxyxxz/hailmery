// Mint a session JWT (same signer/secret as prod) and hit the DEPLOYED
// GET /api/blog/posts to verify the live endpoint end-to-end.
//   pnpm exec tsx --env-file=.env scripts/mint-and-check-blog.mjs
import { signJwt } from '../src/lib/auth.ts';

const APIRE = '6daebc34-7fd0-4542-8527-cfcd125a5f72';
const API = 'https://hailmery-api.bezekyigit0.workers.dev';

if (!process.env.JWT_SECRET) { console.log('NO JWT_SECRET in env'); process.exit(0); }

const token = await signJwt(
  { email: 'bezekyigit0@gmail.com', name: 'Yigit', allowedTenants: [APIRE], userId: '00000000-0000-0000-0000-000000000000' },
  process.env.JWT_SECRET,
);

const resp = await fetch(`${API}/api/blog/posts`, {
  headers: { Authorization: `Bearer ${token}`, 'X-Tenant-ID': APIRE },
});
console.log('HTTP', resp.status);
const data = await resp.json();
if (resp.status !== 200) { console.log(JSON.stringify(data)); process.exit(0); }
const hail = data.posts?.find((p) => p.source === 'hailmery');
const pre = data.posts?.find((p) => p.source === 'pre_existing');
console.log(JSON.stringify({
  wixConnected: data.wixConnected,
  stats: data.stats,
  postsReturned: data.posts?.length,
  sampleHailmery: hail && { title: hail.title, guardianScore: hail.guardianScore, campaignName: hail.campaignName, url: hail.url },
  samplePreExisting: pre && { title: pre.title, source: pre.source, url: pre.url },
}, null, 2));
process.exit(0);
