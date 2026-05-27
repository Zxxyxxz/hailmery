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

const BASE = 'https://api.hubapi.com';

export interface HubSpotCredentials extends AdapterCredentials {
  extra: {
    eventTemplateId?: string;
  };
}

export interface HubSpotContact {
  id: string;
  email: string;
  firstname: string;
  lastname: string;
  lifecyclestage: string;
  hs_lead_status: string;
}

export interface HubSpotContactsResult {
  contacts: HubSpotContact[];
  nextCursor?: string;
}

export type HubSpotEventType =
  | 'email_opened'
  | 'email_clicked'
  | 'email_bounced'
  | 'email_unsubscribed';

export interface HubSpotTimelineEvent {
  eventType: HubSpotEventType;
  timestamp: string;
  details?: Record<string, string>;
}

export class HubSpotAdapter implements ChannelAdapter {
  readonly platform = 'hubspot';
  private readonly token: string;
  private readonly eventTemplateId: string | undefined;

  constructor(creds: HubSpotCredentials) {
    this.token = creds.accessToken;
    this.eventTemplateId = creds.extra?.eventTemplateId;
  }

  private hdrs(): Record<string, string> {
    return authHeaders(this.token);
  }

  async getContacts(options?: {
    after?: string;
    limit?: number;
  }): Promise<HubSpotContactsResult> {
    const params = new URLSearchParams();
    params.set(
      'properties',
      'email,firstname,lastname,lifecyclestage,hs_lead_status',
    );
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.after) params.set('after', options.after);

    const res = await adapterFetch(
      `${BASE}/crm/v3/objects/contacts?${params}`,
      { method: 'GET', headers: this.hdrs() },
    );

    const data = (await res.json()) as {
      results: Array<{ id: string; properties: Record<string, string> }>;
      paging?: { next?: { after: string } };
    };

    return {
      contacts: data.results.map((r) => ({
        id: r.id,
        email: r.properties.email ?? '',
        firstname: r.properties.firstname ?? '',
        lastname: r.properties.lastname ?? '',
        lifecyclestage: r.properties.lifecyclestage ?? '',
        hs_lead_status: r.properties.hs_lead_status ?? '',
      })),
      nextCursor: data.paging?.next?.after,
    };
  }

  async createTimelineEvent(
    contactEmail: string,
    event: HubSpotTimelineEvent,
  ): Promise<void> {
    if (!this.eventTemplateId) {
      throw new Error('HubSpot eventTemplateId is required for timeline events');
    }

    const contact = await getContactByEmail(this.token, contactEmail);
    if (!contact) {
      throw new Error(`HubSpot contact not found: ${contactEmail}`);
    }

    const body = {
      eventTemplateId: this.eventTemplateId,
      objectId: contact,
      timestamp: event.timestamp,
      tokens: {
        eventType: event.eventType,
        ...event.details,
      },
    };

    await adapterFetch(`${BASE}/crm/v3/timeline/events`, {
      method: 'POST',
      headers: this.hdrs(),
      body: JSON.stringify(body),
    });
  }

  async updateContact(
    email: string,
    properties: Record<string, string>,
  ): Promise<void> {
    const contactId = await getContactByEmail(this.token, email);
    if (!contactId) {
      throw new Error(`HubSpot contact not found: ${email}`);
    }

    await adapterFetch(`${BASE}/crm/v3/objects/contacts/${contactId}`, {
      method: 'PATCH',
      headers: this.hdrs(),
      body: JSON.stringify({ properties }),
    });
  }

  async publish(_draft: ContentDraft): Promise<PublishResult> {
    throw new Error('HubSpot adapter does not support direct publishing');
  }

  async fetchMetrics(_draftId: string): Promise<MetricsResult> {
    return EMPTY_METRICS;
  }

  async quotaState(): Promise<QuotaState> {
    const res = await adapterFetch(
      `${BASE}/crm/v3/objects/contacts?limit=1`,
      { method: 'GET', headers: this.hdrs() },
    );
    await res.json();
    return { connected: true, details: { status: 'ok' } };
  }
}

export async function getContactByEmail(
  token: string,
  email: string,
): Promise<string | null> {
  const body = {
    filterGroups: [
      {
        filters: [
          { propertyName: 'email', operator: 'EQ', value: email },
        ],
      },
    ],
    properties: ['email'],
    limit: 1,
  };

  const res = await adapterFetch(
    `${BASE}/crm/v3/objects/contacts/search`,
    {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify(body),
    },
  );

  const data = (await res.json()) as {
    results: Array<{ id: string }>;
  };

  return data.results[0]?.id ?? null;
}
