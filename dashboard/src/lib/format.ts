import type { Draft } from './types'

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** "Tuesday 9:00am" style label for a publish time. */
export function formatPublishAt(iso: string | null): string {
  if (!iso) return 'Unscheduled'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Unscheduled'
  let h = d.getHours()
  const m = d.getMinutes()
  const ampm = h >= 12 ? 'pm' : 'am'
  h = h % 12 || 12
  const mm = m.toString().padStart(2, '0')
  return `${DAYS[d.getDay()]} ${h}:${mm}${ampm}`
}

/** Convert an ISO timestamp to the value a <input type="datetime-local"> wants. */
export function toDatetimeLocal(iso: string | null): string {
  const d = iso ? new Date(iso) : new Date()
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function fromDatetimeLocal(value: string): string | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** Guardian badge tier per the queue spec: ≥0.97 green, ≥0.92 amber, else red. */
export function guardianTier(score: number | null): 'green' | 'amber' | 'red' | null {
  if (score == null) return null
  if (score >= 0.97) return 'green'
  if (score >= 0.92) return 'amber'
  return 'red'
}

/** Human title for a draft regardless of channel. */
export function draftTitle(draft: Draft): string {
  if (draft.payload.title) return draft.payload.title
  if (draft.payload.subject) return draft.payload.subject
  const text = draft.payload.text ?? ''
  const firstLine = text.split('\n').find((l) => l.trim().length > 0) ?? ''
  return firstLine.slice(0, 80) || 'Untitled draft'
}
