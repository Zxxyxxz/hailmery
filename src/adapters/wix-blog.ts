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
// Wix Media Manager — a blog cover image must be a Wix media item, not an
// arbitrary external URL, so we import the generated image here first and
// reference the returned media id on the draft post.
const MEDIA_BASE = 'https://www.wixapis.com/site-media/v1';

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

  /**
   * Import an external HTTPS image into the site's Media Manager and return the
   * Wix media reference for use as cover media. Returns null on any failure —
   * the post still publishes, just without a cover (prior behavior). The Wix
   * import is async (operationStatus: PENDING) but the returned id is a valid
   * reference immediately; the cover renders once processing completes.
   */
  private async importCoverImage(
    imageUrl: string,
    altText: string,
  ): Promise<{ id: string; url?: string } | null> {
    try {
      const res = await adapterFetch(`${MEDIA_BASE}/files/import`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          url: imageUrl,
          mediaType: 'IMAGE',
          // The image generator always emits PNG (generation/image.ts writes
          // `${imageType}.png` to R2 with contentType image/png). Pass mimeType
          // explicitly — the documented, format-independent way for Wix to
          // resolve the type for the extension-less /api/assets proxy URL — and
          // keep a .png displayName as a belt-and-suspenders hint.
          mimeType: 'image/png',
          displayName: `${(altText || 'cover').slice(0, 80).replace(/[^\w .-]/g, '_')}.png`,
        }),
      });
      const data = (await res.json()) as { file?: { id?: string; url?: string } };
      const file = data.file;
      if (!file?.id) return null;
      return { id: file.id, url: file.url };
    } catch (err) {
      console.error(
        '[wix-blog] cover image import failed (publishing without cover):',
        err instanceof Error ? err.message : err,
      );
      return null;
    }
  }

  /** Create a draft post; when `publish` is true Wix creates and publishes it. */
  async createDraftPost(
    content: { title: string; excerpt?: string; body: string },
    publish: boolean,
    cover?: { id: string; url?: string } | null,
  ): Promise<{ id: string; url?: string; raw: unknown }> {
    const draftPost: Record<string, unknown> = {
      title: content.title,
      excerpt: content.excerpt,
      memberId: this.memberId,
      richContent: toRicos(content.body),
    };
    // Cover/featured image. `media.wixMedia.image` references a Wix media item
    // (id + url); `custom:true` marks it as an explicitly-set cover (vs. the
    // first in-content image) and `displayed:true` shows it in feeds.
    if (cover?.id) {
      const altText = content.title.slice(0, 1000).trim();
      draftPost.media = {
        displayed: true,
        custom: true,
        // Cover alt text (schema requires minLength 1 when present) — the post
        // title is the natural description for accessibility/SEO.
        ...(altText ? { altText } : {}),
        wixMedia: { image: { id: cover.id, ...(cover.url ? { url: cover.url } : {}) } },
      };
    }

    const res = await adapterFetch(`${BASE}/draft-posts`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ draftPost, publish, fieldsets: ['URL'] }),
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

    // Attach a cover image when the draft carries a real HTTPS asset URL (the
    // /api/assets proxy URL the image generator sets after an R2 write — never a
    // base64 data: URI, which Wix cannot fetch). Best-effort: a failed import
    // logs and falls back to a text-only post.
    const draftAssets = (draft.assets ?? {}) as Record<string, unknown>;
    const imageUrl =
      typeof draftAssets.imageUrl === 'string' && draftAssets.imageUrl.startsWith('https://')
        ? draftAssets.imageUrl
        : undefined;
    const cover = imageUrl ? await this.importCoverImage(imageUrl, title) : null;

    const result = await this.createDraftPost({ title, excerpt, body }, true, cover);
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
