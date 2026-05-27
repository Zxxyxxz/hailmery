import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SendGridAdapter,
  handleSendGridWebhook,
  type SendGridCredentials,
  type SendGridEvent,
} from '../../src/adapters/sendgrid.js';
import type { ContentDraft } from '../../src/db/schema.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const creds: SendGridCredentials = { accessToken: 'sg_test_key' };

function makeDraft(overrides: Partial<ContentDraft> = {}): ContentDraft {
  return {
    id: 'draft-1',
    tenantId: 'tenant-1',
    campaignId: 'camp-1',
    siteId: 'site-1',
    pillar: null,
    channel: 'email',
    status: 'approved',
    payload: {
      subject: 'NIS2 Update',
      html_body: '<p>Hello <a href="https://apire.io/pricing">click here</a></p>',
      from_email: 'hello@apire.io',
      from_name: 'APIRE',
      to_list: [{ email: 'ben@acme.com', name: 'Ben' }],
      utm_campaign: 'nis2-launch',
      utm_content: 'draft-1',
    },
    assets: {},
    scoreHuman: null,
    dismissReason: null,
    publishAt: null,
    publishedRef: null,
    costCents: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as ContentDraft;
}

function jsonResponse(data: unknown, status = 200, headers?: Record<string, string>) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
    headers: new Headers(headers),
  };
}

describe('SendGridAdapter', () => {
  let adapter: SendGridAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new SendGridAdapter(creds);
  });

  describe('publish', () => {
    it('sends email with UTM-injected links', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({}, 202, { 'X-Message-Id': 'msg-xyz' }),
      );

      const result = await adapter.publish(makeDraft());

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.sendgrid.com/v3/mail/send');
      expect(init.headers).toHaveProperty('Authorization', 'Bearer sg_test_key');

      const body = JSON.parse(init.body as string);
      expect(body.subject).toBe('NIS2 Update');
      expect(body.content[0].value).toContain('utm_source=hailmery');
      expect(body.content[0].value).toContain('utm_medium=email');
      expect(body.content[0].value).toContain('utm_campaign=nis2-launch');
      expect(body.custom_args.draft_id).toBe('draft-1');

      expect(result.externalId).toBe('msg-xyz');
    });
  });

  describe('syncContacts', () => {
    it('upserts contacts and returns job_id', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ job_id: 'job-1' }));

      const result = await adapter.syncContacts([
        { email: 'a@b.com', first_name: 'A' },
      ]);

      expect(result.job_id).toBe('job-1');
      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toContain('/marketing/contacts');
    });
  });

  describe('getContactLists', () => {
    it('returns lists', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ result: [{ id: 'l1', name: 'CISOs', contact_count: 42 }] }),
      );

      const lists = await adapter.getContactLists();
      expect(lists).toHaveLength(1);
      expect(lists[0].name).toBe('CISOs');
    });
  });

  describe('fetchMetrics', () => {
    it('aggregates message stats', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          messages: [
            { opens_count: 10, clicks_count: 3, status: 'delivered' },
            { opens_count: 5, clicks_count: 1, status: 'bounced' },
          ],
        }),
      );

      const m = await adapter.fetchMetrics('draft-1');
      expect(m.impressions).toBe(15);
      expect(m.clicks).toBe(4);
    });
  });

  describe('quotaState', () => {
    it('returns credit info', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ remain: 950, total: 1000, used: 50 }),
      );

      const q = await adapter.quotaState();
      expect(q.connected).toBe(true);
      expect(q.details.remaining).toBe(950);
    });
  });

  describe('error handling', () => {
    it('throws on 401', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}, 401));
      await expect(adapter.publish(makeDraft())).rejects.toThrow('HTTP 401');
    });

    it('throws on 429', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}, 429));
      await expect(adapter.publish(makeDraft())).rejects.toThrow('HTTP 429');
    });

    it('throws on 500', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}, 500));
      await expect(adapter.publish(makeDraft())).rejects.toThrow('HTTP 500');
    });
  });
});

describe('handleSendGridWebhook', () => {
  it('parses events with draft_id into rows', () => {
    const events: SendGridEvent[] = [
      {
        email: 'ben@acme.com',
        event: 'open',
        timestamp: 1716800000,
        sg_message_id: 'msg-1',
        draft_id: 'draft-1',
        tenant_id: 'tenant-1',
      },
      {
        email: 'nobody@test.com',
        event: 'click',
        timestamp: 1716800100,
        sg_message_id: 'msg-2',
      },
    ];

    const rows = handleSendGridWebhook(events);
    expect(rows).toHaveLength(1);
    expect(rows[0].draftId).toBe('draft-1');
    expect(rows[0].event).toBe('open');
  });
});
