// Brand Voice guardian (Session 12) — scores how well a draft matches the
// tenant's configured brand voice (site_config.brand_voice + any brand_guideline
// corpus chunks + an optional campaign voice modifier). Skips gracefully when no
// brand voice is configured. Explicitly does NOT penalise confident/bold/
// contrarian language when the brand voice itself is confident/bold.

import type { GuardianContext } from './context.js';
import type { BrandVoiceResult } from './types.js';
import { haikuJson, clampScore, readFlags, str } from './llm.js';

export async function runBrandVoiceGuardian(ctx: GuardianContext): Promise<BrandVoiceResult> {
  if (!ctx.hasBrandVoiceContext) {
    return {
      guardian: 'brand_voice',
      score: 1.0,
      flags: [],
      skipped: true,
      skipReason: 'No brand voice configured',
    };
  }
  if (!ctx.draftText.trim()) {
    return {
      guardian: 'brand_voice',
      score: 1.0,
      flags: [],
      skipped: true,
      skipReason: 'Draft has no text to evaluate',
    };
  }

  const brandVoiceDescription = [
    ctx.brandVoiceConfig ? JSON.stringify(ctx.brandVoiceConfig) : '',
    ...ctx.brandVoiceChunks,
  ]
    .filter(Boolean)
    .join('\n\n');

  const voiceModifier = ctx.voiceModifier ? `\nCampaign voice modifier: ${ctx.voiceModifier}` : '';

  const system = `You are a brand voice validator. Evaluate this ${ctx.channel} post against the brand voice guidelines below.

BRAND VOICE GUIDELINES:
${brandVoiceDescription}${voiceModifier}

Return ONLY valid JSON (no explanation, no markdown):
{
  "score": 0.0-1.0,
  "flags": [ { "issue": "specific problem found", "suggestion": "exact fix" } ]
}

Rules:
- score 0.9-1.0: strong voice match
- score 0.7-0.89: minor deviations, still publishable
- score below 0.7: significant voice mismatch
- flags: only flag real issues, max 3 flags
- suggestions must be specific and actionable
- IMPORTANT: a strong, assertive, contrarian voice that matches the brand IS correct — do NOT penalise confident/bold language when the brand voice is confident/bold.`;

  const result = await haikuJson(system, `CONTENT TO EVALUATE:\n${ctx.draftText}`, 500);

  return {
    guardian: 'brand_voice',
    score: clampScore(result.score, 1.0),
    flags: readFlags(
      result.flags,
      (e) => {
        const issue = str(e.issue);
        return issue ? { issue, suggestion: str(e.suggestion) ?? '' } : null;
      },
      3,
    ),
    skipped: false,
    limitedData: ctx.brandVoiceChunks.length < 3 && !ctx.brandVoiceConfig,
  };
}
