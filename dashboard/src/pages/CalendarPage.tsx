import { useMemo, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  Loader2,
  Send,
} from 'lucide-react'
import { useDrafts, usePublishNow } from '@/lib/queries'
import { channelMeta } from '@/lib/channels'
import { toApiError } from '@/lib/api'
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

function localDayKey(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export default function CalendarPage() {
  const today = new Date()
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

  const pad = (n: number) => n.toString().padStart(2, '0')
  const todayKey = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`

  return (
    <div className="animate-fade-in space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">Content calendar</h1>
          <p className="mt-1 text-sm text-gray-500">
            Scheduled &amp; published content across every channel
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => shift(-1)} aria-label="Previous month">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="w-40 text-center text-sm font-semibold text-gray-200">
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
        <div className="glass-sm flex items-center gap-3 border-red-500/20 p-5 text-sm text-red-300">
          <AlertTriangle className="h-5 w-5" />
          Failed to load calendar.
        </div>
      )}

      <div className="glass overflow-hidden p-4">
        <div className="grid grid-cols-7 gap-px">
          {WEEKDAYS.map((d) => (
            <div
              key={d}
              className="pb-2 text-center text-[11px] font-medium uppercase tracking-wider text-gray-600"
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
            return (
              <div
                key={i}
                className={cn(
                  'min-h-24 rounded-lg border border-white/[0.04] bg-white/[0.015] p-1.5 transition-colors',
                  isToday && 'border-cyan-500/30 bg-cyan-500/[0.04]',
                )}
              >
                <div
                  className={cn(
                    'mb-1 text-right text-xs',
                    isToday ? 'font-bold text-cyan-300' : 'text-gray-500',
                  )}
                >
                  {day}
                </div>
                {isLoading ? (
                  <Skeleton className="h-3 w-10 rounded-full" />
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {items.map((d) => {
                      const meta = channelMeta(d.channel)
                      return (
                        <button
                          key={d.id}
                          onClick={() => {
                            publishNow.reset()
                            setSelected(d)
                          }}
                          title={`${meta.label} · ${d.status}`}
                          aria-label={`${meta.label} draft`}
                          className={cn(
                            'h-3 w-3 rounded-full ring-1 ring-white/10 transition-transform hover:scale-125',
                            d.status === 'published' && 'ring-2 ring-white/30',
                          )}
                          style={{ background: meta.dotStyle }}
                        />
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

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
              <div className="border-t border-white/[0.06] pt-4">
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

function Legend() {
  const entries = [
    ['LinkedIn', '#3b82f6'],
    ['X', '#0b0b0d'],
    ['Instagram', 'linear-gradient(135deg,#a855f7,#ec4899)'],
    ['Blog', '#10b981'],
    ['Email', '#f97316'],
    ['TikTok', '#ef4444'],
  ] as const
  return (
    <div className="flex flex-wrap gap-4">
      {entries.map(([label, color]) => (
        <div key={label} className="flex items-center gap-1.5 text-xs text-gray-500">
          <span
            className="h-2.5 w-2.5 rounded-full ring-1 ring-white/10"
            style={{ background: color }}
          />
          {label}
        </div>
      ))}
    </div>
  )
}
