# Hailmery — Current Situation (as-built handoff)

> ### 🔄 STATUS UPDATE — 2026-06-30 (HEAD `17d62fd`, session 15)
> The body below is the exhaustive **2026-06-23 / `218112b`** handoff and is still accurate for
> architecture. Three things have changed since, and **`CLAUDE.md` is now the canonical fast-ramp doc**:
> - **JWT auth is LIVE (session 14).** Google-login → HS256 session JWT → `authMiddleware` gates every
>   `/api/*` route and enforces `X-Tenant-ID ∈ allowedTenants` (403 otherwise). **The "there is no
>   authentication anywhere" warning below is OBSOLETE.** The remaining isolation caveat is RLS only:
>   it is enforced only if prod `DATABASE_URL` uses the `hailmery_app` (NOBYPASSRLS) role — so keep an
>   explicit `tenant_id` predicate on every query.
> - **Frontend redesign shipped (session 14)** — master-detail Queue, responsive sidebar/drawer,
>   cyan→purple brand.
> - **Blog management page shipped (session 15)** — `GET /api/blog/posts` + `/blog` dashboard page
>   tagging every Wix post hailmery vs pre-existing (5 hailmery / 104 pre-existing on apire.io). The API
>   is now **40 routes**. Two early "published-but-never-on-Wix" drafts were reverted to `pending_review`.
>
> **Purpose of this doc.** A fresh-session handoff. It captures, as of **2026-06-23 / git HEAD
> `218112b`**, exactly what hailmery is, what has been built across **13 sessions**, what is real
> vs. stubbed, what is deployed vs. deploy-ready, and what remains. It is deliberately exhaustive —
> read this first before touching code. Source of intent is `PLAN.md` (the 58 KB blueprint); this
> doc is the *as-built* reconciliation. For a line-level deep dive, see
> `Reports/ARCHITECTURE-ANALYSIS-218112b.md`. For a 30-second snapshot, see
> `Reports/CURRENT-STATE-2026-06-23.md`.
>
> **TL;DR.** V0 (content-quality proof) and V1 (publishing surface + integrations) are **done**, and
> the project has continued ~7 sessions *past* V1 into what is effectively a **V1.5/early-V2**: a
> 5-validator brand guardian, a recommendations engine, Google OAuth + GSC, a real platform-connect
> wizard, send-time email recipient resolution, and historical-Buffer import are all built and wired.
> The backend Worker **is deployed and live** (`hailmery-api.bezekyigit0.workers.dev` serves real
> tenant data). **As of session 14 (see banner above), JWT auth is LIVE — every `/api/*` route now
> requires a Google-login Bearer token and rejects an `X-Tenant-ID` outside the caller's
> `allowedTenants` (403); the unauthenticated tenant-fleet leak is closed. The one remaining isolation
> caveat: the Postgres RLS backstop is silently inert unless prod uses the `hailmery_app`
> (NOBYPASSRLS) role (unconfirmed), so every query keeps an explicit `tenant_id` predicate.** The
> system is far past prototype; the open work is confirming the prod RLS role, real OAuth refresh, a
> handful of real correctness bugs, and operating OSM end-to-end — not core features.

---

## 1. What hailmery is

A **multi-tenant AI marketing command center** — not "two scripts for OSM and APIRE." It ingests a
company's documents, connects their marketing tools, reads unified data, plans campaigns, generates +
publishes content with human approval, and learns from performance. **APIRE** (`apire.io`, an EU
AI-API-security / governance proxy) and **OSM** (`ofsecman.io`, an offensive-security / AISecOps
platform) are tenants #1 and #2 — the proving ground. The destination is a public SaaS and the
content-side closing loop for **LeadOrch** (`leadorch.io`, the developer's existing B2B lead-gen SaaS
on the same Cloudflare stack).

It exists to replace the prior Wix Studio "Kleo" agent, whose dominant failure was hallucinating
product/feature names (APIRE's "W-004"). Hailmery's answer is to **ground every artifact in the
tenant's own RAG corpus** and **gate it through a multi-validator guardian** before a human ever sees
it.

**Six capabilities (the product spine): Ingest → Connect → Read/Understand → Plan → Execute → Learn.**
The moat is the closed learning loop + cross-tool reasoning (the "Zoho principle": the AI is the
integrator, not the user).

**Three horizons:** H1 internship demo (prove APIRE content beats Kleo) → H2 standalone tool (OSM +
APIRE fully operated, Kleo retired) → H3 LeadOrch integration + public Stripe-billed SaaS.

**The core value loop, concretely:**
corpus (ingest docs → embed into pgvector) → **generate** (RAG-grounded Sonnet 4.6) → **guard**
(5 parallel validators) → **approve** (human queue) → **publish** (Buffer / Wix / SendGrid via cron
workflows with cadence enforcement) → **measure** (nightly metrics + Buffer history import) →
**recommend** (weekly Sonnet recommendations + web-search briefs; promote top performers to "golden
example" RAG chunks that bias future generation).

---

## 2. Where we are — roadmap + 13-session timeline

| Phase | Status | Evidence |
|---|---|---|
| **V0** — prove content quality, no OAuth | ✅ **Complete** | `Reports/hailmery-v0-complete-report.md`; 10 blogs + 30 social in `out/apire/`; RLS verified; commit `9242ed9` |
| **V1** — publishing surface + integrations | ✅ **Complete** | Chunks 0–9 all merged; the Worker is deployed live (§10) |
| **V1.5 / early V2** — guardian, recommendations, OAuth, connect wizard, email resolution | ✅ **Built (sessions 8–13)** | See timeline below — all post-date the old docs |
| **V2** — native social + deeper intelligence | 🟡 Partially started (history import + recommendations landed early; native adapters not) | PLAN.md §V2 |
| **V3** — LeadOrch integration + public SaaS | ⛔ Not started | PLAN.md §V3 |

### Session-by-session build history (maps to git)

| # | Date | Title | Commits | What shipped |
|---|---|---|---|---|
| 1 | 05-18→20 | Planning & V0 scaffold | `bed02e3` `88d8af6` `a89062d` | Multi-tenant Neon schema + RLS, Hono Worker, Drizzle, pgvector, markdown ingest (512/64 chunks), RAG blog gen, brand guardian |
| 2 | 05-21 | V0 complete | `9242ed9` | 18 APIRE corpus docs ingested; **10 blogs + 30 social** generated; RLS verified end-to-end |
| 3 | 05-27 | Six platform adapters | `8f93a01` | `ChannelAdapter` interface + Buffer/Wix-Blog/HubSpot/SendGrid/GSC/Umami + adapter test suite |
| 4 | 05-28 | Mail sync service | `030a7a6` | Bidirectional HubSpot↔SendGrid sync + ECDSA-verified webhook + `sync_log` |
| 5 | 05-31 | Approval queue + generation expansion | `c30a2f9` `dde0e0d` `7d5078a` `1825bb5` `698868f` | React dashboard (Queue/Calendar/Campaigns/Settings); social (5 ch) + email (3 types) + image gen; generation/publish Workflows + cron; Buffer GraphQL migration |
| 6 | 06-03 | Chunks 7–9: analytics, doc upload, deploy prep | `7d8e403` `10e2fe2` `7692b61` `657d906` `64a04ea` (+12) | Nightly metrics + performance scoring + golden-example loop; document upload pipeline (R2 + extract + chunk + embed + reingest + delete); Gemini 3 Pro image + 3-category visual system; weekly intelligence brief; OSM corpus; deploy prep (wrangler, `hailmery_app` role, DEPLOY.md); **RLS cross-tenant bug fix** |
| 7 | 06-04→09 | V1 stabilization | `c269e5a` `dcde649` `f4dbb82` `478cad1` `30b6b40` | Wix Blog wired (Draft Posts + Ricos); SendGrid webhook `?tenant=` + dedup; R2 binding fix; dashboard polish; email draft payload fix |
| 8 | 06-11 | Real analytics foundation | `f92f5bd` `abfe0e7` `d68c401` `9f5a0e4` | **Purged 26 sim metric rows** (kept real SendGrid data); APIRE palette fix (`#7c3aed`/`#000000`); **markdown→Ricos** converter; Buffer image attach via R2 proxy; pre-Baran test suite |
| 9 | 06-12 | Historical import + recommendations | `f0d27e1` `134e0a7` `523c915` | **Buffer history import** (real LinkedIn back-catalogue → measured drafts → golden seeding); **recommendations engine** (5 weekly action cards) |
| 10 | 06-13 | Connect wizard + Google OAuth + GSC | `5c94cac` `3146cd5` | Platform-connect wizard (live probes, API-key flows, SendGrid domain auth); **Google OAuth** (HMAC state, AES-GCM storage) + **GSC** keyword sync + token refresh + SEO recommendations |
| 11 | 06-15 | Platform guidance + email recipients | `288613a` `b82bc2a` `c46e324` | Per-platform connect guidance; HubSpot $3k amber warning; **send-time email recipient resolution** (HubSpot→SendGrid fallback, 500 cap, preview endpoint) |
| 12 | 06-16 | Multi-guardian system | `d6b6178` | Single guardian → **5 specialized validators** with graceful degradation; breakdown in `content_drafts.guardian_breakdown`; `GuardianBreakdown` UI |
| 13 | 06-16 | Campaign edit + auto-trigger + publish guard | `26cda7f` `218112b` | Campaign **Edit** UI + `PATCH /api/campaigns/:id` (fixes an `audienceBrief` data-loss bug); **campaign-create auto-triggers first-batch generation**; double-publish guard (`already_published` 422; status-gated publish) |

> **Scale:** ~**14,678 LOC** of backend (`src/`) + ~**7,545 LOC** dashboard (`dashboard/src/`). The
> prior CURRENT_SITUATION (2026-06-04, commit `c269e5a`) measured 9,031 backend LOC and 17 tables —
> the system has grown ~62% and added the `recommendations` table (now **18**) since.

---

## 3. Tech stack & runtime

- **Backend:** Cloudflare Workers + **Hono** (TypeScript), `nodejs_compat`, `compatibility_date = 2026-05-01`. Entry `src/index.ts`. Worker name `hailmery-api`.
- **Long-running pipelines:** **Cloudflare Workflows** — `GenerationWorkflow` + `PublishWorkflow` (durable `step.do()` steps). Both have an **inline fallback path** (via `c.executionCtx.waitUntil`) so they run identically when no Workflow binding exists.
- **Cron:** **4 triggers** (`*/15`, `0 */6`, `0 3`, `0 8 * * 1`) routed by cron-string in `scheduled()`.
- **Storage:** **R2** (`hailmery-assets` + `hailmery-assets-preview`) for uploaded corpus docs and generated images. Local-disk fallback (`out/uploads/`, `out/_assets/`) when no binding.
- **DB:** **Neon Postgres + Drizzle ORM**, single `marketing.*` schema, **pgvector** (1536-dim, HNSW cosine), RLS on every table.
- **Frontend:** **React 19 + Vite + Tailwind v4 + hand-rolled UI kit + TanStack Query + Recharts + react-router v7**, on Cloudflare Pages. Lives in `dashboard/`.
- **AI models (`src/lib/ai.ts`):**
  - Text: **Claude Sonnet 4.6** (`claude-sonnet-4-6`) — generation, image-prompt builder, recommendations, intelligence brief.
  - Guardian/classification: **Claude Haiku 4.5** (`claude-haiku-4-5-20251001`).
  - Embeddings: **OpenAI `text-embedding-3-small`** (1536-dim).
  - Images: **Gemini 3 Pro Image** primary (`gemini-3-pro-image`), Gemini 2.5 Flash fast tier, **Ideogram 3.0** fallback. (Imagen 4 / FLUX.2 / video = planned, not implemented.)
  - Web research: Anthropic server-side `web_search_20250305` tool.
- **Secrets:** AES-256-GCM (`SECRETS_KEY`, base64 32-byte). Per-tenant platform credentials encrypted into `marketing.tenant_secrets`. Google OAuth state is HMAC-SHA256 (reuses `SECRETS_KEY`). SendGrid webhook = ECDSA P-256.

Everything intentionally **mirrors LeadOrch's stack** so H3 integration is "free" (shared Neon, shared design tokens, shared auth model).

---

## 4. Repository map

```
hailmery/
├── PLAN.md                  ← 58KB master blueprint (vision, stack, roadmap, traps). Source of intent.
├── CURRENT_SITUATION.md     ← (this file) as-built reconciliation
├── DEPLOY.md                ← 9-step manual Cloudflare deploy runbook
├── README.md                ← operator quickstart (now V1-current)
├── Reports/
│   ├── ARCHITECTURE-ANALYSIS-218112b.md  ← line-level deep technical reference
│   ├── CURRENT-STATE-2026-06-23.md       ← 30-second executive summary
│   └── hailmery-v0-complete-report.md    ← V0 deliverable report
├── wrangler.toml            ← crons, 2 Workflows, R2 bucket, IMAGE_PROVIDER=gemini
├── drizzle.config.ts        ← drizzle-kit → marketing schema only
├── package.json             ← scripts: dev/deploy/db:*/ingest/gen/test/test:rls/test:wix
│
├── src/                     ← Worker source (~14,678 LOC)
│   ├── index.ts             ← fetch() + scheduled() router; exports the 2 Workflow classes; V0 HTML; SendGrid webhook
│   ├── routes/
│   │   ├── api.ts           ← 2,595 LOC — the entire dashboard REST API (37 routes)
│   │   └── settings.ts      ← V0 server-rendered /settings/brand-voice form
│   ├── db/
│   │   ├── schema.ts        ← Drizzle schema, 18 tables, all tenant-scoped
│   │   ├── rls.sql          ← RLS policies + hailmery_app role + HNSW index + additive migrations
│   │   ├── migrate.ts / seed.ts / client.ts
│   ├── generation/          ← blog.ts, social.ts, email.ts, image.ts (~856 LOC), context.ts
│   ├── corpus/              ← extract.ts, chunker.ts, embedder.ts, ingest.ts, sync.ts
│   ├── agents/
│   │   ├── guardian.ts      ← LEGACY single Haiku fact-check (still wired in the PATCH-edit path)
│   │   └── guardians/       ← index, context, types, llm, platform-rules, factual, brand-voice, audience-fit, performance-prediction
│   ├── adapters/            ← index + buffer, wix-blog, hubspot, sendgrid, gsc, umami
│   ├── services/            ← mailsync.ts (HubSpot↔SendGrid), recipients.ts (send-time resolution)
│   ├── jobs/                ← scheduler.ts, metrics.ts (~612 LOC), recommendations.ts (~967), intelligence.ts (~286), import-buffer.ts (~373)
│   ├── workflows/           ← generation.ts, publish.ts, types.ts
│   ├── lib/                 ← ai, tenant (RLS), secrets (AES-GCM), credentials, google-oauth, storage (R2), tokens
│   └── cli/                 ← gen.ts, ingest.ts
│
├── dashboard/               ← React SPA (Cloudflare Pages, ~7,545 LOC)
│   ├── src/pages/           ← Queue, CalendarPage, Campaigns, Analytics, SettingsPage
│   ├── src/components/      ← AppLayout, Sidebar, DraftCard, GuardianBadge, GuardianBreakdown, RecommendationsPanel, ChannelIcon, ui/*
│   ├── src/lib/             ← api (axios), queries (TanStack), types, channels, platforms, format, tenant-context, utils
│   └── .env.production      ← VITE_API_URL=https://hailmery-api.bezekyigit0.workers.dev  (LIVE)
│
├── corpus/
│   ├── apire/               ← 18 curated .md + 20 source docs + PRODUCT-FACTS-EXTRACTED.md
│   └── osm/                 ← 9 curated .md + 20 source .txt (incl. untranslated Turkish "Bilgi Notu")
├── out/                     ← generated artifacts (COMMITTED — apire ~79 files: blogs, guardian json, social, images)
├── scripts/                 ← seed-tenant-secrets, set-production-secrets.sh, sim-metrics, cleanup-sim-metrics, import-buffer-history, seed-drafts, restore-buffer-profile-map, wix-ricos validators, preview-ideogram-prompt, verify-connections, …
└── tests/                   ← rls.test.ts + adapters/*.test.ts (6) + services/{mailsync,recipients}.test.ts + wix-blog-prototype.ts
```

---

## 5. Multi-tenancy, RLS & the authentication gap

Hailmery serves two brands from one DB and one Worker. Isolation is layered — but **only the first
layer actually fires today**, and **there is no authentication in front of any of it.**

### 5.1 Layer 1 — explicit `tenant_id` predicates (the real isolation today)
Every tenant-scoped query carries `WHERE tenant_id = ${id}`, run inside `withTenantDb(db, id, fn)`
(`src/lib/tenant.ts`) — one chokepoint that opens a tx and runs `set_config('app.tenant_id', id,
true)`. This predicate-based defense is what actually isolates tenants in the current config.
> **Historical proof this matters (commit `657d906`): "OSM RAG was pulling APIRE chunks."** A forgotten
> predicate is a real cross-tenant leak vector, not theoretical.

### 5.2 Layer 2 — Postgres RLS (the intended backstop, currently inert)
`src/db/rls.sql` `FORCE`s RLS on every `marketing.*` table with a uniform policy:
`NULLIF(current_setting('app.tenant_id', true), '')::uuid = tenant_id OR current_setting('app.rls_bypass', true) = 'true'`. Fail-closed (unset tenant → 0 rows, proven by `tests/rls.test.ts`).
- **The BYPASSRLS wrinkle (dominant DB caveat):** RLS only bites when the connection role lacks `BYPASSRLS`. Neon's default `neondb_owner` **has** it. `rls.sql` therefore creates a dedicated `hailmery_app` (NOBYPASSRLS) role and documents that **prod must use it**. But local `.env`/`.dev.vars` use `neondb_owner`, so **RLS is a silent no-op in dev**, and if prod ever copies the owner string, isolation collapses to Layer 1 alone. **Whether prod uses `hailmery_app` is unconfirmed (§13).**
- **Two predicate-less corpus queries** rely on RLS *alone* (no explicit `tenant_id`): the legacy `brandGuardian` factual query (`src/agents/guardian.ts`) and the intelligence corpus query (`src/jobs/intelligence.ts`). Under a BYPASSRLS role these would fact-check / summarize against **all tenants' corpora**. Every sibling query defends-in-depth; these two don't.

### 5.3 Layer 3 — there is NO authentication (the dominant gap, now live in prod)
- The API has **no auth layer** — no session, JWT, API key, or allowlist. `tenantOf()` trusts the client-supplied `X-Tenant-ID`, validated for **UUID format only** (`assertUuid`), never checked for existence or ownership.
- **RLS does NOT help here** — it keys off the *same* header value. An attacker who knows a tenant UUID gets full read+mutate access plus the ability to trigger generation/publish and connect/disconnect platforms.
- **Tenant UUIDs are public.** `GET /api/tenants` runs with `rls_bypass` and returns **every** tenant fleet-wide (id, name, slug, site, domain) with no auth. **This is confirmed live in production** — a plain unauthenticated request to the deployed Worker returns both APIRE and OSM with their UUIDs. The only "protection" today is secrecy of the Worker URL.
- Additional gotchas: CORS allows any `*.pages.dev` origin; the public `GET /api/assets/:key{.+}` R2 proxy relies on key unguessability; `POST /api/debug/sync-gsc` is shipped to prod; the SendGrid webhook resolves tenant from an **unsigned** `?tenant=` query param.

### 5.4 Secrets
Per-tenant tokens in `marketing.tenant_secrets` (PK `(tenant_id, platform)`), AES-GCM-256 via
`src/lib/secrets.ts`. `SECRETS_KEY` must match exactly between the Worker secret and the machine that
ran `seed-tenant-secrets.mjs` (base64, 32 bytes — **not** the old hex value) or all decryption fails.
**No key-rotation scheme.** Google OAuth is the only real token-refresh path (`refreshGoogleAccessToken`).

---

## 6. Backend — API, cron, workflows, jobs

### 6.1 HTTP API (`src/routes/api.ts`, 37 routes) — essentially all real
- **Tenants/config:** `GET /api/tenants` (rls_bypass, **no auth**); `GET/PATCH /api/sites/:id/config`.
- **Drafts:** `GET /api/drafts` (status/campaign/month filters); `PATCH /api/drafts/:id` (edit/approve/schedule/dismiss; `rerunGuardian` re-runs **only the legacy single guardian**); `POST /api/drafts/:id/recheck` (re-runs the **full 5-validator** suite and refreshes `guardian_breakdown`); `GET /api/drafts/:id/preview` (email recipient preview).
- **Campaigns:** `GET /api/campaigns` (with pending/approved/published counts); `POST /api/campaigns` (**auto-triggers first-batch generation** in background via `waitUntil`, `forceBatch=3` for product_launch else `2`; a gen failure never blocks create; returns `generationTriggered:true`); `PATCH /api/campaigns/:id` (full edit — name/type/status/audienceBrief/voiceModifier/goal/channelConfig).
- **Documents:** `GET /api/documents(/:id)`, `POST /api/documents/upload` (validate → R2 → extract → chunk 512/64 → embed → upsert), `POST /api/documents/:id/reingest`, `DELETE /api/documents/:id`.
- **Connections:** `GET /api/connections` (per-platform **live probe** + status); `POST /api/connections/:platform/{connect,disconnect}` (API-key flows w/ validation); `GET /api/connections/sendgrid/domain-auth` (self-serve domain auth); Google OAuth `GET /api/auth/google/{start,callback}`; `POST /api/debug/sync-gsc`.
- **Generation/publish:** `POST /api/generate`, `POST /api/generate-now`, `POST /api/publish/:draftId` (status-gated; refuses `already_published` 422; refuses `guardian_blocked` 422 from the **stored** breakdown).
- **Intelligence/recs/analytics:** `GET /api/intelligence(+/refresh)`; `GET /api/recommendations(+/refresh, /:id)`; `GET /api/analytics/{summary,top-content,keywords}`; `GET /api/queue-status`; `POST /api/import/buffer-history`.

### 6.2 Cron (`src/jobs/scheduler.ts`) — all real
| Cron | Tick | What it does |
|---|---|---|
| `*/15 * * * *` | publish | Approved drafts with `publish_at ≤ now` (≤50), token-health check, cadence limits, publish via adapters, write `publish_log`, enqueue 1h/24h metrics |
| `0 */6 * * *` | generation | Per tenant → per campaign → top up to `QUEUE_TARGET=5`/channel via Workflow/inline |
| `0 3 * * *` | nightly | `runMailSync` → `runNightlyMetrics` (5 steps) → **`runRecommendationsTick`**, in strict order so recs read fresh scores |
| `0 8 * * 1` | intelligence | Mon 08:00 weekly brief per tenant (Sonnet 4.6 + web_search) |

### 6.3 Workflows
- **GenerationWorkflow:** `loadCampaignContext → checkQueueDepth → determineCampaignPhase → generateContent → notifyQueue`. `isForced()` treats `campaign_created` as a forced fixed-batch trigger. `product_launch` phasing appends voice modifiers. ⚠️ **Image gen is gated on `env.IDEOGRAM_API_KEY`** (see §7.2 bug).
- **PublishWorkflow:** `loadDueForPublish → checkTokenHealth → checkCadence → publishDraft → updateMetricsEnqueue`. **Cadence:** LinkedIn 1/day, blog 1/day, IG+FB 25/day combined, TikTok 20/day, X unlimited, newsletter 1/week/campaign — over-limit drafts **slide `publish_at` forward**. For email, `resolveEmailRecipients` materializes `to_list` at send time. ⚠️ **`refreshToken()` is a no-op stub** (see §7.5).

### 6.4 Jobs
- **`metrics.ts` (`runNightlyMetrics`, 5 isolated steps):** `processMetricsQueue` (drain → `adapter.fetchMetrics` → upsert only if non-zero); `syncGscKeywords` (GSC API, flag >3× avg); `syncUmamiPageviews` (per blog by slug); `scorePerformance` (`clicks*3 + engagement*2 + impressions` / per-channel median); `tagGoldenExamples` (top decile, score>1.0 → `is_golden_example`, embed winner as a `golden_example` chunk). **The closed learning loop.** ⚠️ Golden corpus grows monotonically (no demotion prune — `promoteGoldenExample` only INSERTs).
- **`recommendations.ts`:** nightly Sonnet job; `gatherData` (~7 tenant-scoped queries) → skip if `<5` scored posts → Sonnet → ≤5 ranked weekly action cards (content_gap / channel_rebalance / trending_opportunity / queue_health / engagement_followup / **seo_opportunity**) into `recommendations`; `action_type`/`action_params` wire to the dashboard "Generate now" modal. `seo_opportunity` only fires with GSC connected.
- **`intelligence.ts`:** Sonnet 4.6 + `web_search_20250305`; RAG summary → research last 7 days → 5–7 topics → upsert one brief per (tenant, ISO week).
- **`import-buffer.ts`:** historical Buffer import (triple-dedup) — imports already-published LinkedIn posts as **measured** drafts, scores the back-catalogue, promotes top performers to golden examples.

---

## 7. Generation, RAG, guardians & integrations

### 7.1 Generation pipeline
- **RAG:** topic embedded via `text-embedding-3-small`, pgvector cosine (`<=>`) top-k=8 corpus chunks + top-3 `golden_example` chunks, **explicit tenant filter**, `superseded=false`.
- **Prompts:** static brand-voice/rules block is **prompt-cached (ephemeral)**; corpus + golden blocks follow. Model: Sonnet 4.6.
- **Blog** → YAML frontmatter + markdown; **Social** → per-channel specs (LinkedIn/X/Instagram/TikTok/GBP); **Email** → newsletter / 5-step drip (offsets `[0,3,7,14,21]`) / outreach (not queued). All run the guardian suite and insert `content_drafts` as `pending_review`.
> ⚠️ **`blog.ts` is older/divergent** — it duplicates RAG logic, orders golden by `created_at DESC` (not vector distance), has no `voiceModifier`, and does **not** run the inline multi-guardian. New work should follow `context.ts`/`social.ts`, not `blog.ts`.

### 7.2 Image generation (`image.ts`, ~856 LOC)
Sonnet classifies the draft into 3 visual categories → pulls visual-identity corpus → writes a
cinematic prompt → validates (no-text guard, denylist, ≥1 tenant hex) → regenerates once → Gemini
(default) or Ideogram (fallback) → R2/local → `assets` row → patches `content_drafts.assets`. APIRE
palette is hardcoded (`#000000` + `#7c3aed` + `#06b6d4`). Missing key ⇒ graceful placeholder.
> 🔴 **BUG — images never generate in the generation Workflow.** `src/workflows/generation.ts` gates
> paired-image gen on `env.IDEOGRAM_API_KEY`, but `wrangler.toml` sets `IMAGE_PROVIDER=gemini` (uses
> `GOOGLE_API_KEY`). So `maybeGenerateImage` is never called during generation. Images only appear via
> the **publish-time backfill**, which checks `GOOGLE_API_KEY || IDEOGRAM_API_KEY` but only for
> `['linkedin','instagram','x']` — **blog and email headers get no image.** (Gemini billing is now
> enabled, so the *provider* works in isolation — it's just unreachable from the Workflow path.)

### 7.3 Corpus / RAG ingestion
- Chunking 512/64 (cl100k_base). Embedding 1536-dim, batched 100/call, with a NaN/dim integrity guard (HTTP path).
- **Extraction:** md/txt and **docx** (native ZIP + `DecompressionStream`, mammoth fallback) work in the Worker; **PDF (`pdf-parse`) is Node-only → 0 chunks + `extraction_status='failed'` in the Worker.**
- Versioning: re-ingest bumps `documents.version`, supersedes old chunks, inserts fresh. Idempotent. The CLI `sync.ts` path diverges (no `chunk_count`/`extraction_status`, skips the embedding guard) — legacy.

### 7.4 Brand guardian — 5 validators (`src/agents/guardians/`)
`runAllGuardians` resolves context once (`withTenantDb`: campaign, `site_config`, brand/persona
chunks, golden examples), then:
1. **`platform_rules`** — synchronous, deterministic, zero-LLM, **the only blocking gate** (char limits, hashtag caps, LinkedIn CTA, TikTok HOOK/SCRIPT/CTA, email subject + CAN-SPAM/GDPR unsubscribe). Sets `passed`/`blocking`.
2. **`factual`** (delegates to legacy `brandGuardian` corpus check), **`brand_voice`**, **`audience_fit`**, **`performance_prediction`** — 4 Haiku validators, **advisory**, run concurrently under `Promise.allSettled` with graceful degradation (a failing/contextless validator skips, not zeros). `overall` = unweighted mean of non-skipped advisory scores. Stored in `content_drafts.guardian_breakdown`; surfaced in the `GuardianBreakdown` UI.
> ⚠️ Two real footguns here:
> - **Stale-breakdown publish gate:** publish reads the **stored** breakdown and refuses if `blocking` — it never re-runs. A `PATCH` edit's `rerunGuardian` path runs **only the legacy single `brandGuardian`** and does **not** refresh `guardian_breakdown`. To clear a stale block you must call `POST /api/drafts/:id/recheck` ("Re-check" in the UI). The legacy `brandGuardian` still lives and is still wired into the edit path — the multi-guardian did *not* replace it everywhere.
> - **Score collapse:** legacy `brandGuardian` returns `score:0` on JSON *parse* failure (not a thrown error); `factual` passes that 0 through, so a single parse glitch can crater `overall`.
> - Performance-prediction is effectively **dormant** until a tenant has ≥5 labeled channel golden examples. Blog generation bypasses the multi-validator (legacy guardian only).

### 7.5 Platform adapters (`src/adapters/`) — 6 built
All implement `ChannelAdapter { publish, fetchMetrics, quotaState }`.

| Adapter | Publish | fetchMetrics | Notes |
|---|---|---|---|
| **buffer** | ✅ GraphQL `createPost` (LI/X/IG/FB/TikTok/Pin/GBP), profileId map, image attach | ✅ **real but cumulative-only** (`Query.post.metrics`; no windowed breakdown) | Historical import via undocumented introspected query. Legacy-v1 `quotaState` is broken (401s). |
| **wix-blog** | ✅ markdown→**Ricos** (headings/bold/italic/links/dividers/lists/code) + Media Manager images | ⛔ `EMPTY_METRICS` | The most logic-heavy adapter. Raw API-key auth. |
| **sendgrid** | ✅ `mail/send` (personalizations + UTM + custom_args) | ✅ **real** (opens/clicks per message) | Webhook (ECDSA) → metrics + suppression. ⚠️ `getAllSendGridContacts` is first-page-only (~50). |
| **hubspot** | n/a (CRM) | ⛔ `EMPTY_METRICS` | Paginated contacts for recipient resolution. Custom timeline events disabled (private-app token can't create templates). |
| **gsc** | n/a (read-only) | ⛔ `EMPTY_METRICS` | Data flows via `syncGscKeywords` (not `fetchMetrics`). Real OAuth + refresh. |
| **umami** | n/a | ⛔ `EMPTY_METRICS` | Data flows via `syncUmamiPageviews` (slug-substring). |

> **Metrics reality:** per-draft engagement is real only for **Buffer (cumulative)** + **SendGrid**.
> GSC + Umami feed the analytics tables via dedicated sync jobs (not adapter `fetchMetrics`).
> HubSpot/Wix return empty. **The sim-metrics era is over** — session 8 purged the simulated rows and
> session 9 imported the real Buffer LinkedIn history, so the learning loop now runs on real +
> imported data, just thin on the social/blog side.

### 7.6 Email recipients (`src/services/recipients.ts`)
`resolveEmailRecipients` materializes `payload.to_list` at **send time** from `list_source`:
`explicit_list` > `hubspot_all` (paginated, opt-out drop, dedup) > `sendgrid_all` (fallback). 500-cap
with a `capped` flag. `GET /api/drafts/:id/preview` shows count + source + capped before send.
> ⚠️ **SendGrid sender trap:** `apire.io` is NOT verified in SendGrid → sends from it are rejected.
> `marketing@leadorch.io` is the working sender. Fresh newsletters default to the rejected `apire.io`.

### 7.7 Mail sync (`services/mailsync.ts`)
Bidirectional HubSpot↔SendGrid contacts (1000/batch, unsubscribe reconciliation); SendGrid webhook
events → `content_metrics` (+ HubSpot timeline **gated off** for now), ECDSA-verified.

---

## 8. Dashboard frontend (`dashboard/`) — mature V1, no auth

Routes: `/queue` (default), `/calendar`, `/campaigns`, `/analytics`, `/settings`. Axios injects
`X-Tenant-ID` from localStorage `hm_tenant_id`; `TenantProvider` fetches `GET /api/tenants` (no header
→ backend rls_bypass returns **all** tenants) and auto-selects the first. ~30 TanStack Query hooks.

| Page | State |
|---|---|
| **Queue** | ✅ Drafts, stats bar, 4 sorts, "Generate more"/"Create now" modals, approve/dismiss/schedule/publish, post-gen polling, **Recommendations panel**, **Weekly Intelligence brief**, **multi-guardian breakdown** UI w/ blocking banner + setup deep-links, **email recipient preview**. |
| **Calendar** | ✅ Month grid, channel dots, draft detail sheet, publish-now. |
| **Campaigns** | ✅ Create/pause/resume, goal progress, per-channel cadence, **Edit dialog wired** (session 13). |
| **Analytics** | ✅ 14-day stacked bar, top-content, GSC keywords, per-channel cards, graceful empty states. |
| **Settings** | ✅ Brand Voice, **Platforms connect/disconnect wizard** (API-key modals, SendGrid domain auth, Google OAuth popup), Corpus drag-drop upload/reingest/delete, **Buffer history import**, posting-schedule editor. |

**No auth/login gate, no 401 handling, no tests in this dir.** Known minor issues: tenant-leak-on-switch
(some component-local state not reset on tenant switch); date/timezone inconsistency (Calendar local-day
vs Analytics UTC bucketing); `types.ts` hand-maintained mirror (silent drift); channel-key sprawl
(`x` vs `twitter`, `gbp` with no publish path); publish-now enabled even on blocked drafts (only the
backend 422 protects).

---

## 9. Corpus / tenant content state

- **APIRE** (`apire.io`, EU AI-security/NIS2): **rich corpus** — 18 curated `.md` + 20 source docs + `PRODUCT-FACTS-EXTRACTED.md` (five-layer architecture, personas, threat coverage, zero-retention, EU/NIS2). **Fully operated** — ~79 artifacts in `out/apire/` (10 blogs + 30 social + images); real LinkedIn history imported. The proving-ground tenant.
- **OSM** (`ofsecman.io`, offensive security / AISecOps): 9 curated `.md` + 20 source `.txt` (incl. **untranslated Turkish** "Bilgi Notu-OSM") + V13 3D design-system corpus. **Corpus ingested + brand voice configured**, but **content pipeline barely operated** (a sample post). Making OSM a fully-operated tenant is the open V2 item #10.

Both seeded by `src/db/seed.ts` (tenant + site + `site_config.brand_voice` + default evergreen campaign), idempotent via `ON CONFLICT`.

---

## 10. Deployment status — **DEPLOYED & LIVE** (corrected)

**The backend Worker is deployed and operational.** As of 2026-06-23:
- `https://hailmery-api.bezekyigit0.workers.dev/` returns **HTTP 200**.
- `GET /api/tenants` returns **real DB data** — APIRE (`6daebc34-…`) + OSM (`4cc53768-…`) — confirming a live Neon connection with working secrets. (It also confirms the no-auth fleet leak is live, §5.3.)
- The root path still serves the **stale "V0" placeholder HTML** (a hardcoded string in `src/index.ts` that was never updated) — cosmetic, not a sign of an old deploy; the real UI is the separate Pages dashboard.

> ⚠️ **Prior docs said "never deployed" — that is wrong.** The handoff analysis inferred non-deployment
> from the absence of git deploy traces (deploys leave none) and a cached 404; a direct request proves
> otherwise.

**Still unverified / unknown about the deployment (cannot be determined from outside — see §13):**
- Which DB role prod uses (`hailmery_app` NOBYPASSRLS vs `neondb_owner`) — the entire RLS backstop hinges on this.
- Whether the R2 buckets exist (image/corpus persistence) or it's falling back to ephemeral.
- Whether the dashboard Pages app + custom domain `marketing.leadorch.io` are deployed.
- The exact deployed commit (the live API can't be pinned to a HEAD from outside).
- Whether anything (Cloudflare Access / WAF / IP allowlist) fronts the Worker — if not, the fleet is fully public.

---

## 11. Consolidated status — what works / what doesn't / what's thin

### ✅ Built, wired, working
- Multi-tenant `marketing.*` schema (18 tables) + RLS mechanics; isolation test passes.
- Full RAG generation: blog, social (5 ch), email (3 types), image, prompt caching, **5-validator guardian**.
- Document ingestion (upload/extract/chunk/embed/reingest/delete) over R2.
- Approval queue + calendar + campaigns (CRUD + **edit** + **auto-trigger gen**) + analytics + settings dashboard; tenant switcher.
- Publishing via Buffer/Wix/SendGrid with cadence; immediate + scheduled; **send-time email recipient resolution**.
- 4-tick cron + 2 Workflows with inline fallbacks.
- Nightly metrics + performance scoring + golden-example loop; **recommendations engine**; **weekly intelligence brief**.
- **Google OAuth + GSC** (keyword sync, real refresh, SEO recs); **platform connect wizard**; **Buffer history import**.
- Mail sync (HubSpot↔SendGrid) w/ ECDSA verify. AES-256-GCM per-tenant secrets.
- **Worker deployed and live.** APIRE fully operated; OSM corpus + voice ingested.

### 🟡 Built but thin / unverified
- **Learning-loop fuel:** real per-draft metrics only from Buffer (cumulative) + SendGrid; HubSpot/Wix empty; performance-prediction guardian dormant until ≥5 labeled golden examples.
- **Prompt-cache effectiveness** unverified (only the static prefix is cached).
- **Golden corpus** grows monotonically (no demotion prune).

### 🔴 Real bugs / gaps (prioritized)
1. **No authentication anywhere; `/api/tenants` leaks the whole fleet — live in prod.** (#1)
2. **RLS inert unless prod uses `hailmery_app`** (unconfirmed); two corpus queries lack explicit `tenant_id`.
3. **Image gen never fires in the generation Workflow** (`IDEOGRAM_API_KEY` gate vs `IMAGE_PROVIDER=gemini`); blog/email get no images.
4. **`refreshToken()` is a stub** — only Google refreshes; expired Meta/LinkedIn/TikTok tokens hard-fail.
5. **Stale-breakdown publish gate** + legacy `brandGuardian` still in the edit path (desync).
6. **Buffer `quotaState` broken** (legacy v1 401s); **`getAllSendGridContacts` first-page-only (~50)**.
7. **Unsigned webhook `?tenant=`**; over-broad CORS; unauthenticated asset proxy; `/api/debug/sync-gsc` in prod.
8. `makeDb` opens a new Neon Pool per call and never closes it (connection churn).

### ⛔ Not built (V2/V3)
Native social adapters (LinkedIn/X/IG/TikTok/Pinterest/GBP), video gen, Imagen 4 / FLUX.2, GA4/BigQuery,
GTM, paid ads (Google/Meta/LinkedIn), strategist agent, `budget.ts`, `queue/transitions.ts`, drift check,
and the **LeadOrch cross-schema H3 integration** (`marketing.campaigns.leadorch_run_id → leadorch.runs.id`,
shared JWT, `run.completed` webhook).

---

## 12. Known traps & caveats (carry into any new work)

1. **No auth — the fleet is public.** Treat the deployed Worker as world-readable until Cloudflare Access / a real auth layer is in front. Don't add features that assume a trusted caller.
2. **Prod DB role:** prod `DATABASE_URL` must be `hailmery_app` (NOBYPASSRLS), not `neondb_owner`, or RLS is silently off. Local env uses `neondb_owner` → **RLS is off in dev**; rely on explicit predicates.
3. **Always add an explicit `tenant_id` filter** on any new pgvector query (bug `657d906`); fix the two existing RLS-only ones.
4. **`SECRETS_KEY` must match** the seed machine (base64, 32 bytes — not the old hex).
5. **Image path:** generation Workflow won't make images as configured; fix the `GOOGLE_API_KEY||IDEOGRAM_API_KEY` gate, not just the billing.
6. **Guardian:** publish trusts a *stored* breakdown; editing doesn't refresh it — use the recheck endpoint. Legacy `brandGuardian` still lives.
7. **SendGrid sender:** verify `apire.io` (or use `marketing@leadorch.io`) before testing live email.
8. **PDF in Worker** = 0 chunks (Node-only). **Buffer metrics** = cumulative, not windowed.
9. **Cloudflare Workflows:** `AsyncLocalStorage` does NOT cross `step.do()` — each step rebuilds its db/env. Keep it that way.
10. **Workers paid plan required** (crons + Workflows). `out/` and large corpus binaries are committed (repo bloat).

---

## 13. Open questions for Baran / Yigit (unanswerable from code)

1. **Is prod `DATABASE_URL` the `hailmery_app` NOBYPASSRLS role, with its Neon password set?** The RLS backstop and the safety of the two predicate-less corpus queries hinge on this.
2. **Is anything fronting the Worker with real auth** (Cloudflare Access / WAF / IP allowlist)? If not, the fleet list and all tenant data are public.
3. **Were the R2 buckets created**, and is the dashboard Pages app + `marketing.leadorch.io` custom domain deployed? (Worker is confirmed live; the rest is unverified.)
4. **Did Baran retire Kleo and start operating hailmery daily on APIRE** (the H2 success criterion)?
5. **Is OSM meant to be operated end-to-end** (V2 #10)? Are the untranslated Turkish OSM source files meant to drive **Turkish-language generation**, or reference-only?
6. **Is the §7.2 image-gate bug** acceptable for now or a defect to fix this cycle? Is `R2_PUBLIC_BASE_URL` set, or are thumbnails relying on the hardcoded proxy URL?
7. **Are the `?tenant=` webhook trust, the SendGrid ~50-contact ceiling, the `refreshToken()` stub, and monotonic golden growth "acceptable for two trusted tenants,"** or now in scope?
8. **Is the LeadOrch H3 integration next**, and is shared-Neon still the intended path given the blast radius?

---

## 14. Recommended next actions

**Security hardening (do first — the system is live and public):**
1. **Put auth in front of the Worker** (Cloudflare Access / Zero Trust is the fastest), and either auth-gate or remove the unauthenticated fleet-wide `GET /api/tenants`.
2. **Confirm/switch prod `DATABASE_URL` to `hailmery_app`** and verify RLS bites (run `pnpm test:rls` against the prod role); add explicit `tenant_id` predicates to `guardian.ts` + `intelligence.ts`.
3. Remove `/api/debug/sync-gsc` from prod; tighten CORS off the `*.pages.dev` wildcard; add a replay-window + signed-tenant check to the SendGrid webhook.

**Correctness:**
4. Fix the generation-Workflow image gate (`GOOGLE_API_KEY || IDEOGRAM_API_KEY`); extend backfill to blog/email.
5. Make the publish guardian gate re-run (or have the edit path refresh `guardian_breakdown`); converge `blog.ts` onto `context.ts`.
6. Wire real token refresh beyond Google before any social token expires.

**Operate + verify:**
7. **Operate OSM** end-to-end (V2 #10) to prove per-tenant config is real; verify the SendGrid sending domain.
8. Confirm R2 buckets + dashboard deploy; observe whether the prompt cache actually hits.

**Hygiene:**
9. Add automated tests for generation + jobs + a couple of API routes (mock Anthropic/OpenAI/fetch).
10. Implement a `SECRETS_KEY` rotation scheme; close the Buffer `quotaState` + SendGrid pagination bugs.

---

*Generated 2026-06-23 by a full-repo technical review (handoff analysis + a 5-cluster code-truth
verification workflow + direct live-endpoint checks). Line/commit references are accurate as of HEAD
`218112b`. The single biggest correction vs. prior docs: the Worker **is deployed and live**, and that
makes the no-auth fleet exposure a present-tense production issue, not a future risk.*
