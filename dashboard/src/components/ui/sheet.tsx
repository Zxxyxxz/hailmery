import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SheetProps {
  open: boolean
  onClose: () => void
  children: ReactNode
  title?: ReactNode
  className?: string
}

/** Right-anchored slide-over panel (used by the calendar detail view). */
export function Sheet({ open, onClose, children, title, className }: SheetProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div
        className="animate-fade-in absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className={cn(
          'absolute right-0 top-0 flex h-full w-full max-w-md flex-col border-l border-white/[0.08] bg-[#0e0f15] shadow-2xl',
          'duration-300 animate-in slide-in-from-right',
          className,
        )}
        style={{ animation: 'slide-up 0.3s ease-out' }}
      >
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
          <div className="text-sm font-semibold text-gray-200">{title}</div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-white/[0.06] hover:text-gray-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
