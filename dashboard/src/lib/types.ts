// Shared API types — mirror the shapes returned by src/routes/api.ts on the
// Hono Worker. The backend normalizes content_drafts (joining campaign name and
// surfacing the guardian score) into the `Draft` shape below.

export type DraftStatus =
  | 'generating'
  | 'pending_review'
  | 'approved'
  | 'scheduled'
  | 'published'
  | 'measured'
  | 'dismissed'
  | 'failed'

export type CampaignType =
  | 'product_launch'
  | 'lead_gen'
  | 'evergreen'
  | 'event'
  | 'reactive'

export type CampaignStatus = 'draft' | 'active' | 'paused' | 'completed'

export type CampaignGoalType =
  | 'demo_requests'
  | 'signups'
  | 'followers'
  | 'impressions'
  | 'custom'

/** Canonical channel keys the UI knows how to render. */
export type Channel =
  | 'linkedin'
  | 'twitter'
  | 'instagram'
  | 'tiktok'
  | 'facebook'
  | 'blog'
  | 'wix-blog'
  | 'email'
  | 'sendgrid'

export interface DraftPayload {
  // social
  text?: string
  // blog
  title?: string
  slug?: string
  excerpt?: string
  body?: string
  tags?: string[]
  // email
  subject?: string
  previewText?: string
  // guardian (also surfaced as Draft.guardianScore)
  guardianScore?: number
  guardianNotes?: string
  [key: string]: unknown
}

export interface DraftAssets {
  imageUrl?: string
  [key: string]: unknown
}

export interface Draft {
  id: string
  channel: string
  status: DraftStatus
  campaignId: string | null
  campaignName: string | null
  pillar: string | null
  publishAt: string | null
  guardianScore: number | null
  scoreHuman: number | null
  dismissReason: string | null
  failedReason: string | null
  publishedRef: string | null
  payload: DraftPayload
  assets: DraftAssets
  createdAt: string
  updatedAt: string
}

export interface QueueStatus {
  pending: number
  approved: number
  scheduled: number
  published_today: number
  failed: number
}

export interface PublishNowResult {
  draftId: string
  channel: string
  status: 'published' | 'failed'
  published_ref: string | null
  error: string | null
}

export interface DraftCounts {
  pending: number
  approved: number
  published: number
  total: number
}

export interface Campaign {
  id: string
  name: string
  type: CampaignType
  status: CampaignStatus
  goalType: CampaignGoalType
  goalValue: number | null
  launchDate: string | null
  audienceBrief: Record<string, unknown>
  languageConfig: Record<string, unknown>
  channelConfig: Record<string, unknown>
  voiceModifier: string | null
  channels: string[]
  counts: DraftCounts
  attributedLeads: number
  createdAt: string
}

export interface CreateCampaignInput {
  name: string
  type: CampaignType
  goalType: CampaignGoalType
  goalValue: number | null
  launchDate: string | null
  audienceBrief: string
  language: string
  channels: string[]
  voiceModifier: string
  channelConfig: Record<string, { postsPerWeek: number }>
}

export interface BrandVoice {
  tone?: string
  audience?: string
  preferredTerms?: string[]
  avoidTerms?: string[]
  goodExamples?: string[]
  badExamples?: string[]
  [key: string]: unknown
}

export interface SiteConfigResponse {
  siteId: string
  domain: string
  brandVoice: BrandVoice
}

export interface PlatformConnection {
  /** platform id — matches PlatformDef.id (e.g. 'buffer', 'hubspot'). */
  platform: string
  connected: boolean
  account: string | null
  /** ISO time of the last successful live validation, or null when uncertain. */
  lastValidated: string | null
  lastSyncAt: string | null
  connectionType: 'api_key' | 'oauth' | 'managed'
  canConnect: boolean
  // SendGrid only — sending-domain authentication status.
  domain?: string | null
  domainRegistered?: boolean
  domainVerified?: boolean
}

/** Response from POST /api/connections/:platform/connect. */
export interface ConnectResult {
  ok: boolean
  account: string | null
  message: string
}

export interface DomainAuthRecord {
  type: string
  name: string
  value: string
  valid?: boolean
}

/** Response from GET /api/connections/sendgrid/domain-auth. */
export interface DomainAuth {
  domain: string
  id: number | null
  registered: boolean
  verified: boolean
  records: {
    mail: DomainAuthRecord | null
    dkim1: DomainAuthRecord | null
    dkim2: DomainAuthRecord | null
  }
}

/** Response from POST /api/connections/sendgrid/verify-domain. */
export interface VerifyDomainResult {
  domain: string
  valid: boolean
  validationResults: unknown
}

export interface DocumentRow {
  id: string
  sourceFilename: string
  documentType: string
  version: number
  ingestedAt: string
  chunkCount: number
  /** 'pending' | 'ingested' | 'failed' — set by the ingestion pipeline. */
  extractionStatus?: string | null
  r2Key?: string
}

/** Response from POST /api/documents/upload and /reingest. */
export interface UploadResult {
  document_id: string
  filename: string
  document_type: string
  chunk_count: number
  r2_key: string
  status: 'ingested' | 'failed'
  version?: number
  error?: string
}

export interface Tenant {
  id: string
  name: string
  slug: string
  siteId: string | null
  domain: string | null
}

export interface ApiError {
  error: string
  code: string
}

// ── Weekly intelligence brief ───────────────────────────────────────

export type TopicUrgency = 'breaking' | 'trending' | 'evergreen'

export interface IntelligenceTopic {
  topic: string
  angle: string
  urgency: TopicUrgency
  source_summary: string
  suggested_channel: string
  why_relevant: string
}

export interface IntelligenceBrief {
  id: string
  weekOf: string
  status: 'pending' | 'reviewed' | 'used'
  generatedAt: string
  topics: IntelligenceTopic[]
}

export interface GenerateNowInput {
  topic: string
  channel?: string
  campaignId?: string | null
  toneOverride?: string
  generateImage?: boolean
}

// ── Recommendations ─────────────────────────────────────────────────

export type RecommendationType =
  | 'content_gap'
  | 'channel_rebalance'
  | 'trending_opportunity'
  | 'queue_health'
  | 'engagement_followup'

export type RecommendationActionType = 'generate' | 'approve' | 'review_queue'

export type RecommendationStatus = 'pending' | 'actioned' | 'dismissed'

export interface RecommendationActionParams {
  topic?: string | null
  channel?: string
  campaign_id?: string | null
  draft_ids?: string[]
  [key: string]: unknown
}

export interface Recommendation {
  id: string
  type: RecommendationType
  title: string
  description: string
  reasoning: string
  actionType: RecommendationActionType
  actionParams: RecommendationActionParams
  priorityScore: number
  dataSnapshot: Record<string, unknown>
  status: RecommendationStatus
  weekOf: string
  expiresAt: string
  createdAt: string
}

// ── Analytics ───────────────────────────────────────────────────────

export interface PublishedByDay {
  day: string
  channel: string
  count: number
}

export interface ChannelPerformance {
  channel: string
  posts: number
  avgImpressions: number
  avgEngagement: number
  engagementRate: number
}

export interface AnalyticsSummary {
  pending_count: number
  published_count: number
  avg_guardian: number | null
  published_by_day: PublishedByDay[]
  channel_performance: ChannelPerformance[]
}

export interface TopContentItem {
  id: string
  channel: string
  preview: string
  publishedAt: string | null
  impressions: number
  clicks: number
  engagement: number
  performanceScore: number | null
  guardianScore: number | null
}

export interface TopContentResponse {
  hasMetrics: boolean
  items: TopContentItem[]
}

export interface GscKeyword {
  query: string
  page: string
  impressions: number
  clicks: number
  ctr: number
  position: number
  isHighPerformer: boolean
  weekOf: string
}

export interface GenerateNowResult {
  draftId: string
  channel: string
  guardianScore: number | null
  imageGenerated: boolean
  imageSkipped: boolean | null
  imageUrl: string | null
  /** Set when the (best-effort) paired image failed; the draft is still created. */
  imageError?: string | null
}

// ── Historical Buffer import ────────────────────────────────────────

export interface BufferImportChannelResult {
  channel: string
  channelId: string | null
  fetched: number
  imported: number
  skipped: number
  error?: string
}

export interface BufferImportTopPerformer {
  draftId: string
  channel: string
  performanceScore: number | null
  impressions: number
  engagement: number
  preview: string
}

export interface BufferImportInput {
  profiles: string[]
  dryRun?: boolean
}

export interface BufferImportResult {
  fetched: number
  imported: number
  skipped: number
  scored: number
  goldenExamples: number
  dryRun: boolean
  channels: BufferImportChannelResult[]
  topPerformers: BufferImportTopPerformer[]
}
