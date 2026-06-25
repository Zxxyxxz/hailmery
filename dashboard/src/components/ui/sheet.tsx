import { useEffect, useRef, type ReactNode } from 'react'
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

/** Right-anchored slide-over modal panel. Escape closes; focus is moved into the
 *  panel on open, kept inside while open, and restored to the trigger on close;
 *  body scroll is locked. (Used by the Calendar detail + mobile Queue preview.) */
export function Sheet({ open, onClose, children, title, className }: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const prevFocus = document.activeElement as HTMLElement | null

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    // Lightweight focus trap: if focus escapes the panel, pull it back.
    const onFocusIn = (e: FocusEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        panelRef.current.focus()
      }
    }

    document.addEventListener('keydown', onKey)
    document.addEventListener('focusin', onFocusIn)
    document.body.style.overflow = 'hidden'
    const focusTimer = window.setTimeout(() => panelRef.current?.focus(), 0)

    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('focusin', onFocusIn)
      document.body.style.overflow = ''
      window.clearTimeout(focusTimer)
      prevFocus?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div
        className="animate-fade-in absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : 'Detail panel'}
        tabIndex={-1}
        className={cn(
          'absolute right-0 top-0 flex h-full w-full max-w-md flex-col border-l border-[#1e1e2e] bg-[#0a0a0f] shadow-2xl focus:outline-none',
          'duration-300 animate-in slide-in-from-right',
          className,
        )}
        style={{ animation: 'slide-up 0.3s ease-out' }}
      >
        <div className="flex items-center justify-between border-b border-[#1e1e2e] px-5 py-4">
          <div className="text-sm font-semibold text-gray-200">{title}</div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-[#94a3b8] transition-colors hover:bg-white/[0.06] hover:text-[#f1f5f9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40"
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
