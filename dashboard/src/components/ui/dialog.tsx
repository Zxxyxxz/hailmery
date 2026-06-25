import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface DialogProps {
  open: boolean
  onClose: () => void
  children: ReactNode
  className?: string
  title?: ReactNode
  description?: ReactNode
}

export function Dialog({
  open,
  onClose,
  children,
  className,
  title,
  description,
}: DialogProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="animate-fade-in absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          'glass animate-slide-up relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto',
          className,
        )}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 rounded-lg p-1.5 text-[#94a3b8] transition-colors hover:bg-white/[0.06] hover:text-[#f1f5f9]"
        >
          <X className="h-4 w-4" />
        </button>
        {(title || description) && (
          <div className="p-6 pb-2">
            {title && (
              <h2 className="text-lg font-semibold text-gray-100">{title}</h2>
            )}
            {description && (
              <p className="mt-1 text-sm text-[#94a3b8]">{description}</p>
            )}
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body,
  )
}
