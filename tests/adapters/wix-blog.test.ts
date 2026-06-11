import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WixBlogAdapter, toRicos, type WixBlogCredentials } from '../../src/adapters/wix-blog.js';
import type { ContentDraft } from '../../src/db/schema.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const creds: WixBlogCredentials = {
  accessToken: 'wix_test_key',
  extra: { wixSiteId: 'site-id-abc', wixMemberId: 'member-xyz' },
};

function makeDraft(overrides: Partial<ContentDraft> = {}): ContentDraft {
  return {
    id: 'draft-1',
    tenantId: 'tenant-1',
    campaignId: null,
    siteId: 'site-1',
    pillar: null,
    channel: 'wix-blog',
    status: 'approved',
    payload: {
      title: 'NIS2 Compliance Guide',
      excerpt: 'A primer on EU NIS2 requirements',
      body: 'Rich text content\n\nSecond paragraph',
    },
    assets: {},
    scoreHuman: null,
    dismissReason: null,
    publishAt: null,
    publishedRef: null,
    costCents: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as ContentDraft;
}

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
    headers: new Headers(),
  };
}

describe('WixBlogAdapter', () => {
  let adapter: WixBlogAdapter;

  beforeEach(() => {
    // mockReset (not clearAllMocks) so any unconsumed mockResolvedValueOnce from
    // a prior test cannot leak into the next.
    mockFetch.mockReset();
    adapter = new WixBlogAdapter(creds);
  });

  describe('publish', () => {
    it('creates + publishes a text-only draft (no image) in a single call', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ draftPost: { id: 'post-abc', url: 'https://apire.io/blog/nis2' } }),
      );

      const result = await adapter.publish(makeDraft());

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://www.wixapis.com/blog/v3/draft-posts');
      // Wix API-key auth is the raw key (NOT "Bearer …") plus wix-site-id.
      expect(init.headers).toHaveProperty('Authorization', 'wix_test_key');
      expect(init.headers).toHaveProperty('wix-site-id', 'site-id-abc');

      const body = JSON.parse(init.body as string);
      expect(body.publish).toBe(true);
      expect(body.draftPost.title).toBe('NIS2 Compliance Guide');
      expect(body.draftPost.memberId).toBe('member-xyz');
      expect(body.draftPost.media).toBeUndefined();

      expect(result.externalId).toBe('post-abc');
      expect(result.url).toBe('https://apire.io/blog/nis2');
    });

    it('imports an https cover image and attaches it as media', async () => {
      mockFetch
        .mockResolvedValueOnce(
          jsonResponse({
            file: {
              id: 'wixmedia_123~mv2.png',
              url: 'https://static.wixstatic.com/media/wixmedia_123~mv2.png',
            },
          }),
        )
        .mockResolvedValueOnce(jsonResponse({ draftPost: { id: 'post-img', url: 'https://apire.io/blog/x' } }));

      const draft = makeDraft({ assets: { imageUrl: 'https://hailmery-api.example/api/assets/k.png' } });
      const result = await adapter.publish(draft);

      expect(mockFetch).toHaveBeenCalledTimes(2);

      const [importUrl, importInit] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(importUrl).toBe('https://www.wixapis.com/site-media/v1/files/import');
      const importBody = JSON.parse(importInit.body as string);
      expect(importBody.url).toBe('https://hailmery-api.example/api/assets/k.png');
      expect(importBody.mediaType).toBe('IMAGE');

      const [createUrl, createInit] = mockFetch.mock.calls[1] as [string, RequestInit];
      expect(createUrl).toBe('https://www.wixapis.com/blog/v3/draft-posts');
      const createBody = JSON.parse(createInit.body as string);
      expect(createBody.draftPost.media).toEqual({
        displayed: true,
        custom: true,
        altText: 'NIS2 Compliance Guide',
        wixMedia: {
          image: {
            id: 'wixmedia_123~mv2.png',
            url: 'https://static.wixstatic.com/media/wixmedia_123~mv2.png',
          },
        },
      });

      expect(result.externalId).toBe('post-img');
    });

    it('inserts an inline IMAGE node in the body (reusing the cover media) before the first H2', async () => {
      mockFetch
        .mockResolvedValueOnce(
          jsonResponse({
            file: { id: 'wixmedia_inline~mv2.png', url: 'https://static.wixstatic.com/media/wixmedia_inline~mv2.png' },
          }),
        )
        .mockResolvedValueOnce(jsonResponse({ draftPost: { id: 'post-inline' } }));

      // Body mirrors a generated blog: intro paragraphs, a "---" divider, then
      // the first "## " section — now lowered to real Ricos DIVIDER/HEADING nodes.
      const body = ['Intro paragraph one.', 'Intro paragraph two.', '---', '## First section', 'Section body.'].join('\n\n');
      const draft = makeDraft({
        payload: { title: 'Inline Image Post', excerpt: 'x', body },
        assets: { imageUrl: 'https://hailmery-api.example/api/assets/k.png' },
      });
      await adapter.publish(draft);

      const createBody = JSON.parse((mockFetch.mock.calls[1][1] as RequestInit).body as string);
      const nodes = createBody.draftPost.richContent.nodes as Array<Record<string, any>>;
      const imgIdx = nodes.findIndex((n) => n.type === 'IMAGE');
      const h2Idx = nodes.findIndex((n) => n.type === 'HEADING' && n.headingData?.level === 2);

      expect(imgIdx).toBeGreaterThan(-1); // an inline image was inserted
      expect(h2Idx).toBeGreaterThan(-1); // the "## " section is a real HEADING node
      expect(imgIdx).toBeLessThan(h2Idx); // …after the intro, before the first H2 heading
      const img = nodes[imgIdx];
      expect(img.imageData.image.src.id).toBe('wixmedia_inline~mv2.png'); // reuses the cover media id
      expect(img.imageData.containerData.alignment).toBe('CENTER');
      expect(img.imageData.containerData.width.size).toBe('CONTENT');
      expect(img.imageData.caption).toBe('Inline Image Post');
      expect(img.imageData.altText).toBe('Inline Image Post');
      // The cover (featured) image is still attached alongside the inline one.
      expect(createBody.draftPost.media.wixMedia.image.id).toBe('wixmedia_inline~mv2.png');
    });

    it('does not insert an inline IMAGE node when there is no cover image', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ draftPost: { id: 'post-noimg' } }));
      await adapter.publish(makeDraft()); // no assets.imageUrl
      const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
      const nodes = body.draftPost.richContent.nodes as Array<Record<string, any>>;
      expect(nodes.some((n) => n.type === 'IMAGE')).toBe(false);
    });

    it('skips a base64 data: image (not https) and publishes text-only', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ draftPost: { id: 'post-b64' } }));

      const draft = makeDraft({ assets: { imageUrl: 'data:image/png;base64,AAAA' } });
      const result = await adapter.publish(draft);

      expect(mockFetch).toHaveBeenCalledOnce(); // no import attempted
      const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
      expect(body.draftPost.media).toBeUndefined();
      expect(result.externalId).toBe('post-b64');
    });

    it('falls back to a text-only post when the cover image import fails', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ error: 'forbidden' }, 403)) // import fails
        .mockResolvedValueOnce(jsonResponse({ draftPost: { id: 'post-noimg' } }));

      const draft = makeDraft({ assets: { imageUrl: 'https://hailmery-api.example/api/assets/k.png' } });
      const result = await adapter.publish(draft);

      expect(mockFetch).toHaveBeenCalledTimes(2);
      const createBody = JSON.parse((mockFetch.mock.calls[1][1] as RequestInit).body as string);
      expect(createBody.draftPost.media).toBeUndefined(); // import failed → no cover, still publishes
      expect(result.externalId).toBe('post-noimg');
    });
  });

  describe('fetchMetrics', () => {
    it('returns empty metrics (Wix has no per-post analytics endpoint here)', async () => {
      const metrics = await adapter.fetchMetrics('any-id');
      expect(metrics).toEqual({ impressions: 0, clicks: 0, engagement: 0, attributedLeads: 0 });
    });
  });

  describe('quotaState', () => {
    it('returns connected on success', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ draftPosts: [] }));
      const quota = await adapter.quotaState();
      expect(quota.connected).toBe(true);
    });

    it('returns disconnected on auth failure', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'unauthorized' }, 401));
      const quota = await adapter.quotaState();
      expect(quota.connected).toBe(false);
      expect(quota.details.code).toBe(401);
    });
  });

  describe('error handling', () => {
    it('throws AdapterHttpError on 429 from draft-post create', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}, 429));
      await expect(adapter.publish(makeDraft())).rejects.toThrow('HTTP 429');
    });

    it('throws AdapterHttpError on 500 from draft-post create', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}, 500));
      await expect(adapter.publish(makeDraft())).rejects.toThrow('HTTP 500');
    });
  });
});

// ── markdown → Ricos conversion (the V1 "raw markdown shows literally" fix) ──
describe('toRicos', () => {
  const runs = (node: { nodes?: any[] }) => node.nodes ?? [];
  const textOf = (node: { nodes?: any[] }) => runs(node).map((c) => c.textData?.text ?? '').join('');

  it('converts "## " to a HEADING node of level 2 (not literal "##" text)', () => {
    const { nodes } = toRicos('## Why phasing matters');
    expect(nodes[0].type).toBe('HEADING');
    expect(nodes[0].headingData?.level).toBe(2);
    expect(textOf(nodes[0])).toBe('Why phasing matters'); // the "## " marker is gone
    expect(nodes[0].nodes[0].type).toBe('TEXT');
  });

  it('maps "### " to HEADING level 3 and "#### " to level 4', () => {
    expect(toRicos('### Sub').nodes[0].headingData?.level).toBe(3);
    expect(toRicos('#### Deep').nodes[0].headingData?.level).toBe(4);
  });

  it('converts "**bold**" to a TEXT run with a BOLD decoration', () => {
    const { nodes } = toRicos('Normal **bold** again');
    expect(nodes[0].type).toBe('PARAGRAPH');
    const texts = runs(nodes[0]);
    expect(texts.map((t: any) => t.textData.text)).toEqual(['Normal ', 'bold', ' again']);
    expect(texts[0].textData.decorations).toEqual([]);
    expect(texts[1].textData.decorations).toEqual([{ type: 'BOLD', fontWeightValue: 700 }]);
    expect(texts[2].textData.decorations).toEqual([]);
    // no literal "**" leaks into any text run
    expect(texts.some((t: any) => t.textData.text.includes('**'))).toBe(false);
  });

  it('converts "*italic*" to an ITALIC decoration', () => {
    const { nodes } = toRicos('an *emphasised* word');
    const italic = runs(nodes[0]).find((t: any) => t.textData.text === 'emphasised');
    expect(italic.textData.decorations).toEqual([{ type: 'ITALIC', italicData: true }]);
  });

  it('converts "[text](url)" to a LINK decoration carrying the url', () => {
    const { nodes } = toRicos('see [our docs](https://apire.io/docs) now');
    const link = runs(nodes[0]).find((t: any) => t.textData.text === 'our docs');
    expect(link.textData.decorations[0].type).toBe('LINK');
    expect(link.textData.decorations[0].linkData.link.url).toBe('https://apire.io/docs');
  });

  it('converts a "---" rule in the body to a DIVIDER node', () => {
    const { nodes } = toRicos('Intro.\n\n---\n\n## Next');
    const types = nodes.map((n) => n.type);
    expect(types).toEqual(['PARAGRAPH', 'DIVIDER', 'HEADING']);
    expect(nodes[1].dividerData).toMatchObject({ lineStyle: 'SINGLE' });
  });

  it('converts "- " bullets to a BULLETED_LIST of LIST_ITEM > PARAGRAPH > TEXT', () => {
    const { nodes } = toRicos('- one\n- two\n- three');
    expect(nodes[0].type).toBe('BULLETED_LIST');
    expect(nodes[0].nodes).toHaveLength(3);
    const li = nodes[0].nodes[0];
    expect(li.type).toBe('LIST_ITEM');
    expect(li.nodes[0].type).toBe('PARAGRAPH');
    expect(textOf(li.nodes[0])).toBe('one');
  });

  it('converts "1. " items to an ORDERED_LIST, merging blank-line-separated (loose) items', () => {
    const { nodes } = toRicos('1. first\n\n2. second\n\n3. third');
    expect(nodes).toHaveLength(1);
    expect(nodes[0].type).toBe('ORDERED_LIST');
    expect(nodes[0].nodes).toHaveLength(3); // one list, three items — not three lists
  });

  it('strips a leading YAML frontmatter block instead of turning "---" into a DIVIDER', () => {
    const md = ['---', 'title: My Post', 'slug: my-post', '---', '', '## Body heading', '', 'Body text.'].join('\n');
    const { nodes } = toRicos(md);
    expect(nodes.some((n) => n.type === 'DIVIDER')).toBe(false); // frontmatter --- not a divider
    expect(nodes[0].type).toBe('HEADING'); // first real node is the body heading
    expect(textOf(nodes[0])).toBe('Body heading');
    expect(JSON.stringify(nodes)).not.toContain('title: My Post'); // frontmatter text gone
  });

  it('keeps a leading "---" divider when it is not real frontmatter', () => {
    // First inner line is not a "key:" pair → not frontmatter → stays a DIVIDER.
    const { nodes } = toRicos('---\n\nActual content.');
    expect(nodes[0].type).toBe('DIVIDER');
  });

  it('always returns a non-empty Ricos document', () => {
    expect(toRicos('').nodes.length).toBeGreaterThan(0);
    expect(toRicos('').nodes[0].type).toBe('PARAGRAPH');
  });

  // ── hardening (adversarial review) ──
  it('captures a fenced code block as CODE_BLOCK without parsing its interior', () => {
    const { nodes } = toRicos('```js\n# not a heading\nconst x = 1;\n---\n```');
    expect(nodes[0].type).toBe('CODE_BLOCK');
    expect(nodes.some((n) => n.type === 'HEADING')).toBe(false); // the "# " comment is not a heading
    expect(nodes.some((n) => n.type === 'DIVIDER')).toBe(false); // the "---" inside the fence is not a divider
    expect(textOf(nodes[0])).toContain('# not a heading'); // interior preserved verbatim
  });

  it('drops a javascript: link but keeps its text (no unsafe url reaches Ricos)', () => {
    const { nodes } = toRicos('Click [here](javascript:alert(1)) now');
    const decos = runs(nodes[0]).flatMap((t: any) => t.textData.decorations);
    expect(decos.some((d: any) => d.type === 'LINK')).toBe(false);
    expect(textOf(nodes[0])).toBe('Click here now');
  });

  it('keeps balanced parentheses inside a link URL', () => {
    const { nodes } = toRicos('See [Cat](https://en.wikipedia.org/wiki/Cat_(animal)) here');
    const link = runs(nodes[0]).find((t: any) => t.textData.decorations[0]?.type === 'LINK');
    expect(link.textData.decorations[0].linkData.link.url).toBe('https://en.wikipedia.org/wiki/Cat_(animal)');
    expect(link.textData.text).toBe('Cat');
  });

  it('does NOT treat a leading "---" + prose as frontmatter (no content eaten)', () => {
    const md = '---\nWarning: do not skip this.\n\nRun the CLI first.\n---\nThen restart.';
    const json = JSON.stringify(toRicos(md));
    expect(json).toContain('Run the CLI first');
    expect(json).toContain('Then restart');
  });

  it('does not italicize literal asterisks in prose like "2*n and 3*m"', () => {
    const { nodes } = toRicos('Set width to 2*n and 3*m pixels.');
    const decos = runs(nodes[0]).flatMap((t: any) => t.textData.decorations);
    expect(decos.some((d: any) => d.type === 'ITALIC')).toBe(false);
    expect(textOf(nodes[0])).toBe('Set width to 2*n and 3*m pixels.');
  });

  it('converts "***x***" to a run with both BOLD and ITALIC decorations', () => {
    const { nodes } = toRicos('This is ***critical*** today');
    const t = runs(nodes[0]).find((x: any) => x.textData.text === 'critical');
    expect(t.textData.decorations.map((d: any) => d.type).sort()).toEqual(['BOLD', 'ITALIC']);
  });

  it('drops an empty "## " heading line instead of leaking "##" into the next paragraph', () => {
    const { nodes } = toRicos('## \n\nReal body text.');
    expect(nodes.every((n) => n.type !== 'HEADING')).toBe(true);
    expect(nodes[0].type).toBe('PARAGRAPH');
    expect(textOf(nodes[0])).toBe('Real body text.');
  });

  it('does not overflow the stack on a long flat run of emphasis markers', () => {
    const md = '*a* '.repeat(20000); // would blow the stack with tail recursion
    expect(() => toRicos(md)).not.toThrow();
  });
});
