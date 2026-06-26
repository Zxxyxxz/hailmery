import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { FileText, Search, Sparkles, ExternalLink } from 'lucide-react'
import { useBlogPosts } from '@/lib/queries'
import { GuardianBadge } from '@/components/GuardianBadge'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { formatTimeAgo } from '@/lib/format'
import type { BlogPost } from '@/lib/types'

type SourceFilter = 'all' | 'hailmery' | 'pre_existing'

const FILTERS: { value: SourceFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'hailmery', label: '✦ hailmery' },
  { value: 'pre_existing', label: 'Pre-existing' },
]

export default function BlogManagement() {
  const { data, isLoading, error } = useBlogPosts()
  const [filter, setFilter] = useState<SourceFilter>('all')
  const [search, setSearch] = useState('')

  // Hooks must run unconditionally — keep this above any early return.
  const filtered = useMemo(() => {
    if (!data?.posts) return []
    const q = search.trim().toLowerCase()
    return data.posts.filter((p) => {
      const matchSource = filter === 'all' || p.source === filter
      const matchSearch = !q || p.title.toLowerCase().includes(q)
      return matchSource && matchSearch
    })
  }, [data?.posts, filter, search])

  // Tenant with no Wix blog (e.g. OSM) → friendly empty state.
  if (!isLoading && data && !data.wixConnected) {
    return (
      <div className="animate-fade-in space-y-6">
        <Header />
        <Card className="mx-auto mt-10 max-w-md p-10 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-violet-500/15">
            <FileText className="h-6 w-6 text-violet-400" />
          </div>
          <h2 className="text-sm font-semibold text-[#f1f5f9]">
            No blog connection found
          </h2>
          <p className="mx-auto mt-2 max-w-sm text-xs text-[#94a3b8]">
            This tenant doesn&apos;t have a Wix blog connected. Blog management is
            available for tenants with a Wix blog (e.g. APIRE / apire.io). Switch
            tenants, or connect a blog in Settings.
          </p>
          <Link
            to="/settings?tab=platforms"
            className="mt-5 inline-flex items-center gap-1 rounded-lg bg-[#7c3aed] px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#8b5cf6]"
          >
            Go to Settings →
          </Link>
        </Card>
      </div>
    )
  }

  const stats = data?.stats

  return (
    <div className="animate-fade-in space-y-6">
      <Header />

      {/* Stats strip */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Total posts" value={stats?.total ?? 0} color="text-[#f1f5f9]" />
        <StatCard
          label="By hailmery"
          value={stats?.hailmery ?? 0}
          color="text-violet-400"
          icon={<Sparkles className="h-4 w-4" />}
        />
        <StatCard
          label="Pre-existing"
          value={stats?.preExisting ?? 0}
          color="text-[#94a3b8]"
        />
        <StatCard
          label="Avg guardian"
          value={stats?.avgGuardianScore != null ? stats.avgGuardianScore.toFixed(2) : '—'}
          color="text-emerald-400"
        />
      </div>

      {/* Filters + search */}
      <div className="flex flex-wrap items-center gap-3">
        <div
          className="flex overflow-hidden rounded-lg border border-[#1e1e2e]"
          role="group"
          aria-label="Filter by source"
        >
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={filter === f.value}
              onClick={() => setFilter(f.value)}
              className={cn(
                'px-3.5 py-2 text-xs font-medium transition-colors',
                filter === f.value
                  ? 'bg-violet-500/15 text-violet-300'
                  : 'text-[#94a3b8] hover:text-[#f1f5f9]',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#64748b]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search posts…"
            aria-label="Search posts by title"
            className="w-full rounded-lg border border-[#1e1e2e] bg-[#0f0f1a] py-2 pl-9 pr-3 text-sm text-[#f1f5f9] placeholder:text-[#64748b] focus:border-violet-500/50 focus:outline-none"
          />
        </div>
      </div>

      {/* Post list */}
      {isLoading ? (
        <Card className="p-5">
          <div className="h-40 animate-pulse rounded bg-white/[0.03]" />
        </Card>
      ) : error ? (
        <Card className="border border-red-500/30 p-5 text-sm text-red-300">
          Failed to load blog posts. Check that your Wix connection is active in
          Settings → Platforms.
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="p-10 text-center text-sm text-[#94a3b8]">
          {search ? `No posts matching “${search}”.` : 'No posts found.'}
        </Card>
      ) : (
        <Card className="divide-y divide-[#1e1e2e] overflow-hidden p-0">
          {filtered.map((post) => (
            <BlogPostRow key={post.wixPostId} post={post} />
          ))}
        </Card>
      )}
    </div>
  )
}

// ── sub-components ───────────────────────────────────────────────────

function Header() {
  return (
    <header>
      <h1 className="text-2xl font-semibold tracking-tight text-[#f1f5f9]">Blog</h1>
      <p className="mt-1 text-sm text-[#94a3b8]">
        Every post on your Wix blog — tagged by source.
      </p>
    </header>
  )
}

function StatCard({
  label,
  value,
  color,
  icon,
}: {
  label: string
  value: string | number
  color: string
  icon?: ReactNode
}) {
  return (
    <Card className="p-5">
      <div className={cn('flex items-center gap-1.5 text-2xl font-bold tabular-nums', color)}>
        {icon}
        {value}
      </div>
      <div className="mt-1 text-xs text-[#64748b]">{label}</div>
    </Card>
  )
}

function BlogPostRow({ post }: { post: BlogPost }) {
  const isHailmery = post.source === 'hailmery'
  const dateLabel = fmtDate(post.firstPublishedDate)
  const ago = formatTimeAgo(post.firstPublishedDate)

  return (
    <div className="flex items-start gap-4 px-4 py-3.5 transition-colors hover:bg-white/[0.02]">
      {/* Source badge */}
      <div className="mt-0.5 shrink-0">
        {isHailmery ? (
          <Badge variant="purple">✦ hailmery</Badge>
        ) : (
          <Badge variant="gray">pre-existing</Badge>
        )}
      </div>

      {/* Title + meta */}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-[#f1f5f9]">{post.title}</div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {isHailmery && post.campaignName && (
            <span className="text-xs text-violet-400">{post.campaignName}</span>
          )}
          {isHailmery && <GuardianBadge score={post.guardianScore} />}
          {!isHailmery && <span className="text-xs text-[#64748b]">Wix / Kleo</span>}
        </div>
      </div>

      {/* Date + link */}
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <span className="text-xs text-[#64748b]" title={dateLabel}>
          {ago || dateLabel}
        </span>
        {post.url && (
          <a
            href={post.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-cyan-400 hover:underline"
          >
            View <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </div>
  )
}

function fmtDate(iso: string | null): string {
  if (!iso) return 'Unknown date'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Unknown date'
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}
