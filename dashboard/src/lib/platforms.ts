// The complete platform catalog the Platforms tab renders. `id` matches the
// backend connection-status id (GET /api/connections) so the live status merges
// onto each card by id. API-key platforms (available: true) have a self-serve
// connect flow; OAuth/managed platforms render with full guidance so any user
// can connect their own accounts without developer help.

export interface PlatformDef {
  id: string
  name: string
  description: string
  connectionType: 'api_key' | 'oauth' | 'managed'
  /** can connect today (self-serve) */
  available: boolean

  // ── API-key platforms (Buffer / HubSpot / SendGrid) ──
  apiKeyLabel?: string
  apiKeyPlaceholder?: string
  apiKeyHelp?: {
    steps: string[]
    note?: string
    warning?: string
  }
  /** short one-liner under the card, e.g. "Covers LinkedIn, X, …" */
  channelNote?: string
  /**
   * Buffer only — per-channel profile-id fields in the connect modal. `key` is
   * the Buffer profile-map key the publish pipeline looks up; it MUST match
   * normalizeChannel() (which maps 'x' → 'twitter'), so X/Twitter is keyed
   * 'twitter', NOT 'x'.
   */
  channels?: Array<{
    key: string
    label: string
    placeholder: string
    help: string
  }>

  // ── Domain auth (SendGrid) ──
  hasDomainAuth?: boolean
  domainAuthHelp?: {
    title: string
    description: string
    steps: string[]
    cloudflareNote?: string
    propagationNote?: string
  }

  // ── OAuth platforms (Google) ──
  oauthHelp?: {
    title: string
    description: string
    important?: string
    steps: string[]
    scopes?: Array<{ name: string; description: string }>
    gscSetupNote?: string
    testingNote?: string
  }
  /** unavailable OAuth platforms — the "coming soon" explanation */
  oauthNote?: string

  // ── Managed platforms (Wix Blog) ──
  managedNote?: string
}

export const PLATFORMS: PlatformDef[] = [
  // BUFFER
  {
    id: 'buffer',
    name: 'Buffer',
    description: 'Social media scheduling — covers LinkedIn, X, Instagram, Facebook, TikTok',
    connectionType: 'api_key',
    available: true,
    apiKeyLabel: 'Access Token',
    apiKeyPlaceholder: '1/0123456789abcdef…',
    apiKeyHelp: {
      steps: [
        'Go to publish.buffer.com',
        'Click your profile icon → Settings',
        'Select Apps & Integrations → API Access',
        'Copy your Access Token',
      ],
      note: 'Your Access Token lets hailmery schedule and publish posts on your behalf.',
    },
    channelNote: 'Covers LinkedIn, X, Instagram, Facebook, TikTok via one token.',
    channels: [
      {
        key: 'linkedin',
        label: 'LinkedIn',
        placeholder: 'e.g. 6935634729ea336fd65bb60e',
        help: 'Go to publish.buffer.com → Channels → click your LinkedIn channel → copy the ID from the URL: buffer.com/channels/{this-id}',
      },
      {
        // Publish lookup normalizes 'x' → 'twitter', so the stored key is 'twitter'.
        key: 'twitter',
        label: 'X / Twitter',
        placeholder: 'e.g. 5f8c2a1b3d4e6f7a8b9c0d1e',
        help: 'Go to publish.buffer.com → Channels → click your X channel → copy the ID from the URL: buffer.com/channels/{this-id}',
      },
      {
        key: 'instagram',
        label: 'Instagram',
        placeholder: 'e.g. 4a7b2c9d1e3f5a6b8c0d2e4f',
        help: 'Go to publish.buffer.com → Channels → click your Instagram channel → copy the ID from the URL: buffer.com/channels/{this-id}',
      },
      {
        key: 'facebook',
        label: 'Facebook',
        placeholder: 'e.g. 3b8c1d5e7f2a4b6c9d0e1f3a',
        help: 'Go to publish.buffer.com → Channels → click your Facebook channel → copy the ID from the URL: buffer.com/channels/{this-id}',
      },
      {
        key: 'tiktok',
        label: 'TikTok',
        placeholder: 'e.g. 2c9d4e6f8a1b3c5d7e9f0a2b',
        help: 'Go to publish.buffer.com → Channels → click your TikTok channel → copy the ID from the URL: buffer.com/channels/{this-id}',
      },
    ],
  },

  // HUBSPOT
  {
    id: 'hubspot',
    name: 'HubSpot',
    description: 'CRM — contacts, deals, timeline enrichment',
    connectionType: 'api_key',
    available: true,
    apiKeyLabel: 'Private App Token',
    apiKeyPlaceholder: 'pat-na1-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
    apiKeyHelp: {
      steps: [
        'Go to app.hubspot.com → Settings (gear icon)',
        'Navigate to Integrations → Private Apps',
        'Click Create a private app',
        'Name it "Hailmery" and open the Scopes tab',
        'Enable CRM → Contacts (read & write)',
        'Enable CRM → Timeline (create events)',
        'Click Create app → copy the Access Token shown',
      ],
      note: 'Never share this token — it grants read/write access to your HubSpot contacts.',
      warning: 'Do NOT upgrade to HubSpot Marketing Hub Pro — it carries a mandatory $3,000 onboarding fee. Free or Starter ($20/mo) is all hailmery needs.',
    },
  },

  // SENDGRID
  {
    id: 'sendgrid',
    name: 'SendGrid',
    description: 'Email delivery — marketing campaigns, transactional email',
    connectionType: 'api_key',
    available: true,
    apiKeyLabel: 'API Key',
    apiKeyPlaceholder: 'SG.xxxxxxxxxxxxxxxxxxxxxx…',
    apiKeyHelp: {
      steps: [
        'Go to app.sendgrid.com → Settings → API Keys',
        'Click Create API Key',
        'Name it "Hailmery" and select Full Access',
        'Click Create & View → copy the key immediately',
        'The key starts with SG. and is only shown once',
      ],
      note: 'After connecting, authenticate your sending domain below so emails arrive from your domain instead of @leadorch.io.',
      warning: 'Copy the key immediately after creation — SendGrid only shows it once.',
    },
    hasDomainAuth: true,
    domainAuthHelp: {
      title: 'Why authenticate your domain?',
      description:
        'Without domain authentication, marketing emails send from marketing@leadorch.io. After authentication they send from marketing@yourdomain.com — improving deliverability and brand trust.',
      steps: [
        'Click "Authenticate …→" below',
        'Enter your sending domain (e.g. apire.io)',
        'Choose your DNS provider (Cloudflare, Route 53, etc.)',
        'Add the 3 CNAME records shown to your DNS',
        'Return here and click Verify',
      ],
      cloudflareNote:
        'In Cloudflare enter just the subdomain part (e.g. "em9705", not "em9705.apire.io"). Set proxy status to DNS only (grey cloud — NOT orange).',
      propagationNote: 'DNS changes take 5–30 minutes to propagate. If Verify fails, wait and try again.',
    },
  },

  // GOOGLE (OAuth)
  {
    id: 'google',
    name: 'Google (Analytics + Search Console)',
    description: 'Web analytics, SEO keyword data',
    connectionType: 'oauth',
    available: true,
    oauthHelp: {
      title: 'One Google sign-in connects both',
      description:
        'Connecting Google gives hailmery your Search Console keyword data and Analytics web traffic — both in one authorization.',
      important:
        'Sign in with the Google account that has your website added in Google Search Console. A different account returns no keyword data.',
      steps: [
        'Click Connect Google below',
        'A Google sign-in popup opens',
        'Choose the account that manages your site in Search Console',
        'Review and approve the permissions',
        'The popup closes automatically when done',
      ],
      scopes: [
        { name: 'Google Search Console', description: 'Keyword rankings, impressions, click-through rates' },
        { name: 'Google Analytics', description: 'Page views, traffic sources, user behavior' },
      ],
      gscSetupNote:
        'If your site is not yet in Search Console, add it first at search.google.com/search-console (verification takes a few minutes).',
      testingNote:
        'During setup only approved email addresses can connect. Contact your administrator if you see an "Access blocked" error.',
    },
  },

  // LINKEDIN NATIVE (coming soon)
  {
    id: 'linkedin-native',
    name: 'LinkedIn (Native)',
    description: 'Direct LinkedIn publishing and analytics — bypasses Buffer',
    connectionType: 'oauth',
    available: false,
    oauthNote: 'Requires LinkedIn partner approval. Use Buffer for LinkedIn publishing in the meantime.',
  },

  // X NATIVE (coming soon)
  {
    id: 'x-native',
    name: 'X / Twitter (Native)',
    description: 'Direct X publishing and analytics',
    connectionType: 'oauth',
    available: false,
    oauthNote: 'OAuth flow coming in V2. Buffer handles X posting currently.',
  },

  // META (coming soon)
  {
    id: 'meta',
    name: 'Meta (Instagram + Facebook)',
    description: 'Direct Instagram and Facebook publishing',
    connectionType: 'oauth',
    available: false,
    oauthNote: 'Requires Meta app review. Buffer handles Instagram and Facebook currently.',
  },

  // WIX BLOG (managed)
  {
    id: 'wix',
    name: 'Wix Blog',
    description: 'Blog publishing to your Wix site',
    connectionType: 'managed',
    available: false,
    managedNote:
      'Your Wix Blog connection is managed by your administrator and is already configured. Contact support if you need to update these credentials.',
  },
]
