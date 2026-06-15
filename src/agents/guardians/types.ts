// Multi-guardian system (Session 12) — shared result types.
//
// Five specialised validators run in parallel after generation. Each does ONE
// job and degrades gracefully: when it lacks the context to score, it returns
// `skipped: true` with a human skipReason rather than crashing or emitting a
// meaningless number. Only platform_rules can BLOCK a publish; every other
// guardian is advisory. Scores are plain `number` (0..1) end-to-end so they
// stay assignable to the existing GuardianBadge contract (score.toFixed(2)).

/** A platform-rules violation. `severity:'blocking'` is the only thing that
 *  can stop a publish; 'warning' is advisory. */
export interface PlatformRuleFlag {
  rule: string;
  severity: 'blocking' | 'warning';
  message: string;
  actual?: number;
  limit?: string | number;
}

export interface PlatformRulesResult {
  guardian: 'platform_rules';
  /** 1 = no blocking flag, 0 = at least one blocking flag. Plain number. */
  score: number;
  passed: boolean;
  blocking: boolean;
  flags: PlatformRuleFlag[];
  skipped: false;
}

export interface FactualResult {
  guardian: 'factual';
  score: number;
  flags: Array<{ claim: string; issue: string }>;
  skipped: boolean;
  skipReason?: string;
  /** true when the corpus is thin (<3 chunks) so the score is low-confidence. */
  limitedData?: boolean;
}

export interface BrandVoiceResult {
  guardian: 'brand_voice';
  score: number;
  flags: Array<{ issue: string; suggestion: string }>;
  skipped: boolean;
  skipReason?: string;
  limitedData?: boolean;
}

export interface AudienceFitResult {
  guardian: 'audience_fit';
  score: number;
  /** Which persona this post best matches (free text from the model). */
  personaMatch?: string;
  flags: Array<{ issue: string; suggestion: string }>;
  skipped: boolean;
  skipReason?: string;
  /** true for channels where audience-fit doesn't apply (e.g. blog). */
  notApplicable?: boolean;
  limitedData?: boolean;
}

export interface PerformancePredictionResult {
  guardian: 'performance_prediction';
  /** Engagement multiplier vs the channel median (1.0 = average, 2.0 = double). */
  predictedScore: number;
  signals: Array<{ type: 'positive' | 'warning'; message: string }>;
  skipped: boolean;
  skipReason?: string;
  examplesUsed: number;
}

/** A setup prompt surfaced when a guardian had to skip for missing context. */
export interface MissingContextItem {
  guardian: string;
  message: string;
  /** What the operator can do to unlock the guardian. */
  action: string;
  /** Deep link into the dashboard settings (e.g. /settings?tab=corpus). */
  actionUrl?: string;
}

export interface GuardianBreakdown {
  /** Weighted average of the non-skipped advisory guardians (0..1). 1.0 when
   *  every advisory guardian skipped (no signal = no penalty). */
  overall: number;
  /** true iff platform_rules raised a blocking flag — publish is refused. */
  blocking: boolean;
  platformRules: PlatformRulesResult;
  factual: FactualResult;
  brandVoice: BrandVoiceResult;
  audienceFit: AudienceFitResult;
  performancePrediction: PerformancePredictionResult;
  missingContext: MissingContextItem[];
  runAt: string;
  /** The LLM the advisory guardians used (cost-control audit trail). */
  model: string;
}
