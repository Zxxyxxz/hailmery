// Email generator — newsletter / drip / outreach.
//
// Same RAG + cached Sonnet 4.6 + Brand Guardian spine as the other generators.
// Output is delimiter-framed (NOT JSON) because the bodies are multi-line HTML
// and plain text — JSON string escaping of newline-heavy HTML is the #1 way
// these parses fail in practice. Markers like @@HTML@@ never collide with email
// markup, so a simple positional split is more robust here than JSON.parse.
//
// newsletter / drip are inserted into content_drafts (status pending_review).
// outreach is a 1:1 cold email — it is generated and guardian-checked but NOT
// queued (it is not reviewable marketing content), so its draftId is null.

import type { NeonDatabase } from 'drizzle-orm/neon-serverless';
import { anthropic, MODELS } from '../lib/ai.js';
import { brandGuardian } from '../agents/guardian.js';
import {
  loadGenContext,
  brandVoicePreamble,
  buildCorpusBlock,
  buildGoldenBlock,
  usageOf,
  estimateTextCostCents,
  insertDraft,
  type DraftUsage,
} from './context.js';

export const EMAIL_TYPES = ['newsletter', 'drip', 'outreach'] as const;
export type EmailType = (typeof EMAIL_TYPES)[number];

const DRIP_DAY_OFFSETS = [0, 3, 7, 14, 21];

const HTML_RULES = [
  'Single-column, mobile-first email HTML, max-width 600px.',
  'Inline CSS ONLY — email clients strip <style> blocks and external stylesheets.',
  'Structure: header with a logo placeholder; hero section (headline + 2-sentence intro); 3-4 short content sections each with a subheading (no walls of text); one primary CTA button; footer with an unsubscribe link placeholder and a physical-address placeholder.',
  'Use the brand colours from the corpus where relevant; keep it clean and high-contrast.',
];

export interface NewsletterContent {
  subjectLine: string;
  previewText: string;
  htmlBody: string;
  plainText: string;
}

export interface DripEmail {
  dayOffset: number;
  subject: string;
  previewText: string;
  htmlBody: string;
  plainText: string;
}

export interface OutreachContent {
  subject: string;
  openingLine: string;
  body: string;
}

export interface EmailResult {
  draftId: string | null;
  emailType: EmailType;
  subjectLine: string;
  guardianScore: number;
  guardianNotes: string;
  flaggedCount: number;
  sources: string[];
  usage: DraftUsage;
  newsletter?: NewsletterContent;
  sequence?: DripEmail[];
  outreach?: OutreachContent;
}

export async function generateEmail(opts: {
  db: NeonDatabase<Record<string, unknown>>;
  tenantId: string;
  emailType: string;
  topic: string;
  campaignId?: string | null;
  audienceBrief?: string;
  voiceModifier?: string;
}): Promise<EmailResult> {
  const { db, tenantId, topic, campaignId, audienceBrief, voiceModifier } = opts;

  // ── V2 BUG (flagged 2026-06-09 — do not lose) ──────────────────────────────
  // The email draft payloads built below ({ subject, html, body, previewText, … })
  // do NOT match the shape SendGridAdapter.publish() consumes. SendGridMailPayload
  // is { subject, html_body, from_email, from_name, to_list, utm_* }. Concretely:
  // this writes `html` but the adapter reads `html_body`, and it never sets
  // `from_email`, `from_name`, or `to_list`. So the email PUBLISH path cannot send
  // these drafts as-is — publish() throws on `payload.to_list.map`. (The SendGrid
  // webhook → content_metrics ingestion is unaffected; only outbound publish is.)
  // V2: align the generated payload with SendGridMailPayload and source the
  // recipient list + a verified sender so email sends end-to-end through the pipeline.
  const emailType = opts.emailType.toLowerCase() as EmailType;
  if (!EMAIL_TYPES.includes(emailType)) {
    throw new Error(`Unknown emailType '${opts.emailType}'. Expected one of: ${EMAIL_TYPES.join(', ')}`);
  }

  const ctx = await loadGenContext({ db, tenantId, topic, campaignId, voiceModifier });

  const preamble = brandVoicePreamble(ctx.tenantName, ctx.brandVoice, ctx.voiceModifier);
  const system = (instructions: string) => {
    const arr = [
      { type: 'text' as const, text: `You write marketing email for ${ctx.tenantName}.\n\n${preamble}\n\n${instructions}`, cache_control: { type: 'ephemeral' as const } },
      { type: 'text' as const, text: buildCorpusBlock(ctx.chunks) },
    ];
    const golden = buildGoldenBlock(ctx.golden);
    if (golden) arr.push({ type: 'text' as const, text: golden });
    return arr;
  };

  if (emailType === 'newsletter') {
    const instructions = [
      'You write a single newsletter email. Produce four parts, framed EXACTLY with these markers and nothing else:',
      '',
      '@@SUBJECT@@',
      '<subject line — under 50 characters, curiosity- or benefit-driven, no spam-trigger words like FREE, !!!, $$$>',
      '@@PREVIEW@@',
      '<preview/preheader text — under 90 characters, complements the subject without repeating it>',
      '@@HTML@@',
      `<the full HTML email>`,
      '@@PLAIN@@',
      '<a plain-text version of the same content>',
      '',
      'HTML requirements:',
      ...HTML_RULES.map((r) => `- ${r}`),
      '',
      'Emit the markers in that exact order. No text before @@SUBJECT@@ or after the plain-text body.',
    ].join('\n');

    const response = await anthropic().messages.create({
      model: MODELS.SONNET,
      max_tokens: 8192, // HTML + a full plain-text copy — 4096 truncates the plain section
      system: system(instructions),
      messages: [{ role: 'user', content: `Newsletter topic: ${topic}\n\nWrite it now.` }],
    });
    const raw = textOf(response);
    const usage = usageOf(response.usage);

    const newsletter: NewsletterContent = {
      subjectLine: section(raw, '@@SUBJECT@@'),
      previewText: section(raw, '@@PREVIEW@@'),
      htmlBody: section(raw, '@@HTML@@'),
      plainText: section(raw, '@@PLAIN@@'),
    };

    const guardian = await brandGuardian({
      db,
      tenantId,
      draftText: `${newsletter.subjectLine}\n${newsletter.previewText}\n\n${newsletter.plainText}`,
    });

    const payload = {
      kind: 'email',
      emailType,
      topic,
      subject: newsletter.subjectLine,
      previewText: newsletter.previewText,
      body: newsletter.plainText,
      html: newsletter.htmlBody,
      guardianScore: guardian.score,
      guardianNotes: guardian.notes,
      flagged: guardian.flagged,
      sources: ctx.chunks.map((c) => c.source_filename),
      usage,
    };
    const draftId = await insertDraft({
      db,
      tenantId,
      siteId: ctx.siteId,
      campaignId: ctx.campaignId,
      channel: 'email',
      payload,
      costCents: estimateTextCostCents(usage),
    });

    return {
      draftId,
      emailType,
      subjectLine: newsletter.subjectLine,
      guardianScore: guardian.score,
      guardianNotes: guardian.notes,
      flaggedCount: guardian.flagged.length,
      sources: ctx.chunks.map((c) => c.source_filename),
      usage,
      newsletter,
    };
  }

  if (emailType === 'drip') {
    // One Claude call per email. Generating all 5 in a single call is fragile:
    // each HTML email runs ~2-3k output tokens, so 5 + plain copies overflow any
    // reasonable max_tokens and the tail emails truncate. Per-email calls also
    // share the cached system prefix (brand voice + corpus), so calls 2-5 hit
    // the prompt cache for ~90% input savings.
    const ARC = [
      'Problem awareness. Make the problem feel real and specific to the reader. No pitch, no product.',
      'Deepen the problem with concrete data and statistics from the corpus. Still no pitch.',
      'Introduce the solution CATEGORY — the kind of control this problem demands — without naming or selling the product yet.',
      `Why ${ctx.tenantName}'s approach specifically. Now name it and differentiate it from the alternatives.`,
      'Social proof + a single clear call to action.',
    ];

    const sequence: DripEmail[] = [];
    const usageTotal: DraftUsage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

    for (let i = 0; i < ARC.length; i++) {
      const day = DRIP_DAY_OFFSETS[i];
      const priorSubjects = sequence.map((e) => e.subject).filter(Boolean);
      const instructions = [
        `You write ONE email in a 5-part drip sequence — this is email ${i + 1} of 5, scheduled for day ${day}.`,
        `Narrative role of THIS email: ${ARC[i]}`,
        priorSubjects.length
          ? `Earlier emails in this sequence used these subjects — do not repeat their angle: ${priorSubjects.join(' | ')}`
          : '',
        '',
        'Frame the output EXACTLY with these markers, in order, nothing else:',
        '@@SUBJECT@@ <subject line>',
        '@@PREVIEW@@ <preview text under 90 chars>',
        '@@HTML@@ <the full HTML email>',
        '@@PLAIN@@ <plain-text version>',
        '',
        'HTML requirements:',
        ...HTML_RULES.map((r) => `- ${r}`),
        '',
        'No commentary before @@SUBJECT@@ or after the plain-text body.',
      ]
        .filter(Boolean)
        .join('\n');

      const response = await anthropic().messages.create({
        model: MODELS.SONNET,
        // One email's HTML can run ~4k tokens on its own; give the plain-text
        // copy room so it is never truncated.
        max_tokens: 8192,
        system: system(instructions),
        messages: [{ role: 'user', content: `Drip sequence topic: ${topic}\n\nWrite email ${i + 1} (day ${day}) now.` }],
      });
      const raw = textOf(response);
      const u = usageOf(response.usage);
      usageTotal.input_tokens += u.input_tokens;
      usageTotal.output_tokens += u.output_tokens;
      usageTotal.cache_read_input_tokens = (usageTotal.cache_read_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
      usageTotal.cache_creation_input_tokens = (usageTotal.cache_creation_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);

      sequence.push({
        dayOffset: day,
        subject: section(raw, '@@SUBJECT@@'),
        previewText: section(raw, '@@PREVIEW@@'),
        htmlBody: section(raw, '@@HTML@@'),
        plainText: section(raw, '@@PLAIN@@'),
      });
    }

    const usage = usageTotal;

    if (sequence.length === 0) {
      throw new Error('Drip generation produced 0 emails.');
    }

    const guardian = await brandGuardian({
      db,
      tenantId,
      draftText: sequence.map((e) => `${e.subject}\n${e.plainText}`).join('\n\n'),
    });

    const payload = {
      kind: 'email',
      emailType,
      topic,
      subject: sequence[0].subject,
      sequence,
      guardianScore: guardian.score,
      guardianNotes: guardian.notes,
      flagged: guardian.flagged,
      sources: ctx.chunks.map((c) => c.source_filename),
      usage,
    };
    const draftId = await insertDraft({
      db,
      tenantId,
      siteId: ctx.siteId,
      campaignId: ctx.campaignId,
      channel: 'email',
      payload,
      costCents: estimateTextCostCents(usage),
    });

    return {
      draftId,
      emailType,
      subjectLine: sequence[0].subject,
      guardianScore: guardian.score,
      guardianNotes: guardian.notes,
      flaggedCount: guardian.flagged.length,
      sources: ctx.chunks.map((c) => c.source_filename),
      usage,
      sequence,
    };
  }

  // outreach — single cold email, not queued.
  const instructions = [
    'You write a single cold outreach email. Hard constraints:',
    '- subject: personalized, under 40 characters.',
    '- opening_line: ONE sentence referencing something specific about the recipient\'s company or role (use the audience brief below).',
    '- body: exactly 3 short paragraphs —',
    `  P1: why you are reaching out to THEM specifically.`,
    `  P2: what ${ctx.tenantName} does in one sentence + one concrete outcome.`,
    '  P3: a soft CTA phrased as a question, not a demand.',
    '- Under 150 words total.',
    '- Do NOT mention attachments. Do NOT open with "I hope this email finds you well" or "quick question".',
    '',
    audienceBrief ? `Audience brief: ${audienceBrief}` : 'Audience brief: (none provided — keep the opening line generic but still specific to the persona in the brand voice).',
    '',
    'Frame the output EXACTLY with these markers, in order, nothing else:',
    '@@SUBJECT@@ <subject>',
    '@@OPENING@@ <opening line>',
    '@@BODY@@ <the 3 paragraphs>',
  ].join('\n');

  const response = await anthropic().messages.create({
    model: MODELS.SONNET,
    max_tokens: 1024,
    system: system(instructions),
    messages: [{ role: 'user', content: `Outreach topic / angle: ${topic}\n\nWrite the cold email now.` }],
  });
  const raw = textOf(response);
  const usage = usageOf(response.usage);

  const outreach: OutreachContent = {
    subject: section(raw, '@@SUBJECT@@'),
    openingLine: section(raw, '@@OPENING@@'),
    body: section(raw, '@@BODY@@'),
  };

  const guardian = await brandGuardian({
    db,
    tenantId,
    draftText: `${outreach.subject}\n${outreach.openingLine}\n\n${outreach.body}`,
  });

  return {
    draftId: null,
    emailType,
    subjectLine: outreach.subject,
    guardianScore: guardian.score,
    guardianNotes: guardian.notes,
    flaggedCount: guardian.flagged.length,
    sources: ctx.chunks.map((c) => c.source_filename),
    usage,
    outreach,
  };
}

function textOf(response: { content: Array<{ type: string }> }): string {
  const block = response.content.find((b) => b.type === 'text') as { type: 'text'; text: string } | undefined;
  if (!block) throw new Error('Claude returned no text content');
  return block.text;
}

// Extract the text between `marker` and the next @@..@@ / @@@EMAIL@@@ marker
// (or end of block). Order-independent: we scan for the earliest later marker.
const ALL_MARKERS = ['@@SUBJECT@@', '@@PREVIEW@@', '@@HTML@@', '@@PLAIN@@', '@@DAY@@', '@@OPENING@@', '@@BODY@@', '@@@EMAIL@@@'];
function section(block: string, marker: string): string {
  const start = block.indexOf(marker);
  if (start === -1) return '';
  const from = start + marker.length;
  let end = block.length;
  for (const m of ALL_MARKERS) {
    if (m === marker) continue;
    const idx = block.indexOf(m, from);
    if (idx !== -1 && idx < end) end = idx;
  }
  return block.slice(from, end).trim();
}
