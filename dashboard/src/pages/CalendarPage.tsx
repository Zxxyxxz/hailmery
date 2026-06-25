import { useMemo, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  Loader2,
  Send,
  Check,
} from 'lucide-react'
import { useDrafts, usePublishNow } from '@/lib/queries'
import { channelMeta } from '@/lib/channels'
import { toApiError } from '@/lib/api'
import { draftTitle, formatPublishAt } from '@/lib/format'
import { useIsMobile } from '@/lib/use-media-query'
import type { Draft } from '@/lib/types'
import { DraftCard } from '@/components/DraftCard'
import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const CHIP_TITLE_MAX = 18

// ── Calendar-only channel chip styling ───────────────────────────────
// Deliberately local (NOT channels.ts) so we can fix the dot-color
// collisions on the calendar without touching the shared channel meta:
//   • LinkedIn (#3b82f6) and Facebook (#2563eb) were both blue
//   • X (#0b0b0d) was near-black → invisible on the #000 page bg
// Aliases (x↔twitter, blog↔wix-blog, email↔sendgrid) resolve to one entry.
interface ChipStyle {
  /** bg + text utility classes for the chip */
  className: string
  /** short glyph rendered before the title */
  glyph: string
}

const CHANNEL_ALIASES: Record<string, string> = {
  x: 'twitter',
  twitter: 'twitter',
  'wix-blog': 'blog',
  blog: 'blog',
  sendgrid: 'email',
  email: 'email',
}

const CHIP_STYLES: Record<string, ChipStyle> = {
  linkedin: { className: 'bg-[#7c3aed]/20 text-[#a78bfa]', glyph: 'in' },
  twitter: { className: 'bg-[#1e1e2e] text-[#94a3b8]', glyph: '𝕏' },
  email: { className: 'bg-[#f59e0b]/20 text-[#fbbf24]', glyph: '✉' },
  blog: { className: 'bg-[#10b981]/20 text-[#34d399]', glyph: '✎' },
  facebook: { className: 'bg-blue-900/30 text-blue-400', glyph: 'f' },
  instagram: { className: 'bg-pink-900/30 text-pink-400', glyph: '◎' },
}

const CHIP_FALLBACK: ChipStyle = { className: 'bg-[#1e1e2e] text-[#94a3b8]', glyph: '•' }

function chipStyle(channel: string): ChipStyle {
  const canonical = CHANNEL_ALIASES[channel] ?? channel
  return CHIP_STYLES[canonical] ?? CHIP_FALLBACK
}

function chipLabel(draft: Draft): string {
  const title = draftTitle(draft).trim()
  return title.length > CHIP_TITLE_MAX ? `${title.slice(0, CHIP_TITLE_MAX)}…` : title
}

function localDayKey(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// ── Event chip ───────────────────────────────────────────────────────
// Shared by the desktop grid and the mobile agenda so colours/labels can
// never drift between the two views.
function EventChip({ draft, onClick }: { draft: Draft; onClick: () => void }) {
  const style = chipStyle(draft.channel)
  const meta = channelMeta(draft.channel)
  const published = draft.status === 'published'
  return (
    <button
      onClick={onClick}
      title={`${meta.label} · ${draft.status}`}
      aria-label={`${meta.label} draft: ${draftTitle(draft)} (${draft.status})`}
      className={cn(
        'flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-xs transition-opacity hover:opacity-80',
        style.className,
      )}
    >
      <span aria-hidden className="shrink-0 font-semibold">{style.glyph}</span>
      <span className="truncate">{chipLabel(draft)}</span>
      {published && (
        <Check aria-hidden className="ml-auto h-2.5 w-2.5 shrink-0 opacity-80" />
      )}
    </button>
  )
}

export default function CalendarPage() {
  const today = new Date()
  const isMobile = useIsMobile()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth()) // 0-11
  const [selected, setSelected] = useState<Draft | null>(null)
  const publishNow = usePublishNow()

  const monthParam = `${year}-${(month + 1).toString().padStart(2, '0')}`
  const { data: drafts, isLoading, isError } = useDrafts({ month: monthParam })

  const byDay = useMemo(() => {
    const map = new Map<string, Draft[]>()
    for (const d of drafts ?? []) {
      if (!d.publishAt) continue
      const key = localDayKey(d.publishAt)
      const arr = map.get(key) ?? []
      arr.push(d)
      map.set(key, arr)
    }
    return map
  }, [drafts])

  const cells = useMemo(() => {
    const firstWeekday = new Date(year, month, 1).getDay()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const out: (number | null)[] = []
    for (let i = 0; i < firstWeekday; i++) out.push(null)
    for (let d = 1; d <= daysInMonth; d++) out.push(d)
    while (out.length % 7 !== 0) out.push(null)
    return out
  }, [year, month])

  // Sorted day groups for the mobile agenda (ascending date, events sorted
  // by publish time within each day).
  const agendaDays = useMemo(() => {
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const out: { day: number; key: string; items: Draft[] }[] = []
    for (let day = 1; day <= daysInMonth; day++) {
      const key = `${year}-${pad(month + 1)}-${pad(day)}`
      const items = byDay.get(key)
      if (!items || items.length === 0) continue
      const sorted = [...items].sort((a, b) =>
        (a.publishAt ?? '').localeCompare(b.publishAt ?? ''),
      )
      out.push({ day, key, items: sorted })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byDay, year, month])

  function shift(delta: number) {
    let m = month + delta
    let y = year
    if (m < 0) { m = 11; y -= 1 }
    if (m > 11) { m = 0; y += 1 }
    setMonth(m)
    setYear(y)
  }

  function goToday() {
    setYear(today.getFullYear())
    setMonth(today.getMonth())
  }

  function openDraft(d: Draft) {
    publishNow.reset()
    setSelected(d)
  }

  const todayKey = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`
  const weekdayName = (key: string) => {
    const [y, m, d] = key.split('-').map(Number)
    return WEEKDAYS[new Date(y, m - 1, d).getDay()]
  }

  return (
    <div className="animate-fade-in space-y-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[#f1f5f9]">Content calendar</h1>
          <p className="mt-1 text-xs text-[#64748b]">
            Scheduled &amp; published content across every channel
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => shift(-1)} aria-label="Previous month">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="w-32 text-center text-sm font-semibold text-[#f1f5f9] sm:w-40">
            {MONTHS[month]} {year}
          </div>
          <Button variant="ghost" size="icon" onClick={() => shift(1)} aria-label="Next month">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="secondary" size="sm" onClick={goToday}>
            Today
          </Button>
        </div>
      </header>

      {isError && (
        <div className="glass-sm flex items-center gap-3 rounded-lg border border-red-500/20 p-5 text-sm text-red-300">
          <AlertTriangle className="h-5 w-5" />
          Failed to load calendar.
        </div>
      )}

      {isMobile ? (
        // ── Mobile agenda / list view ──────────────────────────────────
        <div className="rounded-lg border border-[#1e1e2e] bg-[#0a0a0f] p-3">
          {isLoading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="space-y-1.5">
                  <Skeleton className="h-3 w-24 rounded" />
                  <Skeleton className="h-6 w-full rounded" />
                </div>
              ))}
            </div>
          ) : agendaDays.length === 0 ? (
            <p className="py-8 text-center text-xs text-[#64748b]">
              No scheduled or published content this month.
            </p>
          ) : (
            <div className="space-y-4">
              {agendaDays.map(({ day, key, items }) => {
                const isToday = key === todayKey
                return (
                  <div key={key}>
                    <div className="mb-1.5 flex items-baseline gap-2">
                      <span
                        className={cn(
                          'text-sm font-semibold',
                          isToday ? 'text-[#a78bfa]' : 'text-[#f1f5f9]',
                        )}
                      >
                        {weekdayName(key)} {day}
                      </span>
                      {isToday && (
                        <span className="text-[10px] font-medium uppercase tracking-wider text-[#a78bfa]">
                          Today
                        </span>
                      )}
                      <span className="text-xs text-[#64748b]">
                        {items.length} {items.length === 1 ? 'item' : 'items'}
                      </span>
                    </div>
                    <div className="space-y-1">
                      {items.map((d) => (
                        <div key={d.id} className="flex items-center gap-2">
                          <span className="w-16 shrink-0 text-[11px] tabular-nums text-[#64748b]">
                            {d.publishAt
                              ? formatPublishAt(d.publishAt).replace(/^\S+ /, '')
                              : '—'}
                          </span>
                          <div className="min-w-0 flex-1">
                            <EventChip draft={d} onClick={() => openDraft(d)} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ) : (
        // ── Desktop month grid ─────────────────────────────────────────
        <div className="overflow-hidden rounded-lg border border-[#1e1e2e] bg-[#0a0a0f] p-4">
          <div className="grid grid-cols-7 gap-px">
            {WEEKDAYS.map((d) => (
              <div
                key={d}
                className="pb-2 text-center text-[11px] font-medium uppercase tracking-wider text-[#64748b]"
              >
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1.5">
            {cells.map((day, i) => {
              if (day == null) return <div key={i} className="min-h-24 rounded-lg" />
              const key = `${year}-${pad(month + 1)}-${pad(day)}`
              const items = byDay.get(key) ?? []
              const isToday = key === todayKey
              const visible = items.slice(0, 3)
              const overflow = items.length - visible.length
              return (
                <div
                  key={i}
                  className={cn(
                    'min-h-24 rounded-lg border border-[#1e1e2e] bg-[#0f0f1a] p-1.5 transition-colors',
                    isToday && 'border-[#7c3aed]/40 bg-[#7c3aed]/[0.06]',
                  )}
                >
                  <div
                    className={cn(
                      'mb-1 text-right text-xs',
                      isToday ? 'font-bold text-[#a78bfa]' : 'text-[#64748b]',
                    )}
                  >
                    {day}
                  </div>
                  {isLoading ? (
                    <Skeleton className="h-4 w-full rounded" />
                  ) : (
                    <div className="space-y-0.5">
                      {visible.map((d) => (
                        <EventChip key={d.id} draft={d} onClick={() => openDraft(d)} />
                      ))}
                      {overflow > 0 && (
                        <div className="px-1 text-xs text-[#64748b]">+{overflow} more</div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      <Legend />

      <Sheet
        open={!!selected}
        onClose={() => setSelected(null)}
        title="Content detail"
      >
        {selected && (
          <div className="space-y-4">
            <DraftCard draft={selected} readOnly />
            {selected.status === 'approved' && (
              <div className="border-t border-[#1e1e2e] pt-4">
                <Button
                  variant="purple"
                  className="w-full"
                  disabled={publishNow.isPending}
                  onClick={() =>
                    publishNow.mutate(selected.id, {
                      onSuccess: () => setSelected(null),
                    })
                  }
                >
                  {publishNow.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  Publish now
                </Button>
                {publishNow.isError && (
                  <p className="mt-2 text-xs text-red-400">
                    {toApiError(publishNow.error).error}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </Sheet>
    </div>
  )
}

const pad = (n: number) => n.toString().padStart(2, '0')

// One legend entry per distinct chip colour (aliases collapsed) so the legend
// always matches the chips actually rendered on the calendar.
const LEGEND_ENTRIES: { channel: string; label: string }[] = [
  { channel: 'linkedin', label: 'LinkedIn' },
  { channel: 'twitter', label: 'X' },
  { channel: 'email', label: 'Email' },
  { channel: 'blog', label: 'Blog' },
  { channel: 'facebook', label: 'Facebook' },
  { channel: 'instagram', label: 'Instagram' },
]

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-[#94a3b8]">
      {LEGEND_ENTRIES.map(({ channel, label }) => {
        const style = chipStyle(channel)
        return (
          <span
            key={channel}
            className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5', style.className)}
          >
            <span aria-hidden className="font-semibold">{style.glyph}</span>
            {label}
          </span>
        )
      })}
      <span className="inline-flex items-center gap-1 text-[#64748b]">
        <Check aria-hidden className="h-3 w-3" />
        Published
      </span>
    </div>
  )
}
