import { useMemo } from 'react'
import { PartyPopper, Sparkles, AlertTriangle } from 'lucide-react'
import { useDrafts } from '@/lib/queries'
import { useTenant } from '@/lib/tenant-context'
import { DraftCard } from '@/components/DraftCard'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

export default function Queue() {
  const { current } = useTenant()
  const { data: drafts, isLoading, isError, error } = useDrafts({
    status: 'pending_review',
  })

  const sorted = useMemo(() => {
    if (!drafts) return []
    return [...drafts].sort((a, b) => {
      const ta = a.publishAt ? new Date(a.publishAt).getTime() : Infinity
      const tb = b.publishAt ? new Date(b.publishAt).getTime() : Infinity
      return ta - tb
    })
  }, [drafts])

  return (
    <div className="animate-fade-in space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">Review queue</h1>
          <p className="mt-1 text-sm text-gray-500">
            AI-generated drafts awaiting your approval
            {current ? ` · ${current.name}` : ''}
          </p>
        </div>
        {sorted.length > 0 && (
          <div className="text-sm text-gray-500">
            <span className="font-semibold text-cyan-400">{sorted.length}</span>{' '}
            pending
          </div>
        )}
      </header>

      {isLoading && <QueueSkeleton />}

      {isError && (
        <div className="glass-sm flex items-center gap-3 border-red-500/20 p-5 text-sm text-red-300">
          <AlertTriangle className="h-5 w-5" />
          Failed to load drafts: {(error as Error)?.message ?? 'unknown error'}
        </div>
      )}

      {!isLoading && !isError && sorted.length === 0 && <EmptyState />}

      {!isLoading && !isError && sorted.length > 0 && (
        <div className="space-y-4">
          {sorted.map((d) => (
            <DraftCard key={d.id} draft={d} />
          ))}
        </div>
      )}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="glass flex flex-col items-center justify-center px-6 py-20 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500/20 to-cyan-500/20">
        <PartyPopper className="h-8 w-8 text-emerald-400" />
      </div>
      <h2 className="text-lg font-semibold text-gray-100">
        Queue is clear — all content approved!
      </h2>
      <p className="mt-1 max-w-sm text-sm text-gray-500">
        Nothing is waiting for review. Generate the next batch of drafts to keep
        the calendar full.
      </p>
      <Button className="mt-6">
        <Sparkles className="h-4 w-4" />
        Generate more content
      </Button>
    </div>
  )
}

function QueueSkeleton() {
  return (
    <div className="space-y-4">
      {[0, 1, 2].map((i) => (
        <div key={i} className="glass space-y-4 p-5">
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-5 w-28 rounded-full" />
            <Skeleton className="ml-auto h-5 w-14 rounded-full" />
          </div>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-4/5" />
          <div className="flex gap-2 pt-2">
            <Skeleton className="h-8 w-24 rounded-xl" />
            <Skeleton className="h-8 w-20 rounded-xl" />
            <Skeleton className="h-8 w-24 rounded-xl" />
          </div>
        </div>
      ))}
    </div>
  )
}
