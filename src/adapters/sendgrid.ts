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
} from './index.js';

const BASE = 'https://api.sendgrid.com/v3';

export interface SendGridCredentials extends AdapterCredentials {}

export interface SendGridMailPayload {
  subject: string;
  html_body: string;
  from_email: string;
  from_name: string;
  to_list: Array<{ email: string; name?: string }>;
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

    const htmlWithUtm = injectUtmParams(
      payload.html_body,
      payload.utm_campaign ?? draft.campaignId ?? '',
      payload.utm_content ?? draft.id,
    );

    const personalizations = payload.to_list.map((to) => ({
      to: [{ email: to.email, name: to.name }],
    }));

    const body = {
      personalizations,
      from: { email: payload.from_email, name: payload.from_name },
      subject: payload.subject,
      content: [{ type: 'text/html', value: htmlWithUtm }],
      tracking_settings: {
        click_tracking: { enable: true },
        open_tracking: { enable: true },
      },
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
    contacts: Array<{ email: string; first_name?: string; last_name?: string }>,
  ): Promise<SendGridContactSyncResult> {
    const res = await adapterFetch(`${BASE}/marketing/contacts`, {
      method: 'PUT',
      headers: this.hdrs(),
      body: JSON.stringify({ contacts }),
    });

    const data = (await res.json()) as { job_id: string };
    return { job_id: data.job_id };
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
