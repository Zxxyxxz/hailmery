import { useState } from 'react'
import {
  Check,
  Pencil,
  X,
  Clock,
  ChevronDown,
  ChevronUp,
  Loader2,
  Save,
  Send,
  AlertTriangle,
} from 'lucide-react'
import type { Draft } from '@/lib/types'
import { channelMeta } from '@/lib/channels'
import {
  draftTitle,
  formatPublishAt,
  formatTimeAgo,
  fromDatetimeLocal,
  toDatetimeLocal,
} from '@/lib/format'
import { usePatchDraft, usePublishNow } from '@/lib/queries'
import { toApiError } from '@/lib/api'
import { ChannelIcon } from './ChannelIcon'
import { GuardianBadge } from './GuardianBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Popover } from '@/components/ui/popover'
import { Dialog } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

const DISMISS_REASONS = [
  'Off-brand',
  'Factually wrong',
  'Hallucinated name',
  'Too generic',
  'Off-topic',
  'Other',
] as const

const BLOG_PREVIEW_CHARS = 200

export function DraftCard({
  draft,
  readOnly = false,
}: {
  draft: Draft
  readOnly?: boolean
}) {
  const meta = channelMeta(draft.channel)
  const patch = usePatchDraft()
  const publishNow = usePublishNow()
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [exiting, setExiting] = useState(false)

  // editable buffers
  const [text, setText] = useState(draft.payload.text ?? '')
  const [title, setTitle] = useState(draft.payload.title ?? '')
  const [body, setBody] = useState(draft.payload.body ?? '')
  const [subject, setSubject] = useState(draft.payload.subject ?? '')
  const [previewText, setPreviewText] = useState(draft.payload.previewText ?? '')

  // dismiss state
  const [reason, setReason] = useState<string>(DISMISS_REASONS[0])
  const [reasonOther, setReasonOther] = useState('')

  const [scheduleAt, setScheduleAt] = useState(toDatetimeLocal(draft.publishAt))
  const [lightbox, setLightbox] = useState(false)

  const imageUrl = draft.assets.imageUrl

  function animateOut() {
    setExiting(true)
  }

  function handleApprove(close: () => void) {
    patch.mutate(
      {
        id: draft.id,
        patch: { status: 'approved', publishAt: fromDatetimeLocal(scheduleAt) },
      },
      { onSuccess: () => { close(); animateOut() } },
    )
  }

  function handleDismiss(close: () => void) {
    const value = reason === 'Other' ? reasonOther.trim() || 'Other' : reason
    patch.mutate(
      { id: draft.id, patch: { status: 'dismissed', dismissReason: value } },
      { onSuccess: () => { close(); animateOut() } },
    )
  }

  function handleSaveEdit() {
    const payload =
      meta.kind === 'social'
        ? { text }
        : meta.kind === 'email'
          ? { subject, previewText, body }
          : { title, body }
    patch.mutate(
      { id: draft.id, patch: { payload, rerunGuardian: true } },
      { onSuccess: () => setEditing(false) },
    )
  }

  function handleSaveSchedule(close: () => void) {
    patch.mutate(
      { id: draft.id, patch: { publishAt: fromDatetimeLocal(scheduleAt) } },
      { onSuccess: () => close() },
    )
  }

  const charCount = text.length
  const overLimit = meta.charLimit > 0 && charCount > meta.charLimit

  // "Schedule" vs "Publish now": treat anything more than 5 minutes out as a
  // future schedule; within 5 minutes or in the past it's an immediate publish.
  const isScheduledFuture =
    !!draft.publishAt &&
    new Date(draft.publishAt).getTime() - Date.now() > 5 * 60 * 1000

  return (
    <div
      className={cn(
        'glass relative overflow-hidden p-5',
        // An open Popover panel renders below the action row, outside the
        // card's box. `overflow-hidden` was clipping it to nothing, and the
        // card's backdrop-filter stacking context let the *next* card paint
        // over it — so the Dismiss/Approve popovers never appeared. When a
        // panel is mounted, let it overflow and lift the card above siblings.
        'has-[[data-popover-panel]]:z-30 has-[[data-popover-panel]]:overflow-visible',
        exiting && 'animate-card-exit',
      )}
    >
      {/* Top row */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-sm font-medium text-gray-200">
          <ChannelIcon channel={draft.channel} />
          {meta.label}
        </span>
        {draft.campaignName && (
          <Badge variant="cyan">{draft.campaignName}</Badge>
        )}
        {draft.pillar && <Badge variant="gray">{draft.pillar}</Badge>}
        {draft.status === 'failed' && <Badge variant="red">Failed</Badge>}
        {(draft.status === 'published' || draft.status === 'measured') && (
          <Badge variant="green">Published</Badge>
        )}
        <div className="ml-auto">
          <GuardianBadge score={draft.guardianScore} />
        </div>
      </div>

      {/* Failure reason — surfaced on the card so the operator can act on it */}
      {draft.status === 'failed' && draft.failedReason && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/[0.06] p-3 text-xs text-red-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="break-words">{draft.failedReason}</span>
        </div>
      )}

      {/* Content preview */}
      <div className="mt-4 flex gap-4">
        {imageUrl && (
          <button
            onClick={() => setLightbox(true)}
            className="shrink-0 overflow-hidden rounded-xl border border-white/[0.08]"
            style={{ width: 120, height: 120 }}
          >
            <img
              src={imageUrl}
              alt=""
              className="h-full w-full object-cover transition-transform hover:scale-105"
            />
          </button>
        )}

        <div className="min-w-0 flex-1">
          {editing ? (
            <EditFields
              kind={meta.kind}
              text={text}
              setText={setText}
              title={title}
              setTitle={setTitle}
              body={body}
              setBody={setBody}
              subject={subject}
              setSubject={setSubject}
              previewText={previewText}
              setPreviewText={setPreviewText}
              charCount={charCount}
              charLimit={meta.charLimit}
              overLimit={overLimit}
            />
          ) : (
            <PreviewBody draft={draft} expanded={expanded} setExpanded={setExpanded} />
          )}
        </div>
      </div>

      {/* Scheduled time */}
      <div className="mt-4 flex items-center gap-2 text-sm text-gray-400">
        <Clock className="h-4 w-4 text-gray-500" />
        <span>{formatPublishAt(draft.publishAt)}</span>
        {!readOnly && (
          <Popover
            align="start"
            className="w-72"
            trigger={
              <button
                className="rounded-md p-1 text-gray-500 transition-colors hover:bg-white/[0.06] hover:text-gray-300"
                aria-label="Edit schedule"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            }
          >
            {({ close }) => (
              <div className="space-y-3">
                <div className="text-xs font-medium text-gray-400">
                  Reschedule
                </div>
                <Input
                  type="datetime-local"
                  value={scheduleAt}
                  onChange={(e) => setScheduleAt(e.target.value)}
                />
                <Button
                  size="sm"
                  className="w-full"
                  disabled={patch.isPending}
                  onClick={() => handleSaveSchedule(close)}
                >
                  Save time
                </Button>
              </div>
            )}
          </Popover>
        )}
        {/* Subtle "generated N ago" stamp, right-aligned on the clock row. */}
        <span className="ml-auto text-xs text-gray-400 opacity-50">
          Generated {formatTimeAgo(draft.createdAt)}
        </span>
      </div>

      {/* Actions */}
      {!readOnly && (
        <div className="mt-5 flex items-center gap-2 border-t border-white/[0.06] pt-4">
          {editing ? (
            <>
              <Button
                variant="info"
                size="sm"
                onClick={handleSaveEdit}
                disabled={patch.isPending || overLimit}
              >
                {patch.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save & re-check
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditing(false)}
              >
                Cancel
              </Button>
            </>
          ) : draft.status === 'pending_review' ? (
            <>
              <Popover
                align="start"
                className="w-72"
                trigger={
                  <Button variant="success" size="sm">
                    <Check className="h-4 w-4" />
                    Approve
                  </Button>
                }
              >
                {({ close }) => (
                  <div className="space-y-3">
                    <div className="text-xs font-medium text-gray-400">
                      Publish at
                    </div>
                    <Input
                      type="datetime-local"
                      value={scheduleAt}
                      onChange={(e) => setScheduleAt(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <Button
                        variant="success"
                        size="sm"
                        className="flex-1"
                        disabled={patch.isPending}
                        onClick={() => handleApprove(close)}
                      >
                        {patch.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Check className="h-4 w-4" />
                        )}
                        Confirm
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="flex-1"
                        disabled={patch.isPending}
                        onClick={close}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </Popover>

              <Button
                variant="info"
                size="sm"
                onClick={() => setEditing(true)}
              >
                <Pencil className="h-4 w-4" />
                Edit
              </Button>

              <Popover
                align="start"
                className="w-72"
                trigger={
                  <Button variant="danger" size="sm">
                    <X className="h-4 w-4" />
                    Dismiss
                  </Button>
                }
              >
                {({ close }) => (
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-gray-400">
                      Why dismiss this draft?
                    </div>
                    <div className="space-y-1">
                      {DISMISS_REASONS.map((r) => (
                        <button
                          key={r}
                          onClick={() => setReason(r)}
                          className={cn(
                            'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors',
                            reason === r
                              ? 'bg-red-500/15 text-red-300'
                              : 'text-gray-400 hover:bg-white/[0.05]',
                          )}
                        >
                          <span
                            className={cn(
                              'h-2 w-2 rounded-full',
                              reason === r ? 'bg-red-400' : 'bg-white/20',
                            )}
                          />
                          {r}
                        </button>
                      ))}
                    </div>
                    {reason === 'Other' && (
                      <Input
                        autoFocus
                        placeholder="Describe the reason…"
                        value={reasonOther}
                        onChange={(e) => setReasonOther(e.target.value)}
                      />
                    )}
                    <Button
                      variant="danger"
                      size="sm"
                      className="w-full"
                      disabled={patch.isPending}
                      onClick={() => handleDismiss(close)}
                    >
                      Confirm dismiss
                    </Button>
                  </div>
                )}
              </Popover>
            </>
          ) : draft.status === 'approved' ? (
            <div className="flex items-center gap-3">
              <Button
                // A draft scheduled comfortably in the future shows a purple
                // "Schedule" button (the cron will publish it at publish_at);
                // one that's due now/soon or already past shows a green
                // "Publish now". Avoids an operator reading "Publish now" on a
                // post that isn't actually going out yet.
                variant={isScheduledFuture ? 'purple' : 'success'}
                size="sm"
                onClick={() => publishNow.mutate(draft.id)}
                disabled={publishNow.isPending}
              >
                {publishNow.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : isScheduledFuture ? (
                  <Clock className="h-4 w-4" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                {isScheduledFuture ? 'Schedule' : 'Publish now'}
              </Button>
              {publishNow.isError && (
                <span className="text-xs text-red-400">
                  {toApiError(publishNow.error).error}
                </span>
              )}
            </div>
          ) : null}
        </div>
      )}

      {imageUrl && (
        <Dialog open={lightbox} onClose={() => setLightbox(false)} className="max-w-2xl">
          <div className="p-2">
            <img src={imageUrl} alt="" className="w-full rounded-xl" />
          </div>
        </Dialog>
      )}
    </div>
  )
}

function PreviewBody({
  draft,
  expanded,
  setExpanded,
}: {
  draft: Draft
  expanded: boolean
  setExpanded: (v: boolean) => void
}) {
  const meta = channelMeta(draft.channel)

  if (meta.kind === 'blog') {
    const body = draft.payload.body ?? draft.payload.excerpt ?? ''
    const preview = body.slice(0, BLOG_PREVIEW_CHARS)
    return (
      <div>
        <h3 className="text-base font-semibold text-gray-100">
          {draftTitle(draft)}
        </h3>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-gray-400">
          {expanded ? body : preview}
          {!expanded && body.length > BLOG_PREVIEW_CHARS && '…'}
        </p>
        {body.length > BLOG_PREVIEW_CHARS && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-cyan-400 hover:text-cyan-300"
          >
            {expanded ? (
              <>
                <ChevronUp className="h-3.5 w-3.5" /> Collapse
              </>
            ) : (
              <>
                <ChevronDown className="h-3.5 w-3.5" /> Expand
              </>
            )}
          </button>
        )}
      </div>
    )
  }

  if (meta.kind === 'email') {
    return (
      <div>
        <div className="text-[11px] uppercase tracking-wide text-gray-600">
          Subject
        </div>
        <h3 className="text-base font-semibold text-gray-100">
          {draft.payload.subject ?? '(no subject)'}
        </h3>
        {draft.payload.previewText && (
          <p className="mt-1 text-sm text-gray-400">
            {draft.payload.previewText}
          </p>
        )}
      </div>
    )
  }

  // social — full text
  return (
    <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-300">
      {draft.payload.text}
    </p>
  )
}

function EditFields(props: {
  kind: 'social' | 'blog' | 'email'
  text: string
  setText: (v: string) => void
  title: string
  setTitle: (v: string) => void
  body: string
  setBody: (v: string) => void
  subject: string
  setSubject: (v: string) => void
  previewText: string
  setPreviewText: (v: string) => void
  charCount: number
  charLimit: number
  overLimit: boolean
}) {
  if (props.kind === 'social') {
    return (
      <div>
        <Textarea
          rows={6}
          value={props.text}
          onChange={(e) => props.setText(e.target.value)}
        />
        {props.charLimit > 0 && (
          <div
            className={cn(
              'mt-1 text-right text-xs',
              props.overLimit ? 'text-red-400' : 'text-gray-500',
            )}
          >
            {props.charCount}/{props.charLimit}
          </div>
        )}
      </div>
    )
  }
  if (props.kind === 'email') {
    return (
      <div className="space-y-2">
        <Input
          placeholder="Subject"
          value={props.subject}
          onChange={(e) => props.setSubject(e.target.value)}
        />
        <Input
          placeholder="Preview text"
          value={props.previewText}
          onChange={(e) => props.setPreviewText(e.target.value)}
        />
        <Textarea
          rows={8}
          value={props.body}
          onChange={(e) => props.setBody(e.target.value)}
        />
      </div>
    )
  }
  return (
    <div className="space-y-2">
      <Input
        placeholder="Title"
        value={props.title}
        onChange={(e) => props.setTitle(e.target.value)}
      />
      <Textarea
        rows={12}
        value={props.body}
        onChange={(e) => props.setBody(e.target.value)}
      />
    </div>
  )
}
