import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, AlertTriangle, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ToastState {
  message: string
  variant?: 'success' | 'error'
}

/**
 * Minimal transient toast — fixed bottom-right, auto-dismisses after `duration`.
 * Self-contained (no provider/library); mount one per page and drive it with a
 * piece of state set to null when hidden.
 */
export function Toast({
  toast,
  onClose,
  duration = 4000,
}: {
  toast: ToastState | null
  onClose: () => void
  duration?: number
}) {
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(onClose, duration)
    return () => clearTimeout(t)
  }, [toast, duration, onClose])

  if (!toast) return null
  const error = toast.variant === 'error'

  return createPortal(
    <div
      role="status"
      className={cn(
        'glass animate-slide-up fixed bottom-6 right-6 z-[60] flex max-w-sm items-start gap-3 px-4 py-3 text-sm shadow-lg',
        error ? 'border-red-500/30 text-red-200' : 'border-emerald-500/30 text-emerald-200',
      )}
    >
      {error ? (
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      ) : (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
      )}
      <span className="flex-1">{toast.message}</span>
      <button
        onClick={onClose}
        aria-label="Dismiss"
        className="rounded p-0.5 text-gray-500 transition-colors hover:text-gray-200"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>,
    document.body,
  )
}
