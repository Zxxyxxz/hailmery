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

/** A single inline style applied to a run of text (a Ricos TEXT decoration).
 *  Schema verified against wix.rich_content.v1.Decoration + a live Wix-native
 *  post: BOLD carries fontWeightValue:700, ITALIC carries italicData:true, LINK
 *  carries linkData.link.{url,target,rel}. */
interface Decoration {
  type: 'BOLD' | 'ITALIC' | 'LINK';
  fontWeightValue?: number;
  italicData?: boolean;
  linkData?: { link: { url: string; target?: string; rel?: Record<string, boolean> } };
}

interface RicosNode {
  type: string;
  id?: string;
  nodes: RicosNode[];
  textData?: { text: string; decorations: Decoration[] };
  paragraphData?: Record<string, unknown>;
  headingData?: { level?: number };
  dividerData?: Record<string, unknown>;
  bulletedListData?: Record<string, unknown>;
  orderedListData?: Record<string, unknown>;
  codeBlockData?: Record<string, unknown>;
  imageData?: Record<string, unknown>;
}

// ── markdown → Wix Ricos rich content ────────────────────────────────────────
// The Draft Posts API requires richContent to be a valid Ricos node document.
// We parse the generated markdown body into the real Ricos node types Wix
// renders, so headings/dividers/bold/italic/links/lists display as formatting
// rather than literal "##", "---", "**…**" text (the V1 bug this replaced).
//
// Node shapes are confirmed against wix.rich_content.v1.{Node,Decoration,
// HeadingData,DividerData,BulletedListData} and a live correctly-rendered Wix
// post: HEADING{headingData.level}, DIVIDER{dividerData}, BULLETED_LIST/
// ORDERED_LIST → LIST_ITEM → PARAGRAPH → TEXT, and BOLD/ITALIC/LINK decorations
// on TEXT runs. Only asterisk emphasis (***bi***, **bold**, *italic*) is parsed
// — never underscores — so snake_case identifiers and URLs in this security/API
// content are not mangled. Inline `code` spans and ``` fenced code blocks ``` are
// emitted verbatim (no heading/list/emphasis parsing inside them), so code never
// spawns phantom headings/dividers or leaks markers. Link URLs are scheme-checked
// (javascript:/data:/vbscript: are dropped). Known unhandled markdown (degrades to
// readable text rather than corrupting): setext headings, GFM tables, blockquotes,
// nested-list indentation, and reference-style links.

/** A parsed markdown block, before lowering to Ricos nodes. */
type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'divider' }
  | { kind: 'code'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'paragraph'; text: string };

/**
 * Strip a leading YAML frontmatter block (`---\nkey: value\n…\n---`) so its
 * delimiters never become DIVIDER nodes. Deliberately strict to avoid eating
 * real content: only a block at the very start that is short (≤40 lines), whose
 * first line is a `key:` pair, that contains ≥2 key lines, and whose every
 * non-blank inner line looks like YAML (key, indented continuation, or list
 * item) is removed. A leading `---` horizontal rule followed by prose is left
 * untouched. (Generation already strips frontmatter upstream — this is a net.)
 */
function stripFrontmatter(text: string): string {
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return text;
  const inner = m[1].split(/\r?\n/);
  if (inner.length > 40) return text;
  const isKey = (l: string) => /^[A-Za-z_][\w-]*\s*:/.test(l);
  if (!isKey(inner[0] ?? '')) return text; // first inner line must be a key
  if (inner.filter(isKey).length < 2) return text; // real frontmatter has ≥2 keys
  const yamlish = inner.every((l) => l.trim() === '' || isKey(l) || /^\s+\S/.test(l) || /^\s*-\s/.test(l));
  if (!yamlish) return text; // a non-YAML line ⇒ this is body content, not frontmatter
  return text.slice(m[0].length).replace(/^\r?\n+/, '');
}

const HEADING_RE = /^(#{1,6})\s+(.*\S)\s*$/;
const DIVIDER_RE = /^(?:-{3,}|\*{3,}|_{3,})$/;
const FENCE_RE = /^(```|~~~)/;
const BULLET_RE = /^[-*+]\s+\S/;
const ORDERED_RE = /^\d+[.)]\s+\S/;

/** Group markdown lines into blocks: headings, dividers, lists (blank-line
 *  separated "loose" items still count as one list), and paragraphs. */
function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) {
      const joined = para.join(' ').trim();
      if (joined) blocks.push({ kind: 'paragraph', text: joined });
      para = [];
    }
  };

  const gatherList = (start: number, itemRe: RegExp): { items: string[]; next: number } => {
    const items: string[] = [];
    let i = start;
    while (i < lines.length) {
      const t = lines[i].trim();
      if (itemRe.test(t)) {
        items.push(t.replace(/^([-*+]|\d+[.)])\s+/, ''));
        i++;
        continue;
      }
      if (t === '') {
        // Tolerate blank lines between items (loose list) only if another item
        // of the same kind follows; otherwise the list ends here.
        let j = i;
        while (j < lines.length && lines[j].trim() === '') j++;
        if (j < lines.length && itemRe.test(lines[j].trim())) {
          i = j;
          continue;
        }
      }
      break;
    }
    return { items, next: i };
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '') {
      flush();
      continue;
    }
    // Fenced code block: consume verbatim to the closing fence so its interior
    // is never parsed as headings/dividers/lists and the fence markers don't leak.
    if (FENCE_RE.test(line)) {
      flush();
      const fence = line.slice(0, 3);
      const buf: string[] = [];
      let j = i + 1;
      while (j < lines.length && !lines[j].trim().startsWith(fence)) {
        buf.push(lines[j]); // raw line — preserve code indentation
        j++;
      }
      blocks.push({ kind: 'code', text: buf.join('\n') });
      i = j; // loop's i++ steps past the closing fence (or stays at EOF)
      continue;
    }
    if (/^#{1,6}\s*$/.test(line)) {
      flush();
      continue; // a hashes-only line is an empty ATX heading → drop it (don't leak "##")
    }
    let m: RegExpExecArray | null;
    if ((m = HEADING_RE.exec(line))) {
      flush();
      blocks.push({ kind: 'heading', level: Math.min(m[1].length, 6), text: m[2].trim() });
      continue;
    }
    if (DIVIDER_RE.test(line)) {
      flush();
      blocks.push({ kind: 'divider' });
      continue;
    }
    if (BULLET_RE.test(line)) {
      flush();
      const { items, next } = gatherList(i, BULLET_RE);
      blocks.push({ kind: 'list', ordered: false, items });
      i = next - 1;
      continue;
    }
    if (ORDERED_RE.test(line)) {
      flush();
      const { items, next } = gatherList(i, ORDERED_RE);
      blocks.push({ kind: 'list', ordered: true, items });
      i = next - 1;
      continue;
    }
    para.push(line); // consecutive plain lines join into one paragraph
  }
  flush();
  return blocks;
}

// Inline markdown rules, tried in priority order; for two matches starting at
// the same index the earlier rule wins (so `***` is bolditalic before `**` bold
// before `*` italic). URL groups allow one level of balanced parens (Wikipedia/
// API URLs) and an empty url (`[x]()` → plain text). The italic open requires a
// non-alphanumeric char before it so prose like `2*n and 3*m` is not italicized.
type InlineKind = 'code' | 'image' | 'link' | 'bolditalic' | 'bold' | 'italic';
const URL_GROUP = '((?:[^()]|\\([^()]*\\))*)';
const INLINE_RULES: Array<{ re: RegExp; kind: InlineKind }> = [
  { re: /`([^`]+)`/, kind: 'code' },
  { re: new RegExp(`!\\[([^\\]]*)\\]\\(${URL_GROUP}\\)`), kind: 'image' },
  { re: new RegExp(`\\[([^\\]]+)\\]\\(${URL_GROUP}\\)`), kind: 'link' },
  { re: /\*\*\*([\s\S]+?)\*\*\*/, kind: 'bolditalic' },
  { re: /\*\*([\s\S]+?)\*\*/, kind: 'bold' },
  { re: /(?<![A-Za-z0-9])\*([^*\s](?:[^*]*?[^*\s])?)\*/, kind: 'italic' },
];
// Pre-compiled global variants so emitInline can search from a cursor (lastIndex)
// instead of re-slicing the tail — bounding work and avoiding deep recursion.
const INLINE_RULES_G = INLINE_RULES.map((r) => ({ re: new RegExp(r.re.source, 'g'), kind: r.kind }));

const BOLD: Decoration = { type: 'BOLD', fontWeightValue: 700 };
const ITALIC: Decoration = { type: 'ITALIC', italicData: true };

function withDeco(decos: Decoration[], d: Decoration): Decoration[] {
  return decos.some((x) => x.type === d.type) ? decos : [...decos, d];
}

/** Allow only safe link schemes (http/https/mailto/tel) plus scheme-less
 *  relative/anchor URLs; reject javascript:/data:/vbscript: etc. Returns null
 *  for an unsafe or empty URL, in which case the link renders as plain text. */
function safeLinkUrl(raw: string): string | null {
  const url = raw.trim().replace(/[\u0000-\u001F\u007F]/g, '');
  if (!url) return null;
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(url);
  if (scheme && !/^(https?|mailto|tel)$/i.test(scheme[1])) return null;
  return url;
}

function pushText(out: RicosNode[], text: string, decos: Decoration[]): void {
  if (!text) return;
  out.push({
    type: 'TEXT',
    id: '',
    nodes: [],
    textData: { text, decorations: decos.map((d) => ({ ...d })) },
  });
}

/** Lower an inline markdown string to a run of Ricos TEXT nodes. The outer
 *  left-to-right walk is a loop (advancing a cursor), so a long flat run of
 *  markers cannot overflow the stack; only genuine emphasis/link nesting
 *  recurses (and that depth is tiny). */
function emitInline(s: string, decos: Decoration[], out: RicosNode[]): void {
  let i = 0;
  while (i < s.length) {
    let best: { idx: number; kind: InlineKind; m: RegExpExecArray } | null = null;
    for (const rule of INLINE_RULES_G) {
      rule.re.lastIndex = i; // search from the cursor, not from 0
      const m = rule.re.exec(s);
      if (m && (best === null || m.index < best.idx)) best = { idx: m.index, kind: rule.kind, m };
    }
    if (!best) {
      pushText(out, s.slice(i), decos);
      return;
    }
    const { idx, kind, m } = best;
    if (idx > i) pushText(out, s.slice(i, idx), decos);
    switch (kind) {
      case 'code': // no Ricos inline-code decoration → emit inner verbatim (also shields it from emphasis)
        pushText(out, m[1], decos);
        break;
      case 'image': // body images are attached separately; drop stray md image syntax
        break;
      case 'link': {
        const url = safeLinkUrl(m[2]);
        if (url) {
          // rel:noreferrer is the only safe-link rel Ricos accepts (its schema
          // is {nofollow,sponsored,ugc,noreferrer}); noreferrer implies noopener
          // in modern browsers, so target=_blank tab-nabbing is still covered.
          emitInline(
            m[1],
            withDeco(decos, { type: 'LINK', linkData: { link: { url, target: 'BLANK', rel: { noreferrer: true } } } }),
            out,
          );
        } else {
          emitInline(m[1], decos, out); // unsafe/empty url → keep the link text, drop the link
        }
        break;
      }
      case 'bolditalic':
        emitInline(m[1], withDeco(withDeco(decos, BOLD), ITALIC), out);
        break;
      case 'bold':
        emitInline(m[1], withDeco(decos, BOLD), out);
        break;
      case 'italic':
        emitInline(m[1], withDeco(decos, ITALIC), out);
        break;
    }
    i = idx + m[0].length;
  }
}

function inlineNodes(text: string): RicosNode[] {
  const out: RicosNode[] = [];
  emitInline(text, [], out);
  return out;
}

/**
 * Convert a markdown blog body to a Wix Ricos rich-content document. Headings,
 * dividers, bold/italic/links and bulleted/ordered lists become their real
 * Ricos node types; everything else is a PARAGRAPH. Node ids are unique within
 * the document. Exported for unit tests and the republish tooling.
 */
export function toRicos(text: string): { nodes: RicosNode[] } {
  // Defensive cap (Wix limits a draft post to 400KB): never let a pathological
  // body pin CPU or grow an unbounded document.
  let body = stripFrontmatter(text ?? '');
  if (body.length > 400_000) body = body.slice(0, 400_000);
  const blocks = parseBlocks(body);
  let seq = 0;
  const id = () => `n${seq++}`;
  const nodes: RicosNode[] = [];

  for (const b of blocks) {
    if (b.kind === 'heading') {
      const kids = inlineNodes(b.text);
      if (kids.length === 0) continue; // heading with no visible text (e.g. only an image) → skip
      nodes.push({ type: 'HEADING', id: id(), nodes: kids, headingData: { level: b.level } });
    } else if (b.kind === 'divider') {
      nodes.push({
        type: 'DIVIDER',
        id: id(),
        nodes: [],
        dividerData: { lineStyle: 'SINGLE', width: 'LARGE', alignment: 'CENTER' },
      });
    } else if (b.kind === 'code') {
      // Whole fenced block as one CODE_BLOCK; interior is verbatim text (one TEXT
      // run, newlines preserved) — never re-parsed, so it can't spawn nodes.
      nodes.push({
        type: 'CODE_BLOCK',
        id: id(),
        nodes: b.text ? [{ type: 'TEXT', id: '', nodes: [], textData: { text: b.text, decorations: [] } }] : [],
        codeBlockData: {},
      });
    } else if (b.kind === 'list') {
      nodes.push({
        type: b.ordered ? 'ORDERED_LIST' : 'BULLETED_LIST',
        id: id(),
        nodes: b.items.map((item) => ({
          type: 'LIST_ITEM',
          id: id(),
          nodes: [{ type: 'PARAGRAPH', id: id(), nodes: inlineNodes(item), paragraphData: {} }],
        })),
      });
    } else {
      const kids = inlineNodes(b.text);
      if (kids.length === 0) continue; // paragraph with no visible text → skip
      nodes.push({ type: 'PARAGRAPH', id: id(), nodes: kids, paragraphData: {} });
    }
  }

  // Ricos requires a non-empty document.
  if (nodes.length === 0) nodes.push({ type: 'PARAGRAPH', id: id(), nodes: [], paragraphData: {} });
  return { nodes };
}

/** Last-resort fallback: blank-line-separated PARAGRAPH nodes with no inline
 *  parsing. Only used if toRicos itself throws, so a publish never aborts. */
function plainParagraphs(text: string): { nodes: RicosNode[] } {
  const paras = (text ?? '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const src = paras.length ? paras : [''];
  return {
    nodes: src.map((p, i) => ({
      type: 'PARAGRAPH',
      id: `p${i}`,
      nodes: p ? [{ type: 'TEXT', id: '', nodes: [], textData: { text: p, decorations: [] } }] : [],
      paragraphData: {},
    })),
  };
}

// ── inline in-body image (Ricos IMAGE node) ──────────────────────────────────
// A Ricos IMAGE node references a Wix media item by id (imageData.image.src.id).
// We reuse the cover image's imported media id so the same generated visual
// appears inline in the article body. Schema verified against
// wix.rich_content.v1.{Node,ImageData,Media,PluginContainerData}: caption/altText
// are plain strings, image is Media{src:{id}}, width.size enum includes CONTENT.

/** Concatenate the visible text of a PARAGRAPH node's TEXT children. */
function paragraphText(node: RicosNode): string {
  if (node.type !== 'PARAGRAPH') return '';
  return (node.nodes ?? []).map((c) => c.textData?.text ?? '').join('');
}

/** A horizontal-rule node — a real Ricos DIVIDER (what toRicos now emits), with
 *  a defensive fallback for a markdown "---"/"***"/"___" left as a PARAGRAPH. */
function isDividerNode(node: RicosNode): boolean {
  if (node.type === 'DIVIDER') return true;
  const t = paragraphText(node).trim();
  return t === '---' || t === '***' || t === '___';
}

/** A section (H2+) heading — a real Ricos HEADING node of level ≥ 2 (what
 *  toRicos now emits), with a defensive fallback for a PARAGRAPH whose text
 *  starts with markdown "##". We target H2+ specifically so a leading "# Title"
 *  (H1) can't pull the image to the very top, matching "insert before the first
 *  H2". */
function isSectionHeadingNode(node: RicosNode): boolean {
  if (node.type === 'HEADING') {
    const level = node.headingData?.level;
    return level === undefined || level >= 2;
  }
  return paragraphText(node).trimStart().startsWith('##');
}

/** Build a Ricos IMAGE node referencing an already-imported Wix media id.
 *  Exported for the republish tooling, which reuses an existing cover media id. */
export function buildInlineImageNode(mediaId: string, altText: string, caption: string): RicosNode {
  return {
    type: 'IMAGE',
    id: `img_${crypto.randomUUID()}`,
    nodes: [],
    imageData: {
      containerData: {
        width: { size: 'CONTENT' },
        alignment: 'CENTER',
        textWrap: false,
      },
      image: { src: { id: mediaId } },
      ...(altText ? { altText } : {}),
      ...(caption ? { caption } : {}),
    },
  };
}

/**
 * Insert an inline IMAGE node after the intro paragraphs and before the first
 * section. Insertion point: immediately before the first heading (real HEADING
 * node or markdown "## …" paragraph); if a "---" divider directly precedes that
 * heading, place the image above the divider so it sits cleanly after the intro.
 * If there is no heading at all, fall back to after the 3rd paragraph node.
 * Exported for the republish tooling, which rebuilds bodies the same way.
 */
export function insertInlineImageNode(nodes: RicosNode[], node: RicosNode): void {
  let idx = nodes.findIndex(isSectionHeadingNode);
  if (idx === -1) idx = Math.min(3, nodes.length);
  if (idx > 0 && isDividerNode(nodes[idx - 1])) idx -= 1;
  nodes.splice(idx, 0, node);
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
    // toRicos is pure and well-tested, but a publish must never be aborted by a
    // markdown-parsing edge case — degrade to plain paragraphs on any throw.
    let richContent: { nodes: RicosNode[] };
    try {
      richContent = toRicos(content.body);
    } catch (err) {
      console.error('[wix-blog] toRicos failed, falling back to plain paragraphs:', err instanceof Error ? err.message : err);
      richContent = plainParagraphs(content.body);
    }
    // Inline in-body image: reuse the imported cover media as an IMAGE node placed
    // after the intro, before the first section heading. Best-effort — only when a
    // cover media id is available (no cover → text-only body, prior behavior).
    if (cover?.id) {
      const caption = content.title.slice(0, 1000).trim();
      insertInlineImageNode(richContent.nodes, buildInlineImageNode(cover.id, caption, caption));
    }

    const draftPost: Record<string, unknown> = {
      title: content.title,
      excerpt: content.excerpt,
      memberId: this.memberId,
      richContent,
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
