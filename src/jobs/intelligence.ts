// Weekly intelligence brief — the Monday 08:00 UTC job.
//
// For a tenant it:
//   1. Loads a corpus summary (top positioning + product chunks) and distils a
//      one-paragraph description of what the company does and who it serves.
//   2. Runs Claude Sonnet 4.6 with the web_search tool to research the past 7
//      days of AI-security news — breaking incidents, new AI/LLM CVEs, EU AI
//      Act / NIS2 enforcement, competitor moves, trending LinkedIn topics — and
//      return 5-7 specific topics this company should post about this week.
//   3. Upserts the result into marketing.intelligence_briefs (one row per
//      tenant per ISO week), which the dashboard surfaces as "This week's topics".
//
// Best-effort by design: the model reads its keys from process.env (mirrored
// from Worker secrets by mirrorEnvToProcess), and the cron tick swallows
// per-tenant failures so one tenant never blocks the fleet.

import { sql } from 'drizzle-orm';
import type { NeonDatabase } from 'drizzle-orm/neon-serverless';
import type Anthropic from '@anthropic-ai/sdk';
import { anthropic, MODELS } from '../lib/ai.js';
import { embedOne } from '../corpus/embedder.js';
import { withTenantDb } from '../lib/tenant.js';
import { makeDb } from '../db/client.js';
import { getAllActiveTenants } from '../lib/tenant.js';
import { mirrorEnvToProcess, type PipelineEnv } from '../workflows/types.js';

export const TOPIC_URGENCIES = ['breaking', 'trending', 'evergreen'] as const;
export type TopicUrgency = (typeof TOPIC_URGENCIES)[number];

export const TOPIC_CHANNELS = ['linkedin', 'blog', 'x', 'email'] as const;
export type TopicChannel = (typeof TOPIC_CHANNELS)[number];

export interface IntelligenceTopic {
  topic: string;
  angle: string;
  urgency: TopicUrgency;
  source_summary: string;
  suggested_channel: TopicChannel;
  why_relevant: string;
}

export interface IntelligenceBriefResult {
  briefId: string;
  tenantId: string;
  weekOf: string; // YYYY-MM-DD (Monday)
  topics: IntelligenceTopic[];
  companyDescription: string;
  generatedAt: string;
}

interface ChunkRow extends Record<string, unknown> {
  chunk_text: string;
  source_filename: string;
}
interface NameRow extends Record<string, unknown> {
  name: string;
}
interface IdRow extends Record<string, unknown> {
  id: string;
}

/** Monday (UTC) of the week containing `d`, as YYYY-MM-DD. */
export function mondayOf(d: Date = new Date()): string {
  const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = dt.getUTCDay(); // 0 = Sunday … 6 = Saturday
  const diff = dow === 0 ? -6 : 1 - dow;
  dt.setUTCDate(dt.getUTCDate() + diff);
  return dt.toISOString().slice(0, 10);
}

export async function generateWeeklyIntelligenceBrief(opts: {
  db: NeonDatabase<Record<string, unknown>>;
  tenantId: string;
  tenantName?: string;
  weekOf?: string;
  maxSearches?: number;
}): Promise<IntelligenceBriefResult> {
  const { db, tenantId } = opts;
  const weekOf = opts.weekOf ?? mondayOf();
  const maxSearches = opts.maxSearches ?? 6;

  // ── 1. Corpus summary → one-paragraph company description ─────────────────
  const positioningVec = await embedOne(
    'company positioning what the product does who it serves target customers product overview value proposition competitors',
  );
  const pvec = sql.raw(`'[${positioningVec.join(',')}]'::vector`);

  const { tenantName, chunks } = await withTenantDb(db, tenantId, async (tx) => {
    let name = opts.tenantName;
    if (!name) {
      const nameRows = await tx.execute<NameRow>(
        sql`SELECT name FROM marketing.tenants WHERE id = ${tenantId} LIMIT 1`,
      );
      name = nameRows.rows[0]?.name ?? 'the company';
    }
    const cr = await tx.execute<ChunkRow>(sql`
      SELECT dc.chunk_text, d.source_filename
      FROM marketing.document_chunks dc
      JOIN marketing.documents d ON dc.document_id = d.id
      WHERE dc.superseded = false
      ORDER BY dc.embedding <=> ${pvec}
      LIMIT 8
    `);
    return { tenantName: name, chunks: cr.rows };
  });

  const corpusExcerpts = chunks.map((c) => c.chunk_text.trim()).join('\n\n');
  const companyDescription = await summariseCompany(tenantName, corpusExcerpts);

  // ── 2. Research the past 7 days with Sonnet 4.6 + web search ──────────────
  const topics = await researchTopics(tenantName, companyDescription, maxSearches);

  // ── 3. Upsert one row per tenant per week ─────────────────────────────────
  const generatedAt = new Date().toISOString();
  const briefId = await withTenantDb(db, tenantId, async (tx) => {
    const r = await tx.execute<IdRow>(sql`
      INSERT INTO marketing.intelligence_briefs (tenant_id, week_of, topics, status, generated_at)
      VALUES (${tenantId}, ${weekOf}::date, ${JSON.stringify(topics)}::jsonb, 'pending', now())
      ON CONFLICT (tenant_id, week_of)
        DO UPDATE SET topics = EXCLUDED.topics,
                      generated_at = now(),
                      status = 'pending'
      RETURNING id
    `);
    return r.rows[0].id;
  });

  console.log(
    `[intelligence] tenant=${tenantId} week_of=${weekOf} topics=${topics.length} brief=${briefId}`,
  );

  return { briefId, tenantId, weekOf, topics, companyDescription, generatedAt };
}

// ── helpers ──────────────────────────────────────────────────────────────────

async function summariseCompany(tenantName: string, corpusExcerpts: string): Promise<string> {
  if (!corpusExcerpts.trim()) {
    return `${tenantName} — (no corpus available; run \`pnpm ingest\` for richer targeting).`;
  }
  const response = await anthropic().messages.create({
    model: MODELS.SONNET,
    max_tokens: 300,
    system: [
      {
        type: 'text',
        text:
          'You distil a company into one tight paragraph for a research analyst. ' +
          'Output ONE paragraph (no preamble, no bullet points): what the company does, ' +
          'its product, and exactly who it serves (the ICP). Ground every claim in the excerpts.',
      },
    ],
    messages: [
      {
        role: 'user',
        content: `Company: ${tenantName}\n\nCorpus excerpts:\n${corpusExcerpts.slice(0, 6000)}\n\nWrite the one-paragraph description now.`,
      },
    ],
  });
  const block = response.content.find((b) => b.type === 'text');
  return block && block.type === 'text' ? block.text.trim() : `${tenantName} — AI security platform.`;
}

async function researchTopics(
  tenantName: string,
  companyDescription: string,
  maxSearches: number,
): Promise<IntelligenceTopic[]> {
  const system = [
    `You are a content intelligence analyst for ${tenantName}.`,
    `About ${tenantName}: ${companyDescription}`,
    '',
    'Research the past 7 days of news and identify 5-7 specific topics this company should post about',
    'this week. Use the web_search tool to verify what actually happened recently. Prioritise:',
    '- Breaking AI security incidents in the past 7 days',
    '- New CVEs related to AI APIs, LLMs, or prompt injection published this week',
    '- EU AI Act or NIS2 regulatory updates or enforcement actions',
    `- Competitor announcements (competitors named in ${tenantName}'s corpus/description, if any)`,
    '- Trending LinkedIn topics in AI security and enterprise compliance this week',
    '',
    'Each topic MUST be: (1) genuinely newsworthy or timely right now, (2) directly relevant to',
    `${tenantName}'s product and audience, (3) an angle where ${tenantName} has a credible point of view.`,
    '',
    'When finished researching, return ONLY a JSON array of topic objects (no prose, no markdown fences).',
    'Each object has exactly these keys:',
    '{',
    '  "topic": "string — specific topic title",',
    `  "angle": "string — ${tenantName}'s specific point of view on this topic",`,
    '  "urgency": "breaking" | "trending" | "evergreen",',
    '  "source_summary": "string — what happened",',
    '  "suggested_channel": "linkedin" | "blog" | "x" | "email",',
    '  "why_relevant": "string — why this matters to our ICP"',
    '}',
  ].join('\n');

  // web_search is an Anthropic server tool — the API runs the searches and
  // returns the final answer in a single create() call (no client tool loop).
  const tools = [
    { type: 'web_search_20250305' as const, name: 'web_search', max_uses: maxSearches },
  ];

  const response = await anthropic().messages.create({
    model: MODELS.SONNET,
    max_tokens: 4096,
    system: [{ type: 'text', text: system }],
    tools: tools as unknown as Anthropic.Messages.ToolUnion[],
    messages: [
      {
        role: 'user',
        content:
          'Research this week and return the JSON array of 5-7 topics. Search before you answer.',
      },
    ],
  });

  // Concatenate every text block (the JSON lands in the final assistant text).
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');

  return parseTopics(text);
}

/** Pull a JSON array out of a model response, tolerating ```json fences and
 *  surrounding prose. Coerces each element into a well-formed IntelligenceTopic. */
export function parseTopics(text: string): IntelligenceTopic[] {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  let body = fence ? fence[1] : text;
  const start = body.indexOf('[');
  const end = body.lastIndexOf(']');
  if (start !== -1 && end !== -1 && end > start) body = body.slice(start, end + 1);

  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];

  return raw
    .map((r) => coerceTopic(r))
    .filter((t): t is IntelligenceTopic => t !== null);
}

function coerceTopic(r: unknown): IntelligenceTopic | null {
  if (!r || typeof r !== 'object') return null;
  const o = r as Record<string, unknown>;
  const topic = typeof o.topic === 'string' ? o.topic.trim() : '';
  if (!topic) return null;
  const urgency = (TOPIC_URGENCIES as readonly string[]).includes(o.urgency as string)
    ? (o.urgency as TopicUrgency)
    : 'trending';
  const channel = (TOPIC_CHANNELS as readonly string[]).includes(o.suggested_channel as string)
    ? (o.suggested_channel as TopicChannel)
    : 'linkedin';
  return {
    topic,
    angle: typeof o.angle === 'string' ? o.angle.trim() : '',
    urgency,
    source_summary: typeof o.source_summary === 'string' ? o.source_summary.trim() : '',
    suggested_channel: channel,
    why_relevant: typeof o.why_relevant === 'string' ? o.why_relevant.trim() : '',
  };
}

// ── cron tick — fleet-wide weekly run (Monday 08:00 UTC) ─────────────────────

export async function runIntelligenceTick(env: PipelineEnv): Promise<void> {
  mirrorEnvToProcess(env);
  const db = makeDb(env.DATABASE_URL);
  const tenants = await getAllActiveTenants(db);
  const weekOf = mondayOf();
  for (const tenant of tenants) {
    try {
      await generateWeeklyIntelligenceBrief({ db, tenantId: tenant.id, weekOf });
    } catch (err) {
      console.error(
        `[intelligence] tenant ${tenant.id} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}
