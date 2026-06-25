import { Link } from 'react-router-dom'
import {
  ShieldCheck,
  ShieldX,
  RefreshCw,
  Loader2,
  Check,
  AlertTriangle,
  TrendingUp,
  Mic,
  Users,
  FileCheck,
  Settings2,
  ArrowRight,
  type LucideIcon,
} from 'lucide-react'
import type {
  GuardianBreakdown,
  AudienceFitResult,
  BrandVoiceResult,
  FactualResult,
  PerformancePredictionResult,
  PlatformRulesResult,
} from '@/lib/types'
import { Button } from '@/components/ui/button'
import { useRecheckDraft } from '@/lib/queries'
import type { ToastState } from '@/components/ui/toast'
import { toApiError } from '@/lib/api'
import { cn } from '@/lib/utils'

/** Forgiving tone for advisory 0..1 scores: ≥0.9 strong, ≥0.7 acceptable, else weak.
 *  (Distinct from the card's stricter GuardianBadge tier, which is tuned for the
 *  factual-only legacy score.) */
function scoreTone(score: number): 'green' | 'amber' | 'red' {
  if (score >= 0.9) return 'green'
  if (score >= 0.7) return 'amber'
  return 'red'
}

const TONE_TEXT: Record<'green' | 'amber' | 'red', string> = {
  green: 'text-emerald-300',
  amber: 'text-amber-300',
  red: 'text-red-300',
}

/** One dimension row: icon + label on the left, status on the right, optional
 *  detail lines underneath. */
function Row({
  icon: Icon,
  label,
  status,
  statusTone = 'text-gray-300',
  children,
}: {
  icon: LucideIcon
  label: string
  status: string
  statusTone?: string
  children?: React.ReactNode
}) {
  return (
    <div className="border-t border-[#1e1e2e] pt-2.5 first:border-t-0 first:pt-0">
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 shrink-0 text-[#94a3b8]" />
        <span className="font-medium text-gray-300">{label}</span>
        <span className={cn('ml-auto font-semibold tabular-nums', statusTone)}>{status}</span>
      </div>
      {children && <div className="mt-1.5 space-y-1 pl-5">{children}</div>}
    </div>
  )
}

function Detail({ tone = 'gray', children }: { tone?: 'gray' | 'amber' | 'red' | 'green'; children: React.ReactNode }) {
  const cls =
    tone === 'red'
      ? 'text-red-300/90'
      : tone === 'amber'
        ? 'text-amber-300/90'
        : tone === 'green'
          ? 'text-emerald-300/90'
          : 'text-[#94a3b8]'
  return <p className={cn('flex items-start gap-1.5 leading-relaxed', cls)}>{children}</p>
}

function PlatformRow({ r }: { r: PlatformRulesResult }) {
  return (
    <Row
      icon={r.passed ? ShieldCheck : ShieldX}
      label="Platform Rules"
      status={r.passed ? 'PASS' : 'FAIL'}
      statusTone={r.passed ? 'text-emerald-300' : 'text-red-300'}
    >
      {r.flags.length === 0 && <Detail tone="gray">All channel rules satisfied.</Detail>}
      {r.flags.map((f, i) => (
        <Detail key={i} tone={f.severity === 'blocking' ? 'red' : 'amber'}>
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>{f.message}</span>
        </Detail>
      ))}
    </Row>
  )
}

function FactualRow({ r }: { r: FactualResult }) {
  if (r.skipped) {
    return <Row icon={FileCheck} label="Factual" status="—" statusTone="text-[#94a3b8]"><Detail>{r.skipReason}</Detail></Row>
  }
  const tone = scoreTone(r.score)
  return (
    <Row icon={FileCheck} label="Factual" status={r.score.toFixed(2)} statusTone={TONE_TEXT[tone]}>
      {r.flags.length === 0 && <Detail tone="green"><Check className="mt-0.5 h-3 w-3 shrink-0" /><span>All claims supported by the corpus.</span></Detail>}
      {r.flags.map((f, i) => (
        <Detail key={i} tone="red">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span><span className="font-medium">{f.claim}</span> — {f.issue}</span>
        </Detail>
      ))}
      {r.limitedData && <Detail tone="amber">Limited corpus — lower confidence.</Detail>}
    </Row>
  )
}

function BrandVoiceRow({ r }: { r: BrandVoiceResult }) {
  if (r.skipped) {
    return <Row icon={Mic} label="Brand Voice" status="—" statusTone="text-[#94a3b8]"><Detail>{r.skipReason}</Detail></Row>
  }
  const tone = scoreTone(r.score)
  return (
    <Row icon={Mic} label="Brand Voice" status={r.score.toFixed(2)} statusTone={TONE_TEXT[tone]}>
      {r.flags.length === 0 && <Detail tone="green"><Check className="mt-0.5 h-3 w-3 shrink-0" /><span>On-voice.</span></Detail>}
      {r.flags.map((f, i) => (
        <Detail key={i} tone="amber">
          <span>{f.issue}{f.suggestion ? <> → <span className="text-gray-300">{f.suggestion}</span></> : null}</span>
        </Detail>
      ))}
      {r.limitedData && <Detail tone="amber">Limited brand-voice context — lower confidence.</Detail>}
    </Row>
  )
}

function AudienceRow({ r }: { r: AudienceFitResult }) {
  if (r.notApplicable) {
    return <Row icon={Users} label="Audience Fit" status="N/A" statusTone="text-[#94a3b8]"><Detail>Not applicable for this channel.</Detail></Row>
  }
  if (r.skipped) {
    return <Row icon={Users} label="Audience Fit" status="—" statusTone="text-[#94a3b8]"><Detail>{r.skipReason}</Detail></Row>
  }
  const tone = scoreTone(r.score)
  return (
    <Row icon={Users} label="Audience Fit" status={r.score.toFixed(2)} statusTone={TONE_TEXT[tone]}>
      {r.personaMatch && <Detail tone="gray"><span className="text-[#94a3b8]">Best for:</span>&nbsp;{r.personaMatch}</Detail>}
      {r.flags.map((f, i) => (
        <Detail key={i} tone="amber">
          <span>{f.issue}{f.suggestion ? <> → <span className="text-gray-300">{f.suggestion}</span></> : null}</span>
        </Detail>
      ))}
      {r.limitedData && <Detail tone="amber">Audience inferred from the campaign brief only.</Detail>}
    </Row>
  )
}

function PerformanceRow({ r }: { r: PerformancePredictionResult }) {
  if (r.skipped) {
    return <Row icon={TrendingUp} label="Performance" status="—" statusTone="text-[#94a3b8]"><Detail>{r.skipReason}</Detail></Row>
  }
  const tone = r.predictedScore >= 1.2 ? 'green' : r.predictedScore >= 0.8 ? 'amber' : 'red'
  return (
    <Row icon={TrendingUp} label="Performance" status={`${r.predictedScore.toFixed(1)}x`} statusTone={TONE_TEXT[tone]}>
      {r.signals.map((s, i) => (
        <Detail key={i} tone={s.type === 'positive' ? 'green' : 'amber'}>
          {s.type === 'positive' ? <Check className="mt-0.5 h-3 w-3 shrink-0" /> : <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />}
          <span>{s.message}</span>
        </Detail>
      ))}
      <Detail tone="gray">Based on {r.examplesUsed} top {r.examplesUsed === 1 ? 'performer' : 'performers'}.</Detail>
    </Row>
  )
}

export function GuardianBreakdownPanel({
  draftId,
  breakdown,
  onToast,
}: {
  draftId: string
  breakdown: GuardianBreakdown
  onToast?: (t: ToastState) => void
}) {
  const recheck = useRecheckDraft()

  function handleRecheck() {
    recheck.mutate(draftId, {
      onSuccess: () => onToast?.({ message: 'Guardians re-checked', variant: 'success' }),
      onError: (e) => onToast?.({ message: toApiError(e).error, variant: 'error' }),
    })
  }

  const overallTone = scoreTone(breakdown.overall)

  return (
    <div className="mt-4 rounded-xl border border-[#1e1e2e] bg-white/[0.02] p-4 text-xs">
      <div className="flex items-center gap-2">
        <span className="font-medium text-gray-300">Guardian breakdown</span>
        <span className={cn('font-semibold tabular-nums', TONE_TEXT[overallTone])}>
          {breakdown.overall.toFixed(2)}
        </span>
        {breakdown.blocking && (
          <span className="inline-flex items-center gap-1 rounded-md bg-red-500/15 px-1.5 py-0.5 font-medium text-red-300">
            <ShieldX className="h-3 w-3" /> Blocked
          </span>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto h-7 text-[#94a3b8] hover:text-gray-200"
          onClick={handleRecheck}
          disabled={recheck.isPending}
        >
          {recheck.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Re-check
        </Button>
      </div>

      {breakdown.blocking && (
        <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/[0.06] p-2.5 text-red-300">
          This draft cannot be published until the blocking issue{breakdown.platformRules.flags.filter((f) => f.severity === 'blocking').length === 1 ? ' is' : 's are'} fixed:
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {breakdown.platformRules.flags
              .filter((f) => f.severity === 'blocking')
              .map((f, i) => (
                <li key={i}>{f.message}</li>
              ))}
          </ul>
        </div>
      )}

      <div className="mt-3 space-y-2.5">
        <PlatformRow r={breakdown.platformRules} />
        <BrandVoiceRow r={breakdown.brandVoice} />
        <AudienceRow r={breakdown.audienceFit} />
        <PerformanceRow r={breakdown.performancePrediction} />
        <FactualRow r={breakdown.factual} />
      </div>

      {breakdown.missingContext.length > 0 && (
        <div className="mt-3 border-t border-[#1e1e2e] pt-3">
          <div className="flex items-center gap-1.5 font-medium text-[#94a3b8]">
            <Settings2 className="h-3.5 w-3.5" /> Set up to unlock more
          </div>
          <div className="mt-1.5 space-y-1">
            {breakdown.missingContext.map((m, i) => (
              <div key={i} className="flex items-start gap-1.5 text-[#94a3b8]">
                <ArrowRight className="mt-0.5 h-3 w-3 shrink-0 text-[#64748b]" />
                {m.actionUrl ? (
                  <Link to={m.actionUrl} className="text-violet-400 hover:text-violet-300">
                    {m.action}
                  </Link>
                ) : (
                  <span>{m.action}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
