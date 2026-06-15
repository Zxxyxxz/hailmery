import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the DB token loader and the two contact resolvers. importOriginal keeps the
// modules' other exports intact (index.js re-exports from these, and the resolver
// imports the real isValidEmail from adapters/index.js).
vi.mock('../../src/lib/tenant.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/tenant.js')>();
  return { ...actual, loadPlatformToken: vi.fn() };
});
vi.mock('../../src/adapters/hubspot.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/adapters/hubspot.js')>();
  return { ...actual, getAllContacts: vi.fn() };
});
vi.mock('../../src/adapters/sendgrid.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/adapters/sendgrid.js')>();
  return { ...actual, getAllSendGridContacts: vi.fn() };
});

import {
  resolveEmailRecipients,
  RecipientResolutionError,
} from '../../src/services/recipients.js';
import { loadPlatformToken } from '../../src/lib/tenant.js';
import { getAllContacts } from '../../src/adapters/hubspot.js';
import { getAllSendGridContacts } from '../../src/adapters/sendgrid.js';

const loadToken = vi.mocked(loadPlatformToken);
const hubspotAll = vi.mocked(getAllContacts);
const sendgridAll = vi.mocked(getAllSendGridContacts);

// db is never touched on the paths under test (explicit / no-source short-circuit,
// and the platform paths only pass db through to the mocked loadPlatformToken).
const base = { db: {} as never, tenantId: 't1', secretsKey: 'k' };

describe('resolveEmailRecipients', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses an explicit to_list before any platform lookup', async () => {
    const r = await resolveEmailRecipients({
      ...base,
      payload: { list_source: 'hubspot_all', to_list: ['A@x.com', 'a@x.com', 'bad', { email: 'b@x.com', firstName: 'B' }] },
    });
    expect(r.source).toBe('explicit');
    expect(r.recipients.map((c) => c.email)).toEqual(['a@x.com', 'b@x.com']); // deduped, lowercased, invalid dropped
    expect(r.capped).toBe(false);
    expect(loadToken).not.toHaveBeenCalled();
    expect(hubspotAll).not.toHaveBeenCalled();
  });

  it('caps an oversized explicit list and flags capped', async () => {
    const big = Array.from({ length: 5 }, (_, i) => `u${i}@x.com`);
    const r = await resolveEmailRecipients({ ...base, payload: { to_list: big }, limit: 2 });
    expect(r.recipients).toHaveLength(2);
    expect(r.capped).toBe(true);
  });

  it('throws no_list_source when neither to_list nor list_source is set', async () => {
    await expect(resolveEmailRecipients({ ...base, payload: {} })).rejects.toMatchObject({
      code: 'no_list_source',
    });
  });

  it('throws no_valid_contacts when the explicit list has no valid email', async () => {
    await expect(
      resolveEmailRecipients({ ...base, payload: { to_list: ['nope', { email: 'also-bad' }] } }),
    ).rejects.toBeInstanceOf(RecipientResolutionError);
  });

  it('throws hubspot_not_connected when HubSpot has no token', async () => {
    loadToken.mockResolvedValueOnce(null);
    await expect(
      resolveEmailRecipients({ ...base, payload: { list_source: 'hubspot_all' } }),
    ).rejects.toMatchObject({ code: 'hubspot_not_connected' });
    expect(loadToken).toHaveBeenCalledWith(base.db, 't1', 'hubspot', 'k');
  });

  it('resolves HubSpot contacts and passes truncation through to capped', async () => {
    loadToken.mockResolvedValueOnce('hs-token');
    hubspotAll.mockResolvedValueOnce({
      contacts: [{ email: 'a@x.com' }, { email: 'b@x.com' }],
      truncated: true,
    });
    const r = await resolveEmailRecipients({ ...base, payload: { list_source: 'hubspot_all' } });
    expect(r.source).toBe('hubspot_all');
    expect(r.recipients).toHaveLength(2);
    expect(r.capped).toBe(true);
  });

  it('throws no_valid_contacts when HubSpot returns an empty list', async () => {
    loadToken.mockResolvedValueOnce('hs-token');
    hubspotAll.mockResolvedValueOnce({ contacts: [], truncated: false });
    await expect(
      resolveEmailRecipients({ ...base, payload: { list_source: 'hubspot_all' } }),
    ).rejects.toMatchObject({ code: 'no_valid_contacts' });
  });

  it('falls back to SendGrid and surfaces its truncation', async () => {
    loadToken.mockResolvedValueOnce('sg-token');
    sendgridAll.mockResolvedValueOnce({ contacts: [{ email: 'a@x.com' }], truncated: true });
    const r = await resolveEmailRecipients({ ...base, payload: { list_source: 'sendgrid_all' } });
    expect(r.source).toBe('sendgrid_all');
    expect(r.capped).toBe(true);
    expect(loadToken).toHaveBeenCalledWith(base.db, 't1', 'sendgrid', 'k');
  });

  it('throws sendgrid_not_connected when SendGrid has no token', async () => {
    loadToken.mockResolvedValueOnce(null);
    await expect(
      resolveEmailRecipients({ ...base, payload: { list_source: 'sendgrid_all' } }),
    ).rejects.toMatchObject({ code: 'sendgrid_not_connected' });
  });
});
