// Token-aware chunking using cl100k_base (same tokenizer as
// text-embedding-3-small, so chunk sizes line up with the model).

import { encode, decode } from 'gpt-tokenizer';

const DEFAULT_CHUNK = 512;
const DEFAULT_OVERLAP = 64;

export function countTokens(text: string): number {
  return encode(text).length;
}

/**
 * Sliding-window chunker.
 *
 * - 512-token chunks with 64-token overlap (PLAN.md spec).
 * - If the text is shorter than the chunk size, returns one chunk.
 * - Tokens are decoded back to text, so chunks are valid UTF-8 strings.
 */
export function chunkByTokens(
  text: string,
  size = DEFAULT_CHUNK,
  overlap = DEFAULT_OVERLAP
): string[] {
  if (size <= overlap) throw new Error('chunk size must exceed overlap');
  const tokens = encode(text);
  if (tokens.length <= size) return [text];

  const step = size - overlap;
  const chunks: string[] = [];
  for (let i = 0; i < tokens.length; i += step) {
    const end = Math.min(i + size, tokens.length);
    const slice = tokens.slice(i, end);
    chunks.push(decode(slice));
    if (end >= tokens.length) break;
  }
  return chunks;
}
