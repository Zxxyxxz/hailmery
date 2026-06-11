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

// Legacy v1 REST base — still used by quotaState() below. The current
// OIDC-style personal access token does NOT authenticate against it (returns
// 401), so publish() targets Buffer's GraphQL API instead and fetchMetrics() is
// a no-op (see below). Migrating quota off v1 is tracked separately.
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

/**
 * A historical (already-sent) Buffer post, normalised for the importer
 * (src/jobs/import-buffer.ts). `metrics` is mapped onto hailmery's MetricsResult
 * exactly like fetchMetrics; `rawMetrics` keeps every Buffer metric by type
 * (incl. engagementRate) for reference / debugging.
 */
export interface BufferHistoricalPost {
  id: string;
  text: string;
  status: string;
  sentAt: string | null;
  serviceType: string;
  channelId: string;
  // The post's public permalink. The publish pipeline stores this (not the post
  // id) as published_ref when Buffer returns it at publish time, so the importer
  // dedups on it too — see src/jobs/import-buffer.ts.
  externalLink: string | null;
  metrics: MetricsResult;
  rawMetrics: Record<string, number>;
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

// Post statistics. `Post.metrics` is a list of { type, value, unit }; the
// available `type`s vary by network — LinkedIn reports impressions, reactions,
// comments, shares, engagementRate; X reports likes/retweets/replies; etc. The
// `value` is a Float (counts for `unit:"count"`, a ratio for `unit:"percentage"`).
// `Query.post` takes an `input: { id: PostId! }`. Verified live against the
// Buffer GraphQL API (a sent LinkedIn post returned impressions=67, reactions=3,
// shares=1). Stale/deleted refs return a NOT_FOUND error and a null post.
const POST_METRICS = `query GetPostMetrics($id: PostId!) {
  post(input: { id: $id }) {
    id
    status
    metrics { type value }
  }
}`;

interface PostMetricsResponse {
  data?: {
    post?: {
      id: string;
      status?: string;
      metrics?: Array<{ type: string; value: number }> | null;
    } | null;
  };
  errors?: Array<{ message: string; extensions?: { code?: string } }>;
}

// Historical-post listing (src/jobs/import-buffer.ts). `posts(input: PostsInput!)`
// REQUIRES organizationId, which we resolve from the channel first (CHANNEL_ORG),
// then filter by channelIds + status and paginate the PostsResults connection.
// Each node carries the same `metrics { type value }` list as Query.post, so the
// import reuses mapBufferMetrics(). Verified live: 110 sent LinkedIn posts for
// APIRE (org 683c9b5a…dafab), every one with metrics. NOTE: this query shape is
// undocumented in Buffer's public API docs — it was discovered by GraphQL schema
// introspection (PostsInput → { organizationId!, filter: PostsFiltersInput, sort },
// PostsFiltersInput → { channelIds, status: PostStatus(sent|scheduled|…) }).
const CHANNEL_ORG = `query GetChannelOrg($input: ChannelInput!) {
  channel(input: $input) { id organizationId service }
}`;

const LIST_POSTS = `query ListPosts($input: PostsInput!, $first: Int, $after: String) {
  posts(input: $input, first: $first, after: $after) {
    edges {
      cursor
      node {
        id status text sentAt dueAt createdAt
        channelId channelService externalLink
        metrics { type value }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

interface ChannelOrgResponse {
  data?: { channel?: { id: string; organizationId?: string | null; service?: string } | null };
  errors?: Array<{ message: string }>;
}

interface ListPostsNode {
  id: string;
  status: string;
  text?: string | null;
  sentAt?: string | null;
  dueAt?: string | null;
  createdAt?: string | null;
  channelId?: string;
  channelService?: string;
  externalLink?: string | null;
  metrics?: Array<{ type: string; value: number }> | null;
}

interface ListPostsResponse {
  data?: {
    posts?: {
      edges: Array<{ cursor: string; node: ListPostsNode }>;
      pageInfo: { hasNextPage: boolean; endCursor?: string | null };
    } | null;
  };
  errors?: Array<{ message: string; extensions?: { code?: string } }>;
}

// A draft id is a UUID; a Buffer post id is a 24-char hex (Mongo ObjectId). When
// the publish pipeline recorded no published_ref it falls back to the draft id —
// there is no Buffer post to query in that case, so we skip the call.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Map Buffer's per-network metric `type`s onto hailmery's MetricsResult. Each
 * network only emits one alias per concept (LinkedIn `reactions`, X `likes`), so
 * summing aliases never double-counts. `engagementRate` (a percentage) is
 * intentionally excluded — engagement is a raw interaction COUNT. Shared by
 * fetchMetrics() (live polling) and listHistoricalPosts() (bulk import).
 */
function mapBufferMetrics(
  metrics: Array<{ type: string; value: number }> | null | undefined,
): MetricsResult {
  const byType: Record<string, number> = {};
  for (const m of metrics ?? []) byType[m.type] = (byType[m.type] ?? 0) + (Number(m.value) || 0);
  const sum = (...keys: string[]) => keys.reduce((acc, k) => acc + (byType[k] ?? 0), 0);
  const impressions = Math.round(byType.impressions ?? byType.reach ?? 0);
  const clicks = Math.round(sum('clicks', 'linkClicks', 'postClicks', 'urlClicks'));
  const engagement = Math.round(
    sum('reactions', 'likes', 'favorites') +
      sum('comments', 'replies') +
      sum('shares', 'retweets', 'reposts'),
  );
  return { impressions, clicks, engagement, attributedLeads: 0 };
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

    // assets is a required [AssetInput!]! — a text-only post passes []. When the
    // draft carries a real HTTPS image URL (the /api/assets proxy URL the image
    // generator sets after a successful R2 write — never a base64 data: URI),
    // attach it as an image asset so the post publishes with its visual. Buffer's
    // ImageAssetInput.url is a required String and must be publicly fetchable.
    const draftAssets = (draft.assets ?? {}) as Record<string, unknown>;
    const imageUrl =
      typeof draftAssets.imageUrl === 'string' && draftAssets.imageUrl.startsWith('https://')
        ? draftAssets.imageUrl
        : undefined;

    const input: Record<string, unknown> = {
      channelId,
      text,
      schedulingType: 'automatic',
      mode: dueAt ? 'customScheduled' : 'shareNow',
      assets: imageUrl ? [{ image: { url: imageUrl } }] : [],
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

  async fetchMetrics(externalId: string): Promise<MetricsResult> {
    // `externalId` is the value the metrics job pulls from content_drafts —
    // published_ref (the Buffer post id captured at publish) when present, else
    // the internal draft id as a fallback. Only a real Buffer post id can be
    // queried; a draft UUID (no ref recorded), a URL-shaped ref (a permalink the
    // publish pipeline can store as published_ref — not a queryable PostId), or
    // an empty value all have nothing to fetch, so we return empty without a
    // wasted round-trip.
    if (!externalId || UUID_RE.test(externalId) || externalId.startsWith('http')) {
      return EMPTY_METRICS;
    }

    // Buffer post statistics are CUMULATIVE since publish — Buffer exposes no
    // per-window breakdown, so the same totals come back regardless of the
    // fetch window (1h/24h). True windowed metrics need the LinkedIn/X native
    // analytics APIs (V2). A cumulative number still beats zero.
    let body: PostMetricsResponse | null = null;
    try {
      const res = await fetch(GRAPHQL_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: POST_METRICS, variables: { id: externalId } }),
      });
      body = (await res.json().catch(() => null)) as PostMetricsResponse | null;
    } catch (err) {
      console.error(`[buffer:metrics] ${externalId} request failed:`, err instanceof Error ? err.message : err);
      return EMPTY_METRICS;
    }

    const post = body?.data?.post;
    if (!post || !Array.isArray(post.metrics)) {
      // "Post not found" (stale/deleted ref) or no metrics yet — not an error,
      // just nothing to record. Degrade to empty so the queue still drains.
      const reason = body?.errors?.[0]?.extensions?.code ?? body?.errors?.[0]?.message ?? 'no_metrics';
      console.log(`[buffer:metrics] ${externalId}: ${reason} → empty`);
      return EMPTY_METRICS;
    }

    // Map Buffer's per-network metric `type`s onto hailmery's MetricsResult
    // (shared with the historical importer).
    return mapBufferMetrics(post.metrics);
  }

  /**
   * List a channel's historical posts for the importer. Buffer's GraphQL
   * `posts(input: PostsInput!)` requires the channel's organizationId, so we
   * resolve that from the channel first, then paginate. Defaults to status
   * 'sent' (already-published posts that carry real engagement metrics).
   * Throws on transport/GraphQL errors so the importer can surface them — unlike
   * fetchMetrics(), which degrades to empty because the metrics queue must drain.
   */
  async listHistoricalPosts(
    channelId: string,
    opts: { status?: string; pageSize?: number; maxPages?: number } = {},
  ): Promise<BufferHistoricalPost[]> {
    if (!channelId) throw new Error('listHistoricalPosts: channelId required');
    const status = opts.status ?? 'sent';
    const pageSize = Math.min(Math.max(opts.pageSize ?? 100, 1), 100);
    const maxPages = opts.maxPages ?? 200;

    // 1) Resolve organizationId — PostsInput.organizationId is required.
    const orgBody = await this.graphql<ChannelOrgResponse>(CHANNEL_ORG, {
      input: { id: channelId },
    });
    const organizationId = orgBody.data?.channel?.organizationId ?? null;
    if (!organizationId) {
      throw new Error(`Buffer: could not resolve organizationId for channel ${channelId}`);
    }

    // 2) Paginate the channel's posts at the requested status.
    const out: BufferHistoricalPost[] = [];
    let after: string | null = null;
    for (let page = 0; page < maxPages; page++) {
      // Explicit annotation breaks a control-flow inference cycle: `after` is
      // reassigned below from `conn` (← body), and is also an argument here.
      const body: ListPostsResponse = await this.graphql<ListPostsResponse>(LIST_POSTS, {
        input: { organizationId, filter: { channelIds: [channelId], status } },
        first: pageSize,
        after,
      });
      const conn = body.data?.posts;
      if (!conn) break;
      for (const edge of conn.edges ?? []) {
        const n = edge.node;
        const rawMetrics: Record<string, number> = {};
        for (const m of n.metrics ?? []) rawMetrics[m.type] = Number(m.value) || 0;
        out.push({
          id: n.id,
          text: typeof n.text === 'string' ? n.text : '',
          status: n.status,
          // sentAt is the canonical publish time for a sent post; fall back
          // defensively so a draft/scheduled post still carries a timestamp.
          sentAt: n.sentAt ?? n.dueAt ?? n.createdAt ?? null,
          serviceType: n.channelService ?? '',
          channelId: n.channelId ?? channelId,
          externalLink: n.externalLink ?? null,
          metrics: mapBufferMetrics(n.metrics),
          rawMetrics,
        });
      }
      if (!conn.pageInfo?.hasNextPage) break;
      after = conn.pageInfo.endCursor ?? null;
      if (!after) break;
    }
    return out;
  }

  /** POST a GraphQL query; throw on transport or GraphQL-level errors. */
  private async graphql<T extends { errors?: Array<{ message: string }> }>(
    query: string,
    variables: Record<string, unknown>,
  ): Promise<T> {
    const res = await fetch(GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });
    const body = (await res.json().catch(() => null)) as T | null;
    if (!body) throw new Error(`Buffer GraphQL: empty/non-JSON response (HTTP ${res.status})`);
    if (body.errors?.length) {
      throw new Error(`Buffer GraphQL error: ${JSON.stringify(body.errors).slice(0, 400)}`);
    }
    return body;
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
