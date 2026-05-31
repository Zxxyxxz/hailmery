import { useState } from 'react'
import {
  Plus,
  Pause,
  Play,
  Pencil,
  Target,
  Rocket,
  AlertTriangle,
  Loader2,
} from 'lucide-react'
import { useCampaigns, useCreateCampaign, usePatchCampaign } from '@/lib/queries'
import type {
  Campaign,
  CampaignGoalType,
  CampaignType,
  CreateCampaignInput,
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

  return (
    <div className="animate-fade-in space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">Campaigns</h1>
          <p className="mt-1 text-sm text-gray-500">
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

      {!isLoading && !isError && (
        <div className="grid gap-4 md:grid-cols-2">
          {(campaigns ?? []).map((c) => (
            <CampaignCard key={c.id} campaign={c} />
          ))}
        </div>
      )}

      <NewCampaignDialog open={open} onClose={() => setOpen(false)} />
    </div>
  )
}

function CampaignCard({ campaign }: { campaign: Campaign }) {
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
          <div className="flex items-center gap-1 text-right text-xs text-gray-500">
            <Rocket className="h-3.5 w-3.5" />
            {new Date(campaign.launchDate).toLocaleDateString()}
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center gap-1.5 text-sm text-gray-400">
        <Target className="h-4 w-4 text-gray-500" />
        {goalValue > 0 ? (
          <span>
            <span className="font-semibold text-gray-200">{goalValue}</span>{' '}
            {campaign.goalType}
          </span>
        ) : (
          <span className="text-gray-600">No goal set</span>
        )}
      </div>

      {goalValue > 0 && (
        <div className="mt-2">
          <Progress value={campaign.attributedLeads} max={goalValue} />
          <div className="mt-1 text-right text-xs text-gray-500">
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

      <div className="mt-4 flex flex-wrap gap-3 text-xs text-gray-500">
        <span><span className="text-amber-300">{campaign.counts.pending}</span> pending</span>
        <span><span className="text-emerald-300">{campaign.counts.approved}</span> approved</span>
        <span><span className="text-cyan-300">{campaign.counts.published}</span> published</span>
        <span><span className="text-gray-300">{campaign.counts.total}</span> total</span>
      </div>

      <div className="mt-5 flex items-center gap-2 border-t border-white/[0.06] pt-4">
        <Button variant="secondary" size="sm">
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
          <div className="space-y-2 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
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
                    <div className="flex items-center gap-2 text-xs text-gray-500">
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
