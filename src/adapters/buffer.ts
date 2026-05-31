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

// Legacy v1 REST base — still used by fetchMetrics/quotaState below. The
// current OIDC-style personal access token does NOT authenticate against it
// (returns 401), so publish() targets Buffer's GraphQL API instead. Migrating
// metrics + quota off v1 is tracked separately.
const BASE = 'https://api.bufferapp.com/1';

// Buffer's GraphQL API — https://developers.buffer.com.
const GRAPHQL_ENDPOINT = 'https://api.buffer.com/graphql';

type BufferChannel =
  | 'facebook'
  | 'instagram'
  | 'linkedin'
  | 'twitter'
  | 'tiktok'
  | 'pinterest';

export interface BufferCredentials extends AdapterCredentials {
  extra: {
    // channel (e.g. 'linkedin') -> Buffer channel/profile id. Scoped to a
    // single tenant: lib/credentials loads this from the tenant's own encrypted
    // profile map, so resolution effectively keys on channel + tenant.
    profileIds: Record<string, string>;
  };
}

// createPost is a single mutation across all of Buffer's channels. The payload
// is a union: PostActionSuccess, or one of several error types that all
// implement the MutationError interface (so a single `message` selection on the
// interface covers every error variant).
const CREATE_POST = `mutation CreatePost($input: CreatePostInput!) {
  createPost(input: $input) {
    __typename
    ... on PostActionSuccess {
      post { id text externalLink dueAt status channelId }
    }
    ... on MutationError { message }
  }
}`;

interface CreatePostResponse {
  data?: {
    createPost?: {
      __typename: string;
      post?: {
        id: string;
        text?: string;
        externalLink?: string | null;
        dueAt?: string | null;
        status?: string;
        channelId?: string;
      };
      message?: string;
    };
  };
  errors?: Array<{ message: string; extensions?: { code?: string } }>;
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
    const channel = draft.channel;
    const channelId = this.profileIds[channel];
    if (!channelId) {
      throw new Error(`No Buffer channel/profile id mapped for channel: ${channel}`);
    }

    const payload = draft.payload as Record<string, unknown>;
    const text = typeof payload.text === 'string' ? payload.text : '';

    // Schedule at the draft's publish_at when present — Buffer needs the
    // customScheduled mode paired with dueAt as a strict ISO-8601 string.
    // (publish_at can arrive as a Date or a Postgres timestamp string like
    // "2026-06-07 16:56:45+00", which Buffer's DateTime scalar rejects — so we
    // always normalise through Date.toISOString().)
    let dueAt: string | null = null;
    if (draft.publishAt) {
      const d = draft.publishAt instanceof Date ? draft.publishAt : new Date(draft.publishAt);
      dueAt = Number.isNaN(d.getTime()) ? null : d.toISOString();
    }

    const input: Record<string, unknown> = {
      channelId,
      text,
      schedulingType: 'automatic',
      mode: dueAt ? 'customScheduled' : 'shareNow',
      // assets is a required [AssetInput!]! — a text-only post passes []. The
      // image branch (push { image: { url } }) lands once asset URLs are wired.
      assets: [],
    };
    if (dueAt) input.dueAt = dueAt;

    const res = await fetch(GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: CREATE_POST, variables: { input } }),
    });

    const body = (await res.json().catch(() => null)) as CreatePostResponse | null;

    // Transport-level GraphQL errors (auth, validation) surface in `errors`.
    if (body?.errors?.length) {
      throw new Error(`Buffer GraphQL error: ${JSON.stringify(body.errors)}`);
    }
    const createPost = body?.data?.createPost;
    if (!createPost) {
      throw new Error(
        `Buffer GraphQL: unexpected response (HTTP ${res.status}): ${JSON.stringify(body)}`,
      );
    }

    // Recoverable errors come back as a union member carrying `message`.
    if (createPost.__typename !== 'PostActionSuccess' || !createPost.post) {
      throw new Error(
        `Buffer createPost failed (${createPost.__typename}): ${createPost.message ?? 'unknown error'}`,
      );
    }

    return {
      externalId: createPost.post.id,
      url: createPost.post.externalLink ?? undefined,
      raw: body,
    };
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
