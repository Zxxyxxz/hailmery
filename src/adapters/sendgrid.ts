import type { ContentDraft } from '../db/schema.js';
import {
  type ChannelAdapter,
  type AdapterCredentials,
  type MetricsResult,
  type QuotaState,
  type PublishResult,
  EMPTY_METRICS,
  adapterFetch,
  authHeaders,
  isValidEmail,
} from './index.js';
import type { ResolvedContact, ResolvedContactList } from './hubspot.js';

const BASE = 'https://api.sendgrid.com/v3';

export interface SendGridCredentials extends AdapterCredentials {}

export interface SendGridMailPayload {
  subject: string;
  html_body: string;
  // Optional plain-text alternative. When absent the adapter derives one from
  // html_body (a text/plain part materially improves deliverability + spam
  // scoring, so we always send both).
  plain_text?: string;
  from_email: string;
  from_name: string;
  // The recipient list. The publish workflow resolves list_source into a concrete
  // to_list (from HubSpot/SendGrid contacts) before this adapter runs, because the
  // adapter is credential-pure and has no DB access. An explicit to_list also
  // covers test sends / pre-resolved audiences. Each entry may carry a display
  // name directly, or firstName/lastName the adapter composes into one.
  to_list?: Array<{ email: string; name?: string; firstName?: string; lastName?: string }>;
  list_source?: 'hubspot_all' | 'sendgrid_all';
  utm_campaign?: string;
  utm_content?: string;
}

export interface SendGridEvent {
  email: string;
  event: string;
  timestamp: number;
  sg_message_id: string;
  category?: string[];
  [key: string]: unknown;
}

export interface SendGridContactInput {
  email: string;
  first_name?: string;
  last_name?: string;
  custom_fields?: Record<string, string>;
}

export interface SendGridContactSyncResult {
  job_id: string;
}

export interface SendGridList {
  id: string;
  name: string;
  contact_count: number;
}

export class SendGridAdapter implements ChannelAdapter {
  readonly platform = 'sendgrid';
  private readonly token: string;

  constructor(creds: SendGridCredentials) {
    this.token = creds.accessToken;
  }

  private hdrs(): Record<string, string> {
    return authHeaders(this.token);
  }

  async publish(draft: ContentDraft): Promise<PublishResult> {
    const payload = draft.payload as unknown as SendGridMailPayload;

    if (!payload.html_body) {
      throw new Error('Email draft has no html_body to send');
    }

    // Recipients are resolved UPSTREAM: the publish workflow turns list_source
    // (hubspot_all / sendgrid_all) into a concrete payload.to_list before calling
    // this adapter, because the adapter is credential-pure and cannot read the DB.
    // An explicit to_list also covers test sends / pre-resolved audiences. If it's
    // still empty here, the upstream resolver found no contacts.
    const recipients = Array.isArray(payload.to_list) ? payload.to_list : [];
    if (recipients.length === 0) {
      throw new Error(
        'Email recipient list is empty — no contacts resolved from HubSpot/SendGrid for this send',
      );
    }

    const htmlWithUtm = injectUtmParams(
      payload.html_body,
      payload.utm_campaign ?? draft.campaignId ?? '',
      payload.utm_content ?? draft.id,
    );
    const plainText = payload.plain_text?.trim() || htmlToPlainText(payload.html_body);

    const personalizations = recipients.map((to) => {
      const name =
        to.name ?? ([to.firstName, to.lastName].filter(Boolean).join(' ').trim() || undefined);
      return {
        to: [{ email: to.email, name }],
        // Per-recipient attribution. SendGrid merges these with the message-level
        // custom_args below, so every webhook event still carries draft_id/
        // tenant_id; recipient_email additionally identifies WHO opened/clicked.
        custom_args: { recipient_email: to.email },
      };
    });

    const body = {
      personalizations,
      from: { email: payload.from_email, name: payload.from_name },
      subject: payload.subject,
      // SendGrid requires text/plain BEFORE text/html when both are present.
      content: [
        { type: 'text/plain', value: plainText },
        { type: 'text/html', value: htmlWithUtm },
      ],
      tracking_settings: {
        click_tracking: { enable: true },
        open_tracking: { enable: true },
      },
      // Message-level args propagate to every recipient's events — this is what
      // the SendGrid webhook reads to attribute opens/clicks back to the draft.
      custom_args: {
        draft_id: draft.id,
        campaign_id: draft.campaignId ?? '',
        tenant_id: draft.tenantId,
      },
    };

    const res = await adapterFetch(`${BASE}/mail/send`, {
      method: 'POST',
      headers: this.hdrs(),
      body: JSON.stringify(body),
    });

    const messageId = res.headers.get('X-Message-Id') ?? '';
    return { externalId: messageId };
  }

  async syncContacts(
    contacts: SendGridContactInput[],
  ): Promise<SendGridContactSyncResult> {
    const res = await adapterFetch(`${BASE}/marketing/contacts`, {
      method: 'PUT',
      headers: this.hdrs(),
      body: JSON.stringify({ contacts }),
    });

    const data = (await res.json()) as { job_id: string };
    return { job_id: data.job_id };
  }

  // Global unsubscribe list — emails SendGrid will never deliver to. Used by
  // the sync bridge to propagate opt-outs back into HubSpot.
  async getGlobalUnsubscribes(): Promise<string[]> {
    const res = await adapterFetch(`${BASE}/suppression/unsubscribes`, {
      method: 'GET',
      headers: this.hdrs(),
    });

    const data = (await res.json()) as Array<{ email: string }>;
    return (data ?? []).map((r) => r.email).filter(Boolean);
  }

  async getContactLists(): Promise<SendGridList[]> {
    const res = await adapterFetch(`${BASE}/marketing/lists`, {
      method: 'GET',
      headers: this.hdrs(),
    });

    const data = (await res.json()) as { result: SendGridList[] };
    return data.result ?? [];
  }

  async fetchMetrics(draftId: string): Promise<MetricsResult> {
    if (!draftId) return EMPTY_METRICS;

    const res = await adapterFetch(
      `${BASE}/messages?query=draft_id="${draftId}"&limit=10`,
      { method: 'GET', headers: this.hdrs() },
    );

    const data = (await res.json()) as {
      messages?: Array<{
        opens_count?: number;
        clicks_count?: number;
        status?: string;
      }>;
    };

    let opens = 0;
    let clicks = 0;
    let bounces = 0;

    for (const msg of data.messages ?? []) {
      opens += msg.opens_count ?? 0;
      clicks += msg.clicks_count ?? 0;
      if (msg.status === 'bounced') bounces++;
    }

    return {
      impressions: opens,
      clicks,
      engagement: opens + clicks,
      attributedLeads: 0,
    };
  }

  async quotaState(): Promise<QuotaState> {
    const res = await adapterFetch(`${BASE}/user/credits`, {
      method: 'GET',
      headers: this.hdrs(),
    });

    const data = (await res.json()) as {
      remain?: number;
      total?: number;
      used?: number;
    };

    return {
      connected: true,
      details: {
        remaining: data.remain ?? 0,
        total: data.total ?? 0,
        used: data.used ?? 0,
      },
    };
  }
}

/**
 * Resolve a tenant's SendGrid marketing contacts into a recipient array — the
 * FALLBACK when HubSpot isn't connected (HubSpot is the system of record).
 *
 * SendGrid has no cursor to walk ALL contacts: the Search endpoint hard-limits
 * to the first 50 matches plus the total contact_count, and a full export is an
 * async job (V2). For a fallback aimed at small / test lists this page is
 * sufficient. `truncated` is set whenever contact_count exceeds what we returned
 * (the 50 ceiling OR the `limit` cap), so callers surface a real partial-list
 * signal instead of showing "50 contacts" as if it were the whole audience.
 */
export async function getAllSendGridContacts(
  apiKey: string,
  options?: { limit?: number },
): Promise<ResolvedContactList> {
  const cap = options?.limit ?? 500;

  const res = await adapterFetch(`${BASE}/marketing/contacts/search`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ query: "email LIKE '%@%'" }),
  });

  const data = (await res.json()) as {
    contact_count?: number;
    result?: Array<{ email?: string; first_name?: string; last_name?: string }>;
  };

  const contacts: ResolvedContact[] = [];
  const seen = new Set<string>();
  for (const c of data.result ?? []) {
    const email = c.email?.trim().toLowerCase();
    if (!email || !isValidEmail(email) || seen.has(email)) continue;
    if (contacts.length >= cap) break;
    seen.add(email);
    contacts.push({
      email,
      firstName: c.first_name || undefined,
      lastName: c.last_name || undefined,
    });
  }

  const total = data.contact_count ?? contacts.length;
  const truncated = total > contacts.length;
  if (truncated) {
    console.warn(
      `[sendgrid] resolved ${contacts.length} of ${total} contacts (search returns a partial page; connect HubSpot or use a contact export for the full list)`,
    );
  }
  return { contacts, truncated };
}

// Derive a plain-text alternative from the HTML body. Not a full HTML→text
// renderer — it strips tags, turns block-level closes into newlines, decodes the
// handful of entities our generated emails use, and collapses whitespace. Good
// enough for the text/plain MIME part (deliverability), never shown as content.
function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|table|section|header|footer)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function injectUtmParams(
  html: string,
  campaignId: string,
  draftId: string,
): string {
  const utmString =
    `utm_source=hailmery&utm_medium=email` +
    `&utm_campaign=${encodeURIComponent(campaignId)}` +
    `&utm_content=${encodeURIComponent(draftId)}`;

  return html.replace(
    /href="(https?:\/\/[^"]+)"/g,
    (_match, url: string) => {
      const separator = url.includes('?') ? '&' : '?';
      return `href="${url}${separator}${utmString}"`;
    },
  );
}

export function handleSendGridWebhook(
  events: SendGridEvent[],
): Array<{
  draftId: string;
  tenantId: string;
  event: string;
  email: string;
  timestamp: number;
  sgMessageId: string;
}> {
  return events
    .filter((e) => e.category || e.draft_id)
    .map((e) => ({
      draftId: (e.draft_id as string) ?? '',
      tenantId: (e.tenant_id as string) ?? '',
      event: e.event,
      email: e.email,
      timestamp: e.timestamp,
      sgMessageId: e.sg_message_id,
    }));
}
