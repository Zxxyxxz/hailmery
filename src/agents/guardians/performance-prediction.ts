// Performance Prediction guardian (Session 12) — predicts engagement vs the
// channel median by comparing the new post to the tenant's highest-performing
// past content on that channel. Learns over time: needs a minimum number of
// golden examples (real, measured, top-decile content_drafts for this channel)
// before its prediction is trustworthy, so it skips with an encouraging message
// below that threshold rather than guessing.

import type { GuardianContext } from './context.js';
import type { PerformancePredictionResult } from './types.js';
import { haikuJson, clampScore, readFlags, str } from './llm.js';

const MIN_EXAMPLES_REQUIRED = 5;

export async function runPerformancePredictionGuardian(
  ctx: GuardianContext,
): Promise<PerformancePredictionResult> {
  if (ctx.goldenExampleCount < MIN_EXAMPLES_REQUIRED) {
    return {
      guardian: 'performance_prediction',
      predictedScore: 1.0,
      signals: [],
      skipped: true,
      skipReason:
        ctx.goldenExampleCount === 0
          ? `No performance data for ${ctx.channel} yet — publish more content to enable predictions`
          : `Only ${ctx.goldenExampleCount} example${ctx.goldenExampleCount === 1 ? '' : 's'} — need ${MIN_EXAMPLES_REQUIRED} for reliable predictions`,
      examplesUsed: 0,
    };
  }
  if (!ctx.draftText.trim()) {
    return {
      guardian: 'performance_prediction',
      predictedScore: 1.0,
      signals: [],
      skipped: true,
      skipReason: 'Draft has no text to evaluate',
      examplesUsed: 0,
    };
  }

  const topExamples = [...ctx.goldenExamples].sort((a, b) => b.score - a.score).slice(0, 5);
  const examplesText = topExamples
    .map((e, i) => `Example ${i + 1} (${e.score.toFixed(2)}x median):\n${e.text.slice(0, 300)}`)
    .join('\n\n');

  const system = `You are a content performance predictor. Based on this brand's highest-performing past ${ctx.channel} posts, predict how the new post will perform.

TOP PERFORMING EXAMPLES (each scored above the channel median):
${examplesText}

Return ONLY valid JSON:
{
  "predicted_score": 0.5-3.0,
  "signals": [ { "type": "positive", "message": "specific strength" }, { "type": "warning", "message": "specific weakness vs the top performers" } ]
}

Rules:
- predicted_score is an engagement multiplier vs the channel median (1.0 = average, 2.0 = double, 0.5 = half)
- max 2 positive signals and max 2 warning signals
- signals must reference specific patterns observed in the examples
- do NOT penalise assertive/bold language if the examples use it.`;

  const result = await haikuJson(system, `NEW POST TO EVALUATE:\n${ctx.draftText}`, 600);

  return {
    guardian: 'performance_prediction',
    predictedScore: clampScore(result.predicted_score, 1.0, 0, 3),
    signals: readFlags(
      result.signals,
      (e) => {
        const message = str(e.message);
        if (!message) return null;
        const type = e.type === 'warning' ? 'warning' : 'positive';
        return { type, message };
      },
      4,
    ),
    skipped: false,
    examplesUsed: topExamples.length,
  };
}
