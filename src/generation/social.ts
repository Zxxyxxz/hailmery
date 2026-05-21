// Social-post generator — same RAG + cached Sonnet 4.6 pattern as blog.ts,
// but produces three variants per topic: LinkedIn / X / short-form hook.

import { sql } from 'drizzle-orm';
import type { NeonDatabase } from 'drizzle-orm/neon-serverless';
import { anthropic, MODELS } from '../lib/ai.js';
import { embedOne } from '../corpus/embedder.js';
import { withTenantDb } from '../lib/tenant.js';
import { siteConfig } from '../db/schema.js';

export interface SocialPack {
  linkedin: string;
  x: string;
  hook: string;
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

export async function generateSocialPack(opts: {
  db: NeonDatabase<Record<string, unknown>>;
  tenantId: string;
  tenantName: string;
  topic: string;
}): Promise<SocialPack> {
  const { db, tenantId, tenantName, topic } = opts;

  const topicVector = await embedOne(topic);
  if (!topicVector.every((n) => Number.isFinite(n))) {
    throw new Error('topic embedding contained non-finite values');
  }
  const topicLiteral = sql.raw(`'[${topicVector.join(',')}]'::vector`);

  const { brandVoice, chunks } = await withTenantDb(db, tenantId, async (tx) => {
    const cfgRows = await tx.select({ bv: siteConfig.brandVoice }).from(siteConfig).limit(1);
    const bv = (cfgRows[0]?.bv ?? {}) as Record<string, unknown>;
    const res = await tx.execute<ChunkRow>(sql`
      SELECT dc.chunk_text,
             d.source_filename,
             dc.embedding <=> ${topicLiteral} AS distance
      FROM marketing.document_chunks dc
      JOIN marketing.documents d ON dc.document_id = d.id
      WHERE dc.superseded = false
      ORDER BY dc.embedding <=> ${topicLiteral}
      LIMIT 6
    `);
    return { brandVoice: bv, chunks: res.rows };
  });

  if (chunks.length === 0) {
    throw new Error(
      `No corpus chunks found for tenant ${tenantId}. Run ingest first.`
    );
  }

  const staticPrefix = [
    `You write social-media copy for ${tenantName}.`,
    '',
    'Brand voice (apply to every line):',
    JSON.stringify(brandVoice, null, 2),
    '',
    'Hard rules:',
    '1. Only state product, feature, or capability claims that are explicitly supported by the corpus provided in the next block.',
    '2. Do not invent product names. If you would need to name something not in the corpus, write generically.',
    '3. Use specific numbers from the corpus (e.g., "27+ threats", "5-minute deploy", "950+ DLP rules") where they fit naturally.',
    '4. Avoid generic AI marketing phrasing — no "game-changing", "revolutionary", "seamless", "next-generation".',
    '5. Output STRICT JSON only. No prose before or after. Schema below.',
  ].join('\n');

  const corpusBlock = [
    'Corpus excerpts ranked by relevance to the topic. Ground every claim in these.',
    '',
    ...chunks.map(
      (c, i) =>
        `── Excerpt ${i + 1} — source: ${c.source_filename} ──\n${c.chunk_text.trim()}`
    ),
  ].join('\n\n');

  const userPrompt = [
    `Topic: ${topic}`,
    '',
    'Produce three variants:',
    '',
    '1. LINKEDIN — 200-300 words, thought-leadership angle, professional but not stiff. Open with a sharp observation or a specific data point. Show genuine expertise (the corpus gives you the substance). End with a single question to drive comments. No hashtags in the body; you may add 1-3 at the very end.',
    '',
    '2. X — under 280 characters total INCLUDING the hashtags. Punchy hook. Maximum 2 relevant hashtags at the end. No threading; one self-contained post.',
    '',
    '3. HOOK — first-line scroll-stopper under 100 characters. Designed to be reused as Instagram caption opener, TikTok caption opener, or email subject line. No emoji unless it lands.',
    '',
    'Output format (strict JSON, no fences, no prose):',
    '{',
    '  "linkedin": "<the full LinkedIn post>",',
    '  "x": "<the full X post>",',
    '  "hook": "<the short-form hook>"',
    '}',
  ].join('\n');

  const response = await anthropic().messages.create({
    model: MODELS.SONNET,
    max_tokens: 2048,
    system: [
      { type: 'text', text: staticPrefix, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: corpusBlock },
    ],
    messages: [{ role: 'user', content: userPrompt }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Claude returned no text content');
  }
  const raw = textBlock.text;

  // Extract JSON (model may wrap in fences sometimes)
  const jsonStr = extractJson(raw);
  let parsed: { linkedin?: string; x?: string; hook?: string };
  try {
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    throw new Error(`Failed to parse social JSON: ${(err as Error).message}\nRaw:\n${raw.slice(0, 500)}`);
  }

  return {
    linkedin: String(parsed.linkedin ?? '').trim(),
    x: String(parsed.x ?? '').trim(),
    hook: String(parsed.hook ?? '').trim(),
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

function extractJson(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) return fence[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return text;
  return text.slice(start, end + 1);
}
