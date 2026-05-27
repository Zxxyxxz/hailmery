import type { ContentDraft } from '../db/schema.js';
import {
  type ChannelAdapter,
  type AdapterCredentials,
  type MetricsResult,
  type QuotaState,
  type PublishResult,
  EMPTY_METRICS,
  adapterFetch,
  authHeaders,
} from './index.js';

const BASE = 'https://searchconsole.googleapis.com/webmasters/v3';

export interface GscCredentials extends AdapterCredentials {
  refreshToken: string;
  extra: {
    clientId: string;
    clientSecret: string;
  };
}

export interface GscRow {
  query: string;
  page: string;
  impressions: number;
  clicks: number;
  ctr: number;
  position: number;
}

export class GscAdapter implements ChannelAdapter {
  readonly platform = 'gsc';
  private accessToken: string;
  private readonly refreshToken: string;
  private readonly clientId: string;
  private readonly clientSecret: string;

  constructor(creds: GscCredentials) {
    this.accessToken = creds.accessToken;
    this.refreshToken = creds.refreshToken;
    this.clientId = creds.extra.clientId;
    this.clientSecret = creds.extra.clientSecret;
  }

  private async refreshAccessToken(): Promise<void> {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: this.refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!res.ok) {
      throw new Error(`OAuth token refresh failed: ${res.status}`);
    }

    const data = (await res.json()) as { access_token: string };
    this.accessToken = data.access_token;
  }

  private hdrs(): Record<string, string> {
    return authHeaders(this.accessToken);
  }

  async fetchKeywordData(
    siteUrl: string,
    days: number,
  ): Promise<GscRow[]> {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - days);

    const body = {
      startDate: fmtDate(startDate),
      endDate: fmtDate(endDate),
      dimensions: ['query', 'page'],
      rowLimit: 1000,
    };

    const encodedSite = encodeURIComponent(siteUrl);
    const res = await adapterFetch(
      `${BASE}/sites/${encodedSite}/searchAnalytics/query`,
      {
        method: 'POST',
        headers: this.hdrs(),
        body: JSON.stringify(body),
      },
    );

    const data = (await res.json()) as {
      rows?: Array<{
        keys: string[];
        impressions: number;
        clicks: number;
        ctr: number;
        position: number;
      }>;
    };

    return (data.rows ?? []).map((r) => ({
      query: r.keys[0] ?? '',
      page: r.keys[1] ?? '',
      impressions: r.impressions,
      clicks: r.clicks,
      ctr: r.ctr,
      position: r.position,
    }));
  }

  async getTopPages(
    siteUrl: string,
    days: number,
  ): Promise<Array<{ page: string; impressions: number; clicks: number }>> {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - days);

    const body = {
      startDate: fmtDate(startDate),
      endDate: fmtDate(endDate),
      dimensions: ['page'],
      rowLimit: 1000,
    };

    const encodedSite = encodeURIComponent(siteUrl);
    const res = await adapterFetch(
      `${BASE}/sites/${encodedSite}/searchAnalytics/query`,
      {
        method: 'POST',
        headers: this.hdrs(),
        body: JSON.stringify(body),
      },
    );

    const data = (await res.json()) as {
      rows?: Array<{
        keys: string[];
        impressions: number;
        clicks: number;
      }>;
    };

    return (data.rows ?? [])
      .map((r) => ({
        page: r.keys[0] ?? '',
        impressions: r.impressions,
        clicks: r.clicks,
      }))
      .sort((a, b) => b.impressions - a.impressions);
  }

  async publish(_draft: ContentDraft): Promise<PublishResult> {
    throw new Error('GSC adapter is read-only — does not support publishing');
  }

  async fetchMetrics(_draftId: string): Promise<MetricsResult> {
    return EMPTY_METRICS;
  }

  async quotaState(): Promise<QuotaState> {
    const res = await adapterFetch(`${BASE}/sites`, {
      method: 'GET',
      headers: this.hdrs(),
    });

    const data = (await res.json()) as {
      siteEntry?: Array<{ siteUrl: string; permissionLevel: string }>;
    };

    const sites = data.siteEntry ?? [];
    return {
      connected: sites.length > 0,
      details: {
        verifiedSites: sites.map((s) => ({
          url: s.siteUrl,
          permission: s.permissionLevel,
        })),
      },
    };
  }
}

export function flagHighPerformers(rows: GscRow[]): GscRow[] {
  if (rows.length === 0) return [];
  const avgImpressions =
    rows.reduce((sum, r) => sum + r.impressions, 0) / rows.length;
  const threshold = avgImpressions * 3;
  return rows.filter((r) => r.impressions > threshold);
}

function fmtDate(d: Date): string {
  return d.toISOString().split('T')[0]!;
}
