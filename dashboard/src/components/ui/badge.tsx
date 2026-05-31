import { cva, type VariantProps } from 'class-variance-authority'
import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium leading-tight transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-white/[0.06] text-gray-300 border border-white/[0.08]',
        cyan: 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/20',
        green: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/20',
        amber: 'bg-amber-500/15 text-amber-300 border border-amber-500/20',
        red: 'bg-red-500/15 text-red-300 border border-red-500/20',
        blue: 'bg-blue-500/15 text-blue-300 border border-blue-500/20',
        purple: 'bg-violet-500/15 text-violet-300 border border-violet-500/20',
        orange: 'bg-orange-500/15 text-orange-300 border border-orange-500/20',
        gray: 'bg-gray-500/10 text-gray-400 border border-gray-500/20',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}
