// Bidirectional HubSpot <-> SendGrid sync bridge.
//
//   Part 1  syncContactsToSendGrid       HubSpot contacts -> SendGrid lists
//   Part 2  processSendGridWebhookEvents  SendGrid events  -> HubSpot timeline
//
// The two exported sync functions take their adapters and db via `deps` so
// they can be unit-tested with mocks and driven in production by
// `resolveMailSyncDeps`, which loads + decrypts tenant_secrets.

import type { NeonDatabase } from 'drizzle-orm/neon-serverless';
import { sql } from 'drizzle-orm';
import { contentMetrics, syncLog } from '../db/schema.js';
import { withTenantDb, loadPlatformToken } from '../lib/tenant.js';
import { makeDb } from '../db/client.js';
import {
  HubSpotAdapter,
  type HubSpotContact,
  type HubSpotContactsResult,
  type HubSpotTimelineEvent,
  type HubSpotEventType,
} from '../adapters/hubspot.js';
import {
  SendGridAdapter,
  type SendGridContactInput,
  type SendGridContactSyncResult,
  type SendGridEvent,
} from '../adapters/sendgrid.js';

type Db = NeonDatabase<Record<string, unknown>>;

// Minimal adapter surfaces the bridge depends on — lets tests inject mocks
// without constructing real adapters or stubbing fetch.
export interface HubSpotSync {
  getContacts(opts?: {
    after?: string;
    limit?: number;
  }): Promise<HubSpotContactsResult>;
  getContactByEmail(email: string): Promise<string | null>;
  createContact(properties: Record<string, string>): Promise<string>;
  updateContact(email: string, properties: Record<string, string>): Promise<void>;
  createTimelineEvent(email: string, event: HubSpotTimelineEvent): Promise<void>;
}

export interface SendGridSync {
  syncContacts(contacts: SendGridContactInput[]): Promise<SendGridContactSyncResult>;
  getGlobalUnsubscribes(): Promise<string[]>;
}

export interface MailSyncDeps {
  db: Db;
  hubspot: HubSpotSync;
  sendgrid: SendGridSync;
  // HubSpot custom timeline events require a public app + OAuth; with the
  // current private-app token they're skipped (deferred to V2). Undefined =
  // attempt (keeps existing unit tests, which inject mocks, unaffected).
  timelineEnabled?: boolean;
}

export interface MailSyncEnv {
  DATABASE_URL: string;
  SECRETS_KEY: string;
  HUBSPOT_EVENT_TEMPLATE_ID?: string;
}

const SENDGRID_LIST_BATCH = 1000;

// SendGrid event name -> HubSpot timeline event. Events not in this map
// (processed, dropped, deferred, ...) are ignored by the bridge.
const SENDGRID_TO_HUBSPOT: Record<string, HubSpotEventType> = {
  delivered: 'email_delivered',
  open: 'email_opened',
  click: 'email_clicked',
  bounce: 'email_bounced',
  unsubscribe: 'email_unsubscribed',
  spamreport: 'email_spam_reported',
};

const SUPPRESSION_EVENTS = new Set(['unsubscribe', 'spamreport']);
const IMPRESSION_EVENTS = new Set(['open', 'delivered']);

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ──────────────────────────────────────────────────────────────────
// Part 1 — HubSpot contacts → SendGrid lists
// ──────────────────────────────────────────────────────────────────

export interface ContactSyncResult {
  contactsSynced: number;
  errors: string[];
}

export async function syncContactsToSendGrid(
  tenantId: string,
  deps: MailSyncDeps,
): Promise<ContactSyncResult> {
  const { db, hubspot, sendgrid } = deps;
  const errors: string[] = [];

  // 1 + 2. Pull all HubSpot contacts, following the pagination cursor until
  // nextCursor is null/undefined.
  const contacts: HubSpotContact[] = [];
  let after: string | undefined;
  do {
    const page = await hubspot.getContacts({ after, limit: 100 });
    contacts.push(...page.contacts);
    after = page.nextCursor;
  } while (after);

  // 3. Map to SendGrid contact shape.
  const mapped: SendGridContactInput[] = contacts.map((c) => ({
    email: c.email,
    first_name: c.firstname,
    last_name: c.lastname,
    custom_fields: {
      hubspot_id: c.id,
      lifecycle_stage: c.lifecyclestage,
      lead_status: c.hs_lead_status,
    },
  }));

  // 4. Batch upsert to SendGrid in groups of 1000.
  let contactsSynced = 0;
  for (const batch of chunk(mapped, SENDGRID_LIST_BATCH)) {
    try {
      await sendgrid.syncContacts(batch);
      contactsSynced += batch.length;
    } catch (err) {
      errors.push(`sendgrid syncContacts (batch ${batch.length}): ${errMsg(err)}`);
    }
  }

  // 5. Reconcile: contacts unsubscribed in SendGrid but not yet in HubSpot.
  try {
    const sgUnsubs = await sendgrid.getGlobalUnsubscribes();
    const byEmail = new Map(contacts.map((c) => [c.email.toLowerCase(), c]));
    for (const email of sgUnsubs) {
      const contact = byEmail.get(email.toLowerCase());
      if (!contact) continue; // not a HubSpot contact we know about
      if (contact.hs_email_optout === 'true') continue; // already opted out
      try {
        await hubspot.updateContact(email, {
          unsubscribed: 'true',
          hs_email_optout: 'true',
        });
      } catch (err) {
        errors.push(`hubspot updateContact (reconcile ${email}): ${errMsg(err)}`);
      }
    }
  } catch (err) {
    errors.push(`sendgrid getGlobalUnsubscribes: ${errMsg(err)}`);
  }

  // 6. Sync-log row.
  await withTenantDb(db, tenantId, async (tx) => {
    await tx.insert(syncLog).values({
      tenantId,
      direction: 'hubspot_to_sendgrid',
      contactsSynced,
      eventsProcessed: 0,
      errors,
    });
  });

  return { contactsSynced, errors };
}

// ──────────────────────────────────────────────────────────────────
// Part 2 — SendGrid webhook events → HubSpot timeline
// ──────────────────────────────────────────────────────────────────

export interface WebhookProcessResult {
  eventsProcessed: number;
  metricsWritten: number;
  complianceWritten: number;
}

type MetricRow = typeof contentMetrics.$inferInsert;
type SyncLogRow = typeof syncLog.$inferInsert;

export async function processSendGridWebhookEvents(
  tenantId: string,
  events: SendGridEvent[],
  deps: MailSyncDeps,
): Promise<WebhookProcessResult> {
  const { db, hubspot } = deps;

  // Aggregate metric contributions per draft. The unique index on
  // (tenant_id, draft_id, window) forbids duplicate rows, and a multi-row
  // upsert cannot touch the same conflict target twice — so a batch with
  // several opens of one draft must collapse to a SINGLE row here.
  const metricsByDraft = new Map<
    string,
    { impressions: number; clicks: number; engagement: number }
  >();
  const complianceRows: SyncLogRow[] = [];
  const hubspotErrors: string[] = [];
  let eventsProcessed = 0;

  for (const ev of events) {
    const eventName = String(ev.event ?? '');
    const hubspotEvent = SENDGRID_TO_HUBSPOT[eventName];
    if (!hubspotEvent) continue; // ignore non-mapped events

    eventsProcessed++;

    // 1. Extract email, type, timestamp, custom args set at send time.
    const email = ev.email;
    const draftId = typeof ev.draft_id === 'string' ? ev.draft_id : '';
    const campaignId = typeof ev.campaign_id === 'string' ? ev.campaign_id : '';
    const timestampIso = new Date((ev.timestamp ?? 0) * 1000).toISOString();

    // 2. Metric contribution (window '1h'). Accumulated independently of
    //    HubSpot so a HubSpot outage never costs us engagement data.
    const isClick = eventName === 'click';
    const isImpression = IMPRESSION_EVENTS.has(eventName);
    if (draftId && (isClick || isImpression)) {
      const agg = metricsByDraft.get(draftId) ?? { impressions: 0, clicks: 0, engagement: 0 };
      if (isImpression) agg.impressions += 1;
      if (isClick) agg.clicks += 1;
      agg.engagement = agg.impressions + agg.clicks;
      metricsByDraft.set(draftId, agg);
    }

    // 3. HubSpot timeline + suppression — isolated per event so one failure
    //    (e.g. a bad event-template id) can't abort the batch or lose the
    //    metrics written below. Failures surface to sync_log, never swallowed.
    if (!email) continue;
    try {
      const contactId = await hubspot.getContactByEmail(email);
      if (!contactId) {
        await hubspot.createContact({ email, lifecyclestage: 'lead' });
      }

      // Timeline enrichment is deferred to V2: HubSpot custom timeline events
      // need a public app + OAuth, which the private-app token can't do. The
      // contact ensure above and suppression below DO work with the private app.
      if (deps.timelineEnabled !== false) {
        await hubspot.createTimelineEvent(email, {
          eventType: hubspotEvent,
          timestamp: timestampIso,
          details: {
            sendgrid_event: eventName,
            campaign_id: campaignId,
            draft_id: draftId,
          },
        });
      }

      // Suppress immediately on unsubscribe / spam report.
      if (SUPPRESSION_EVENTS.has(eventName)) {
        await hubspot.updateContact(email, {
          unsubscribed: 'true',
          hs_email_optout: 'true',
        });
        complianceRows.push({
          tenantId,
          direction: 'unsubscribe_propagated',
          contactsSynced: 0,
          eventsProcessed: 1,
          errors: [],
        });
      }
    } catch (err) {
      hubspotErrors.push(`${eventName} ${email}: ${errMsg(err)}`);
    }
  }

  // One row per draft, summing this batch's contributions.
  const metricsRows: MetricRow[] = [...metricsByDraft.entries()].map(
    ([draftId, m]) => ({
      tenantId,
      draftId,
      window: '1h',
      impressions: m.impressions,
      clicks: m.clicks,
      engagement: m.engagement,
      attributedLeads: 0,
    }),
  );

  // Single short transaction for all DB writes (HTTP already done above).
  if (metricsRows.length || complianceRows.length || hubspotErrors.length) {
    await withTenantDb(db, tenantId, async (tx) => {
      if (metricsRows.length) {
        // Idempotent-additive: a second webhook delivery for the same draft in
        // the same window adds to the existing counts instead of crashing on
        // the unique index.
        await tx
          .insert(contentMetrics)
          .values(metricsRows)
          .onConflictDoUpdate({
            target: [contentMetrics.tenantId, contentMetrics.draftId, contentMetrics.window],
            set: {
              impressions: sql`${contentMetrics.impressions} + excluded.impressions`,
              clicks: sql`${contentMetrics.clicks} + excluded.clicks`,
              engagement: sql`${contentMetrics.engagement} + excluded.engagement`,
              fetchedAt: sql`now()`,
            },
          });
      }
      if (complianceRows.length) await tx.insert(syncLog).values(complianceRows);
      if (hubspotErrors.length) {
        // Make HubSpot failures visible instead of silently logging to console.
        await tx.insert(syncLog).values({
          tenantId,
          direction: 'sendgrid_webhook_error',
          contactsSynced: 0,
          eventsProcessed: hubspotErrors.length,
          errors: hubspotErrors,
        });
      }
    });
  }

  return {
    eventsProcessed,
    metricsWritten: metricsRows.length,
    complianceWritten: complianceRows.length,
  };
}

// ──────────────────────────────────────────────────────────────────
// Production wiring — resolve adapters from tenant_secrets
// ──────────────────────────────────────────────────────────────────

export async function resolveMailSyncDeps(
  env: MailSyncEnv,
  tenantId: string,
): Promise<MailSyncDeps> {
  const db = makeDb(env.DATABASE_URL);
  const [hubspotToken, sendgridToken] = await Promise.all([
    loadPlatformToken(db, tenantId, 'hubspot', env.SECRETS_KEY),
    loadPlatformToken(db, tenantId, 'sendgrid', env.SECRETS_KEY),
  ]);
  if (!hubspotToken) throw new Error(`no hubspot secret for tenant ${tenantId}`);
  if (!sendgridToken) throw new Error(`no sendgrid secret for tenant ${tenantId}`);

  const hubspot = new HubSpotAdapter({
    accessToken: hubspotToken,
    extra: { eventTemplateId: env.HUBSPOT_EVENT_TEMPLATE_ID },
  });
  const sendgrid = new SendGridAdapter({ accessToken: sendgridToken });
  // Timeline events deferred to V2 (see MailSyncDeps.timelineEnabled): the
  // private-app token can sync contacts + propagate suppression, but HubSpot
  // does not allow it to create custom timeline events.
  return { db, hubspot, sendgrid, timelineEnabled: false };
}

// ──────────────────────────────────────────────────────────────────
// SendGrid Event Webhook signature verification (ECDSA P-256 / SHA-256)
// ──────────────────────────────────────────────────────────────────

export const SENDGRID_SIGNATURE_HEADER =
  'x-twilio-email-event-webhook-signature';
export const SENDGRID_TIMESTAMP_HEADER =
  'x-twilio-email-event-webhook-timestamp';

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function trimLeadingZeros(b: Uint8Array): Uint8Array {
  let i = 0;
  while (i < b.length - 1 && b[i] === 0x00) i++;
  return b.slice(i);
}

// SendGrid sends a DER-encoded ECDSA signature; Web Crypto expects the raw
// IEEE-P1363 (r||s) form. Convert SEQUENCE{ INTEGER r, INTEGER s } -> 64 bytes.
function derToP1363(der: Uint8Array): Uint8Array {
  let offset = 2;
  if (der[1] & 0x80) offset = 2 + (der[1] & 0x7f); // long-form length
  if (der[offset] !== 0x02) throw new Error('invalid DER: expected INTEGER r');
  const rLen = der[offset + 1];
  const r = trimLeadingZeros(der.slice(offset + 2, offset + 2 + rLen));
  offset = offset + 2 + rLen;
  if (der[offset] !== 0x02) throw new Error('invalid DER: expected INTEGER s');
  const sLen = der[offset + 1];
  const s = trimLeadingZeros(der.slice(offset + 2, offset + 2 + sLen));
  if (r.length > 32 || s.length > 32) throw new Error('invalid DER: oversized');
  const out = new Uint8Array(64);
  out.set(r, 32 - r.length);
  out.set(s, 64 - s.length);
  return out;
}

export async function verifySendGridSignature(
  publicKeyB64: string,
  payload: string,
  signatureB64: string,
  timestamp: string,
): Promise<boolean> {
  if (!publicKeyB64 || !signatureB64 || !timestamp) return false;
  try {
    const key = await crypto.subtle.importKey(
      'spki',
      b64ToBytes(publicKeyB64),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    const signature = derToP1363(b64ToBytes(signatureB64));
    const signed = new TextEncoder().encode(timestamp + payload);
    return await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      signature,
      signed,
    );
  } catch {
    return false;
  }
}
