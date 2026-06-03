// Blog generator — RAG top-k=8 → prompt-cached Claude Sonnet 4.6 → markdown.
//
// Cache layout:
//   system[0] = static instructions + brand voice  (cached prefix)
//   system[1] = RAG-selected corpus chunks        (variable)
//   user      = topic + format contract
//
// On repeat generations against the same tenant, the static prefix hits the
// ephemeral cache for 90% input savings.

import { sql, eq, and } from 'drizzle-orm';
import type { NeonDatabase } from 'drizzle-orm/neon-serverless';
import { anthropic, MODELS } from '../lib/ai.js';
import { embedOne } from '../corpus/embedder.js';
import { withTenantDb } from '../lib/tenant.js';
import { siteConfig } from '../db/schema.js';

export interface BlogDraft {
  frontmatter: {
    title: string;
    slug: string;
    date: string;
    tags: string[];
    excerpt: string;
  };
  body: string;
  raw: string;
  sources: string[];
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

interface ChunkRow extends Record<string, unknown> {
  chunk_text: string;
  source_filename: string;
  distance: number;
}

export async function generateBlog(opts: {
  db: NeonDatabase<Record<string, unknown>>;
  tenantId: string;
  tenantName: string;
  topic: string;
  maxWords?: number;
}): Promise<BlogDraft> {
  const { db, tenantId, tenantName, topic, maxWords = 1200 } = opts;

  // 1. Embed the topic for RAG.
  const topicVector = await embedOne(topic);
  if (!topicVector.every((n) => Number.isFinite(n))) {
    throw new Error('topic embedding contained non-finite values');
  }
  const topicLiteral = sql.raw(`'[${topicVector.join(',')}]'::vector`);

  // 2. Pull brand voice + top-k=8 chunks + recent golden examples within the
  //    tenant's RLS context. Golden examples are the tenant's own top-performing
  //    drafts, promoted by the nightly metrics job — retrieving them closes the
  //    learning loop (the model matches what historically outperformed).
  const { brandVoice, chunks, golden } = await withTenantDb(db, tenantId, async (tx) => {
    const cfgRows = await tx.select({ bv: siteConfig.brandVoice }).from(siteConfig).limit(1);
    const bv = (cfgRows[0]?.bv ?? {}) as Record<string, unknown>;

    // The explicit tenant filter is load-bearing: the app connects as Neon's
    // `neondb_owner` (BYPASSRLS = true), so the tenant_isolation RLS policy is
    // NOT enforced and a query without this predicate ranks every tenant's
    // chunks together — leaking other tenants' corpus into the result.
    const res = await tx.execute<ChunkRow>(sql`
      SELECT dc.chunk_text,
             d.source_filename,
             dc.embedding <=> ${topicLiteral} AS distance
      FROM marketing.document_chunks dc
      JOIN marketing.documents d ON dc.document_id = d.id
      WHERE dc.tenant_id = ${tenantId} AND dc.superseded = false
      ORDER BY dc.embedding <=> ${topicLiteral}
      LIMIT 8
    `);

    const goldenRes = await tx.execute<{ chunk_text: string }>(sql`
      SELECT dc.chunk_text
      FROM marketing.document_chunks dc
      JOIN marketing.documents d ON dc.document_id = d.id
      WHERE dc.tenant_id = ${tenantId}
        AND d.document_type = 'golden_example'
        AND dc.superseded = false
      ORDER BY dc.created_at DESC
      LIMIT 3
    `);

    return { brandVoice: bv, chunks: res.rows, golden: goldenRes.rows };
  });

  if (chunks.length === 0) {
    throw new Error(
      `No corpus chunks found for tenant ${tenantId}. Run \`pnpm ingest --tenant ${tenantName.toLowerCase()}\` first.`
    );
  }

  // 3. Build the prompt.
  const staticPrefix = [
    `You write blog posts for ${tenantName}.`,
    '',
    'Brand voice (apply these to every sentence):',
    JSON.stringify(brandVoice, null, 2),
    '',
    'Hard rules:',
    '1. Only state product, feature, or capability claims that are explicitly supported by the corpus provided in the next block.',
    '2. Do not invent product names. If you would need to name something not in the corpus, write generically.',
    '3. Match the brand tone exactly. Avoid generic AI phrasing ("In today\'s fast-paced world", "Game-changing", etc.).',
    '4. Output strict YAML frontmatter, then a blank line, then the markdown body. Nothing before, nothing after.',
  ].join('\n');

  const corpusBlock = [
    'Corpus excerpts ranked by relevance to the topic (closest first). Cite source filenames where useful in your prose.',
    '',
    ...chunks.map(
      (c, i) =>
        `── Excerpt ${i + 1} — source: ${c.source_filename} ──\n${c.chunk_text.trim()}`
    ),
  ].join('\n\n');

  // High-performing examples retrieved from the learning loop, prepended ahead
  // of the corpus so the model anchors on proven voice before the facts.
  const goldenBlock =
    golden.length > 0
      ? [
          'High-performing examples of our content style. Match this quality and voice:',
          '',
          ...golden.map((g, i) => `── Example ${i + 1} ──\n${g.chunk_text.trim()}`),
        ].join('\n\n')
      : '';

  const today = new Date().toISOString().slice(0, 10);
  const userPrompt = [
    `Topic: ${topic}`,
    '',
    `Length: ${maxWords - 200}-${maxWords + 200} words.`,
    '',
    'Output format (strict):',
    '---',
    'title: <max 60 chars>',
    'slug: <kebab-case slug>',
    `date: ${today}`,
    'tags: [tag1, tag2, tag3]',
    'excerpt: <one-sentence summary, max 160 chars>',
    '---',
    '',
    '<markdown body>',
  ].join('\n');

  // 4. Call Sonnet 4.6 with prompt caching on the static prefix.
  const response = await anthropic().messages.create({
    model: MODELS.SONNET,
    max_tokens: 4096,
    system: [
      { type: 'text', text: staticPrefix, cache_control: { type: 'ephemeral' } },
      ...(goldenBlock ? [{ type: 'text' as const, text: goldenBlock }] : []),
      { type: 'text', text: corpusBlock },
    ],
    messages: [{ role: 'user', content: userPrompt }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Claude returned no text content');
  }
  const raw = textBlock.text;

  // 5. Parse frontmatter / body.
  const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!fmMatch) {
    throw new Error(`Output did not contain frontmatter. Raw:\n${raw.slice(0, 400)}`);
  }
  const frontmatter = parseSimpleYaml(fmMatch[1]);
  const body = fmMatch[2].trim();

  return {
    frontmatter: {
      title: String(frontmatter.title ?? ''),
      slug: String(frontmatter.slug ?? slugify(String(frontmatter.title ?? topic))),
      date: String(frontmatter.date ?? today),
      tags: Array.isArray(frontmatter.tags) ? frontmatter.tags.map(String) : [],
      excerpt: String(frontmatter.excerpt ?? ''),
    },
    body,
    raw,
    sources: chunks.map((c) => c.source_filename),
    usage: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_read_input_tokens:
        (response.usage as { cache_read_input_tokens?: number }).cache_read_input_tokens ?? undefined,
      cache_creation_input_tokens:
        (response.usage as { cache_creation_input_tokens?: number }).cache_creation_input_tokens ?? undefined,
    },
  };
}

// Minimal YAML parser: handles `key: value` and `key: [a, b, c]`. Good enough
// for Claude's frontmatter; swap for `yaml` package in V1 if we need anchors.
function parseSimpleYaml(src: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const line of src.split('\n')) {
    const m = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let val: unknown = m[2].trim();
    if (typeof val === 'string') {
      if (val.startsWith('[') && val.endsWith(']')) {
        val = val
          .slice(1, -1)
          .split(',')
          .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
          .filter((s) => s.length);
      } else if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
    }
    out[key] = val;
  }
  return out;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}
