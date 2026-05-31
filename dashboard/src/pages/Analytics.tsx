import { BarChart3 } from 'lucide-react'
import { useDrafts } from '@/lib/queries'
import { Card } from '@/components/ui/card'

export default function Analytics() {
  const { data: published } = useDrafts({ status: 'published' })
  const { data: pending } = useDrafts({ status: 'pending_review' })

  const cards = [
    { label: 'Pending review', value: pending?.length ?? 0, color: 'text-amber-400' },
    { label: 'Published', value: published?.length ?? 0, color: 'text-cyan-400' },
    { label: 'Avg guardian', value: avgGuardian(published, pending), color: 'text-emerald-400' },
  ]

  return (
    <div className="animate-fade-in space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-gray-100">Analytics</h1>
        <p className="mt-1 text-sm text-gray-500">
          Unified performance across channels
        </p>
      </header>

      <div className="grid grid-cols-3 gap-4">
        {cards.map((c) => (
          <Card key={c.label} className="p-5">
            <div className={`text-2xl font-bold ${c.color}`}>{c.value}</div>
            <div className="mt-1 text-xs text-gray-500">{c.label}</div>
          </Card>
        ))}
      </div>

      <Card className="flex flex-col items-center justify-center gap-3 py-20 text-center">
        <BarChart3 className="h-8 w-8 text-gray-600" />
        <div className="text-sm text-gray-400">
          Full BigQuery · GSC · Umami dashboards land in V1.
        </div>
      </Card>
    </div>
  )
}

function avgGuardian(...sets: (Array<{ guardianScore: number | null }> | undefined)[]) {
  const scores = sets
    .flatMap((s) => s ?? [])
    .map((d) => d.guardianScore)
    .filter((n): n is number => typeof n === 'number')
  if (!scores.length) return '—'
  return (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)
}
