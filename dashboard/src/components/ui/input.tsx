import type { InputHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'w-full rounded-xl border border-[#1e1e2e] bg-white/[0.04] px-3.5 py-2.5 text-sm text-[#f1f5f9] placeholder-[#64748b] transition-all duration-200 focus:border-violet-500/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30',
        className,
      )}
      {...props}
    />
  )
}
