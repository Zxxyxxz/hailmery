import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface PopoverRenderProps {
  close: () => void
}

interface PopoverProps {
  trigger: ReactNode
  children: ReactNode | ((p: PopoverRenderProps) => ReactNode)
  align?: 'start' | 'end'
  className?: string
}

/** Click-to-toggle popover anchored to its trigger; closes on outside click. */
export function Popover({
  trigger,
  children,
  align = 'end',
  className,
}: PopoverProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  return (
    <div className="relative inline-block" ref={ref}>
      <div onClick={() => setOpen((o) => !o)}>{trigger}</div>
      {open && (
        <div
          data-popover-panel=""
          className={cn(
            'glass animate-fade-in absolute z-40 mt-2 min-w-[15rem] p-3',
            align === 'end' ? 'right-0' : 'left-0',
            className,
          )}
        >
          {typeof children === 'function'
            ? children({ close: () => setOpen(false) })
            : children}
        </div>
      )}
    </div>
  )
}
