import { ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { guardianTier } from '@/lib/format'

/** Brand Guardian score chip — green ≥0.97, amber ≥0.92, red below. */
export function GuardianBadge({ score }: { score: number | null }) {
  const tier = guardianTier(score)
  if (tier == null) return null
  const variant = tier === 'green' ? 'green' : tier === 'amber' ? 'amber' : 'red'
  return (
    <Badge variant={variant} title="Brand Guardian score">
      <ShieldCheck className="h-3 w-3" />
      {(score as number).toFixed(2)}
    </Badge>
  )
}
