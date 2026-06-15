// Guardian context resolver (Session 12).
//
// Runs ONCE per draft and returns a unified context object all five guardians
// share, so we resolve campaign/site_config/corpus/golden state a single time
// instead of five times. Every guardian then reads availability flags off this
// object to decide skip-vs-run.
//
// GROUND-TRUTH NOTES (these differ from the original Session 12 sketch):
//   - brand_voice keys are { audience, tone, preferredTerms, ... } — there is NO
//     `target_audience` key. We read brand_voice.audience.
//   - persona context is a corpus document_type='persona', NOT a brand_voice
//     field — we presence-check the corpus for it.
//   - golden examples carrying a per-channel performance score live on
//     content_drafts (is_golden_example=true), NOT on document_chunks (which has
//     no channel/performance_score column).
//   - The app connects with BYPASSRLS, so every query keeps an explicit
//     tenant_id predicate — RLS alone will not isolate tenants.
//   - This resolver NEVER throws on missing context (unlike loadGenContext); a
//     tenant with an empty corpus degrades to skip reports, it does not crash.

import { sql } from 'drizzle-orm';
import type { NeonDatabase } from 'drizzle-orm/neon-serverless';
import { withTenantDb } from '../../lib/tenant.js';
import type { MissingContextItem } from './types.js';

export interface GoldenExample {
  text: string;
  score: number;
  channel: string;
}

export interface GuardianContext {
  // Always available — passed in by the caller.
  db: NeonDatabase<Record<string, unknown>>;
  tenantId: string;
  channel: string;
  draftText: string;
  draftPayload: Record<string, unknown>;

  // Resolved from the campaign (if one is attached).
  campaignType?: string;
  audienceBrief?: string;
  voiceModifier?: string;
  goalType?: string;

  // Resolved from the corpus (documents + document_chunks).
  brandVoiceChunks: string[]; // document_type='brand_guideline'
  personaChunks: string[]; // document_type='persona'
  goldenExamples: GoldenExample[]; // content_drafts is_golden_example=true, this channel

  // Resolved from site_config.
  brandVoiceConfig?: Record<string, unknown>; // site_config.brand_voice
  targetAudience?: string; // brand_voice.audience (NOT target_audience)
  fromEmail?: string;

  // Computed availability flags — guardians use these to decide skip/run.
  hasPersonaContext: boolean;
  hasBrandVoiceContext: boolean;
  hasCorpus: boolean;
  goldenExampleCount: number;

  // Setup prompts surfaced when context is missing.
  missingContext: MissingContextItem[];
}

interface CampaignRow extends Record<string, unknown> {
  type: string | null;
  audience_brief: unknown;
  voice_modifier: string | null;
  goal_type: string | null;
}
interface SiteConfigRow extends Record<string, unknown> {
  general: Record<string, unknown> | null;
  brand_voice: Record<string, unknown> | null;
}
interface ChunkTextRow extends Record<string, unknown> {
  chunk_text: string;
}
interface GoldenRow extends Record<string, unknown> {
  channel: string;
  payload: Record<string, unknown> | null;
  performance_score: string | number | null;
}

/** Coerce a campaign.audience_brief (jsonb — string OR object) to a prompt-ready
 *  string, or undefined when empty. */
function briefToText(v: unknown): string | undefined {
  if (typeof v === 'string') return v.trim() || undefined;
  if (v && typeof v === 'object') {
    const keys = Object.keys(v as Record<string, unknown>);
    if (keys.length === 0) return undefined;
    return JSON.stringify(v);
  }
  return undefined;
}

/** Pull the most representative text out of a stored draft payload, across all
 *  channel shapes (social text, email subject+body, drip sequence). Used both
 *  for golden examples and for the recheck/publish paths. */
export function guardianDraftText(payload: Record<string, unknown>): string {
  const parts: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === 'string' && v.trim()) parts.push(v.trim());
  };
  push(payload.title);
  push(payload.subject);
  push(payload.previewText);
  push(payload.excerpt);
  push(payload.text);
  push(payload.body);
  push(payload.plain_text);
  // Drip sequences store an array of emails rather than a flat body.
  const seq = payload.sequence;
  if (Array.isArray(seq)) {
    for (const e of seq) {
      if (e && typeof e === 'object') {
        const em = e as Record<string, unknown>;
        push(em.subject);
        push(em.plainText);
      }
    }
  }
  return parts.join('\n\n').trim();
}

export async function resolveGuardianContext(opts: {
  db: NeonDatabase<Record<string, unknown>>;
  tenantId: string;
  channel: string;
  draftText: string;
  draftPayload?: Record<string, unknown>;
  campaignId?: string | null;
}): Promise<GuardianContext> {
  const { db, tenantId, channel, draftText, draftPayload = {}, campaignId } = opts;

  const resolved = await withTenantDb(db, tenantId, async (tx) => {
    let campaign: CampaignRow | null = null;
    if (campaignId) {
      const r = await tx.execute<CampaignRow>(sql`
        SELECT type, audience_brief, voice_modifier, goal_type
        FROM marketing.campaigns
        WHERE id = ${campaignId} AND tenant_id = ${tenantId}
        LIMIT 1
      `);
      campaign = r.rows[0] ?? null;
    }

    // site_config is keyed by site_id but carries tenant_id; V0 is one site per
    // tenant, so resolve by tenant_id (and keep the predicate for isolation).
    const cfgR = await tx.execute<SiteConfigRow>(sql`
      SELECT general, brand_voice
      FROM marketing.site_config
      WHERE tenant_id = ${tenantId}
      LIMIT 1
    `);
    const cfg = cfgR.rows[0] ?? null;

    const bvR = await tx.execute<ChunkTextRow>(sql`
      SELECT dc.chunk_text
      FROM marketing.document_chunks dc
      JOIN marketing.documents d ON dc.document_id = d.id
      WHERE dc.tenant_id = ${tenantId} AND dc.superseded = false
        AND d.document_type = 'brand_guideline'
      ORDER BY dc.chunk_index
      LIMIT 5
    `);

    const personaR = await tx.execute<ChunkTextRow>(sql`
      SELECT dc.chunk_text
      FROM marketing.document_chunks dc
      JOIN marketing.documents d ON dc.document_id = d.id
      WHERE dc.tenant_id = ${tenantId} AND dc.superseded = false
        AND d.document_type = 'persona'
      ORDER BY dc.chunk_index
      LIMIT 5
    `);

    const corpusR = await tx.execute<{ ok: number }>(sql`
      SELECT 1 AS ok FROM marketing.document_chunks
      WHERE tenant_id = ${tenantId} AND superseded = false
      LIMIT 1
    `);

    // Golden examples with a real per-channel performance score live on
    // content_drafts (NOT document_chunks). These feed the performance guardian.
    const goldenR = await tx.execute<GoldenRow>(sql`
      SELECT channel, payload, performance_score
      FROM marketing.content_drafts
      WHERE tenant_id = ${tenantId}
        AND is_golden_example = true
        AND channel = ${channel}
      ORDER BY performance_score DESC NULLS LAST
      LIMIT 10
    `);

    return {
      campaign,
      cfg,
      brandVoiceRows: bvR.rows,
      personaRows: personaR.rows,
      hasCorpus: corpusR.rows.length > 0,
      goldenRows: goldenR.rows,
    };
  });

  const brandVoiceChunks = resolved.brandVoiceRows.map((r) => r.chunk_text).filter(Boolean);
  const personaChunks = resolved.personaRows.map((r) => r.chunk_text).filter(Boolean);

  const brandVoiceConfig =
    resolved.cfg?.brand_voice && typeof resolved.cfg.brand_voice === 'object'
      ? resolved.cfg.brand_voice
      : undefined;
  const general =
    resolved.cfg?.general && typeof resolved.cfg.general === 'object'
      ? resolved.cfg.general
      : {};

  const targetAudience =
    brandVoiceConfig && typeof brandVoiceConfig.audience === 'string' && brandVoiceConfig.audience.trim()
      ? brandVoiceConfig.audience.trim()
      : undefined;

  const fromEmail =
    typeof general.fromEmail === 'string' && general.fromEmail
      ? general.fromEmail
      : typeof general.email === 'string' && general.email
        ? general.email
        : undefined;

  const audienceBrief = briefToText(resolved.campaign?.audience_brief);

  const goldenExamples: GoldenExample[] = resolved.goldenRows
    .map((r) => {
      const text = guardianDraftText((r.payload ?? {}) as Record<string, unknown>);
      const score = r.performance_score == null ? 1.0 : Number(r.performance_score);
      return { text, score: Number.isFinite(score) ? score : 1.0, channel: r.channel ?? channel };
    })
    .filter((g) => g.text.length > 0);

  const hasBrandVoiceContext =
    (!!brandVoiceConfig && Object.keys(brandVoiceConfig).length > 0) || brandVoiceChunks.length > 0;

  // Persona context = an explicit persona corpus, OR a campaign audience brief,
  // OR a configured brand-voice audience. Any one is enough to fairly judge fit.
  const hasPersonaContext = !!audienceBrief || personaChunks.length > 0 || !!targetAudience;

  const missingContext: MissingContextItem[] = [];
  if (!hasPersonaContext) {
    missingContext.push({
      guardian: 'audience_fit',
      message: 'Audience scoring unavailable — no target personas defined',
      action: 'Upload persona documents or set an audience in Brand Voice settings',
      actionUrl: '/settings?tab=corpus',
    });
  }
  if (!hasBrandVoiceContext) {
    missingContext.push({
      guardian: 'brand_voice',
      message: 'Brand voice scoring unavailable — no brand voice configured',
      action: 'Configure brand voice in Settings → Brand Voice',
      actionUrl: '/settings?tab=brand',
    });
  }
  if (goldenExamples.length < 5) {
    missingContext.push({
      guardian: 'performance_prediction',
      message: `Performance prediction unavailable — only ${goldenExamples.length} example${goldenExamples.length === 1 ? '' : 's'} for ${channel}`,
      action: 'Publish more content on this channel to enable performance predictions',
      actionUrl: '/settings?tab=history',
    });
  }

  return {
    db,
    tenantId,
    channel,
    draftText,
    draftPayload,
    campaignType: resolved.campaign?.type ?? undefined,
    audienceBrief,
    voiceModifier: resolved.campaign?.voice_modifier ?? undefined,
    goalType: resolved.campaign?.goal_type ?? undefined,
    brandVoiceChunks,
    personaChunks,
    goldenExamples,
    brandVoiceConfig,
    targetAudience,
    fromEmail,
    hasPersonaContext,
    hasBrandVoiceContext,
    hasCorpus: resolved.hasCorpus,
    goldenExampleCount: goldenExamples.length,
    missingContext,
  };
}
