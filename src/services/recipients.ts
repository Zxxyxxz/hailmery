// Email recipient-list resolution.
//
// An email draft stores WHERE its recipients come from (payload.list_source) but
// not WHO they are — resolving that into concrete addresses is a send-time
// concern that needs the tenant's HubSpot / SendGrid credential (a DB read), so
// it cannot live inside the credential-pure SendGrid adapter. This module is the
// single place that turns a draft payload into a recipient array, shared by:
//   - the publish workflow (publishDraft injects the result into payload.to_list)
//   - GET /api/drafts/:id/preview (count only — never sends)
//
// Resolution order: an explicit to_list wins (test sends / pre-resolved
// audiences), else list_source selects HubSpot (system of record) or SendGrid.
// Everything is hard-capped at RECIPIENT_SAFETY_CAP so a send can never exceed
// it without an explicit higher `limit` from the caller.

import type { NeonDatabase } from 'drizzle-orm/neon-serverless';
import { loadPlatformToken } from '../lib/tenant.js';
import { getAllContacts, type ResolvedContact } from '../adapters/hubspot.js';
import { getAllSendGridContacts } from '../adapters/sendgrid.js';
import { isValidEmail } from '../adapters/index.js';

type Db = NeonDatabase<Record<string, unknown>>;

export type ListSource = 'hubspot_all' | 'sendgrid_all';

// Safety gate: never send to more than this many contacts without an explicit
// higher limit. The resolvers stop paginating once they hit it.
export const RECIPIENT_SAFETY_CAP = 500;

export interface ResolvedRecipients {
  recipients: ResolvedContact[];
  source: 'explicit' | ListSource;
  /** True when more contacts existed than the cap allowed (list truncated). */
  capped: boolean;
}

/**
 * Thrown when a recipient list can't be produced (no source configured, the
 * platform isn't connected, or it has no usable contacts). `code` lets callers
 * branch; the message is operator-facing and safe to surface in the UI.
 */
export class RecipientResolutionError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'no_list_source'
      | 'hubspot_not_connected'
      | 'sendgrid_not_connected'
      | 'no_valid_contacts',
  ) {
    super(message);
    this.name = 'RecipientResolutionError';
  }
}

function normalizeExplicit(
  list: Array<string | { email?: string; name?: string; firstName?: string; lastName?: string }>,
): ResolvedContact[] {
  const out: ResolvedContact[] = [];
  const seen = new Set<string>();
  for (const entry of list) {
    const raw = typeof entry === 'string' ? entry : entry?.email;
    const email = raw?.trim().toLowerCase();
    if (!email || !isValidEmail(email) || seen.has(email)) continue;
    seen.add(email);
    if (typeof entry === 'string') {
      out.push({ email });
    } else {
      out.push({ email, firstName: entry.firstName, lastName: entry.lastName });
    }
  }
  return out;
}

/**
 * Resolve an email draft's payload into a concrete recipient list. Throws a
 * RecipientResolutionError when no usable list can be produced — callers map
 * that to a clear failed_reason (publish) or a listError field (preview).
 */
export async function resolveEmailRecipients(opts: {
  db: Db;
  tenantId: string;
  secretsKey: string;
  payload: Record<string, unknown>;
  /** Override the safety cap (defaults to RECIPIENT_SAFETY_CAP). */
  limit?: number;
}): Promise<ResolvedRecipients> {
  const { db, tenantId, secretsKey, payload } = opts;
  const cap = opts.limit ?? RECIPIENT_SAFETY_CAP;

  // 1. Explicit list wins — test sends / pre-resolved audiences.
  const explicit = payload.to_list;
  if (Array.isArray(explicit) && explicit.length > 0) {
    const recipients = normalizeExplicit(explicit);
    if (recipients.length === 0) {
      throw new RecipientResolutionError(
        'The provided recipient list contained no valid email addresses.',
        'no_valid_contacts',
      );
    }
    return capResult(recipients, 'explicit', cap);
  }

  const listSource = payload.list_source as string | undefined;

  if (listSource === 'hubspot_all') {
    const token = await loadPlatformToken(db, tenantId, 'hubspot', secretsKey);
    if (!token) {
      throw new RecipientResolutionError(
        'HubSpot not connected — connect HubSpot in Settings to send emails to your contacts.',
        'hubspot_not_connected',
      );
    }
    const { contacts, truncated } = await getAllContacts(token, { limit: cap });
    if (contacts.length === 0) {
      throw new RecipientResolutionError(
        'No valid contacts found in HubSpot. Add contacts in HubSpot first.',
        'no_valid_contacts',
      );
    }
    return { recipients: contacts, source: 'hubspot_all', capped: truncated };
  }

  if (listSource === 'sendgrid_all') {
    const token = await loadPlatformToken(db, tenantId, 'sendgrid', secretsKey);
    if (!token) {
      throw new RecipientResolutionError(
        'SendGrid not connected — connect SendGrid in Settings to send emails to your contacts.',
        'sendgrid_not_connected',
      );
    }
    const { contacts, truncated } = await getAllSendGridContacts(token, { limit: cap });
    if (contacts.length === 0) {
      throw new RecipientResolutionError(
        'No valid contacts found in SendGrid. Add contacts in SendGrid first.',
        'no_valid_contacts',
      );
    }
    return { recipients: contacts, source: 'sendgrid_all', capped: truncated };
  }

  throw new RecipientResolutionError(
    'No recipient list configured for this email draft. Re-generate the email after connecting HubSpot or SendGrid.',
    'no_list_source',
  );
}

// Cap an explicit list. `capped` uses strict `>` (a list of exactly `cap` is not
// truncated — nothing is sliced off). The adapter-backed paths above instead
// pass through the resolvers' truthful `truncated` flag.
function capResult(
  recipients: ResolvedContact[],
  source: ResolvedRecipients['source'],
  cap: number,
): ResolvedRecipients {
  const capped = recipients.length > cap;
  return { recipients: recipients.slice(0, cap), source, capped };
}
