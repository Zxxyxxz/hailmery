import type { ContentDraft } from '../db/schema.js';
import {
  type ChannelAdapter,
  type AdapterCredentials,
  type MetricsResult,
  type QuotaState,
  type PublishResult,
  EMPTY_METRICS,
  adapterFetch,
  AdapterHttpError,
} from './index.js';

const BASE = 'https://www.wixapis.com/blog/v3';

export interface WixBlogCredentials extends AdapterCredentials {
  extra: {
    wixSiteId: string;
  };
}

interface WixPostPayload {
  title: string;
  excerpt?: string;
  content?: string;
  coverMedia?: { image?: string };
  tags?: string[];
  categoryIds?: string[];
}

export class WixBlogAdapter implements ChannelAdapter {
  readonly platform = 'wix-blog';
  private readonly token: string;
  private readonly siteId: string;

  constructor(creds: WixBlogCredentials) {
    this.token = creds.accessToken;
    this.siteId = creds.extra.wixSiteId;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
      'wix-site-id': this.siteId,
    };
  }

  async draft(content: WixPostPayload): Promise<{ postId: string; url: string }> {
    const body = {
      post: {
        title: content.title,
        excerpt: content.excerpt,
        richContent: content.content ? { text: content.content } : undefined,
        coverMedia: content.coverMedia,
        tags: content.tags,
        categoryIds: content.categoryIds,
        status: 'DRAFT',
      },
    };

    const res = await adapterFetch(`${BASE}/posts`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    const data = (await res.json()) as {
      post?: { id: string; url: string };
    };

    return {
      postId: data.post?.id ?? '',
      url: data.post?.url ?? '',
    };
  }

  async publish(draft: ContentDraft): Promise<PublishResult> {
    const payload = draft.payload as Record<string, unknown>;

    if (payload.wixPostId) {
      const postId = payload.wixPostId as string;
      const res = await adapterFetch(`${BASE}/posts/${postId}`, {
        method: 'PATCH',
        headers: this.headers(),
        body: JSON.stringify({ post: { status: 'PUBLISHED' } }),
      });
      const data = (await res.json()) as {
        post?: { id: string; url: string };
      };
      return {
        externalId: postId,
        url: data.post?.url,
        raw: data,
      };
    }

    const result = await this.draft({
      title: (payload.title as string) ?? '',
      excerpt: payload.excerpt as string | undefined,
      content: payload.content as string | undefined,
      coverMedia: payload.coverMedia as { image?: string } | undefined,
      tags: payload.tags as string[] | undefined,
      categoryIds: payload.categoryIds as string[] | undefined,
    });

    await adapterFetch(`${BASE}/posts/${result.postId}`, {
      method: 'PATCH',
      headers: this.headers(),
      body: JSON.stringify({ post: { status: 'PUBLISHED' } }),
    });

    return { externalId: result.postId, url: result.url };
  }

  async fetchMetrics(_draftId: string): Promise<MetricsResult> {
    return EMPTY_METRICS;
  }

  async quotaState(): Promise<QuotaState> {
    try {
      const res = await adapterFetch(
        `${BASE}/posts?status=PUBLISHED&limit=1`,
        { method: 'GET', headers: this.headers() },
      );
      await res.json();
      return { connected: true, details: { status: 'ok' } };
    } catch (err) {
      if (err instanceof AdapterHttpError) {
        return {
          connected: false,
          details: { status: 'error', code: err.status },
        };
      }
      throw err;
    }
  }
}
