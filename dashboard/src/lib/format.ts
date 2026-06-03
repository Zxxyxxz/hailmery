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

/** "2 hours ago" style relative label for a past timestamp. */
export function formatTimeAgo(iso: string | null): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`
  const years = Math.floor(months / 12)
  return `${years} year${years === 1 ? '' : 's'} ago`
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
