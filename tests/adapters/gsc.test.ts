import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  GscAdapter,
  flagHighPerformers,
  type GscCredentials,
  type GscRow,
} from '../../src/adapters/gsc.js';
import type { ContentDraft } from '../../src/db/schema.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const creds: GscCredentials = {
  accessToken: 'gsc_access_tok',
  refreshToken: 'gsc_refresh_tok',
  extra: { clientId: 'cid', clientSecret: 'csec' },
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

describe('GscAdapter', () => {
  let adapter: GscAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new GscAdapter(creds);
  });

  describe('fetchKeywordData', () => {
    it('returns keyword rows', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          rows: [
            { keys: ['nis2 compliance', 'https://apire.io/nis2'], impressions: 1200, clicks: 45, ctr: 0.037, position: 4.2 },
            { keys: ['cybersecurity eu', 'https://apire.io/eu'], impressions: 800, clicks: 20, ctr: 0.025, position: 8.1 },
          ],
        }),
      );

      const rows = await adapter.fetchKeywordData('https://apire.io', 28);

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/searchAnalytics/query');
      expect(init.headers).toHaveProperty('Authorization', 'Bearer gsc_access_tok');

      expect(rows).toHaveLength(2);
      expect(rows[0].query).toBe('nis2 compliance');
      expect(rows[0].impressions).toBe(1200);
    });
  });

  describe('getTopPages', () => {
    it('returns pages sorted by impressions', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          rows: [
            { keys: ['https://apire.io/a'], impressions: 300, clicks: 10 },
            { keys: ['https://apire.io/b'], impressions: 900, clicks: 50 },
          ],
        }),
      );

      const pages = await adapter.getTopPages('https://apire.io', 7);
      expect(pages[0].page).toBe('https://apire.io/b');
      expect(pages[0].impressions).toBe(900);
    });
  });

  describe('publish', () => {
    it('throws — GSC is read-only', async () => {
      await expect(adapter.publish({} as ContentDraft)).rejects.toThrow('read-only');
    });
  });

  describe('quotaState', () => {
    it('returns verified sites', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          siteEntry: [
            { siteUrl: 'https://apire.io', permissionLevel: 'siteOwner' },
          ],
        }),
      );

      const q = await adapter.quotaState();
      expect(q.connected).toBe(true);
    });
  });

  describe('error handling', () => {
    it('throws on 401', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}, 401));
      await expect(adapter.fetchKeywordData('https://x.com', 7)).rejects.toThrow('HTTP 401');
    });

    it('throws on 429', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}, 429));
      await expect(adapter.quotaState()).rejects.toThrow('HTTP 429');
    });

    it('throws on 500', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}, 500));
      await expect(adapter.quotaState()).rejects.toThrow('HTTP 500');
    });
  });
});

describe('flagHighPerformers', () => {
  it('returns rows with >3x average impressions', () => {
    const rows: GscRow[] = [
      { query: 'a', page: '/a', impressions: 10, clicks: 1, ctr: 0.1, position: 10 },
      { query: 'b', page: '/b', impressions: 10, clicks: 1, ctr: 0.1, position: 10 },
      { query: 'c', page: '/c', impressions: 10, clicks: 1, ctr: 0.1, position: 10 },
      { query: 'd', page: '/d', impressions: 1000, clicks: 50, ctr: 0.05, position: 1 },
    ];

    const high = flagHighPerformers(rows);
    expect(high).toHaveLength(1);
    expect(high[0].query).toBe('d');
  });

  it('returns empty for empty input', () => {
    expect(flagHighPerformers([])).toEqual([]);
  });
});
