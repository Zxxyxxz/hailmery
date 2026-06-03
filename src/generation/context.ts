// Shared generation context — the RAG + tenant-resolution plumbing that blog.ts
// established, factored out so social/email/image reuse it instead of copy-paste.
//
// loadGenContext() does, in one tenant-scoped transaction:
//   - resolve the tenant display name, first site, and target campaign
//   - read the site's brand_voice blob
//   - RAG top-k=8 corpus chunks for the topic (same query shape as blog.ts)
//   - RAG top-3 golden examples (document_type='golden_example') if any exist
//
// insertDraft() writes a pending_review row to content_drafts and returns its id.

import { sql } from 'drizzle-orm';
import type { NeonDatabase } from 'drizzle-orm/neon-serverless';
import { embedOne } from '../corpus/embedder.js';
import { withTenantDb } from '../lib/tenant.js';

export interface RetrievedChunk {
  chunk_text: string;
  source_filename: string;
  distance: number;
}

interface ChunkRow extends Record<string, unknown> {
  chunk_text: string;
  source_filename: string;
  distance: number;
}
interface NameRow extends Record<string, unknown> {
  name: string;
}
interface IdRow extends Record<string, unknown> {
  id: string;
}
interface BrandVoiceRow extends Record<string, unknown> {
  brand_voice: Record<string, unknown>;
}

// A `type` (not `interface`) so it gets an implicit index signature and stays
// assignable to Record<string, number | undefined> (scripts/v0-pipeline.ts).
export type DraftUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};

export interface GenContext {
  tenantId: string;
  tenantName: string;
  siteId: string;
  campaignId: string | null;
  brandVoice: Record<string, unknown>;
  voiceModifier?: string;
  chunks: RetrievedChunk[];
  golden: RetrievedChunk[];
}

/**
 * Resolves everything a generator needs from a tenant id + topic. Throws if the
 * tenant has no site or no corpus (both are operator setup errors, not runtime
 * conditions to paper over).
 */
export async function loadGenContext(opts: {
  db: NeonDatabase<Record<string, unknown>>;
  tenantId: string;
  topic: string;
  campaignId?: string | null;
  topK?: number;
  goldenK?: number;
  voiceModifier?: string;
}): Promise<GenContext> {
  const { db, tenantId, topic, campaignId, topK = 8, goldenK = 3, voiceModifier } = opts;

  const topicVector = await embedOne(topic);
  if (!topicVector.every((n) => Number.isFinite(n))) {
    throw new Error('topic embedding contained non-finite values');
  }
  const vec = sql.raw(`'[${topicVector.join(',')}]'::vector`);

  const resolved = await withTenantDb(db, tenantId, async (tx) => {
    const nameRows = await tx.execute<NameRow>(
      sql`SELECT name FROM marketing.tenants WHERE id = ${tenantId} LIMIT 1`,
    );
    const tenantName = nameRows.rows[0]?.name ?? 'the brand';

    const siteRows = await tx.execute<IdRow>(
      sql`SELECT id FROM marketing.sites WHERE tenant_id = ${tenantId} ORDER BY created_at LIMIT 1`,
    );
    const siteId = siteRows.rows[0]?.id;
    if (!siteId) throw new Error(`Tenant ${tenantId} has no site. Run \`pnpm db:seed\` first.`);

    // Campaign resolution: explicit id wins; else prefer the default evergreen
    // campaign; else any campaign; else null (content_drafts.campaign_id is
    // nullable, so an unattached draft is still valid).
    let resolvedCampaign: string | null = campaignId ?? null;
    if (!resolvedCampaign) {
      const campRows = await tx.execute<IdRow>(sql`
        SELECT id FROM marketing.campaigns
        WHERE tenant_id = ${tenantId}
        ORDER BY (type = 'evergreen') DESC, created_at
        LIMIT 1
      `);
      resolvedCampaign = campRows.rows[0]?.id ?? null;
    }

    const cfgRows = await tx.execute<BrandVoiceRow>(
      sql`SELECT brand_voice FROM marketing.site_config WHERE site_id = ${siteId} LIMIT 1`,
    );
    const brandVoice = (cfgRows.rows[0]?.brand_voice ?? {}) as Record<string, unknown>;

    const chunkRes = await tx.execute<ChunkRow>(sql`
      SELECT dc.chunk_text, d.source_filename, dc.embedding <=> ${vec} AS distance
      FROM marketing.document_chunks dc
      JOIN marketing.documents d ON dc.document_id = d.id
      WHERE dc.superseded = false
      ORDER BY dc.embedding <=> ${vec}
      LIMIT ${topK}
    `);

    const goldenRes = await tx.execute<ChunkRow>(sql`
      SELECT dc.chunk_text, d.source_filename, dc.embedding <=> ${vec} AS distance
      FROM marketing.document_chunks dc
      JOIN marketing.documents d ON dc.document_id = d.id
      WHERE dc.superseded = false AND d.document_type = 'golden_example'
      ORDER BY dc.embedding <=> ${vec}
      LIMIT ${goldenK}
    `);

    return {
      tenantName,
      siteId,
      campaignId: resolvedCampaign,
      brandVoice,
      chunks: chunkRes.rows,
      golden: goldenRes.rows,
    };
  });

  if (resolved.chunks.length === 0) {
    throw new Error(
      `No corpus chunks found for tenant ${tenantId}. Run \`pnpm ingest --tenant <slug>\` first.`,
    );
  }

  return {
    tenantId,
    tenantName: resolved.tenantName,
    siteId: resolved.siteId,
    campaignId: resolved.campaignId,
    brandVoice: resolved.brandVoice,
    voiceModifier,
    chunks: resolved.chunks,
    golden: resolved.golden,
  };
}

/** Brand-voice + hard-rules preamble shared by every generator's system prompt. */
export function brandVoicePreamble(tenantName: string, brandVoice: Record<string, unknown>, voiceModifier?: string): string {
  const lines = [
    `Brand voice for ${tenantName} (apply to every sentence):`,
    JSON.stringify(brandVoice, null, 2),
  ];
  if (voiceModifier) {
    lines.push('', `Campaign voice modifier (overrides the above where they conflict): ${voiceModifier}`);
  }
  lines.push(
    '',
    'Hard rules:',
    '1. Only state product, feature, or capability claims explicitly supported by the corpus in the next block.',
    '2. Never invent product or feature names. If you would need a name not in the corpus, write generically.',
    '3. Use specific numbers from the corpus (e.g. "27+ threats", "5-minute deploy", "160,000+ NIS2 entities") where they fit naturally.',
    '4. Avoid generic AI-marketing slop — no "game-changing", "revolutionary", "seamless", "next-generation", "leverage", "in today\'s fast-paced world".',
    '5. No hedging ("might", "could", "we believe"). When unsure of a fact, omit it rather than soften it.',
  );
  return lines.join('\n');
}

export function buildCorpusBlock(chunks: RetrievedChunk[]): string {
  return [
    'Corpus excerpts ranked by relevance to the topic (closest first). Ground every factual claim in these.',
    '',
    ...chunks.map(
      (c, i) => `── Excerpt ${i + 1} — source: ${c.source_filename} ──\n${c.chunk_text.trim()}`,
    ),
  ].join('\n\n');
}

export function buildGoldenBlock(golden: RetrievedChunk[]): string {
  if (golden.length === 0) return '';
  return [
    'High-performing examples of our content style. Match this quality and voice — match their rhythm, structure, and confidence; do not copy their wording.',
    '',
    ...golden.map((g, i) => `── Golden ${i + 1} — ${g.source_filename} ──\n${g.chunk_text.trim()}`),
  ].join('\n\n');
}

export function usageOf(u: { input_tokens: number; output_tokens: number }): DraftUsage {
  return {
    input_tokens: u.input_tokens,
    output_tokens: u.output_tokens,
    cache_read_input_tokens:
      (u as { cache_read_input_tokens?: number }).cache_read_input_tokens ?? undefined,
    cache_creation_input_tokens:
      (u as { cache_creation_input_tokens?: number }).cache_creation_input_tokens ?? undefined,
  };
}

/** Rough Sonnet 4.6 cost in whole cents ($3/$15 per Mtok in/out), floored at 1. */
export function estimateTextCostCents(usage: DraftUsage, inPerM = 3, outPerM = 15): number {
  const dollars = (usage.input_tokens / 1e6) * inPerM + (usage.output_tokens / 1e6) * outPerM;
  return Math.max(1, Math.round(dollars * 100));
}

/** Pull a JSON object out of a model response, tolerating ```json fences. */
export function extractJson(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) return fence[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return text;
  return text.slice(start, end + 1);
}

/** Strip a leading "Here's your post:" style preamble and surrounding fences/quotes. */
export function cleanProse(text: string): string {
  let t = text.trim();
  const fence = t.match(/```(?:[a-z]*)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  // Drop wrapping quotes if the model quoted the whole thing.
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith('“') && t.endsWith('”'))) {
    t = t.slice(1, -1).trim();
  }
  return t;
}

export async function insertDraft(opts: {
  db: NeonDatabase<Record<string, unknown>>;
  tenantId: string;
  siteId: string;
  campaignId: string | null;
  channel: string;
  payload: Record<string, unknown>;
  pillar?: string | null;
  costCents?: number;
}): Promise<string> {
  const { db, tenantId, siteId, campaignId, channel, payload, pillar = null, costCents = 0 } = opts;
  return withTenantDb(db, tenantId, async (tx) => {
    const r = await tx.execute<IdRow>(sql`
      INSERT INTO marketing.content_drafts
        (tenant_id, campaign_id, site_id, pillar, channel, status, payload, cost_cents)
      VALUES (
        ${tenantId}, ${campaignId}, ${siteId}, ${pillar}, ${channel},
        'pending_review', ${JSON.stringify(payload)}::jsonb, ${costCents}
      )
      RETURNING id
    `);
    return r.rows[0].id;
  });
}
