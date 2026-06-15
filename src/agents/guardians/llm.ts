// Shared Haiku call for the advisory LLM guardians (brand_voice, audience_fit,
// performance_prediction). Centralises the two things every guardian must get
// right to degrade-not-crash:
//   1. content-block narrowing (response.content is a union; only TextBlock has
//      .text) — done via .find, matching the repo idiom in guardian.ts/social.ts.
//   2. JSON.parse guarded by try/catch, tolerating ```json fences.
// Returns an empty object on any failure so callers fall back to neutral scores
// rather than throwing into the generation/publish path. Uses the anthropic()
// singleton (the established convention) — guardians do NOT thread a client.

import { anthropic, MODELS } from '../../lib/ai.js';
import { extractJson } from '../../generation/context.js';

export async function haikuJson(
  system: string,
  user: string,
  maxTokens = 600,
): Promise<Record<string, unknown>> {
  const response = await anthropic().messages.create({
    model: MODELS.HAIKU,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
  });

  const block = response.content.find((b) => b.type === 'text');
  const raw = block && block.type === 'text' ? block.text : '{}';

  try {
    const parsed: unknown = JSON.parse(extractJson(raw));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Clamp a model-returned score into [min,max], falling back to `fallback` when
 *  it isn't a finite number. */
export function clampScore(v: unknown, fallback: number, min = 0, max = 1): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Coerce a model-returned flags array into a typed shape, dropping malformed
 *  entries and capping the count. */
export function readFlags<T>(
  v: unknown,
  map: (entry: Record<string, unknown>) => T | null,
  max: number,
): T[] {
  if (!Array.isArray(v)) return [];
  const out: T[] = [];
  for (const entry of v) {
    if (entry && typeof entry === 'object') {
      const mapped = map(entry as Record<string, unknown>);
      if (mapped) out.push(mapped);
    }
    if (out.length >= max) break;
  }
  return out;
}

export function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}
