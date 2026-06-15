// Audience Fit guardian (Session 12) — judges whether a post suits the target
// audience, resolved (in priority order) from the campaign audience brief, the
// persona corpus, then the configured brand-voice audience. Not applicable to
// general-audience channels (blog). Skips gracefully when no audience is known.

import type { GuardianContext } from './context.js';
import type { AudienceFitResult } from './types.js';
import { haikuJson, clampScore, readFlags, str } from './llm.js';

// Channels where audience-fit does not meaningfully apply.
const NOT_APPLICABLE = new Set(['blog', 'wix-blog']);

export async function runAudienceFitGuardian(ctx: GuardianContext): Promise<AudienceFitResult> {
  if (NOT_APPLICABLE.has(ctx.channel)) {
    return {
      guardian: 'audience_fit',
      score: 1.0,
      flags: [],
      skipped: false,
      notApplicable: true,
    };
  }
  if (!ctx.hasPersonaContext) {
    return {
      guardian: 'audience_fit',
      score: 1.0,
      flags: [],
      skipped: true,
      skipReason: 'No target audience defined',
    };
  }
  if (!ctx.draftText.trim()) {
    return {
      guardian: 'audience_fit',
      score: 1.0,
      flags: [],
      skipped: true,
      skipReason: 'Draft has no text to evaluate',
    };
  }

  const audienceDescription = [
    ctx.audienceBrief ? `Campaign audience brief: ${ctx.audienceBrief}` : '',
    ...ctx.personaChunks.slice(0, 3),
    ctx.targetAudience ? `Brand target audience: ${ctx.targetAudience}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const system = `You are an audience fit validator. Evaluate whether this ${ctx.channel} post is appropriate for the target audience.

TARGET AUDIENCE:
${audienceDescription}

Return ONLY valid JSON:
{
  "score": 0.0-1.0,
  "persona_match": "brief description of who this post best suits",
  "flags": [ { "issue": "specific mismatch", "suggestion": "exact fix" } ]
}

Rules:
- score 0.9-1.0: excellent audience match
- score 0.7-0.89: good match, minor adjustments possible
- below 0.7: significant audience mismatch
- max 2 flags, each specific and actionable
- if the content is technical but the audience is strategic (or vice-versa), flag it.`;

  const result = await haikuJson(system, `CONTENT TO EVALUATE:\n${ctx.draftText}`, 500);

  return {
    guardian: 'audience_fit',
    score: clampScore(result.score, 1.0),
    personaMatch: str(result.persona_match),
    flags: readFlags(
      result.flags,
      (e) => {
        const issue = str(e.issue);
        return issue ? { issue, suggestion: str(e.suggestion) ?? '' } : null;
      },
      2,
    ),
    skipped: false,
    // Audience inferred only from a campaign brief (no dedicated persona corpus).
    limitedData: ctx.personaChunks.length === 0 && !!ctx.audienceBrief,
  };
}
