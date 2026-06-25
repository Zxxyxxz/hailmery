import { useEffect, useState } from 'react'
import {
  Plus,
  Pause,
  Play,
  Pencil,
  Target,
  Rocket,
  AlertTriangle,
  Loader2,
  Newspaper,
  RefreshCw,
  Sparkles,
  CheckCircle2,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Megaphone,
} from 'lucide-react'
import {
  useCampaigns,
  useCreateCampaign,
  usePatchCampaign,
  useIntelligence,
  useRefreshIntelligence,
  useGenerateNow,
} from '@/lib/queries'
import type {
  Campaign,
  CampaignGoalType,
  CampaignType,
  CreateCampaignInput,
  IntelligenceTopic,
  TopicUrgency,
} from '@/lib/types'
import { ChannelIcon } from '@/components/ChannelIcon'
import { SELECTABLE_CHANNELS } from '@/lib/channels'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'

const TYPE_VARIANT: Record<CampaignType, BadgeProps['variant']> = {
  product_launch: 'purple',
  lead_gen: 'blue',
  evergreen: 'green',
  event: 'orange',
  reactive: 'red',
}

const STATUS_VARIANT: Record<Campaign['status'], BadgeProps['variant']> = {
  draft: 'gray',
  active: 'green',
  paused: 'amber',
  completed: 'cyan',
}

const TYPE_LABEL: Record<CampaignType, string> = {
  product_launch: 'Product launch',
  lead_gen: 'Lead gen',
  evergreen: 'Evergreen',
  event: 'Event',
  reactive: 'Reactive',
}

export default function Campaigns() {
  const { data: campaigns, isLoading, isError } = useCampaigns()
  const [open, setOpen] = useState(false)
  const [topic, setTopic] = useState<IntelligenceTopic | null>(null)
  const [editing, setEditing] = useState<Campaign | null>(null)

  return (
    <div className="animate-fade-in space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-100">
            Campaigns
          </h1>
          <p className="mt-1 text-sm text-[#94a3b8]">
            Goals, cadence, and progress across every active initiative
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" />
          New Campaign
        </Button>
      </header>

      {isError && (
        <div className="glass-sm flex items-center gap-3 border-red-500/20 p-5 text-sm text-red-300">
          <AlertTriangle className="h-5 w-5" />
          Failed to load campaigns.
        </div>
      )}

      {isLoading && (
        <div className="grid gap-4 md:grid-cols-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-56 rounded-2xl" />
          ))}
        </div>
      )}

      {!isLoading && !isError && (campaigns ?? []).length === 0 && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-[#1e1e2e] bg-[#0f0f1a] px-6 py-14 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#7c3aed]/15">
            <Megaphone className="h-6 w-6 text-violet-300" />
          </div>
          <h2 className="text-sm font-semibold text-gray-100">No campaigns yet</h2>
          <p className="max-w-sm text-sm text-[#94a3b8]">
            Spin up your first campaign to set a goal, channels, and cadence —
            generation kicks off on the first batch.
          </p>
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" />
            New Campaign
          </Button>
        </div>
      )}

      {!isLoading && !isError && (campaigns ?? []).length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {(campaigns ?? []).map((c) => (
            <CampaignCard key={c.id} campaign={c} onEdit={(camp) => setEditing(camp)} />
          ))}
        </div>
      )}

      <TopicsCard onPick={(t) => setTopic(t)} />

      <NewCampaignDialog open={open} onClose={() => setOpen(false)} />
      <EditCampaignDialog campaign={editing} onClose={() => setEditing(null)} />
      <CreateNowDialog topic={topic} onClose={() => setTopic(null)} />
    </div>
  )
}

// ── This week's topics (weekly intelligence brief) ──────────────────

const URGENCY_VARIANT: Record<TopicUrgency, BadgeProps['variant']> = {
  breaking: 'red',
  trending: 'amber',
  evergreen: 'green',
}

function TopicsCard({ onPick }: { onPick: (t: IntelligenceTopic) => void }) {
  const { data: brief, isLoading, isError } = useIntelligence()
  const refresh = useRefreshIntelligence()
  const [expanded, setExpanded] = useState(false)

  const topics = brief?.topics ?? []
  const weekLabel = brief?.weekOf
    ? new Date(brief.weekOf).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      })
    : null

  return (
    <section className="rounded-lg border border-[#1e1e2e] bg-[#0a0a0f]">
      <div className="flex w-full items-center justify-between gap-3 p-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-2 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40"
        >
          <Newspaper className="h-4 w-4 shrink-0 text-violet-300" />
          <span className="truncate text-sm font-semibold text-[#f1f5f9]">
            This week&apos;s topics
          </span>
          {topics.length > 0 && (
            <span className="shrink-0 text-xs text-violet-300">
              {topics.length} {topics.length === 1 ? 'topic' : 'topics'}
            </span>
          )}
          {weekLabel && (
            <span className="hidden shrink-0 text-xs text-[#94a3b8] sm:inline">
              · week of {weekLabel}
            </span>
          )}
          {expanded ? (
            <ChevronUp className="ml-auto h-4 w-4 shrink-0 text-[#64748b]" />
          ) : (
            <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-[#64748b]" />
          )}
        </button>
        <button
          type="button"
          onClick={() => {
            if (!refresh.isPending) refresh.mutate()
          }}
          disabled={refresh.isPending}
          title="Re-research this week's AI-security news"
          className="flex shrink-0 items-center gap-1.5 rounded-md border border-[#1e1e2e] px-2 py-1 text-xs text-[#94a3b8] transition-colors hover:bg-white/[0.06] hover:text-[#f1f5f9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 disabled:opacity-50"
        >
          {refresh.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {refresh.isPending ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {expanded && (
        <div className="border-t border-[#1e1e2e] p-3">
          {(isLoading || refresh.isPending) && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-28 rounded-xl" />
              ))}
            </div>
          )}

          {isError && !refresh.isPending && (
            <p className="text-sm text-red-300">
              Failed to load this week&apos;s topics.
            </p>
          )}

          {!isLoading && !isError && !refresh.isPending && topics.length === 0 && (
            <div className="rounded-xl border border-dashed border-[#1e1e2e] p-6 text-center text-sm text-[#94a3b8]">
              No intelligence brief yet. Hit{' '}
              <span className="text-gray-300">Refresh</span> to research this
              week&apos;s AI-security news.
            </div>
          )}

          {!refresh.isPending && topics.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {topics.map((t, i) => (
                <button
                  key={i}
                  onClick={() => onPick(t)}
                  className="group flex flex-col rounded-xl border border-[#1e1e2e] bg-white/[0.02] p-3.5 text-left transition-colors hover:border-[#7c3aed]/40 hover:bg-white/[0.04]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant={URGENCY_VARIANT[t.urgency]}>{t.urgency}</Badge>
                    <span className="text-[10px] uppercase tracking-wide text-[#64748b]">
                      {t.suggested_channel}
                    </span>
                  </div>
                  <h3 className="mt-2 line-clamp-2 text-sm font-semibold text-gray-100">
                    {t.topic}
                  </h3>
                  <p className="mt-1 line-clamp-2 text-xs text-[#94a3b8]">
                    {t.why_relevant || t.source_summary}
                  </p>
                  <span className="mt-2 inline-flex items-center gap-1 text-xs text-violet-300 opacity-0 transition-opacity group-hover:opacity-100">
                    Create now <ArrowRight className="h-3 w-3" />
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

// ── Create now (one-shot generation from a topic) ───────────────────

const NOW_CHANNELS = [
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'x', label: 'X' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'tiktok', label: 'TikTok' },
  { key: 'gbp', label: 'Google Business' },
]

function defaultChannel(suggested: string | undefined): string {
  return NOW_CHANNELS.some((c) => c.key === suggested) ? (suggested as string) : 'linkedin'
}

function CreateNowDialog({
  topic,
  onClose,
}: {
  topic: IntelligenceTopic | null
  onClose: () => void
}) {
  const generate = useGenerateNow()
  const [topicText, setTopicText] = useState('')
  const [tone, setTone] = useState('')
  const [channel, setChannel] = useState('linkedin')

  // Re-seed the form whenever a new topic is picked.
  useEffect(() => {
    if (!topic) return
    setTopicText(topic.topic)
    setTone(topic.angle)
    setChannel(defaultChannel(topic.suggested_channel))
    generate.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic])

  function close() {
    onClose()
  }

  function submit() {
    generate.mutate({
      topic: topicText.trim(),
      channel,
      toneOverride: tone.trim() || undefined,
    })
  }

  const result = generate.data

  return (
    <Dialog
      open={topic !== null}
      onClose={close}
      className="max-w-lg"
      title="Create now"
      description="Generate a draft from this topic — it lands in the review queue."
    >
      <div className="space-y-4 p-6 pt-2">
        {result ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-emerald-300">
              <CheckCircle2 className="h-5 w-5" />
              Draft created
              {typeof result.guardianScore === 'number'
                ? ` — guardian score ${result.guardianScore.toFixed(2)}`
                : ''}
              . It’s in the review queue
              {result.imageGenerated ? ' with a paired image' : ''}.
            </div>
            <div className="flex justify-end">
              <Button onClick={close}>Done</Button>
            </div>
          </div>
        ) : (
          <>
            <div>
              <Label>Topic</Label>
              <Input
                value={topicText}
                onChange={(e) => setTopicText(e.target.value)}
                placeholder="Topic to write about…"
              />
            </div>
            <div>
              <Label>Tone override (angle)</Label>
              <Textarea
                rows={3}
                value={tone}
                onChange={(e) => setTone(e.target.value)}
                placeholder="The specific point of view to take…"
              />
            </div>
            <div>
              <Label>Channel</Label>
              <Select value={channel} onChange={(e) => setChannel(e.target.value)}>
                {NOW_CHANNELS.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </div>

            {generate.isError && (
              <div className="text-sm text-red-400">
                Generation failed. Please try again.
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button
                onClick={submit}
                disabled={!topicText.trim() || generate.isPending}
              >
                {generate.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                Generate draft
              </Button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  )
}

function CampaignCard({
  campaign,
  onEdit,
}: {
  campaign: Campaign
  onEdit: (c: Campaign) => void
}) {
  const patch = usePatchCampaign()
  const goalValue = campaign.goalValue ?? 0
  const paused = campaign.status === 'paused'

  function togglePause() {
    patch.mutate({
      id: campaign.id,
      patch: { status: paused ? 'active' : 'paused' },
    })
  }

  return (
    <Card className="flex flex-col p-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-gray-100">
            {campaign.name}
          </h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge variant={TYPE_VARIANT[campaign.type]}>
              {TYPE_LABEL[campaign.type]}
            </Badge>
            <Badge variant={STATUS_VARIANT[campaign.status]}>
              {campaign.status}
            </Badge>
          </div>
        </div>
        {campaign.type === 'product_launch' && campaign.launchDate && (
          <div className="flex items-center gap-1 text-right text-xs text-[#94a3b8]">
            <Rocket className="h-3.5 w-3.5" />
            {new Date(campaign.launchDate).toLocaleDateString()}
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center gap-1.5 text-sm text-[#94a3b8]">
        <Target className="h-4 w-4 text-[#94a3b8]" />
        {goalValue > 0 ? (
          <span>
            <span className="font-semibold text-gray-200">{goalValue}</span>{' '}
            {campaign.goalType}
          </span>
        ) : (
          <span className="text-[#64748b]">No goal set</span>
        )}
      </div>

      {goalValue > 0 && (
        <div className="mt-2">
          <Progress value={campaign.attributedLeads} max={goalValue} />
          <div className="mt-1 text-right text-xs text-[#94a3b8]">
            {campaign.attributedLeads} / {goalValue} attributed
          </div>
        </div>
      )}

      {campaign.channels.length > 0 && (
        <div className="mt-4 flex items-center gap-2">
          {campaign.channels.map((ch) => (
            <ChannelIcon key={ch} channel={ch} />
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-3 text-xs text-[#94a3b8]">
        <span><span className="text-amber-300">{campaign.counts.pending}</span> pending</span>
        <span><span className="text-emerald-300">{campaign.counts.approved}</span> approved</span>
        <span><span className="text-violet-300">{campaign.counts.published}</span> published</span>
        <span><span className="text-gray-300">{campaign.counts.total}</span> total</span>
      </div>

      <div className="mt-5 flex items-center gap-2 border-t border-white/[0.06] pt-4">
        <Button variant="secondary" size="sm" onClick={() => onEdit(campaign)}>
          <Pencil className="h-4 w-4" />
          Edit
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={togglePause}
          disabled={patch.isPending}
        >
          {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
          {paused ? 'Resume' : 'Pause'}
        </Button>
      </div>
    </Card>
  )
}

const GOAL_TYPES: CampaignGoalType[] = [
  'demo_requests',
  'signups',
  'followers',
  'impressions',
  'custom',
]
const CAMPAIGN_TYPES: CampaignType[] = [
  'product_launch',
  'lead_gen',
  'evergreen',
  'event',
  'reactive',
]
const LANGUAGES = ['English', 'Turkish', 'German', 'Arabic', 'Auto-detect from audience']

function NewCampaignDialog({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const create = useCreateCampaign()
  const [name, setName] = useState('')
  const [type, setType] = useState<CampaignType>('evergreen')
  const [goalType, setGoalType] = useState<CampaignGoalType>('demo_requests')
  const [goalValue, setGoalValue] = useState('')
  const [launchDate, setLaunchDate] = useState('')
  const [audienceBrief, setAudienceBrief] = useState('')
  const [language, setLanguage] = useState(LANGUAGES[0])
  const [voiceModifier, setVoiceModifier] = useState('')
  const [channels, setChannels] = useState<Record<string, number>>({})

  function toggleChannel(key: string) {
    setChannels((prev) => {
      const next = { ...prev }
      if (key in next) delete next[key]
      else next[key] = 3
      return next
    })
  }

  function setFreq(key: string, n: number) {
    setChannels((prev) => ({ ...prev, [key]: n }))
  }

  function reset() {
    setName('')
    setType('evergreen')
    setGoalType('demo_requests')
    setGoalValue('')
    setLaunchDate('')
    setAudienceBrief('')
    setLanguage(LANGUAGES[0])
    setVoiceModifier('')
    setChannels({})
  }

  function submit() {
    const channelConfig: CreateCampaignInput['channelConfig'] = {}
    for (const [k, v] of Object.entries(channels)) {
      channelConfig[k] = { postsPerWeek: v }
    }
    const input: CreateCampaignInput = {
      name: name.trim(),
      type,
      goalType,
      goalValue: goalValue ? Number(goalValue) : null,
      launchDate: type === 'product_launch' && launchDate ? launchDate : null,
      audienceBrief: audienceBrief.trim(),
      language,
      channels: Object.keys(channels),
      voiceModifier: voiceModifier.trim(),
      channelConfig,
    }
    create.mutate(input, {
      onSuccess: () => {
        reset()
        onClose()
      },
    })
  }

  const canSubmit = name.trim().length > 0 && Object.keys(channels).length > 0

  return (
    <Dialog
      open={open}
      onClose={onClose}
      className="max-w-xl"
      title="New campaign"
      description="Define the goal and cadence — generation kicks off on the first batch."
    >
      <div className="space-y-4 p-6 pt-2">
        <div>
          <Label>Name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. NIS2 readiness push"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Type</Label>
            <Select
              value={type}
              onChange={(e) => setType(e.target.value as CampaignType)}
            >
              {CAMPAIGN_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
          </div>
          {type === 'product_launch' && (
            <div>
              <Label>Launch date</Label>
              <Input
                type="date"
                value={launchDate}
                onChange={(e) => setLaunchDate(e.target.value)}
              />
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Goal type</Label>
            <Select
              value={goalType}
              onChange={(e) => setGoalType(e.target.value as CampaignGoalType)}
            >
              {GOAL_TYPES.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Goal value</Label>
            <Input
              type="number"
              min={0}
              value={goalValue}
              onChange={(e) => setGoalValue(e.target.value)}
              placeholder="e.g. 5"
            />
          </div>
        </div>

        <div>
          <Label>Audience brief</Label>
          <Textarea
            rows={3}
            value={audienceBrief}
            onChange={(e) => setAudienceBrief(e.target.value)}
            placeholder="Describe the target audience…"
          />
        </div>

        <div>
          <Label>Language</Label>
          <Select value={language} onChange={(e) => setLanguage(e.target.value)}>
            {LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label>Channels &amp; weekly cadence</Label>
          <div className="space-y-2 rounded-xl border border-[#1e1e2e] bg-white/[0.02] p-3">
            {SELECTABLE_CHANNELS.map((ch) => {
              const active = ch.key in channels
              return (
                <div key={ch.key} className="flex items-center justify-between">
                  <Checkbox
                    checked={active}
                    onChange={() => toggleChannel(ch.key)}
                    label={ch.label}
                  />
                  {active && (
                    <div className="flex items-center gap-2 text-xs text-[#94a3b8]">
                      <Input
                        type="number"
                        min={1}
                        max={21}
                        value={channels[ch.key]}
                        onChange={(e) => setFreq(ch.key, Number(e.target.value))}
                        className="h-8 w-16 px-2 py-1 text-center"
                      />
                      /week
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        <div>
          <Label>Voice modifier (optional)</Label>
          <Input
            value={voiceModifier}
            onChange={(e) => setVoiceModifier(e.target.value)}
            placeholder='e.g. "more urgent", "more technical"'
          />
        </div>

        {create.isError && (
          <div className="text-sm text-red-400">
            Failed to create campaign. Please try again.
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit || create.isPending}>
            {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Create &amp; generate
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

// ── Edit campaign ────────────────────────────────────────────────────
// Reuses the create-dialog field patterns but edits only the safe, content-
// facing fields (name / type / audience / voice / active|paused). launch date,
// goals, channels and system fields are intentionally out of scope here.

function EditCampaignDialog({
  campaign,
  onClose,
}: {
  campaign: Campaign | null
  onClose: () => void
}) {
  const patch = usePatchCampaign()
  const [name, setName] = useState('')
  const [type, setType] = useState<CampaignType>('evergreen')
  const [audienceBrief, setAudienceBrief] = useState('')
  const [voiceModifier, setVoiceModifier] = useState('')
  const [status, setStatus] = useState<'active' | 'paused'>('active')

  // Re-seed the form whenever a different campaign is opened. audienceBrief is
  // stored as jsonb { text } on the server, so recover the string from .text.
  useEffect(() => {
    if (!campaign) return
    setName(campaign.name)
    setType(campaign.type)
    const brief = campaign.audienceBrief as { text?: unknown } | null
    setAudienceBrief(typeof brief?.text === 'string' ? brief.text : '')
    setVoiceModifier(campaign.voiceModifier ?? '')
    setStatus(campaign.status === 'paused' ? 'paused' : 'active')
    patch.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaign])

  function submit() {
    if (!campaign) return
    patch.mutate(
      {
        id: campaign.id,
        patch: {
          name: name.trim(),
          type,
          audienceBrief: audienceBrief.trim(),
          voiceModifier: voiceModifier.trim() || null,
          status,
        },
      },
      { onSuccess: () => onClose() },
    )
  }

  const canSubmit = name.trim().length > 0

  return (
    <Dialog
      open={campaign !== null}
      onClose={onClose}
      className="max-w-xl"
      title="Edit campaign"
      description="Update targeting and voice. Status pauses or resumes generation."
    >
      <div className="space-y-4 p-6 pt-2">
        <div>
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Type</Label>
            <Select
              value={type}
              onChange={(e) => setType(e.target.value as CampaignType)}
            >
              {CAMPAIGN_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Status</Label>
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value as 'active' | 'paused')}
            >
              <option value="active">active</option>
              <option value="paused">paused</option>
            </Select>
          </div>
        </div>

        <div>
          <Label>Audience brief</Label>
          <Textarea
            rows={3}
            value={audienceBrief}
            onChange={(e) => setAudienceBrief(e.target.value)}
            placeholder="Describe the target audience…"
          />
        </div>

        <div>
          <Label>Voice modifier (optional)</Label>
          <Input
            value={voiceModifier}
            onChange={(e) => setVoiceModifier(e.target.value)}
            placeholder='e.g. "more urgent", "more technical"'
          />
        </div>

        {patch.isError && (
          <div className="text-sm text-red-400">
            Failed to save changes. Please try again.
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit || patch.isPending}>
            {patch.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Save changes
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
