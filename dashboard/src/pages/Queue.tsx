import { useEffect, useMemo, useRef, useState } from 'react'
import {
  PartyPopper,
  Sparkles,
  PenSquare,
  AlertTriangle,
  Loader2,
} from 'lucide-react'
import {
  useDrafts,
  useCampaigns,
  useGenerate,
  useGenerateNow,
  useQueueStatus,
} from '@/lib/queries'
import { useTenant } from '@/lib/tenant-context'
import { toApiError } from '@/lib/api'
import type { Campaign, DraftStatus, GenerateNowResult } from '@/lib/types'
import { DraftCard } from '@/components/DraftCard'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
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

export default function Queue() {
  const { current } = useTenant()
  const { data: campaigns } = useCampaigns()
  const { data: stats } = useQueueStatus()
  const generate = useGenerate()

  const [toast, setToast] = useState<ToastState | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [pollingUntil, setPollingUntil] = useState(0)
  const [tab, setTab] = useState('pending')
  const isPolling = pollingUntil > Date.now()

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

  function startPolling() {
    setPollingUntil(Date.now() + POLL_WINDOW_MS)
  }

  // The "Generate more" button tops up the default evergreen campaign.
  const evergreenId = useMemo(
    () => campaigns?.find((c) => c.type === 'evergreen')?.id ?? null,
    [campaigns],
  )

  function handleGenerate() {
    // eslint-disable-next-line no-console
    console.log('[queue] Generate more clicked — campaignId =', evergreenId)
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
        onError: (e) =>
          setToast({ message: toApiError(e).error, variant: 'error' }),
      },
    )
  }

  const sorted = useMemo(() => {
    if (!drafts) return []
    return [...drafts].sort((a, b) => {
      const ta = a.publishAt ? new Date(a.publishAt).getTime() : Infinity
      const tb = b.publishAt ? new Date(b.publishAt).getTime() : Infinity
      return ta - tb
    })
  }, [drafts])

  // Scroll the freshly created draft into view once it lands in the list.
  const highlightRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (highlightId && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [highlightId, sorted])

  function handleCreated(res: GenerateNowResult, channelLabel: string) {
    setCreateOpen(false)
    setHighlightId(res.draftId)
    startPolling()
    setToast({
      message: res.imageGenerated
        ? `New ${channelLabel} draft added — with image`
        : `New ${channelLabel} draft added to queue`,
      variant: 'success',
    })
  }

  return (
    <div className="animate-fade-in space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">Review queue</h1>
          <p className="mt-1 text-sm text-gray-500">
            Review, approve, and publish AI-generated content
            {current ? ` · ${current.name}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setCreateOpen(true)} size="sm">
            <PenSquare className="h-4 w-4" />
            Create now
          </Button>
          <Button
            variant="info"
            size="sm"
            onClick={handleGenerate}
            disabled={generate.isPending}
          >
            {generate.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {generate.isPending ? 'Generating…' : 'Generate more'}
          </Button>
        </div>
      </header>

      {/* Stats bar */}
      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <StatCard label="Pending" value={stats.pending} tint="text-cyan-400" />
          <StatCard label="Approved" value={stats.approved} tint="text-emerald-400" />
          <StatCard label="Scheduled" value={stats.scheduled} tint="text-blue-400" />
          <StatCard label="Published today" value={stats.published_today} tint="text-violet-400" />
          <StatCard label="Failed" value={stats.failed} tint="text-red-400" />
        </div>
      )}

      {/* Filter tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          {QUEUE_TABS.map((t) => (
            <TabsTrigger key={t.key} value={t.key}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {isPolling && (
        <div className="glass-sm flex items-center gap-3 border-cyan-500/20 p-3 text-sm text-cyan-300">
          <Loader2 className="h-4 w-4 animate-spin" />
          Generating new drafts — they’ll appear here as they’re ready…
        </div>
      )}

      {generate.isError && (
        <div className="glass-sm flex items-center gap-3 border-red-500/20 p-4 text-sm text-red-300">
          <AlertTriangle className="h-5 w-5" />
          Generation failed: {toApiError(generate.error).error}
        </div>
      )}

      {isLoading && <QueueSkeleton />}

      {isError && (
        <div className="glass-sm flex items-center gap-3 border-red-500/20 p-5 text-sm text-red-300">
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
          <div className="glass flex flex-col items-center justify-center px-6 py-16 text-center text-sm text-gray-500">
            No {activeTab.label.toLowerCase()} drafts.
          </div>
        )
      )}

      {!isLoading && !isError && sorted.length > 0 && (
        <div className="space-y-4">
          {sorted.map((d) => (
            <div key={d.id} ref={d.id === highlightId ? highlightRef : undefined}>
              <DraftCard draft={d} />
            </div>
          ))}
        </div>
      )}

      <CreateNowModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        campaigns={campaigns ?? []}
        defaultCampaignId={evergreenId}
        onCreated={handleCreated}
      />
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  )
}

// ── Create now modal ────────────────────────────────────────────────

function CreateNowModal({
  open,
  onClose,
  campaigns,
  defaultCampaignId,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  campaigns: Campaign[]
  defaultCampaignId: string | null
  onCreated: (res: GenerateNowResult, channelLabel: string) => void
}) {
  const generateNow = useGenerateNow()
  const [topic, setTopic] = useState('')
  const [channel, setChannel] = useState('linkedin')
  const [campaignId, setCampaignId] = useState('')
  const [toneOverride, setToneOverride] = useState('')
  const [generateImage, setGenerateImage] = useState(true)

  // Seed the campaign select with the evergreen default whenever the modal opens.
  useEffect(() => {
    if (open) {
      setCampaignId(defaultCampaignId ?? '')
      generateNow.reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultCampaignId])

  const channelLabel =
    CHANNEL_OPTIONS.find((o) => o.key === channel)?.label ?? channel

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
          // Reset for next time.
          setTopic('')
          setToneOverride('')
        },
        // Errors are shown inside the modal; do NOT close.
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
            <Select
              value={campaignId}
              onChange={(e) => setCampaignId(e.target.value)}
            >
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

function StatCard({ label, value, tint }: { label: string; value: number; tint: string }) {
  return (
    <div className="glass-sm px-4 py-3">
      <div className={`text-2xl font-bold ${tint}`}>{value}</div>
      <div className="mt-0.5 text-xs text-gray-500">{label}</div>
    </div>
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
    <div className="glass flex flex-col items-center justify-center px-6 py-20 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500/20 to-cyan-500/20">
        <PartyPopper className="h-8 w-8 text-emerald-400" />
      </div>
      <h2 className="text-lg font-semibold text-gray-100">
        Queue is clear — all content approved!
      </h2>
      <p className="mt-1 max-w-sm text-sm text-gray-500">
        Nothing is waiting for review. Generate the next batch of drafts, or
        create one now from a specific topic.
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
    <div className="space-y-4">
      {[0, 1, 2].map((i) => (
        <div key={i} className="glass space-y-4 p-5">
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-5 w-28 rounded-full" />
            <Skeleton className="ml-auto h-5 w-14 rounded-full" />
          </div>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-4/5" />
          <div className="flex gap-2 pt-2">
            <Skeleton className="h-8 w-24 rounded-xl" />
            <Skeleton className="h-8 w-20 rounded-xl" />
            <Skeleton className="h-8 w-24 rounded-xl" />
          </div>
        </div>
      ))}
    </div>
  )
}
