// Wix Blog publish → fetch round-trip prototype (V0 point #9).
//
// NOT production code — a sanity check that the Wix Blog Draft Posts API
// accepts a write from a server-side API key, returns an id, and the
// matching GET returns the post.
//
// Required env:
//   WIX_API_KEY     — account-level API key from https://manage.wix.com/account/api-keys
//   WIX_ACCOUNT_ID  — the Wix account ID (UUID)
//   WIX_SITE_ID     — the APIRE site ID (UUID)
//
// Docs:
//   https://dev.wix.com/docs/rest/business-solutions/blog/draft-posts
//   Auth headers per https://dev.wix.com/docs/rest/articles/getting-started/api-keys

const WIX_BASE = 'https://www.wixapis.com';

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

async function wixFetch(path: string, init: RequestInit = {}) {
  const apiKey = need('WIX_API_KEY');
  const accountId = need('WIX_ACCOUNT_ID');
  const siteId = need('WIX_SITE_ID');
  const res = await fetch(WIX_BASE + path, {
    ...init,
    headers: {
      'Authorization': apiKey,
      'wix-account-id': accountId,
      'wix-site-id': siteId,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!res.ok) {
    throw new Error(`Wix ${res.status} ${path}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
  }
  return body as Record<string, unknown>;
}

interface DraftPost {
  id: string;
  title: string;
  status?: string;
}

async function createDraftPost(): Promise<DraftPost> {
  const body = {
    draftPost: {
      title: `hailmery V0 round-trip — ${new Date().toISOString()}`,
      memberId: undefined, // optional
      richContent: {
        nodes: [
          {
            type: 'PARAGRAPH',
            id: 'p1',
            nodes: [
              {
                type: 'TEXT',
                id: 't1',
                textData: { text: 'This is a V0 prototype draft. Safe to delete.' },
              },
            ],
          },
        ],
      },
    },
  };

  const res = await wixFetch('/blog/v3/draft-posts', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  const dp = (res as { draftPost?: DraftPost }).draftPost;
  if (!dp?.id) throw new Error(`Unexpected create response: ${JSON.stringify(res)}`);
  return dp;
}

async function getDraftPost(id: string): Promise<DraftPost> {
  const res = await wixFetch(`/blog/v3/draft-posts/${id}`, { method: 'GET' });
  const dp = (res as { draftPost?: DraftPost }).draftPost;
  if (!dp?.id) throw new Error(`Unexpected get response: ${JSON.stringify(res)}`);
  return dp;
}

async function main() {
  console.log('[wix] creating draft post...');
  const created = await createDraftPost();
  console.log(`[wix] created id=${created.id} title="${created.title}"`);

  console.log('[wix] fetching by id...');
  const fetched = await getDraftPost(created.id);
  console.log(`[wix] fetched id=${fetched.id} title="${fetched.title}"`);

  if (fetched.id !== created.id) {
    console.error('✗ id mismatch');
    process.exit(1);
  }

  console.log('\n✓ Wix Blog publish→fetch round-trip succeeded.');
  console.log(`  Draft remains on the Wix site — delete from the admin UI when done.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`✗ ${err.message ?? err}`);
    process.exit(1);
  });
