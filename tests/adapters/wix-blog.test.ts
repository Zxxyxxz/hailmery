import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WixBlogAdapter, type WixBlogCredentials } from '../../src/adapters/wix-blog.js';
import type { ContentDraft } from '../../src/db/schema.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const creds: WixBlogCredentials = {
  accessToken: 'wix_test_key',
  extra: { wixSiteId: 'site-id-abc', wixMemberId: 'member-xyz' },
};

function makeDraft(overrides: Partial<ContentDraft> = {}): ContentDraft {
  return {
    id: 'draft-1',
    tenantId: 'tenant-1',
    campaignId: null,
    siteId: 'site-1',
    pillar: null,
    channel: 'wix-blog',
    status: 'approved',
    payload: {
      title: 'NIS2 Compliance Guide',
      excerpt: 'A primer on EU NIS2 requirements',
      body: 'Rich text content\n\nSecond paragraph',
    },
    assets: {},
    scoreHuman: null,
    dismissReason: null,
    publishAt: null,
    publishedRef: null,
    costCents: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as ContentDraft;
}

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
    headers: new Headers(),
  };
}

describe('WixBlogAdapter', () => {
  let adapter: WixBlogAdapter;

  beforeEach(() => {
    // mockReset (not clearAllMocks) so any unconsumed mockResolvedValueOnce from
    // a prior test cannot leak into the next.
    mockFetch.mockReset();
    adapter = new WixBlogAdapter(creds);
  });

  describe('publish', () => {
    it('creates + publishes a text-only draft (no image) in a single call', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ draftPost: { id: 'post-abc', url: 'https://apire.io/blog/nis2' } }),
      );

      const result = await adapter.publish(makeDraft());

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://www.wixapis.com/blog/v3/draft-posts');
      // Wix API-key auth is the raw key (NOT "Bearer …") plus wix-site-id.
      expect(init.headers).toHaveProperty('Authorization', 'wix_test_key');
      expect(init.headers).toHaveProperty('wix-site-id', 'site-id-abc');

      const body = JSON.parse(init.body as string);
      expect(body.publish).toBe(true);
      expect(body.draftPost.title).toBe('NIS2 Compliance Guide');
      expect(body.draftPost.memberId).toBe('member-xyz');
      expect(body.draftPost.media).toBeUndefined();

      expect(result.externalId).toBe('post-abc');
      expect(result.url).toBe('https://apire.io/blog/nis2');
    });

    it('imports an https cover image and attaches it as media', async () => {
      mockFetch
        .mockResolvedValueOnce(
          jsonResponse({
            file: {
              id: 'wixmedia_123~mv2.png',
              url: 'https://static.wixstatic.com/media/wixmedia_123~mv2.png',
            },
          }),
        )
        .mockResolvedValueOnce(jsonResponse({ draftPost: { id: 'post-img', url: 'https://apire.io/blog/x' } }));

      const draft = makeDraft({ assets: { imageUrl: 'https://hailmery-api.example/api/assets/k.png' } });
      const result = await adapter.publish(draft);

      expect(mockFetch).toHaveBeenCalledTimes(2);

      const [importUrl, importInit] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(importUrl).toBe('https://www.wixapis.com/site-media/v1/files/import');
      const importBody = JSON.parse(importInit.body as string);
      expect(importBody.url).toBe('https://hailmery-api.example/api/assets/k.png');
      expect(importBody.mediaType).toBe('IMAGE');

      const [createUrl, createInit] = mockFetch.mock.calls[1] as [string, RequestInit];
      expect(createUrl).toBe('https://www.wixapis.com/blog/v3/draft-posts');
      const createBody = JSON.parse(createInit.body as string);
      expect(createBody.draftPost.media).toEqual({
        displayed: true,
        custom: true,
        altText: 'NIS2 Compliance Guide',
        wixMedia: {
          image: {
            id: 'wixmedia_123~mv2.png',
            url: 'https://static.wixstatic.com/media/wixmedia_123~mv2.png',
          },
        },
      });

      expect(result.externalId).toBe('post-img');
    });

    it('inserts an inline IMAGE node in the body (reusing the cover media) before the first H2', async () => {
      mockFetch
        .mockResolvedValueOnce(
          jsonResponse({
            file: { id: 'wixmedia_inline~mv2.png', url: 'https://static.wixstatic.com/media/wixmedia_inline~mv2.png' },
          }),
        )
        .mockResolvedValueOnce(jsonResponse({ draftPost: { id: 'post-inline' } }));

      // Body mirrors a generated blog: intro paragraphs, a "---" divider kept
      // literal by toRicos, then the first markdown "## " section.
      const body = ['Intro paragraph one.', 'Intro paragraph two.', '---', '## First section', 'Section body.'].join('\n\n');
      const draft = makeDraft({
        payload: { title: 'Inline Image Post', excerpt: 'x', body },
        assets: { imageUrl: 'https://hailmery-api.example/api/assets/k.png' },
      });
      await adapter.publish(draft);

      const createBody = JSON.parse((mockFetch.mock.calls[1][1] as RequestInit).body as string);
      const nodes = createBody.draftPost.richContent.nodes as Array<Record<string, any>>;
      const imgIdx = nodes.findIndex((n) => n.type === 'IMAGE');
      const h2Idx = nodes.findIndex(
        (n) => n.type === 'PARAGRAPH' && (n.nodes?.[0]?.textData?.text ?? '').startsWith('##'),
      );

      expect(imgIdx).toBeGreaterThan(-1); // an inline image was inserted
      expect(imgIdx).toBeLessThan(h2Idx); // …after the intro, before the first "## " heading
      const img = nodes[imgIdx];
      expect(img.imageData.image.src.id).toBe('wixmedia_inline~mv2.png'); // reuses the cover media id
      expect(img.imageData.containerData.alignment).toBe('CENTER');
      expect(img.imageData.containerData.width.size).toBe('CONTENT');
      expect(img.imageData.caption).toBe('Inline Image Post');
      expect(img.imageData.altText).toBe('Inline Image Post');
      // The cover (featured) image is still attached alongside the inline one.
      expect(createBody.draftPost.media.wixMedia.image.id).toBe('wixmedia_inline~mv2.png');
    });

    it('does not insert an inline IMAGE node when there is no cover image', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ draftPost: { id: 'post-noimg' } }));
      await adapter.publish(makeDraft()); // no assets.imageUrl
      const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
      const nodes = body.draftPost.richContent.nodes as Array<Record<string, any>>;
      expect(nodes.some((n) => n.type === 'IMAGE')).toBe(false);
    });

    it('skips a base64 data: image (not https) and publishes text-only', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ draftPost: { id: 'post-b64' } }));

      const draft = makeDraft({ assets: { imageUrl: 'data:image/png;base64,AAAA' } });
      const result = await adapter.publish(draft);

      expect(mockFetch).toHaveBeenCalledOnce(); // no import attempted
      const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
      expect(body.draftPost.media).toBeUndefined();
      expect(result.externalId).toBe('post-b64');
    });

    it('falls back to a text-only post when the cover image import fails', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ error: 'forbidden' }, 403)) // import fails
        .mockResolvedValueOnce(jsonResponse({ draftPost: { id: 'post-noimg' } }));

      const draft = makeDraft({ assets: { imageUrl: 'https://hailmery-api.example/api/assets/k.png' } });
      const result = await adapter.publish(draft);

      expect(mockFetch).toHaveBeenCalledTimes(2);
      const createBody = JSON.parse((mockFetch.mock.calls[1][1] as RequestInit).body as string);
      expect(createBody.draftPost.media).toBeUndefined(); // import failed → no cover, still publishes
      expect(result.externalId).toBe('post-noimg');
    });
  });

  describe('fetchMetrics', () => {
    it('returns empty metrics (Wix has no per-post analytics endpoint here)', async () => {
      const metrics = await adapter.fetchMetrics('any-id');
      expect(metrics).toEqual({ impressions: 0, clicks: 0, engagement: 0, attributedLeads: 0 });
    });
  });

  describe('quotaState', () => {
    it('returns connected on success', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ draftPosts: [] }));
      const quota = await adapter.quotaState();
      expect(quota.connected).toBe(true);
    });

    it('returns disconnected on auth failure', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'unauthorized' }, 401));
      const quota = await adapter.quotaState();
      expect(quota.connected).toBe(false);
      expect(quota.details.code).toBe(401);
    });
  });

  describe('error handling', () => {
    it('throws AdapterHttpError on 429 from draft-post create', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}, 429));
      await expect(adapter.publish(makeDraft())).rejects.toThrow('HTTP 429');
    });

    it('throws AdapterHttpError on 500 from draft-post create', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}, 500));
      await expect(adapter.publish(makeDraft())).rejects.toThrow('HTTP 500');
    });
  });
});
