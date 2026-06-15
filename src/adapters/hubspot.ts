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

export interface ResolvedContact {
  email: string;
  firstName?: string;
  lastName?: string;
}

export interface ResolvedContactList {
  contacts: ResolvedContact[];
  // True when more mailable contacts existed than were returned (the cap was hit,
  // or the provider hard-limited the page). Lets callers surface a real "list
  // truncated" signal instead of inferring it from `contacts.length === cap`.
  truncated: boolean;
}

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
  hs_email_optout: string;
}

export interface HubSpotContactsResult {
  contacts: HubSpotContact[];
  nextCursor?: string;
}

export type HubSpotEventType =
  | 'email_delivered'
  | 'email_opened'
  | 'email_clicked'
  | 'email_bounced'
  | 'email_unsubscribed'
  | 'email_spam_reported';

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
      'email,firstname,lastname,lifecyclestage,hs_lead_status,hs_email_optout',
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
        hs_email_optout: r.properties.hs_email_optout ?? '',
      })),
      nextCursor: data.paging?.next?.after,
    };
  }

  async getContactByEmail(email: string): Promise<string | null> {
    return getContactByEmail(this.token, email);
  }

  async createContact(properties: Record<string, string>): Promise<string> {
    const res = await adapterFetch(`${BASE}/crm/v3/objects/contacts`, {
      method: 'POST',
      headers: this.hdrs(),
      body: JSON.stringify({ properties }),
    });
    const data = (await res.json()) as { id: string };
    return data.id;
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

/**
 * Resolve a tenant's full HubSpot contact list into a concrete recipient array
 * for an email send. Walks the contacts API via the paging cursor, then:
 *   - drops contacts with no / malformed email,
 *   - drops anyone with hs_email_optout='true' (compliance — opted-out contacts
 *     must never be emailed),
 *   - de-dupes by lowercased email,
 *   - hard-stops at `limit` (default 500) as a send-safety cap.
 * Returns at most `limit` contacts plus a `truncated` flag set ONLY when a
 * genuine (cap+1)th mailable contact exists — so a tenant with exactly `limit`
 * contacts is not mislabelled as truncated. A warning is logged (no email
 * addresses) when truncation happens so a partial send is never silent.
 */
export async function getAllContacts(
  accessToken: string,
  options?: { limit?: number },
): Promise<ResolvedContactList> {
  const cap = options?.limit ?? 500;
  const adapter = new HubSpotAdapter({ accessToken, extra: {} });

  const contacts: ResolvedContact[] = [];
  const seen = new Set<string>();
  let after: string | undefined;
  let truncated = false;

  do {
    const page = await adapter.getContacts({ after, limit: 100 });
    for (const c of page.contacts) {
      if (c.hs_email_optout === 'true') continue; // never email opted-out contacts
      const email = c.email?.trim().toLowerCase();
      if (!email || !isValidEmail(email) || seen.has(email)) continue;
      // We already have `cap` recipients and just found another mailable one —
      // the list is genuinely larger than the cap. Stop and flag it.
      if (contacts.length >= cap) {
        truncated = true;
        break;
      }
      seen.add(email);
      contacts.push({
        email,
        firstName: c.firstname || undefined,
        lastName: c.lastname || undefined,
      });
    }
    after = page.nextCursor;
  } while (after && !truncated);

  if (truncated) {
    console.warn(`[hubspot] contact list truncated at cap ${cap} — more mailable contacts exist`);
  }
  return { contacts, truncated };
}
