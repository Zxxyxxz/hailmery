// Hailmery session JWTs — issued by the Google login flow (src/routes/api.ts)
// and verified by the auth middleware (src/middleware/auth.ts) on every
// protected /api route.
//
// Signed HS256 with the Worker secret JWT_SECRET (a base64 random string set via
// `wrangler secret put JWT_SECRET`). This is a SEPARATE secret from SECRETS_KEY
// (AES-GCM token encryption) and from the SECRETS_KEY-derived HMAC that signs the
// OAuth CSRF state — none of the three is ever used in place of another.
//
// jose is Workers-compatible (pure WebCrypto, ESM). The same code runs in the
// Node CLI path (Node 22 ships WebCrypto globally).

import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

// The hailmery-specific claims we put in the token. Kept separate from
// JWTPayload because JWTPayload carries an index signature ([k]: unknown), and
// Omit<>-ing the registered claims off a type with an index signature collapses
// the named properties back to `unknown`. signJwt takes the bare claims; the
// verified token is the claims plus the standard registered fields.
export interface HailmeryClaims {
  email: string;
  name: string | null;
  allowedTenants: string[];
  userId: string;
}

export interface HailmeryTokenPayload extends HailmeryClaims, JWTPayload {}

const ALG = 'HS256';
const EXPIRY = '7d';

function secretKey(jwtSecret: string): Uint8Array {
  return new TextEncoder().encode(jwtSecret);
}

export async function signJwt(
  payload: HailmeryClaims,
  jwtSecret: string,
): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: ALG })
    .setSubject(payload.userId)
    .setIssuedAt()
    .setExpirationTime(EXPIRY)
    .setIssuer('hailmery')
    .sign(secretKey(jwtSecret));
}

export async function verifyJwt(
  token: string,
  jwtSecret: string,
): Promise<HailmeryTokenPayload> {
  const { payload } = await jwtVerify<HailmeryTokenPayload>(
    token,
    secretKey(jwtSecret),
    { issuer: 'hailmery', algorithms: [ALG] },
  );
  return payload;
}

// True if a verified token grants access to a specific tenant. Used by the
// tenant-access guard and the auth middleware's header ownership check.
export function canAccessTenant(payload: HailmeryTokenPayload, tenantId: string): boolean {
  return Array.isArray(payload.allowedTenants) && payload.allowedTenants.includes(tenantId);
}
