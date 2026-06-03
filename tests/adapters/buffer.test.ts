import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BufferAdapter, type BufferCredentials } from '../../src/adapters/buffer.js';
import type { ContentDraft } from '../../src/db/schema.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const creds: BufferCredentials = {
  accessToken: 'buf_test_token',
  extra: {
    profileIds: {
      facebook: 'fb_123',
      instagram: 'ig_456',
      linkedin: 'li_789',
      twitter: 'tw_012',
      tiktok: 'tt_345',
      pinterest: 'pi_678',
    },
  },
};

function makeDraft(overrides: Partial<ContentDraft> = {}): ContentDraft {
  return {
    id: 'draft-1',
    tenantId: 'tenant-1',
    campaignId: null,
    siteId: 'site-1',
    pillar: null,
    channel: 'facebook',
    status: 'approved',
    payload: { text: 'Hello world', image_url: 'https://img.example.com/hero.png' },
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

function jsonResponse(data: unknown, status = 200, headers?: Record<string, string>) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
    headers: new Headers(headers),
  };
}

describe('BufferAdapter', () => {
  let adapter: BufferAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new BufferAdapter(creds);
  });

  describe('publish', () => {
    it('posts a createPost GraphQL mutation (shareNow) with the channel id and text', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          data: {
            createPost: {
              __typename: 'PostActionSuccess',
              post: {
                id: 'upd_abc',
                text: 'Hello world',
                externalLink: null,
                status: 'sent',
                channelId: 'fb_123',
              },
            },
          },
        }),
      );

      const result = await adapter.publish(makeDraft());

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.buffer.com/graphql');
      expect(init.method).toBe('POST');
      expect(init.headers).toHaveProperty('Authorization', 'Bearer buf_test_token');

      const body = JSON.parse(init.body as string);
      expect(body.query).toContain('createPost');
      expect(body.variables.input.channelId).toBe('fb_123');
      expect(body.variables.input.text).toBe('Hello world');
      expect(body.variables.input.mode).toBe('shareNow');
      expect(body.variables.input.assets).toEqual([]);

      expect(result.externalId).toBe('upd_abc');
    });

    it('throws for unmapped channel', async () => {
      const draft = makeDraft({ channel: 'snapchat' });
      await expect(adapter.publish(draft)).rejects.toThrow(
        'No Buffer channel/profile id mapped',
      );
    });
  });

  describe('fetchMetrics', () => {
    it('is a no-op — Buffer has no analytics endpoint, so returns empty metrics without an API call', async () => {
      const metrics = await adapter.fetchMetrics('upd_abc');

      expect(metrics).toEqual({
        impressions: 0,
        clicks: 0,
        engagement: 0,
        attributedLeads: 0,
      });
      // No HTTP request is made — the nightly metrics job no longer 401s.
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('quotaState', () => {
    it('returns connected profiles', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse([
          { id: 'p1', service: 'facebook', formatted_service: 'Facebook', default: true },
        ]),
      );

      const quota = await adapter.quotaState();
      expect(quota.connected).toBe(true);
      expect(quota.details.profileCount).toBe(1);
    });
  });

  describe('error handling', () => {
    it('throws AdapterHttpError on 401', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'unauthorized' }, 401));
      await expect(adapter.publish(makeDraft())).rejects.toThrow('HTTP 401');
    });

    it('throws AdapterHttpError on 429', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'rate limited' }, 429));
      await expect(adapter.publish(makeDraft())).rejects.toThrow('HTTP 429');
    });

    it('throws AdapterHttpError on 500', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'server error' }, 500));
      await expect(adapter.publish(makeDraft())).rejects.toThrow('HTTP 500');
    });
  });
});
