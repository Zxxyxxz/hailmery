// Brand Guardian — Claude Haiku 4.5 scans a draft for product/feature names,
// company names, or technical claims that are NOT supported by the tenant's
// corpus. This is the V0 defense against Kleo's #1 failure (hallucinated
// feature names like APIRE's "W-004").
//
// Output is a strict JSON report that gets written alongside the markdown.

import { sql, eq } from 'drizzle-orm';
import type { NeonDatabase } from 'drizzle-orm/neon-serverless';
import { anthropic, MODELS } from '../lib/ai.js';
import { withTenantDb } from '../lib/tenant.js';
import { documentChunks } from '../db/schema.js';

export interface GuardianReport {
  flagged: Array<{ term: string; quote: string; reasoning: string }>;
  score: number; // 0..1, 1 = clean
  notes: string;
  model: string;
  generatedAt: string;
}

export async function brandGuardian(opts: {
  db: NeonDatabase<Record<string, unknown>>;
  tenantId: string;
  draftText: string;
}): Promise<GuardianReport> {
  const { db, tenantId, draftText } = opts;

  // Pull the tenant's full corpus text (chunks that aren't superseded).
  // For V0 corpora <50k tokens this fits in Haiku's context easily.
  const corpusText = await withTenantDb(db, tenantId, async (tx) => {
    const rows = await tx
      .select({ text: documentChunks.chunkText })
      .from(documentChunks)
      .where(eq(documentChunks.superseded, false));
    return rows.map((r) => r.text).join('\n\n');
  });

  const systemPrompt = [
    'You are a brand-fact-check agent. You are shown a CORPUS (everything we know is true about the brand) and a DRAFT.',
    '',
    'Your job: identify every product name, feature name, version number, technical capability claim, or factual assertion in the DRAFT that is NOT supported by the CORPUS.',
    '',
    'Generic phrases ("our platform", "the product") are fine if the context is supported. Specific named things ("APIRE Gateway v3", "the W-004 module") must appear in the CORPUS.',
    '',
    'Return ONLY a JSON object. No prose before or after. Schema:',
    '{',
    '  "flagged": [{ "term": "...", "quote": "<sentence from draft>", "reasoning": "<why unsupported>" }],',
    '  "score": <0.0..1.0, where 1.0 means nothing flagged>,',
    '  "notes": "<one-sentence summary>"',
    '}',
  ].join('\n');

  const corpusBlock = `CORPUS (ground truth):\n\n${corpusText || '(empty corpus)'}`;

  const response = await anthropic().messages.create({
    model: MODELS.HAIKU,
    max_tokens: 2048,
    system: [
      { type: 'text', text: systemPrompt },
      { type: 'text', text: corpusBlock, cache_control: { type: 'ephemeral' } },
    ],
    messages: [
      { role: 'user', content: `DRAFT:\n\n${draftText}\n\nReturn JSON only.` },
    ],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  const raw = textBlock && textBlock.type === 'text' ? textBlock.text : '{}';

  // Be lenient on extraction — sometimes models wrap in ```json fences.
  const jsonStr = extractJson(raw);
  let parsed: Partial<GuardianReport>;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    parsed = { flagged: [], score: 0, notes: `Failed to parse Haiku output: ${raw.slice(0, 200)}` };
  }

  return {
    flagged: Array.isArray(parsed.flagged) ? parsed.flagged : [],
    score: typeof parsed.score === 'number' ? parsed.score : 0,
    notes: typeof parsed.notes === 'string' ? parsed.notes : '',
    model: MODELS.HAIKU,
    generatedAt: new Date().toISOString(),
  };
}

function extractJson(text: string): string {
  // Strip fences if present
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) return fence[1].trim();

  // Otherwise pull the first balanced {...} object
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return text;
  return text.slice(start, end + 1);
}
