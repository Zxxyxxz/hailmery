import type { ContentDraft } from '../db/schema.js';

// ──────────────────────────────────────────────────────────────────
// Shared types used across all adapters
// ──────────────────────────────────────────────────────────────────

export interface AdapterCredentials {
  accessToken: string;
  refreshToken?: string;
  extra?: Record<string, unknown>;
}

export interface MetricsResult {
  impressions: number;
  clicks: number;
  engagement: number;
  attributedLeads: number;
}

export interface QuotaState {
  connected: boolean;
  details: Record<string, unknown>;
}

export interface PublishResult {
  externalId: string;
  url?: string;
  raw?: unknown;
}

export const EMPTY_METRICS: MetricsResult = {
  impressions: 0,
  clicks: 0,
  engagement: 0,
  attributedLeads: 0,
};

// ──────────────────────────────────────────────────────────────────
// ChannelAdapter — every adapter under src/adapters/{name}.ts
// conforms to this interface at minimum.
// ──────────────────────────────────────────────────────────────────

export interface ChannelAdapter {
  readonly platform: string;

  publish(draft: ContentDraft): Promise<PublishResult>;
  fetchMetrics(draftId: string): Promise<MetricsResult>;
  quotaState(): Promise<QuotaState>;
}

// ──────────────────────────────────────────────────────────────────
// HTTP helper — thin wrapper around fetch for adapter calls
// ──────────────────────────────────────────────────────────────────

export class AdapterHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    public readonly url: string,
  ) {
    super(`HTTP ${status} from ${url}: ${body.slice(0, 200)}`);
    this.name = 'AdapterHttpError';
  }
}

export async function adapterFetch(
  url: string,
  init: RequestInit,
): Promise<Response> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.text();
    throw new AdapterHttpError(res.status, body, url);
  }
  return res;
}

export function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

// ──────────────────────────────────────────────────────────────────
// Re-exports — import any adapter from `@/adapters`
// ──────────────────────────────────────────────────────────────────

export { BufferAdapter } from './buffer.js';
export type { BufferCredentials } from './buffer.js';

export { WixBlogAdapter } from './wix-blog.js';
export type { WixBlogCredentials } from './wix-blog.js';

export { HubSpotAdapter, getContactByEmail } from './hubspot.js';
export type {
  HubSpotCredentials,
  HubSpotContact,
  HubSpotContactsResult,
  HubSpotEventType,
  HubSpotTimelineEvent,
} from './hubspot.js';

export { SendGridAdapter, handleSendGridWebhook } from './sendgrid.js';
export type {
  SendGridCredentials,
  SendGridMailPayload,
  SendGridEvent,
  SendGridContactInput,
  SendGridContactSyncResult,
  SendGridList,
} from './sendgrid.js';

export { GscAdapter, flagHighPerformers } from './gsc.js';
export type { GscCredentials, GscRow } from './gsc.js';

export { UmamiAdapter } from './umami.js';
export type {
  UmamiCredentials,
  UmamiStats,
  UmamiPageViewEntry,
  UmamiEvent,
} from './umami.js';

// ──────────────────────────────────────────────────────────────────
// Factory — returns the right adapter class for a channel string.
// The caller supplies credentials; we return a constructed adapter.
// ──────────────────────────────────────────────────────────────────

type AdapterClass =
  | typeof import('./buffer.js').BufferAdapter
  | typeof import('./wix-blog.js').WixBlogAdapter
  | typeof import('./hubspot.js').HubSpotAdapter
  | typeof import('./sendgrid.js').SendGridAdapter
  | typeof import('./gsc.js').GscAdapter
  | typeof import('./umami.js').UmamiAdapter;

const ADAPTER_MAP: Record<string, () => Promise<AdapterClass>> = {
  facebook: () => import('./buffer.js').then((m) => m.BufferAdapter),
  instagram: () => import('./buffer.js').then((m) => m.BufferAdapter),
  linkedin: () => import('./buffer.js').then((m) => m.BufferAdapter),
  twitter: () => import('./buffer.js').then((m) => m.BufferAdapter),
  tiktok: () => import('./buffer.js').then((m) => m.BufferAdapter),
  pinterest: () => import('./buffer.js').then((m) => m.BufferAdapter),
  buffer: () => import('./buffer.js').then((m) => m.BufferAdapter),
  'wix-blog': () => import('./wix-blog.js').then((m) => m.WixBlogAdapter),
  hubspot: () => import('./hubspot.js').then((m) => m.HubSpotAdapter),
  sendgrid: () => import('./sendgrid.js').then((m) => m.SendGridAdapter),
  email: () => import('./sendgrid.js').then((m) => m.SendGridAdapter),
  gsc: () => import('./gsc.js').then((m) => m.GscAdapter),
  umami: () => import('./umami.js').then((m) => m.UmamiAdapter),
};

export async function getAdapter(
  channel: string,
): Promise<AdapterClass | null> {
  const loader = ADAPTER_MAP[channel];
  if (!loader) return null;
  return loader();
}
