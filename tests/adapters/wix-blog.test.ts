import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WixBlogAdapter, type WixBlogCredentials } from '../../src/adapters/wix-blog.js';
import type { ContentDraft } from '../../src/db/schema.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const creds: WixBlogCredentials = {
  accessToken: 'wix_test_key',
  extra: { wixSiteId: 'site-id-abc' },
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
      content: '<p>Rich text content</p>',
      wixPostId: null,
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
    vi.clearAllMocks();
    adapter = new WixBlogAdapter(creds);
  });

  describe('publish', () => {
    it('creates a draft then publishes when no wixPostId', async () => {
      mockFetch
        .mockResolvedValueOnce(
          jsonResponse({ post: { id: 'post-abc', url: 'https://apire.io/blog/nis2' } }),
        )
        .mockResolvedValueOnce(
          jsonResponse({ post: { id: 'post-abc', status: 'PUBLISHED' } }),
        );

      const result = await adapter.publish(makeDraft());

      expect(mockFetch).toHaveBeenCalledTimes(2);

      const [createUrl, createInit] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(createUrl).toBe('https://www.wixapis.com/blog/v3/posts');
      expect(createInit.headers).toHaveProperty('Authorization', 'Bearer wix_test_key');
      expect(createInit.headers).toHaveProperty('wix-site-id', 'site-id-abc');

      const [patchUrl] = mockFetch.mock.calls[1] as [string, RequestInit];
      expect(patchUrl).toBe('https://www.wixapis.com/blog/v3/posts/post-abc');

      expect(result.externalId).toBe('post-abc');
      expect(result.url).toBe('https://apire.io/blog/nis2');
    });

    it('publishes directly when wixPostId is present', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ post: { id: 'post-existing', url: 'https://apire.io/blog/x' } }),
      );

      const draft = makeDraft({
        payload: { title: 'Test', wixPostId: 'post-existing' },
      });
      const result = await adapter.publish(draft);

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toBe('https://www.wixapis.com/blog/v3/posts/post-existing');
      expect(result.externalId).toBe('post-existing');
    });
  });

  describe('fetchMetrics', () => {
    it('returns empty metrics', async () => {
      const metrics = await adapter.fetchMetrics('any-id');
      expect(metrics.impressions).toBe(0);
      expect(metrics.clicks).toBe(0);
    });
  });

  describe('quotaState', () => {
    it('returns connected on success', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ posts: [] }));
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
    it('throws AdapterHttpError on 429', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}, 429));
      await expect(adapter.publish(makeDraft())).rejects.toThrow('HTTP 429');
    });

    it('throws AdapterHttpError on 500', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}, 500));
      await expect(adapter.publish(makeDraft())).rejects.toThrow('HTTP 500');
    });
  });
});
