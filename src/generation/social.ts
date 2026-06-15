// Social-post generator — one post per call for a single channel.
//
// Unlike the V0 `generateSocialPack` (which produced a LinkedIn/X/hook bundle
// and wrote files), this writes a pending_review row to content_drafts so the
// post flows through the approval queue like everything else.
//
// Pattern matches blog.ts: RAG top-k=8 → cached Sonnet 4.6 → Brand Guardian.
// Per-channel rules live in CHANNEL_SPECS and are baked into the cached system
// prefix so each channel's constraints are explicit, not improvised.

import type { NeonDatabase } from 'drizzle-orm/neon-serverless';
import { anthropic, MODELS } from '../lib/ai.js';
import { runAllGuardians, summarizeGuardianBreakdown } from '../agents/guardians/index.js';
import {
  loadGenContext,
  brandVoicePreamble,
  buildCorpusBlock,
  buildGoldenBlock,
  usageOf,
  estimateTextCostCents,
  cleanProse,
  extractJson,
  insertDraft,
  type DraftUsage,
} from './context.js';

export const SOCIAL_CHANNELS = ['linkedin', 'x', 'instagram', 'tiktok', 'gbp'] as const;
export type SocialChannel = (typeof SOCIAL_CHANNELS)[number];

interface ChannelSpec {
  label: string;
  maxTokens: number;
  rules: string[];
}

const CHANNEL_SPECS: Record<SocialChannel, ChannelSpec> = {
  linkedin: {
    label: 'LinkedIn',
    maxTokens: 1024,
    rules: [
      'Length: 200-300 words.',
      'Short paragraphs — often 1-2 sentences each. Use line breaks generously.',
      'Open with a hook: a counterintuitive statement, a surprising stat, or a bold claim.',
      'Personal, authoritative tone. You sound like a senior security professional writing in the first person — NOT like a brand account.',
      'NEVER put a link or URL in the body text. LinkedIn suppresses reach for posts that contain external links in the body.',
      'End with a genuine, open question that invites the target persona (an EU CISO / security architect) to comment.',
      'At most 3 hashtags, and only at the very end on their own line.',
    ],
  },
  x: {
    label: 'X (Twitter)',
    maxTokens: 400,
    rules: [
      'HARD LIMIT: 280 characters total, including spaces and hashtags. Count carefully and do not exceed it.',
      'The first 8 words must be the hook.',
      'Exactly one concrete, specific claim or stat (pull the number from the corpus).',
      'Sound like a real expert tweeting — not a press release. No corporate language whatsoever.',
      'At most 2 hashtags, and only if genuinely relevant. Zero is fine.',
      'One self-contained post. No threads.',
    ],
  },
  instagram: {
    label: 'Instagram',
    maxTokens: 900,
    rules: [
      'Begin with a visual instruction in square brackets on its own line: [IMAGE: describe what the paired image should show].',
      'Then the caption text: 150-200 words.',
      'Conversational, slightly more casual than LinkedIn — but still credible and specific.',
      'End with 8-12 hashtags, separated from the caption by a blank line.',
    ],
  },
  tiktok: {
    label: 'TikTok',
    maxTokens: 900,
    rules: [
      'Output exactly three clearly labelled sections, in this order:',
      'HOOK (0-3 seconds): one sentence that stops the scroll — provocative or surprising, under 10 words.',
      'SCRIPT (3-45 seconds): the content written as spoken word, NOT written prose. Short, energetic sentences a person would actually say out loud.',
      'CTA (last 5 seconds): one clear action.',
      'Label each section with its name (HOOK / SCRIPT / CTA) on its own line.',
    ],
  },
  gbp: {
    label: 'Google Business Profile',
    maxTokens: 900,
    rules: [
      'Length: 150-300 words.',
      'Professional but approachable.',
      'Mention a specific capability or update (grounded in the corpus).',
      'End with a clear call to action.',
      'No hashtags.',
    ],
  },
};

export interface SocialResult {
  draftId: string;
  channel: SocialChannel;
  channelLabel: string;
  text: string;
  charCount: number;
  wordCount: number;
  guardianScore: number;
  guardianNotes: string;
  flaggedCount: number;
  sources: string[];
  usage: DraftUsage;
}

export async function generateSocial(opts: {
  db: NeonDatabase<Record<string, unknown>>;
  tenantId: string;
  topic: string;
  channel: string;
  campaignId?: string | null;
  voiceModifier?: string;
}): Promise<SocialResult> {
  const { db, tenantId, topic, campaignId, voiceModifier } = opts;

  const channel = opts.channel.toLowerCase() as SocialChannel;
  if (!SOCIAL_CHANNELS.includes(channel)) {
    throw new Error(`Unknown channel '${opts.channel}'. Expected one of: ${SOCIAL_CHANNELS.join(', ')}`);
  }
  const spec = CHANNEL_SPECS[channel];

  const ctx = await loadGenContext({ db, tenantId, topic, campaignId, voiceModifier });

  const staticPrefix = [
    `You write ${spec.label} social posts for ${ctx.tenantName}.`,
    '',
    brandVoicePreamble(ctx.tenantName, ctx.brandVoice, ctx.voiceModifier),
    '',
    `${spec.label} channel rules (follow every one):`,
    ...spec.rules.map((r) => `- ${r}`),
    '',
    'Output ONLY the finished post text. No preamble, no explanation, no surrounding quotes, no markdown code fences.',
  ].join('\n');

  const system = [
    { type: 'text' as const, text: staticPrefix, cache_control: { type: 'ephemeral' as const } },
    { type: 'text' as const, text: buildCorpusBlock(ctx.chunks) },
  ];
  const goldenBlock = buildGoldenBlock(ctx.golden);
  if (goldenBlock) system.push({ type: 'text' as const, text: goldenBlock });

  const response = await anthropic().messages.create({
    model: MODELS.SONNET,
    max_tokens: spec.maxTokens,
    system,
    messages: [{ role: 'user', content: `Topic: ${topic}\n\nWrite the ${spec.label} post now.` }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') throw new Error('Claude returned no text content');
  const text = cleanProse(textBlock.text);

  const usage = usageOf(response.usage);
  const breakdown = await runAllGuardians({
    db,
    tenantId,
    channel,
    draftText: text,
    draftPayload: { kind: 'social', channel, topic, text },
    campaignId: ctx.campaignId,
  });
  const summary = summarizeGuardianBreakdown(breakdown);

  const payload = {
    kind: 'social',
    channel,
    topic,
    text,
    guardianScore: summary.guardianScore,
    guardianNotes: summary.guardianNotes,
    sources: ctx.chunks.map((c) => c.source_filename),
    usage,
  };

  const draftId = await insertDraft({
    db,
    tenantId,
    siteId: ctx.siteId,
    campaignId: ctx.campaignId,
    channel,
    payload,
    costCents: estimateTextCostCents(usage),
    guardianBreakdown: breakdown,
  });

  return {
    draftId,
    channel,
    channelLabel: spec.label,
    text,
    charCount: text.length,
    wordCount: text.split(/\s+/).filter(Boolean).length,
    guardianScore: summary.guardianScore,
    guardianNotes: summary.guardianNotes,
    flaggedCount: summary.flagCount,
    sources: ctx.chunks.map((c) => c.source_filename),
    usage,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Backward-compat: the V0 batch runner (scripts/v0-pipeline.ts) generates a
// LinkedIn/X/hook bundle per topic and writes them to files (no DB row). Kept
// as a thin wrapper over the shared RAG context so the V0 deliverable script
// still runs unchanged.
// ─────────────────────────────────────────────────────────────────────

export interface SocialPack {
  linkedin: string;
  x: string;
  hook: string;
  sources: string[];
  usage: DraftUsage;
}

export async function generateSocialPack(opts: {
  db: NeonDatabase<Record<string, unknown>>;
  tenantId: string;
  tenantName?: string;
  topic: string;
}): Promise<SocialPack> {
  const { db, tenantId, topic } = opts;
  const ctx = await loadGenContext({ db, tenantId, topic, topK: 6 });

  const staticPrefix = [
    `You write social-media copy for ${ctx.tenantName}.`,
    '',
    brandVoicePreamble(ctx.tenantName, ctx.brandVoice),
    '',
    'Output STRICT JSON only. No prose before or after. Schema below.',
  ].join('\n');

  const userPrompt = [
    `Topic: ${topic}`,
    '',
    'Produce three variants:',
    '1. LINKEDIN — 200-300 words, thought-leadership angle, professional but not stiff. Open with a sharp observation or specific data point. End with a single question to drive comments. 1-3 hashtags at the very end.',
    '2. X — under 280 characters total INCLUDING hashtags. Punchy hook. Max 2 relevant hashtags. One self-contained post.',
    '3. HOOK — first-line scroll-stopper under 100 characters, reusable as an IG/TikTok caption opener or email subject.',
    '',
    'Output format (strict JSON, no fences):',
    '{ "linkedin": "<...>", "x": "<...>", "hook": "<...>" }',
  ].join('\n');

  const system = [
    { type: 'text' as const, text: staticPrefix, cache_control: { type: 'ephemeral' as const } },
    { type: 'text' as const, text: buildCorpusBlock(ctx.chunks) },
  ];

  const response = await anthropic().messages.create({
    model: MODELS.SONNET,
    max_tokens: 2048,
    system,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') throw new Error('Claude returned no text content');

  let parsed: { linkedin?: string; x?: string; hook?: string };
  try {
    parsed = JSON.parse(extractJson(textBlock.text));
  } catch (err) {
    throw new Error(`Failed to parse social JSON: ${(err as Error).message}\nRaw:\n${textBlock.text.slice(0, 500)}`);
  }

  return {
    linkedin: String(parsed.linkedin ?? '').trim(),
    x: String(parsed.x ?? '').trim(),
    hook: String(parsed.hook ?? '').trim(),
    sources: ctx.chunks.map((c) => c.source_filename),
    usage: usageOf(response.usage),
  };
}
