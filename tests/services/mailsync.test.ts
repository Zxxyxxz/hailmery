import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  syncContactsToSendGrid,
  processSendGridWebhookEvents,
  type MailSyncDeps,
} from '../../src/services/mailsync.js';
import { contentMetrics, syncLog } from '../../src/db/schema.js';
import type { HubSpotContact } from '../../src/adapters/hubspot.js';
import type {
  SendGridContactInput,
  SendGridEvent,
} from '../../src/adapters/sendgrid.js';

const TENANT = '11111111-1111-1111-1111-111111111111';
const DRAFT = '22222222-2222-2222-2222-222222222222';

// ── Mock db that records all inserts, mirroring withTenantDb's contract ──
function makeMockDb() {
  const inserts: Array<{ table: unknown; rows: unknown }> = [];
  const tx = {
    execute: vi.fn(async () => ({ rows: [] })),
    insert: (table: unknown) => ({
      // Drizzle's insert builder is BOTH awaitable (syncLog: `await
      // tx.insert(...).values(...)`) AND chainable with .onConflictDoUpdate()
      // (content_metrics). Record on values() and model both continuations.
      values: (rows: unknown) => {
        inserts.push({ table, rows });
        const builder = Promise.resolve() as Promise<void> & {
          onConflictDoUpdate: () => Promise<void>;
        };
        builder.onConflictDoUpdate = () => Promise.resolve();
        return builder;
      },
    }),
  };
  const db = {
    transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  };
  return { db: db as unknown as MailSyncDeps['db'], inserts };
}

function insertsFor(
  inserts: Array<{ table: unknown; rows: unknown }>,
  table: unknown,
): unknown[] {
  return inserts
    .filter((i) => i.table === table)
    .flatMap((i) => (Array.isArray(i.rows) ? i.rows : [i.rows]));
}

function makeContacts(n: number): HubSpotContact[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `hs-${i}`,
    email: `user${i}@example.com`,
    firstname: `First${i}`,
    lastname: `Last${i}`,
    lifecyclestage: 'lead',
    hs_lead_status: 'NEW',
    hs_email_optout: '',
  }));
}

describe('syncContactsToSendGrid', () => {
  beforeEach(() => vi.clearAllMocks());

  it('batches 2,500 contacts into 1000/1000/500 SendGrid calls', async () => {
    const all = makeContacts(2500);
    const PAGE = 1000;

    const getContacts = vi.fn(
      async (opts?: { after?: string; limit?: number }) => {
        const start = opts?.after ? Number(opts.after) : 0;
        const slice = all.slice(start, start + PAGE);
        const next = start + PAGE < all.length ? String(start + PAGE) : undefined;
        return { contacts: slice, nextCursor: next };
      },
    );
    const syncContacts = vi.fn(async (_contacts: SendGridContactInput[]) => ({
      job_id: 'job-x',
    }));
    const getGlobalUnsubscribes = vi.fn(async () => [] as string[]);

    const { db, inserts } = makeMockDb();
    const deps = {
      db,
      hubspot: {
        getContacts,
        getContactByEmail: vi.fn(),
        createContact: vi.fn(),
        updateContact: vi.fn(),
        createTimelineEvent: vi.fn(),
      },
      sendgrid: { syncContacts, getGlobalUnsubscribes },
    } as unknown as MailSyncDeps;

    const result = await syncContactsToSendGrid(TENANT, deps);

    // 3 HubSpot pages followed
    expect(getContacts).toHaveBeenCalledTimes(3);
    // 3 SendGrid batches of 1000 / 1000 / 500
    expect(syncContacts).toHaveBeenCalledTimes(3);
    const sizes = syncContacts.mock.calls.map((c) => (c[0] as unknown[]).length);
    expect(sizes).toEqual([1000, 1000, 500]);

    // mapping shape check on the first contact of the first batch
    const firstBatch = syncContacts.mock.calls[0][0] as Array<{
      email: string;
      first_name: string;
      custom_fields: Record<string, string>;
    }>;
    expect(firstBatch[0]).toMatchObject({
      email: 'user0@example.com',
      first_name: 'First0',
      custom_fields: { hubspot_id: 'hs-0', lifecycle_stage: 'lead', lead_status: 'NEW' },
    });

    expect(result.contactsSynced).toBe(2500);
    expect(result.errors).toEqual([]);

    const logRows = insertsFor(inserts, syncLog) as Array<Record<string, unknown>>;
    expect(logRows).toHaveLength(1);
    expect(logRows[0]).toMatchObject({
      direction: 'hubspot_to_sendgrid',
      contactsSynced: 2500,
    });
  });
});

describe('processSendGridWebhookEvents', () => {
  beforeEach(() => vi.clearAllMocks());

  function baseEvent(over: Partial<SendGridEvent>): SendGridEvent {
    return {
      email: 'ben@acme.com',
      event: 'open',
      timestamp: 1716800000,
      sg_message_id: 'msg-1',
      draft_id: DRAFT,
      campaign_id: 'camp-1',
      ...over,
    } as SendGridEvent;
  }

  function foundContactDeps(db: MailSyncDeps['db']): MailSyncDeps {
    return {
      db,
      hubspot: {
        getContacts: vi.fn(),
        getContactByEmail: vi.fn(async () => 'cid-1'),
        createContact: vi.fn(async () => 'cid-new'),
        updateContact: vi.fn(async () => undefined),
        createTimelineEvent: vi.fn(async () => undefined),
      },
      sendgrid: { syncContacts: vi.fn(), getGlobalUnsubscribes: vi.fn() },
    } as unknown as MailSyncDeps;
  }

  it('aggregates a draft\'s events into one content_metrics row per window', async () => {
    const { db, inserts } = makeMockDb();
    const deps = foundContactDeps(db);

    await processSendGridWebhookEvents(
      TENANT,
      [
        baseEvent({ event: 'delivered' }),
        baseEvent({ event: 'open' }),
        baseEvent({ event: 'click' }),
        baseEvent({ event: 'bounce' }),
      ],
      deps,
    );

    const metrics = insertsFor(inserts, contentMetrics) as Array<Record<string, unknown>>;
    // All of one draft's events in a batch collapse into a SINGLE row — the
    // unique (tenant, draft, window) index forbids duplicates, and the upsert
    // cannot touch the same conflict target twice. delivered + open => 2
    // impressions; click => 1 click; engagement = impressions + clicks = 3;
    // bounce contributes nothing.
    expect(metrics).toHaveLength(1);
    expect(metrics[0]).toEqual(
      expect.objectContaining({
        draftId: DRAFT,
        window: '1h',
        impressions: 2,
        clicks: 1,
        engagement: 3,
      }),
    );
  });

  it('propagates unsubscribe to HubSpot and writes a compliance sync_log row', async () => {
    const { db, inserts } = makeMockDb();
    const deps = foundContactDeps(db);

    await processSendGridWebhookEvents(
      TENANT,
      [baseEvent({ event: 'unsubscribe' })],
      deps,
    );

    expect(deps.hubspot.updateContact).toHaveBeenCalledWith('ben@acme.com', {
      unsubscribed: 'true',
      hs_email_optout: 'true',
    });
    expect(deps.hubspot.createTimelineEvent).toHaveBeenCalledWith(
      'ben@acme.com',
      expect.objectContaining({ eventType: 'email_unsubscribed' }),
    );

    const logRows = insertsFor(inserts, syncLog) as Array<Record<string, unknown>>;
    expect(logRows).toHaveLength(1);
    expect(logRows[0]).toMatchObject({
      direction: 'unsubscribe_propagated',
      eventsProcessed: 1,
    });
  });

  it('creates the contact in HubSpot when the webhook email is unknown', async () => {
    const { db } = makeMockDb();
    const deps = foundContactDeps(db);
    (deps.hubspot.getContactByEmail as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await processSendGridWebhookEvents(
      TENANT,
      [baseEvent({ event: 'open', email: 'nobody@new.com' })],
      deps,
    );

    expect(deps.hubspot.createContact).toHaveBeenCalledWith({
      email: 'nobody@new.com',
      lifecyclestage: 'lead',
    });
    expect(deps.hubspot.createTimelineEvent).toHaveBeenCalledWith(
      'nobody@new.com',
      expect.objectContaining({ eventType: 'email_opened' }),
    );
  });
});
