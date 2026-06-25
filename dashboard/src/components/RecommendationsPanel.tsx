import { useState } from 'react'
import {
  Sparkles,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  X,
  Loader2,
  ListChecks,
  AlertTriangle,
} from 'lucide-react'
import {
  useRecommendations,
  useRefreshRecommendations,
  useUpdateRecommendation,
} from '@/lib/queries'
import { toApiError } from '@/lib/api'
import { formatTimeAgo } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { Recommendation, RecommendationType } from '@/lib/types'

export interface RecommendationGenerateInput {
  recId: string
  topic: string
  channel: string
  campaignId: string | null
}

interface RecommendationsPanelProps {
  /** Pre-fill + open the Create-now modal from a `generate` recommendation. */
  onGenerate: (input: RecommendationGenerateInput) => void
  /** Jump the user to the review queue from an `approve` / `review_queue` action. */
  onReviewQueue: () => void
  /** Start collapsed (default true — the queue triage view leads, recs are secondary). */
  defaultExpanded?: boolean
}

const TYPE_META: Record<RecommendationType, { label: string; badge: string }> = {
  content_gap: { label: 'Content gap', badge: 'cyan' },
  channel_rebalance: { label: 'Rebalance', badge: 'blue' },
  trending_opportunity: { label: 'Trending', badge: 'purple' },
  queue_health: { label: 'Queue health', badge: 'amber' },
  engagement_followup: { label: 'Follow-up', badge: 'green' },
  seo_opportunity: { label: 'SEO', badge: 'orange' },
}

interface PriorityTier {
  border: string
  badge: string
  label: string
}

function priorityTier(score: number): PriorityTier {
  if (score >= 8) return { border: 'border-l-red-500/70', badge: 'red', label: 'Urgent' }
  if (score >= 5) return { border: 'border-l-amber-500/70', badge: 'amber', label: 'This week' }
  return { border: 'border-l-emerald-500/70', badge: 'green', label: 'Nice to have' }
}

export function RecommendationsPanel({
  onGenerate,
  onReviewQueue,
  defaultExpanded = false,
}: RecommendationsPanelProps) {
  const { data: recs, isLoading } = useRecommendations()
  const refresh = useRefreshRecommendations()
  const [expanded, setExpanded] = useState(defaultExpanded)

  const lastUpdated = recs && recs.length > 0 ? recs[0].createdAt : null
  const count = recs?.length ?? 0
  const isEmpty = !isLoading && count === 0

  return (
    <section className="rounded-lg border border-[#1e1e2e] bg-[#0a0a0f]">
      <div className="flex w-full items-center justify-between gap-3 p-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-2 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40"
        >
          <Sparkles className="h-4 w-4 shrink-0 text-violet-300" />
          <span className="truncate text-sm font-semibold text-[#f1f5f9]">
            This week&rsquo;s recommendations
          </span>
          {count > 0 && (
            <span className="shrink-0 text-xs text-[#06b6d4]">{count} actions</span>
          )}
          {lastUpdated && (
            <span className="hidden shrink-0 text-xs text-[#94a3b8] sm:inline">
              · updated {formatTimeAgo(lastUpdated)}
            </span>
          )}
          {expanded ? (
            <ChevronUp className="ml-auto h-4 w-4 shrink-0 text-[#64748b]" />
          ) : (
            <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-[#64748b]" />
          )}
        </button>
        <button
          type="button"
          onClick={() => {
            if (!refresh.isPending) refresh.mutate()
          }}
          disabled={refresh.isPending}
          title="Re-run the analysis (calls the AI — takes ~30-40s)"
          className="flex shrink-0 items-center gap-1.5 rounded-md border border-[#1e1e2e] px-2 py-1 text-xs text-[#94a3b8] transition-colors hover:bg-white/[0.06] hover:text-[#f1f5f9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 disabled:opacity-50"
        >
          {refresh.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {refresh.isPending ? 'Analysing…' : 'Refresh'}
        </button>
      </div>

      {expanded && (
        <div className="space-y-3 border-t border-[#1e1e2e] p-3">
          {refresh.isError && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.06] p-3 text-xs text-amber-300">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {toApiError(refresh.error).error} — the analysis may still have completed; the list
              will update if it did.
            </div>
          )}

          {isLoading && <PanelSkeleton />}

          {isEmpty && !refresh.isPending && (
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-8 text-center">
              <Sparkles className="h-7 w-7 text-violet-300/70" />
              <p className="max-w-sm text-sm text-[#94a3b8]">
                No recommendations yet. Run an analysis to get your top 5 actions for the week,
                each backed by real data.
              </p>
              <Button size="sm" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
                <Sparkles className="h-4 w-4" />
                Generate first analysis
              </Button>
            </div>
          )}

          {refresh.isPending && isEmpty && (
            <div className="flex items-center justify-center gap-3 px-6 py-8 text-sm text-violet-300">
              <Loader2 className="h-4 w-4 animate-spin" />
              Analysing your performance data…
            </div>
          )}

          {!isLoading && recs && recs.length > 0 && (
            <div className="space-y-3">
              {recs.map((rec) => (
                <RecommendationCard
                  key={rec.id}
                  rec={rec}
                  onGenerate={onGenerate}
                  onReviewQueue={onReviewQueue}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function RecommendationCard({
  rec,
  onGenerate,
  onReviewQueue,
}: {
  rec: Recommendation
  onGenerate: (input: RecommendationGenerateInput) => void
  onReviewQueue: () => void
}) {
  const [showWhy, setShowWhy] = useState(false)
  const update = useUpdateRecommendation()

  const tier = priorityTier(rec.priorityScore)
  const type = TYPE_META[rec.type] ?? { label: rec.type, badge: 'gray' }

  function handleAction() {
    if (rec.actionType === 'generate') {
      onGenerate({
        recId: rec.id,
        topic:
          typeof rec.actionParams.topic === 'string' && rec.actionParams.topic.trim()
            ? rec.actionParams.topic
            : rec.title,
        channel:
          typeof rec.actionParams.channel === 'string' ? rec.actionParams.channel : 'linkedin',
        campaignId:
          typeof rec.actionParams.campaign_id === 'string' ? rec.actionParams.campaign_id : null,
      })
    } else {
      onReviewQueue()
    }
  }

  const actionLabel =
    rec.actionType === 'generate'
      ? 'Generate now'
      : rec.actionType === 'approve'
        ? 'Review queue'
        : 'View queue'

  return (
    <div
      className={`glass-sm border-l-2 ${tier.border} p-4 ${
        update.isPending && update.variables?.status === 'dismissed' ? 'opacity-50' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={type.badge as never}>{type.label}</Badge>
          <Badge variant={tier.badge as never}>{tier.label}</Badge>
          <span className="text-[11px] text-[#64748b]">priority {rec.priorityScore}/10</span>
        </div>
        <button
          onClick={() => update.mutate({ id: rec.id, status: 'dismissed' })}
          disabled={update.isPending}
          className="shrink-0 rounded-md p-1 text-[#64748b] transition-colors hover:bg-white/[0.06] hover:text-[#94a3b8]"
          title="Dismiss"
          aria-label="Dismiss recommendation"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <h3 className="mt-2 text-sm font-semibold text-[#f1f5f9]">{rec.title}</h3>
      <p className="mt-1 text-sm leading-relaxed text-[#94a3b8]">{rec.description}</p>

      <button
        onClick={() => setShowWhy((v) => !v)}
        className="mt-2 inline-flex items-center gap-1 text-xs text-[#64748b] transition-colors hover:text-[#94a3b8]"
      >
        <ChevronDown
          className={`h-3.5 w-3.5 transition-transform ${showWhy ? 'rotate-180' : ''}`}
        />
        Why?
      </button>
      {showWhy && (
        <p className="mt-1.5 rounded-lg border border-[#1e1e2e] bg-white/[0.02] p-2.5 text-xs leading-relaxed text-[#94a3b8]">
          {rec.reasoning}
        </p>
      )}

      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" onClick={handleAction}>
          {rec.actionType === 'generate' ? (
            <Sparkles className="h-4 w-4" />
          ) : (
            <ListChecks className="h-4 w-4" />
          )}
          {actionLabel}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => update.mutate({ id: rec.id, status: 'dismissed' })}
          disabled={update.isPending}
        >
          Dismiss
        </Button>
      </div>
    </div>
  )
}

function PanelSkeleton() {
  return (
    <div className="space-y-3">
      {[0, 1].map((i) => (
        <div key={i} className="glass-sm border-l-2 border-l-white/10 p-4">
          <div className="h-4 w-40 animate-pulse rounded bg-white/[0.06]" />
          <div className="mt-3 h-4 w-3/4 animate-pulse rounded bg-white/[0.06]" />
          <div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-white/[0.04]" />
        </div>
      ))}
    </div>
  )
}
