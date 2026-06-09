// Resolve a tenant's platform credentials into a constructed ChannelAdapter.
//
// tenant_secrets stores an encrypted access token (+ optional refresh token,
// expiry, scopes) per (tenant_id, platform). Adapters need slightly different
// credential shapes (Buffer wants profile IDs, Wix wants a site id), so this
// module is the single place that maps a draft `channel` → secret `platform`,
// loads + decrypts the row, and builds the adapter the publish pipeline calls.

import { sql } from 'drizzle-orm';
import type { NeonDatabase } from 'drizzle-orm/neon-serverless';
import { withTenantDb } from './tenant.js';
import { decryptSecret } from './secrets.js';
import { getAdapter, type ChannelAdapter } from '../adapters/index.js';

type Db = NeonDatabase<Record<string, unknown>>;

export interface LoadedSecret {
  platform: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scopes: string[] | null;
  // Decrypted channel -> profile/channel id map (Buffer). null when unset.
  profileMap: Record<string, string> | null;
}

interface SecretRow extends Record<string, unknown> {
  encrypted_access_token: string | null;
  encrypted_refresh_token: string | null;
  encrypted_profile_map: string | null;
  token_expires_at: string | null;
  scopes: string[] | null;
}

/**
 * The publish channels the UI emits ('linkedin', 'x', 'instagram', 'tiktok',
 * 'gbp', 'blog', 'email', ...) → the tenant_secrets platform that holds the
 * credential. Social channels publish through Buffer; the blog through Wix;
 * email through SendGrid.
 */
export function channelToSecretPlatform(channel: string): string {
  const c = channel.toLowerCase();
  if (['linkedin', 'x', 'twitter', 'instagram', 'tiktok', 'facebook', 'pinterest', 'gbp'].includes(c))
    return 'buffer';
  if (['blog', 'wix-blog'].includes(c)) return 'wix-blog';
  if (['email', 'sendgrid', 'newsletter', 'drip'].includes(c)) return 'sendgrid';
  return c;
}

/**
 * Normalise a draft channel to the key the adapter layer recognises. Buffer's
 * adapter (and ADAPTER_MAP) key X as 'twitter', so 'x' drafts map across.
 */
export function normalizeChannel(channel: string): string {
  const c = channel.toLowerCase();
  if (c === 'x') return 'twitter';
  return c;
}

/** Load + decrypt a tenant's secret for a platform, with expiry/scope metadata. */
export async function loadSecret(
  db: Db,
  tenantId: string,
  platform: string,
  secretsKey: string,
): Promise<LoadedSecret | null> {
  const row = await withTenantDb(db, tenantId, async (tx) => {
    const r = await tx.execute<SecretRow>(sql`
      SELECT encrypted_access_token, encrypted_refresh_token, encrypted_profile_map,
             token_expires_at, scopes
      FROM marketing.tenant_secrets
      WHERE tenant_id = ${tenantId} AND platform = ${platform}
      LIMIT 1
    `);
    return r.rows[0] ?? null;
  });
  if (!row || !row.encrypted_access_token) return null;

  let profileMap: Record<string, string> | null = null;
  if (row.encrypted_profile_map) {
    try {
      profileMap = JSON.parse(await decryptSecret(row.encrypted_profile_map, secretsKey));
    } catch {
      profileMap = null; // malformed/rotated key — treat as no map, publish will error clearly
    }
  }

  return {
    platform,
    accessToken: await decryptSecret(row.encrypted_access_token, secretsKey),
    refreshToken: row.encrypted_refresh_token
      ? await decryptSecret(row.encrypted_refresh_token, secretsKey)
      : null,
    expiresAt: row.token_expires_at ? new Date(row.token_expires_at) : null,
    scopes: row.scopes ?? null,
    profileMap,
  };
}

/**
 * Build the credential object an adapter constructor expects. Buffer profile
 * IDs come from the tenant's encrypted profile map (tenant_secrets); other extra
 * fields (e.g. Wix site id) are passed through via the optional `extra` argument
 * and otherwise left empty. A Buffer publish with no profile id for the channel
 * throws inside the adapter; that surfaces as a per-draft failed_reason.
 */
function buildCredentials(secret: LoadedSecret, extra?: Record<string, unknown>) {
  return {
    accessToken: secret.accessToken,
    refreshToken: secret.refreshToken ?? undefined,
    extra: {
      ...(secret.platform === 'buffer' ? { profileIds: secret.profileMap ?? {} } : {}),
      // Wix blog needs the site id + post-owner member id at publish time; both
      // are stored in the tenant's encrypted profile map (seeded from
      // WIX_SITE_ID / WIX_MEMBER_ID) alongside the API key.
      ...(secret.platform === 'wix-blog'
        ? {
            wixSiteId: secret.profileMap?.wixSiteId,
            wixMemberId: secret.profileMap?.wixMemberId,
          }
        : {}),
      ...(extra ?? {}),
    },
  };
}

export interface ResolvedAdapter {
  adapter: ChannelAdapter;
  platform: string;
  secret: LoadedSecret;
}

/**
 * Resolve the adapter for a channel, loading and decrypting the tenant's
 * credential. Returns null with a `reason` when something is missing so the
 * caller can record a precise failed_reason.
 */
export async function resolveAdapter(opts: {
  db: Db;
  tenantId: string;
  channel: string;
  secretsKey: string;
  extra?: Record<string, unknown>;
}): Promise<{ resolved: ResolvedAdapter } | { reason: string }> {
  const { db, tenantId, channel, secretsKey, extra } = opts;
  const adapterChannel = normalizeChannel(channel);

  const AdapterClass = await getAdapter(adapterChannel);
  if (!AdapterClass) return { reason: `no_adapter_for_channel:${channel}` };

  const platform = channelToSecretPlatform(channel);
  const secret = await loadSecret(db, tenantId, platform, secretsKey);
  if (!secret) return { reason: `no_credentials_for_platform:${platform}` };

  const creds = buildCredentials(secret, extra);
  // Each adapter has its own credential subtype; the union of constructors is
  // not statically callable, so cast at the single construction site.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adapter = new (AdapterClass as any)(creds) as ChannelAdapter;
  return { resolved: { adapter, platform, secret } };
}
