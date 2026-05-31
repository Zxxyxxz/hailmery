import { cn } from '@/lib/utils'

interface ProgressProps {
  value: number
  max: number
  className?: string
  barClassName?: string
}

export function Progress({ value, max, className, barClassName }: ProgressProps) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  return (
    <div
      className={cn(
        'h-2 w-full overflow-hidden rounded-full bg-white/[0.06]',
        className,
      )}
    >
      <div
        className={cn(
          'h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-500',
          barClassName,
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}
