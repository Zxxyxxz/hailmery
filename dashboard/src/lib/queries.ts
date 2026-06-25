import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { api } from './api'
import { useTenant } from './tenant-context'
import type {
  AnalyticsSummary,
  BufferImportInput,
  BufferImportResult,
  Campaign,
  ConnectResult,
  CreateCampaignInput,
  DocumentRow,
  DomainAuth,
  Draft,
  DraftPreview,
  DraftStatus,
  GuardianBreakdown,
  GenerateNowInput,
  GenerateNowResult,
  GscKeyword,
  IntelligenceBrief,
  PlatformConnection,
  PublishNowResult,
  QueueStatus,
  Recommendation,
  RecommendationStatus,
  SiteConfigResponse,
  TopContentResponse,
  UploadResult,
  VerifyDomainResult,
} from './types'

// ── Drafts ──────────────────────────────────────────────────────────

export function useDrafts(params: {
  /** A single status, or a comma-separated list (e.g. "approved,scheduled"). */
  status?: DraftStatus | string
  month?: string
  /** Poll interval (ms) while generation is in flight; false to disable. */
  refetchInterval?: number | false
}) {
  const { currentId } = useTenant()
  const { status, month, refetchInterval = false } = params
  return useQuery({
    // Keep the cache key stable across refetchInterval changes — only the data
    // filters belong in the key.
    queryKey: ['drafts', currentId, { status, month }],
    enabled: !!currentId,
    refetchInterval,
    queryFn: async () => {
      const res = await api.get<{ drafts: Draft[] }>('/api/drafts', {
        params: { status, month },
      })
      return res.data.drafts
    },
  })
}

export interface DraftPatch {
  status?: DraftStatus
  publishAt?: string | null
  dismissReason?: string | null
  payload?: Record<string, unknown>
  rerunGuardian?: boolean
}

export function usePatchDraft() {
  const qc = useQueryClient()
  const { currentId } = useTenant()
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: DraftPatch }) => {
      const res = await api.patch<{ draft: Draft }>(`/api/drafts/${id}`, patch)
      return res.data.draft
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['drafts', currentId] })
      qc.invalidateQueries({ queryKey: ['campaigns', currentId] })
      // A status change (approve/dismiss/schedule) shifts the header counts —
      // keep the queue-status stats bar in sync so "Approved" doesn't go stale.
      qc.invalidateQueries({ queryKey: ['queue-status', currentId] })
    },
  })
}

/**
 * Re-run all five guardians on a draft (after an edit) and persist the fresh
 * breakdown. Returns the new breakdown + normalized draft; invalidates the
 * drafts cache so every view reconciles.
 */
export function useRecheckDraft() {
  const qc = useQueryClient()
  const { currentId } = useTenant()
  return useMutation({
    mutationFn: async (draftId: string) => {
      const res = await api.post<{ breakdown: GuardianBreakdown; draft: Draft }>(
        `/api/drafts/${draftId}/recheck`,
      )
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['drafts', currentId] })
    },
  })
}

/**
 * Email-draft send preview — the resolved recipient count + sender, shown on the
 * card before Publish. Resolution hits HubSpot/SendGrid server-side and is cached
 * 5 min; enable it only for email drafts so non-email cards don't fetch.
 */
export function useDraftPreview(draftId: string, enabled: boolean) {
  const { currentId } = useTenant()
  return useQuery({
    queryKey: ['draft-preview', currentId, draftId],
    enabled: enabled && !!currentId && !!draftId,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      const res = await api.get<DraftPreview>(`/api/drafts/${draftId}/preview`)
      return res.data
    },
  })
}

// ── Queue status (header stats bar) ─────────────────────────────────

export function useQueueStatus() {
  const { currentId } = useTenant()
  return useQuery({
    queryKey: ['queue-status', currentId],
    enabled: !!currentId,
    queryFn: async () => {
      const res = await api.get<QueueStatus>('/api/queue-status')
      return res.data
    },
  })
}

// ── Generation + publish triggers ───────────────────────────────────

export interface GenerateInput {
  campaignId: string
  channels?: string[]
  triggerReason?: string
}

export function useGenerate() {
  const qc = useQueryClient()
  const { currentId } = useTenant()
  return useMutation({
    mutationFn: async (input: GenerateInput) => {
      const res = await api.post<{ workflowId: string; message: string }>(
        '/api/generate',
        { triggerReason: 'manual', ...input },
      )
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['drafts', currentId] })
      qc.invalidateQueries({ queryKey: ['queue-status', currentId] })
    },
  })
}

/** Immediate publish of a single approved draft. Rejects (422) on failure. */
export function usePublishNow() {
  const qc = useQueryClient()
  const { currentId } = useTenant()
  return useMutation({
    mutationFn: async (draftId: string) => {
      const res = await api.post<PublishNowResult>(`/api/publish/${draftId}`)
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['drafts', currentId] })
      qc.invalidateQueries({ queryKey: ['queue-status', currentId] })
      qc.invalidateQueries({ queryKey: ['campaigns', currentId] })
    },
  })
}

// ── Campaigns ───────────────────────────────────────────────────────

export function useCampaigns() {
  const { currentId } = useTenant()
  return useQuery({
    queryKey: ['campaigns', currentId],
    enabled: !!currentId,
    queryFn: async () => {
      const res = await api.get<{ campaigns: Campaign[] }>('/api/campaigns')
      return res.data.campaigns
    },
  })
}

export function useCreateCampaign() {
  const qc = useQueryClient()
  const { currentId } = useTenant()
  return useMutation({
    mutationFn: async (input: CreateCampaignInput) => {
      const res = await api.post<{ campaign: Campaign }>('/api/campaigns', input)
      return res.data.campaign
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['campaigns', currentId] }),
  })
}

export function usePatchCampaign() {
  const qc = useQueryClient()
  const { currentId } = useTenant()
  return useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string
      // audienceBrief is sent as a plain string (the backend wraps it as jsonb
      // { text }), so this can't be a straight Pick over Campaign.
      patch: {
        status?: Campaign['status']
        name?: Campaign['name']
        type?: Campaign['type']
        audienceBrief?: string
        voiceModifier?: Campaign['voiceModifier']
        goalValue?: Campaign['goalValue']
        channelConfig?: Campaign['channelConfig']
      }
    }) => {
      const res = await api.patch<{ campaign: Campaign }>(
        `/api/campaigns/${id}`,
        patch,
      )
      return res.data.campaign
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['campaigns', currentId] }),
  })
}

// ── Site config (brand voice) ───────────────────────────────────────

export function useSiteConfig(siteId: string | undefined) {
  return useQuery({
    queryKey: ['site-config', siteId],
    enabled: !!siteId,
    queryFn: async () => {
      const res = await api.get<SiteConfigResponse>(`/api/sites/${siteId}/config`)
      return res.data
    },
  })
}

export function usePatchSiteConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      siteId,
      brandVoice,
    }: {
      siteId: string
      brandVoice: Record<string, unknown>
    }) => {
      const res = await api.patch<SiteConfigResponse>(
        `/api/sites/${siteId}/config`,
        { brandVoice },
      )
      return res.data
    },
    onSuccess: (_d, vars) =>
      qc.invalidateQueries({ queryKey: ['site-config', vars.siteId] }),
  })
}

// ── Documents ───────────────────────────────────────────────────────

export function useDocuments() {
  const { currentId } = useTenant()
  return useQuery({
    queryKey: ['documents', currentId],
    enabled: !!currentId,
    queryFn: async () => {
      const res = await api.get<{ documents: DocumentRow[] }>('/api/documents')
      return res.data.documents
    },
  })
}

/**
 * Single document — used to poll ingestion progress after an upload/re-ingest
 * until `ingestedAt`/`extractionStatus` settle. `pollUntilId` enables polling
 * for just that id; pass null to disable.
 */
export function useDocument(id: string | null) {
  const { currentId } = useTenant()
  return useQuery({
    queryKey: ['document', currentId, id],
    enabled: !!currentId && !!id,
    refetchInterval: (q) => {
      const status = (q.state.data as DocumentRow | undefined)?.extractionStatus
      // Keep polling every 2s until the pipeline settles.
      return status === 'ingested' || status === 'failed' ? false : 2000
    },
    queryFn: async () => {
      const res = await api.get<{ document: DocumentRow }>(`/api/documents/${id}`)
      return res.data.document
    },
  })
}

export function useUploadDocument() {
  const qc = useQueryClient()
  const { currentId } = useTenant()
  return useMutation({
    mutationFn: async ({
      file,
      documentType,
      onUploadProgress,
    }: {
      file: File
      documentType: string
      onUploadProgress?: (pct: number) => void
    }) => {
      const form = new FormData()
      form.append('file', file)
      form.append('document_type', documentType)
      const res = await api.post<UploadResult>('/api/documents/upload', form, {
        onUploadProgress: (e) => {
          if (e.total) onUploadProgress?.(Math.round((e.loaded / e.total) * 100))
        },
      })
      return res.data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['documents', currentId] }),
  })
}

export function useReingestDocument() {
  const qc = useQueryClient()
  const { currentId } = useTenant()
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await api.post<UploadResult>(`/api/documents/${id}/reingest`)
      return res.data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['documents', currentId] }),
  })
}

export function useDeleteDocument() {
  const qc = useQueryClient()
  const { currentId } = useTenant()
  return useMutation({
    mutationFn: async (id: string) => api.delete(`/api/documents/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['documents', currentId] }),
  })
}

// ── Weekly intelligence brief ───────────────────────────────────────

export function useIntelligence() {
  const { currentId } = useTenant()
  return useQuery({
    queryKey: ['intelligence', currentId],
    enabled: !!currentId,
    queryFn: async () => {
      const res = await api.get<{ brief: IntelligenceBrief | null }>(
        '/api/intelligence',
      )
      return res.data.brief
    },
  })
}

/** Re-runs the weekly research on demand (the card's Refresh button). */
export function useRefreshIntelligence() {
  const qc = useQueryClient()
  const { currentId } = useTenant()
  return useMutation({
    mutationFn: async () => {
      const res = await api.post<{ brief: IntelligenceBrief | null }>(
        '/api/intelligence/refresh',
      )
      return res.data.brief
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['intelligence', currentId] }),
  })
}

/** One-shot generation from a topic — powers the "Create now" modal. */
export function useGenerateNow() {
  const qc = useQueryClient()
  const { currentId } = useTenant()
  return useMutation({
    mutationFn: async (input: GenerateNowInput) => {
      const res = await api.post<GenerateNowResult>('/api/generate-now', input)
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['drafts', currentId] })
      qc.invalidateQueries({ queryKey: ['queue-status', currentId] })
    },
  })
}

// ── Recommendations ─────────────────────────────────────────────────

/** This week's pending recommendations (top 5 by priority). */
export function useRecommendations() {
  const { currentId } = useTenant()
  return useQuery({
    queryKey: ['recommendations', currentId],
    enabled: !!currentId,
    staleTime: 1000 * 60 * 5, // 5 min — the set only changes nightly or on refresh
    queryFn: async () => {
      const res = await api.get<{ recommendations: Recommendation[] }>(
        '/api/recommendations',
      )
      return res.data.recommendations
    },
  })
}

/**
 * Re-runs the engine for this tenant on demand (the panel's Refresh button).
 * Awaits a live Sonnet call (~35-40s). The work commits server-side even if the
 * response is slow to flush, so we invalidate on BOTH success and error so the
 * panel always reconciles with what actually landed.
 */
export function useRefreshRecommendations() {
  const qc = useQueryClient()
  const { currentId } = useTenant()
  return useMutation({
    mutationFn: async () => {
      const res = await api.post<{ recommendations: Recommendation[]; skipped?: boolean }>(
        '/api/recommendations/refresh',
      )
      return res.data
    },
    onSettled: () =>
      qc.invalidateQueries({ queryKey: ['recommendations', currentId] }),
  })
}

/** Mark a recommendation actioned or dismissed. */
export function useUpdateRecommendation() {
  const qc = useQueryClient()
  const { currentId } = useTenant()
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: RecommendationStatus }) => {
      const res = await api.patch<{ ok: boolean }>(`/api/recommendations/${id}`, {
        status,
      })
      return res.data
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['recommendations', currentId] }),
  })
}

// ── Analytics ───────────────────────────────────────────────────────

export function useAnalyticsSummary() {
  const { currentId } = useTenant()
  return useQuery({
    queryKey: ['analytics-summary', currentId],
    enabled: !!currentId,
    queryFn: async () => {
      const res = await api.get<AnalyticsSummary>('/api/analytics/summary')
      return res.data
    },
  })
}

export function useTopContent() {
  const { currentId } = useTenant()
  return useQuery({
    queryKey: ['analytics-top-content', currentId],
    enabled: !!currentId,
    queryFn: async () => {
      const res = await api.get<TopContentResponse>('/api/analytics/top-content')
      return res.data
    },
  })
}

export function useKeywords() {
  const { currentId } = useTenant()
  return useQuery({
    queryKey: ['analytics-keywords', currentId],
    enabled: !!currentId,
    queryFn: async () => {
      const res = await api.get<{ keywords: GscKeyword[] }>('/api/analytics/keywords')
      return res.data.keywords
    },
  })
}

// ── Historical Buffer import ────────────────────────────────────────

/**
 * Import the tenant's already-published Buffer history as measured content for
 * the learning loop. A dry run (dryRun: true) previews counts without writing;
 * a real run also re-scores and may promote golden examples, so invalidate the
 * analytics + drafts caches on success.
 */
export function useImportBufferHistory() {
  const qc = useQueryClient()
  const { currentId } = useTenant()
  return useMutation({
    mutationFn: async (input: BufferImportInput) => {
      const res = await api.post<BufferImportResult>('/api/import/buffer-history', input)
      return res.data
    },
    onSuccess: (data) => {
      if (data.dryRun) return
      qc.invalidateQueries({ queryKey: ['analytics-summary', currentId] })
      qc.invalidateQueries({ queryKey: ['analytics-top-content', currentId] })
      qc.invalidateQueries({ queryKey: ['drafts', currentId] })
      qc.invalidateQueries({ queryKey: ['documents', currentId] })
    },
  })
}

// ── Connected platforms ─────────────────────────────────────────────

export function useConnections() {
  const { currentId } = useTenant()
  return useQuery({
    queryKey: ['connections', currentId],
    enabled: !!currentId,
    // Validation hits live provider APIs and is cached 5 min server-side; keep
    // the client cache in step so a tab switch doesn't re-fetch needlessly.
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      const res = await api.get<{ connections: PlatformConnection[] }>(
        '/api/connections',
      )
      return res.data.connections
    },
  })
}

/** Validate + store an API key for a platform (Buffer / HubSpot / SendGrid). */
export function useConnectPlatform() {
  const qc = useQueryClient()
  const { currentId } = useTenant()
  return useMutation({
    mutationFn: async ({
      platform,
      apiKey,
      extra,
    }: {
      platform: string
      apiKey: string
      extra?: Record<string, unknown>
    }) => {
      const res = await api.post<ConnectResult>(
        `/api/connections/${platform}/connect`,
        { apiKey, ...(extra ?? {}) },
      )
      return res.data
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['connections', currentId] }),
  })
}

/** Disconnect a platform (deletes the stored credential). Confirmed server-side. */
export function useDisconnectPlatform() {
  const qc = useQueryClient()
  const { currentId } = useTenant()
  return useMutation({
    mutationFn: async (platform: string) => {
      const res = await api.post(`/api/connections/${platform}/disconnect`, {
        confirm: true,
      })
      return res.data
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['connections', currentId] }),
  })
}

/**
 * SendGrid sending-domain CNAME records. Disabled by default — call refetch()
 * when the domain-auth modal opens so we don't register a domain on page load.
 */
export function useDomainAuth() {
  const { currentId } = useTenant()
  return useQuery({
    queryKey: ['domain-auth', currentId],
    enabled: false,
    gcTime: 0,
    queryFn: async () => {
      const res = await api.get<DomainAuth>(
        '/api/connections/sendgrid/domain-auth',
      )
      return res.data
    },
  })
}

/** Ask SendGrid to re-check the sending domain's DNS now. */
export function useVerifyDomain() {
  const qc = useQueryClient()
  const { currentId } = useTenant()
  return useMutation({
    mutationFn: async () => {
      const res = await api.post<VerifyDomainResult>(
        '/api/connections/sendgrid/verify-domain',
      )
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['connections', currentId] })
      qc.invalidateQueries({ queryKey: ['domain-auth', currentId] })
    },
  })
}
