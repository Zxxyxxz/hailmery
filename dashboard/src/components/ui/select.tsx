import type { SelectHTMLAttributes } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Styled native select — keeps keyboard + a11y behavior for free. */
export function Select({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select
        className={cn(
          'w-full appearance-none rounded-xl border border-[#1e1e2e] bg-white/[0.04] px-3.5 py-2.5 pr-9 text-sm text-[#f1f5f9] transition-all duration-200 focus:border-violet-500/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30',
          '[&>option]:bg-[#0f0f1a] [&>option]:text-[#f1f5f9]',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#64748b]" />
    </div>
  )
}
