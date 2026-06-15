// Multi-guardian orchestrator (Session 12).
//
// Resolves context ONCE, then runs all five guardians. Platform Rules is
// synchronous (no LLM); the four advisory guardians run concurrently under
// Promise.allSettled so one failing never blocks the others — a rejected
// guardian degrades to a neutral skip report. The overall score is the weighted
// average of the non-skipped 0..1 advisory guardians (factual, brand_voice,
// audience_fit); platform_rules (pass/fail) and performance (a multiplier) are
// reported separately, not folded into it.

import type { NeonDatabase } from 'drizzle-orm/neon-serverless';
import { MODELS } from '../../lib/ai.js';
import { resolveGuardianContext } from './context.js';
import { runPlatformRulesGuardian } from './platform-rules.js';
import { runFactualGuardian } from './factual.js';
import { runBrandVoiceGuardian } from './brand-voice.js';
import { runAudienceFitGuardian } from './audience-fit.js';
import { runPerformancePredictionGuardian } from './performance-prediction.js';
import type {
  AudienceFitResult,
  BrandVoiceResult,
  FactualResult,
  GuardianBreakdown,
  PerformancePredictionResult,
} from './types.js';

export * from './types.js';
export { resolveGuardianContext, guardianDraftText } from './context.js';
export type { GuardianContext, GoldenExample } from './context.js';

function settled<T>(r: PromiseSettledResult<T>, fallback: T): T {
  return r.status === 'fulfilled' ? r.value : fallback;
}

/** Backward-compatible payload fields derived from a breakdown: the legacy
 *  guardianScore (= overall, read by normalizeDraft + GuardianBadge), a one-line
 *  guardianNotes summary, and the total flag count. */
export function summarizeGuardianBreakdown(b: GuardianBreakdown): {
  guardianScore: number;
  guardianNotes: string;
  flagCount: number;
} {
  const advisoryFlags = b.factual.flags.length + b.brandVoice.flags.length + b.audienceFit.flags.length;
  let guardianNotes: string;
  if (b.blocking) {
    const blockingFlag = b.platformRules.flags.find((f) => f.severity === 'blocking');
    guardianNotes = blockingFlag ? blockingFlag.message : 'Blocked by platform rules';
  } else if (advisoryFlags === 0) {
    guardianNotes = 'All guardians passed';
  } else {
    guardianNotes = `${advisoryFlags} advisory suggestion${advisoryFlags === 1 ? '' : 's'}`;
  }
  return { guardianScore: b.overall, guardianNotes, flagCount: advisoryFlags + b.platformRules.flags.length };
}

export async function runAllGuardians(opts: {
  db: NeonDatabase<Record<string, unknown>>;
  tenantId: string;
  channel: string;
  draftText: string;
  draftPayload?: Record<string, unknown>;
  campaignId?: string | null;
}): Promise<GuardianBreakdown> {
  const ctx = await resolveGuardianContext(opts);

  // Deterministic, synchronous, free — and the only blocking guardian.
  const platformRules = runPlatformRulesGuardian(ctx);

  const [factualS, brandVoiceS, audienceS, performanceS] = await Promise.allSettled([
    runFactualGuardian(ctx),
    runBrandVoiceGuardian(ctx),
    runAudienceFitGuardian(ctx),
    runPerformancePredictionGuardian(ctx),
  ]);

  const factual = settled<FactualResult>(factualS, {
    guardian: 'factual',
    score: 1.0,
    flags: [],
    skipped: true,
    skipReason: 'Guardian error — factual check unavailable',
  });
  const brandVoice = settled<BrandVoiceResult>(brandVoiceS, {
    guardian: 'brand_voice',
    score: 1.0,
    flags: [],
    skipped: true,
    skipReason: 'Guardian error — brand voice check unavailable',
  });
  const audienceFit = settled<AudienceFitResult>(audienceS, {
    guardian: 'audience_fit',
    score: 1.0,
    flags: [],
    skipped: true,
    skipReason: 'Guardian error — audience fit check unavailable',
  });
  const performancePrediction = settled<PerformancePredictionResult>(performanceS, {
    guardian: 'performance_prediction',
    predictedScore: 1.0,
    signals: [],
    skipped: true,
    skipReason: 'Guardian error — performance prediction unavailable',
    examplesUsed: 0,
  });

  // Only the 0..1 advisory guardians that actually ran contribute to `overall`.
  const scored = [factual, brandVoice, audienceFit].filter((g) => !g.skipped && !('notApplicable' in g && g.notApplicable));
  const overall =
    scored.length > 0 ? scored.reduce((sum, g) => sum + g.score, 0) / scored.length : 1.0;

  return {
    overall,
    blocking: !platformRules.passed,
    platformRules,
    factual,
    brandVoice,
    audienceFit,
    performancePrediction,
    missingContext: ctx.missingContext,
    runAt: new Date().toISOString(),
    model: MODELS.HAIKU,
  };
}
