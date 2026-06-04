// GenerationWorkflow — runs the content-generation pipeline for ONE campaign.
//
// Triggered by: the 6-hourly cron tick (top up queues), campaign creation,
// the dashboard "Generate" button, and (later) leadorch events.
//
// Each pipeline stage is its own step.do() block. Cloudflare Workflows persist
// the (JSON-serialisable) return of every step and replay completed steps on
// retry — so steps pass plain data, never live handles. In particular
// AsyncLocalStorage does NOT survive a step boundary, so each step rebuilds its
// own db from env.DATABASE_URL and receives the tenant/campaign context it
// needs as explicit arguments.

import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { sql } from 'drizzle-orm';
import type { NeonDatabase } from 'drizzle-orm/neon-serverless';
import { makeDb } from '../db/client.js';
import { withTenantDb } from '../lib/tenant.js';
import { generateBlog } from '../generation/blog.js';
import { generateSocial, SOCIAL_CHANNELS } from '../generation/social.js';
import { generateEmail } from '../generation/email.js';
import { generateImage, type ImageType } from '../generation/image.js';
import { insertDraft, estimateTextCostCents } from '../generation/context.js';
import { brandGuardian } from '../agents/guardian.js';
import {
  mirrorEnvToProcess,
  type PipelineEnv,
  type GenerationParams,
} from './types.js';

type Db = NeonDatabase<Record<string, unknown>>;

const QUEUE_TARGET = 5; // desired live drafts per channel before a channel is "full"
const QUEUE_STATUSES = ['pending_review', 'approved', 'scheduled'] as const;

// A manual "Generate more" click is an explicit user request, so it always
// produces content — even when the queue is already at/over target. It forces a
// small fixed batch per channel rather than topping up to the target.
const FORCE_BATCH = 2;
// When a campaign has no channels configured (e.g. the seeded Default Evergreen),
// a manual trigger still needs somewhere to publish — default to LinkedIn.
const DEFAULT_MANUAL_CHANNELS = ['linkedin'];

// Campaign phase → voice-modifier addendum appended to the generation prompt.
const PHASE_MODIFIERS: Record<string, string> = {
  awareness:
    'PHASE: Awareness (T-6w+). Educate about the problem space only. Do NOT mention the product or that anything is launching.',
  teaser:
    'PHASE: Teaser (T-4w). Hint that something is coming. Build curiosity without revealing the product.',
  preview:
    'PHASE: Preview (T-3w). Begin revealing the product at a high level. Do not dump the full feature list yet.',
  feature_reveal:
    'PHASE: Feature reveal (T-2w). Reveal one specific capability in concrete, credible detail.',
  countdown:
    'PHASE: This is countdown week content. Urgency is appropriate. Build anticipation.',
  launch:
    'PHASE: Launch day. Lead with the announcement. This is the full reveal across all channels.',
  social_proof:
    'PHASE: Social proof (T+1w). Lead with testimonials, reactions, and concrete outcomes from real use.',
  standard: '',
};

export interface CampaignContext {
  tenantId: string;
  tenantName: string;
  campaignId: string;
  campaignName: string;
  campaignType: string;
  launchDate: string | null;
  siteId: string;
  voiceModifier: string | null;
  channels: string[];
  topicPool: string[];
}

export interface ChannelPlan {
  channel: string;
  current: number;
  toGenerate: number;
}

export interface CreatedDraft {
  channel: string;
  draftId: string;
  topic: string;
  guardianScore: number | null;
  imageSkipped: boolean | null;
}

// ── step 1 — loadCampaign ─────────────────────────────────────────────
// Resolve the campaign + site + tenant and the topic pool used to seed
// generation. Throws if the campaign does not belong to the tenant.
export async function loadCampaignContext(
  env: PipelineEnv,
  input: GenerationParams,
): Promise<CampaignContext> {
  const db = makeDb(env.DATABASE_URL);
  return withTenantDb(db, input.tenantId, async (tx) => {
    const camp = (
      await tx.execute<Record<string, any>>(sql`
        SELECT c.id, c.name, c.type, c.launch_date, c.site_id, c.voice_modifier,
               c.channel_config, c.pillar_id, t.name AS tenant_name
        FROM marketing.campaigns c
        JOIN marketing.tenants t ON t.id = c.tenant_id
        WHERE c.id = ${input.campaignId} AND c.tenant_id = ${input.tenantId}
        LIMIT 1
      `)
    ).rows[0];
    if (!camp) throw new Error(`Campaign ${input.campaignId} not found for tenant ${input.tenantId}`);

    const channelConfig = (camp.channel_config ?? {}) as Record<string, unknown>;
    let channels =
      input.channels && input.channels.length
        ? input.channels.map((c) => c.toLowerCase())
        : Object.keys(channelConfig).map((c) => c.toLowerCase());
    // A manual top-up against a campaign with no configured channels still needs
    // a target — fall back to a sensible default so the click always generates.
    if (channels.length === 0 && input.triggerReason === 'manual') {
      channels = [...DEFAULT_MANUAL_CHANNELS];
    }

    // Topic pool: pillar topics → site content_focus topics → audience-seeded
    // generics. RAG grounds each topic against the corpus regardless, so this
    // only needs to be a reasonable seed, not finished copy.
    const topicPool: string[] = [];
    if (camp.pillar_id) {
      const p = (
        await tx.execute<Record<string, any>>(sql`
          SELECT topics FROM marketing.pillars WHERE id = ${camp.pillar_id} LIMIT 1
        `)
      ).rows[0];
      if (Array.isArray(p?.topics)) topicPool.push(...p.topics.map(String));
    }
    const cfg = (
      await tx.execute<Record<string, any>>(sql`
        SELECT content_focus, brand_voice FROM marketing.site_config
        WHERE site_id = ${camp.site_id} LIMIT 1
      `)
    ).rows[0];
    const focus = (cfg?.content_focus ?? {}) as Record<string, any>;
    if (Array.isArray(focus.topics)) topicPool.push(...focus.topics.map(String));

    if (topicPool.length === 0) {
      const bv = (cfg?.brand_voice ?? {}) as Record<string, any>;
      const audience = typeof bv.audience === 'string' ? bv.audience : 'the target audience';
      topicPool.push(
        `Practical guidance for ${audience}`,
        `A common misconception ${audience} get wrong`,
        `What ${audience} should prioritise this quarter`,
        `A concrete best practice relevant to ${audience}`,
        `Lessons learned that matter to ${audience}`,
        `An emerging trend ${audience} should watch`,
      );
    }

    return {
      tenantId: input.tenantId,
      tenantName: String(camp.tenant_name ?? 'the brand'),
      campaignId: String(camp.id),
      campaignName: String(camp.name),
      campaignType: String(camp.type),
      launchDate: camp.launch_date ? new Date(camp.launch_date).toISOString() : null,
      siteId: String(camp.site_id),
      voiceModifier: camp.voice_modifier ?? null,
      channels,
      topicPool,
    } satisfies CampaignContext;
  });
}

// ── step 2 — checkQueueDepth ──────────────────────────────────────────
// For each channel, count live drafts (pending_review/approved/scheduled).
// Channels at/above the target are skipped; others get a deficit to generate.
export async function checkQueueDepth(
  env: PipelineEnv,
  ctx: CampaignContext,
  force = false,
): Promise<ChannelPlan[]> {
  const db = makeDb(env.DATABASE_URL);
  return withTenantDb(db, ctx.tenantId, async (tx) => {
    const plans: ChannelPlan[] = [];
    for (const channel of ctx.channels) {
      const r = await tx.execute<{ n: string }>(sql`
        SELECT count(*)::int AS n FROM marketing.content_drafts
        WHERE campaign_id = ${ctx.campaignId}
          AND channel = ${channel}
          AND status = ANY(ARRAY[${sql.join(
            QUEUE_STATUSES.map((s) => sql`${s}`),
            sql`, `,
          )}]::marketing.draft_status[])
      `);
      const current = Number(r.rows[0]?.n ?? 0);
      // Force mode (manual click): always generate a small batch. Otherwise top
      // up to the target and skip channels that are already full.
      const toGenerate = force ? FORCE_BATCH : current >= QUEUE_TARGET ? 0 : QUEUE_TARGET - current;
      plans.push({ channel, current, toGenerate });
    }
    return plans;
  });
}

// ── step 3 — determineCampaignPhase ───────────────────────────────────
// Pure: maps a product_launch campaign's launch date vs. now to a phase. All
// other campaign types are 'standard'.
export function determineCampaignPhase(ctx: CampaignContext, now: Date): string {
  if (ctx.campaignType !== 'product_launch' || !ctx.launchDate) return 'standard';
  const launch = new Date(ctx.launchDate).getTime();
  const daysUntil = (launch - now.getTime()) / 86_400_000;

  if (Math.abs(daysUntil) <= 1) return 'launch';
  if (daysUntil < 0) return daysUntil >= -8 ? 'social_proof' : 'standard';
  if (daysUntil <= 7) return 'countdown';
  if (daysUntil <= 14) return 'feature_reveal';
  if (daysUntil <= 21) return 'preview';
  if (daysUntil <= 28) return 'teaser';
  return 'awareness';
}

// ── step 4 — generateContent ──────────────────────────────────────────
export async function generateContent(
  env: PipelineEnv,
  ctx: CampaignContext,
  plans: ChannelPlan[],
  phase: string,
): Promise<CreatedDraft[]> {
  mirrorEnvToProcess(env);
  const db = makeDb(env.DATABASE_URL);

  const phaseModifier = PHASE_MODIFIERS[phase] ?? '';
  const voiceModifier = [ctx.voiceModifier, phaseModifier].filter(Boolean).join('\n\n') || undefined;

  const created: CreatedDraft[] = [];
  let topicCursor = 0;
  const nextTopic = () => ctx.topicPool[topicCursor++ % ctx.topicPool.length];

  for (const plan of plans) {
    if (plan.toGenerate <= 0) continue;
    const channel = plan.channel;

    for (let i = 0; i < plan.toGenerate; i++) {
      const topic = nextTopic();
      try {
        const result = await generateOne(db, env, ctx, channel, topic, voiceModifier);
        if (!result) continue; // unsupported channel — already logged
        const { draftId, guardianScore } = result;

        // After each non-image draft, generate the paired image — but only when
        // image generation is actually configured (Ideogram key present). This
        // avoids burning a prompt-building model call when it would just skip.
        let imageSkipped: boolean | null = null;
        if (env.IDEOGRAM_API_KEY) {
          imageSkipped = await maybeGenerateImage(db, env, ctx.tenantId, draftId, channel);
        }
        created.push({ channel, draftId, topic, guardianScore, imageSkipped });
      } catch (err) {
        console.error(
          `[generation] ${channel} draft failed (campaign ${ctx.campaignId}):`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }
  return created;
}

async function generateOne(
  db: Db,
  env: PipelineEnv,
  ctx: CampaignContext,
  channel: string,
  topic: string,
  voiceModifier: string | undefined,
): Promise<{ draftId: string; guardianScore: number | null } | null> {
  // Blog
  if (channel === 'blog' || channel === 'wix-blog') {
    const blog = await generateBlog({
      db,
      tenantId: ctx.tenantId,
      tenantName: ctx.tenantName,
      topic,
    });
    const guardian = await brandGuardian({ db, tenantId: ctx.tenantId, draftText: blog.body });
    const payload = {
      kind: 'blog',
      topic,
      title: blog.frontmatter.title,
      slug: blog.frontmatter.slug,
      excerpt: blog.frontmatter.excerpt,
      tags: blog.frontmatter.tags,
      body: blog.body,
      guardianScore: guardian.score,
      guardianNotes: guardian.notes,
      flagged: guardian.flagged,
      sources: blog.sources,
      usage: blog.usage,
    };
    const draftId = await insertDraft({
      db,
      tenantId: ctx.tenantId,
      siteId: ctx.siteId,
      campaignId: ctx.campaignId,
      channel: 'blog',
      payload,
      costCents: estimateTextCostCents(blog.usage),
    });
    return { draftId, guardianScore: guardian.score };
  }

  // Email — type derived from campaign type.
  if (channel === 'email') {
    const emailType = ctx.campaignType === 'lead_gen' ? 'drip' : 'newsletter';
    const res = await generateEmail({
      db,
      tenantId: ctx.tenantId,
      emailType,
      topic,
      campaignId: ctx.campaignId,
      voiceModifier,
    });
    if (!res.draftId) return null; // outreach is not queued
    return { draftId: res.draftId, guardianScore: res.guardianScore };
  }

  // Social
  if ((SOCIAL_CHANNELS as readonly string[]).includes(channel)) {
    const res = await generateSocial({
      db,
      tenantId: ctx.tenantId,
      topic,
      channel,
      campaignId: ctx.campaignId,
      voiceModifier,
    });
    return { draftId: res.draftId, guardianScore: res.guardianScore };
  }

  console.warn(`[generation] no generator for channel '${channel}' — skipping`);
  return null;
}

const IMAGE_TYPE_BY_CHANNEL: Record<string, ImageType> = {
  blog: 'blog_header',
  'wix-blog': 'blog_header',
  email: 'email_header',
};

async function maybeGenerateImage(
  db: Db,
  env: PipelineEnv,
  tenantId: string,
  draftId: string,
  channel: string,
): Promise<boolean | null> {
  const imageType = IMAGE_TYPE_BY_CHANNEL[channel] ?? 'social_square';
  try {
    const res = await generateImage({
      db,
      tenantId,
      draftId,
      imageType,
      r2: env.R2,
      publicBaseUrl: env.R2_PUBLIC_BASE_URL,
    });
    return res.skipped;
  } catch (err) {
    console.error('[generation] image generation failed (non-fatal):', err instanceof Error ? err.message : err);
    return null;
  }
}

// ── step 5 — notifyQueue ──────────────────────────────────────────────
// V1: log a line. V2: Slack/email to the operator that drafts are ready.
export async function notifyQueue(ctx: CampaignContext, created: CreatedDraft[]): Promise<void> {
  if (created.length === 0) {
    console.log(`[generation] campaign ${ctx.campaignName} (${ctx.campaignId}): nothing to generate — queues full`);
    return;
  }
  const byChannel = created.reduce<Record<string, number>>((acc, d) => {
    acc[d.channel] = (acc[d.channel] ?? 0) + 1;
    return acc;
  }, {});
  console.log(
    `[generation] campaign ${ctx.campaignName} (${ctx.campaignId}): ${created.length} new draft(s) ready for review —`,
    JSON.stringify(byChannel),
  );
}

/**
 * Run the full generation pipeline inline (no Workflow runtime). Used by the
 * /api/generate fallback path and by tests. The Workflow class below wraps the
 * same functions in step.do() blocks.
 */
export async function runGenerationPipeline(
  env: PipelineEnv,
  input: GenerationParams,
): Promise<{ created: CreatedDraft[]; phase: string }> {
  const ctx = await loadCampaignContext(env, input);
  const plans = await checkQueueDepth(env, ctx, input.triggerReason === 'manual');
  const phase = determineCampaignPhase(ctx, new Date());
  const created = await generateContent(env, ctx, plans, phase);
  await notifyQueue(ctx, created);
  return { created, phase };
}

export class GenerationWorkflow extends WorkflowEntrypoint<PipelineEnv, GenerationParams> {
  async run(event: WorkflowEvent<GenerationParams>, step: WorkflowStep): Promise<unknown> {
    const input = event.payload;
    mirrorEnvToProcess(this.env);
    const env = this.env;

    const ctx = await step.do('loadCampaign', () => loadCampaignContext(env, input));
    const plans = await step.do('checkQueueDepth', () =>
      checkQueueDepth(env, ctx, input.triggerReason === 'manual'),
    );

    // Pure step — wrapped so its result is journaled and the phase can't drift
    // between a replay and the original run.
    const phase = await step.do('determineCampaignPhase', async () =>
      determineCampaignPhase(ctx, new Date()),
    );

    const created = await step.do('generateContent', () => generateContent(env, ctx, plans, phase));
    await step.do('notifyQueue', async () => {
      await notifyQueue(ctx, created);
      return { count: created.length };
    });

    return { campaignId: ctx.campaignId, phase, created: created.length, trigger: input.triggerReason };
  }
}
