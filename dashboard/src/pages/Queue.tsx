import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  PartyPopper,
  Sparkles,
  PenSquare,
  AlertTriangle,
  Loader2,
  Eye,
  Inbox,
} from 'lucide-react'
import {
  useDrafts,
  useCampaigns,
  useGenerate,
  useGenerateNow,
  useQueueStatus,
  useUpdateRecommendation,
  usePatchDraft,
  usePublishNow,
} from '@/lib/queries'
import { useTenant } from '@/lib/tenant-context'
import { useIsMobile } from '@/lib/use-media-query'
import { toApiError } from '@/lib/api'
import { translateDraftError } from '@/lib/draft-errors'
import type { Campaign, Draft, DraftStatus, GenerateNowResult, QueueStatus } from '@/lib/types'
import { DraftCard } from '@/components/DraftCard'
import { CompactDraftRow } from '@/components/CompactDraftRow'
import {
  RecommendationsPanel,
  type RecommendationGenerateInput,
} from '@/components/RecommendationsPanel'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { Sheet } from '@/components/ui/sheet'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Toast, type ToastState } from '@/components/ui/toast'

// Generation is async — after a trigger we poll the queue for this long so new
// cards surface without a manual refresh.
const POLL_WINDOW_MS = 60_000
const POLL_INTERVAL_MS = 4_000

const CHANNEL_OPTIONS: Array<{ key: string; label: string }> = [
  { key: 'blog', label: 'Blog' },
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'x', label: 'X' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'email', label: 'Email' },
  { key: 'tiktok', label: 'TikTok' },
]

// Filter tabs below the stats bar. "Approved" groups approved + scheduled so a
// draft that's been approved (and queued for a future publish) stays visible
// with its Publish-now action.
const QUEUE_TABS: Array<{ key: string; label: string; statuses: DraftStatus[] }> = [
  { key: 'pending', label: 'Pending', statuses: ['pending_review'] },
  { key: 'approved', label: 'Approved', statuses: ['approved', 'scheduled'] },
  { key: 'published', label: 'Published', statuses: ['published'] },
  { key: 'failed', label: 'Failed', statuses: ['failed'] },
]

type SortKey = 'newest' | 'oldest' | 'guardian' | 'scheduled'

const SORT_OPTIONS: Array<{ key: SortKey; label: string }> = [
  { key: 'newest', label: 'Newest first' },
  { key: 'oldest', label: 'Oldest first' },
  { key: 'guardian', label: 'Guardian score' },
  { key: 'scheduled', label: 'Scheduled date' },
]

export default function Queue() {
  const { current } = useTenant()
  const { data: campaigns } = useCampaigns()
  const { data: stats } = useQueueStatus()
  const generate = useGenerate()
  const patch = usePatchDraft()
  const publishNow = usePublishNow()
  const isMobile = useIsMobile()

  const [toast, setToast] = useState<ToastState | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  // When the Create-now modal is opened from a recommendation, this carries the
  // pre-fill (topic/channel/campaign) + the originating rec id so we can mark it
  // actioned once a draft is actually produced.
  const [prefill, setPrefill] = useState<RecommendationGenerateInput | null>(null)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [pollingUntil, setPollingUntil] = useState(0)
  const [tab, setTabRaw] = useState('pending')
  const [sort, setSort] = useState<SortKey>('newest')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const isPolling = pollingUntil > Date.now()
  const updateRec = useUpdateRecommendation()
  const queueListRef = useRef<HTMLDivElement>(null)
  const highlightRef = useRef<HTMLDivElement>(null)

  // Changing tab clears any cross-tab selection state.
  function setTab(next: string) {
    setTabRaw(next)
    setSelectedIds(new Set())
  }

  const activeTab = QUEUE_TABS.find((t) => t.key === tab) ?? QUEUE_TABS[0]

  const { data: drafts, isLoading, isError, error } = useDrafts({
    status: activeTab.statuses.join(','),
    refetchInterval: isPolling ? POLL_INTERVAL_MS : false,
  })

  // Stop polling once the window elapses (forces a re-render so refetch halts).
  useEffect(() => {
    if (pollingUntil === 0) return
    const t = setTimeout(() => setPollingUntil(0), Math.max(0, pollingUntil - Date.now()))
    return () => clearTimeout(t)
  }, [pollingUntil])

  // Create-now returns the new draft id; once it actually lands in the visible
  // list the "generating" banner has served its purpose — clear it.
  useEffect(() => {
    if (highlightId && drafts?.some((d) => d.id === highlightId)) {
      setPollingUntil(0)
    }
  }, [highlightId, drafts])

  function startPolling() {
    setPollingUntil(Date.now() + POLL_WINDOW_MS)
  }

  // The "Generate more" button tops up the default evergreen campaign.
  const evergreenId = useMemo(
    () => campaigns?.find((c) => c.type === 'evergreen')?.id ?? null,
    [campaigns],
  )

  function handleGenerate() {
    if (!evergreenId) {
      setToast({ message: 'No evergreen campaign found for this tenant.', variant: 'error' })
      return
    }
    generate.mutate(
      { campaignId: evergreenId, triggerReason: 'manual' },
      {
        onSuccess: () => {
          setToast({ message: 'New drafts added to queue', variant: 'success' })
          startPolling()
        },
        onError: (e) => setToast({ message: toApiError(e).error, variant: 'error' }),
      },
    )
  }

  const sorted = useMemo(() => {
    if (!drafts) return []
    const arr = [...drafts]
    const created = (iso: string | null) => (iso ? new Date(iso).getTime() : 0)
    const scheduled = (iso: string | null) => (iso ? new Date(iso).getTime() : Infinity)
    switch (sort) {
      case 'oldest':
        return arr.sort((a, b) => created(a.createdAt) - created(b.createdAt))
      case 'guardian':
        return arr.sort((a, b) => (b.guardianScore ?? -1) - (a.guardianScore ?? -1))
      case 'scheduled':
        return arr.sort((a, b) => scheduled(a.publishAt) - scheduled(b.publishAt))
      case 'newest':
      default:
        return arr.sort((a, b) => created(b.createdAt) - created(a.createdAt))
    }
  }, [drafts, sort])

  // Keep a valid selection: prefer a freshly created draft once it lands; else
  // keep the current selection if still present; else auto-select the first row
  // on desktop (so the preview pane is populated) and nothing on mobile.
  useEffect(() => {
    if (!sorted.length) {
      setSelectedId(null)
      return
    }
    if (highlightId && sorted.some((d) => d.id === highlightId)) {
      setSelectedId(highlightId)
      // Consume the highlight so later poll/mutation refetches (which produce a
      // fresh `sorted` reference) don't keep snapping selection back to it.
      setHighlightId(null)
      return
    }
    setSelectedId((cur) => {
      if (cur && sorted.some((d) => d.id === cur)) return cur
      return isMobile ? null : sorted[0].id
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorted, isMobile, highlightId])

  // Scroll the freshly created draft into view once it lands in the list.
  useEffect(() => {
    if (highlightId && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [highlightId, sorted])

  const selectedDraft = useMemo(
    () => sorted.find((d) => d.id === selectedId) ?? null,
    [sorted, selectedId],
  )

  // Failed-tab grouping: how many failures share a missing-channel root cause.
  const channelErrors = useMemo(() => {
    if (tab !== 'failed' || !drafts) return 0
    return drafts.filter((d) => translateDraftError(d.failedReason).category === 'channel_setup')
      .length
  }, [tab, drafts])

  const showCheckbox = tab !== 'published'

  function selectDraft(d: Draft) {
    setSelectedId(d.id)
  }

  function toggleCheck(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelectedIds((prev) =>
      prev.size === sorted.length ? new Set() : new Set(sorted.map((d) => d.id)),
    )
  }

  function approve(id: string) {
    // Mirror DraftCard's approve: set publishAt to now so the cron picks it up.
    // Approving WITHOUT a publishAt leaves publish_at NULL and the draft never
    // qualifies for auto-publish (loadDueForPublish requires publish_at NOT NULL).
    patch.mutate(
      { id, patch: { status: 'approved', publishAt: new Date().toISOString() } },
      {
        onSuccess: () => setToast({ message: 'Draft approved', variant: 'success' }),
        onError: (e) => setToast({ message: toApiError(e).error, variant: 'error' }),
      },
    )
  }

  function dismiss(id: string) {
    patch.mutate(
      { id, patch: { status: 'dismissed', dismissReason: 'Dismissed from queue' } },
      {
        onSuccess: () => setToast({ message: 'Draft dismissed', variant: 'success' }),
        onError: (e) => setToast({ message: toApiError(e).error, variant: 'error' }),
      },
    )
  }

  function publish(id: string) {
    publishNow.mutate(id, {
      onSuccess: () => setToast({ message: 'Published — moved to the Published tab', variant: 'success' }),
      onError: (e) => setToast({ message: toApiError(e).error, variant: 'error' }),
    })
  }

  async function bulkApprove() {
    const ids = [...selectedIds]
    const publishAt = new Date().toISOString()
    setSelectedIds(new Set())
    const results = await Promise.allSettled(
      ids.map((id) => patch.mutateAsync({ id, patch: { status: 'approved', publishAt } })),
    )
    const ok = results.filter((r) => r.status === 'fulfilled').length
    const failed = ids.length - ok
    setToast({
      message: failed ? `Approved ${ok} · ${failed} failed` : `Approved ${ok} drafts`,
      variant: failed ? 'error' : 'success',
    })
  }

  async function bulkDismiss() {
    const ids = [...selectedIds]
    setSelectedIds(new Set())
    const results = await Promise.allSettled(
      ids.map((id) =>
        patch.mutateAsync({ id, patch: { status: 'dismissed', dismissReason: 'Bulk dismissed' } }),
      ),
    )
    const ok = results.filter((r) => r.status === 'fulfilled').length
    const failed = ids.length - ok
    setToast({
      message: failed ? `Dismissed ${ok} · ${failed} failed` : `Dismissed ${ok} drafts`,
      variant: failed ? 'error' : 'success',
    })
  }

  function handleCreated(res: GenerateNowResult, channelLabel: string) {
    setCreateOpen(false)
    setHighlightId(res.draftId)
    startPolling()
    if (prefill?.recId) {
      updateRec.mutate({ id: prefill.recId, status: 'actioned' })
    }
    setPrefill(null)
    setToast({
      message: res.imageGenerated
        ? `New ${channelLabel} draft added — with image`
        : `New ${channelLabel} draft added to queue`,
      variant: 'success',
    })
  }

  function handleRecGenerate(input: RecommendationGenerateInput) {
    setPrefill(input)
    setCreateOpen(true)
  }

  function handleReviewQueue() {
    setTab('pending')
    setTimeout(
      () => queueListRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      60,
    )
  }

  function closeCreate() {
    setCreateOpen(false)
    setPrefill(null)
  }

  const allChecked = sorted.length > 0 && selectedIds.size === sorted.length

  return (
    <div className="animate-fade-in space-y-4 md:space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[#f1f5f9]">Review queue</h1>
          <p className="mt-1 text-sm text-[#94a3b8]">
            Review, approve, and publish AI-generated content
            {current ? ` · ${current.name}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setCreateOpen(true)} size="sm">
            <PenSquare className="h-4 w-4" />
            Create now
          </Button>
          <Button variant="info" size="sm" onClick={handleGenerate} disabled={generate.isPending}>
            {generate.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {generate.isPending ? 'Generating…' : 'Generate more'}
          </Button>
        </div>
      </header>

      <div className="flex flex-col gap-4 md:flex-row md:items-start">
        {/* LEFT — recommendations (pending only) + stats + triage list */}
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {tab === 'pending' && (
            <RecommendationsPanel onGenerate={handleRecGenerate} onReviewQueue={handleReviewQueue} />
          )}

          {stats && <StatBar stats={stats} activeTab={tab} onFilter={setTab} />}

          {/* Tabs + sort */}
          <div ref={queueListRef} className="flex flex-wrap items-center justify-between gap-3">
            <div className="w-full overflow-x-auto no-scrollbar sm:w-auto">
              <Tabs value={tab} onValueChange={setTab}>
                <TabsList className="flex-nowrap whitespace-nowrap">
                  {QUEUE_TABS.map((t) => {
                    const c = tabCount(t.key, stats)
                    return (
                      <TabsTrigger key={t.key} value={t.key}>
                        {t.label}
                        {c != null && (
                          <span className="ml-1.5 rounded bg-white/[0.08] px-1.5 text-[11px] tabular-nums text-[#94a3b8]">
                            {c}
                          </span>
                        )}
                      </TabsTrigger>
                    )
                  })}
                </TabsList>
              </Tabs>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-[#94a3b8]">Sort by</span>
              <div className="w-44">
                <Select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                  {SORT_OPTIONS.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          </div>

          {/* Failed-tab recovery callout */}
          {tab === 'failed' && channelErrors > 2 && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-[#ef4444]/30 bg-[#ef4444]/10 p-3">
              <span className="text-sm text-[#ef4444]">
                {channelErrors} posts failed due to missing channel setup
              </span>
              <Link
                to="/settings?tab=platforms"
                className="shrink-0 rounded bg-[#ef4444]/20 px-2 py-1 text-xs text-[#ef4444] transition-colors hover:bg-[#ef4444]/30"
              >
                Fix in Platforms →
              </Link>
            </div>
          )}

          {/* Bulk actions bar */}
          {selectedIds.size > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[#7c3aed]/30 bg-[#7c3aed]/10 px-4 py-2">
              <span className="text-sm text-[#94a3b8]">{selectedIds.size} selected</span>
              {tab === 'pending' && (
                <button
                  onClick={bulkApprove}
                  className="rounded bg-[#10b981]/20 px-3 py-1 text-xs text-[#10b981] hover:bg-[#10b981]/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40"
                >
                  Approve all
                </button>
              )}
              <button
                onClick={bulkDismiss}
                className="rounded bg-[#ef4444]/20 px-3 py-1 text-xs text-[#ef4444] hover:bg-[#ef4444]/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40"
              >
                Dismiss all
              </button>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="ml-auto rounded text-xs text-[#94a3b8] hover:text-[#f1f5f9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40"
              >
                Clear selection
              </button>
            </div>
          )}

          {isPolling && (
            <div className="flex items-center gap-3 rounded-lg border border-violet-500/20 bg-violet-500/[0.06] p-3 text-sm text-violet-300">
              <Loader2 className="h-4 w-4 animate-spin" />
              Generating new drafts — they&rsquo;ll appear here as they&rsquo;re ready…
            </div>
          )}

          {generate.isError && (
            <div className="flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/[0.06] p-4 text-sm text-red-300">
              <AlertTriangle className="h-5 w-5" />
              Generation failed: {toApiError(generate.error).error}
            </div>
          )}

          {isLoading && <QueueSkeleton />}

          {isError && (
            <div className="flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/[0.06] p-5 text-sm text-red-300">
              <AlertTriangle className="h-5 w-5" />
              Failed to load drafts: {(error as Error)?.message ?? 'unknown error'}
            </div>
          )}

          {!isLoading && !isError && sorted.length === 0 && (
            tab === 'pending' ? (
              <EmptyState
                onGenerate={handleGenerate}
                onCreate={() => setCreateOpen(true)}
                canGenerate={!!evergreenId}
                generating={generate.isPending}
              />
            ) : (
              <TabEmptyState tab={tab} />
            )
          )}

          {!isLoading && !isError && sorted.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-[#1e1e2e]">
              {/* List toolbar — select all + count */}
              <div className="flex items-center gap-3 border-b border-[#1e1e2e] bg-[#0a0a0f] px-3 py-2">
                {showCheckbox && (
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={toggleAll}
                    aria-label="Select all drafts"
                    className="h-3.5 w-3.5 accent-[#7c3aed]"
                  />
                )}
                <span className="text-xs text-[#94a3b8]">
                  {sorted.length} {sorted.length === 1 ? 'draft' : 'drafts'}
                </span>
              </div>
              <div className="divide-y divide-[#1e1e2e]">
                {sorted.map((d) => (
                  <div key={d.id} ref={d.id === highlightId ? highlightRef : undefined}>
                    <CompactDraftRow
                      draft={d}
                      tab={tab}
                      isSelected={selectedId === d.id}
                      checked={selectedIds.has(d.id)}
                      showCheckbox={showCheckbox}
                      onSelect={selectDraft}
                      onToggleCheck={toggleCheck}
                      onApprove={approve}
                      onDismiss={dismiss}
                      onPublish={publish}
                      busy={patch.isPending || publishNow.isPending}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* RIGHT — preview pane (desktop) */}
        {!isMobile && (
          <aside className="hidden md:block md:w-[40%] md:shrink-0">
            <div className="sticky top-6 max-h-[calc(100vh-3rem)] overflow-y-auto">
              {selectedDraft ? (
                <DraftCard draft={selectedDraft} onToast={setToast} />
              ) : (
                <PreviewEmpty />
              )}
            </div>
          </aside>
        )}
      </div>

      {/* Mobile preview — slide-over sheet */}
      {isMobile && (
        <Sheet open={!!selectedDraft} onClose={() => setSelectedId(null)} title="Draft preview">
          {selectedDraft && <DraftCard draft={selectedDraft} onToast={setToast} />}
        </Sheet>
      )}

      <CreateNowModal
        open={createOpen}
        onClose={closeCreate}
        campaigns={campaigns ?? []}
        defaultCampaignId={evergreenId}
        initialTopic={prefill?.topic}
        initialChannel={prefill?.channel}
        initialCampaignId={prefill?.campaignId ?? null}
        fromRecommendation={!!prefill}
        onCreated={handleCreated}
      />
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  )
}

// ── Stats bar (clickable filters) ───────────────────────────────────

function tabCount(key: string, stats?: QueueStatus): number | null {
  if (!stats) return null
  if (key === 'pending') return stats.pending
  // The Approved tab lists approved + scheduled, so its badge sums both —
  // this is what fixes "Approved: 0 but a card shows" (the card is scheduled).
  if (key === 'approved') return stats.approved + stats.scheduled
  if (key === 'failed') return stats.failed
  return null
}

function StatBar({
  stats,
  activeTab,
  onFilter,
}: {
  stats: QueueStatus
  activeTab: string
  onFilter: (tab: string) => void
}) {
  const items = [
    { tab: 'pending', label: 'Pending', value: stats.pending, color: 'text-[#06b6d4]' },
    { tab: 'approved', label: 'Approved', value: stats.approved, color: 'text-[#f1f5f9]' },
    { tab: 'approved', label: 'Scheduled', value: stats.scheduled, color: 'text-[#f59e0b]' },
    { tab: 'published', label: 'Today', value: stats.published_today, color: 'text-[#f1f5f9]' },
    {
      tab: 'failed',
      label: 'Failed',
      value: stats.failed,
      color: stats.failed > 0 ? 'text-[#ef4444]' : 'text-[#f1f5f9]',
    },
  ]
  return (
    <div className="grid grid-cols-5 gap-2 rounded-lg border border-[#1e1e2e] bg-[#0a0a0f] px-2 py-3 sm:gap-6 sm:px-4">
      {items.map((item) => {
        const active = activeTab === item.tab
        return (
          <button
            key={item.label}
            onClick={() => onFilter(item.tab)}
            aria-current={active ? 'true' : undefined}
            className={`rounded text-center transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 ${
              active ? 'opacity-100' : 'opacity-70'
            }`}
          >
            <div className={`text-xl font-bold tabular-nums sm:text-2xl ${item.color}`}>
              {item.value}
            </div>
            <div className={`text-[11px] sm:text-xs ${active ? 'text-[#94a3b8]' : 'text-[#64748b]'}`}>
              {item.label}
            </div>
          </button>
        )
      })}
    </div>
  )
}

function PreviewEmpty() {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[#1e1e2e] bg-[#0a0a0f] px-6 py-20 text-center">
      <Eye className="mb-3 h-8 w-8 text-[#64748b]" />
      <p className="text-sm text-[#94a3b8]">Select a draft to preview it here.</p>
    </div>
  )
}

function TabEmptyState({ tab }: { tab: string }) {
  const copy: Record<string, { icon: typeof Inbox; title: string; body: string }> = {
    approved: {
      icon: Inbox,
      title: 'No approved drafts yet',
      body: 'Review pending drafts and approve them to see them here.',
    },
    published: {
      icon: PartyPopper,
      title: 'Nothing published today',
      body: "Approve drafts and they'll appear here after publishing.",
    },
    failed: {
      icon: PartyPopper,
      title: 'No failed posts',
      body: 'Everything published cleanly. Failures will surface here with a fix action.',
    },
  }
  const c = copy[tab] ?? copy.approved
  const Icon = c.icon
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-[#1e1e2e] bg-[#0a0a0f] px-6 py-16 text-center">
      <Icon className="mb-3 h-8 w-8 text-[#64748b]" />
      <h2 className="text-sm font-semibold text-[#f1f5f9]">{c.title}</h2>
      <p className="mt-1 max-w-sm text-sm text-[#94a3b8]">{c.body}</p>
    </div>
  )
}

// ── Create now modal ────────────────────────────────────────────────

function CreateNowModal({
  open,
  onClose,
  campaigns,
  defaultCampaignId,
  initialTopic,
  initialChannel,
  initialCampaignId,
  fromRecommendation = false,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  campaigns: Campaign[]
  defaultCampaignId: string | null
  initialTopic?: string
  initialChannel?: string
  initialCampaignId?: string | null
  fromRecommendation?: boolean
  onCreated: (res: GenerateNowResult, channelLabel: string) => void
}) {
  const generateNow = useGenerateNow()
  const [topic, setTopic] = useState('')
  const [channel, setChannel] = useState('linkedin')
  const [campaignId, setCampaignId] = useState('')
  const [toneOverride, setToneOverride] = useState('')
  const [generateImage, setGenerateImage] = useState(true)

  useEffect(() => {
    if (open) {
      setTopic(initialTopic ?? '')
      setChannel(initialChannel ?? 'linkedin')
      setCampaignId(initialCampaignId ?? defaultCampaignId ?? '')
      setToneOverride('')
      generateNow.reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialTopic, initialChannel, initialCampaignId, defaultCampaignId])

  const channelLabel = CHANNEL_OPTIONS.find((o) => o.key === channel)?.label ?? channel

  function submit() {
    if (!topic.trim()) return
    generateNow.mutate(
      {
        topic: topic.trim(),
        channel,
        campaignId: campaignId || null,
        toneOverride: toneOverride.trim() || undefined,
        generateImage,
      },
      {
        onSuccess: (res) => {
          onCreated(res, channelLabel)
          setTopic('')
          setToneOverride('')
        },
      },
    )
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      className="max-w-lg"
      title="Create now"
      description="Generate a single draft from a topic — it lands in the review queue."
    >
      <div className="space-y-4 p-6 pt-2">
        {fromRecommendation && (
          <div className="flex items-center gap-2 rounded-lg border border-violet-500/20 bg-violet-500/[0.06] px-3 py-2 text-xs text-violet-300">
            <Sparkles className="h-3.5 w-3.5 shrink-0" />
            Pre-filled from this week&rsquo;s recommendation — review and generate.
          </div>
        )}
        <div>
          <Label>Topic</Label>
          <Textarea
            rows={2}
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="What do you want to write about? e.g. Why WAF cannot protect AI APIs"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Channel</Label>
            <Select value={channel} onChange={(e) => setChannel(e.target.value)}>
              {CHANNEL_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Campaign</Label>
            <Select value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
              <option value="">(none)</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div>
          <Label>Tone override (optional)</Label>
          <Input
            value={toneOverride}
            onChange={(e) => setToneOverride(e.target.value)}
            placeholder="e.g. more urgent, more technical, more casual"
          />
        </div>

        <Checkbox
          checked={generateImage}
          onChange={() => setGenerateImage((v) => !v)}
          label="Generate a paired image"
        />

        {generateNow.isError && (
          <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/[0.06] p-3 text-sm text-red-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {toApiError(generateNow.error).error}
          </div>
        )}

        <Button
          className="w-full"
          onClick={submit}
          disabled={!topic.trim() || generateNow.isPending}
        >
          {generateNow.isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Generating your {channelLabel} post…
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              Generate
            </>
          )}
        </Button>
      </div>
    </Dialog>
  )
}

function EmptyState({
  onGenerate,
  onCreate,
  canGenerate,
  generating,
}: {
  onGenerate: () => void
  onCreate: () => void
  canGenerate: boolean
  generating: boolean
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-[#1e1e2e] bg-[#0a0a0f] px-6 py-20 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500/20 to-violet-500/20">
        <PartyPopper className="h-8 w-8 text-emerald-400" />
      </div>
      <h2 className="text-lg font-semibold text-[#f1f5f9]">
        Queue is clear — all content approved!
      </h2>
      <p className="mt-1 max-w-sm text-sm text-[#94a3b8]">
        Nothing is waiting for review. Generate the next batch of drafts, or create one now from a
        specific topic.
      </p>
      <div className="mt-6 flex items-center gap-2">
        <Button variant="secondary" onClick={onCreate}>
          <PenSquare className="h-4 w-4" />
          Create now
        </Button>
        <Button onClick={onGenerate} disabled={!canGenerate || generating}>
          {generating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          Generate more content
        </Button>
      </div>
    </div>
  )
}

function QueueSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-[#1e1e2e] divide-y divide-[#1e1e2e]">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-3">
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-4 w-20 rounded-full" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-5 w-12 rounded-full" />
          <Skeleton className="h-7 w-16 rounded" />
        </div>
      ))}
    </div>
  )
}
