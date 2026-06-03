import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { api } from './api'
import { useTenant } from './tenant-context'
import type {
  Campaign,
  CreateCampaignInput,
  DocumentRow,
  Draft,
  DraftStatus,
  GenerateNowInput,
  GenerateNowResult,
  IntelligenceBrief,
  PlatformConnection,
  PublishNowResult,
  QueueStatus,
  SiteConfigResponse,
} from './types'

// ── Drafts ──────────────────────────────────────────────────────────

export function useDrafts(params: {
  status?: DraftStatus
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
      patch: Partial<Pick<Campaign, 'status' | 'name' | 'goalValue' | 'channelConfig'>>
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

// ── Connected platforms ─────────────────────────────────────────────

export function useConnections() {
  const { currentId } = useTenant()
  return useQuery({
    queryKey: ['connections', currentId],
    enabled: !!currentId,
    queryFn: async () => {
      const res = await api.get<{ connections: PlatformConnection[] }>(
        '/api/connections',
      )
      return res.data.connections
    },
  })
}
