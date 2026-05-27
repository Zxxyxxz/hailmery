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

export interface UmamiCredentials extends AdapterCredentials {
  extra: {
    baseUrl: string;
    username: string;
    password: string;
    websiteId: string;
  };
}

export interface UmamiStats {
  pageviews: number;
  visitors: number;
  bounces: number;
  totaltime: number;
}

export interface UmamiPageViewEntry {
  x: string;
  y: number;
}

export interface UmamiEvent {
  x: string;
  y: number;
}

export class UmamiAdapter implements ChannelAdapter {
  readonly platform = 'umami';
  private token: string | null = null;
  private readonly baseUrl: string;
  private readonly username: string;
  private readonly password: string;
  private readonly websiteId: string;

  constructor(creds: UmamiCredentials) {
    this.baseUrl = creds.extra.baseUrl.replace(/\/$/, '');
    this.username = creds.extra.username;
    this.password = creds.extra.password;
    this.websiteId = creds.extra.websiteId;
    if (creds.accessToken) {
      this.token = creds.accessToken;
    }
  }

  private async authenticate(): Promise<string> {
    if (this.token) return this.token;

    const res = await adapterFetch(`${this.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: this.username,
        password: this.password,
      }),
    });

    const data = (await res.json()) as { token: string };
    this.token = data.token;
    return data.token;
  }

  private async hdrs(): Promise<Record<string, string>> {
    const token = await this.authenticate();
    return authHeaders(token);
  }

  async fetchMetrics(_draftId: string): Promise<MetricsResult> {
    return EMPTY_METRICS;
  }

  async fetchWebsiteStats(
    websiteId?: string,
    startAt?: number,
    endAt?: number,
  ): Promise<UmamiStats> {
    const wId = websiteId ?? this.websiteId;
    const now = Date.now();
    const start = startAt ?? now - 24 * 60 * 60 * 1000;
    const end = endAt ?? now;

    const params = new URLSearchParams({
      startAt: String(start),
      endAt: String(end),
    });

    const res = await adapterFetch(
      `${this.baseUrl}/api/websites/${wId}/stats?${params}`,
      { method: 'GET', headers: await this.hdrs() },
    );

    const data = (await res.json()) as {
      pageviews?: { value: number };
      visitors?: { value: number };
      bounces?: { value: number };
      totaltime?: { value: number };
    };

    return {
      pageviews: data.pageviews?.value ?? 0,
      visitors: data.visitors?.value ?? 0,
      bounces: data.bounces?.value ?? 0,
      totaltime: data.totaltime?.value ?? 0,
    };
  }

  async getPageViews(
    websiteId: string,
    url: string,
    days: number,
  ): Promise<UmamiPageViewEntry[]> {
    const now = Date.now();
    const start = now - days * 24 * 60 * 60 * 1000;

    const params = new URLSearchParams({
      startAt: String(start),
      endAt: String(now),
      url,
      unit: 'day',
    });

    const res = await adapterFetch(
      `${this.baseUrl}/api/websites/${websiteId}/pageviews?${params}`,
      { method: 'GET', headers: await this.hdrs() },
    );

    const data = (await res.json()) as {
      pageviews?: Array<{ x: string; y: number }>;
    };

    return data.pageviews ?? [];
  }

  async getEvents(
    websiteId: string,
    days: number,
  ): Promise<UmamiEvent[]> {
    const now = Date.now();
    const start = now - days * 24 * 60 * 60 * 1000;

    const params = new URLSearchParams({
      startAt: String(start),
      endAt: String(now),
    });

    const res = await adapterFetch(
      `${this.baseUrl}/api/websites/${websiteId}/events?${params}`,
      { method: 'GET', headers: await this.hdrs() },
    );

    const data = (await res.json()) as Array<{ x: string; y: number }>;
    return data ?? [];
  }

  async publish(_draft: ContentDraft): Promise<PublishResult> {
    throw new Error('Umami adapter is analytics-only — does not support publishing');
  }

  async quotaState(): Promise<QuotaState> {
    const res = await adapterFetch(
      `${this.baseUrl}/api/websites/${this.websiteId}`,
      { method: 'GET', headers: await this.hdrs() },
    );

    const data = (await res.json()) as {
      id?: string;
      name?: string;
      domain?: string;
    };

    return {
      connected: !!data.id,
      details: {
        websiteId: data.id,
        name: data.name,
        domain: data.domain,
      },
    };
  }
}
