// Factual guardian (Session 12) — reuses the existing brandGuardian corpus
// fact-check (Claude Haiku) and restructures its output into the multi-guardian
// shape. Adds the context-aware skip: with no corpus, factual checking is
// impossible, so it skips with a setup reason rather than scoring a meaningless 0.

import { brandGuardian } from '../guardian.js';
import type { GuardianContext } from './context.js';
import type { FactualResult } from './types.js';

export async function runFactualGuardian(ctx: GuardianContext): Promise<FactualResult> {
  if (!ctx.hasCorpus) {
    return {
      guardian: 'factual',
      score: 1.0,
      flags: [],
      skipped: true,
      skipReason: 'No corpus documents uploaded — factual checking unavailable',
    };
  }
  if (!ctx.draftText.trim()) {
    return {
      guardian: 'factual',
      score: 1.0,
      flags: [],
      skipped: true,
      skipReason: 'Draft has no text to check',
    };
  }

  const report = await brandGuardian({ db: ctx.db, tenantId: ctx.tenantId, draftText: ctx.draftText });

  return {
    guardian: 'factual',
    score: typeof report.score === 'number' ? report.score : 1.0,
    flags: report.flagged.map((f) => ({
      claim: f.term || f.quote,
      issue: f.reasoning,
    })),
    skipped: false,
    // Thin corpus → lower confidence. We only have the brand-guideline slice in
    // ctx, so use that as the proxy signal.
    limitedData: ctx.brandVoiceChunks.length > 0 && ctx.brandVoiceChunks.length < 3,
  };
}
