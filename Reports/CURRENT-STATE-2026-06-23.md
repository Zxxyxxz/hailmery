# Hailmery — Current State (30-second read)

**Date:** 2026-06-23  ·  **Git HEAD:** `218112b`  ·  **Sessions completed:** 1–13
**Full handoff:** `CURRENT_SITUATION.md` (detailed) · `Reports/ARCHITECTURE-ANALYSIS-218112b.md` (deep code reference)

---

## What this is
A **multi-tenant AI marketing command center** replacing the old Wix "Kleo" agent. It ingests a brand's docs into a RAG corpus, generates RAG-grounded blog/social/email/image content with Claude, gates every draft through a 5-validator brand guardian, runs a human-approval queue, publishes via Buffer/Wix/SendGrid, and learns from performance. Two live tenants: **APIRE** (`apire.io`, EU AI-API security) and **OSM** (`ofsecman.io`, offensive security). Backend = Cloudflare Worker + Hono + Cloudflare Workflows + cron. DB = Neon Postgres + pgvector + RLS. Frontend = React 19 SPA on Cloudflare Pages.

## ✅ What works (built + wired, end-to-end)
- **RAG generation**: blog, social (LinkedIn/X/IG/TikTok/GBP), email (newsletter/drip/outreach), with prompt caching + golden-example learning loop.
- **5-validator guardian**: `platform_rules` (deterministic, **blocking**) + `factual` + `brand_voice` + `audience_fit` + `performance_prediction` (4 Haiku, advisory, graceful-degrade).
- **Approval dashboard**: Queue / Calendar / Campaigns / Analytics / Settings. Review→edit→approve→schedule→dismiss→publish. Tenant switcher.
- **Publishing**: Buffer (social), Wix Blog (markdown→Ricos), SendGrid (email w/ real recipient resolution). Cron-driven, cadence-enforced.
- **Campaigns**: full CRUD; create now **auto-triggers first-batch generation**; edit is wired.
- **Intelligence + recommendations**: weekly Sonnet + web-search brief; nightly recommendations engine (5 weekly action cards → one-click "Generate now").
- **Google OAuth + GSC**: keyword sync, real token refresh, SEO striking-distance recommendations.
- **Connect wizard**: live connection probes, API-key flows, SendGrid domain-auth self-serve.
- **Buffer history import**: real APIRE/OSM LinkedIn back-catalogue imported as measured content → seeds golden examples.
- **Deployed & live**: the Worker is up at `hailmery-api.bezekyigit0.workers.dev` and serving real DB data.

## ⚠️ What doesn't work / is thin (verified)
- **🔴 NO AUTHENTICATION ANYWHERE.** `X-Tenant-ID` is trusted on UUID-format only. `GET /api/tenants` returns the **entire tenant fleet unauthenticated** — confirmed live in prod. The only "protection" is URL/UUID secrecy. **#1 risk.**
- **🔴 RLS is inert in dev** (`neondb_owner` has BYPASSRLS); it only bites if prod `DATABASE_URL` uses the `hailmery_app` (NOBYPASSRLS) role — **unconfirmed for prod**. Two corpus queries (`guardian.ts`, `intelligence.ts`) have no explicit `tenant_id` filter and would leak cross-tenant if RLS is off.
- **Image gen never fires in the generation Workflow** — gated on `IDEOGRAM_API_KEY` while `IMAGE_PROVIDER=gemini`. Images only appear via publish-time backfill, only for linkedin/instagram/x — **blog/email headers get none**.
- **Token refresh works for Google only.** `publish.ts refreshToken()` is a `return false` stub; expired Meta/LinkedIn/TikTok tokens **hard-fail** (draft marked failed).
- **Per-draft metrics only from Buffer (cumulative-only) + SendGrid.** HubSpot/Wix `fetchMetrics` return empty; GSC/Umami feed via separate sync jobs. Learning-loop fuel is real but thin for social/blog.
- **Stale-breakdown publish gate**: publish reads the *stored* guardian breakdown and never re-runs; editing a draft (`rerunGuardian`) only runs the legacy single guardian — you must click **Re-check** to refresh the blocking state.
- **Golden corpus grows monotonically** (no demotion prune). **PDF upload = 0 chunks in the Worker** (Node-only).
- **SendGrid sender trap**: `apire.io` is NOT verified in SendGrid → sends rejected. `marketing@leadorch.io` is the working sender.

## ⏳ Waiting on Baran (the operator)
- **Retire Kleo & operate APIRE daily on hailmery** (the H2 success criterion). Commit `9f5a0e4` prepped a "pre-Baran" handoff.
- **Decide OSM scope**: corpus-only, or fully operated end-to-end? (OSM corpus has untranslated Turkish source — confirm if Turkish-language generation is intended.)
- **Confirm the prod DB role** is `hailmery_app` (not `neondb_owner`), and **set its Neon password** — the whole RLS backstop hinges on this.
- **GSC consent** for `apire.io` (Google verification) to fuel the SEO recommendations.

## ▶️ What's next (highest leverage first)
1. **Put auth in front of the Worker** (Cloudflare Access / Zero Trust, or a real auth layer) — the fleet is currently public. Lock down or remove the unauthenticated `GET /api/tenants` fleet list.
2. **Confirm/switch prod `DATABASE_URL` to `hailmery_app`** so RLS actually enforces; add explicit `tenant_id` predicates to the two RLS-only corpus queries.
3. **Fix the generation-Workflow image gate** (`GOOGLE_API_KEY || IDEOGRAM_API_KEY`) so drafts get images; extend backfill to blog/email.
4. **Wire real token refresh** beyond Google before any social token expires; make the publish guardian gate re-run instead of trusting a stale breakdown.
5. **Operate OSM** end-to-end to prove per-tenant config is real, and **verify the SendGrid sending domain** for live email.

> One-line status: **Built far past prototype, deployed and serving — but shipped with no authentication and an unconfirmed RLS role, so the immediate work is security hardening, not features.**
