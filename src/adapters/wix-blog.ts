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

// Wix Blog REST API (Draft Posts). There is no "create published post" endpoint:
// a post is created as a draft and then published.
//   POST /blog/v3/draft-posts                 → create (publish:true publishes it)
//   POST /blog/v3/draft-posts/{id}/publish    → publish an existing draft
// Auth: the account API key goes in the Authorization header *raw* (NOT
// "Bearer …"), plus wix-site-id for these site-level calls. See
// https://dev.wix.com/docs/api-reference/articles/authentication/api-keys/make-api-calls-with-an-api-key
// The Draft Posts API rejects a post with no owner, so `memberId` (a Wix site
// member id) is required as the post author when creating via an API key.
const BASE = 'https://www.wixapis.com/blog/v3';

export interface WixBlogCredentials extends AdapterCredentials {
  extra: {
    wixSiteId: string;
    /** Wix site member id used as the post author/owner (required by the API). */
    wixMemberId?: string;
  };
}

interface RicosNode {
  type: string;
  id?: string;
  nodes: RicosNode[];
  textData?: { text: string; decorations: unknown[] };
  paragraphData?: Record<string, unknown>;
}

/**
 * Minimal markdown/plaintext → Wix Ricos rich content. Splits on blank lines
 * into PARAGRAPH nodes; inline markdown is kept as literal text (rich
 * formatting fidelity — headings, bold, links — is a V2 item). The Draft Posts
 * API requires richContent to be a valid Ricos node document.
 */
function toRicos(text: string): { nodes: RicosNode[] } {
  const paragraphs = (text ?? '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const source = paragraphs.length ? paragraphs : [''];
  return {
    nodes: source.map((p, i) => ({
      type: 'PARAGRAPH',
      id: `p${i}`,
      nodes: [{ type: 'TEXT', nodes: [], textData: { text: p, decorations: [] } }],
      paragraphData: {},
    })),
  };
}

interface WixDraftPost {
  id: string;
  url?: { base?: string; path?: string } | string;
}

export class WixBlogAdapter implements ChannelAdapter {
  readonly platform = 'wix-blog';
  private readonly token: string;
  private readonly siteId: string;
  private readonly memberId: string | undefined;

  constructor(creds: WixBlogCredentials) {
    this.token = creds.accessToken;
    this.siteId = creds.extra.wixSiteId;
    this.memberId = creds.extra.wixMemberId;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: this.token,
      'Content-Type': 'application/json',
      'wix-site-id': this.siteId,
    };
  }

  private resolveUrl(url: WixDraftPost['url']): string | undefined {
    if (!url) return undefined;
    if (typeof url === 'string') return url || undefined;
    const joined = `${url.base ?? ''}${url.path ?? ''}`;
    return joined || undefined;
  }

  /** Create a draft post; when `publish` is true Wix creates and publishes it. */
  async createDraftPost(
    content: { title: string; excerpt?: string; body: string },
    publish: boolean,
  ): Promise<{ id: string; url?: string; raw: unknown }> {
    const res = await adapterFetch(`${BASE}/draft-posts`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        draftPost: {
          title: content.title,
          excerpt: content.excerpt,
          memberId: this.memberId,
          richContent: toRicos(content.body),
        },
        publish,
        fieldsets: ['URL'],
      }),
    });

    const data = (await res.json()) as { draftPost?: WixDraftPost };
    const post = data.draftPost;
    return {
      id: post?.id ?? '',
      url: this.resolveUrl(post?.url),
      raw: data,
    };
  }

  async publish(draft: ContentDraft): Promise<PublishResult> {
    const payload = draft.payload as Record<string, unknown>;

    // Generation writes the blog body to `payload.body`; tolerate `content` too.
    const title = String(payload.title ?? payload.topic ?? 'Untitled');
    const body = String(payload.body ?? payload.content ?? '');
    const excerpt = payload.excerpt != null ? String(payload.excerpt) : undefined;

    const result = await this.createDraftPost({ title, excerpt, body }, true);
    return { externalId: result.id, url: result.url, raw: result.raw };
  }

  async fetchMetrics(_draftId: string): Promise<MetricsResult> {
    return EMPTY_METRICS;
  }

  async quotaState(): Promise<QuotaState> {
    try {
      const res = await adapterFetch(`${BASE}/draft-posts`, {
        method: 'GET',
        headers: this.headers(),
      });
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
