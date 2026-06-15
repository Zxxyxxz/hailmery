// Google OAuth — one consent grant per tenant covering every Google service
// hailmery reads (Search Console today, GA4/Ads later). The grant is stored as a
// single `tenant_secrets` row under platform='google':
//   - encrypted_access_token   — short-lived (~1h) bearer token
//   - encrypted_refresh_token  — long-lived; only returned on first consent
//   - encrypted_profile_map    — JSON { email } for the connected-account label
//   - token_expires_at, scopes — drive proactive refresh + the connections UI
//
// This module is the single place that signs/verifies CSRF state, exchanges the
// auth code, and stores/refreshes the credential — imported by both the OAuth
// routes (src/routes/api.ts) and the nightly GSC sync (src/jobs/metrics.ts) so
// the two paths can never drift.

import { sql } from 'drizzle-orm';
import type { NeonDatabase } from 'drizzle-orm/neon-serverless';
import { withTenantDb } from './tenant.js';
import { encryptSecret } from './secrets.js';
import { loadSecret, type LoadedSecret } from './credentials.js';

type Db = NeonDatabase<Record<string, unknown>>;

// The tenant_secrets.platform key for the Google grant. Kept in one constant so
// the routes, the connections endpoint, and the metrics job all agree (an
// earlier draft split it across 'gsc'/'google' and the status check silently
// never saw the token).
export const GOOGLE_PLATFORM = 'google';

// MUST byte-for-byte match the Authorized redirect URI registered in Google
// Cloud Console (APIs & Services → Credentials → the OAuth Web client). OAuth
// redirect URIs are pre-registered + origin-specific, so this is intentionally a
// fixed production URL, not derived from the incoming request.
export const GOOGLE_REDIRECT_URI =
  'https://hailmery-api.bezekyigit0.workers.dev/api/auth/google/callback';

// One consent flow grants every scope hailmery uses. webmasters.readonly powers
// GSC keyword sync today; analytics.readonly is requested now so GA4 can light
// up later without forcing Baran through consent again. openid+email yield the
// account email for the connected-account label.
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/webmasters.readonly',
  'https://www.googleapis.com/auth/analytics.readonly',
  'openid',
  'email',
];

// Human-readable mapping for the dashboard's "active services" list.
export const GOOGLE_SCOPE_LABELS: Record<string, string> = {
  'https://www.googleapis.com/auth/webmasters.readonly': 'Google Search Console',
  'https://www.googleapis.com/auth/analytics.readonly': 'Google Analytics',
};

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v2/userinfo';

const STATE_TTL_MS = 10 * 60 * 1000; // a signed state token is valid for 10 min
const REFRESH_SKEW_MS = 5 * 60 * 1000; // refresh when <5 min of validity remains

// ── HMAC-signed CSRF state ──────────────────────────────────────────────────
// state = base64(JSON{ ...payload, ts, nonce }) + '.' + hex(HMAC_SHA256). The
// HMAC key is the raw bytes of SECRETS_KEY (base64). This is a SEPARATE use of
// the key from the AES-GCM token encryption (different algorithm + key import),
// so signing capability never implies decryption capability. Never trust an
// unsigned or expired state.

function hmacKeyBytes(secretsKey: string): Uint8Array {
  const bin = atob(secretsKey);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function importHmacKey(secretsKey: string, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    hmacKeyBytes(secretsKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    [usage],
  );
}

export async function generateOAuthState(
  secretsKey: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const body = JSON.stringify({ ...payload, ts: Date.now(), nonce: crypto.randomUUID() });
  const encoded = btoa(body);
  const key = await importHmacKey(secretsKey, 'sign');
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(encoded));
  return `${encoded}.${bytesToHex(new Uint8Array(sig))}`;
}

/** Verify the HMAC + 10-min freshness; returns the decoded payload or null. */
export async function verifyOAuthState(
  secretsKey: string,
  state: string,
): Promise<Record<string, unknown> | null> {
  const dot = state.indexOf('.');
  if (dot <= 0) return null;
  const encoded = state.slice(0, dot);
  const sigHex = state.slice(dot + 1);
  if (!encoded || !sigHex || sigHex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(sigHex)) return null;

  let valid: boolean;
  try {
    const key = await importHmacKey(secretsKey, 'verify');
    // crypto.subtle.verify compares in constant time internally.
    valid = await crypto.subtle.verify('HMAC', key, hexToBytes(sigHex), new TextEncoder().encode(encoded));
  } catch {
    return null;
  }
  if (!valid) return null;

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(atob(encoded)) as Record<string, unknown>;
  } catch {
    return null;
  }
  const ts = typeof payload.ts === 'number' ? payload.ts : 0;
  if (!ts || Date.now() - ts > STATE_TTL_MS) return null;
  return payload;
}

// ── consent URL + token exchange ────────────────────────────────────────────

export function buildGoogleConsentUrl(clientId: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline', // required for a refresh_token
    prompt: 'consent', // force consent so a refresh_token is returned every time
    include_granted_scopes: 'true',
    state,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

export interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  token_type?: string;
  id_token?: string;
}

export async function exchangeCodeForTokens(opts: {
  code: string;
  clientId: string;
  clientSecret: string;
}): Promise<GoogleTokenResponse> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: opts.code,
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      redirect_uri: GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`google token exchange failed: ${res.status} ${body.slice(0, 200)}`);
  }
  return (await res.json()) as GoogleTokenResponse;
}

/** Best-effort account email for the connected-account label (never throws). */
export async function fetchGoogleEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const u = (await res.json()) as { email?: string };
    return typeof u.email === 'string' ? u.email : null;
  } catch {
    return null;
  }
}

// ── credential storage (separate columns — matches loadSecret) ──────────────

export interface GoogleCredential {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scopes: string[];
  email: string | null;
}

/**
 * Upsert the Google grant. The access + refresh tokens are AES-GCM encrypted
 * into their own columns (not one blob) because loadSecret/syncGscKeywords read
 * them separately. `refreshToken`/`email` may be null on a refresh-only update —
 * the COALESCE keeps the previously-stored values (Google omits refresh_token on
 * refresh, and we don't re-fetch the email each hour).
 */
export async function storeGoogleCredential(opts: {
  db: Db;
  tenantId: string;
  secretsKey: string;
  accessToken: string;
  refreshToken: string | null;
  expiresInSec: number;
  email: string | null;
  scopes: string[];
}): Promise<void> {
  const { db, tenantId, secretsKey } = opts;
  const accessCipher = await encryptSecret(opts.accessToken, secretsKey);
  const refreshCipher = opts.refreshToken
    ? await encryptSecret(opts.refreshToken, secretsKey)
    : null;
  // Account email lives in the encrypted profile map (same slot Umami/Wix use for
  // their non-token config) so /api/connections can label the account with no
  // extra API call. null → leave the stored map untouched (refresh path).
  const profileCipher =
    opts.email != null ? await encryptSecret(JSON.stringify({ email: opts.email }), secretsKey) : null;
  const expiresAt = new Date(Date.now() + opts.expiresInSec * 1000).toISOString();
  const scopes = opts.scopes.map((s) => s.trim()).filter(Boolean);
  // Bind the text[] as an explicit ARRAY[...] of scalar params. Interpolating a JS
  // array directly (`${scopes}::text[]`) makes drizzle emit a parenthesized list
  // `($1, $2, …)` — a record — so Postgres rejects the cast with "cannot cast type
  // record to text[]". ARRAY[...] binds each scope on its own as text.
  const scopesSql = sql`ARRAY[${sql.join(
    scopes.map((s) => sql`${s}`),
    sql`, `,
  )}]::text[]`;

  await withTenantDb(db, tenantId, async (tx) => {
    await tx.execute(sql`
      INSERT INTO marketing.tenant_secrets
        (tenant_id, platform, encrypted_access_token, encrypted_refresh_token,
         encrypted_profile_map, token_expires_at, scopes, updated_at)
      VALUES (
        ${tenantId}, ${GOOGLE_PLATFORM}, ${accessCipher}, ${refreshCipher},
        ${profileCipher}, ${expiresAt}::timestamptz, ${scopesSql}, now()
      )
      ON CONFLICT (tenant_id, platform) DO UPDATE SET
        encrypted_access_token = EXCLUDED.encrypted_access_token,
        encrypted_refresh_token = COALESCE(EXCLUDED.encrypted_refresh_token, marketing.tenant_secrets.encrypted_refresh_token),
        encrypted_profile_map = COALESCE(EXCLUDED.encrypted_profile_map, marketing.tenant_secrets.encrypted_profile_map),
        token_expires_at = EXCLUDED.token_expires_at,
        scopes = CASE WHEN cardinality(EXCLUDED.scopes) > 0 THEN EXCLUDED.scopes ELSE marketing.tenant_secrets.scopes END,
        updated_at = now()
    `);
  });
}

/** Load + decrypt the Google grant (email pulled out of the profile map). */
export async function loadGoogleCredential(
  db: Db,
  tenantId: string,
  secretsKey: string,
): Promise<GoogleCredential | null> {
  const secret = await loadSecret(db, tenantId, GOOGLE_PLATFORM, secretsKey);
  if (!secret) return null;
  return googleCredentialFromSecret(secret);
}

function googleCredentialFromSecret(secret: LoadedSecret): GoogleCredential {
  const email = typeof secret.profileMap?.email === 'string' ? secret.profileMap.email : null;
  return {
    accessToken: secret.accessToken,
    refreshToken: secret.refreshToken,
    expiresAt: secret.expiresAt,
    scopes: secret.scopes ?? [],
    email,
  };
}

/**
 * Return a valid access token for the tenant, refreshing + persisting it first
 * when it's expired or within REFRESH_SKEW of expiring. Google access tokens
 * last ~1h, so the once-a-day metrics cron's stored token is ALWAYS stale —
 * without this every GSC call 401s. The refresh response carries no new
 * refresh_token, so storeGoogleCredential's COALESCE preserves the stored one.
 * Pass the already-loaded `secret` to avoid a redundant decrypt.
 */
export async function refreshGoogleAccessToken(opts: {
  db: Db;
  tenantId: string;
  secret: LoadedSecret;
  secretsKey: string;
  clientId: string;
  clientSecret: string;
}): Promise<string> {
  const { db, tenantId, secret, secretsKey, clientId, clientSecret } = opts;
  if (!secret.refreshToken) {
    throw new Error('google credential has no refresh token — reconnect required');
  }
  const stillValid = secret.expiresAt && secret.expiresAt.getTime() > Date.now() + REFRESH_SKEW_MS;
  if (stillValid) return secret.accessToken;

  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: secret.refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    // invalid_grant here means the refresh token was revoked/expired — the user
    // must reconnect; surface it rather than retrying forever.
    throw new Error(`google token refresh failed: ${res.status} ${body.slice(0, 200)}`);
  }
  const tok = (await res.json()) as { access_token: string; expires_in: number; scope?: string };

  await storeGoogleCredential({
    db,
    tenantId,
    secretsKey,
    accessToken: tok.access_token,
    refreshToken: null, // omit → keep the stored refresh token
    expiresInSec: tok.expires_in,
    email: null, // omit → keep the stored account email
    scopes: tok.scope ? tok.scope.split(' ') : (secret.scopes ?? []),
  });
  return tok.access_token;
}
