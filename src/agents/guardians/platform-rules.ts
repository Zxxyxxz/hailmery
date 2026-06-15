// Platform Rules guardian (Session 12) — the ONLY blocking guardian, and the
// only one with zero LLM calls. Pure deterministic per-channel rules: fast,
// free, always accurate. A `severity:'blocking'` flag stops the publish; a
// 'warning' is advisory only.
//
// Each rule is an `evaluate(text, payload) => flag | null` so the rule owns its
// own actual/limit/message — this sidesteps the `(n:number)=>string` vs
// `(b:boolean)=>string` union-call type error that a shared message() signature
// would hit under strict TS.

import type { GuardianContext } from './context.js';
import type { PlatformRuleFlag, PlatformRulesResult } from './types.js';

interface ChannelRule {
  rule: string;
  severity: 'blocking' | 'warning';
  evaluate(text: string, payload: Record<string, unknown>): PlatformRuleFlag | null;
}

const hashtagCount = (text: string): number => (text.match(/#\w+/g) ?? []).length;

/** Scan every body field an email payload might carry for an unsubscribe
 *  affordance, including each email of a drip `sequence`. */
const emailHasUnsubscribe = (text: string, payload: Record<string, unknown>): boolean => {
  const fields: unknown[] = [text, payload.html_body, payload.html, payload.body, payload.plain_text, payload.text];
  const seq = payload.sequence;
  if (Array.isArray(seq)) {
    for (const e of seq) {
      if (e && typeof e === 'object') {
        const em = e as Record<string, unknown>;
        fields.push(em.htmlBody, em.plainText);
      }
    }
  }
  const haystack = fields.filter((f): f is string => typeof f === 'string').join('\n');
  return /unsubscribe|opt[\s-]?out|manage.*preferences/i.test(haystack);
};

const CHANNEL_RULES: Record<string, ChannelRule[]> = {
  linkedin: [
    {
      rule: 'char_limit',
      severity: 'blocking',
      evaluate: (text) =>
        text.length > 3000
          ? {
              rule: 'char_limit',
              severity: 'blocking',
              message: `Post is ${text.length} characters — LinkedIn limit is 3,000. Shorten before publishing.`,
              actual: text.length,
              limit: 3000,
            }
          : null,
    },
    {
      rule: 'hashtag_limit',
      severity: 'warning',
      evaluate: (text) => {
        const n = hashtagCount(text);
        return n > 5
          ? {
              rule: 'hashtag_limit',
              severity: 'warning',
              message: `${n} hashtags — LinkedIn recommends ≤5 for best reach.`,
              actual: n,
              limit: 5,
            }
          : null;
      },
    },
    {
      rule: 'ends_with_cta',
      severity: 'warning',
      evaluate: (text) => {
        const t = text.trim();
        const hasCta = t.endsWith('?') || /\b(comment|share|thoughts|agree|disagree)\b/i.test(t.slice(-200));
        return hasCta
          ? null
          : {
              rule: 'ends_with_cta',
              severity: 'warning',
              message: 'No clear CTA or question at the end — LinkedIn posts that ask a question get more engagement.',
            };
      },
    },
  ],
  x: [
    {
      rule: 'char_limit',
      severity: 'blocking',
      evaluate: (text) =>
        text.length > 280
          ? {
              rule: 'char_limit',
              severity: 'blocking',
              message: `Post is ${text.length} characters — X limit is 280. Shorten before publishing.`,
              actual: text.length,
              limit: 280,
            }
          : null,
    },
    {
      rule: 'hashtag_limit',
      severity: 'warning',
      evaluate: (text) => {
        const n = hashtagCount(text);
        return n > 2
          ? {
              rule: 'hashtag_limit',
              severity: 'warning',
              message: `${n} hashtags — X performs better with ≤2 hashtags.`,
              actual: n,
              limit: 2,
            }
          : null;
      },
    },
  ],
  instagram: [
    {
      rule: 'char_limit',
      severity: 'warning',
      evaluate: (text) =>
        text.length > 2200
          ? {
              rule: 'char_limit',
              severity: 'warning',
              message: `Caption is ${text.length} characters — Instagram caps captions at 2,200 and hides everything after ~125.`,
              actual: text.length,
              limit: 2200,
            }
          : null,
    },
  ],
  tiktok: [
    {
      rule: 'has_script_sections',
      severity: 'warning',
      evaluate: (text) => {
        const ok = /HOOK/i.test(text) && /SCRIPT/i.test(text) && /CTA/i.test(text);
        return ok
          ? null
          : {
              rule: 'has_script_sections',
              severity: 'warning',
              message: 'Missing one of the HOOK / SCRIPT / CTA sections a TikTok script needs.',
            };
      },
    },
  ],
  gbp: [
    {
      rule: 'char_limit',
      severity: 'warning',
      evaluate: (text) =>
        text.length > 1500
          ? {
              rule: 'char_limit',
              severity: 'warning',
              message: `Post is ${text.length} characters — Google Business Profile posts are capped at 1,500.`,
              actual: text.length,
              limit: 1500,
            }
          : null,
    },
  ],
  email: [
    {
      rule: 'has_subject',
      severity: 'blocking',
      evaluate: (_text, payload) =>
        typeof payload.subject === 'string' && payload.subject.trim()
          ? null
          : {
              rule: 'has_subject',
              severity: 'blocking',
              message: 'Email has no subject line — required for sending.',
            },
    },
    {
      rule: 'subject_length',
      severity: 'warning',
      evaluate: (_text, payload) => {
        const subject = typeof payload.subject === 'string' ? payload.subject : '';
        return subject.length > 60
          ? {
              rule: 'subject_length',
              severity: 'warning',
              message: `Subject line is ${subject.length} characters — mobile previews cut off after ~60.`,
              actual: subject.length,
              limit: 60,
            }
          : null;
      },
    },
    {
      rule: 'has_unsubscribe',
      severity: 'blocking',
      evaluate: (text, payload) =>
        emailHasUnsubscribe(text, payload)
          ? null
          : {
              rule: 'has_unsubscribe',
              severity: 'blocking',
              message: 'Email must include an unsubscribe link — required by CAN-SPAM and GDPR.',
            },
    },
  ],
};

export function runPlatformRulesGuardian(ctx: GuardianContext): PlatformRulesResult {
  const rules = CHANNEL_RULES[ctx.channel] ?? [];
  const flags: PlatformRuleFlag[] = [];

  for (const rule of rules) {
    const flag = rule.evaluate(ctx.draftText, ctx.draftPayload);
    if (flag) flags.push(flag);
  }

  const blocking = flags.some((f) => f.severity === 'blocking');

  return {
    guardian: 'platform_rules',
    score: blocking ? 0 : 1,
    passed: !blocking,
    blocking,
    flags,
    skipped: false,
  };
}
