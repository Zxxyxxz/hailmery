import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  HubSpotAdapter,
  getContactByEmail,
  getAllContacts,
  type HubSpotCredentials,
} from '../../src/adapters/hubspot.js';
import type { ContentDraft } from '../../src/db/schema.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const creds: HubSpotCredentials = {
  accessToken: 'hs_test_token',
  extra: { eventTemplateId: 'tmpl-001' },
};

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
    headers: new Headers(),
  };
}

describe('HubSpotAdapter', () => {
  let adapter: HubSpotAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new HubSpotAdapter(creds);
  });

  describe('getContacts', () => {
    it('returns contacts with pagination cursor', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          results: [
            {
              id: 'c1',
              properties: {
                email: 'ben@acme.com',
                firstname: 'Ben',
                lastname: 'Smith',
                lifecyclestage: 'lead',
                hs_lead_status: 'NEW',
              },
            },
          ],
          paging: { next: { after: 'cursor-2' } },
        }),
      );

      const result = await adapter.getContacts({ limit: 10 });

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/crm/v3/objects/contacts');
      expect(init.headers).toHaveProperty('Authorization', 'Bearer hs_test_token');

      expect(result.contacts).toHaveLength(1);
      expect(result.contacts[0].email).toBe('ben@acme.com');
      expect(result.nextCursor).toBe('cursor-2');
    });
  });

  describe('createTimelineEvent', () => {
    it('creates a timeline event for a contact', async () => {
      // First call: contact search
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ results: [{ id: 'c1' }] }),
      );
      // Second call: timeline event creation
      mockFetch.mockResolvedValueOnce(jsonResponse({}));

      await adapter.createTimelineEvent('ben@acme.com', {
        eventType: 'email_opened',
        timestamp: '2026-05-27T10:00:00Z',
        details: { subject: 'NIS2 newsletter' },
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);
      const [timelineUrl, timelineInit] = mockFetch.mock.calls[1] as [string, RequestInit];
      expect(timelineUrl).toContain('/crm/v3/timeline/events');
      const body = JSON.parse(timelineInit.body as string);
      expect(body.eventTemplateId).toBe('tmpl-001');
      expect(body.objectId).toBe('c1');
    });
  });

  describe('updateContact', () => {
    it('patches contact properties', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ results: [{ id: 'c1' }] }))
        .mockResolvedValueOnce(jsonResponse({}));

      await adapter.updateContact('ben@acme.com', {
        hs_lead_status: 'UNQUALIFIED',
      });

      const [patchUrl, patchInit] = mockFetch.mock.calls[1] as [string, RequestInit];
      expect(patchUrl).toContain('/crm/v3/objects/contacts/c1');
      expect(patchInit.method).toBe('PATCH');
    });
  });

  describe('publish', () => {
    it('throws — HubSpot does not support publishing', async () => {
      const draft = {} as ContentDraft;
      await expect(adapter.publish(draft)).rejects.toThrow('does not support');
    });
  });

  describe('fetchMetrics', () => {
    it('returns empty metrics', async () => {
      const m = await adapter.fetchMetrics('any');
      expect(m.impressions).toBe(0);
    });
  });

  describe('quotaState', () => {
    it('confirms connectivity', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ results: [] }));
      const q = await adapter.quotaState();
      expect(q.connected).toBe(true);
    });
  });

  describe('error handling', () => {
    it('throws on 401', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}, 401));
      await expect(adapter.getContacts()).rejects.toThrow('HTTP 401');
    });

    it('throws on 429', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}, 429));
      await expect(adapter.quotaState()).rejects.toThrow('HTTP 429');
    });

    it('throws on 500', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}, 500));
      await expect(adapter.quotaState()).rejects.toThrow('HTTP 500');
    });
  });
});

describe('getContactByEmail', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns contact ID on match', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ results: [{ id: 'c42' }] }),
    );
    const id = await getContactByEmail('tok', 'user@example.com');
    expect(id).toBe('c42');
  });

  it('returns null when no match', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ results: [] }));
    const id = await getContactByEmail('tok', 'nobody@example.com');
    expect(id).toBeNull();
  });
});

describe('getAllContacts', () => {
  beforeEach(() => vi.clearAllMocks());

  function page(
    contacts: Array<Record<string, string>>,
    after?: string,
  ) {
    return jsonResponse({
      results: contacts.map((properties, i) => ({ id: `id-${i}`, properties })),
      paging: after ? { next: { after } } : undefined,
    });
  }

  it('excludes opted-out + invalid emails, de-dupes, and follows the paging cursor', async () => {
    mockFetch
      .mockResolvedValueOnce(
        page(
          [
            { email: 'keep@a.com', firstname: 'Keep', lastname: 'One' },
            { email: 'optout@a.com', hs_email_optout: 'true' }, // compliance: must be dropped
            { email: 'not-an-email' }, // invalid: must be dropped
          ],
          'cursor-2',
        ),
      )
      .mockResolvedValueOnce(
        page([
          { email: 'KEEP@a.com' }, // duplicate (case-insensitive)
          { email: 'second@a.com', firstname: 'Sec' },
        ]),
      );

    const { contacts, truncated } = await getAllContacts('tok');

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(contacts.map((c) => c.email)).toEqual(['keep@a.com', 'second@a.com']);
    expect(contacts[0].firstName).toBe('Keep');
    expect(truncated).toBe(false);
  });

  it('never emails an opted-out contact even if it is the only one', async () => {
    mockFetch.mockResolvedValueOnce(
      page([{ email: 'optout@a.com', hs_email_optout: 'true' }]),
    );
    const { contacts } = await getAllContacts('tok');
    expect(contacts).toHaveLength(0);
  });

  it('caps at the limit and flags truncated when more mailable contacts exist', async () => {
    mockFetch.mockResolvedValueOnce(
      page([{ email: 'a@x.com' }, { email: 'b@x.com' }, { email: 'c@x.com' }]),
    );
    const { contacts, truncated } = await getAllContacts('tok', { limit: 2 });
    expect(contacts).toHaveLength(2);
    expect(truncated).toBe(true);
  });

  it('does NOT flag truncated when the count exactly equals the cap', async () => {
    mockFetch.mockResolvedValueOnce(page([{ email: 'a@x.com' }, { email: 'b@x.com' }]));
    const { contacts, truncated } = await getAllContacts('tok', { limit: 2 });
    expect(contacts).toHaveLength(2);
    expect(truncated).toBe(false);
  });
});
