// The complete platform catalog the Platforms tab renders. `id` matches the
// backend connection-status id (GET /api/connections) so the live status merges
// onto each card by id. API-key platforms (available: true) have a self-serve
// connect flow; OAuth/managed platforms render as informative "coming soon"
// cards until their integration ships.

export interface PlatformDef {
  id: string
  name: string
  description: string
  connectionType: 'api_key' | 'oauth' | 'managed'
  /** can connect today (self-serve) */
  available: boolean
  apiKeyLabel?: string
  apiKeyHelp?: string
  permissions?: string[]
  /** for unavailable OAuth/managed platforms */
  oauthNote?: string
  /** e.g. "Covers LinkedIn, X, Instagram, Facebook" */
  channelNote?: string
  /** SendGrid only — shows the sending-domain authentication guide */
  hasDomainAuth?: boolean
  /** Buffer only — optional per-channel profile-id field in the connect modal */
  showBufferProfile?: boolean
}

export const PLATFORMS: PlatformDef[] = [
  {
    id: 'buffer',
    name: 'Buffer',
    description: 'Social media scheduling — covers LinkedIn, X, Instagram, Facebook, TikTok',
    connectionType: 'api_key',
    available: true,
    apiKeyLabel: 'Access Token',
    apiKeyHelp: 'buffer.com → Settings → Apps & Integrations → API Access',
    channelNote: 'Covers LinkedIn, X, Instagram, Facebook, TikTok',
    showBufferProfile: true,
  },
  {
    id: 'hubspot',
    name: 'HubSpot',
    description: 'CRM — contacts, deals, timeline enrichment',
    connectionType: 'api_key',
    available: true,
    apiKeyLabel: 'Private App Token',
    apiKeyHelp: 'HubSpot → Settings → Integrations → Private Apps → Create app → copy the access token',
    permissions: ['contacts (read/write)', 'timeline (create events)'],
  },
  {
    id: 'sendgrid',
    name: 'SendGrid',
    description: 'Email delivery — marketing campaigns, transactional email',
    connectionType: 'api_key',
    available: true,
    apiKeyLabel: 'API Key',
    apiKeyHelp: 'app.sendgrid.com → Settings → API Keys → Create API Key',
    hasDomainAuth: true,
  },
  {
    id: 'google',
    name: 'Google (Analytics + Search Console)',
    description: 'Web analytics, SEO keyword data, Google Ads',
    connectionType: 'oauth',
    available: false,
    oauthNote: 'OAuth integration coming in V2. GSC and GA4 will connect with one Google sign-in.',
  },
  {
    id: 'linkedin-native',
    name: 'LinkedIn (Native)',
    description: 'Direct LinkedIn publishing and analytics — bypasses Buffer',
    connectionType: 'oauth',
    available: false,
    oauthNote: 'Requires LinkedIn partner approval. Use Buffer for LinkedIn publishing in the meantime.',
    channelNote: 'Connect via Buffer for now',
  },
  {
    id: 'x-native',
    name: 'X / Twitter (Native)',
    description: 'Direct X publishing and analytics',
    connectionType: 'oauth',
    available: false,
    oauthNote: 'OAuth flow coming in V2. Buffer handles X posting currently.',
    channelNote: 'Connect via Buffer for now',
  },
  {
    id: 'meta',
    name: 'Meta (Instagram + Facebook)',
    description: 'Direct Instagram and Facebook publishing',
    connectionType: 'oauth',
    available: false,
    oauthNote: 'Requires Meta app review. Buffer handles Instagram and Facebook currently.',
    channelNote: 'Connect via Buffer for now',
  },
  {
    id: 'wix',
    name: 'Wix Blog',
    description: 'Blog publishing to Wix sites (transitional)',
    connectionType: 'managed',
    available: false,
    oauthNote: 'Managed by your administrator. Contact support to update Wix credentials.',
  },
]
