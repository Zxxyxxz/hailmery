import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

interface CheckboxProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: string
  className?: string
}

export function Checkbox({ checked, onChange, label, className }: CheckboxProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'inline-flex items-center gap-2 text-sm text-gray-300 transition-colors hover:text-gray-100',
        className,
      )}
    >
      <span
        className={cn(
          'flex h-4.5 w-4.5 items-center justify-center rounded-md border transition-all',
          checked
            ? 'border-cyan-500/60 bg-cyan-500/20 text-cyan-300'
            : 'border-white/[0.12] bg-white/[0.03]',
        )}
        style={{ width: 18, height: 18 }}
      >
        {checked && <Check className="h-3 w-3" strokeWidth={3} />}
      </span>
      {label}
    </button>
  )
}
