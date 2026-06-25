import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { BarChart3, TrendingUp, Search } from 'lucide-react'
import {
  useAnalyticsSummary,
  useKeywords,
  useTopContent,
} from '@/lib/queries'
import { channelMeta } from '@/lib/channels'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select } from '@/components/ui/select'
import { ChannelIcon } from '@/components/ChannelIcon'
import { cn } from '@/lib/utils'
import type {
  ChannelPerformance,
  PublishedByDay,
  TopContentItem,
} from '@/lib/types'

// The four main channels, in display order, with spec colors sourced from the
// shared channel meta (LinkedIn=blue, X=black, Blog=green, Email=orange).
const MAIN_CHANNELS = ['linkedin', 'x', 'blog', 'email'] as const
type MainChannel = (typeof MAIN_CHANNELS)[number]

// Chart fills: X's brand black is invisible on the dark theme, so the chart uses
// a visible neutral grey for X (icons + cards keep the true brand styling).
const CHART_FILL: Record<MainChannel, string> = {
  linkedin: channelMeta('linkedin').dotStyle,
  x: '#9ca3af',
  blog: channelMeta('blog').dotStyle,
  email: channelMeta('email').dotStyle,
}

// Client-side chart windows. The backend always returns the full 14-day series
// (it accepts no params), so these options only slice the rows we already have.
// A 30-day option is intentionally omitted — the API never returns >14 days, so
// it would render a fabricated half-empty window.
const RANGE_OPTIONS = [
  { value: 7, label: 'Last 7 days' },
  { value: 14, label: 'Last 14 days' },
] as const

export default function Analytics() {
  const { data: summary, isLoading: summaryLoading } = useAnalyticsSummary()
  const { data: top, isLoading: topLoading } = useTopContent()
  const { data: keywords } = useKeywords()

  // ── client-side filters (no API params) ──
  const [rangeDays, setRangeDays] = useState<number>(14)
  // Which channels are visible in the chart + scorecard row. Empty set = all on.
  const [hidden, setHidden] = useState<Set<MainChannel>>(new Set())
  const activeChannels = useMemo(
    () => MAIN_CHANNELS.filter((ch) => !hidden.has(ch)),
    [hidden],
  )
  const toggleChannel = (ch: MainChannel) =>
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(ch)) next.delete(ch)
      else next.add(ch)
      // Don't allow hiding every channel — keep at least one on.
      if (next.size === MAIN_CHANNELS.length) return prev
      return next
    })

  const stats = [
    {
      label: 'Pending review',
      value: summary?.pending_count ?? 0,
      color: 'text-amber-400',
    },
    {
      label: 'Published',
      value: summary?.published_count ?? 0,
      color: 'text-violet-400',
    },
    {
      label: 'Avg guardian',
      value:
        summary?.avg_guardian != null ? summary.avg_guardian.toFixed(2) : '—',
      color: 'text-emerald-400',
    },
  ]

  return (
    <div className="animate-fade-in space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[#f1f5f9]">
            Analytics
          </h1>
          <p className="mt-1 text-sm text-[#94a3b8]">
            Unified performance across channels
          </p>
        </div>
        {/* Client-side controls — these slice/filter already-fetched data; they
            never call the API with params. */}
        <div className="flex flex-wrap items-center gap-3">
          <ChannelFilter active={activeChannels} onToggle={toggleChannel} />
          <Select
            aria-label="Chart window"
            className="w-auto py-2 pr-9 text-xs"
            value={rangeDays}
            onChange={(e) => setRangeDays(Number(e.target.value))}
          >
            {RANGE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
      </header>

      {/* SECTION 1 — summary stats */}
      <div className="grid grid-cols-3 gap-4">
        {stats.map((c) => (
          <Card key={c.label} className="p-5">
            <div className={`text-2xl font-bold ${c.color}`}>{c.value}</div>
            <div className="mt-1 text-xs text-[#64748b]">{c.label}</div>
          </Card>
        ))}
      </div>

      {/* SECTION 2 — channel scorecard row (moved above the chart) */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {activeChannels.map((ch) => (
          <ChannelScorecard
            key={ch}
            channel={ch}
            perf={summary?.channel_performance.find((p) => p.channel === ch)}
          />
        ))}
      </div>

      {/* SECTION 3 — performance chart */}
      <Card className="p-5">
        <div className="mb-4 flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-[#94a3b8]" />
          <h2 className="text-sm font-semibold text-[#f1f5f9]">
            Posts published — last {rangeDays} days
          </h2>
        </div>
        <PerformanceChart
          data={summary?.published_by_day ?? []}
          loading={summaryLoading}
          rangeDays={rangeDays}
          channels={activeChannels}
        />
      </Card>

      {/* SECTION 4 — top performing content */}
      <Card className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-[#94a3b8]" />
            <h2 className="text-sm font-semibold text-[#f1f5f9]">
              Top performing content
            </h2>
          </div>
          {top && !top.hasMetrics && (
            <span className="text-xs text-[#64748b]">
              Performance data updates nightly
            </span>
          )}
        </div>
        <TopContentTable
          items={top?.items ?? []}
          hasMetrics={top?.hasMetrics ?? false}
          loading={topLoading}
        />
      </Card>

      {/* SECTION 5 — GSC keyword intelligence */}
      <Card className="p-5">
        <div className="mb-4 flex items-center gap-2">
          <Search className="h-4 w-4 text-[#94a3b8]" />
          <h2 className="text-sm font-semibold text-[#f1f5f9]">
            Search keyword intelligence
          </h2>
        </div>
        <KeywordsTable keywords={keywords ?? []} />
      </Card>
    </div>
  )
}

// ── channel filter (client-side multi-toggle) ───────────────────────

function ChannelFilter({
  active,
  onToggle,
}: {
  active: MainChannel[]
  onToggle: (ch: MainChannel) => void
}) {
  return (
    <div
      className="flex items-center gap-1.5"
      role="group"
      aria-label="Filter channels"
    >
      {MAIN_CHANNELS.map((ch) => {
        const on = active.includes(ch)
        return (
          <button
            key={ch}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(ch)}
            title={`${on ? 'Hide' : 'Show'} ${channelMeta(ch).label}`}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors',
              on
                ? 'border-violet-500/40 bg-violet-500/15 text-[#f1f5f9]'
                : 'border-[#1e1e2e] bg-[#0f0f1a] text-[#64748b] hover:text-[#94a3b8]',
            )}
          >
            <ChannelIcon channel={ch} />
            <span className="hidden sm:inline">{channelMeta(ch).label}</span>
          </button>
        )
      })}
    </div>
  )
}

// ── compact channel scorecard ───────────────────────────────────────

function ChannelScorecard({
  channel,
  perf,
}: {
  channel: MainChannel
  perf: ChannelPerformance | undefined
}) {
  const meta = channelMeta(channel)
  const rawRate = (perf?.engagementRate ?? 0) * 100
  // Engagement rates can exceed 100% when impression backfills lag behind
  // engagement events (or duplicate events get counted). Clamp the display and
  // flag clamped values rather than showing an impossible figure like 111.1%.
  const clamped = rawRate > 100
  const shownRate = Math.min(rawRate, 100)

  return (
    <div className="rounded-lg border border-[#1e1e2e] bg-[#0f0f1a] p-3.5">
      <div className="flex items-center gap-2">
        <ChannelIcon channel={channel} />
        <span className="text-sm font-semibold text-[#f1f5f9]">
          {meta.label}
        </span>
      </div>
      <div className="mt-3 space-y-1.5">
        <Stat label="Posts published" value={perf?.posts ?? 0} />
        <Stat
          label="Avg impressions"
          value={(perf?.avgImpressions ?? 0).toLocaleString()}
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-[#64748b]">Avg engagement rate</span>
          <span
            className="text-sm font-semibold tabular-nums text-[#f1f5f9]"
            title={
              clamped ? 'Data may include duplicate events' : undefined
            }
          >
            {shownRate.toFixed(1)}%{clamped ? '*' : ''}
          </span>
        </div>
      </div>
    </div>
  )
}

// ── Section 3: stacked bar chart ────────────────────────────────────

interface DayRow {
  label: string
  linkedin: number
  x: number
  blog: number
  email: number
}

function PerformanceChart({
  data,
  loading,
  rangeDays,
  channels,
}: {
  data: PublishedByDay[]
  loading: boolean
  rangeDays: number
  channels: MainChannel[]
}) {
  if (loading) {
    return <div className="h-64 animate-pulse rounded bg-white/[0.03]" />
  }

  // Build the last `rangeDays` calendar days, then fold the per-day/per-channel
  // counts in. The window is sliced entirely client-side from already-fetched
  // rows — the backend always returns the full series.
  const days: DayRow[] = []
  const index = new Map<string, DayRow>()
  const today = new Date()
  for (let i = rangeDays - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    const row: DayRow = {
      label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      linkedin: 0,
      x: 0,
      blog: 0,
      email: 0,
    }
    days.push(row)
    index.set(key, row)
  }
  for (const r of data) {
    const row = index.get(r.day)
    if (!row) continue
    const ch = r.channel as MainChannel
    if (ch === 'linkedin' || ch === 'x' || ch === 'blog' || ch === 'email') {
      row[ch] += r.count
    }
  }

  // Total only counts the visible window + active channels, so the empty state
  // tracks the current filters rather than the full unfiltered series.
  const total = days.reduce(
    (sum, row) => sum + channels.reduce((s, ch) => s + row[ch], 0),
    0,
  )
  if (total === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 text-center">
        <BarChart3 className="h-7 w-7 text-[#64748b]" />
        <div className="text-sm text-[#94a3b8]">
          No posts published in the last {rangeDays} days yet.
        </div>
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={256}>
      <BarChart data={days} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
        <XAxis
          dataKey="label"
          tick={{ fill: '#64748b', fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
        />
        <YAxis
          allowDecimals={false}
          tick={{ fill: '#64748b', fontSize: 11 }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          cursor={{ fill: 'rgba(255,255,255,0.04)' }}
          contentStyle={{
            background: '#0d0d12',
            border: '1px solid #1e1e2e',
            borderRadius: 8,
            fontSize: 12,
          }}
          labelStyle={{ color: '#f1f5f9' }}
        />
        <Legend
          iconType="circle"
          wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
        />
        {MAIN_CHANNELS.filter((ch) => channels.includes(ch)).map((ch) => (
          <Bar
            key={ch}
            dataKey={ch}
            stackId="posts"
            name={channelMeta(ch).label}
            fill={CHART_FILL[ch]}
            radius={ch === channels[channels.length - 1] ? [3, 3, 0, 0] : undefined}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

// ── Section 4: top content table ────────────────────────────────────

const SOCIAL_NOTE =
  'Click tracking requires SendGrid domain authentication for apire.io'

function TopContentTable({
  items,
  hasMetrics,
  loading,
}: {
  items: TopContentItem[]
  hasMetrics: boolean
  loading: boolean
}) {
  if (loading) {
    return <div className="h-40 animate-pulse rounded bg-white/[0.03]" />
  }
  if (items.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-[#94a3b8]">
        No published content yet.
      </div>
    )
  }

  // Buffer/LinkedIn never return click metrics, so the social Clicks column is
  // structurally all-zero. When that's the case we drop the column and surface
  // a single explanatory note instead of a column of meaningless zeros. (GSC
  // keyword clicks live in a different table and stay untouched.)
  const allClicksZero = items.every((it) => it.clicks === 0)

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-[#1e1e2e] text-[11px] uppercase tracking-wide text-[#64748b]">
            <th className="py-2 pr-3 font-medium">Content</th>
            <th className="px-3 py-2 font-medium">Channel</th>
            <th className="px-3 py-2 font-medium">Published</th>
            <th className="px-3 py-2 text-right font-medium">Impr.</th>
            {!allClicksZero && (
              <th className="px-3 py-2 text-right font-medium">Clicks</th>
            )}
            <th className="px-3 py-2 text-right font-medium">Engmt.</th>
            <th className="py-2 pl-3 text-right font-medium">
              {hasMetrics ? 'Score' : 'Guardian'}
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr
              key={it.id}
              className="border-b border-[#1e1e2e] last:border-0 hover:bg-white/[0.02]"
            >
              <td className="max-w-[280px] truncate py-2.5 pr-3 text-[#f1f5f9]">
                {it.preview || <span className="text-[#64748b]">—</span>}
              </td>
              <td className="px-3 py-2.5">
                <span className="inline-flex items-center gap-1.5 text-[#94a3b8]">
                  <ChannelIcon channel={it.channel} />
                  {channelMeta(it.channel).label}
                </span>
              </td>
              <td className="px-3 py-2.5 text-[#94a3b8]">
                {fmtDate(it.publishedAt)}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums text-[#94a3b8]">
                {it.impressions.toLocaleString()}
              </td>
              {!allClicksZero && (
                <td className="px-3 py-2.5 text-right tabular-nums text-[#94a3b8]">
                  {it.clicks.toLocaleString()}
                </td>
              )}
              <td className="px-3 py-2.5 text-right tabular-nums text-[#94a3b8]">
                {it.engagement.toLocaleString()}
              </td>
              <td className="py-2.5 pl-3 text-right">
                <ScoreCell item={it} hasMetrics={hasMetrics} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {allClicksZero && (
        <p className="mt-3 text-xs italic text-[#64748b]">{SOCIAL_NOTE}</p>
      )}
    </div>
  )
}

function ScoreCell({
  item,
  hasMetrics,
}: {
  item: TopContentItem
  hasMetrics: boolean
}) {
  if (hasMetrics && item.performanceScore != null) {
    const beat = item.performanceScore > 1
    return (
      <Badge variant={beat ? 'green' : 'gray'}>
        {item.performanceScore.toFixed(2)}×
      </Badge>
    )
  }
  if (item.guardianScore != null) {
    return (
      <span className="tabular-nums text-[#94a3b8]">
        {item.guardianScore.toFixed(2)}
      </span>
    )
  }
  return <span className="text-[#64748b]">—</span>
}

// ── Section 5: keyword table ────────────────────────────────────────

function KeywordsTable({
  keywords,
}: {
  keywords: import('@/lib/types').GscKeyword[]
}) {
  if (keywords.length === 0) {
    return (
      <div className="rounded-lg border border-[#1e1e2e] bg-[#0f0f1a] p-6 text-center">
        <div
          className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-violet-500/15"
          aria-hidden
        >
          <Search className="h-5 w-5 text-violet-400" />
        </div>
        <h3 className="text-sm font-semibold text-[#f1f5f9]">
          Connect Google Search Console
        </h3>
        <p className="mx-auto mt-1.5 max-w-md text-xs text-[#94a3b8]">
          See which search queries bring people to apire.io and track ranking
          positions
        </p>
        <Link
          to="/settings?tab=platforms"
          className="mt-4 inline-flex items-center gap-1 rounded-lg bg-[#7c3aed] px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#8b5cf6]"
        >
          Connect Google →
        </Link>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-[#1e1e2e] text-[11px] uppercase tracking-wide text-[#64748b]">
            <th className="py-2 pr-3 font-medium">Query</th>
            <th className="px-3 py-2 font-medium">Page</th>
            <th className="px-3 py-2 text-right font-medium">Impr.</th>
            <th className="px-3 py-2 text-right font-medium">Clicks</th>
            <th className="px-3 py-2 text-right font-medium">Pos.</th>
            <th className="py-2 pl-3 font-medium" />
          </tr>
        </thead>
        <tbody>
          {keywords.map((k, i) => (
            <tr
              key={`${k.query}-${i}`}
              className="border-b border-[#1e1e2e] last:border-0 hover:bg-white/[0.02]"
            >
              <td className="py-2.5 pr-3 text-[#f1f5f9]">{k.query}</td>
              <td className="max-w-[220px] truncate px-3 py-2.5 text-[#64748b]">
                {prettyPath(k.page)}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums text-[#94a3b8]">
                {k.impressions.toLocaleString()}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums text-[#94a3b8]">
                {k.clicks.toLocaleString()}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums text-[#94a3b8]">
                {k.position.toFixed(1)}
              </td>
              <td className="py-2.5 pl-3 text-right">
                {k.isHighPerformer && <Badge variant="purple">High</Badge>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── small helpers ───────────────────────────────────────────────────

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-[#64748b]">{label}</span>
      <span className="text-sm font-semibold tabular-nums text-[#f1f5f9]">
        {value}
      </span>
    </div>
  )
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function prettyPath(url: string): string {
  try {
    return new URL(url).pathname || url
  } catch {
    return url
  }
}
