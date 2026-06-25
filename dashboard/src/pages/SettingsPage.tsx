import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
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
  DownloadCloud,
  Sparkles,
  AlertTriangle,
  Check,
  KeyRound,
  Copy,
  ShieldCheck,
  Eye,
  EyeOff,
  Lock,
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useTenant } from '@/lib/tenant-context'
import { toApiError, API_BASE_URL } from '@/lib/api'
import {
  useCampaigns,
  useConnections,
  useConnectPlatform,
  useDeleteDocument,
  useDisconnectPlatform,
  useDocuments,
  useDomainAuth,
  useImportBufferHistory,
  usePatchCampaign,
  usePatchSiteConfig,
  useReingestDocument,
  useSiteConfig,
  useUploadDocument,
  useVerifyDomain,
} from '@/lib/queries'
import type {
  BrandVoice,
  BufferImportResult,
  DocumentRow,
  DomainAuthRecord,
  PlatformConnection,
} from '@/lib/types'
import { CHANNELS, SELECTABLE_CHANNELS } from '@/lib/channels'
import { PLATFORMS, type PlatformDef } from '@/lib/platforms'
import { formatTimeAgo } from '@/lib/format'
import { Dialog } from '@/components/ui/dialog'
import { Toast, type ToastState } from '@/components/ui/toast'
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

const SETTINGS_TABS = ['brand', 'platforms', 'corpus', 'history', 'schedule']

export default function SettingsPage() {
  const [searchParams] = useSearchParams()
  // Honour a ?tab= deep link (e.g. the guardian breakdown's "set up to unlock"
  // links point here). Falls back to the Brand Voice tab.
  const requested = searchParams.get('tab')
  const [tab, setTab] = useState(requested && SETTINGS_TABS.includes(requested) ? requested : 'brand')
  useEffect(() => {
    const t = searchParams.get('tab')
    if (t && SETTINGS_TABS.includes(t)) setTab(t)
  }, [searchParams])
  return (
    <div className="animate-fade-in space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-[#f1f5f9]">Settings</h1>
        <p className="mt-1 text-sm text-[#94a3b8]">
          Brand voice, connected platforms, corpus, and cadence
        </p>
      </header>

      <Tabs value={tab} onValueChange={setTab}>
        <div className="overflow-x-auto no-scrollbar">
          <TabsList className="flex-nowrap whitespace-nowrap">
            <TabsTrigger value="brand">
              <span className="flex items-center gap-1.5"><Mic className="h-4 w-4" /> Brand Voice</span>
            </TabsTrigger>
            <TabsTrigger value="platforms">
              <span className="flex items-center gap-1.5"><Plug className="h-4 w-4" /> Platforms</span>
            </TabsTrigger>
            <TabsTrigger value="corpus">
              <span className="flex items-center gap-1.5"><FileText className="h-4 w-4" /> Corpus</span>
            </TabsTrigger>
            <TabsTrigger value="history">
              <span className="flex items-center gap-1.5"><DownloadCloud className="h-4 w-4" /> Import History</span>
            </TabsTrigger>
            <TabsTrigger value="schedule">
              <span className="flex items-center gap-1.5"><CalendarClock className="h-4 w-4" /> Schedule</span>
            </TabsTrigger>
          </TabsList>
        </div>

        <div className="mt-6">
          <TabsContent value="brand"><BrandVoiceTab /></TabsContent>
          <TabsContent value="platforms"><PlatformsTab /></TabsContent>
          <TabsContent value="corpus"><CorpusTab /></TabsContent>
          <TabsContent value="history"><ImportHistoryTab /></TabsContent>
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
  const [audience, setAudience] = useState('')
  const [preferred, setPreferred] = useState<string[]>([])
  const [avoid, setAvoid] = useState<string[]>([])
  const [good, setGood] = useState('')
  const [bad, setBad] = useState('')
  const [saved, setSaved] = useState(false)
  // Baseline of the hydrated server values, used for dirty detection + discard.
  const [baseline, setBaseline] = useState<{
    tone: string
    audience: string
    preferred: string[]
    avoid: string[]
    good: string
    bad: string
  } | null>(null)

  useEffect(() => {
    if (!data) return
    const bv = data.brandVoice
    const next = {
      tone: String(bv.tone ?? ''),
      audience: String(bv.audience ?? ''),
      preferred: (bv.preferredTerms as string[]) ?? (bv.always as string[]) ?? [],
      avoid: (bv.avoidTerms as string[]) ?? (bv.avoid as string[]) ?? [],
      good: ((bv.goodExamples as string[]) ?? []).join('\n'),
      bad: ((bv.badExamples as string[]) ?? []).join('\n'),
    }
    setTone(next.tone)
    setAudience(next.audience)
    setPreferred(next.preferred)
    setAvoid(next.avoid)
    setGood(next.good)
    setBad(next.bad)
    setBaseline(next)
  }, [data])

  if (isLoading || !data) return <Skeleton className="h-96 rounded-2xl" />

  const isDirty =
    !!baseline &&
    (tone !== baseline.tone ||
      JSON.stringify(preferred) !== JSON.stringify(baseline.preferred) ||
      JSON.stringify(avoid) !== JSON.stringify(baseline.avoid) ||
      good !== baseline.good ||
      bad !== baseline.bad)

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
      {
        onSuccess: () => {
          setSaved(true)
          setTimeout(() => setSaved(false), 2500)
          // Re-baseline so the sticky bar dismisses after a successful save.
          setBaseline({
            tone,
            audience,
            preferred,
            avoid,
            good,
            bad,
          })
        },
      },
    )
  }

  function onDiscard() {
    if (!baseline) return
    setTone(baseline.tone)
    setAudience(baseline.audience)
    setPreferred(baseline.preferred)
    setAvoid(baseline.avoid)
    setGood(baseline.good)
    setBad(baseline.bad)
  }

  const toneOptions = TONES.includes(tone) || !tone ? TONES : [tone, ...TONES]

  // Client-side voice preview — derive a sample line from local state only.
  const previewSentence = (() => {
    if (!tone && !audience && preferred.length === 0) return null
    const term = preferred[0]
    const aud = audience ? ` for ${audience}` : ''
    const toneAdj = tone ? `${tone} ` : ''
    const lead = term
      ? `Here's how ${term} changes the game${aud}.`
      : `Here's how we move the needle${aud}.`
    return `In a ${toneAdj}voice${aud ? '' : ' for our audience'}: "${lead}"`
  })()

  return (
    <div className="space-y-0">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-5">
        <Card className="space-y-5 p-6 md:col-span-3">
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
            <Button onClick={onSave} disabled={save.isPending || !isDirty}>
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

        <div className="md:col-span-2">
          <div className="sticky top-4 rounded-lg border border-[#1e1e2e] bg-[#0f0f1a] p-4">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-[#8b5cf6]" />
              <h3 className="text-sm font-semibold text-[#f1f5f9]">Voice preview</h3>
            </div>
            {previewSentence ? (
              <>
                <p className="mt-3 text-sm italic text-[#94a3b8]">{previewSentence}</p>
                {(tone || preferred.length > 0 || avoid.length > 0) && (
                  <div className="mt-4 space-y-2 text-xs">
                    {tone && (
                      <div className="text-[#64748b]">
                        Tone: <span className="text-[#94a3b8]">{tone}</span>
                      </div>
                    )}
                    {preferred.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[#64748b]">Lean into:</span>
                        {preferred.slice(0, 6).map((t) => (
                          <Badge key={t} variant="purple">{t}</Badge>
                        ))}
                      </div>
                    )}
                    {avoid.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[#64748b]">Avoid:</span>
                        {avoid.slice(0, 6).map((t) => (
                          <Badge key={t} variant="red">{t}</Badge>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <p className="mt-3 text-sm text-[#64748b]">
                Save your brand voice settings to see a preview here.
              </p>
            )}
          </div>
        </div>
      </div>

      {isDirty && (
        <div className="sticky bottom-0 z-20 -mx-1 mt-6 flex justify-end gap-3 border-t border-[#1e1e2e] bg-[#0a0a0f]/95 px-1 py-3 backdrop-blur">
          <Button variant="ghost" onClick={onDiscard} disabled={save.isPending}>
            Discard
          </Button>
          <Button onClick={onSave} disabled={save.isPending}>
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save changes
          </Button>
        </div>
      )}
    </div>
  )
}

// ── Tab 2 — Connected Platforms ─────────────────────────────────────

// Friendly text for the error codes the OAuth callback posts back.
const OAUTH_ERROR_LABELS: Record<string, string> = {
  access_denied: 'you cancelled the Google consent screen',
  missing_params: 'Google returned an incomplete response',
  invalid_state: 'the sign-in session expired — try again',
  token_exchange_failed: 'Google rejected the authorization',
  oauth_not_configured: 'Google OAuth is not configured on the server',
  store_failed: 'the credential could not be saved',
  no_refresh_token:
    'Google did not return a refresh token — revoke hailmery at myaccount.google.com → Security → Third-party access, then reconnect',
}
function oauthErrorLabel(code: unknown): string {
  if (typeof code !== 'string') return 'unknown error'
  return OAUTH_ERROR_LABELS[code] ?? code
}

function PlatformsTab() {
  const { data: connections, isLoading } = useConnections()
  const disconnect = useDisconnectPlatform()
  const qc = useQueryClient()
  const { currentId } = useTenant()
  const [connectId, setConnectId] = useState<string | null>(null)
  const [domainOpen, setDomainOpen] = useState(false)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [oauthBusy, setOauthBusy] = useState<string | null>(null)

  const byId = useMemo(
    () => new Map((connections ?? []).map((c) => [c.platform, c])),
    [connections],
  )

  // OAuth (Google) connect — opens the consent flow in a popup and reconciles on
  // the postMessage the callback page sends back. No token ever reaches the
  // browser; we just invalidate the connections query so the card re-renders.
  function connectOAuth(def: PlatformDef) {
    if (!currentId) {
      setToast({ message: 'Select a tenant first', variant: 'error' })
      return
    }
    const url = `${API_BASE_URL}/api/auth/${def.id}/start?tenant=${encodeURIComponent(currentId)}`
    const popup = window.open(url, 'hm-oauth-connect', 'width=560,height=720,scrollbars=yes,resizable=yes')
    if (!popup) {
      setToast({ message: 'Popup blocked — allow popups for this site, then try again.', variant: 'error' })
      return
    }
    setOauthBusy(def.id)
    // Only trust messages from the Worker callback origin (where the popup ends
    // up) — never a same-page or third-window postMessage spoofing a result.
    const expectedOrigin = new URL(API_BASE_URL).origin

    let poll: ReturnType<typeof setInterval>
    let timeout: ReturnType<typeof setTimeout>
    const detach = () => {
      window.removeEventListener('message', handler)
      clearInterval(poll)
      clearTimeout(timeout)
      setOauthBusy(null)
    }
    const finish = () => {
      detach()
      try {
        popup.close()
      } catch {
        /* cross-origin close may throw post-navigation — ignore */
      }
    }
    const handler = (event: MessageEvent) => {
      if (event.origin !== expectedOrigin || event.source !== popup) return
      const data = event.data as { type?: string; account?: string; error?: string } | null
      if (!data || typeof data !== 'object') return
      if (data.type === 'google-oauth-success') {
        finish()
        qc.invalidateQueries({ queryKey: ['connections', currentId] })
        setToast({ message: `${def.name} connected${data.account ? ` · ${data.account}` : ''}` })
      } else if (data.type === 'google-oauth-error') {
        finish()
        setToast({ message: `Connection failed: ${oauthErrorLabel(data.error)}`, variant: 'error' })
      }
    }
    window.addEventListener('message', handler)
    // Recover if the user closes the popup manually (no message arrives).
    poll = setInterval(() => {
      if (popup.closed) finish()
    }, 800)
    // Safety net: only DETACH the listener/poll — never force-close the popup,
    // which would abort a consent the user may still be completing (the signed
    // state is valid for 10 min). The callback self-closes the popup on finish.
    timeout = setTimeout(detach, 12 * 60 * 1000)
  }

  if (isLoading) return <Skeleton className="h-96 rounded-2xl" />

  const connectDef = PLATFORMS.find((p) => p.id === connectId) ?? null
  const sendgrid = byId.get('sendgrid')

  // SendGrid is connected but its sending domain is not authenticated → promote
  // a full-width "Action needed" alert to the top of the tab.
  const domainActionNeeded = !!sendgrid?.connected && sendgrid?.domainVerified !== true
  const sendgridDomain = sendgrid?.domain ?? 'apire.io'

  // Group the catalog by status (Action needed cards aren't a platform group —
  // that alert lives separately above the groups).
  const connectedDefs = PLATFORMS.filter((p) => byId.get(p.id)?.connected)
  const availableDefs = PLATFORMS.filter((p) => p.available && !byId.get(p.id)?.connected)
  const comingSoonDefs = PLATFORMS.filter((p) => !p.available && !byId.get(p.id)?.connected)

  const renderCard = (p: PlatformDef) => (
    <IntegrationCard
      key={p.id}
      def={p}
      status={byId.get(p.id)}
      disconnecting={disconnect.isPending && disconnect.variables === p.id}
      connecting={oauthBusy === p.id}
      onConnect={() =>
        p.connectionType === 'oauth' ? connectOAuth(p) : setConnectId(p.id)
      }
      onAuthDomain={() => setDomainOpen(true)}
      onDisconnect={() =>
        disconnect.mutate(p.id, {
          onSuccess: () => setToast({ message: `${p.name} disconnected` }),
          onError: (e) => setToast({ message: toApiError(e).error, variant: 'error' }),
        })
      }
    />
  )

  return (
    <div className="space-y-8">
      {/* Action needed — promoted email domain-auth warning */}
      {domainActionNeeded && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[#64748b]">Action needed</h3>
          <div className="rounded-lg border border-[#f59e0b]/30 bg-[#f59e0b]/5 p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[#f59e0b]" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-[#f1f5f9]">
                  Action needed: Authenticate {sendgridDomain} for email
                </div>
                <p className="mt-1 text-sm text-[#94a3b8]">
                  Emails currently send from marketing@leadorch.io. Add 3 DNS records to send from
                  marketing@{sendgridDomain}.
                </p>
                <Button variant="secondary" size="sm" className="mt-3" onClick={() => setDomainOpen(true)}>
                  <ShieldCheck className="h-3.5 w-3.5" /> Authenticate domain →
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Connected */}
      {connectedDefs.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[#64748b]">Connected</h3>
          <div className="space-y-3">{connectedDefs.map(renderCard)}</div>
        </div>
      )}

      {/* Available to connect */}
      {availableDefs.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[#64748b]">
            Available to connect
          </h3>
          <div className="space-y-3">{availableDefs.map(renderCard)}</div>
        </div>
      )}

      {/* Coming soon */}
      {comingSoonDefs.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[#64748b]">Coming soon</h3>
          <div className="space-y-3">{comingSoonDefs.map(renderCard)}</div>
        </div>
      )}

      <p className="px-1 text-xs text-[#64748b]">
        Keys are validated with a live call, then encrypted before storage — hailmery only ever keeps the encrypted value.
      </p>

      {connectDef && (
        <ConnectModal
          def={connectDef}
          status={byId.get(connectDef.id)}
          onClose={() => setConnectId(null)}
          onConnected={(msg) => setToast({ message: msg })}
        />
      )}
      {domainOpen && (
        <DomainAuthModal
          domain={sendgrid?.domain ?? null}
          onClose={() => setDomainOpen(false)}
          onToast={setToast}
        />
      )}
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  )
}

// Maps a displayed Google service to the scope substring that proves it's
// granted, so a connected card lights up only the services actually authorized.
const GOOGLE_SERVICE_SCOPE: Record<string, string> = {
  'Google Search Console': 'webmasters',
  'Google Analytics': 'analytics',
}
function isServiceActive(service: string, scopes?: string[]): boolean {
  const needle = GOOGLE_SERVICE_SCOPE[service]
  return !!needle && !!scopes?.some((s) => s.includes(needle))
}

// OAuth (Google) guidance shown on the card: full how-to + scopes before connect,
// scopes-lit "active services" once connected.
function OAuthGuidance({
  help,
  connected,
  scopes,
}: {
  help: NonNullable<PlatformDef['oauthHelp']>
  connected: boolean
  scopes?: string[]
}) {
  return (
    <div className="mt-3 space-y-3 rounded-lg border border-[#1e1e2e] bg-white/[0.02] px-3 py-2.5">
      {!connected && (
        <>
          <div>
            <div className="text-[11px] font-medium text-[#f1f5f9]">{help.title}</div>
            <p className="mt-0.5 text-xs text-[#94a3b8]">{help.description}</p>
          </div>
          {help.important && (
            <div className="rounded-md border border-violet-500/25 bg-violet-500/[0.08] px-2.5 py-2 text-xs text-violet-200">
              {help.important}
            </div>
          )}
          <ol className="list-decimal space-y-0.5 pl-4 text-xs text-[#94a3b8]">
            {help.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </>
      )}
      {help.scopes && help.scopes.length > 0 && (
        <div>
          <div className="mb-1 text-[11px] font-medium text-[#94a3b8]">
            {connected ? 'Active services' : 'This connects'}
          </div>
          <div className="space-y-1">
            {help.scopes.map((svc) => {
              const active = connected && isServiceActive(svc.name, scopes)
              return (
                <div
                  key={svc.name}
                  className={`flex items-start gap-1.5 text-xs ${
                    active ? 'text-emerald-300' : 'text-[#94a3b8]'
                  }`}
                >
                  {active ? (
                    <Check className="mt-0.5 h-3 w-3 shrink-0" />
                  ) : (
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[#64748b]" />
                  )}
                  <span>
                    <span className="text-[#f1f5f9]">{svc.name}</span>
                    <span className="text-[#64748b]"> — {svc.description}</span>
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
      {!connected && help.gscSetupNote && <p className="text-xs text-[#64748b]">{help.gscSetupNote}</p>}
      {!connected && help.testingNote && (
        <p className="text-xs text-amber-300/80">{help.testingNote}</p>
      )}
    </div>
  )
}

function IntegrationCard({
  def,
  status,
  disconnecting,
  connecting,
  onConnect,
  onAuthDomain,
  onDisconnect,
}: {
  def: PlatformDef
  status?: PlatformConnection
  disconnecting: boolean
  connecting: boolean
  onConnect: () => void
  onAuthDomain: () => void
  onDisconnect: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const connected = !!status?.connected
  const isSendgrid = def.id === 'sendgrid'
  const domainOk = status?.domainVerified === true
  // SendGrid connected but domain unverified → this card itself needs attention.
  const actionNeeded = connected && isSendgrid && !domainOk
  const comingSoon = !def.available && !connected

  const cardBorder = actionNeeded
    ? 'border-[#f59e0b]/30 bg-[#f59e0b]/5'
    : comingSoon
      ? 'border-[#1e1e2e]/50 bg-[#0f0f1a] opacity-60'
      : 'border-[#1e1e2e] bg-[#0f0f1a]'

  return (
    <div className={`rounded-lg border p-4 ${cardBorder}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#1e1e2e] bg-white/[0.03] ${
              connected ? 'text-[#8b5cf6]' : 'text-[#64748b]'
            }`}
          >
            <Plug className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-[#f1f5f9]">{def.name}</span>
              {/* Status chip */}
              {connected ? (
                actionNeeded ? (
                  <Badge variant="amber" className="gap-1">
                    <AlertTriangle className="h-3 w-3" /> Action needed
                  </Badge>
                ) : (
                  <Badge variant="green" className="gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Connected
                  </Badge>
                )
              ) : def.available ? (
                <Badge variant="gray">Available</Badge>
              ) : (
                <Badge variant="gray" className="gap-1">
                  <Lock className="h-3 w-3" /> Coming soon
                </Badge>
              )}
            </div>
            <div className="mt-0.5 text-xs text-[#94a3b8]">{def.description}</div>
            <div className="mt-0.5 text-xs">
              {connected ? (
                <span className="text-[#94a3b8]">
                  Connected{status?.account ? ` · ${status.account}` : ''}
                  {status?.lastValidated && (
                    <span className="text-[#64748b]"> · validated {formatTimeAgo(status.lastValidated)}</span>
                  )}
                </span>
              ) : def.available ? (
                <span className="text-[#64748b]">Not connected</span>
              ) : (
                <span className="text-[#64748b]">{def.oauthNote}</span>
              )}
            </div>
            {def.channelNote && !connected && def.available && (
              <div className="mt-0.5 text-[11px] text-[#64748b]">{def.channelNote}</div>
            )}
          </div>
        </div>

        <div className="shrink-0">
          {connected ? (
            confirming ? (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-[#94a3b8]">Sure?</span>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={disconnecting}
                  onClick={() => {
                    onDisconnect()
                    setConfirming(false)
                  }}
                >
                  {disconnecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Disconnect'}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              </div>
            ) : def.connectionType === 'managed' ? (
              <Badge variant="gray">Managed</Badge>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
                Disconnect
              </Button>
            )
          ) : def.available ? (
            <Button variant="secondary" size="sm" onClick={onConnect} disabled={connecting}>
              {connecting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plug className="h-3.5 w-3.5" />
              )}
              {connecting ? 'Connecting…' : 'Connect'}
            </Button>
          ) : (
            <span title="Integration in development" className="inline-flex cursor-not-allowed">
              <Button variant="ghost" size="sm" disabled>
                Coming soon
              </Button>
            </span>
          )}
        </div>
      </div>

      {/* SendGrid sending-domain authentication sub-block */}
      {connected && isSendgrid && (
        <div
          className={`mt-3 rounded-lg border px-3 py-2.5 text-xs ${
            domainOk
              ? 'border-emerald-500/20 bg-emerald-500/[0.04]'
              : 'border-amber-500/25 bg-amber-500/[0.05]'
          }`}
        >
          {domainOk ? (
            <div className="flex items-center gap-2 text-emerald-300">
              <ShieldCheck className="h-3.5 w-3.5" />
              Sending domain {status?.domain} authenticated — emails send from @{status?.domain}
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-amber-300">
                <AlertTriangle className="h-3.5 w-3.5" />
                Domain {status?.domain ?? '(no site domain)'} not authenticated
              </div>
              <div className="text-[#94a3b8]">
                Emails send from @leadorch.io until {status?.domain ?? 'your domain'} is verified.
              </div>
              {status?.domain && (
                <Button variant="secondary" size="sm" className="mt-1" onClick={onAuthDomain}>
                  <ShieldCheck className="h-3.5 w-3.5" /> Authenticate {status.domain} →
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Domain-auth explainer (SendGrid) — shown proactively, no click required. */}
      {def.domainAuthHelp && (
        <details className="mt-3 rounded-lg border border-[#1e1e2e] bg-white/[0.02] px-3 py-2.5 text-xs">
          <summary className="cursor-pointer select-none font-medium text-[#94a3b8]">
            📧 About domain authentication
          </summary>
          <div className="mt-2 space-y-2 text-[#94a3b8]">
            <div className="font-medium text-[#94a3b8]">{def.domainAuthHelp.title}</div>
            <p>{def.domainAuthHelp.description}</p>
            <ol className="list-decimal space-y-0.5 pl-4">
              {def.domainAuthHelp.steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
            {def.domainAuthHelp.cloudflareNote && (
              <p className="text-[#64748b]">Cloudflare: {def.domainAuthHelp.cloudflareNote}</p>
            )}
            {def.domainAuthHelp.propagationNote && (
              <p className="text-[#64748b]">{def.domainAuthHelp.propagationNote}</p>
            )}
          </div>
        </details>
      )}

      {/* OAuth (Google) guidance — full how-to before connect; active services after. */}
      {def.connectionType === 'oauth' && def.available && def.oauthHelp && (
        <OAuthGuidance help={def.oauthHelp} connected={connected} scopes={status?.scopes} />
      )}

      {/* Managed platforms (Wix Blog) — administrator-managed, no self-serve connect. */}
      {def.connectionType === 'managed' && def.managedNote && (
        <div className="mt-3 rounded-lg border border-[#1e1e2e] bg-white/[0.02] px-3 py-2.5 text-xs text-[#94a3b8]">
          {def.managedNote}
        </div>
      )}
    </div>
  )
}

function ConnectModal({
  def,
  status,
  onClose,
  onConnected,
}: {
  def: PlatformDef
  status?: PlatformConnection
  onClose: () => void
  onConnected: (message: string) => void
}) {
  const channels = def.channels ?? []
  const existingMap: Record<string, string> = status?.profileMap ?? {}
  const connect = useConnectPlatform()
  const [apiKey, setApiKey] = useState('')
  // Prefill every channel from the existing map so a reconnect shows all current
  // mappings; the user can edit any of them.
  const [profileIds, setProfileIds] = useState<Record<string, string>>(() =>
    Object.fromEntries(channels.map((ch) => [ch.key, existingMap[ch.key] ?? ''])),
  )
  const [show, setShow] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function submit() {
    const key = apiKey.trim()
    if (!key) {
      setError('Paste the key first')
      return
    }
    setError(null)
    let extra: { profileMap: Record<string, string> } | undefined
    if (channels.length) {
      const profileMap: Record<string, string> = {}
      for (const ch of channels) {
        const v = profileIds[ch.key]?.trim()
        if (v) profileMap[ch.key] = v
      }
      if (Object.keys(profileMap).length) extra = { profileMap }
    }
    connect.mutate(
      { platform: def.id, apiKey: key, extra },
      {
        onSuccess: (data) => {
          onConnected(`${def.name} connected${data.account ? ` · ${data.account}` : ''}`)
          onClose()
        },
        onError: (e) => setError(toApiError(e).error),
      },
    )
  }

  return (
    <Dialog open onClose={onClose} title={`Connect ${def.name}`} description={def.description}>
      <div className="space-y-4 p-6 pt-2">
        <div>
          <Label>{def.apiKeyLabel ?? 'API Key'}</Label>
          <div className="relative">
            <Input
              type={show ? 'text' : 'password'}
              autoFocus
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={def.apiKeyPlaceholder ?? '••••••••'}
              className="pr-10 font-mono"
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
              }}
            />
            <button
              type="button"
              aria-label={show ? 'Hide key' : 'Show key'}
              onClick={() => setShow((s) => !s)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#64748b] hover:text-[#f1f5f9]"
            >
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {def.apiKeyHelp && (
          <div className="rounded-lg border border-[#1e1e2e] bg-white/[0.02] px-3 py-2.5 text-xs text-[#94a3b8]">
            <div className="mb-1 font-medium text-[#94a3b8]">Where to find this</div>
            <ol className="list-decimal space-y-1 pl-4">
              {def.apiKeyHelp.steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
            {def.apiKeyHelp.note && <p className="mt-2 text-[#94a3b8]">{def.apiKeyHelp.note}</p>}
          </div>
        )}

        {def.apiKeyHelp?.warning && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2.5 text-xs text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{def.apiKeyHelp.warning}</span>
          </div>
        )}

        {channels.length > 0 && (
          <div className="space-y-3">
            {def.channelNote && <p className="text-xs text-[#94a3b8]">{def.channelNote}</p>}
            {channels.map((ch) => (
              <div key={ch.key}>
                <Label>
                  {ch.label} channel ID{' '}
                  <span className="font-normal text-[#64748b]">(optional)</span>
                </Label>
                <Input
                  value={profileIds[ch.key] ?? ''}
                  onChange={(e) => setProfileIds((m) => ({ ...m, [ch.key]: e.target.value }))}
                  placeholder={ch.placeholder}
                  className="font-mono"
                />
                <details className="mt-1">
                  <summary className="cursor-pointer select-none text-xs text-[#94a3b8] hover:text-[#f1f5f9]">
                    How to find this ↓
                  </summary>
                  <p className="mt-1 text-xs text-[#64748b]">{ch.help}</p>
                </details>
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-lg bg-red-500/[0.08] px-3 py-2 text-sm text-red-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose} disabled={connect.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={connect.isPending || !apiKey.trim()}>
            {connect.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Validating…
              </>
            ) : (
              <>
                <KeyRound className="h-4 w-4" /> Connect {def.name}
              </>
            )}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

const DNS_PROVIDERS = [
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    note: 'Enter just the part of the Name before your domain (e.g. "em9705") — Cloudflare appends the rest automatically. Set Proxy status to DNS only (grey cloud icon).',
  },
  {
    id: 'route53',
    name: 'Route 53 (AWS)',
    note: 'Enter the full hostname including the domain, exactly as shown.',
  },
  {
    id: 'godaddy',
    name: 'GoDaddy',
    note: 'Use only the subdomain part as the Name (the text before your domain).',
  },
  { id: 'other', name: 'Other', note: 'Enter the full hostname exactly as shown below.' },
]

function DomainAuthModal({
  domain,
  onClose,
  onToast,
}: {
  domain: string | null
  onClose: () => void
  onToast: (t: ToastState) => void
}) {
  const { data, isFetching, refetch, error } = useDomainAuth()
  const verify = useVerifyDomain()
  const [provider, setProvider] = useState('cloudflare')
  const [copied, setCopied] = useState(false)
  const [result, setResult] = useState<'idle' | 'ok' | 'fail'>('idle')

  useEffect(() => {
    refetch()
  }, [refetch])

  const records = data
    ? ([data.records.mail, data.records.dkim1, data.records.dkim2].filter(Boolean) as DomainAuthRecord[])
    : []
  const providerNote = DNS_PROVIDERS.find((p) => p.id === provider)?.note ?? ''
  const dn = domain ?? data?.domain ?? 'your domain'

  function copyAll() {
    const text = records.map((r) => `${r.type}\t${r.name}\t${r.value}`).join('\n')
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  function runVerify() {
    setResult('idle')
    verify.mutate(undefined, {
      onSuccess: (res) => {
        setResult(res.valid ? 'ok' : 'fail')
        // Reload the per-record valid flags. useDomainAuth is enabled:false, so
        // the mutation's invalidateQueries can't refetch it — do it explicitly.
        refetch()
        if (res.valid) {
          onToast({ message: `${res.domain} verified — emails will now send from @${res.domain}` })
        }
      },
      onError: (e) => {
        setResult('fail')
        onToast({ message: toApiError(e).error, variant: 'error' })
      },
    })
  }

  const verified = result === 'ok' || data?.verified === true

  return (
    <Dialog
      open
      onClose={onClose}
      className="max-w-2xl"
      title={`Authenticate ${dn} for email sending`}
      description={`Add these ${records.length || 3} DNS records to ${dn}, then verify.`}
    >
      <div className="space-y-5 p-6 pt-2">
        {isFetching && !data && (
          <div className="flex items-center gap-2 text-sm text-[#94a3b8]">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading DNS records…
          </div>
        )}
        {error && !data && (
          <div className="flex items-start gap-2 rounded-lg bg-red-500/[0.08] px-3 py-2 text-sm text-red-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {toApiError(error).error}
          </div>
        )}

        {data && (
          <>
            <div>
              <div className="mb-1.5 text-sm font-medium text-[#f1f5f9]">1. Choose your DNS provider</div>
              <Select value={provider} onChange={(e) => setProvider(e.target.value)} className="max-w-xs">
                {DNS_PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
              <p className="mt-1.5 text-xs text-[#94a3b8]">{providerNote}</p>
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <div className="text-sm font-medium text-[#f1f5f9]">2. Add these CNAME records</div>
                <Button variant="ghost" size="sm" onClick={copyAll}>
                  {copied ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-400" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" /> Copy all
                    </>
                  )}
                </Button>
              </div>
              <div className="overflow-hidden rounded-lg border border-[#1e1e2e]">
                <table className="w-full text-left text-xs">
                  <thead className="bg-white/[0.03] text-[#94a3b8]">
                    <tr>
                      <th className="px-3 py-2 font-medium">Type</th>
                      <th className="px-3 py-2 font-medium">Name</th>
                      <th className="px-3 py-2 font-medium">Value</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    {records.map((r) => (
                      <tr key={r.name} className="border-t border-[#1e1e2e]">
                        <td className="px-3 py-2 text-[#94a3b8]">{r.type}</td>
                        <td className="break-all px-3 py-2 text-[#f1f5f9]">{r.name}</td>
                        <td className="break-all px-3 py-2 text-[#94a3b8]">{r.value}</td>
                        <td className="px-3 py-2">
                          {r.valid ? (
                            <Check className="h-3.5 w-3.5 text-emerald-400" />
                          ) : (
                            <span className="text-[#64748b]">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <div className="mb-1 text-sm font-medium text-[#f1f5f9]">3. Verify (after adding records)</div>
              <p className="mb-2 text-xs text-[#94a3b8]">DNS propagation takes 5–30 minutes.</p>
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={runVerify} disabled={verify.isPending}>
                  {verify.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Checking DNS…
                    </>
                  ) : (
                    'Verify now'
                  )}
                </Button>
                {!verify.isPending && verified && (
                  <span className="flex items-center gap-1.5 text-xs text-emerald-300">
                    <CheckCircle2 className="h-3.5 w-3.5" /> {dn} verified
                  </span>
                )}
                {!verify.isPending && !verified && result === 'fail' && (
                  <span className="text-xs text-amber-300">
                    Records not found yet. DNS can take 5–30 minutes to propagate. Try again shortly.
                  </span>
                )}
                {!verify.isPending && !verified && result === 'idle' && (
                  <span className="flex items-center gap-1.5 text-xs text-[#94a3b8]">
                    <span className="h-2 w-2 rounded-full bg-[#64748b]" /> Pending verification
                  </span>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </Dialog>
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

// Matches a bare UUID (optionally followed by a separator + the rest of a name)
// at the START of a string. golden_example rows are often keyed by a UUID with
// no human filename; we defensively strip a leading UUID so the table isn't a
// wall of identifiers. DocumentRow carries no preview text, so we never invent
// content — we only clean the existing filename.
const UUID_PREFIX_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}([._\-\s]+(.+))?$/i
const BARE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Human-friendly display name for a document row. For golden_example rows whose
 * filename is (or starts with) a UUID, strip the UUID prefix; if the whole name
 * is just a UUID, fall back to a short label. Non-golden rows keep their name.
 */
function docDisplayName(doc: DocumentRow): string {
  const name = doc.sourceFilename
  if (doc.documentType !== 'golden_example') return name
  if (BARE_UUID_RE.test(name)) return 'Golden example'
  const m = UUID_PREFIX_RE.exec(name)
  if (m && m[2]) return m[2].slice(0, 60)
  return name
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
  // Client-side table filters.
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<string>('all')

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

  const docs = data ?? []
  const filtered = docs.filter((doc) => {
    const matchesType = typeFilter === 'all' || doc.documentType === typeFilter
    const q = search.trim().toLowerCase()
    const matchesSearch = !q || doc.sourceFilename.toLowerCase().includes(q)
    return matchesType && matchesSearch
  })
  const totalChunks = docs.reduce((sum, d) => sum + (d.chunkCount ?? 0), 0)
  const lastIngestedMs = docs.reduce((max, d) => {
    const t = Date.parse(d.ingestedAt)
    return Number.isNaN(t) ? max : Math.max(max, t)
  }, 0)
  const lastIngestedLabel = lastIngestedMs > 0 ? new Date(lastIngestedMs).toLocaleDateString() : '—'

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
        <p className="pb-2 text-xs text-[#64748b]">
          Tags every chunk so generation can retrieve by type.
        </p>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); if (!busy) setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); if (!busy) pick(e.dataTransfer.files) }}
        onClick={() => { if (!busy) fileRef.current?.click() }}
        className={`glass-sm flex cursor-pointer flex-col items-center justify-center gap-2 border-2 border-dashed py-10 text-center transition-colors ${dragOver ? 'border-violet-500/40 bg-violet-500/[0.06]' : 'border-[#1e1e2e]'} ${busy ? 'pointer-events-none opacity-70' : ''}`}
      >
        <Upload className="h-6 w-6 text-[#64748b]" />
        <div className="text-sm text-[#94a3b8]">
          Drag &amp; drop or <span className="text-[#8b5cf6]">browse</span>
        </div>
        <div className="text-xs text-[#64748b]">.pdf, .docx, .md, .txt · max 10MB</div>
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

      {/* Toolbar: search + type filter */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="sm:flex-1">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search documents by filename…"
          />
        </div>
        <div className="sm:w-56">
          <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="all">All types</option>
            {DOCUMENT_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </Select>
        </div>
      </div>

      {/* Summary strip */}
      <div className="text-xs text-[#64748b]">
        {docs.length} document{docs.length === 1 ? '' : 's'} · {totalChunks} chunk
        {totalChunks === 1 ? '' : 's'} · Last ingested {lastIngestedLabel}
      </div>

      <Card className="p-2">
        {isLoading ? (
          <div className="space-y-2 p-3">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-[#64748b]">
            {docs.length === 0 ? 'No documents yet — upload one above.' : 'No documents match your filters.'}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-[#94a3b8]">
                <th className="px-4 py-2 text-left font-medium">Filename</th>
                <th className="px-4 py-2 text-left font-medium">Type</th>
                <th className="px-4 py-2 text-left font-medium">Ingested</th>
                <th className="px-4 py-2 text-right font-medium">Chunks</th>
                <th className="px-4 py-2 text-right font-medium">Ver</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((doc) => {
                const badge = DOC_TYPE_BADGE[doc.documentType] ?? { variant: 'gray' as BadgeVariant }
                const failed = doc.extractionStatus === 'failed'
                const reingesting = reingest.isPending && reingest.variables === doc.id
                return (
                  <tr key={doc.id} className="border-t border-[#1e1e2e]">
                    <td className="break-all px-4 py-2.5 text-[#f1f5f9]">{docDisplayName(doc)}</td>
                    <td className="px-4 py-2.5">
                      <Badge variant={badge.variant} className={badge.className}>
                        {doc.documentType}
                      </Badge>
                      {failed && (
                        <Badge variant="red" className="ml-1">failed</Badge>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[#94a3b8]">
                      {new Date(doc.ingestedAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-2.5 text-right text-[#94a3b8]">
                      {doc.chunkCount} <span className="text-xs text-[#64748b]">chunks</span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-[#94a3b8]">v{doc.version}</td>
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
      <div className="flex items-center justify-center gap-1.5 text-xs text-[#94a3b8]">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {STAGE_LABEL[stage]}
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[#7c3aed] to-[#8b5cf6] transition-all"
          style={{ width: `${barPct}%` }}
        />
      </div>
    </div>
  )
}

// ── Tab — Import History (historical Buffer content) ────────────────

// Buffer-published social channels we can import history for. Keys match the
// backend's importable channels (twitter == the "X" UI key).
const IMPORT_CHANNEL_KEYS = ['linkedin', 'twitter', 'instagram', 'facebook'] as const

function ImportHistoryTab() {
  const { currentId } = useTenant()
  const { data: connections } = useConnections()
  const importMut = useImportBufferHistory()
  const [selected, setSelected] = useState<Record<string, boolean>>({ linkedin: true })
  const [dryRun, setDryRun] = useState(true)
  const [result, setResult] = useState<BufferImportResult | null>(null)

  // The result card + mutation error hold raw (tenant-scoped) output in local
  // state; clear them when the active tenant changes so tenant A's numbers never
  // linger on tenant B.
  useEffect(() => {
    setResult(null)
    importMut.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId])

  const bufferConnected = !!(connections ?? []).find((c) => c.platform === 'buffer')?.connected
  const channels = Object.entries(selected).filter(([, v]) => v).map(([k]) => k)

  function run() {
    if (!channels.length) return
    importMut.mutate({ profiles: channels, dryRun }, { onSuccess: (data) => setResult(data) })
  }

  return (
    <div className="space-y-5">
      {/* What this does */}
      <Card className="space-y-2 p-5">
        <div className="flex items-center gap-2">
          <DownloadCloud className="h-4 w-4 text-[#8b5cf6]" />
          <h2 className="text-sm font-semibold text-[#f1f5f9]">Import historical content</h2>
        </div>
        <p className="text-sm text-[#94a3b8]">
          Pulls your already-published Buffer posts and their real engagement into hailmery as{' '}
          <span className="text-[#f1f5f9]">measured</span> content. The top performers become golden
          examples that steer future generation toward what actually worked.
        </p>
        <ul className="mt-1 space-y-1 text-xs text-[#94a3b8]">
          <li>• This imports <span className="text-[#f1f5f9]">historical</span> content for training — it does not publish anything new.</li>
          <li>• Posts already in hailmery are skipped, so it is safe to re-run.</li>
          <li>• Better signal here makes every future generated post sound more like your best work.</li>
        </ul>
      </Card>

      {/* Channel selection */}
      <Card className="space-y-4 p-5">
        <div className="flex items-center justify-between">
          <Label>Channels to import</Label>
          <span className="flex items-center gap-1.5 text-xs">
            <span className={`h-2 w-2 rounded-full ${bufferConnected ? 'bg-emerald-400' : 'bg-[#64748b]'}`} />
            <span className="text-[#94a3b8]">Buffer {bufferConnected ? 'connected' : 'not connected'}</span>
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {IMPORT_CHANNEL_KEYS.map((key) => {
            const meta = CHANNELS[key]
            const Icon = meta.icon
            const on = !!selected[key]
            return (
              <button
                type="button"
                key={key}
                onClick={() => setSelected((s) => ({ ...s, [key]: !s[key] }))}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                  on
                    ? 'border-violet-500/40 bg-violet-500/[0.08]'
                    : 'border-[#1e1e2e] bg-white/[0.02] hover:bg-white/[0.04]'
                }`}
              >
                <span
                  className={`flex items-center justify-center rounded-md border transition-all ${
                    on ? 'border-violet-500/60 bg-violet-500/20 text-violet-300' : 'border-white/[0.12] bg-white/[0.03]'
                  }`}
                  style={{ width: 18, height: 18 }}
                >
                  {on && <Check className="h-3 w-3" strokeWidth={3} />}
                </span>
                <Icon className={`h-4 w-4 ${meta.iconClass}`} />
                <span className="text-sm text-[#f1f5f9]">{meta.label}</span>
              </button>
            )
          })}
        </div>
        <p className="text-xs text-[#64748b]">
          Only channels connected in Buffer for this tenant will return posts; others are skipped with a note.
        </p>

        <div className="flex flex-wrap items-center gap-4 pt-1">
          <Checkbox
            checked={dryRun}
            onChange={(v: boolean) => setDryRun(v)}
            label="Preview only (don't import)"
          />
          <Button
            onClick={run}
            disabled={importMut.isPending || channels.length === 0 || !bufferConnected}
            title={!bufferConnected ? 'Connect Buffer first' : undefined}
          >
            {importMut.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <DownloadCloud className="h-4 w-4" />
            )}
            {dryRun ? 'Preview import' : 'Import selected history'}
          </Button>
          {importMut.isPending && (
            <span className="text-xs text-[#94a3b8]">
              Fetching from Buffer{dryRun ? '' : ', scoring & promoting'}… this can take up to a minute.
            </span>
          )}
        </div>

        {importMut.isError && (
          <div className="flex items-center gap-2 rounded-lg bg-red-500/[0.08] px-3 py-2 text-sm text-red-300">
            <AlertTriangle className="h-4 w-4" />
            {toApiError(importMut.error).error}
          </div>
        )}
      </Card>

      {/* Results */}
      {result && <ImportResultCard result={result} />}
    </div>
  )
}

function ImportResultCard({ result }: { result: BufferImportResult }) {
  const importedLabel = result.dryRun ? 'Would import' : 'Imported'
  const stats: Array<{ label: string; value: number; accent?: string }> = [
    { label: 'Fetched', value: result.fetched },
    { label: importedLabel, value: result.imported, accent: 'text-violet-300' },
    { label: 'Already existed', value: result.skipped },
    { label: 'Scored', value: result.scored },
    { label: 'Golden examples', value: result.goldenExamples, accent: 'text-yellow-300' },
  ]
  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-center gap-2">
        {result.dryRun ? (
          <Sparkles className="h-4 w-4 text-[#8b5cf6]" />
        ) : (
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
        )}
        <h3 className="text-sm font-semibold text-[#f1f5f9]">
          {result.dryRun ? 'Preview complete' : 'Import complete'}
        </h3>
        {result.dryRun && (
          <Badge variant="purple" className="ml-1">dry run — nothing written</Badge>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg border border-[#1e1e2e] bg-white/[0.02] px-3 py-3">
            <div className={`text-2xl font-semibold ${s.accent ?? 'text-[#f1f5f9]'}`}>{s.value}</div>
            <div className="text-xs text-[#94a3b8]">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Per-channel breakdown (only when something notable happened) */}
      {result.channels.some((c) => c.error || c.fetched > 0) && (
        <div className="space-y-1.5">
          {result.channels.map((c) => (
            <div key={c.channel} className="flex items-center gap-2 text-xs">
              <span className="w-20 text-[#94a3b8]">{CHANNELS[c.channel]?.label ?? c.channel}</span>
              {c.error ? (
                <span className="flex items-center gap-1 text-red-300">
                  <AlertTriangle className="h-3 w-3" /> {c.error}
                </span>
              ) : (
                <span className="text-[#94a3b8]">
                  fetched {c.fetched} · {result.dryRun ? 'would import' : 'imported'} {c.imported} · skipped {c.skipped}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Top performers — these are what become golden examples */}
      {result.topPerformers.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-[#94a3b8]">
            <Sparkles className="h-3.5 w-3.5 text-yellow-300" /> Top imported performers
          </div>
          {result.topPerformers.map((p, i) => (
            <div
              key={p.draftId}
              className="flex items-start gap-3 rounded-lg border border-[#1e1e2e] bg-white/[0.02] px-3 py-2"
            >
              <span className="mt-0.5 text-xs text-[#64748b]">#{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs text-[#f1f5f9]">{p.preview || '(no text)'}</div>
                <div className="mt-0.5 text-[11px] text-[#94a3b8]">
                  {p.performanceScore != null && (
                    <span className="text-yellow-300/90">score {p.performanceScore.toFixed(2)}</span>
                  )}
                  {p.performanceScore != null && ' · '}
                  {p.impressions} impressions · {p.engagement} engagements
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
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
  const [baseline, setBaseline] = useState<string | null>(null)
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
    setBaseline(JSON.stringify(next))
  }, [evergreen])

  if (isLoading) return <Skeleton className="h-96 rounded-2xl" />

  const isDirty = baseline !== null && JSON.stringify(config) !== baseline

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
      {
        onSuccess: () => {
          setSaved(true)
          setTimeout(() => setSaved(false), 2500)
          setBaseline(JSON.stringify(config))
        },
      },
    )
  }

  function onDiscard() {
    if (baseline === null) return
    setConfig(JSON.parse(baseline) as Record<string, ChannelSchedule>)
  }

  return (
    <div className="space-y-0">
      <Card className="space-y-5 p-6">
        <div className="text-xs text-[#94a3b8]">
          Cadence for the default evergreen campaign · timezone{' '}
          <span className="text-[#f1f5f9]">{tz}</span>
        </div>

        {SELECTABLE_CHANNELS.filter((c) => c.kind !== 'blog' || true).map((ch) => {
          const sched = config[ch.key]
          const enabled = !!sched
          return (
            <div
              key={ch.key}
              className="rounded-lg border border-[#1e1e2e] bg-white/[0.02] p-4"
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
                  <div className="flex items-center gap-2 text-xs text-[#94a3b8]">
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
                      aria-pressed={sched.days.includes(d)}
                      aria-label={`${d}${sched.days.includes(d) ? ' (selected)' : ''}`}
                      className={`rounded-lg px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 ${
                        sched.days.includes(d)
                          ? 'bg-violet-500/15 text-violet-300'
                          : 'bg-white/[0.04] text-[#94a3b8] hover:bg-white/[0.08]'
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
          <Button onClick={onSave} disabled={patch.isPending || !evergreen || !isDirty}>
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

      {isDirty && (
        <div className="sticky bottom-0 z-20 -mx-1 mt-6 flex justify-end gap-3 border-t border-[#1e1e2e] bg-[#0a0a0f]/95 px-1 py-3 backdrop-blur">
          <Button variant="ghost" onClick={onDiscard} disabled={patch.isPending}>
            Discard
          </Button>
          <Button onClick={onSave} disabled={patch.isPending || !evergreen}>
            {patch.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save changes
          </Button>
        </div>
      )}
    </div>
  )
}
