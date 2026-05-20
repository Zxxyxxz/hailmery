// Thin singletons for the two AI vendors V0 uses.

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

// Model IDs locked per PLAN.md.
export const MODELS = {
  SONNET: 'claude-sonnet-4-6',           // primary text generation
  HAIKU: 'claude-haiku-4-5-20251001',     // brand guardian
  EMBED: 'text-embedding-3-small',         // 1536-dim corpus + topic embeddings
} as const;

let _anthropic: Anthropic | null = null;
let _openai: OpenAI | null = null;

export function anthropic(): Anthropic {
  if (!_anthropic) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
    _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _anthropic;
}

export function openai(): OpenAI {
  if (!_openai) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}
