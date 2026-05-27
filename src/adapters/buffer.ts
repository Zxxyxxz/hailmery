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

const BASE = 'https://api.bufferapp.com/1';

type BufferChannel =
  | 'facebook'
  | 'instagram'
  | 'linkedin'
  | 'twitter'
  | 'tiktok'
  | 'pinterest';

export interface BufferCredentials extends AdapterCredentials {
  extra: {
    profileIds: Record<BufferChannel, string>;
  };
}

export class BufferAdapter implements ChannelAdapter {
  readonly platform = 'buffer';
  private readonly token: string;
  private readonly profileIds: Record<string, string>;

  constructor(creds: BufferCredentials) {
    this.token = creds.accessToken;
    this.profileIds = creds.extra.profileIds;
  }

  async publish(draft: ContentDraft): Promise<PublishResult> {
    const channel = draft.channel as BufferChannel;
    const profileId = this.profileIds[channel];
    if (!profileId) {
      throw new Error(`No Buffer profile ID mapped for channel: ${channel}`);
    }

    const payload = draft.payload as Record<string, unknown>;
    const body: Record<string, unknown> = {
      profile_ids: [profileId],
      text: payload.text ?? '',
      now: true,
    };

    if (payload.image_url) {
      body.media = { photo: payload.image_url };
    }

    const res = await adapterFetch(`${BASE}/updates/create.json`, {
      method: 'POST',
      headers: authHeaders(this.token),
      body: JSON.stringify(body),
    });

    const data = (await res.json()) as { updates?: Array<{ id: string }> };
    const updateId = data.updates?.[0]?.id ?? '';

    return { externalId: updateId, raw: data };
  }

  async fetchMetrics(draftId: string): Promise<MetricsResult> {
    if (!draftId) return EMPTY_METRICS;

    const res = await adapterFetch(
      `${BASE}/updates/${draftId}/interactions.json`,
      { method: 'GET', headers: authHeaders(this.token) },
    );

    const data = (await res.json()) as {
      interactions?: Array<{ metric: string; count: number }>;
      total?: number;
    };

    let impressions = 0;
    let clicks = 0;
    let engagement = 0;

    for (const interaction of data.interactions ?? []) {
      switch (interaction.metric) {
        case 'impressions':
          impressions = interaction.count;
          break;
        case 'clicks':
          clicks = interaction.count;
          break;
        default:
          engagement += interaction.count;
          break;
      }
    }

    return { impressions, clicks, engagement, attributedLeads: 0 };
  }

  async quotaState(): Promise<QuotaState> {
    const res = await adapterFetch(`${BASE}/profiles.json`, {
      method: 'GET',
      headers: authHeaders(this.token),
    });

    const profiles = (await res.json()) as Array<{
      id: string;
      service: string;
      formatted_service: string;
      default: boolean;
    }>;

    return {
      connected: profiles.length > 0,
      details: {
        profileCount: profiles.length,
        profiles: profiles.map((p) => ({
          id: p.id,
          service: p.service,
          name: p.formatted_service,
        })),
      },
    };
  }
}
