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
  platform: string
  connected: boolean
  account: string | null
  lastSyncAt: string | null
}

export interface DocumentRow {
  id: string
  sourceFilename: string
  documentType: string
  version: number
  ingestedAt: string
  chunkCount: number
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
