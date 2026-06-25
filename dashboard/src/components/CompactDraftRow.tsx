import { Check, X, Send, Clock, ExternalLink, Wrench, AlertTriangle } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { Draft } from '@/lib/types'
import { draftTitle, daysSince } from '@/lib/format'
import { translateDraftError } from '@/lib/draft-errors'
import { GuardianBadge } from './GuardianBadge'
import { ChannelIcon } from './ChannelIcon'
import { cn } from '@/lib/utils'

export interface CompactDraftRowProps {
  draft: Draft
  tab: string
  isSelected: boolean
  checked: boolean
  showCheckbox: boolean
  onSelect: (draft: Draft) => void
  onToggleCheck: (id: string) => void
  onApprove: (id: string) => void
  onDismiss: (id: string) => void
  onPublish: (id: string) => void
  /** Disable inline actions while a mutation is mid-flight. */
  busy?: boolean
}

export function CompactDraftRow({
  draft,
  tab,
  isSelected,
  checked,
  showCheckbox,
  onSelect,
  onToggleCheck,
  onApprove,
  onDismiss,
  onPublish,
  busy,
}: CompactDraftRowProps) {
  const age = daysSince(draft.createdAt)
  const aging = age > 14 && (tab === 'pending' || tab === 'approved')
  const isFailed = tab === 'failed'
  const err = isFailed ? translateDraftError(draft.failedReason) : null

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      aria-label={`Preview draft: ${draftTitle(draft)}`}
      onClick={() => onSelect(draft)}
      onKeyDown={(e) => {
        // Only handle when the row itself is focused — let nested buttons/checkbox
        // handle their own keyboard activation.
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(draft)
        }
      }}
      className={cn(
        'flex items-center gap-2.5 border-l-2 px-3 py-2.5 cursor-pointer transition-colors hover:bg-[#0f0f1a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500/40',
        isSelected
          ? 'border-l-[#7c3aed] bg-[#0f0f1a]'
          : 'border-l-transparent',
      )}
    >
      {showCheckbox && (
        <input
          type="checkbox"
          checked={checked}
          onChange={() => onToggleCheck(draft.id)}
          onClick={(e) => e.stopPropagation()}
          aria-label="Select draft"
          className="h-3.5 w-3.5 shrink-0 accent-[#7c3aed]"
        />
      )}

      <ChannelIcon channel={draft.channel} className="h-4 w-4 shrink-0" />

      {draft.campaignName && (
        <span className="hidden max-w-[110px] shrink-0 truncate rounded bg-[#1e1e2e] px-1.5 py-0.5 text-xs text-[#94a3b8] sm:inline">
          {draft.campaignName}
        </span>
      )}

      {/* Title / error lead */}
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-sm',
          isFailed ? 'text-[#fca5a5]' : 'text-[#f1f5f9]',
        )}
      >
        {isFailed ? (
          <span className="inline-flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-[#ef4444]" />
            {err!.message}
          </span>
        ) : (
          draftTitle(draft)
        )}
      </span>

      {/* Guardian score — muted on failed rows (delivery ≠ quality) */}
      {draft.guardianScore != null && (
        <span className={cn('shrink-0', isFailed && 'opacity-40 grayscale')}>
          <GuardianBadge score={draft.guardianScore} />
        </span>
      )}

      {/* Aging badge */}
      {aging && (
        <span className="hidden shrink-0 items-center gap-1 rounded bg-[#f59e0b]/20 px-1.5 py-0.5 text-xs text-[#f59e0b] md:inline-flex">
          ⚠ {age}d
        </span>
      )}

      {/* Age stamp (hidden when aging badge shows it) */}
      {!aging && (
        <span className="hidden shrink-0 text-xs text-[#64748b] sm:inline">
          {age}d ago
        </span>
      )}

      {/* Inline actions */}
      <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
        {tab === 'pending' && (
          <>
            <button
              onClick={() => onApprove(draft.id)}
              disabled={busy}
              className="rounded bg-[#10b981]/20 px-2 py-1 text-xs text-[#10b981] transition-colors hover:bg-[#10b981]/30 disabled:opacity-50"
            >
              <span className="flex items-center gap-1">
                <Check className="h-3 w-3" /> Approve
              </span>
            </button>
            <button
              onClick={() => onDismiss(draft.id)}
              disabled={busy}
              aria-label="Dismiss draft"
              className="rounded bg-[#1e1e2e] px-1.5 py-1 text-xs text-[#94a3b8] transition-colors hover:bg-[#ef4444]/20 hover:text-[#ef4444] disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </>
        )}

        {tab === 'approved' && (
          <>
            <button
              onClick={() => onPublish(draft.id)}
              disabled={busy}
              className="rounded bg-[#7c3aed] px-2 py-1 text-xs text-white transition-colors hover:bg-[#8b5cf6] disabled:opacity-50"
            >
              <span className="flex items-center gap-1">
                <Send className="h-3 w-3" /> Publish
              </span>
            </button>
            <button
              onClick={() => onSelect(draft)}
              className="rounded bg-[#1e1e2e] px-1.5 py-1 text-xs text-[#94a3b8] transition-colors hover:bg-white/[0.08] hover:text-[#f1f5f9]"
              aria-label="Schedule draft"
              title="Schedule"
            >
              <Clock className="h-3.5 w-3.5" />
            </button>
          </>
        )}

        {tab === 'published' && draft.publishedRef && (
          <a
            href={draft.publishedRef}
            target="_blank"
            rel="noreferrer noopener"
            onClick={(e) => e.stopPropagation()}
            className="rounded bg-[#1e1e2e] px-2 py-1 text-xs text-[#94a3b8] transition-colors hover:text-[#f1f5f9]"
          >
            <span className="flex items-center gap-1">
              <ExternalLink className="h-3 w-3" /> View
            </span>
          </a>
        )}

        {isFailed && (
          <>
            {err!.actionPath ? (
              <Link
                to={err!.actionPath}
                onClick={(e) => e.stopPropagation()}
                className="rounded bg-[#ef4444]/20 px-2 py-1 text-xs text-[#ef4444] transition-colors hover:bg-[#ef4444]/30"
              >
                <span className="flex items-center gap-1">
                  <Wrench className="h-3 w-3" /> Fix
                </span>
              </Link>
            ) : (
              <span className="hidden text-xs text-[#94a3b8] md:inline">{err!.action}</span>
            )}
            <button
              onClick={() => onDismiss(draft.id)}
              disabled={busy}
              aria-label="Dismiss failed draft"
              className="rounded bg-[#1e1e2e] px-1.5 py-1 text-xs text-[#94a3b8] transition-colors hover:bg-[#ef4444]/20 hover:text-[#ef4444] disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>
    </div>
  )
}
