# CLAUDE.md — hailmery engineering guide

> Fast-ramp doc for any Claude Code session. Read this first. It is the **as-built**
> architecture + conventions + traps. For the exhaustive session-by-session handoff see
> `CURRENT_SITUATION.md`; for line-level subsystem detail see `Reports/`. Last refreshed
> **2026-06-30**, git HEAD `17d62fd` (session 15).

## What hailmery is

A **multi-tenant AI marketing command center** — the replacement for APIRE's old Wix "Kleo"
agent (whose failure mode was hallucinating product/feature names). It ingests a brand's documents
into a **RAG corpus**, **generates** RAG-grounded blog/social/email/image content with Claude,
**gates** every draft through a 5-validator brand guardian, runs a **human-approval queue**,
**publishes** through Buffer / Wix Blog / SendGrid on cron, **measures** engagement, and **learns**
(promotes top performers to "golden example" RAG chunks; weekly Sonnet recommendations + web-search
intelligence briefs). Product spine: **Ingest → Connect → Read → Plan → Execute → Learn.**

Two live tenants: **APIRE** (`apire.io`, EU AI-API-security) `6daebc34-7fd0-4542-8527-cfcd125a5f72`
and **OSM** (`ofsecman.io`). Destination: content-side closing loop for **LeadOrch** (`leadorch.io`).

## Current state (2026-06-30)

- **Live in prod.** Worker API `https://hailmery-api.bezekyigit0.workers.dev`; dashboard
  `https://hailmery-dashboard.pages.dev` (intended custom domain `marketing.leadorch.io`).
- V0 (content quality) + V1 (publishing) + ~7 sessions of V1.5/early-V2 (multi-guardian,
  recommendations, Google OAuth + GSC, connect wizard, email recipient resolution, Buffer history
  import) are **done**. Session 14 shipped **JWT auth** (this is now LIVE — the old docs' "there is
  no authentication" warning is obsolete). Session 15 shipped the **/blog management page**.
- **Two things still dominate risk:**
  1. **RLS is only enforced if prod `DATABASE_URL` uses the `hailmery_app` (NOBYPASSRLS) role.**
     Neon's default `neondb_owner` is BYPASSRLS → RLS silently does nothing. **Therefore every
     `marketing.*` query must keep its explicit `tenant_id` predicate** even inside `withTenantDb`.
     The prod role is unconfirmed — treat RLS as a backstop, not the primary isolation.
  2. Real per-platform **OAuth token refresh is a stub** (`checkTokenHealth.refreshToken()` returns
     false) — only hard expiry fails a draft; GSC is refreshed externally before each query.

## Repo layout

```
src/                       Cloudflare Worker (Hono API + cron + Workflows) — deployed via `wrangler deploy`
  index.ts                 entry: Hono app, CORS+auth on /api/*, mounts API, cron scheduled(), re-exports Workflows
  routes/api.ts            the 40-route JSON API (mounted at /api)   ← the big file
  routes/settings.ts       /settings/brand-voice HTML form (NO auth — outside /api)
  middleware/auth.ts       JWT gate: PUBLIC_PATHS bypass, Bearer verify, X-Tenant-ID ∈ allowedTenants → 403
  db/                      schema.ts (Drizzle, marketing.* schema) · client.ts (makeDb) · rls.sql · migrate.ts · seed.ts
  lib/                     tenant.ts (withTenantDb) · credentials.ts · secrets.ts (AES) · auth.ts (JWT) · google-oauth.ts · ai.ts (MODELS) · storage.ts · tokens.ts
  workflows/               generation.ts (GenerationWorkflow) · publish.ts (PublishWorkflow) · types.ts
  generation/              context.ts (RAG) · blog.ts · social.ts · email.ts · image.ts
  agents/guardians/        index.ts (runAllGuardians) + 5 validators · agents/guardian.ts (legacy brandGuardian)
  jobs/                    scheduler.ts (cron entries) · metrics.ts · recommendations.ts · intelligence.ts · import-buffer.ts
  adapters/                index.ts (ADAPTER_MAP) · buffer · wix-blog · gsc · sendgrid · hubspot · umami
  corpus/                  extract.ts · chunker.ts · embedder.ts · ingest.ts · sync.ts
  services/                recipients.ts (email resolution) · mailsync.ts
  cli/                     ingest.ts · gen.ts
dashboard/                 React 19 + Vite 8 + Tailwind v4 SPA — deployed to Cloudflare Pages
  src/pages/               Queue · CalendarPage · Campaigns · Analytics · BlogManagement · SettingsPage · LoginPage
  src/lib/                 api.ts (axios) · queries.ts (TanStack) · auth-context · tenant-context · types.ts · format.ts · channels.ts
scripts/                   *.mjs ops/diagnostic scripts (seed-users, seed-tenant-secrets, probe-*, etc.) — many untracked by design
Reports/                   dated deep-dive analyses & state snapshots
```

## Commands (pnpm — NOT npm)

| Task | Command | Where |
|---|---|---|
| Worker dev (:8787) | `pnpm dev` (`wrangler dev`) | root |
| **Worker typecheck** | `pnpm typecheck` (`tsc --noEmit`) | root |
| Worker deploy | `pnpm run deploy` (`wrangler deploy`) — NB `pnpm deploy` is a pnpm builtin, use `run` | root |
| **Dashboard typecheck** | `pnpm typecheck` (`tsc -b`) | `dashboard/` |
| Dashboard build | `pnpm build` (`tsc -b && vite build`) | `dashboard/` |
| Dashboard deploy | `wrangler pages deploy dist --project-name=hailmery-dashboard` | `dashboard/` |
| DB migrate (RLS + role) | `pnpm db:migrate` (`tsx src/db/migrate.ts`) | root |
| DB seed tenants | `pnpm db:seed` | root |
| DB push (⚠ destructive) | `pnpm db:push` — **drops all RLS policies**, see Gotchas | root |
| RLS test | `pnpm test:rls` · unit `pnpm test` | root |
| Corpus ingest CLI | `pnpm ingest --tenant <slug>` | root |
| Generate CLI | `pnpm gen <blog\|social\|email\|image> --tenant <slug> "<topic>"` | root |
| Seed login users | `node scripts/seed-users.mjs` | root |
| Seed per-tenant creds | `npx tsx --env-file=.env scripts/seed-tenant-secrets.mjs <apire\|osm>` | root |

Both typechecks must be **zero errors before any deploy**. There are two distinct invocations:
Worker = `tsc --noEmit`; dashboard = `tsc -b` (composite project refs).

## Runtime & routing

`src/index.ts` builds one Hono app. Middleware order is load-bearing: **CORS → `authMiddleware` →
`app.route('/api', api)`**. CORS origin allow-list = `localhost:<port>` + `*.pages.dev` only.
`api.use('*')` copies `c.env` secrets into `process.env` so the Node-style getters in `lib/ai.ts`
work under workerd.

**Cron `scheduled()`** routes by exact `event.cron` string (must stay byte-identical to `wrangler.toml`):

| Cron | Handler (`src/jobs/`) | Does |
|---|---|---|
| `*/15 * * * *` | `runPublishTick` | One fleet-wide `PublishWorkflow`; drains ≤50 due drafts across all tenants |
| `0 */6 * * *` | `runGenerationTick` | Per active campaign, fire `GenerationWorkflow` when a channel queue < target (5) |
| `0 3 * * *` | `runNightlyTick` | **Sequential**: mailsync → metrics → recommendations (order matters — recs read fresh metrics) |
| `0 8 * * 1` | `runIntelligenceTick` | Weekly intelligence brief (Sonnet + web_search), Mon 08:00 UTC |

Two **Cloudflare Workflows** (`GenerationWorkflow`, `PublishWorkflow`) are named exports of `index.ts`,
bound in `wrangler.toml`. Both have an inline fallback (`runGenerationPipeline` / `runPublishPipeline`)
when the binding is absent (local dev). Workflow steps pass plain JSON and rebuild db/adapters from
env each step (AsyncLocalStorage does not cross a `step.do()` boundary).

### /api route inventory (40 routes, all JWT-gated unless noted; tenant-scoped routes need `X-Tenant-ID`)

- **Drafts/queue**: `GET /api/drafts` · `PATCH /api/drafts/:id` (edit/approve/dismiss) ·
  `POST /api/drafts/:id/recheck` (re-run 5 guardians) · `GET /api/drafts/:id/preview` (email, never sends) ·
  `GET /api/queue-status`
- **Campaigns**: `GET/POST /api/campaigns` · `PATCH /api/campaigns/:id`
- **Generation**: `POST /api/generate` (campaign) · `POST /api/generate-now` (one-shot topic) ·
  `POST /api/publish/:draftId` (immediate, bypasses cron)
- **Connections**: `GET /api/connections` · `POST /api/connections/:platform/connect|disconnect` ·
  `GET /api/connections/sendgrid/domain-auth` · `POST .../verify-domain`
- **Auth**: `GET /api/auth/login/google/start|callback` (public) · `GET /api/auth/google/callback` (public, GSC) ·
  `GET /api/auth/google/start` (**JWT-gated**, GSC connect — re-checks tenant ownership)
- **Analytics**: `GET /api/analytics/summary|top-content|keywords`
- **Intelligence/recs**: `GET /api/intelligence` · `POST /api/intelligence/refresh` ·
  `GET /api/recommendations` · `POST /api/recommendations/refresh` · `PATCH /api/recommendations/:id`
- **Documents**: `GET /api/documents` · `GET /api/documents/:id` · `POST /api/documents/upload` ·
  `POST /api/documents/:id/reingest` · `DELETE /api/documents/:id`
- **Blog / import / misc**: `GET /api/blog/posts` (session 15) · `POST /api/import/buffer-history` ·
  `GET /api/tenants` (RLS-bypassed, filtered by `allowedTenants`) · `GET /api/assets/:key{.+}` (**public** R2 proxy) ·
  `GET/PATCH /api/sites/:id/config` · `POST /api/debug/sync-gsc`
- **Public, outside `/api`**: `GET /` (health HTML) · `GET/POST /settings/brand-voice` (**no auth**) ·
  `POST /webhooks/sendgrid` (own ECDSA verify)

## Data model (Postgres `marketing` schema, Drizzle + Neon + pgvector)

19 tables (18 tenant-scoped + cross-tenant `users`), 12 enums. Source of truth `src/db/schema.ts`;
RLS/extensions/add-on tables in `src/db/rls.sql`.

Core tables: **`content_drafts`** (the content unit — `payload jsonb`, `status`, `channel`,
`guardian_breakdown jsonb` *(nullable → fall back to `payload.guardianScore`)*, `published_ref`,
`performance_score`, `is_golden_example`) · **`campaigns`** · **`publish_log`** (append-only) ·
**`content_metrics`** (unique `(tenant,draft,window)`, idempotent upsert) · **`metrics_queue`** ·
**`documents`** + **`document_chunks`** (`embedding vector(1536)`, HNSW cosine) · **`gsc_keywords`** ·
**`recommendations`** · **`intelligence_briefs`** · **`tenant_secrets`** (AES-encrypted creds) ·
**`users`** (login allow-list, `allowed_tenant_ids uuid[]`, NO tenant_id) · `tenants` · `sites` ·
`site_config` (`brand_voice`) · `pillars` · `assets` · `tenant_usage` · `sync_log`.

`draft_status` enum: `generating · pending_review · approved · scheduled · published · measured ·
dismissed · failed`.

**RLS**: every `marketing.*` table is `ENABLE` + `FORCE` with a uniform `tenant_isolation` policy
keyed on the `app.tenant_id` session GUC. `withTenantDb(db, tid, fn)` (`lib/tenant.ts`) opens a tx,
`SELECT set_config('app.tenant_id', tid, true)`, runs `fn`. Escape hatch: `app.rls_bypass='true'`
(used by `getAllActiveTenants`, `/api/tenants`, seed). Fail-closed: unset → zero rows. `users` is
excluded (no tenant_id; permissive policy; authz at app layer).

## The value loop

**Generation** (`workflows/generation.ts` → `generation/*`): trigger (`cron` tops up to 5/channel;
`manual`/`campaign_created` force batch of 2) → `loadGenContext` pulls RAG **top-8 corpus chunks +
top-3 golden examples** → per-channel generate with **Claude Sonnet 4.6** (prompt-cached) → guardian
check → `insertDraft` (`pending_review`). Channels: blog→`generateBlog`, email→`generateEmail`
(lead_gen→5-email drip, else newsletter), social→`generateSocial` (linkedin/x/instagram/tiktok/gbp).
Generation **never refuses** — guardian results are stored, gating happens at publish.

**Guardians** (`agents/guardians/index.ts` `runAllGuardians`): `platform_rules` (deterministic, the
**only blocker** — LinkedIn>3000, X>280, email no subject/unsubscribe) + 4 advisory Haiku validators
(`factual`, `brand_voice`, `audience_fit`, `performance_prediction`) under `Promise.allSettled`
(a failure degrades to `skipped`, never blocks). `guardian_breakdown.overall` = mean of non-skipped
`factual+brandVoice+audienceFit` (excludes performance_prediction & platform_rules; all-skipped → 1.0).
**Blog uses only the legacy single `brandGuardian`** → blog drafts have **null `guardian_breakdown`**.

**Publish** (`workflows/publish.ts`): load due (`approved` + `publish_at <= now`, ≤50) → token health
(refresh is a stub) → cadence (over-limit slides `publish_at`, keeps `approved`) → `publishDraft`
(`resolveAdapter` → email recipient resolution → `adapter.publish`) → enqueue 1h+24h metrics.
**`published_ref` = `result.url || result.externalId || ''`** (usually the permalink **URL**, not an id).
Double-publish guard lives **only in the route** `POST /api/publish/:draftId`.

**Learn** (`jobs/metrics.ts` nightly): drain metrics_queue → GSC sync (refresh token first) → Umami →
`scorePerformance` (`performance_score` = weighted engagement ÷ channel median) → `tagGoldenExamples`
(top decile, score>1 → promote to a `golden_example` document_chunk). Then `jobs/recommendations.ts`
(Sonnet, internal data only, 5 ranked recs) and weekly `jobs/intelligence.ts` (Sonnet + `web_search`
tool → 5-7 topics).

**Models** (`lib/ai.ts`): `SONNET = claude-sonnet-4-6` (generation, recs, intelligence, image prompts);
`HAIKU = claude-haiku-4-5-20251001` (guardians); `EMBED = text-embedding-3-small` (1536-dim);
images via Gemini 3 Pro Image (default) / Ideogram.

**Corpus/RAG**: upload (`POST /api/documents/upload`) → R2 → extract (`md/txt/docx` in-worker, **PDF
Node-only**) → chunk **512-token/64-overlap** (`cl100k_base`) → embed → `document_chunks`. Two
distinct "golden" sources: generation RAG reads `document_chunks WHERE document_type='golden_example'`;
the performance guardian reads `content_drafts WHERE is_golden_example=true`.

## Adapters (`src/adapters/`, credential-pure — DB reads happen in `lib/credentials.ts` first)

| Adapter | Platform / channels | Auth | Notes |
|---|---|---|---|
| **Buffer** | `buffer`; social | Bearer → GraphQL | `profileIds` (channel→id) from encrypted profile_map; `fetchMetrics` skips URL-shaped refs (so social metrics often EMPTY) |
| **Wix Blog** | `wix-blog`; `blog` | **RAW key in `Authorization`** + `wix-site-id` header | create+publish Draft Post; `wixMemberId` mandatory; markdown→**Ricos** (`rel:noreferrer` only); cover image imported to Media Manager |
| **GSC** | `gsc` | OAuth Bearer | **read-only** (publish throws); refreshed externally by `refreshGoogleAccessToken` (cron token always stale) |
| **SendGrid** | `sendgrid`; email | Bearer | needs `html_body` + resolved `to_list`; `apire.io` sender NOT verified → use `marketing@leadorch.io`; webhook needs the 124-char signing key |
| **HubSpot** | `hubspot` | Bearer | contacts/timeline only (publish throws); drops `hs_email_optout` |
| **Umami** | `umami` | user/pass→token | analytics only |

`channelToSecretPlatform`: social→`buffer`, `blog`/`wix-blog`→`wix-blog`, email→`sendgrid`.
`normalizeChannel` maps `x`→`twitter` (Buffer profile key & adapter channel; but `publish_log` keeps
the original `x`).

## Auth, secrets, tenancy

JWT login: Google OAuth → verify `email_verified` → match `marketing.users` allow-list → `signJwt`
(**HS256, `JWT_SECRET`, 7d**, claims `{userId,email,name,allowedTenants}`). Every `/api/*` request:
`authMiddleware` verifies Bearer + enforces `X-Tenant-ID ∈ allowedTenants` (403 else). Routes read
the tenant via `tenantOf(c)` (parses/validates UUID only — **ownership is the middleware's job**).
`assertTenantAccess` exists but is **dead code**; the one query-param-tenant route (`/api/auth/google/start`)
uses `canAccessTenant` inline.

**Three crypto uses, two env secrets**: `JWT_SECRET` (HS256 session) · `SECRETS_KEY` (AES-256-GCM for
`tenant_secrets`, base64→32 bytes) — whose raw bytes are **also** re-imported as the HMAC key for OAuth
CSRF state. Never conflate them. `loadSecret` decrypts creds; `loadProfileMap` reads only the
profile_map (survives disconnect). Storage: `lib/storage.ts` R2 with `out/uploads/` local fallback.

## Dashboard

React 19 SPA. Provider stack: `QueryClient` → `BrowserRouter` → `AuthProvider` → `App`. `App.tsx` is
the login gate — `TenantProvider` (which calls `/api/tenants`) mounts only when authenticated.
**axios** (`lib/api.ts`) auto-injects `X-Tenant-ID` (localStorage `hm_tenant_id`) + `Authorization`
(sessionStorage `hm_auth_token`); 401 clears + reloads. **TanStack Query** hooks (`lib/queries.ts`):
`useQuery({ queryKey: ['<resource>', currentId, filters?], enabled: !!currentId })`; `useTenant()`
returns `{ tenants, current, currentId, setCurrent }` (id field is **`currentId`**, not `tenantId`).
Tailwind v4, dark violet theme (`#7c3aed`/`#000`/`#06b6d4`), `Card`=`div.glass`, CVA `Badge`/`Button`,
lucide icons. **No date-fns** — use `lib/format.ts` (`formatTimeAgo`, `formatPublishAt`, `guardianTier`).
`VITE_API_URL` is baked at build time (`dashboard/.env.production`).

## Env / Worker secrets

Required: `DATABASE_URL` (prod = **`hailmery_app`** role; local `.env` = `neondb_owner` for migrate/seed) ·
`OPENAI_API_KEY` · `ANTHROPIC_API_KEY` · `SECRETS_KEY` (base64) · `JWT_SECRET`.
Optional: `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` (login + GSC) · `GOOGLE_API_KEY` (Gemini) ·
`IDEOGRAM_API_KEY` · `SENDGRID_API_KEY` · `SENDGRID_WEBHOOK_SECRET` (124-char) · `HUBSPOT_API_KEY` ·
`BUFFER_ACCESS_TOKEN` · `R2_PUBLIC_BASE_URL`. Vars (`wrangler.toml`): `ENVIRONMENT`, `IMAGE_PROVIDER=gemini`.
`scripts/set-production-secrets.sh` sets 11 but **omits `JWT_SECRET`, `GOOGLE_CLIENT_ID/SECRET`** — set
those manually. Per-tenant platform creds are AES-encrypted in DB (`seed-tenant-secrets.mjs`), not Worker secrets.

## ⚠ Gotchas (the expensive ones)

1. **`pnpm db:push` drops every RLS policy** (destructive + interactive). Add-on tables/columns,
   RLS, the `hailmery_app` role, extensions, and the HNSW index live in `rls.sql` → apply with
   `pnpm db:migrate`, never rely on `db:push`.
2. **RLS is inert unless prod connects as `hailmery_app`** (NOBYPASSRLS). Keep an explicit
   `tenant_id` predicate on every `marketing.*` query regardless — RLS is a backstop.
3. **`published_ref` holds the post URL, not the post id.** Matching drafts to live posts (e.g. the
   blog page) must be fuzzy (id/url/slug/title). Buffer `fetchMetrics` skips URL refs → social metrics often EMPTY.
4. **Blog drafts have null `guardian_breakdown`** (legacy single guardian) → read `payload.guardianScore`
   as fallback. Many older drafts also predate the breakdown.
5. **Approving a draft must send `publishAt`** or the cron's `loadDueForPublish` (requires
   `publish_at NOT NULL`) strands it forever.
6. **Token refresh is a stub** — only hard expiry fails a draft; GSC refreshes externally before each query.
7. `pnpm deploy` is a pnpm builtin (not the script) — use `pnpm run deploy` / `wrangler deploy` for the Worker.
   The dashboard is a separate **Pages** project.
8. `tsc --noEmit` (Worker) vs `tsc -b` (dashboard) — two different typecheck commands.
9. `assertTenantAccess` is dead code; the real chokepoint is `tenantOf(c)` + the auth middleware.
10. `gbp` channel maps to `buffer` secret but has no `ADAPTER_MAP` entry → fails resolution.
11. `tenant_secrets` AES key must be the **base64** `SECRETS_KEY` matching what seeded the creds, or decryption fails.
12. Webhook `POST /webhooks/sendgrid` and `GET /settings/brand-voice` are **outside `/api` → no auth/CORS**.

## Conventions

- Worker code uses **semicolons**; dashboard code is **no-semicolon** (Prettier). Match the file.
- New `/api` route pattern: `const tenantId = tenantOf(c); if (!tenantId) return err(c,400,'missing_tenant',...)` →
  `const db = makeDb(c.env.DATABASE_URL)` → `withTenantDb(db, tenantId, async (tx) => tx.execute<Row>(sql\`... WHERE tenant_id = ${tenantId}\`))`.
- Errors are `{ error, code }` via the local `err()` helper. `Row = Record<string, any>`.
- Commit only when asked; co-author trailer `Co-Authored-By: Claude ...`. Don't `db:push` alone.

## Where to look / further docs

- `CURRENT_SITUATION.md` — exhaustive session-by-session as-built handoff.
- `Reports/CURRENT-STATE-*.md` — dated state snapshots · `Reports/ARCHITECTURE-ANALYSIS-*.md` — line-level reference.
- `PLAN.md` — product vision / roadmap (H1 demo → H2 standalone → H3 LeadOrch SaaS).
- `DEPLOY.md` — 9-step deploy runbook.
- Auto-memory (`~/.claude/.../memory/MEMORY.md`) — running log of per-session decisions & traps.
