import {
  pgSchema,
  uuid,
  text,
  integer,
  bigint,
  numeric,
  timestamp,
  date,
  jsonb,
  boolean,
  customType,
  primaryKey,
  uniqueIndex,
  index,
  vector,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ──────────────────────────────────────────────────────────────────
// Schema
// ──────────────────────────────────────────────────────────────────
export const marketing = pgSchema('marketing');

// ──────────────────────────────────────────────────────────────────
// Enums
// ──────────────────────────────────────────────────────────────────
export const tenantPlan = marketing.enum('tenant_plan', [
  'free',
  'starter',
  'pro',
  'enterprise',
]);

export const campaignType = marketing.enum('campaign_type', [
  'product_launch',
  'lead_gen',
  'evergreen',
  'event',
  'reactive',
]);

export const campaignGoalType = marketing.enum('campaign_goal_type', [
  'demo_requests',
  'signups',
  'followers',
  'impressions',
  'custom',
]);

export const campaignStatus = marketing.enum('campaign_status', [
  'draft',
  'active',
  'paused',
  'completed',
]);

export const documentSource = marketing.enum('document_source', ['upload', 'git']);

export const documentType = marketing.enum('document_type', [
  'product_doc',
  'marketing',
  'brand_guideline',
  'company_info',
  'competitor',
  'persona',
  'golden_example',
  'sales_deck',
]);

export const draftStatus = marketing.enum('draft_status', [
  'generating',
  'pending_review',
  'approved',
  'scheduled',
  'published',
  'measured',
  'dismissed',
  'failed',
]);

export const metricsWindow = marketing.enum('metrics_window', ['1h', '24h', '7d', '30d']);

export const intelligenceBriefStatus = marketing.enum('intelligence_brief_status', [
  'pending',
  'reviewed',
  'used',
]);

export const recommendationType = marketing.enum('recommendation_type', [
  'content_gap',
  'channel_rebalance',
  'trending_opportunity',
  'queue_health',
  'engagement_followup',
  // Session 10 (GSC): striking-distance Search Console query → blog post.
  // Added to existing DBs via the ALTER TYPE step in src/db/migrate.ts.
  'seo_opportunity',
]);

export const recommendationActionType = marketing.enum('recommendation_action_type', [
  'generate',
  'approve',
  'review_queue',
]);

export const recommendationStatus = marketing.enum('recommendation_status', [
  'pending',
  'actioned',
  'dismissed',
]);

// ──────────────────────────────────────────────────────────────────
// Tables — every table starts with `tenant_id` and has RLS applied
// in src/db/rls.sql.
// ──────────────────────────────────────────────────────────────────

export const tenants = marketing.table('tenants', {
  // For tenants the `id` IS the tenant_id; we keep `tenant_id` as a
  // generated column equal to id so the RLS policy expression is
  // uniform across all tables (see rls.sql).
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .generatedAlwaysAs(sql`id`),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  plan: tenantPlan('plan').notNull().default('free'),
  monthlyBudgetCents: integer('monthly_budget_cents').notNull().default(5000),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  slugUq: uniqueIndex('tenants_slug_uq').on(t.slug),
}));

export const tenantSecrets = marketing.table('tenant_secrets', {
  tenantId: uuid('tenant_id').notNull(),
  platform: text('platform').notNull(),
  encryptedAccessToken: text('encrypted_access_token'),
  encryptedRefreshToken: text('encrypted_refresh_token'),
  // Encrypted JSON, channel -> provider profile/channel id (Buffer). Stored
  // alongside the access token so a tenant's publish targets resolve offline.
  encryptedProfileMap: text('encrypted_profile_map'),
  tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
  scopes: text('scopes').array(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.tenantId, t.platform] }),
}));

export const tenantUsage = marketing.table('tenant_usage', {
  tenantId: uuid('tenant_id').notNull(),
  month: date('month').notNull(),
  aiTokensInput: bigint('ai_tokens_input', { mode: 'number' }).notNull().default(0),
  aiTokensOutput: bigint('ai_tokens_output', { mode: 'number' }).notNull().default(0),
  aiCostCents: bigint('ai_cost_cents', { mode: 'number' }).notNull().default(0),
  imagesGenerated: integer('images_generated').notNull().default(0),
  videosGenerated: integer('videos_generated').notNull().default(0),
  emailsSent: integer('emails_sent').notNull().default(0),
  apiCalls: integer('api_calls').notNull().default(0),
}, (t) => ({
  pk: primaryKey({ columns: [t.tenantId, t.month] }),
}));

export const sites = marketing.table('sites', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  domain: text('domain').notNull(),
  wixSiteId: text('wix_site_id'),
  timezone: text('timezone').notNull().default('UTC'),
  parentConfigId: uuid('parent_config_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index('sites_tenant_idx').on(t.tenantId),
  domainUq: uniqueIndex('sites_tenant_domain_uq').on(t.tenantId, t.domain),
}));

export const siteConfig = marketing.table('site_config', {
  siteId: uuid('site_id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  general: jsonb('general').notNull().default({}),
  contentFocus: jsonb('content_focus').notNull().default({}),
  brandVoice: jsonb('brand_voice').notNull().default({}),
  planPreferences: jsonb('plan_preferences').notNull().default({}),
  schemaVersion: integer('schema_version').notNull().default(1),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index('site_config_tenant_idx').on(t.tenantId),
}));

export const pillars = marketing.table('pillars', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  siteId: uuid('site_id').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  topics: jsonb('topics').notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index('pillars_tenant_idx').on(t.tenantId),
}));

export const campaigns = marketing.table('campaigns', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  siteId: uuid('site_id').notNull(),
  name: text('name').notNull(),
  type: campaignType('type').notNull().default('evergreen'),
  launchDate: timestamp('launch_date', { withTimezone: true }),
  goalType: campaignGoalType('goal_type').notNull().default('custom'),
  goalValue: integer('goal_value'),
  audienceBrief: jsonb('audience_brief').notNull().default({}),
  languageConfig: jsonb('language_config').notNull().default({}),
  channelConfig: jsonb('channel_config').notNull().default({}),
  voiceModifier: text('voice_modifier'),
  pillarId: uuid('pillar_id'),
  status: campaignStatus('status').notNull().default('draft'),
  leadorchRunId: uuid('leadorch_run_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (t) => ({
  tenantIdx: index('campaigns_tenant_idx').on(t.tenantId),
  statusIdx: index('campaigns_status_idx').on(t.tenantId, t.status),
}));

export const documents = marketing.table('documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  source: documentSource('source').notNull(),
  sourceFilename: text('source_filename').notNull(),
  documentType: documentType('document_type').notNull().default('product_doc'),
  r2Key: text('r2_key').notNull(),
  mimeType: text('mime_type').notNull(),
  version: integer('version').notNull().default(1),
  // Number of (non-superseded) chunks the document produced on last ingest.
  // Nullable: null = not yet ingested / extraction pending or failed.
  chunkCount: integer('chunk_count'),
  // Tracks the ingestion pipeline outcome: 'pending' (row created, work queued),
  // 'ingested' (chunks embedded), or 'failed' (text extraction blew up).
  extractionStatus: text('extraction_status'),
  ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().defaultNow(),
  supersededAt: timestamp('superseded_at', { withTimezone: true }),
}, (t) => ({
  tenantIdx: index('documents_tenant_idx').on(t.tenantId),
  tenantFileUq: uniqueIndex('documents_tenant_filename_uq').on(t.tenantId, t.sourceFilename),
}));

export const documentChunks = marketing.table('document_chunks', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  documentId: uuid('document_id')
    .notNull()
    .references(() => documents.id, { onDelete: 'cascade' }),
  chunkIndex: integer('chunk_index').notNull(),
  chunkText: text('chunk_text').notNull(),
  embedding: vector('embedding', { dimensions: 1536 }).notNull(),
  sectionTitle: text('section_title'),
  superseded: boolean('superseded').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index('document_chunks_tenant_idx').on(t.tenantId),
  documentIdx: index('document_chunks_document_idx').on(t.documentId),
  // HNSW index for cosine distance on pgvector (created in rls.sql as raw SQL
  // because Drizzle's index DSL does not yet emit vector ops).
}));

export const contentDrafts = marketing.table('content_drafts', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  campaignId: uuid('campaign_id').references(() => campaigns.id),
  siteId: uuid('site_id').notNull(),
  pillar: text('pillar'),
  channel: text('channel').notNull(),
  status: draftStatus('status').notNull().default('generating'),
  payload: jsonb('payload').notNull().default({}),
  assets: jsonb('assets').notNull().default({}),
  scoreHuman: integer('score_human'),
  dismissReason: text('dismiss_reason'),
  failedReason: text('failed_reason'),
  publishAt: timestamp('publish_at', { withTimezone: true }),
  publishedRef: text('published_ref'),
  costCents: integer('cost_cents').notNull().default(0),
  // Set by the nightly metrics job (Chunk 7). raw engagement score divided by
  // the tenant's median score for that channel over the last 30 days — >1.0
  // means the draft outperformed baseline. Nullable until first scored.
  performanceScore: numeric('performance_score'),
  // True for the top decile of scored drafts (score > 1.0). Those drafts are
  // promoted into golden_example document_chunks so generation retrieves them.
  isGoldenExample: boolean('is_golden_example').notNull().default(false),
  // Multi-guardian breakdown (Session 12) — the full result of the 5 parallel
  // validators (platform_rules/factual/brand_voice/audience_fit/performance) with
  // per-dimension scores, flags, skip reasons, and the overall weighted score.
  // Nullable: drafts generated before the multi-guardian system carry null and
  // the dashboard falls back to payload.guardianScore. Added via rls.sql (NOT
  // db:push) — see the 1g block there.
  guardianBreakdown: jsonb('guardian_breakdown'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index('content_drafts_tenant_idx').on(t.tenantId),
  statusIdx: index('content_drafts_status_idx').on(t.tenantId, t.status),
}));

export const publishLog = marketing.table('publish_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  channel: text('channel').notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
  draftId: uuid('draft_id').notNull(),
}, (t) => ({
  tenantIdx: index('publish_log_tenant_idx').on(t.tenantId),
  cadenceIdx: index('publish_log_cadence_idx').on(t.tenantId, t.channel, t.publishedAt),
}));

export const contentMetrics = marketing.table('content_metrics', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  draftId: uuid('draft_id').notNull(),
  window: metricsWindow('window').notNull(),
  impressions: integer('impressions').notNull().default(0),
  clicks: integer('clicks').notNull().default(0),
  engagement: integer('engagement').notNull().default(0),
  attributedLeads: integer('attributed_leads').notNull().default(0),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index('content_metrics_tenant_idx').on(t.tenantId),
  draftIdx: index('content_metrics_draft_idx').on(t.draftId, t.window),
  // One row per draft per window — lets the metrics job upsert idempotently
  // (re-runs of the nightly pass refresh in place rather than duplicating).
  draftWindowUq: uniqueIndex('content_metrics_draft_window_uq').on(t.tenantId, t.draftId, t.window),
}));

export const syncLog = marketing.table('sync_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  direction: text('direction').notNull(),
  contactsSynced: integer('contacts_synced').notNull().default(0),
  eventsProcessed: integer('events_processed').notNull().default(0),
  errors: jsonb('errors').notNull().default([]),
  ranAt: timestamp('ran_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index('sync_log_tenant_idx').on(t.tenantId),
  directionIdx: index('sync_log_direction_idx').on(t.tenantId, t.direction, t.ranAt),
}));

export const assets = marketing.table('assets', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  r2Key: text('r2_key').notNull(),
  mime: text('mime').notNull(),
  generationParams: jsonb('generation_params').notNull().default({}),
  costCents: integer('cost_cents').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index('assets_tenant_idx').on(t.tenantId),
}));

// Delayed metrics-fetch work queue. After a draft is published the publish
// pipeline enqueues one row per fetch window (1h + 24h); the metrics job
// (Chunk 7) drains rows whose fetch_at <= now() and flips `fetched`. In V2
// this is backed by a Cloudflare Queue; the table is the durable record either
// way so a missed tick never drops a fetch.
export const metricsQueue = marketing.table('metrics_queue', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  draftId: uuid('draft_id').notNull().references(() => contentDrafts.id),
  fetchAt: timestamp('fetch_at', { withTimezone: true }).notNull(),
  window: metricsWindow('window').notNull(),
  fetched: boolean('fetched').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index('metrics_queue_tenant_idx').on(t.tenantId),
  dueIdx: index('metrics_queue_due_idx').on(t.fetchAt),
  draftIdx: index('metrics_queue_draft_idx').on(t.draftId),
}));

// GSC keyword performance — synced weekly by the nightly metrics job (Chunk 7)
// from Google Search Console for each site that has google credentials. One row
// per (query, page) per ISO week; `is_high_performer` flags queries whose
// impressions exceed 3× the tenant's average for that week — those surface in
// the analytics dashboard and feed reactive generation suggestions.
export const gscKeywords = marketing.table('gsc_keywords', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  siteId: uuid('site_id').notNull(),
  query: text('query').notNull(),
  pageUrl: text('page_url').notNull(),
  impressions: integer('impressions').notNull().default(0),
  clicks: integer('clicks').notNull().default(0),
  ctr: numeric('ctr').notNull().default('0'),
  position: numeric('position').notNull().default('0'),
  isHighPerformer: boolean('is_high_performer').notNull().default(false),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  weekOf: date('week_of').notNull(),
}, (t) => ({
  tenantIdx: index('gsc_keywords_tenant_idx').on(t.tenantId),
  impressionsIdx: index('gsc_keywords_impressions_idx').on(t.tenantId, t.impressions),
  rowUq: uniqueIndex('gsc_keywords_row_uq').on(t.tenantId, t.siteId, t.query, t.pageUrl, t.weekOf),
}));

// Weekly intelligence briefs — the Monday 08:00 UTC job (src/jobs/intelligence.ts)
// researches the past 7 days of AI-security news with Claude + web search and
// writes one row per tenant per week: a jsonb array of 5-7 suggested topics the
// dashboard surfaces as a "This week's topics" card. status tracks operator
// review (pending → reviewed → used).
export const intelligenceBriefs = marketing.table('intelligence_briefs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  weekOf: date('week_of').notNull(),
  topics: jsonb('topics').notNull().default([]),
  generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
  status: intelligenceBriefStatus('status').notNull().default('pending'),
}, (t) => ({
  tenantIdx: index('intelligence_briefs_tenant_idx').on(t.tenantId),
  weekUq: uniqueIndex('intelligence_briefs_tenant_week_uq').on(t.tenantId, t.weekOf),
}));

// Weekly recommendations — the nightly job (src/jobs/recommendations.ts) reasons
// over all real data sources (content_metrics, content_drafts, publish cadence,
// the latest intelligence brief, campaigns) with Sonnet 4.6 and writes up to 5
// ranked, data-backed actions per tenant per week. The dashboard surfaces them as
// the "This week's recommendations" panel and Baran actions each with one click.
// status tracks operator follow-through (pending → actioned | dismissed).
export const recommendations = marketing.table('recommendations', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  type: recommendationType('type').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  // The specific data point(s) behind the recommendation (1-2 sentences).
  reasoning: text('reasoning').notNull(),
  actionType: recommendationActionType('action_type').notNull(),
  // Everything needed to execute the action: { topic, channel, campaign_id, draft_ids[] }.
  actionParams: jsonb('action_params').notNull().default({}),
  // 1-10, higher = more urgent. The panel sorts + colour-codes by this.
  priorityScore: integer('priority_score').notNull().default(5),
  // The raw numbers that drove this recommendation (audit trail + UI "Why?").
  dataSnapshot: jsonb('data_snapshot').notNull().default({}),
  status: recommendationStatus('status').notNull().default('pending'),
  weekOf: date('week_of').notNull(), // Monday (UTC) of the recommendation week.
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index('recommendations_tenant_idx').on(t.tenantId),
  statusIdx: index('recommendations_status_idx').on(t.tenantId, t.status),
  weekIdx: index('recommendations_week_idx').on(t.tenantId, t.weekOf),
}));

// ──────────────────────────────────────────────────────────────────
// Type exports for downstream code
// ──────────────────────────────────────────────────────────────────
export type Tenant = typeof tenants.$inferSelect;
export type TenantSecret = typeof tenantSecrets.$inferSelect;
export type TenantUsage = typeof tenantUsage.$inferSelect;
export type Site = typeof sites.$inferSelect;
export type SiteConfig = typeof siteConfig.$inferSelect;
export type Campaign = typeof campaigns.$inferSelect;
export type Pillar = typeof pillars.$inferSelect;
export type Document = typeof documents.$inferSelect;
export type DocumentChunk = typeof documentChunks.$inferSelect;
export type ContentDraft = typeof contentDrafts.$inferSelect;
export type PublishLogEntry = typeof publishLog.$inferSelect;
export type ContentMetric = typeof contentMetrics.$inferSelect;
export type SyncLogEntry = typeof syncLog.$inferSelect;
export type Asset = typeof assets.$inferSelect;
export type MetricsQueueEntry = typeof metricsQueue.$inferSelect;
export type IntelligenceBrief = typeof intelligenceBriefs.$inferSelect;
export type GscKeyword = typeof gscKeywords.$inferSelect;
export type Recommendation = typeof recommendations.$inferSelect;
