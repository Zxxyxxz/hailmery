import type { TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export function Textarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-3.5 py-2.5 text-sm text-gray-100 placeholder-gray-600 transition-all duration-200 focus:border-cyan-500/40 focus:outline-none focus:ring-2 focus:ring-cyan-500/30',
        className,
      )}
      {...props}
    />
  )
}
