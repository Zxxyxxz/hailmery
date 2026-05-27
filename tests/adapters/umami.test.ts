import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UmamiAdapter, type UmamiCredentials } from '../../src/adapters/umami.js';
import type { ContentDraft } from '../../src/db/schema.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const creds: UmamiCredentials = {
  accessToken: '',
  extra: {
    baseUrl: 'https://umami.apire.io',
    username: 'admin',
    password: 'secret',
    websiteId: 'ws-001',
  },
};

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
    headers: new Headers(),
  };
}

describe('UmamiAdapter', () => {
  let adapter: UmamiAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new UmamiAdapter(creds);
  });

  describe('authentication', () => {
    it('authenticates before first API call', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ token: 'umami_tok' }))
        .mockResolvedValueOnce(
          jsonResponse({ id: 'ws-001', name: 'APIRE', domain: 'apire.io' }),
        );

      await adapter.quotaState();

      expect(mockFetch).toHaveBeenCalledTimes(2);
      const [loginUrl, loginInit] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(loginUrl).toBe('https://umami.apire.io/api/auth/login');
      const loginBody = JSON.parse(loginInit.body as string);
      expect(loginBody.username).toBe('admin');

      const [, statsInit] = mockFetch.mock.calls[1] as [string, RequestInit];
      expect(statsInit.headers).toHaveProperty('Authorization', 'Bearer umami_tok');
    });

    it('reuses token on subsequent calls', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ token: 'umami_tok' }))
        .mockResolvedValueOnce(jsonResponse({ id: 'ws-001', name: 'APIRE', domain: 'apire.io' }))
        .mockResolvedValueOnce(jsonResponse({ id: 'ws-001', name: 'APIRE', domain: 'apire.io' }));

      await adapter.quotaState();
      await adapter.quotaState();

      // Only one login call, despite two API calls
      const loginCalls = mockFetch.mock.calls.filter(
        (call) => (call[0] as string).includes('/auth/login'),
      );
      expect(loginCalls).toHaveLength(1);
    });
  });

  describe('fetchWebsiteStats', () => {
    it('returns parsed stats', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ token: 'tok' }))
        .mockResolvedValueOnce(
          jsonResponse({
            pageviews: { value: 1200 },
            visitors: { value: 450 },
            bounces: { value: 120 },
            totaltime: { value: 86400 },
          }),
        );

      const stats = await adapter.fetchWebsiteStats();
      expect(stats.pageviews).toBe(1200);
      expect(stats.visitors).toBe(450);
      expect(stats.bounces).toBe(120);
      expect(stats.totaltime).toBe(86400);
    });
  });

  describe('getPageViews', () => {
    it('fetches page views for a URL', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ token: 'tok' }))
        .mockResolvedValueOnce(
          jsonResponse({
            pageviews: [
              { x: '2026-05-26', y: 42 },
              { x: '2026-05-27', y: 58 },
            ],
          }),
        );

      const views = await adapter.getPageViews('ws-001', '/blog/nis2', 7);
      expect(views).toHaveLength(2);
      expect(views[0].y).toBe(42);
    });
  });

  describe('getEvents', () => {
    it('fetches events', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ token: 'tok' }))
        .mockResolvedValueOnce(
          jsonResponse([{ x: 'cta_click', y: 15 }]),
        );

      const events = await adapter.getEvents('ws-001', 7);
      expect(events).toHaveLength(1);
      expect(events[0].x).toBe('cta_click');
    });
  });

  describe('publish', () => {
    it('throws — Umami is analytics-only', async () => {
      await expect(adapter.publish({} as ContentDraft)).rejects.toThrow('analytics-only');
    });
  });

  describe('fetchMetrics', () => {
    it('returns empty metrics for draft ID', async () => {
      const m = await adapter.fetchMetrics('any');
      expect(m.impressions).toBe(0);
    });
  });

  describe('quotaState', () => {
    it('confirms connectivity', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ token: 'tok' }))
        .mockResolvedValueOnce(
          jsonResponse({ id: 'ws-001', name: 'APIRE', domain: 'apire.io' }),
        );

      const q = await adapter.quotaState();
      expect(q.connected).toBe(true);
      expect(q.details.domain).toBe('apire.io');
    });
  });

  describe('error handling', () => {
    it('throws on login failure (401)', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}, 401));
      await expect(adapter.quotaState()).rejects.toThrow('HTTP 401');
    });

    it('throws on 429', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ token: 'tok' }))
        .mockResolvedValueOnce(jsonResponse({}, 429));
      await expect(adapter.quotaState()).rejects.toThrow('HTTP 429');
    });

    it('throws on 500', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ token: 'tok' }))
        .mockResolvedValueOnce(jsonResponse({}, 500));
      await expect(adapter.quotaState()).rejects.toThrow('HTTP 500');
    });
  });
});
