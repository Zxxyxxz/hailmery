import type { LabelHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export function Label({
  className,
  ...props
}: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn(
        'mb-1.5 block text-sm font-medium text-[#94a3b8]',
        className,
      )}
      {...props}
    />
  )
}
