import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Plug,
  FileText,
  CalendarClock,
  Mic,
  Upload,
  Trash2,
  RefreshCw,
  CheckCircle2,
  Loader2,
  Save,
} from 'lucide-react'
import { useTenant } from '@/lib/tenant-context'
import {
  useCampaigns,
  useConnections,
  useDeleteDocument,
  useDocuments,
  usePatchCampaign,
  usePatchSiteConfig,
  useReingestDocument,
  useSiteConfig,
  useUploadDocument,
} from '@/lib/queries'
import type { BrandVoice } from '@/lib/types'
import { SELECTABLE_CHANNELS } from '@/lib/channels'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { TagInput } from '@/components/ui/tag-input'

type BadgeVariant = NonNullable<BadgeProps['variant']>

export default function SettingsPage() {
  const [tab, setTab] = useState('brand')
  return (
    <div className="animate-fade-in space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-gray-100">Settings</h1>
        <p className="mt-1 text-sm text-gray-500">
          Brand voice, connected platforms, corpus, and cadence
        </p>
      </header>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="brand">
            <span className="flex items-center gap-1.5"><Mic className="h-4 w-4" /> Brand Voice</span>
          </TabsTrigger>
          <TabsTrigger value="platforms">
            <span className="flex items-center gap-1.5"><Plug className="h-4 w-4" /> Platforms</span>
          </TabsTrigger>
          <TabsTrigger value="corpus">
            <span className="flex items-center gap-1.5"><FileText className="h-4 w-4" /> Corpus</span>
          </TabsTrigger>
          <TabsTrigger value="schedule">
            <span className="flex items-center gap-1.5"><CalendarClock className="h-4 w-4" /> Schedule</span>
          </TabsTrigger>
        </TabsList>

        <div className="mt-6">
          <TabsContent value="brand"><BrandVoiceTab /></TabsContent>
          <TabsContent value="platforms"><PlatformsTab /></TabsContent>
          <TabsContent value="corpus"><CorpusTab /></TabsContent>
          <TabsContent value="schedule"><ScheduleTab /></TabsContent>
        </div>
      </Tabs>
    </div>
  )
}

// ── Tab 1 — Brand Voice ─────────────────────────────────────────────

const TONES = ['formal/technical', 'conversational', 'authoritative', 'urgent']

function BrandVoiceTab() {
  const { current } = useTenant()
  const siteId = current?.siteId ?? undefined
  const { data, isLoading } = useSiteConfig(siteId)
  const save = usePatchSiteConfig()

  const [tone, setTone] = useState('')
  const [preferred, setPreferred] = useState<string[]>([])
  const [avoid, setAvoid] = useState<string[]>([])
  const [good, setGood] = useState('')
  const [bad, setBad] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!data) return
    const bv = data.brandVoice
    setTone(String(bv.tone ?? ''))
    setPreferred((bv.preferredTerms as string[]) ?? (bv.always as string[]) ?? [])
    setAvoid((bv.avoidTerms as string[]) ?? (bv.avoid as string[]) ?? [])
    setGood(((bv.goodExamples as string[]) ?? []).join('\n'))
    setBad(((bv.badExamples as string[]) ?? []).join('\n'))
  }, [data])

  if (isLoading || !data) return <Skeleton className="h-96 rounded-2xl" />

  function onSave() {
    if (!siteId) return
    const next: BrandVoice = {
      ...data!.brandVoice,
      tone,
      preferredTerms: preferred,
      avoidTerms: avoid,
      goodExamples: good.split('\n').map((l) => l.trim()).filter(Boolean),
      badExamples: bad.split('\n').map((l) => l.trim()).filter(Boolean),
    }
    save.mutate(
      { siteId, brandVoice: next },
      { onSuccess: () => { setSaved(true); setTimeout(() => setSaved(false), 2500) } },
    )
  }

  const toneOptions = TONES.includes(tone) || !tone ? TONES : [tone, ...TONES]

  return (
    <Card className="space-y-5 p-6">
      <div>
        <Label>Tone</Label>
        <Select value={tone} onChange={(e) => setTone(e.target.value)}>
          {toneOptions.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </Select>
      </div>
      <div>
        <Label>Preferred terms</Label>
        <TagInput value={preferred} onChange={setPreferred} placeholder="Add a term and press Enter" />
      </div>
      <div>
        <Label>Terms to avoid</Label>
        <TagInput value={avoid} onChange={setAvoid} placeholder="Add a term and press Enter" />
      </div>
      <div>
        <Label>Example sentences that sound right (one per line)</Label>
        <Textarea rows={4} value={good} onChange={(e) => setGood(e.target.value)} />
      </div>
      <div>
        <Label>Example sentences that sound wrong (one per line)</Label>
        <Textarea rows={4} value={bad} onChange={(e) => setBad(e.target.value)} />
      </div>
      <div className="flex items-center gap-3">
        <Button onClick={onSave} disabled={save.isPending}>
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save brand voice
        </Button>
        {saved && (
          <span className="flex items-center gap-1 text-sm text-emerald-400">
            <CheckCircle2 className="h-4 w-4" /> Saved
          </span>
        )}
      </div>
    </Card>
  )
}

// ── Tab 2 — Connected Platforms ─────────────────────────────────────

function PlatformsTab() {
  const { data, isLoading } = useConnections()
  if (isLoading) return <Skeleton className="h-96 rounded-2xl" />

  return (
    <Card className="divide-y divide-white/[0.05] p-2">
      {(data ?? []).map((c) => (
        <div key={c.platform} className="flex items-center justify-between px-4 py-3.5">
          <div className="flex items-center gap-3">
            <span
              className={`h-2.5 w-2.5 rounded-full ${c.connected ? 'bg-emerald-400' : 'bg-gray-600'}`}
            />
            <div>
              <div className="text-sm font-medium text-gray-200">{c.platform}</div>
              {c.connected ? (
                <div className="text-xs text-gray-500">
                  {c.account ?? 'Connected'}
                  {c.lastSyncAt && ` · last sync ${new Date(c.lastSyncAt).toLocaleString()}`}
                </div>
              ) : (
                <div className="text-xs text-gray-600">Not connected</div>
              )}
            </div>
          </div>
          {c.connected ? (
            <span title="Coming in V2" className="inline-flex cursor-not-allowed">
              <Button variant="ghost" size="sm" disabled>Disconnect</Button>
            </span>
          ) : (
            <span title="Coming in V2" className="inline-flex cursor-not-allowed">
              <Button variant="secondary" size="sm" disabled>Connect</Button>
            </span>
          )}
        </div>
      ))}
    </Card>
  )
}

// ── Tab 3 — Corpus Documents ────────────────────────────────────────

const DOCUMENT_TYPES = [
  'product_doc',
  'marketing',
  'brand_guideline',
  'company_info',
  'competitor',
  'persona',
  'sales_deck',
  'golden_example',
] as const

// Per-type badge styling (PLAN: product_doc=blue, marketing=purple, etc.).
// golden_example uses a custom gold class since the Badge has no gold variant.
const DOC_TYPE_BADGE: Record<string, { variant: BadgeVariant; className?: string }> = {
  product_doc: { variant: 'blue' },
  marketing: { variant: 'purple' },
  brand_guideline: { variant: 'cyan' },
  company_info: { variant: 'green' },
  competitor: { variant: 'red' },
  persona: { variant: 'orange' },
  sales_deck: { variant: 'amber' },
  golden_example: {
    variant: 'amber',
    className: 'bg-yellow-400/15 text-yellow-300 border-yellow-400/30',
  },
}

type UploadStage = 'uploading' | 'extracting' | 'embedding' | 'done' | 'failed'

const STAGE_LABEL: Record<UploadStage, string> = {
  uploading: 'Uploading…',
  extracting: 'Extracting text…',
  embedding: 'Embedding…',
  done: 'Done',
  failed: 'Upload failed',
}

function CorpusTab() {
  const { data, isLoading } = useDocuments()
  const upload = useUploadDocument()
  const reingest = useReingestDocument()
  const del = useDeleteDocument()
  const fileRef = useRef<HTMLInputElement>(null)
  const [docType, setDocType] = useState<string>('product_doc')
  const [dragOver, setDragOver] = useState(false)
  const [stage, setStage] = useState<UploadStage | null>(null)
  const [uploadPct, setUploadPct] = useState(0)
  const [result, setResult] = useState<{ chunks: number; error?: string } | null>(null)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  function clearTimers() {
    timers.current.forEach(clearTimeout)
    timers.current = []
  }

  function pick(files: FileList | null) {
    const file = files?.[0]
    if (!file) return
    clearTimers()
    setResult(null)
    setUploadPct(0)
    setStage('uploading')

    upload.mutate(
      {
        file,
        documentType: docType,
        onUploadProgress: (pct) => {
          setUploadPct(pct)
          // File fully transferred → server is now extracting, then embedding.
          if (pct >= 100) {
            setStage('extracting')
            timers.current.push(setTimeout(() => setStage('embedding'), 1000))
          }
        },
      },
      {
        onSuccess: (res) => {
          clearTimers()
          if (res.status === 'failed') {
            setStage('failed')
            setResult({ chunks: 0, error: res.error })
          } else {
            setStage('done')
            setResult({ chunks: res.chunk_count })
          }
          timers.current.push(setTimeout(() => { setStage(null); setResult(null) }, 5000))
        },
        onError: (e) => {
          clearTimers()
          setStage('failed')
          setResult({ chunks: 0, error: e instanceof Error ? e.message : 'upload error' })
        },
      },
    )
  }

  const busy = stage != null && stage !== 'done' && stage !== 'failed'

  return (
    <div className="space-y-5">
      <div className="flex items-end gap-3">
        <div className="w-56">
          <Label>Document type</Label>
          <Select value={docType} onChange={(e) => setDocType(e.target.value)} disabled={busy}>
            {DOCUMENT_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </Select>
        </div>
        <p className="pb-2 text-xs text-gray-600">
          Tags every chunk so generation can retrieve by type.
        </p>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); if (!busy) setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); if (!busy) pick(e.dataTransfer.files) }}
        onClick={() => { if (!busy) fileRef.current?.click() }}
        className={`glass-sm flex cursor-pointer flex-col items-center justify-center gap-2 border-2 border-dashed py-10 text-center transition-colors ${dragOver ? 'border-cyan-500/40 bg-cyan-500/[0.04]' : 'border-white/[0.08]'} ${busy ? 'pointer-events-none opacity-70' : ''}`}
      >
        <Upload className="h-6 w-6 text-gray-500" />
        <div className="text-sm text-gray-400">
          Drag &amp; drop or <span className="text-cyan-400">browse</span>
        </div>
        <div className="text-xs text-gray-600">.pdf, .docx, .md, .txt · max 10MB</div>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.docx,.md,.txt"
          className="hidden"
          onChange={(e) => pick(e.target.files)}
        />

        {stage && (
          <div className="mt-3 w-2/3">
            <UploadProgress stage={stage} pct={uploadPct} result={result} />
          </div>
        )}
      </div>

      <Card className="p-2">
        {isLoading ? (
          <div className="space-y-2 p-3">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500">
                <th className="px-4 py-2 text-left font-medium">Filename</th>
                <th className="px-4 py-2 text-left font-medium">Type</th>
                <th className="px-4 py-2 text-left font-medium">Ingested</th>
                <th className="px-4 py-2 text-right font-medium">Chunks</th>
                <th className="px-4 py-2 text-right font-medium">Ver</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((doc) => {
                const badge = DOC_TYPE_BADGE[doc.documentType] ?? { variant: 'gray' as BadgeVariant }
                const failed = doc.extractionStatus === 'failed'
                const reingesting = reingest.isPending && reingest.variables === doc.id
                return (
                  <tr key={doc.id} className="border-t border-white/[0.04]">
                    <td className="px-4 py-2.5 text-gray-200">{doc.sourceFilename}</td>
                    <td className="px-4 py-2.5">
                      <Badge variant={badge.variant} className={badge.className}>
                        {doc.documentType}
                      </Badge>
                      {failed && (
                        <Badge variant="red" className="ml-1">failed</Badge>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-500">
                      {new Date(doc.ingestedAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-400">
                      {doc.chunkCount} <span className="text-xs text-gray-600">chunks</span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-400">v{doc.version}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Re-ingest"
                          disabled={reingesting}
                          onClick={() => reingest.mutate(doc.id)}
                        >
                          <RefreshCw className={`h-3.5 w-3.5 ${reingesting ? 'animate-spin' : ''}`} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Delete"
                          disabled={del.isPending && del.variables === doc.id}
                          onClick={() => del.mutate(doc.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-red-400" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}

const STAGE_ORDER: UploadStage[] = ['uploading', 'extracting', 'embedding']

function UploadProgress({
  stage,
  pct,
  result,
}: {
  stage: UploadStage
  pct: number
  result: { chunks: number; error?: string } | null
}) {
  if (stage === 'done') {
    return (
      <div className="flex items-center justify-center gap-1.5 text-sm text-emerald-400">
        <CheckCircle2 className="h-4 w-4" />
        Done — {result?.chunks ?? 0} chunks created
      </div>
    )
  }
  if (stage === 'failed') {
    return (
      <div className="text-sm text-red-400">
        {STAGE_LABEL.failed}{result?.error ? ` — ${result.error}` : ''}
      </div>
    )
  }
  const activeIdx = STAGE_ORDER.indexOf(stage)
  // Bar fills with real transfer % during upload, then advances per stage.
  const barPct = stage === 'uploading' ? pct : Math.round(((activeIdx + 1) / STAGE_ORDER.length) * 100)
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-center gap-1.5 text-xs text-gray-400">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {STAGE_LABEL[stage]}
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all"
          style={{ width: `${barPct}%` }}
        />
      </div>
    </div>
  )
}

// ── Tab 4 — Posting Schedule ────────────────────────────────────────

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

interface ChannelSchedule {
  postsPerWeek: number
  days: string[]
  time: string
}

function ScheduleTab() {
  const { data: campaigns, isLoading } = useCampaigns()
  const patch = usePatchCampaign()
  const tz = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    [],
  )
  const evergreen = useMemo(
    () => campaigns?.find((c) => c.type === 'evergreen') ?? campaigns?.[0],
    [campaigns],
  )

  const [config, setConfig] = useState<Record<string, ChannelSchedule>>({})
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!evergreen) return
    const cfg = evergreen.channelConfig as Record<string, Partial<ChannelSchedule>>
    const next: Record<string, ChannelSchedule> = {}
    const keys = Object.keys(cfg).length ? Object.keys(cfg) : evergreen.channels
    for (const k of keys) {
      next[k] = {
        postsPerWeek: cfg[k]?.postsPerWeek ?? 3,
        days: cfg[k]?.days ?? ['Mon', 'Wed', 'Fri'],
        time: cfg[k]?.time ?? '09:00',
      }
    }
    if (!Object.keys(next).length) {
      next.linkedin = { postsPerWeek: 3, days: ['Mon', 'Wed', 'Fri'], time: '09:00' }
    }
    setConfig(next)
  }, [evergreen])

  if (isLoading) return <Skeleton className="h-96 rounded-2xl" />

  function update(ch: string, partial: Partial<ChannelSchedule>) {
    setConfig((prev) => ({ ...prev, [ch]: { ...prev[ch], ...partial } }))
  }

  function toggleDay(ch: string, day: string) {
    const days = config[ch].days
    update(ch, {
      days: days.includes(day) ? days.filter((d) => d !== day) : [...days, day],
    })
  }

  function onSave() {
    if (!evergreen) return
    patch.mutate(
      { id: evergreen.id, patch: { channelConfig: config } },
      { onSuccess: () => { setSaved(true); setTimeout(() => setSaved(false), 2500) } },
    )
  }

  return (
    <Card className="space-y-5 p-6">
      <div className="text-xs text-gray-500">
        Cadence for the default evergreen campaign · timezone{' '}
        <span className="text-gray-300">{tz}</span>
      </div>

      {SELECTABLE_CHANNELS.filter((c) => c.kind !== 'blog' || true).map((ch) => {
        const sched = config[ch.key]
        const enabled = !!sched
        return (
          <div
            key={ch.key}
            className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4"
          >
            <div className="flex items-center justify-between">
              <Checkbox
                checked={enabled}
                onChange={(v) =>
                  v
                    ? update(ch.key, { postsPerWeek: 3, days: ['Mon', 'Wed', 'Fri'], time: '09:00' })
                    : setConfig((prev) => {
                        const next = { ...prev }
                        delete next[ch.key]
                        return next
                      })
                }
                label={ch.label}
              />
              {enabled && (
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <Input
                    type="number"
                    min={1}
                    max={21}
                    value={sched.postsPerWeek}
                    onChange={(e) => update(ch.key, { postsPerWeek: Number(e.target.value) })}
                    className="h-8 w-16 px-2 py-1 text-center"
                  />
                  /week
                  <Input
                    type="time"
                    value={sched.time}
                    onChange={(e) => update(ch.key, { time: e.target.value })}
                    className="h-8 w-28 px-2 py-1"
                  />
                </div>
              )}
            </div>
            {enabled && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {DOW.map((d) => (
                  <button
                    key={d}
                    onClick={() => toggleDay(ch.key, d)}
                    className={`rounded-lg px-2.5 py-1 text-xs transition-colors ${
                      sched.days.includes(d)
                        ? 'bg-cyan-500/15 text-cyan-300'
                        : 'bg-white/[0.04] text-gray-500 hover:bg-white/[0.08]'
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}

      <div className="flex items-center gap-3">
        <Button onClick={onSave} disabled={patch.isPending || !evergreen}>
          {patch.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save schedule
        </Button>
        {saved && (
          <span className="flex items-center gap-1 text-sm text-emerald-400">
            <CheckCircle2 className="h-4 w-4" /> Saved
          </span>
        )}
      </div>
    </Card>
  )
}
