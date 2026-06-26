// JWT auth gate for every protected /api route.
//
// Mounted in src/index.ts as `app.use('/api/*', authMiddleware)` AFTER the CORS
// middleware (so OPTIONS preflight + CORS headers are handled first) and BEFORE
// `app.route('/api', api)` (Hono runs matched handlers in registration order).
//
// Responsibilities:
//   1. Let public paths through untouched (login + GSC OAuth callbacks, the
//      unauthenticated asset proxy, the SendGrid webhook).
//   2. Require a valid `Authorization: Bearer <hailmery-jwt>` on everything else.
//   3. Enforce tenant ownership: if the request carries an X-Tenant-ID header, it
//      must be one the verified token is allowed to access (→ 403 otherwise).
//      This is the isolation upgrade — the tenant id in the header is no longer
//      trusted blindly; it must belong to the caller.

import { createMiddleware } from 'hono/factory';
import { verifyJwt, type HailmeryTokenPayload } from '../lib/auth.js';

// Paths that bypass JWT auth. Each entry matches exact OR as a prefix.
const PUBLIC_PATHS = [
  // Google login (issues the hailmery JWT) — the popup can't carry a bearer token.
  '/api/auth/login/google/start',
  '/api/auth/login/google/callback',
  // GSC connect OAuth. NOTE: /api/auth/google/start is intentionally NOT public —
  // the dashboard fetches it via XHR with the Bearer token so the server can
  // verify the caller owns the ?tenant= before connecting. Only the callback is
  // public (Google redirects the browser here; it's verified via signed state).
  '/api/auth/google/callback',
  // Public asset proxy: streamed into <img src> / Buffer posts, which CANNOT send
  // an Authorization header. Keys are unguessable + tenant-namespaced and the
  // bytes are non-sensitive marketing imagery (see GET /api/assets/:key).
  '/api/assets/',
  // SendGrid Event Webhook — outside /api so this never matches under an
  // `/api/*` mount, but listed for safety if the mount scope ever widens. It has
  // its own ECDSA signature verification.
  '/webhooks/',
];

function isPublicPath(path: string): boolean {
  return PUBLIC_PATHS.some((p) => path === p || path.startsWith(p));
}

declare module 'hono' {
  interface ContextVariableMap {
    user: HailmeryTokenPayload;
  }
}

export const authMiddleware = createMiddleware(async (c, next) => {
  // Preflight never carries credentials; CORS handles it before us, but guard
  // anyway so an OPTIONS can never 401 if middleware order ever changes.
  if (c.req.method === 'OPTIONS') return next();

  if (isPublicPath(c.req.path)) {
    return next();
  }

  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized', code: 'missing_token' }, 401);
  }

  const token = authHeader.slice(7);
  const jwtSecret = (c.env as Record<string, string>).JWT_SECRET;
  if (!jwtSecret) {
    console.error('[auth] JWT_SECRET not configured');
    return c.json({ error: 'Server configuration error', code: 'server_misconfigured' }, 500);
  }

  let payload: HailmeryTokenPayload;
  try {
    payload = await verifyJwt(token, jwtSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Token verification failed';
    return c.json({ error: 'Unauthorized', code: 'invalid_token', detail: message }, 401);
  }
  c.set('user', payload);

  // Tenant ownership: every tenant-scoped route reads X-Tenant-ID (via tenantOf).
  // Reject a header for a tenant this token doesn't own BEFORE the route runs, so
  // a valid token for tenant A can never read tenant B's data by swapping the
  // header. Routes without the header (e.g. /api/tenants) handle scoping
  // themselves. A malformed (non-owned) value also fails closed here.
  const tenantHeader = c.req.header('X-Tenant-ID');
  if (tenantHeader && !payload.allowedTenants.includes(tenantHeader)) {
    return c.json(
      {
        error: `Access denied: your account cannot access tenant ${tenantHeader}`,
        code: 'forbidden',
      },
      403,
    );
  }

  await next();
});
