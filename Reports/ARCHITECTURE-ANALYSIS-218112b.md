# hailmery — Architecture Analysis

**Definitive technical reference**
Repository: `/Users/xxxyxxx/Desktop/hailmery`
Git HEAD at analysis: `218112b`
Synthesis date: 2026-06-23
Basis: deep code-level analyses of all 10 subsystems by specialist agents who read the source in full.

> A note on faithfulness: this report synthesizes the structured subsystem analyses. Where analyses are uncertain or conflict, that is called out explicitly. Specific function, route, table, file, and model names are preserved from the source analyses. Several "open questions" recur across subsystems because they are genuinely unanswerable from code alone — they are consolidated in §9.

---

## 1. Executive Summary

**hailmery** is a multi-tenant **AI marketing command center** built as a digital-marketing internship deliverable, currently operating two real brand tenants: **APIRE** (`apire.io`, an EU AI-API-security / governance proxy) and **OSM** (`ofsecman.io`, an offensive-security / AISecOps CTEM platform). It is a Cloudflare-native system: a Hono Worker API + cron jobs + Workflows on the backend, a React 19 / Vite SPA dashboard on Cloudflare Pages, and Neon Postgres (with pgvector + Row-Level Security) as the single store. Its purpose is to replace the prior "Kleo" Wix Studio marketing agent — whose dominant failure was hallucinating product/feature names — with a system that grounds every generated artifact in a tenant's own RAG corpus and gates it through a multi-validator brand guardian. The **core value loop** is: **corpus** (ingest tenant docs → embed into pgvector) → **generate** (RAG-grounded Claude Sonnet 4.6 blog/social/email/image) → **guard** (5 parallel validators: platform-rules + factual + brand-voice + audience-fit + performance-prediction) → **approve** (human-in-the-loop review queue) → **publish** (Buffer / Wix Blog / SendGrid adapters via cron-driven workflows with cadence enforcement) → **measure** (nightly metrics ingestion from SendGrid / GSC / Umami; Buffer historical import) → **recommend** (weekly Sonnet recommendations + web-search intelligence briefs, plus promotion of top performers to "golden example" RAG chunks that bias future generation). **Overall maturity:** this is a cohesive, iterated **V1** — far beyond a prototype — that genuinely works end-to-end in local/dev: generation, guardians, the approval dashboard, publishing adapters, and the learning loop are all built and wired. But it carries two structural caveats that dominate everything else: **(1) there is no authentication anywhere** — tenant identity is a client-supplied `X-Tenant-ID` header, validated for UUID *format* only; and **(2) the RLS multi-tenant backstop is silently inert** unless the production `DATABASE_URL` uses the non-owner `hailmery_app` (NOBYPASSRLS) role, which the local env files do **not**. As of HEAD it appears the system has **never been deployed to production** (the hardcoded Worker URL 404s, R2 buckets uncreated), and the learning loop is structurally complete but **starved of social/blog metrics** because Buffer/Wix/HubSpot `fetchMetrics()` return empty.

---

## 2. System Architecture

### 2.1 Request + data flow

```
                        ┌───────────────────────────────────────────────────────────┐
                        │  OPERATOR (single trusted user running both OSM + APIRE)   │
                        └───────────────────────────────────────────────────────────┘
                                                  │  browser
                                                  ▼
                ┌──────────────────────────────────────────────────────────────────┐
                │  DASHBOARD  (React 19 + Vite SPA, Cloudflare Pages)                │
                │  Pages: Queue · Calendar · Campaigns · Analytics · Settings        │
                │  TanStack Query data layer (dashboard/src/lib/queries.ts)          │
                │  axios interceptor injects  X-Tenant-ID: <uuid>  on every request  │
                │  NO LOGIN / NO AUTH GUARD                                          │
                └──────────────────────────────────────────────────────────────────┘
                                                  │  HTTPS + X-Tenant-ID header
                                                  │  (CORS: localhost | *.pages.dev)
                                                  ▼
        ┌──────────────────────────────────────────────────────────────────────────────┐
        │  CLOUDFLARE WORKER  "hailmery-api"  (src/index.ts → Hono app)                  │
        │                                                                                │
        │   fetch()                                   scheduled()  (cron router)         │
        │   ├─ /api/*  (src/routes/api.ts, ~40 routes) ├─ */15  runPublishTick           │
        │   │    tenantOf(c) → assertUuid(X-Tenant-ID) ├─ 0 */6 runGenerationTick        │
        │   │    api.use('*') shims secrets→process.env├─ 0 3   runNightlyTick           │
        │   ├─ / , /settings/brand-voice (V0 HTML)     │         (mailsync→metrics→recs) │
        │   └─ /webhooks/sendgrid (ECDSA-verified)     └─ 0 8 Mon runIntelligenceTick    │
        └──────────────────────────────────────────────────────────────────────────────┘
              │ makeDb(DATABASE_URL)                 │ generation/publish              │ adapters
              │ withTenantDb(tx + set_config         │ Workflows or inline fallback    │
              ▼   'app.tenant_id'=<uuid>)            ▼                                 ▼
        ┌─────────────────────────┐     ┌────────────────────────────┐     ┌──────────────────────────┐
        │  NEON POSTGRES          │     │  GENERATION / GUARDIANS     │     │  CHANNEL ADAPTERS        │
        │  schema  marketing.*    │◄────│  loadGenContext → RAG       │     │  Buffer (GraphQL)        │
        │  18 tables, RLS FORCE   │     │  Sonnet 4.6 (prompt-cached) │     │  Wix Blog (md→Ricos)     │
        │  pgvector(1536) HNSW     │     │  runAllGuardians (5×Haiku) │     │  SendGrid (mail/send)    │
        │  cosine <=> retrieval    │     │  insertDraft pending_review │     │  HubSpot / GSC / Umami   │
        └─────────────────────────┘     └────────────────────────────┘     └──────────────────────────┘
              ▲                                  │ embeddings                     │ publish / fetchMetrics
              │ metrics_queue / golden_example   ▼                                ▼
        ┌─────────────────────────┐     ┌────────────────┐            ┌──────────────────────────────┐
        │  R2  hailmery-assets    │     │  OpenAI embed  │            │  EXTERNAL PLATFORMS          │
        │  corpus files + images  │     │  Anthropic LLM │            │  Buffer · Wix · SendGrid ·   │
        │  (local-disk fallback)  │     │  Gemini/Ideogram│           │  HubSpot · Google SC · Umami │
        └─────────────────────────┘     └────────────────┘            └──────────────────────────────┘
```

**Key flow notes:**
- Every tenant-scoped request resolves tenant via `tenantOf(c)` → `assertUuid` (format only, **no auth**), builds a fresh `makeDb(c.env.DATABASE_URL)` Pool, and runs queries inside `withTenantDb(db, tenantId, fn)` which opens a transaction and runs `SELECT set_config('app.tenant_id', <id>, true)`. RLS policy `tenant_isolation` then scopes rows — **but only if the connection role lacks BYPASSRLS**.
- Fleet-wide reads (`/api/tenants`, `findTenantBySlug`, `getAllActiveTenants`, cron tenant scans, seed/migrate) deliberately set `app.rls_bypass='true'`.
- Generation/publish either enqueue a Cloudflare Workflow (`GENERATION_WORKFLOW` / `PUBLISH_WORKFLOW`) or, when the binding is absent, run the pipeline inline via `c.executionCtx.waitUntil(...)`.

### 2.2 Deployment topology

| Component | Platform | Notes |
|---|---|---|
| API + cron + Workflows | Cloudflare Worker `hailmery-api` | `wrangler.toml`: `compatibility_date 2026-05-01`, `nodejs_compat`, 4 crons, 2 Workflow bindings, R2 binding, `IMAGE_PROVIDER=gemini`. Intended host `hailmery-api.bezekyigit0.workers.dev`. |
| Dashboard | Cloudflare Pages | React 19 / Vite build; `VITE_API_URL` → Worker origin; intended custom domain `marketing.leadorch.io`. `dashboard/.env.production` already hardcodes the (undeployed) Worker URL. |
| Database | Neon Postgres (serverless branches) | Single `marketing.*` schema. **Same instance is the intended H3 home for LeadOrch + Umami** (shared multi-schema blast radius). |
| Object storage | Cloudflare R2 (`hailmery-assets` / `-preview`) | Corpus uploads + generated images. Local-disk fallback under `out/uploads/`. **Buckets not yet created per DEPLOY.md.** |
| Image gen | Google Gemini 3 Pro Image (primary) / Ideogram 3.0 (fallback) | Provider selected by `IMAGE_PROVIDER`. |

> **Deployment status (from PLAN/CURRENT_SITUATION/DEPLOY analysis):** `wrangler deploy` appears to have **never run**. The production URL 404s, R2 buckets do not exist, the custom domain is unconfigured, and prod tenant secrets are unseeded. `.wrangler/state` is a local simulation only. This is the single most important contextual fact about "maturity": the code is V1, the deployment is zero.

---

## 3. Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| API runtime | Cloudflare Workers + Hono ^4.6 | HTTP ingress, routing, CORS, cron `scheduled()`, webhooks |
| Compatibility | `nodejs_compat` + `process.env` shim | Lets Node-style AI client getters run in the Worker |
| Orchestration | Cloudflare Workflows (`GenerationWorkflow`, `PublishWorkflow`) | Stateful, per-step-journaled generation + publish pipelines, with inline fallback |
| ORM / DB driver | Drizzle ORM 0.36.4 + `@neondatabase/serverless` 0.10.4 (Pool/WebSocket) | Mostly raw `sql\`\`` tagged templates + `tx.execute<Row>` |
| Database | Neon Postgres, single `marketing.*` schema | 18 tenant-scoped tables, 11 enums |
| Vector search | pgvector `vector(1536)` + HNSW `vector_cosine_ops` | RAG retrieval via cosine `<=>` operator |
| Isolation | Postgres RLS (FORCE ROW LEVEL SECURITY), `set_config('app.tenant_id')` GUC | Per-tenant row isolation (contingent on connection role — see §4) |
| Frontend | React 19 + Vite + TypeScript | Operator SPA (5 pages) |
| FE data layer | TanStack Query v5 + axios | Query/mutation hooks, cache invalidation, polling |
| FE styling | Tailwind CSS v4, custom UI kit, lucide-react, recharts | Dark glass theme; hand-rolled Dialog/Popover/Sheet/Tabs/Toast |
| Generation model | **Claude Sonnet 4.6** (`claude-sonnet-4-6`) | Blog/social/email generation, recommendations, intelligence research, image-prompt authoring |
| Guardian / classification model | **Claude Haiku 4.5** (`claude-haiku-4-5-20251001`) | 4 advisory guardians + factual check; image visual-category classification |
| Embeddings | **OpenAI `text-embedding-3-small`** (1536-dim) | Corpus + query + golden-example embeddings |
| Image gen | **Google Gemini 3 Pro Image** (default) / **Ideogram v3** (fallback) | Paired images for drafts |
| Prompt caching | Anthropic `cache_control: ephemeral` | Caches the static system prefix (~90% input savings claimed; unverified) |
| Web research | Anthropic server-side `web_search_20250305` tool (max_uses 6) | Weekly intelligence brief over last 7 days of AI-security news |
| Token chunking | `gpt-tokenizer` (cl100k_base) | 512-token chunks / 64 overlap, matched to the embedding model |
| Secret encryption | Web Crypto **AES-GCM-256** (`SECRETS_KEY`, base64 32-byte) | Per-tenant platform tokens in `tenant_secrets` |
| OAuth state | Web Crypto **HMAC-SHA256** (reuses `SECRETS_KEY`) | CSRF-signed Google OAuth state (10-min TTL) |
| Webhook verify | Web Crypto **ECDSA P-256 / SHA-256** (DER→P1363) | SendGrid Event Webhook signature verification |
| Object storage | Cloudflare R2 + Node `fs` fallback | Corpus originals + generated assets |
| **External integrations** | Buffer (GraphQL + legacy v1 REST), Wix Blog (REST→Ricos) + Media Manager, SendGrid v3 (+webhook), HubSpot CRM v3, Google Search Console (OAuth2), Umami (self-hosted) | The publish + metrics integration boundary |
| Tooling | wrangler CLI, pnpm scripts (`dev`/`deploy`/`db:*`/`ingest`/`gen`/`test`/`test:rls`), tsx, vitest, drizzle-kit | Dev + ops |

---

## 4. Multi-Tenancy & Security Model

hailmery serves two brands (OSM, APIRE) from one database and one Worker. Isolation is built on three layers, the first of which is currently the only one that actually fires.

### 4.1 Layer 1 — Explicit `tenant_id` predicates (the real isolation today)
Every tenant-scoped query carries an explicit `WHERE tenant_id = ${tenantId}` (or `dc.tenant_id = ...` for RAG). The `withTenantDb` helper is the single chokepoint (≈94 call sites across 18 files) and wraps work in a transaction. **This predicate-based defense is what actually isolates tenants in the deployed/dev configuration**, because of the RLS wrinkle below.

> **Historical bug (commit `657d906`): "OSM RAG was pulling APIRE chunks."** This is concrete evidence that predicate-only isolation has already failed once. It underscores why a forgotten predicate is a real cross-tenant leak vector, not a theoretical one.

### 4.2 Layer 2 — Postgres RLS (the intended backstop, currently inert)
`src/db/rls.sql` enables and **FORCEs** RLS on every `marketing.*` table and applies one uniform policy via a loop over `pg_tables`:

```
tenant_isolation USING/WITH CHECK:
  NULLIF(current_setting('app.tenant_id', true), '')::uuid = tenant_id
  OR current_setting('app.rls_bypass', true) = 'true'
```

- **Fail-closed by design:** an unset/empty `app.tenant_id` → `NULLIF` → NULL → zero rows (verified by `tests/rls.test.ts`, run via `pnpm test:rls`).
- `app.rls_bypass='true'` is the escape hatch for seed/migrate/fleet scans.
- The `tenants` table is itself under FORCE RLS; it works because `tenants.tenant_id` is a generated column = `id`.

**The neondb_owner BYPASSRLS wrinkle (the dominant security caveat):** RLS only bites when the connection role lacks the `BYPASSRLS` attribute. Neon's default `neondb_owner` has `BYPASSRLS=true` and *cannot be altered*. `rls.sql` therefore creates a dedicated `hailmery_app` role with **NOBYPASSRLS** and documents that production **must** use it. However:
- Local `.env` and `.dev.vars` both use `neondb_owner` → **RLS is completely inert in dev** and the policy is silently a no-op.
- If production `DATABASE_URL` is ever set to `neondb_owner` (the Neon default, trivially copy-pasted), **RLS is silently defeated** with zero errors, and isolation collapses to Layer 1 alone — meaning any single forgotten `tenant_id` predicate becomes a full cross-tenant read/write.

CURRENT_SITUATION.md lists switching prod `DATABASE_URL` to `hailmery_app` as the single highest-leverage deploy step; **it is not confirmed done.** This is unanswerable from code (see §9).

### 4.3 Layer 3 — There is no authentication (the dominant security gap)
This is **not a stub; it is a real, by-design-but-dangerous gap.** Every analysis converges on it:
- The API has **no auth layer** — no session, JWT, API key, or allowlist. `tenantOf()` trusts the client-supplied `X-Tenant-ID` header, validated for **UUID format only** and never checked against existence or ownership.
- **RLS does NOT help here.** RLS keys off the *same* header value (`app.tenant_id`). An attacker who knows/guesses a tenant's UUID simply supplies it and gets full read+mutate access to that tenant's data, plus the ability to trigger generation/publish, connect/disconnect platforms, and read decrypted account labels.
- **Tenant UUIDs are discoverable:** `GET /api/tenants` runs with `rls_bypass` and returns **every** tenant fleet-wide (id, name, slug, site domain) with no auth. The dashboard's tenant switcher exposes all brands to anyone who can load the SPA.
- The only protection today is **secrecy of the Worker URL and tenant UUIDs**. Whether anything external (Cloudflare Access, WAF, IP allowlist, reverse proxy) fronts the Worker is unknown from code (see §9).

### 4.4 Secrets & credential handling
- Per-tenant platform tokens live in `marketing.tenant_secrets` (PK `(tenant_id, platform)`), encrypted with **AES-GCM-256** via `src/lib/secrets.ts` (format `base64(iv):base64(ct)`, key = base64 32-byte `SECRETS_KEY`). Random 12-byte IV per encrypt (good). **No key-rotation/versioning scheme** — rotating `SECRETS_KEY` silently breaks all stored token decryption *and* invalidates in-flight OAuth state (HMAC reuses the same key bytes).
- `SECRETS_KEY` must match exactly between the Worker secret and the machine that ran `seed-tenant-secrets.mjs`, or all per-tenant decryption fails at runtime.
- Google OAuth: HMAC-signed CSRF state (10-min TTL), refresh-token enforcement (refuses write scope without a refresh token), and `storeGoogleCredential` upsert with `COALESCE`. **Google is the only platform with a real token-refresh path** (`refreshGoogleAccessToken`, skew-based).
- Additional security gotchas: CORS allows **any** `*.pages.dev` origin (over-broad); the public unauthenticated `GET /api/assets/:key{.+}` R2 proxy relies entirely on key unguessability; `POST /api/debug/sync-gsc` is a debug endpoint shipped to prod; the SendGrid webhook resolves tenant from an **unsigned** `?tenant=` query param (the ECDSA signature only covers timestamp+body).

---

## 5. Subsystem-by-Subsystem Deep Dive

### 5.1 HTTP API Surface & App Entry (Hono Worker)
**Purpose:** The single HTTP ingress — mounts the `/api` JSON surface for the dashboard, a minimal V0 server-rendered brand-voice page, the SendGrid webhook, and the cron `scheduled()` handler. The thin validation-and-routing layer in front of generation/publish/agents/store.

**Key files:** `src/index.ts` (193 LOC — Worker entry, CORS, `/api` mount, V0 HTML, webhook, Workflow exports, `scheduled()` cron router); `src/routes/api.ts` (~2596 LOC — the entire JSON API, ~40 routes; helpers `err()`, `tenantOf()`, `normalizeDraft()`); `src/routes/settings.ts` (V0 brand-voice editor); `src/lib/tenant.ts`; `src/db/client.ts` (`makeDb()`); `src/db/rls.sql`; `src/lib/google-oauth.ts`.

**How it works:** Request → `app.fetch` → CORS (only `/api/*`, origin `localhost:<port>` or `*.pages.dev`) → `api.use('*')` copies bound secrets into `process.env` → per-handler `tenantOf(c)` → `assertUuid` → `makeDb()` (new Pool per request) → `withTenantDb`. Mutations that fan out work enqueue a Workflow or run inline via `waitUntil`. The webhook reads the raw body, verifies the ECDSA signature, processes out-of-band, and returns `200 ok` fast. `scheduled()` switches on `event.cron` to 4 ticks.

**Features:** approval-queue API (`GET /api/drafts` with status/campaign/month filters, `PATCH /api/drafts/:id`, `POST /api/drafts/:id/recheck`, `GET /api/drafts/:id/preview`); campaigns CRUD with derived counts + first-batch gen trigger; corpus upload/ingest/reingest/delete; connections wizard with live probes + 5-min in-isolate cache; SendGrid domain-auth self-serve; Google OAuth start/callback + `POST /api/debug/sync-gsc`; `POST /api/generate`, `/api/generate-now`, `/api/publish/:draftId`; analytics summary/top-content/keywords; `/api/queue-status`, `/api/intelligence(+/refresh)`, `/api/recommendations(+/refresh,/:id)`; public `GET /api/assets/:key{.+}` R2 proxy; `POST /api/import/buffer-history`.

**Integration points:** all `marketing.*` tables; consumed by `dashboard/src/lib/api.ts`; Workflows; guardians; generators; jobs; external Buffer/HubSpot/SendGrid/Google/OpenAI APIs; `lib/storage`, `lib/secrets`, `lib/credentials`, `lib/google-oauth`.

**Maturity:** Largely **shipped/working** for a single-operator tool. The `src/index.ts` top-of-file comment is **stale** ("only 3 routes / all others V1+") — the full `/api` surface is implemented. `/settings/brand-voice` HTML is an intentional V0 placeholder superseded by `PATCH /api/sites/:id/config`. **No auth by design.**

**Risks/gotchas:** No auth anywhere (see §4.3); RLS backstop contingent on connection role; `tenantOf()` never verifies tenant existence; CORS `*.pages.dev` wildcard; `makeDb()` creates a new uncloseed Neon Pool per call (connection churn); `process.env` mutated per request; unauthenticated asset proxy; `/api/debug/sync-gsc` in prod; webhook unsigned `?tenant=`; inconsistent publish error envelope (`{ok:false}` 422 vs standard `{error,code}`); `PATCH` writing `publish_at::timestamptz` from body can throw an unhandled 500 on malformed input; some handlers throw plain Errors that escape the `{error,code}` contract as generic Hono 500s.

---

### 5.2 Data Layer, Schema & Multi-Tenant RLS
**Purpose:** Defines the entire persistent model (`marketing` schema) and enforces hard isolation between OSM and APIRE. Centralizes tenant scoping in `withTenantDb`; owns extensions (vector, pgcrypto), the HNSW index, additive idempotent migrations, and the two-tenant seed.

**Key files:** `src/db/schema.ts` (471 LOC — Drizzle `pgSchema('marketing')`, 18 tables, 11 enums, `$inferSelect` exports); `src/db/rls.sql` (307 LOC — extensions, additive migrations, HNSW index, FORCE RLS, uniform policy, `hailmery_app` role); `src/lib/tenant.ts`; `src/db/client.ts`; `src/db/migrate.ts`; `src/db/seed.ts`; `tests/rls.test.ts`; `drizzle.config.ts`; consumed by `src/routes/api.ts`.

**How it works:** dashboard sets `X-Tenant-ID` → `tenantOf` validates → `makeDb` → `withTenantDb` opens a tx, runs `set_config('app.tenant_id', $id, true)` (tx-scoped), runs `fn(tx)` with redundant explicit predicates. Migration: `db:push` (drizzle-kit, run by hand) diffs `schema.ts` and emits DDL, **then** `db:migrate` applies `rls.sql` (idempotent; drops then recreates policies in a loop so new tables auto-inherit isolation). `migrate.ts` also runs `ALTER TYPE ... ADD VALUE 'seo_opportunity'` as separate autocommit statements.

**Features:** 18-table multi-tenant schema; uniform RLS policy auto-applied; fail-closed isolation; `app.rls_bypass` escape hatch; defense-in-depth predicates; pgvector RAG with HNSW; encrypted per-tenant secrets; generated `tenant_id = id` on the tenants table; idempotent additive migrations; rich two-tenant seed (OSM "Executive Command Center" voice, APIRE "CISO" voice + default evergreen campaign); learning-loop columns (`performance_score`, `is_golden_example`, `guardian_breakdown`); upsert-enabling unique constraints.

**Maturity:** **Shipped/working** — schema, RLS mechanics, chokepoint, seed, migration path, pgvector, and `rls.test.ts` all genuinely function. `metrics_queue` is described as "V2 Cloudflare Queue" but the table *is* the working mechanism today. `getAllActiveTenants == getAllTenants` (no soft-delete column yet — acknowledged stub).

**Risks/gotchas:** **CRITICAL** — RLS inert under `neondb_owner` (local env uses it); **CRITICAL** — no auth, `X-Tenant-ID` trusted verbatim. `db:push` is destructive to RLS (drizzle-kit doesn't manage policies) — running it without re-running `db:migrate` leaves tables wide open; `schema.ts` and `rls.sql` are manually kept in sync and can drift (the `seo_opportunity` enum value is coordinated across **3 locations**). Only **3 real FKs** exist (`document_chunks→documents` CASCADE, `content_drafts.campaign_id→campaigns`, `metrics_queue.draft_id→content_drafts`); most parent/child links and **all `tenant_id` columns lack FKs to `marketing.tenants`** → typo'd tenant_id produces silently RLS-hidden rows, and deletes can orphan metrics/publish_log (the `metrics_queue` FK has no `ON DELETE`, so deleting a draft with queued metrics errors). `client.ts` module-level singleton `db = makeDb('')` is a latent footgun if imported in the Worker. `site_id` columns are unenforced uuids with no same-tenant cross-check.

---

### 5.3 RAG Corpus Ingestion Pipeline
**Purpose:** Extract → chunk → embed → upsert versioned chunks into pgvector for per-tenant RAG.

**Key files:** `src/corpus/extract.ts` (multi-format: MD/TXT, DOCX via hand-rolled ZIP + `DecompressionStream` with mammoth fallback, PDF via lazy `pdf-parse` Node-only); `src/corpus/chunker.ts` (thin re-export; section-aware splitting is a TODO); `src/corpus/embedder.ts` (`embedBatch` of 100, `embedOne`); `src/corpus/ingest.ts` (`embedChunks` + `replaceDocumentChunks`); `src/corpus/sync.ts` (filesystem markdown V0, CLI-only); `src/cli/ingest.ts` (`pnpm ingest --tenant <slug>`); `src/lib/tokens.ts` (512/64 sliding window); plus `lib/ai.ts`, `lib/tenant.ts`, `routes/api.ts`, `schema.ts`, `rls.sql`.

**How it works (two converging paths):** **HTTP** (`POST /documents/upload`): validate type/extension/size (≤10MB) → INSERT `documents` (`extraction_status='pending'`, ON CONFLICT bumps version) → R2 put at `corpus/{tenantId}/{documentId}/{filename}` → `extractText` → on failure `markFailed` + **HTTP 200 partial success** → else `embedChunks` (chunk → batch-embed → validate 1536-dim + finite) → `replaceDocumentChunks` (supersede live chunks, raw-SQL `'[...]'::vector` bulk insert, stamp `chunk_count` + `extraction_status='ingested'`) → 201. **Reingest** loads from R2 by `r2_key` (422 if missing). **CLI** (`syncCorpus`): reads `corpus/{slug}/*.md`, `onConflictDoUpdate`, supersede, Drizzle `number[]` insert. **Retrieval:** `embedOne(topic)` → `ORDER BY embedding <=> '[...]'::vector WHERE tenant_id=$ AND superseded=false`.

**Features:** four-format extraction with runtime-aware fallbacks; token-aligned cl100k_base chunking; batch embedding (100/call); embedding integrity guard (rejects non-1536-dim / non-finite, preventing HNSW NaN poisoning); versioned supersede-and-replace re-ingest; graceful degradation (failure → 200 partial); embedding done **outside** the tenant tx (only fast supersede+insert inside); R2 with local fallback; HNSW cosine ANN index; CLI ingest; `golden_example` document type retrieved separately.

**Maturity:** HTTP path is **shipped/working** (production-grade). CLI/`sync.ts` path is **working-but-legacy** and **diverges**: it doesn't set `chunk_count`/`extraction_status`, inserts via Drizzle `number[]` instead of the raw-SQL literal, and **skips the embedding guard**. Section-aware chunking is a **stub/TODO** (`sectionTitle` always null). PDF in the Worker is intentionally degraded (`pdf-parse` Node-only → `extraction_status='failed'`).

**Risks/gotchas:** RLS bypass under `neondb_owner` (isolation rests on the predicate); `sync.ts` skips the NaN guard (can poison the index, which the read-side guard then trips); CLI-ingested docs are non-interchangeable (`source='git'`, fake `r2_key='git://...'` → cannot reingest, 422); sliding-window emits a near-duplicate trailing chunk; **embedding is synchronous in the Worker request** — a 10MB file → thousands of chunks → Worker CPU/time risk (no background queue despite the `'pending'` status implying one); DOCX extractor reads only `word/document.xml` (silently drops headers/footers/footnotes/textboxes; tables degrade); concurrent same-filename re-upload race can leave mixed-version live chunks; `embedOne` doesn't validate OpenAI returned data length; `MAX_UPLOAD_BYTES` not enforced in the CLI.

---

### 5.4 Content Generation (blog / social / email / image / RAG context + caching)
**Purpose:** Turn a topic seed + tenant id into brand-grounded blog posts, per-channel social, newsletters/drips/outreach, and paired images — forcing factual claims through tenant RAG (top-k=8 corpus + top-3 golden) and a multi-guardian check, then queuing `pending_review` drafts. Invoked by `GenerationWorkflow` and a gen CLI.

**Key files:** `src/generation/context.ts` (272 LOC — shared RAG+tenant plumbing: `loadGenContext`, `brandVoicePreamble`, `buildCorpusBlock/buildGoldenBlock`, `estimateTextCostCents` $3/$15 Sonnet pricing, `insertDraft`); `src/generation/blog.ts` (standalone — does **not** use context.ts; own RAG + `parseSimpleYaml`); `src/generation/social.ts` (per-channel via `CHANNEL_SPECS`, runs `runAllGuardians`, inserts; plus legacy `generateSocialPack`); `src/generation/email.ts` (newsletter/drip/outreach via `@@MARKER@@` framing; `resolveEmailDelivery`; outreach **not** queued); `src/generation/image.ts` (856 LOC — Sonnet classifies 3 visual categories, validates, regenerates once, Gemini default / Ideogram fallback, hardcoded APIRE palette); `src/cli/gen.ts`; `src/workflows/generation.ts` (orchestrator); `lib/ai.ts`; `lib/tenant.ts`; `rls.sql`.

**How it works:** `loadGenContext` embeds the topic, opens `withTenantDb`, resolves tenant/site/campaign + `brand_voice`, runs two pgvector queries (top-k chunks + top-3 golden). Generator assembles a cached system prefix + corpus + golden, calls Sonnet 4.6, parses (YAML for blog, `@@MARKER@@` for email, raw for social), runs `runAllGuardians` (platform_rules sync/blocking + 4 advisory via `Promise.allSettled`), `summarizeGuardianBreakdown`, `insertDraft` (status `pending_review`, payload jsonb, `cost_cents`, `guardian_breakdown`). Images: classify → validate → regenerate-once → provider → R2/local → `assets` row → UPDATE `content_drafts.assets`.

**Features:** blog (strict YAML frontmatter + markdown); per-channel social (LinkedIn/X/Instagram/TikTok/GBP); email (newsletter, 5-step drip with offsets `[0,3,7,14,21]` + anti-repeat, 1:1 outreach not queued); RAG assembly with anti-hallucination rules; golden-example learning loop; prompt caching of the static prefix; image generation with category classification + validation; APIRE palette enforcement (`#000000` + `#7c3aed` + `#06b6d4`); campaign/phase voice modifiers; SendGrid/HubSpot delivery resolution; gen CLI with `out/` artifacts.

**Maturity:** Text generation **largely shipped/working**. Image prompt-building/validation/palette is mature and runs even without an API key (placeholder). Known WIP/V2: email recipient-list (`to_list`) resolution, per-tenant verified-sender config, drip single-send. `generateSocialPack`/`buildIdeogramPrompt` are backward-compat shims. `notifyQueue` is a log line. **`blog.ts` is older/divergent** — duplicates RAG logic, different golden ordering, no `voiceModifier`, no inline multi-guardian.

**Risks/gotchas:** isolation rests entirely on the explicit `dc.tenant_id` predicate (active env = `neondb_owner`); `blog.ts` golden query orders by `created_at DESC` (recency-by-ingest) vs `context.ts` by vector distance — **two divergent golden strategies**; prompt-cache effectiveness **unverified** (only the static prefix is cached; corpus block deliberately uncached; nondeterministic `JSON.stringify(brandVoice)` ordering could silently kill cache reads); X 280-char limit is soft at generation, blocking only at publish (no regeneration loop); image `validateImagePrompt.passed` does **not** gate `generateImage` (invalid prompts still sent; only APIRE gets a deterministic palette safety-net); `NAME_DENYLIST` is crude substring matching (false positives like "amazon rainforest"; the "dynamic tenant-name" addition is commented but **not implemented**); **APIRE tenant hardcoded by UUID** `6daebc34-...` (brittle across reseeds → wrong-brand imagery); hardcoded `PROXY_BASE` worker URL → environment-coupled image links; outreach uses legacy single `brandGuardian` (skips the other 4 guardians); `loadGenContext` throws hard for partially-onboarded tenants.

---

### 5.5 Brand Guardian Multi-Validator System
**Purpose:** A 5-validator post-generation gate against hallucinated names (APIRE's "W-004") plus four advisory quality dimensions. Fault-tolerant: a failing validator degrades to a neutral skip.

**Key files:** `src/agents/guardians/index.ts` (`runAllGuardians`, `summarizeGuardianBreakdown`); `src/agents/guardians/context.ts` (single shared resolver, never throws); `src/agents/guardians/types.ts`; `src/agents/guardians/llm.ts` (`haikuJson`, `clampScore`, `readFlags`); `src/agents/guardians/platform-rules.ts` (the only blocking, zero-LLM validator); `src/agents/guardians/factual.ts` (delegates to legacy `brandGuardian`); `src/agents/guardian.ts` (legacy single Haiku fact-check); `brand-voice.ts`; `audience-fit.ts`; `performance-prediction.ts`; `dashboard/src/components/GuardianBreakdown.tsx`; wired in `routes/api.ts`.

**How it works:** `runAllGuardians` → `resolveGuardianContext` (one `withTenantDb` tx loads campaign, `site_config`, brand-guideline + persona chunks, corpus-presence, up to 10 golden examples; derives availability flags + `missingContext` prompts) → `runPlatformRulesGuardian` (sync, deterministic, sets `passed`/`blocking`) → 4 advisory validators concurrently under `Promise.allSettled` (each decides skip-vs-run from flags, then `haikuJson`; factual delegates to `brandGuardian`'s own corpus Haiku call) → `overall` = **unweighted mean** of non-skipped advisory scores → `summarizeGuardianBreakdown` derives legacy `guardianScore`/notes/`flagCount`. At publish, the route reads the **stored** breakdown and refuses with `guardian_blocked` (422) if `breakdown.blocking` — it does **not** re-run.

**Features:** 5 single-responsibility validators; single shared context resolve; graceful degradation; context-aware skipping (no meaningless zeros); deterministic free blocking platform-rules gate (char limits, hashtag caps, LinkedIn CTA, TikTok HOOK/SCRIPT/CTA, email subject + CAN-SPAM/GDPR unsubscribe); Haiku LLM-judge with explicit anti-bias instruction (don't penalize bold voice); performance prediction that needs ≥5 channel golden examples; `missingContext` deep-links into Settings; robust JSON extraction + coercion; publish-time hard gate; legacy back-compat; re-check endpoint.

**Maturity:** Platform-rules, context resolver, orchestrator fan-out, persistence, recheck, and dashboard UI are **shipped/working**. Brand-voice/audience-fit/performance/factual make real Haiku calls but accuracy is **unverified** (no golden tests) and depends on context completeness — for a cold/fresh tenant they mostly **skip**. Performance prediction is effectively **dormant** until a tenant accumulates ≥5 labeled channel golden examples. **The "weighted average" in comments/types is actually an unweighted mean** (weighting is vestigial doc). Blog deliberately bypasses the multi-validator (legacy single guardian only).

**Risks/gotchas:** **overall-score footgun** — legacy `brandGuardian` returns `score:0` on JSON *parse* failure (not a thrown error), and `factual.ts` passes that 0 through as a real score, so a single parse glitch can crater `overall` to ~0 and flip the UI to red; **stale-breakdown publish gate** — publish trusts the stored breakdown and never re-runs, so a `PATCH` edit (whose `rerunGuardian` path only runs legacy `brandGuardian` and never refreshes `guardian_breakdown`) can desync the blocking state in either direction; **legacy `brandGuardian` queries `document_chunks` with NO explicit `tenant_id` predicate** (RLS-only) — the lone outlier; under a BYPASSRLS role it would fact-check against the **union of all tenants' corpora** (cross-tenant leak); `CHANNEL_RULES` keys must exactly match the channel strings — an unknown channel (`wix-blog`, typo'd `gbp`) gets **zero rules and fails open**; email unsubscribe regex can false-block or false-pass; golden `performance_score` coerces null→1.0 (fabricated "Nx" data); every draft/recheck can fire up to 4 Haiku calls (no batching, no caching on advisory calls); `missingContext` "publish more on this channel" prompt is a dead end without a working `is_golden_example`/`performance_score` labeling flow.

---

### 5.6 External Platform Adapters (Buffer, GSC, HubSpot, SendGrid, Umami, Wix Blog)
**Purpose:** The entire integration boundary. Each adapter wraps one provider's API behind a uniform `ChannelAdapter` interface (`publish` / `fetchMetrics` / `quotaState`). Adapters are "credential-pure" (no DB access); credential loading lives in `lib/credentials.ts`, recipient resolution in `services/recipients.ts`.

**Key files:** `src/adapters/index.ts` (interface, types, `adapterFetch` + `AdapterHttpError`, `getAdapter`/`ADAPTER_MAP` lazy factory); `buffer.ts` (GraphQL `createPost`, `Query.post` metrics, `listHistoricalPosts` undocumented query, `mapBufferMetrics`, legacy-v1 `quotaState`); `wix-blog.ts` (639 LOC — markdown→Ricos `toRicos`, Media Manager image import, the most logic-heavy adapter); `hubspot.ts` (`getContacts`, `getAllContacts` resolver); `sendgrid.ts` (`mail/send` with personalizations + UTM + custom_args, `syncContacts`, `getGlobalUnsubscribes`, `handleSendGridWebhook`, `getAllSendGridContacts`); `gsc.ts` (read-only, dead internal `refreshAccessToken`); `umami.ts` (read-only); plus `lib/credentials.ts`, `jobs/metrics.ts`, `services/mailsync.ts`.

**How it works:** **Publish** — scheduler → `publishDraft` → `resolveAdapter(channel)` (decrypts `tenant_secrets`, builds creds with Buffer profileIds / Wix siteId+memberId). For email, `publish.ts` first calls `resolveEmailRecipients` to materialize `payload.to_list`, then `adapter.publish()` → writes `published_ref`, `publish_log`, seeds `metrics_queue`. **Metrics** (nightly) — `processMetricsQueue` → `adapter.fetchMetrics` → upsert `content_metrics` only if non-zero; `syncGscKeywords`; `syncUmamiPageviews` (slug-substring matching). **Webhook** — ECDSA verify → tenant from `?tenant=` → events → `content_metrics` + HubSpot. **Importer** — `listHistoricalPosts` backfill with dedup.

**Features:** Buffer social publishing (facebook/instagram/linkedin/twitter/tiktok/pinterest, shareNow/scheduled, image attach); Buffer cumulative metrics with per-network alias normalization; Buffer historical bulk import via an undocumented introspected query; Wix markdown→Ricos compiler (real HEADING/DIVIDER/LIST/CODE/PARAGRAPH nodes, BOLD/ITALIC/LINK, scheme sanitization) + cover/inline image import with plain-paragraph fallback; SendGrid send with per-recipient personalizations + UTM + custom_args + HTML→plaintext; SendGrid webhook → metrics + suppression; HubSpot recipient resolution (paginated, opt-out drop, dedup, 500 cap with truncation flag); GSC keyword/top-page fetch with >3× high-performer flagging; Umami pageviews; per-adapter `quotaState` health.

**Maturity:** **Shipped/working:** Buffer publish/metrics/import (comments claim live verification against APIRE org with 110 LinkedIn posts), Wix Blog publish (the Ricos converter fixed a V1 bug where `##`/`---`/`**` leaked as literal text), SendGrid publish/webhook/recipients, HubSpot paging, GSC keyword sync, Umami pageviews. **Partial/stub:** `fetchMetrics` is `EMPTY_METRICS` (no-op) for **GSC, HubSpot, Umami, Wix Blog** by design — **only Buffer and SendGrid return real per-draft data.** HubSpot `createTimelineEvent` is implemented but mailsync gates it **off** (`timelineEnabled:false`; private-app token can't create custom timeline events). **Dead code:** `GscAdapter.refreshAccessToken()` is private and never called (refresh is external); `Umami.fetchWebsiteStats/getEvents`; Buffer legacy-v1 `quotaState`; `handleSendGridWebhook` is exported/tested but the live path uses `processSendGridWebhookEvents`.

**Risks/gotchas:** **Buffer `quotaState` is broken** — it calls legacy v1 `api.bufferapp.com/1`, against which the current OIDC PAT returns 401, so the connections Buffer health card likely throws; dead `GscAdapter.refreshAccessToken()` (any future caller expecting self-refresh 401s); `getAllSendGridContacts` only sees the **first ~50-result page** despite a 500 cap → a SendGrid-only tenant silently sends to a partial audience; webhook tenant from unsigned `?tenant=` (cross-tenant attribution/poisoning); Buffer cumulative-since-publish metrics mean 1h/24h windows store identical totals (windowed social analytics are illusory; `metrics.ts` takes MAX); the historical-import query is **undocumented/introspected** (brittle to Buffer schema changes; throws on shape change); Wix uses raw API-key auth (not Bearer) — fragile if any helper assumes Bearer; `toRicos` has a 400KB slice + several markdown constructs degrade to plain text; `resolveAdapter` uses `new (AdapterClass as any)(creds)` (no static cred-shape check); `processMetricsQueue` marks rows `fetched=true` in `finally` even on error (transient outage permanently loses that window — no retry); Umami slug-substring attribution double-counts; **no rate limiting / backoff in any adapter.**

---

### 5.7 Background Jobs & Intelligence (cron, metrics, briefs, recommendations, import)
**Purpose:** The autonomous "brain" — four crons that ingest metrics, score content, run weekly LLM web-research briefs, generate weekly recommendations, and bulk-import Buffer history to seed the learning loop. Multi-tenant, best-effort.

**Key files:** `src/jobs/scheduler.ts` (cron router: `runPublishTick` */15, `runGenerationTick` 0 */6 tops up below `QUEUE_TARGET=5`, `runNightlyTick` 0 3 = mailsync→metrics→recommendations, `runMailSync`); `src/jobs/metrics.ts` (612 LOC — 5 isolated steps: `processMetricsQueue`, `syncGscKeywords`, `syncUmamiPageviews`, `scorePerformance`, `tagGoldenExamples`/`promoteGoldenExample`); `src/jobs/recommendations.ts` (967 LOC — `gatherData` → Sonnet → `parseRecommendations` → replace this-week pending); `src/jobs/intelligence.ts` (286 LOC — Mon 08:00, RAG summary → Sonnet+web_search → 5-7 topics → upsert `intelligence_briefs`); `src/jobs/import-buffer.ts` (373 LOC — triple-dedup historical import); `lib/tenant.ts`; `rls.sql`; `index.ts`; `routes/api.ts`.

**How it works:** Cloudflare fires a cron → `scheduled()` switch → tick. Nightly (0 3): `runMailSync` → `runNightlyMetrics` (per tenant, 5 try/catch-isolated steps) → `runRecommendationsTick`, in strict order so recs read fresh scores. `scorePerformance` = `(clicks*3 + engagement*2 + impressions) / channel-median` (median over full history). `tagGoldenExamples` clears `is_golden_example` fleet-wide, re-tags the top decile with score>1.0, embeds each winner into a `golden_example` document+chunk for RAG. Recommendations: `gatherData` runs ~7 tenant-scoped queries (channel perf, keyword topic clusters, queue cadence, latest brief, top winners, campaigns, GSC striking-distance) → skip if `<5` scored posts → Sonnet → parse/coerce → DELETE this-week pending + INSERT ≤5 (`expires_at` = Monday+7d). Intelligence: embed positioning → RAG top-8 → `summariseCompany` → `researchTopics` (Sonnet + web_search) → upsert per (tenant, ISO week).

**Features:** closed learning loop; weekly AI intelligence brief (Sonnet + server-side web_search); weekly recommendations engine (content_gap / channel_rebalance / trending_opportunity / queue_health / engagement_followup / **seo_opportunity**) with `action_type`/`action_params` wired to the "Generate now" modal; SEO striking-distance detection (GSC pos 4-20, >100 impressions/wk, not yet covered); 15 hand-curated keyword clusters (NIS2/EU AI Act/CTEM/prompt-injection); 3-source metrics ingestion; idempotent Buffer import (triple dedup); campaign queue auto-replenishment; fleet-wide fault isolation; honest-zero metrics policy (no stub rows on zero fetch).

**Maturity:** **Mostly shipped/working** with real DB writes and live LLM calls. Documented known-limitation: golden-example **demotion is asymmetric** — `promoteGoldenExample` only INSERTs, nothing supersedes on demotion, and retrieval selects on `document_type`/`superseded` not `is_golden_example`, so the **golden corpus grows monotonically** (flagged V2). `getAllActiveTenants` = "exists" (no status column — V0). Scheduler header comment is stale ("metrics placeholder"). `seo_opportunity` only fires when GSC is connected.

**Risks/gotchas:** `intelligence.ts` corpus chunk query (lines ~96-103) has **NO explicit `tenant_id` predicate** (RLS-only — the only such query in the subsystem); safe only inside `withTenantDb` under FORCE RLS — a cross-tenant brief leak if RLS is ever disabled or the role becomes BYPASSRLS. All manual triggers (`/api/recommendations/refresh`, `/intelligence/refresh`, `/import/buffer-history`) are gated **only** by `X-Tenant-ID` and run synchronous multi-second Sonnet+web_search calls inline (DoS / cost-amplification surface; no rate limit; `tenant_usage` not written). Buffer history import runs synchronously → ~30s Worker CPU limit for large tenants. Golden corpus monotonic growth. Scoring edge cases: unmeasured published posts get score 0 (not NULL) and drag the picture; Umami writes engagement=impressions=views (double-counts pageviews into the engagement*2 term, inflating blog scores). `metrics_queue` drains destructively on any error. Import intra-run dedup is by id only. Three divergent `CHANNEL_NORM` maps (recommendations / api analytics / credentials) can mis-bucket channels between views. `parseRecommendations` silently returns `[]` on parse failure → 500 or <5 recs with no operator warning.

---

### 5.8 Orchestration Workflows + Infra Libs/Services
**Purpose:** The execution core — the two stateful pipelines (`GenerationWorkflow`, `PublishWorkflow`) plus cross-cutting infra (secrets encryption, OAuth, recipient resolution, HubSpot/SendGrid sync). Because Workflows replay completed steps and AsyncLocalStorage doesn't survive a step boundary, each step rebuilds its DB connection and tenant context from plain JSON.

**Key files:** `src/workflows/generation.ts` (438 LOC — `loadCampaignContext` → `checkQueueDepth` → `determineCampaignPhase` → `generateContent` → `notifyQueue`); `src/workflows/publish.ts` (493 LOC — `loadDueForPublish` → `checkTokenHealth` → `checkCadence` → `publishDraft` → `updateMetricsEnqueue`; plus `publishSingleDraft`); `src/workflows/types.ts` (`PipelineEnv`, `mirrorEnvToProcess`); `src/services/mailsync.ts` (HubSpot→SendGrid sync, webhook events→HubSpot+metrics, ECDSA verify); `src/services/recipients.ts` (`resolveEmailRecipients`); `src/lib/credentials.ts`; `src/lib/google-oauth.ts`; `src/lib/secrets.ts`; `src/lib/ai.ts`; `src/lib/storage.ts`; `src/lib/tokens.ts`.

**How it works:** **Generation** (cron 0 */6) → `runGenerationTick` scans every tenant (rls_bypass) for campaigns below `QUEUE_TARGET=5` → Workflow or inline. Pipeline builds a topic pool (pillar topics → site content_focus → audience generics), applies `product_launch` phase modifiers, generates per channel, `insertDraft`, then `maybeGenerateImage`. **Publish** (cron */15) → `loadDueForPublish` (`status='approved' AND publish_at<=now()`, LIMIT 50) → `checkTokenHealth` (hard-fail expired via `markFailed`, best-effort refresh stub) → `checkCadence` (per-channel limits, slides `publish_at` forward instead of dropping) → `publishDraft` (resolve adapter, resolve recipients for SendGrid, publish, write `published_ref` + `publish_log`, best-effort image backfill) → `updateMetricsEnqueue` (1h+24h rows). **Manual publish** → `publishSingleDraft` (honors token expiry, skips cadence). **Mailsync** (cron 0 3) → `syncContactsToSendGrid`. **Webhook** → `verifySendGridSignature` → tenant from `?tenant=` → `processSendGridWebhookEvents`.

**Features:** autonomous 6-hourly queue top-up (force fixed `FORCE_BATCH=2` for manual/new-campaign); product-launch phasing (awareness→...→social_proof); topic-pool cascade; 15-min publish tick (cap 50); per-channel cadence (LinkedIn 1/day, blog 1/day, IG+FB 25/day combined, TikTok 20/day, X unlimited, newsletter 1/week/campaign) with publish_at sliding; hard token-expiry gating; send-time recipient resolution (500 cap, `to_list` override); immediate single-draft publish; paired-image gen + post-publish backfill; AES-GCM-256 token encryption; Google OAuth grant+refresh; bidirectional HubSpot↔SendGrid sync; ECDSA webhook verify; R2 with local fallback; token-aware chunking.

**Maturity:** **Shipped/working:** both generation paths, publish with cadence + recipient injection + metrics enqueue, AES-GCM secrets, credential/adapter resolution, full Google OAuth grant+refresh, recipient resolution, HubSpot→SendGrid sync, webhook verify + ingestion. **Intentionally stubbed (V2):** `refreshToken()` in `publish.ts` is a **no-op** (only Google refresh is real, and it's **not wired into `checkTokenHealth`**); HubSpot custom timeline events disabled; `notifyQueue` console-only; drip per-email send deferred. **Dead-ish:** `PHASE_MODIFIERS 'standard'` → `''`; `metrics_queue` 7d/30d enum values defined but only 1h/24h enqueued.

**Risks/gotchas:** **BUG — image generation never runs in production generation:** `generation.ts` gates paired-image gen on `env.IDEOGRAM_API_KEY` only, but `wrangler.toml` sets `IMAGE_PROVIDER='gemini'` (uses `GOOGLE_API_KEY`) → `maybeGenerateImage` never called during generation. Only the publish backfill (which checks `GOOGLE_API_KEY || IDEOGRAM_API_KEY`) produces images, and only for social channels — blog/email headers silently skipped. **Connection leak:** every step calls `makeDb` (new Pool) and never `pool.end()` — many pools per run, relies on isolate GC (Neon connection-exhaustion footgun). **Token-refresh gap:** `checkTokenHealth.refreshToken()` returns false; no working refresh for Buffer/social/Wix; expired tokens hard-fail. **RLS:** fleet-wide branch uses `rls_bypass`; correct only if prod uses NOBYPASSRLS. **Idempotency:** `updateMetricsEnqueue` and `publish_log` insert have no dedup guard — a Workflow step replay after a successful `adapter.publish` could double-publish/double-enqueue (adapter publish isn't idempotent). `publishDraft` casts `as unknown as ContentDraft` (snake_case columns bypassed). Webhook unsigned `?tenant=` + no replay-window check. `mirrorEnvToProcess` writes API keys to shared `process.env` (process-global). `RECIPIENT_SAFETY_CAP=500` silent truncation. `checkCadence` newsletter rule never matches campaign-less email drafts (`campaignId` null). No `SECRETS_KEY` rotation scheme. `storage.ts` Node-fs fallback would throw inside a Worker if R2 binding missing (masks config error).

---

### 5.9 React 19 Dashboard Frontend (Command Center)
**Purpose:** The entire operator UI — five pages (Queue, Calendar, Campaigns, Analytics, Settings) over a thin TanStack-Query data layer talking to the Hono Worker. Core job: the human-in-the-loop content workflow (review/edit/approve/schedule/dismiss/publish drafts + per-draft guardian scores), plus self-serve onboarding and an AI recommendations/intelligence layer.

**Key files:** `dashboard/src/main.tsx` (QueryClient staleTime 30s, retry 1; TenantProvider); `App.tsx` (5 pages under `AppLayout`, **no auth guard**, no code-splitting); `lib/api.ts` (axios + `X-Tenant-ID` from localStorage `hm_tenant_id`); `lib/queries.ts` (619 LOC — ~30 hooks, all keyed by `currentId`, gated `enabled:!!currentId`); `lib/types.ts` (509 LOC — **hand-maintained** mirror of the Worker shapes, not codegen'd); `lib/tenant-context.tsx`; `lib/channels.ts`; `lib/platforms.ts`; `pages/Queue.tsx` (583); `components/DraftCard.tsx` (721); `pages/SettingsPage.tsx` (1578); `pages/Campaigns.tsx` (826); `pages/Analytics.tsx`; `pages/CalendarPage.tsx`; `components/GuardianBreakdown.tsx`; `components/RecommendationsPanel.tsx`; `components/Sidebar.tsx`; `lib/format.ts`.

**How it works:** `TenantProvider` fetches `GET /api/tenants` (no header — backend `rls_bypass` returns ALL tenants), auto-selects `tenants[0]`, persists to localStorage. Every axios call attaches `X-Tenant-ID`. Hooks are keyed by `currentId`, so switching tenant refetches everything. Two async-job patterns: generate/create-now triggers then 60s polling (4s interval) until the draft appears; document upload polls every 2s until `extractionStatus` settles. `DraftCard` drives the state machine: `pending_review` → approve(with publishAt) | edit+rerunGuardian | dismiss; `approved` → reschedule (PATCH `publish_at`, left to cron) or publish-now (POST `/api/publish/:id`). OAuth connect opens a popup, resolves on `postMessage` with origin + source checks.

**Features:** Review Queue (4 status tab-groups, 4 client-side sorts, live stats bar); `DraftCard` for 3 content kinds (social char-counter, blog expand/collapse, email subject/preview/body), inline edit → guardian re-run, approve-with-schedule, dismiss-with-reason, reschedule, always-available publish-now; multi-guardian breakdown UI (5 dimensions, skip/limited-data, blocking banner, setup deep-links); email recipient preview (count+source+capped, approved-only); Recommendations panel; Weekly Intelligence brief; Create-now modal with rec-id close-the-loop; Campaign cards (goal progress, pause/resume, create/edit, per-channel cadence); Content Calendar; Analytics (14-day stacked bar, top-content, GSC keywords, per-channel cards); Settings (Brand Voice, Platforms connect/disconnect, Corpus drag-drop upload, Buffer history import, posting-schedule editor); tenant switcher.

**Maturity:** **Broadly shipped and cohesive — a mature V1, not a prototype.** Polish present: invalidation, skeletons, empty states, toasts, exit animations, tenant-scoped local-state clearing. **Stubbed/coming-soon (intentional, `available:false`):** LinkedIn-native, X-native, Meta, Wix Blog (managed) — render guidance only. Minor dead/loose code: `channels.ts FALLBACK`; a `gbp` channel in Campaigns `NOW_CHANNELS` not in `SELECTABLE_CHANNELS`; a no-op `.filter((c) => c.kind !== 'blog' || true)`. **No tests in this dir. No auth/login gate at all.**

**Risks/gotchas:** `GET /api/tenants` (rls_bypass) returns **every** tenant fleet-wide with no auth → anyone loading the SPA sees and can act as all brands; no authentication anywhere (no token, no login, no 401 handling); **tenant-leak-on-switch** — queries refetch correctly but some component-local state isn't reset (BrandVoiceTab, ScheduleTab, ConnectModal/DomainAuthModal, DraftCard edit buffers seed once → stale tenant-A values if a modal is open during switch); `useDomainAuth` has `enabled:false` + `gcTime:0` and is refetched imperatively (fragile — breaks silently if "cleaned up"); refresh-recommendations `skipped:true` reason never surfaced; **date/timezone inconsistency** — Calendar uses local day keys, Analytics buckets by UTC `toISOString().slice(0,10)` while building the axis with local `getDate()` (posts near midnight land in the wrong column / dropped); schedule times stored as bare `HH:mm` + tz label (cron-vs-operator-tz mismatch); client-side sort only over the current status page; `types.ts` hand-maintained (silent drift); channel-key sprawl (`x` vs `twitter`, `gbp` with no publish path) → can generate drafts on channels that can't publish; OAuth popup origin check silently rejects all messages if `VITE_API_URL` is misconfigured; publish-now always enabled even for blocked-but-approved drafts (only the backend 422 protects); no code-splitting (SettingsPage ~1578 LOC in one bundle).

---

### 5.10 Product Vision, Current State & Ops (PLAN / CURRENT_SITUATION / DEPLOY / README / corpus / git)
**Purpose:** The documentation/ops/state spine. `PLAN.md` is the 58KB master blueprint (vision, locked tech decisions, full DB schema spec, 11-step intelligence loop, V0→V3 roadmap, known-weaknesses-with-mitigations). `CURRENT_SITUATION.md` is the as-built reconciliation. `DEPLOY.md` is the 9-step manual runbook. `README.md` is the stale V0 quickstart. `corpus/` is the per-tenant RAG ground truth that *is* the product per PLAN's V0 success criterion.

**Key files:** `PLAN.md` (568 LOC); `CURRENT_SITUATION.md` (404 LOC, dated 2026-06-04 / commit `c269e5a`); `DEPLOY.md` (176 LOC); `README.md` (72 LOC, V0-era); `corpus/apire/PRODUCT-FACTS-EXTRACTED.md` (the anti-hallucination spine — 5-layer defense, 11-stage pipeline, 27+ threats, Zero-Retention, EU AI Act mapping, NIS2 160k entities); `corpus/apire/` (20+ source docs + 19 curated .md); `corpus/osm/` (20 source .txt incl. Turkish "Bilgi Notu-OSM" + 9 curated .md); `out/apire/_v0-summary.json` (10 blog drafts, guardianScore ~0.98); `Reports/hailmery-v0-complete-report.md`; `wrangler.toml`.

**How it works:** PLAN defines intent; code is built in numbered "Chunks" (0-9) mapped 1:1 to git commits; CURRENT_SITUATION reconciles as-built at a point in time; DEPLOY is the forward path. The runtime loop is the value loop in §1.

**Maturity / docs accuracy (the central finding of this subsystem):**
- **CURRENT_SITUATION.md is rigorous but STALE** — dated 2026-06-04 / commit `c269e5a`, while HEAD is `218112b` (2026-06-16) with **~19 newer commits**; the codebase grew from **9,031 → 14,678 LOC (+62%)** after the doc. Anyone trusting it will **under-credit** the system.
- Several CURRENT_SITUATION "NOT DONE" items are now **DONE** post-cutoff: campaign-create auto-triggers generation (`api.ts:630`), Campaign Edit wired (`218112b`, also fixed a real `audienceBrief` data-loss bug), multi-guardian replaced the single guardian, Google OAuth/GSC token refresh is real, the platform connect wizard is a real backend.
- **README.md is the most stale** (pure V0 — lists social adapters / campaign UI / approval queue / HubSpot / SendGrid as "out of scope," all of which shipped).
- **PLAN.md's own checklist** (lines 388-390) is internally inconsistent (shows Chunk 7 unchecked though merged).
- **The recommendations engine, multi-guardian, and historical Buffer import are undocumented in all four core docs.**

**Verified product maturity:** V0 = shipped (10 blogs + 30 social packs + 2 email sequences committed to git, RLS test passes). V1 generation/queue/publish/analytics/ingest = working. **Still stubbed/thin:** `publish.ts refreshToken()` stub; Buffer/Wix/HubSpot `fetchMetrics()` return `EMPTY_METRICS` (Buffer GraphQL genuinely has no analytics endpoint) → the learning loop's social/blog fuel is thin; Worker-side PDF = 0 chunks. **Unbuilt (V2/V3):** **no production deploy at all**; video gen, Imagen4/FLUX.2, GA4/BigQuery, GTM, paid-ads, native social adapters, strategist agent, `budget.ts`, `queue/transitions.ts`, drift check, and the **LeadOrch cross-schema H3 integration** (shared Neon, `marketing.campaigns.leadorch_run_id → leadorch.runs.id`, shared JWT, run.completed webhook) — all unbuilt.

**Risks/gotchas:** **doc drift is the #1 gotcha** (12 days + 19 commits + 5,600 LOC stale); **not deployed** (the hardcoded prod URL 404s, R2 buckets absent, custom domain unconfigured, prod secrets unseeded); RLS silent-defeat footgun (must use `hailmery_app`); `SECRETS_KEY` must match the seed machine (base64 not old hex); `refreshToken()` stub breaks long-lived non-Google tokens (Meta 60d / LinkedIn 60d / TikTok 24h); **learning-loop fuel is thin** (only SendGrid/GSC/Umami feed real metrics; recommendations notes V0 content is LinkedIn-dominant, weakening channel-rebalance); Gemini billing trap (free tier = 429 → placeholder); Worker-side PDF silent no-grounding; `out/` and large corpus binaries committed to git (repo bloat — a 6.2MB GTM .docx); **corpus quality IS the product** (APIRE rich/curated; OSM has untranslated Turkish source .txt and is barely operated — one sample post; "operate OSM end-to-end" is open V2 item #10); single shared Neon instance is the H3 lynchpin (multi-tenant + multi-schema blast radius on one DB).

---

## 6. End-to-End Feature Catalog

Maturity legend: **Shipped** = built + demonstrably operated (artifacts/tests). **Working** = built and exercised, accuracy/operation unverified. **WIP** = partially built / V2-flagged. **Stub** = placeholder / `available:false` / no-op.

| Feature | Subsystem | Maturity |
|---|---|---|
| Corpus upload → extract → chunk → embed → pgvector (HTTP path) | RAG Ingestion | Shipped |
| Versioned supersede-and-replace re-ingest + partial-success handling | RAG Ingestion | Shipped |
| CLI markdown ingest (`pnpm ingest`) | RAG Ingestion | Working (legacy, divergent) |
| Section-aware chunking | RAG Ingestion | Stub (TODO) |
| Worker-side PDF extraction | RAG Ingestion | Stub (Node-only → 0 chunks) |
| Blog generation (RAG-grounded, YAML frontmatter) | Generation | Shipped (10 APIRE blogs committed) |
| Per-channel social generation (LinkedIn/X/Instagram/TikTok/GBP) | Generation | Shipped (30 packs committed) |
| Email: newsletter / 5-step drip / cold outreach | Generation | Working (drip send V2; outreach not queued) |
| Image generation (Gemini/Ideogram, category classify, APIRE palette) | Generation | Working (never fires in Workflow gen — see §5.8 bug) |
| Prompt caching (static prefix) | Generation | Working (effectiveness unverified) |
| Golden-example learning loop (promote top performers to RAG) | Jobs + Generation | Working (monotonic-growth caveat; thin fuel) |
| 5-validator brand guardian (platform/factual/voice/audience/perf) | Guardians | Shipped (platform-rules) / Working (4 LLM) |
| Performance-prediction guardian | Guardians | WIP (dormant until ≥5 labeled golden) |
| Publish-time blocking gate (`guardian_blocked` 422) | Guardians + API | Shipped (stale-breakdown caveat) |
| Guardian re-check endpoint + UI | Guardians + FE | Shipped |
| Approval queue (review/edit/approve/schedule/dismiss/publish-now) | Dashboard | Shipped |
| Content Calendar (month grid) | Dashboard | Shipped |
| Campaigns CRUD + goal progress + per-channel cadence | Dashboard + API | Shipped |
| Analytics (14-day chart, top-content, GSC keywords, per-channel) | Dashboard + API | Shipped (read-only) |
| AI Recommendations panel (weekly top-5 actions) | Jobs + FE | Working |
| Weekly Intelligence brief (Sonnet + web_search) | Jobs + FE | Working |
| SEO striking-distance detection | Jobs | Working (GSC-gated) |
| Buffer social publishing | Adapters | Shipped (live-verified per comments) |
| Wix Blog publishing (markdown→Ricos) | Adapters | Shipped |
| SendGrid email send (personalizations + UTM + attribution) | Adapters | Shipped |
| SendGrid event webhook → metrics + suppression | Adapters + Services | Shipped |
| HubSpot recipient resolution / contact sync | Adapters + Services | Working (timeline events off) |
| GSC keyword sync + high-performer flagging | Adapters + Jobs | Working |
| Umami pageview ingestion | Adapters + Jobs | Working (slug-substring caveat) |
| Buffer historical import (backfill + golden seeding) | Jobs | Shipped (sync → CPU risk) |
| `fetchMetrics` for Buffer / SendGrid | Adapters | Working |
| `fetchMetrics` for GSC / HubSpot / Umami / Wix | Adapters | Stub (`EMPTY_METRICS` by design) |
| Connections wizard (probe / connect / disconnect) | API + FE | Working (Buffer `quotaState` broken) |
| SendGrid sending-domain self-serve auth | API + FE | Working |
| Google OAuth connect + refresh + GSC sync | API + Libs | Working |
| Token-expiry gating at publish | Workflows | Working |
| Per-platform token refresh (Buffer/Meta/LinkedIn/TikTok) | Workflows | Stub (`refreshToken()` no-op; Google only is real) |
| Per-channel publish cadence enforcement | Workflows | Working |
| Cron-driven autonomous generation + publish | Jobs + Workflows | Working |
| Multi-tenant RLS isolation | Data Layer | Working (inert under `neondb_owner`) |
| Authentication / login | (none) | Stub (does not exist) |
| Native social adapters / Meta / LinkedIn-native | Dashboard | Stub (`available:false`) |
| LeadOrch H3 cross-schema integration | (none) | Unbuilt |
| Production deployment | Ops | Unbuilt (never deployed) |

---

## 7. Data Model Overview

Single Postgres schema `marketing.*`, **18 tables**, every table leads with `tenant_id` (plain `uuid`, **no FK to `marketing.tenants`**), all under FORCE RLS + the uniform `tenant_isolation` policy.

**Identity & config**
- `tenants` — brands (OSM, APIRE). `tenant_id` is a generated column = `id` (so the uniform RLS policy applies to it too).
- `sites` — per-tenant sites (domain, `Europe/Istanbul` tz). `sites_tenant_domain_uq`.
- `site_config` — `brand_voice` (JSON), `general`, `content_focus`; `parent_config_id` (unenforced).
- `pillars` — content pillars / topics (`site_id` unenforced uuid).

**Campaigns & content**
- `campaigns` — type/status/goal/`audience_brief`/`voice_modifier`. (PLAN-spec `leadorch_run_id` cross-schema FK is **unbuilt**.)
- `content_drafts` — the spine. `status` (`pending_review`/`approved`/`scheduled`/`published`/`failed`), `payload` (jsonb), `assets` (jsonb), `channel`, `campaign_id` (FK → campaigns), `publish_at`, `published_ref`, `failed_reason`, `cost_cents`, `guardian_breakdown` (jsonb), `performance_score`, `is_golden_example`. `site_id` is an unenforced uuid.
- `publish_log` — append-only publish records (`draft_id` unenforced).

**RAG corpus**
- `documents` — `source` (`upload`/`git`), `document_type` (incl. `golden_example`), `version`, `r2_key`, `chunk_count`, `extraction_status`. `documents_tenant_filename_uq`.
- `document_chunks` — `embedding vector(1536)`, `chunk_text`, `superseded`, `section_title` (always null today). **FK `document_id → documents.id ON DELETE CASCADE`** (one of only 3 real FKs). HNSW `vector_cosine_ops` index.

**Metrics & learning**
- `metrics_queue` — work queue for nightly metric fetch (1h/24h windows enqueued; 7d/30d enum values defined but unused). **FK `draft_id → content_drafts` with no `ON DELETE`** (deleting a draft with queued rows errors).
- `content_metrics` — per-(tenant, draft, window) metrics. `content_metrics_draft_window_uq` enables upsert.
- `gsc_keywords` — GSC query/page/week rows. `gsc_keywords_row_uq`.
- `intelligence_briefs` — one per (tenant, ISO week). `intelligence_briefs_tenant_week_uq`.
- `recommendations` — weekly action cards (`action_type`, `action_params`, `expires_at`). **Not in PLAN's documented 17 — added later (now 18).**

**Secrets & sync**
- `tenant_secrets` — PK `(tenant_id, platform)`, AES-GCM `encrypted_access_token`/`refresh_token`/`profile_map`, scopes, expiry. **No FK to tenants** (orphan rows possible).
- `sync_log` — mailsync run records.

**Relationship reality:** only **3 enforced FKs** exist (`document_chunks→documents` CASCADE, `content_drafts.campaign_id→campaigns`, `metrics_queue.draft_id→content_drafts`). All `tenant_id` columns and most parent/child links (`site_id`, `pillar_id`, `parent_config_id`, `publish_log.draft_id`, `content_metrics.draft_id`) are unenforced uuids → typos produce silently RLS-hidden rows, and deletes can orphan children.

---

## 8. Known Risks, Bugs & Tech Debt (consolidated, de-duplicated, prioritized)

### P0 — Security & isolation (the dominant cluster)
1. **No authentication anywhere.** `X-Tenant-ID` is trusted verbatim (UUID format only). RLS does NOT protect against a caller choosing another tenant's UUID. `GET /api/tenants` (rls_bypass, no auth) leaks every tenant's id/name/slug/domain fleet-wide. Anyone reaching the SPA/Worker can fully act as any brand. *(All 10 subsystems.)*
2. **RLS is silently inert unless prod `DATABASE_URL` uses `hailmery_app` (NOBYPASSRLS).** Local `.env`/`.dev.vars` use `neondb_owner` (BYPASSRLS) → RLS off in dev. If prod copies the owner string, isolation collapses to per-query predicates alone. **Unconfirmed for prod.** Compounded by the real prior bug `657d906` ("OSM RAG pulling APIRE chunks"). *(Every subsystem.)*
3. **Predicate-less RLS-only queries are the outliers that would leak first** if RLS is off: legacy `brandGuardian` corpus query (factual guardian) and `intelligence.ts` corpus chunk query (lines ~96-103). Every sibling query defends-in-depth; these two don't.
4. **Unsigned webhook tenant (`?tenant=`).** SendGrid signature covers only timestamp+body; a signature replay with a swapped `?tenant=` could attribute/poison metrics + suppress contacts in the wrong tenant. No replay-window check.
5. **Over-broad CORS** (`*.pages.dev`) and an **unauthenticated `/api/assets/:key{.+}` R2 proxy** (security = key unguessability) and **`/api/debug/sync-gsc` shipped to prod.**

### P1 — Correctness bugs
6. **Image generation never runs during Workflow generation** — gated on `IDEOGRAM_API_KEY` while `IMAGE_PROVIDER=gemini`; only social-channel publish backfill produces images; blog/email headers silently skipped.
7. **Guardian overall-score collapse** — legacy `brandGuardian` returns `score:0` on JSON *parse* failure (not a thrown error), passed through as a real score into the unweighted mean → a single parse glitch craters `overall` to ~0.
8. **Stale-breakdown publish gate** — publish trusts the stored `guardian_breakdown` and never re-runs; a `PATCH` edit can desync the blocking state (its `rerunGuardian` path only runs legacy `brandGuardian` and never refreshes the breakdown).
9. **Workflow replay double-effects** — `updateMetricsEnqueue` and `publish_log` insert have no idempotency guard; a retried step after a successful `adapter.publish` could double-publish/double-enqueue.
10. **`refreshToken()` is a stub** — only Google has a real refresh, and it's not wired into `checkTokenHealth`; long-lived non-Google tokens (Meta/LinkedIn 60d, TikTok 24h) silently break publishing on expiry.
11. **Buffer `quotaState` broken** — hits legacy v1 which 401s on the current PAT → connections health card throws.
12. **`getAllSendGridContacts` first-page-only (~50)** despite a 500 cap → SendGrid-only tenants silently send to a partial audience.

### P2 — Reliability & data integrity
13. **`makeDb` Pool-per-call, never closed** (API handlers + every Workflow step) → Neon connection-exhaustion risk.
14. **`metrics_queue` drains destructively** — `fetched=true` set in `finally` even on error → transient outage permanently loses that metric window (no retry).
15. **Learning-loop fuel is thin** — Buffer/Wix/HubSpot `fetchMetrics` are `EMPTY_METRICS`; only SendGrid/GSC/Umami feed real metrics; performance scoring/golden tagging runs largely on sim seeds → the moat is structurally present but starved.
16. **Golden corpus grows monotonically** (asymmetric demotion; retrieval ignores `is_golden_example`) → stale "golden" chunks influence generation forever.
17. **Scoring distortions** — unmeasured published posts get score 0 (not NULL), dragging the picture; Umami double-counts pageviews into engagement → inflates blog scores; golden `performance_score` coerces null→1.0.
18. **Synchronous heavy work in the Worker request** — corpus embedding (large files) and `POST /api/import/buffer-history` and `/refresh` Sonnet+web_search calls all run inline → ~30s CPU-limit risk + cost-amplification (no rate limit; `tenant_usage` unwritten).
19. **Almost no referential integrity** — only 3 FKs; `tenant_id` columns have no FK to `tenants`; deletes orphan metrics/publish_log; `metrics_queue` FK has no `ON DELETE`.
20. **Channel-key sprawl / unknown channels fail open** — `x` vs `twitter` vs `gbp` vs `wix-blog`; `CHANNEL_RULES` misses → zero platform gating; three divergent `CHANNEL_NORM` maps can mis-bucket between analytics and recommendations views; drafts can be generated on channels with no publish path.

### P3 — Maintainability & docs
21. **Documentation drift is the #1 onboarding gotcha** — CURRENT_SITUATION.md is ~19 commits / +62% LOC stale and *undersells* the system; README.md is pure V0; PLAN.md's checklist is internally inconsistent; recommendations/multi-guardian/Buffer-import are undocumented.
22. **`blog.ts` diverges from `context.ts`** — duplicated RAG logic, different golden ordering, no `voiceModifier`, no inline multi-guardian; CLI `sync.ts` diverges from the HTTP ingest path (no `chunk_count`/`extraction_status`, skips the embedding guard).
23. **Hardcoded environment couplings** — APIRE tenant UUID `6daebc34-...` in `image.ts`; `PROXY_BASE` worker URL; `schema.ts`/`rls.sql` 3-location enum coordination; `types.ts` hand-maintained FE mirror (silent drift); no `SECRETS_KEY` rotation scheme.
24. **No production deployment** + R2 buckets uncreated + committed `out/`/large corpus binaries (repo bloat); FE timezone inconsistencies (UTC vs local bucketing); no FE auth/401 handling; no code-splitting; no tests in the dashboard dir.

---

## 9. Open Questions for Yigit (the code can't answer these)

These recur across nearly every subsystem and are genuinely unresolvable from code:

1. **Is production `DATABASE_URL` set to the `hailmery_app` (NOBYPASSRLS) role, with its Neon password configured?** The entire RLS backstop — and the safety of the two predicate-less corpus queries — hinges on this. Local env files use `neondb_owner`. CURRENT_SITUATION lists it as the top remaining deploy task; not confirmed done.
2. **Is anything fronting the Worker with real auth** (Cloudflare Access / Zero Trust / WAF / IP allowlist / reverse proxy)? If not, the only access control is the secrecy of the Worker URL and tenant UUIDs, and the fleet-wide `/api/tenants` list is a real exposure.
3. **Has the system actually been deployed to production since HEAD `218112b`?** No deploy traces exist in git; `.wrangler/state` is a local simulation; the hardcoded prod URL 404s; R2 buckets don't exist. (If yes, when, and with which secrets/role?)
4. **Did Baran actually retire Kleo and start operating hailmery daily on APIRE** (the H2 success criterion)? Commit `9f5a0e4` mentions a "pre-Baran test suite," implying a handoff was being prepped.
5. **Is OSM meant to stay corpus-only, or be operated end-to-end** (open V2 item #10)? Are the untranslated Turkish OSM source `.txt` files meant to drive **Turkish-language generation**, or are they reference-only?
6. **Which image provider is actually configured in prod** (`GOOGLE_API_KEY` vs `IDEOGRAM_API_KEY`), and is the §5.8 gating bug (images silently never generated in the Workflow path) acceptable or a defect to fix? Is `R2_PUBLIC_BASE_URL` set, or are thumbnails relying on the hardcoded proxy URL?
7. **Has the prompt cache been observed actually hitting** (`cache_read_input_tokens > 0`)? Only the static prefix is cached; realized savings are likely far below the claimed ~90%.
8. **Is there any pipeline that actually sets `is_golden_example=true` and `performance_score` from real analytics?** Without real metrics fuel (Buffer/Wix/HubSpot `fetchMetrics` are no-ops), performance-prediction is permanently dormant and the learning loop is starved.
9. **Are the `?tenant=` webhook trust, the SendGrid ~50-contact ceiling, the `refreshToken()` stub, and the monotonic golden-corpus growth all "acceptable for two trusted tenants,"** or now in scope to fix?
10. **Intended cadence ordering** — the Mon-08:00 intelligence brief is written *after* the Mon-03:00 recommendations of the same day have already read the *prior* week's brief. Is recommendations meant to trail the brief by ~a week, or should intelligence run first?
11. **Is the LeadOrch H3 integration** (shared Neon, cross-schema FK `marketing.campaigns.leadorch_run_id → leadorch.runs.id`, shared JWT) actively next, and is shared-Neon still the intended path given the multi-tenant + multi-schema blast radius on one DB?
12. **Should CURRENT_SITUATION.md / README.md be regenerated** to reflect the multi-guardian, recommendations, Google OAuth, connect-wizard, and Buffer-import work that all post-date the docs — i.e., were these V1 scope-creep or deliberate V1.5?

---

*End of report. Generated from structured subsystem analyses at git HEAD `218112b`.*
