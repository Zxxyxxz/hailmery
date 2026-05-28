import {
  pgSchema,
  uuid,
  text,
  integer,
  bigint,
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
  ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().defaultNow(),
  supersededAt: timestamp('superseded_at', { withTimezone: true }),
}, (t) => ({
  tenantIdx: index('documents_tenant_idx').on(t.tenantId),
  tenantFileUq: uniqueIndex('documents_tenant_filename_uq').on(t.tenantId, t.sourceFilename),
}));

export const documentChunks = marketing.table('document_chunks', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  documentId: uuid('document_id').notNull(),
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
  publishAt: timestamp('publish_at', { withTimezone: true }),
  publishedRef: text('published_ref'),
  costCents: integer('cost_cents').notNull().default(0),
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
