import { useState, type KeyboardEvent } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface TagInputProps {
  value: string[]
  onChange: (tags: string[]) => void
  placeholder?: string
  className?: string
}

/** Comma/Enter-delimited tag editor used for brand voice term lists. */
export function TagInput({ value, onChange, placeholder, className }: TagInputProps) {
  const [draft, setDraft] = useState('')

  function add(tag: string) {
    const t = tag.trim()
    if (t && !value.includes(t)) onChange([...value, t])
    setDraft('')
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      add(draft)
    } else if (e.key === 'Backspace' && !draft && value.length) {
      onChange(value.slice(0, -1))
    }
  }

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-1.5 rounded-xl border border-[#1e1e2e] bg-white/[0.04] px-2.5 py-2 focus-within:border-violet-500/50 focus-within:ring-2 focus-within:ring-violet-500/30',
        className,
      )}
    >
      {value.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 rounded-lg bg-violet-500/15 px-2 py-0.5 text-xs text-violet-200"
        >
          {tag}
          <button
            type="button"
            onClick={() => onChange(value.filter((t) => t !== tag))}
            className="text-violet-300/60 hover:text-violet-200"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
        onBlur={() => add(draft)}
        placeholder={value.length ? '' : placeholder}
        className="min-w-[8rem] flex-1 bg-transparent text-sm text-[#f1f5f9] placeholder-[#64748b] focus:outline-none"
      />
    </div>
  )
}
