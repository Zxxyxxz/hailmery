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
import { ChannelIcon } from '@/components/ChannelIcon'
import type { TopContentItem } from '@/lib/types'

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

export default function Analytics() {
  const { data: summary, isLoading: summaryLoading } = useAnalyticsSummary()
  const { data: top, isLoading: topLoading } = useTopContent()
  const { data: keywords } = useKeywords()

  const stats = [
    {
      label: 'Pending review',
      value: summary?.pending_count ?? 0,
      color: 'text-amber-400',
    },
    {
      label: 'Published',
      value: summary?.published_count ?? 0,
      color: 'text-cyan-400',
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
      <header>
        <h1 className="text-2xl font-bold text-gray-100">Analytics</h1>
        <p className="mt-1 text-sm text-gray-500">
          Unified performance across channels
        </p>
      </header>

      {/* SECTION 1 — summary stats */}
      <div className="grid grid-cols-3 gap-4">
        {stats.map((c) => (
          <Card key={c.label} className="p-5">
            <div className={`text-2xl font-bold ${c.color}`}>{c.value}</div>
            <div className="mt-1 text-xs text-gray-500">{c.label}</div>
          </Card>
        ))}
      </div>

      {/* SECTION 2 — performance chart */}
      <Card className="p-5">
        <div className="mb-4 flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-gray-400" />
          <h2 className="text-sm font-semibold text-gray-200">
            Posts published — last 14 days
          </h2>
        </div>
        <PerformanceChart
          data={summary?.published_by_day ?? []}
          loading={summaryLoading}
        />
      </Card>

      {/* SECTION 3 — top performing content */}
      <Card className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-gray-400" />
            <h2 className="text-sm font-semibold text-gray-200">
              Top performing content
            </h2>
          </div>
          {top && !top.hasMetrics && (
            <span className="text-xs text-gray-500">
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

      {/* SECTION 4 — GSC keyword intelligence */}
      <Card className="p-5">
        <div className="mb-4 flex items-center gap-2">
          <Search className="h-4 w-4 text-gray-400" />
          <h2 className="text-sm font-semibold text-gray-200">
            Search keyword intelligence
          </h2>
        </div>
        <KeywordsTable keywords={keywords ?? []} />
      </Card>

      {/* SECTION 5 — channel performance summary */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {MAIN_CHANNELS.map((ch) => {
          const perf = summary?.channel_performance.find(
            (p) => p.channel === ch,
          )
          const meta = channelMeta(ch)
          return (
            <Card key={ch} className="p-5">
              <div className="flex items-center gap-2">
                <ChannelIcon channel={ch} />
                <span className="text-sm font-semibold text-gray-200">
                  {meta.label}
                </span>
              </div>
              <div className="mt-3 space-y-1.5">
                <Stat label="Posts published" value={perf?.posts ?? 0} />
                <Stat
                  label="Avg impressions"
                  value={(perf?.avgImpressions ?? 0).toLocaleString()}
                />
                <Stat
                  label="Avg engagement rate"
                  value={`${(((perf?.engagementRate ?? 0) * 100)).toFixed(1)}%`}
                />
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

// ── Section 2: stacked bar chart ────────────────────────────────────

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
}: {
  data: { day: string; channel: string; count: number }[]
  loading: boolean
}) {
  if (loading) {
    return <div className="h-64 animate-pulse rounded bg-white/[0.03]" />
  }

  // Build the last 14 calendar days, then fold the per-day/per-channel counts in.
  const days: DayRow[] = []
  const index = new Map<string, DayRow>()
  const today = new Date()
  for (let i = 13; i >= 0; i--) {
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

  const total = data.reduce((sum, r) => sum + r.count, 0)
  if (total === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 text-center">
        <BarChart3 className="h-7 w-7 text-gray-600" />
        <div className="text-sm text-gray-500">
          No posts published in the last 14 days yet.
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
          tick={{ fill: '#6b7280', fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
        />
        <YAxis
          allowDecimals={false}
          tick={{ fill: '#6b7280', fontSize: 11 }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          cursor={{ fill: 'rgba(255,255,255,0.04)' }}
          contentStyle={{
            background: '#0d0d12',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 8,
            fontSize: 12,
          }}
          labelStyle={{ color: '#e5e7eb' }}
        />
        <Legend
          iconType="circle"
          wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
        />
        {MAIN_CHANNELS.map((ch) => (
          <Bar
            key={ch}
            dataKey={ch}
            stackId="posts"
            name={channelMeta(ch).label}
            fill={CHART_FILL[ch]}
            radius={ch === 'email' ? [3, 3, 0, 0] : undefined}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

// ── Section 3: top content table ────────────────────────────────────

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
      <div className="py-10 text-center text-sm text-gray-500">
        No published content yet.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-white/[0.06] text-[11px] uppercase tracking-wide text-gray-500">
            <th className="py-2 pr-3 font-medium">Content</th>
            <th className="px-3 py-2 font-medium">Channel</th>
            <th className="px-3 py-2 font-medium">Published</th>
            <th className="px-3 py-2 text-right font-medium">Impr.</th>
            <th className="px-3 py-2 text-right font-medium">Clicks</th>
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
              className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02]"
            >
              <td className="max-w-[280px] truncate py-2.5 pr-3 text-gray-200">
                {it.preview || <span className="text-gray-600">—</span>}
              </td>
              <td className="px-3 py-2.5">
                <span className="inline-flex items-center gap-1.5 text-gray-300">
                  <ChannelIcon channel={it.channel} />
                  {channelMeta(it.channel).label}
                </span>
              </td>
              <td className="px-3 py-2.5 text-gray-400">
                {fmtDate(it.publishedAt)}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums text-gray-300">
                {it.impressions.toLocaleString()}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums text-gray-300">
                {it.clicks.toLocaleString()}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums text-gray-300">
                {it.engagement.toLocaleString()}
              </td>
              <td className="py-2.5 pl-3 text-right">
                <ScoreCell item={it} hasMetrics={hasMetrics} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
      <span className="tabular-nums text-gray-300">
        {item.guardianScore.toFixed(2)}
      </span>
    )
  }
  return <span className="text-gray-600">—</span>
}

// ── Section 4: keyword table ────────────────────────────────────────

function KeywordsTable({
  keywords,
}: {
  keywords: import('@/lib/types').GscKeyword[]
}) {
  if (keywords.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-gray-500">
        Connect Google Search Console in Settings → Connected Platforms to see
        keyword data.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-white/[0.06] text-[11px] uppercase tracking-wide text-gray-500">
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
              className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02]"
            >
              <td className="py-2.5 pr-3 text-gray-200">{k.query}</td>
              <td className="max-w-[220px] truncate px-3 py-2.5 text-gray-500">
                {prettyPath(k.page)}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums text-gray-300">
                {k.impressions.toLocaleString()}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums text-gray-300">
                {k.clicks.toLocaleString()}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums text-gray-300">
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
      <span className="text-xs text-gray-500">{label}</span>
      <span className="text-sm font-semibold tabular-nums text-gray-200">
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
