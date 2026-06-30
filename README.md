# hailmery

A **multi-tenant AI marketing command center** — the replacement for APIRE's old Wix "Kleo"
marketing agent. It ingests a brand's documents into a RAG corpus, generates RAG-grounded
blog/social/email/image content with Claude, gates every draft through a 5-validator brand guardian,
runs a human-approval queue, publishes through Buffer / Wix Blog / SendGrid, and learns from
performance. Two live tenants: **APIRE** (`apire.io`) and **OSM** (`ofsecman.io`).

> **State:** V0 + V1 complete, plus ~8 sessions of V1.5/early-V2 work (multi-guardian, recommendations
> engine, Google OAuth + GSC, connect wizard, email recipient resolution, Buffer history import,
> **JWT auth (session 14)**, **blog management page (session 15)**). The backend Worker is **deployed
> and live**. **Read `CLAUDE.md` first** (the canonical engineering fast-ramp). Also: **`CURRENT_SITUATION.md`**
> for the full as-built handoff, **`Reports/`** for snapshots + line-level reference, **`PLAN.md`** for the
> product vision.

> ⚠️ **Before you touch anything:**
> 1. **Auth is LIVE (session 14).** Every `/api/*` route requires a Google-login Bearer JWT, and an
>    `X-Tenant-ID` outside the caller's `allowedTenants` is rejected 403. (Public exceptions: the login/
>    OAuth callbacks, the `/api/assets/` image proxy, and `/webhooks/`.)
> 2. **RLS is inert unless prod `DATABASE_URL` uses the `hailmery_app` (NOBYPASSRLS) role.** Local env
>    uses `neondb_owner` (BYPASSRLS), so **RLS does nothing in dev** — isolation rests on explicit
>    `tenant_id` predicates. Always add an explicit `tenant_id` filter to any new query. **This is now
>    the one open isolation caveat** (the prod role is unconfirmed).

## Architecture

- **Backend** — Cloudflare Worker + **Hono** (`src/index.ts`), `nodejs_compat`. 40-route JSON API
  (`src/routes/api.ts`), JWT auth middleware, 4 cron ticks, and 2 Cloudflare Workflows (generation +
  publish) with inline fallbacks. Worker name `hailmery-api`.
- **Database** — Neon Postgres + Drizzle, single `marketing.*` schema, **18 tenant-scoped tables**,
  **pgvector** (1536-dim, HNSW cosine) for RAG, Postgres RLS on every table.
- **Frontend** — React 19 + Vite + Tailwind v4 + TanStack Query on Cloudflare Pages (`dashboard/`),
  behind a Google-login gate: Queue / Calendar / Campaigns / Analytics / Blog / Settings.
- **AI** — Claude **Sonnet 4.6** (generation, recommendations, intelligence, image prompts), Claude
  **Haiku 4.5** (4 advisory guardians), OpenAI `text-embedding-3-small` (embeddings), **Gemini 3 Pro
  Image** primary / **Ideogram 3.0** fallback. Anthropic server-side `web_search` for weekly briefs.
- **Storage** — Cloudflare R2 (corpus + images), local-disk fallback. Per-tenant platform tokens are
  AES-256-GCM encrypted into `marketing.tenant_secrets`.

## What it does today

- **Generate** RAG-grounded blog, social (LinkedIn/X/Instagram/TikTok/GBP), email (newsletter / 5-step
  drip / outreach), and paired images — grounded in the tenant's corpus + promoted "golden examples."
- **Guard** every draft with 5 validators: `platform_rules` (deterministic, **blocking**) + `factual`,
  `brand_voice`, `audience_fit`, `performance_prediction` (Haiku, advisory, graceful-degrade).
- **Approve** via the dashboard: review → edit → approve → schedule → dismiss → publish, with a live
  guardian breakdown and email recipient preview.
- **Publish** through Buffer (social), Wix Blog (markdown→Ricos), SendGrid (email with send-time
  recipient resolution), cron-driven with per-channel cadence enforcement.
- **Measure & recommend** — nightly metrics + performance scoring + golden-example learning loop; a
  weekly Sonnet intelligence brief (web-search) and a nightly recommendations engine (5 weekly action
  cards wired to one-click "Generate now").
- **Connect** — self-serve platform wizard with live probes; Google OAuth + GSC keyword sync; Buffer
  historical-post import to seed the learning loop.

See `CURRENT_SITUATION.md` §11 for the precise works / thin / broken breakdown (notably: image gen
never fires in the generation Workflow as configured; per-draft metrics are real only for Buffer +
SendGrid; token refresh works for Google only).

## Prerequisites

- Node 20.6+ · pnpm 9+
- A Neon project (with pgvector) — and, for production, the `hailmery_app` role (created by `db:migrate`)
- OpenAI + Anthropic API keys (+ Google/Gemini, SendGrid, HubSpot, Buffer keys for the live integrations)

## First-run setup (local)

```bash
pnpm install
cp .env.example .env          # fill in DATABASE_URL, OPENAI_API_KEY, ANTHROPIC_API_KEY, SECRETS_KEY, …
pnpm db:push                  # drizzle-kit push: creates the marketing.* schema (⚠ destructive to RLS — re-run db:migrate after)
pnpm db:migrate               # applies rls.sql: RLS policies + HNSW index + the hailmery_app role
pnpm db:seed                  # inserts the APIRE + OSM tenants/sites/configs/evergreen campaigns
pnpm ingest --tenant apire    # ingest corpus/apire/*.md into pgvector
```

> `db:push` is interactive and **drops RLS policies** (drizzle-kit doesn't manage them). Always run
> `db:migrate` afterward to restore them. Add-on tables belong in `rls.sql` + `db:migrate`.

## Run

```bash
pnpm dev                      # Worker at http://localhost:8787 (API + cron + V0 settings page)
cd dashboard && pnpm dev      # React dashboard (set VITE_API_URL to the Worker origin)
```

CLI generation (writes artifacts under `out/{slug}/`):

```bash
pnpm gen blog   --tenant apire "AI security for EU CISOs facing NIS2"
pnpm gen social --tenant apire "NIS2 readiness"
pnpm ingest     --tenant apire        # re-ingest after editing corpus/apire/*.md
```

## Verify

```bash
pnpm test         # vitest: adapters (6) + mailsync + recipients
pnpm test:rls     # real-DB tenant-isolation proof (creates the hailmery_app NOBYPASSRLS role)
pnpm test:wix     # live Wix Blog round-trip (needs WIX_* env)
pnpm typecheck
```

## Deploy

The backend Worker is already deployed (`hailmery-api.bezekyigit0.workers.dev`). To (re)deploy, follow
**`DEPLOY.md`** (R2 buckets → `wrangler deploy` → secrets → migrate/seed against the `hailmery_app`
role → dashboard build + Pages deploy → custom domain → seed tenant secrets). Per-tenant credentials
are seeded with `scripts/seed-tenant-secrets.mjs <tenant>` and **must** use the same `SECRETS_KEY` as
the Worker secret.

## Corpus contract

`corpus/{tenant_slug}/*.md` — one file per logical document. Plain markdown; the chunker reads tokens
(512/64 overlap, cl100k_base), not headings. Re-running `pnpm ingest` versions documents and supersedes
old chunks. Upload via the dashboard Settings → Corpus tab (md/txt/docx extract in the Worker; **PDF is
Node-only and yields 0 chunks in the Worker**). APIRE's corpus is rich and curated; OSM's is ingested
but the tenant is only lightly operated so far.
