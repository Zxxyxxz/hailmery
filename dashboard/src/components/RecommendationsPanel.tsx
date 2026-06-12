import { useState } from 'react'
import {
  Target,
  Sparkles,
  RefreshCw,
  ChevronDown,
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
}

const TYPE_META: Record<RecommendationType, { label: string; badge: string }> = {
  content_gap: { label: 'Content gap', badge: 'cyan' },
  channel_rebalance: { label: 'Rebalance', badge: 'blue' },
  trending_opportunity: { label: 'Trending', badge: 'purple' },
  queue_health: { label: 'Queue health', badge: 'amber' },
  engagement_followup: { label: 'Follow-up', badge: 'green' },
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

export function RecommendationsPanel({ onGenerate, onReviewQueue }: RecommendationsPanelProps) {
  const { data: recs, isLoading } = useRecommendations()
  const refresh = useRefreshRecommendations()

  const lastUpdated = recs && recs.length > 0 ? recs[0].createdAt : null
  const isEmpty = !isLoading && (!recs || recs.length === 0)

  return (
    <section className="glass space-y-4 p-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500/20 to-cyan-500/20">
            <Target className="h-4 w-4 text-violet-300" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-100">
              This week&rsquo;s recommendations
            </h2>
            <p className="text-xs text-gray-500">
              {lastUpdated
                ? `AI-ranked actions · updated ${formatTimeAgo(lastUpdated)}`
                : 'AI-ranked actions backed by your real performance data'}
            </p>
          </div>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => refresh.mutate()}
          disabled={refresh.isPending}
          title="Re-run the analysis (calls the AI — takes ~30-40s)"
        >
          {refresh.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {refresh.isPending ? 'Analysing…' : 'Refresh'}
        </Button>
      </header>

      {refresh.isError && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.06] p-3 text-xs text-amber-300">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {toApiError(refresh.error).error} — the analysis may still have completed; the list
          will update if it did.
        </div>
      )}

      {isLoading && <PanelSkeleton />}

      {isEmpty && !refresh.isPending && (
        <div className="flex flex-col items-center justify-center gap-3 px-6 py-10 text-center">
          <Sparkles className="h-7 w-7 text-violet-300/70" />
          <p className="max-w-sm text-sm text-gray-400">
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
        <div className="flex items-center justify-center gap-3 px-6 py-10 text-sm text-violet-300">
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
          <span className="text-[11px] text-gray-600">priority {rec.priorityScore}/10</span>
        </div>
        <button
          onClick={() => update.mutate({ id: rec.id, status: 'dismissed' })}
          disabled={update.isPending}
          className="shrink-0 rounded-md p-1 text-gray-600 transition-colors hover:bg-white/[0.06] hover:text-gray-300"
          title="Dismiss"
          aria-label="Dismiss recommendation"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <h3 className="mt-2 text-sm font-semibold text-gray-100">{rec.title}</h3>
      <p className="mt-1 text-sm leading-relaxed text-gray-400">{rec.description}</p>

      <button
        onClick={() => setShowWhy((v) => !v)}
        className="mt-2 inline-flex items-center gap-1 text-xs text-gray-500 transition-colors hover:text-gray-300"
      >
        <ChevronDown
          className={`h-3.5 w-3.5 transition-transform ${showWhy ? 'rotate-180' : ''}`}
        />
        Why?
      </button>
      {showWhy && (
        <p className="mt-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 text-xs leading-relaxed text-gray-400">
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
