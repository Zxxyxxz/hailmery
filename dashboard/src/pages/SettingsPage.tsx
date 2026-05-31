import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
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
import { api } from '@/lib/api'
import { useTenant } from '@/lib/tenant-context'
import {
  useCampaigns,
  useConnections,
  useDocuments,
  usePatchCampaign,
  usePatchSiteConfig,
  useSiteConfig,
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
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { TagInput } from '@/components/ui/tag-input'

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
            <Button variant="ghost" size="sm">Disconnect</Button>
          ) : (
            <Button variant="secondary" size="sm">Connect</Button>
          )}
        </div>
      ))}
    </Card>
  )
}

// ── Tab 3 — Corpus Documents ────────────────────────────────────────

function CorpusTab() {
  const { currentId } = useTenant()
  const { data, isLoading } = useDocuments()
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData()
      form.append('file', file)
      const res = await api.post('/api/documents/upload', form, {
        onUploadProgress: (e) => {
          if (e.total) setProgress(Math.round((e.loaded / e.total) * 100))
        },
      })
      return res.data
    },
    onSettled: () => {
      setProgress(null)
      qc.invalidateQueries({ queryKey: ['documents', currentId] })
    },
  })

  const del = useMutation({
    mutationFn: async (id: string) => api.delete(`/api/documents/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['documents', currentId] }),
  })

  function pick(files: FileList | null) {
    const f = files?.[0]
    if (f) {
      setProgress(0)
      upload.mutate(f)
    }
  }

  return (
    <div className="space-y-5">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); pick(e.dataTransfer.files) }}
        onClick={() => fileRef.current?.click()}
        className={`glass-sm flex cursor-pointer flex-col items-center justify-center gap-2 border-2 border-dashed py-10 text-center transition-colors ${dragOver ? 'border-cyan-500/40 bg-cyan-500/[0.04]' : 'border-white/[0.08]'}`}
      >
        <Upload className="h-6 w-6 text-gray-500" />
        <div className="text-sm text-gray-400">
          Drag &amp; drop or <span className="text-cyan-400">browse</span>
        </div>
        <div className="text-xs text-gray-600">.pdf, .docx, .md, .txt</div>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.docx,.md,.txt"
          className="hidden"
          onChange={(e) => pick(e.target.files)}
        />
        {progress != null && (
          <div className="mt-3 w-2/3">
            <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
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
              {(data ?? []).map((doc) => (
                <tr key={doc.id} className="border-t border-white/[0.04]">
                  <td className="px-4 py-2.5 text-gray-200">{doc.sourceFilename}</td>
                  <td className="px-4 py-2.5">
                    <Badge variant="gray">{doc.documentType}</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-500">
                    {new Date(doc.ingestedAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-400">{doc.chunkCount}</td>
                  <td className="px-4 py-2.5 text-right text-gray-400">v{doc.version}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" title="Re-ingest">
                        <RefreshCw className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Delete"
                        onClick={() => del.mutate(doc.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-red-400" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
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
