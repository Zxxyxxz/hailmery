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
          'w-full appearance-none rounded-xl border border-white/[0.08] bg-white/[0.04] px-3.5 py-2.5 pr-9 text-sm text-gray-100 transition-all duration-200 focus:border-cyan-500/40 focus:outline-none focus:ring-2 focus:ring-cyan-500/30',
          '[&>option]:bg-[#14151c] [&>option]:text-gray-100',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
    </div>
  )
}
