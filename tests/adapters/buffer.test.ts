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
    const EMPTY = { impressions: 0, clicks: 0, engagement: 0, attributedLeads: 0 };

    it('short-circuits a draft UUID (no Buffer ref recorded) without an API call', async () => {
      const metrics = await adapter.fetchMetrics('6daebc34-7fd0-4542-8527-cfcd125a5f72');
      expect(metrics).toEqual(EMPTY);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('short-circuits a URL-shaped ref (a permalink, not a PostId) without an API call', async () => {
      const metrics = await adapter.fetchMetrics('https://www.linkedin.com/feed/update/abc');
      expect(metrics).toEqual(EMPTY);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('queries Buffer and maps post metrics to a MetricsResult (LinkedIn shape)', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          data: {
            post: {
              id: '6a21c43359f44e6a442977e5',
              status: 'sent',
              metrics: [
                { type: 'impressions', value: 67 },
                { type: 'reactions', value: 3 },
                { type: 'comments', value: 0 },
                { type: 'shares', value: 1 },
                { type: 'engagementRate', value: 5.97 },
              ],
            },
          },
        }),
      );

      const metrics = await adapter.fetchMetrics('6a21c43359f44e6a442977e5');

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.buffer.com/graphql');
      const body = JSON.parse(init.body as string);
      expect(body.query).toContain('post(input: { id: $id })');
      expect(body.variables.id).toBe('6a21c43359f44e6a442977e5');
      // impressions=67; clicks=0 (LinkedIn exposes none via Buffer);
      // engagement = reactions(3) + comments(0) + shares(1) = 4; the
      // engagementRate percentage is excluded from the interaction count.
      expect(metrics).toEqual({ impressions: 67, clicks: 0, engagement: 4, attributedLeads: 0 });
    });

    it('returns empty (never throws) when the post is not found / stale ref', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          data: { post: null },
          errors: [{ message: 'Post not found', extensions: { code: 'NOT_FOUND' } }],
        }),
      );
      const metrics = await adapter.fetchMetrics('6a216b029c081f8221477638');
      expect(metrics).toEqual(EMPTY);
    });

    it('returns empty (never throws) on a network/transport error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('boom'));
      const metrics = await adapter.fetchMetrics('6a21c43359f44e6a442977e5');
      expect(metrics).toEqual(EMPTY);
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
