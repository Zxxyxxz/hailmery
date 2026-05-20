# Hailmery — AI Marketing Command Center (Kleo Replacement → LeadOrch-Integrated SaaS)

## Context

Yigit is the developer for Baran's Kuzey Global agency. Today APIRE runs on Wix and relies on Wix Studio's AI Marketing Agent ("Kleo") for SEO/social/email/ads. OSM never was a Wix site — Kleo was used only as the marketing brain, and OSM itself is being rebuilt by Baran on Cloudflare. APIRE is also being rebuilt on Cloudflare in parallel. Kleo has documented failure modes on APIRE (hallucinated feature names, TOFU-only keywords, generic AI-stock images, strategy doc frozen Aug 2025, only 1/8 social platforms connected, no learning loop, no CMS grounding).

The original framing was "replace Kleo with a self-hosted tool Yigit owns end-to-end." The mentorship session with Baran reframed the product into something much larger: **hailmery is a multi-tenant AI marketing command center.** It is not "two scripts for OSM and APIRE." It is the product that ingests a company's documents, connects all of their marketing tools (HubSpot, SendGrid, GA4, GSC, GTM, Google Ads, Meta Ads, LinkedIn Ads, native social APIs), reads the unified data, plans campaigns intelligently, executes with human approval at configurable gates, and learns continuously. OSM and APIRE are tenants #1 and #2 — the proving ground. The SaaS launched to founders and lean teams is the destination.

The combined product is also the **closing loop for LeadOrch** (`leadorch.io`, Yigit's existing Cloudflare-Workers B2B lead-gen SaaS): LeadOrch finds the right companies/people → hailmery attracts and warms them with content + retargeted ads → engagement signals feed back to LeadOrch for lead-scoring. Neither half exists in the market in a single tool.

This plan is the full technical blueprint: vision, stack, architecture, build phases, integration timeline, and known weaknesses. It is deliberately long — Yigit asked for a reference doc he can return to, not a one-pager.

---

## The product vision — six capabilities

The lead engineer's framing in Turkish: "marketing yapay zeka ile çalışsin" (let marketing work with AI) and "sistemleri bağla ve çalışsın, kampanyaları yapsın, lead getirsin" (connect the systems and let them run, create campaigns, bring leads). Hailmery does six things:

1. **INGEST** — the tenant uploads everything about their company: product documentation, marketing plans, past campaigns, technical specifications, company values, brand guidelines, competitor analysis, customer personas, sales decks, pricing sheets, testimonials. The AI reads all of it and builds a deep, persistent, per-tenant understanding of who they are, what they sell, who they sell to, and how they talk.

2. **CONNECT** — HubSpot (CRM/contacts), SendGrid (email delivery), GA4 (web traffic), GSC (SEO/keywords), GTM (event tracking), Google Ads (paid search), Meta Ads (paid social), LinkedIn Ads (B2B paid), Buffer (transitional social bridge), and native social APIs as their reviews clear (LinkedIn, X, Instagram, TikTok, Pinterest, Threads, GBP, etc.).

3. **READ + UNDERSTAND** — hailmery continuously monitors every connected tool: what keywords rank, which campaigns convert, which emails get opened, which posts drive traffic, what the Google Ads Quality Score is, where the funnel drops off. It does not just display this data — it interprets it and generates actionable recommendations.

4. **PLAN** — given the tenant's goals, current performance data, brand corpus, and campaign brief, the AI generates the strategy: which channels, what content, what budget, what timing, what success metrics.

5. **EXECUTE** — the AI generates blog posts, social posts, email sequences, ad copy, image prompts, video prompts, schedules them, and publishes through the connected adapters with human approval at configurable gates.

6. **LEARN** — every published piece generates metrics. Every approved or dismissed draft teaches the system. Metrics feed the next generation as "here is what worked and what did not." The closed loop is the moat.

**ICP for the SaaS**: founders and lean teams overwhelmed by digital marketing chaos — too many tools, too many platforms, too many decisions, too little time. They want to focus on building the product and serving customers, not becoming marketing experts. Hailmery handles strategy, creation, scheduling, monitoring, and optimization. They just approve content and review monthly reports.

---

## Zoho principle: be the intelligent connective tissue, not another silo

Zoho built 50+ products (Zoho CRM, Zoho Campaigns, Zoho Social, Zoho Analytics, Zoho Books, ...) on a shared data bus. Each is independently useful. Combined, they are exponentially more powerful than any one of them. That is how Zoho beat enterprise competitors at a fraction of the price.

**Zoho's flaw**: users buy each product separately and stitch integrations together manually. The user is still the integrator.

**Hailmery's advantage**: the AI is the integrator. The tenant connects their existing tools once (HubSpot, SendGrid, GA4, ...) and hailmery's intelligence layer orchestrates across them automatically. The differentiator is not that we replace these tools — we **amplify** them by connecting them and applying AI reasoning across the unified dataset.

Concrete examples of cross-tool reasoning that hailmery does and that no single tool can:

- **GSC** says the NIS2 page gets 3× the impressions of baseline → AI generates 5 follow-up blog posts on related angles → **HubSpot** list of EU-CISO contacts is segmented → **SendGrid** sends a newsletter featuring the top post → **Google Ads** Customer Match audience is built from clickers → **LinkedIn** retargeting follows them.
- **HubSpot** deal stalls at Negotiation stage → AI checks the last campaign engagement → generates a reactive nurture email referencing the specific content the contact engaged with → **SendGrid** sends → opens/clicks flow back to **HubSpot** Timeline.
- **GA4** (via BigQuery) shows a blog post hitting unusual traffic → AI generates Variant B with a sharper hook → cross-posts to LinkedIn + X with platform-tuned copy.

The Zoho principle lives in the architecture: every external system is a strict adapter (`src/adapters/{name}.ts`) and the intelligence layer reasons across them in unified types.

---

## Goals (three horizons)

| Horizon | Outcome | Time | Success criterion |
|---|---|---|---|
| **H1 — Internship demo** | Generates publishable SEO/social drafts for APIRE that beat Kleo's quality. Multi-tenant schema scaffolded. No live publishing yet. | 1 weekend → 2 wks | 10 blog drafts + 30 social drafts Baran would actually post. |
| **H2 — Standalone tool** | Full pillar coverage, campaign-first model, approval queue, direct publishing to Wix Blog (transitional) + Buffer-bridged social + HubSpot + SendGrid + GBP + GA4/GSC/Umami read. Per-tenant config for OSM and APIRE. Document ingestion live. Mail sync live. | 4–10 wks (OAuth review on critical path) | Baran retires Kleo on APIRE; uses hailmery daily. |
| **H3 — LeadOrch-integrated + public SaaS** | Shared Neon DB; LeadOrch ICP runs trigger persona-targeted content + retargeting; engagement metrics flow back to LeadOrch as lead-score signals. Native social adapters replace Buffer. Learning loop closes. Public sign-up + Stripe billing. | 3–6 mo | LeadOrch demo shows "Discover → Attract → Score → Close"; first non-Kuzey paying tenant onboarded. |

---

## Recommended tech stack

The single most important decision: **match LeadOrch's stack exactly** so integration is free, deploy/ops mental model carries over, and Yigit reuses his own muscle memory.

### Runtime
- **Cloudflare Workers + Hono** (TypeScript) — same as LeadOrch backend
- **Cloudflare Workflows** for long-running generation and publish pipelines (parity with LeadOrch's `PipelineWorkflow` / `ICPDiscoveryWorkflow`). Known trap: AsyncLocalStorage does NOT cross `step.do()` boundaries — thread `runContext` explicitly (see [project_ctact.md](../projects/-Users-xxxyxxx/memory/project_ctact.md))
- **Durable Objects** for per-tenant + per-site state machines
- **Cloudflare Queues** for scheduled publish ticks and webhook fan-out
- **R2** for generated images/video assets and uploaded tenant documents

### Data
- **Neon Postgres + Drizzle ORM** — same instance as LeadOrch. Schemas: `leadorch.*` (existing), `marketing.*` (this app), `umami.*` (own-site analytics). The shared instance is what makes H3 integration free.
- **Multi-tenant model**: single `marketing.*` schema with `tenant_id uuid` as the first column on every table. Neon Row-Level Security (RLS) enforced — policy `current_setting('app.tenant_id') = tenant_id::text` on every table, Worker sets the session var at request boundary.
- **`pgvector`** in the same Neon DB for corpus embeddings (tenant-scoped via the same RLS).
- **Embeddings**: OpenAI `text-embedding-3-small` (1536-dim, $0.02/1M tokens). Voyage AI is the upgrade path if quality bites.

### Frontend
- **Cloudflare Pages** (React 19 + Vite + Tailwind) at `marketing.leadorch.io` — same design tokens as LeadOrch admin so H3 can absorb the UI into one dashboard.
- **shadcn/ui + Recharts** (Recharts already in LeadOrch).
- **TanStack Query** for client-reactive surfaces (approval queue, calendar, analytics).

### Content generation (Apr–May 2026 pricing)
- **Text**: **Claude Sonnet 4.6** ($3/$15 per Mtok, 1M ctx, prompt caching 90% off cached input) is the workhorse. **Claude Opus 4.7** for the quarterly Marketing Strategy regeneration only. **Claude Haiku 4.5** ($1/$5) for cheap classification and the Brand Guardian LLM-as-judge.
- **Images**: **Ideogram 3.0** ($0.06/image) primary — the only model with reliable in-image text rendering. **Imagen 4** ($0.04) for photoreal hero imagery. **FLUX.2 [pro]** via Replicate ($0.015) as the open-model fallback for security-domain content that Imagen sometimes rejects.
- **Video**: **Kling 3.0 Standard** ($0.084/sec, multi-shot up to 15s) primary. **Veo 3.1 Fast** ($0.15/sec) as iteration engine. **Sora REMOVED** — OpenAI is shutting down the Sora API on 2026-09-24; do not build on it.
- **Budget envelope**: ~$16/mo H1 cadence (50 blog/100 image/20 video); ~$80–150/mo H2 across two tenants; per-tenant cap default $50/mo, configurable up via `marketing.tenants.monthly_budget_cents`.

### Email infrastructure
- **SendGrid** for all marketing/campaign email. Clean-IP infrastructure, SPF/DKIM/DMARC configured per tenant domain. Dedicated SendGrid subuser + IP for tenants sending >10k emails/month; reputable shared pool for smaller tenants.
- **Resend** demoted to *system* email only (operator password resets, internal notifications). Not used for tenant marketing.
- **Listmonk** as the fallback email engine for tenants who do not use HubSpot+SendGrid (self-hosted, free).

### CRM
- **HubSpot** as the tenant-connectable CRM (private app access token, no review). Used for contacts, deal pipeline, lifecycle stages. **Pricing trap**: never recommend upgrading past Starter ($20/mo) — Marketing Hub Pro carries a mandatory $3,000 onboarding fee that catches every solo developer.
- **Fallback for tenants without HubSpot**: LeadOrch's contact pipeline (cross-schema reads from `leadorch.contacts`) + Listmonk.

### Analytics — three layers
- **Layer 1 — Google stack (tenants)**: GTM deploys the tracking tags; GA4 collects behavior; GA4 **must** export to BigQuery from day 1 (free, unsampled, raw). Hailmery reads from BigQuery, not from the GA4 API (the 25,000 token/day quota will kill any real dashboard immediately). GSC API for search performance with the known 75% impression-privacy filter accepted as a calibration constraint, not ground truth.
- **Layer 2 — Self-hosted analytics for own sites**: **Umami** in `umami.*` schema on the same Neon instance. Cookieless, GDPR-native, free, no token limits. Embedded on the OSM and APIRE rebuilds.
- **Layer 3 — Platform metrics**: every adapter implements `fetchMetrics()` for its platform. LinkedIn impressions, X engagements, IG reach, SendGrid opens/clicks/bounces, etc. Written to `content_metrics`.

### Tag management
- **GTM** containers per tenant. Hailmery ships **pre-built GTM container templates** as a deliverable — GA4 base events + Meta Pixel + LinkedIn Insight Tag + Google Ads conversion tags wired with hailmery's canonical event names. Tenant imports the template; no code changes on their site.

### Paid ads
- **Google Ads** — read-only adapter in V1; developer token submission day 1 of V1 (review takes 2–4 weeks, sometimes needs live ad spend evidence); write/automation in V2.
- **Meta Ads + LinkedIn Ads** — V2+ for Customer Match / Matched Audience upload from LeadOrch.

### Why NOT Node + Hetzner / n8n (the obvious alts)
Cloudflare cold-start is invisible for a tool the operator opens 5×/day. LeadOrch already runs Workers, the shared Neon instance only works if both apps run on platforms that share connection patterns, and n8n adds a second ops surface + a UI-driven debugging model. **No n8n. Custom Workflows.**

---

## Platform connector inventory

Every external system hailmery talks to. Each row is an adapter file under `src/adapters/{name}.ts` conforming to the `ChannelAdapter` interface.

| Platform | Category | API type | Auth | What we read | What we write | Role in intelligence loop |
|---|---|---|---|---|---|---|
| HubSpot | CRM | REST `/crm/v3/objects/*` + Timeline API | Private app access token | Contacts, deals, lifecycle stage, owner | Timeline events, contact upserts, list memberships, engagement events | Source of truth for tenant contacts; receives SendGrid events via mail-sync |
| SendGrid | Email | REST v3 + webhook stream | API key (tenant-scoped subuser) | Delivery stats, open/click/bounce/unsubscribe events | Marketing sends, contact list segments, suppressions | Delivery layer for all campaign email; events drive `content_metrics` and HubSpot Timeline |
| Resend | System email | REST | API key | n/a | Operator system mails only | Out of the marketing loop |
| Listmonk | Email (fallback) | REST | Self-hosted basic auth | Subscriber lists, campaigns, opens/clicks | Sends, lists | Fallback for tenants without HubSpot+SendGrid |
| GA4 (via BigQuery) | Analytics | BigQuery SQL on the GA4 daily export | Service account key | Sessions, conversions, attribution, page/source/medium | n/a | Nightly aggregation → `content_metrics` |
| GSC | SEO | Webmasters API v3 | OAuth `webmasters.readonly` | Queries, impressions, clicks, position, indexation | n/a | Keyword strategy, striking-distance detection, reactive triggers |
| Umami | Analytics (own sites) | REST | API key (self-issued) | Pageviews, events, referrers per OSM/APIRE | n/a | Hailmery's own ground-truth analytics |
| GTM | Tag management | REST + container templates | OAuth `tagmanager.edit.containers` | Container versions, triggers, tags | Apply hailmery container template per tenant | One-shot per-tenant onboarding |
| Google Ads | Paid search | Google Ads API + AdWords reports | OAuth + developer token | Campaigns, ad groups, keywords, ad copy, Quality Score, CPC, conversion data | (V2) ad copy A/B, negative keywords, Customer Match, budget allocation | Performance feedback + retargeting upload |
| Meta Ads | Paid social | Marketing API | App access token (60d, refresh) | Campaign perf, audience perf | (V2) Custom Audience upload, ad copy creation | Retargeting LeadOrch-discovered companies |
| LinkedIn Ads | B2B paid | Marketing Developer Platform | OAuth (partner approval) | Campaign perf | (V2) Matched Audience upload, ad copy | Retargeting + ABM |
| LinkedIn (organic) | Social | UGC Posts + Posts API | OAuth `w_member_social` (self-serve) → `w_organization_social` (partner) | Post engagement | Posts (personal V1; organization V2 after partner approval) | Algorithmic ceiling ~1/day |
| X (Twitter) | Social | v2 | OAuth 2.0 PKCE | Post engagement (capped 2M reads/mo) | Posts (pay-per-use $0.01/post for new devs) | High-frequency channel, low cost |
| Meta — Instagram | Social | Graph API | App access token via FB Page | IG insights | IG feed, carousels, reels (25 posts/account/24h, no text-only) | Visual-heavy channel |
| Meta — Facebook | Social | Graph API | Same as IG | Page insights | Page posts | Lower priority for B2B tenants |
| TikTok | Social | Content Posting API | OAuth (24h tokens) | Engagement | Posts (forced `SELF_ONLY` until audit clears) | Awareness; gated by audit |
| Pinterest | Social | v5 | OAuth | Pin metrics | Pins, boards | Niche B2C tenants only |
| Threads | Social | Posts API | OAuth via Meta | Engagement | Posts | Bundled with Meta adapter |
| Google Business Profile | Local | Business Profile API | OAuth (quota-gated) | Insights | Posts, offers, events | Local SEO for tenants with physical locations |
| Buffer (transitional) | Social bridge | GraphQL beta | Personal API token | n/a | Multi-platform scheduling via single call | Temporary V1 bridge during OAuth review; sunset per platform as direct adapters clear |
| Wix Blog | CMS (transitional) | REST | API key | Existing posts | New posts (draft → publish) | Transitional adapter for APIRE while it lives on Wix; **removed** when APIRE rebuilds onto Cloudflare |
| OSM/APIRE rebuilt blog | CMS (own sites) | Internal (writes to shared Neon `marketing.content_drafts` → site reads at request time) | Internal auth | Existing posts | New posts | Zero-glue path once rebuilds ship |
| Anthropic | AI (text) | Messages API + prompt caching | API key | n/a | Claude Sonnet/Opus/Haiku calls | Strategist, writer, guardian |
| OpenAI | AI (text/embeddings) | Responses + Embeddings | API key | n/a | GPT for short-form, `text-embedding-3-small` for corpus | Short-form + retrieval |
| Vertex AI | AI (image/video) | REST | Service account | n/a | Imagen 4, Veo 3.1 Fast | Photoreal + iteration video |
| fal.ai | AI (image/video) | REST | API key | n/a | Kling 3.0, FLUX.2 | Primary video + open-model image fallback |
| Replicate | AI (image) | REST | API key | n/a | FLUX.2 [pro], LoRA fine-tunes | Brand-LoRA path at H3 |
| Ideogram | AI (image) | REST | API key | n/a | Ideogram 3.0 | Primary image gen (text-in-image) |

---

## System architecture

```
┌────────────────────────────────────────────────────────────────────┐
│  Cloudflare Pages — marketing.leadorch.io (React 19 + Vite)         │
│  Routes:                                                            │
│    /tenants/[id]/...      — multi-tenant switcher                   │
│    /campaigns/[id]        — campaign creation, briefs, calendar     │
│    /review/[draft]        — approval queue                          │
│    /pillars/[p]           — pillar (brand theme) dashboards         │
│    /documents             — corpus upload + status                  │
│    /analytics             — unified BigQuery + Umami + platforms    │
│    /connections           — OAuth connection manager per platform   │
└────────────────────────────────┬───────────────────────────────────┘
                                 │ Hono server actions / REST
┌────────────────────────────────▼───────────────────────────────────┐
│  marketing-api Worker (Hono)                                        │
│  - Auth: LeadOrch JWT cookie validated here too                     │
│  - RLS: sets `app.tenant_id` session var per request                │
│  - CRUD on campaigns, drafts, documents, secrets, usage             │
│  - Workflow + Queue trigger entry points                            │
└────┬────────────────┬───────────────┬───────────────┬──────────────┘
     │                │               │               │
┌────▼────┐  ┌────────▼────────┐  ┌───▼─────────┐  ┌─▼──────────────┐
│ Per-    │  │ Generation      │  │ Publish     │  │ Ingestion      │
│ tenant  │  │ Workflow (CF WF)│  │ Workflow    │  │ Workflow       │
│ DO      │  │ - RAG → LLM →   │  │ - secrets   │  │ - extract      │
│ - state │  │   image/video → │  │   refresh   │  │ - chunk        │
│ - budget│  │   draft         │  │ - cadence   │  │ - embed        │
│ - quota │  │ - guardian      │  │ - metrics   │  │ - upsert       │
│         │  │   judge         │  │   enqueue   │  │   pgvector     │
└─────────┘  └────────┬────────┘  └─────┬───────┘  └──────┬─────────┘
                      │                  │                 │
            ┌─────────▼──────────────────▼─────────────────▼──────┐
            │  Neon Postgres                                       │
            │  - leadorch.*   (LeadOrch app, existing)             │
            │  - marketing.*  (this app; RLS on every table)       │
            │  - umami.*      (own-site analytics)                 │
            │  - pgvector for corpus embeddings (tenant-scoped)    │
            └─────────────────────▲────────────────────────────────┘
                                  │
        ┌─────────────────────────┴────────────────────────┐
        │                                                  │
   ┌────▼───────────┐  ┌────────────────┐  ┌──────────────▼────┐
   │ Channel        │  │ Mail-sync      │  │ Analytics ETL     │
   │ adapters       │  │ service        │  │ - nightly         │
   │ src/adapters/  │  │ src/services/  │  │   BigQuery → DB   │
   │ {hubspot,      │  │  mailsync.ts   │  │ - GSC daily       │
   │  sendgrid,     │  │ SendGrid       │  │ - Umami pulled    │
   │  ga4, gsc,     │  │ webhooks ↔     │  │   on demand       │
   │  google-ads,   │  │ HubSpot        │  │ - Google Ads      │
   │  buffer,       │  │ Timeline       │  │   nightly         │
   │  wix-blog,     │  │ + content_     │  └───────────────────┘
   │  linkedin,     │  │ metrics writes │
   │  meta, x,      │  └────────────────┘
   │  tiktok,       │
   │  gbp, ...}.ts  │
   └────────────────┘
                ↑
                │ R2 stores generated images/video + tenant uploads
```

---

## Database schema (Drizzle, schema `marketing`)

Every table has `tenant_id uuid not null` as the first column. Neon RLS policy on every table: `current_setting('app.tenant_id') = tenant_id::text`. The Worker sets `app.tenant_id` at the start of every request before any query runs.

| Table | Purpose | Key columns |
|---|---|---|
| `tenants` | Tenant registry | `id`, `name`, `slug` (unique), `plan` enum (`free`/`starter`/`pro`/`enterprise`), `monthly_budget_cents` (default 5000), `created_at`, `updated_at` |
| `tenant_secrets` | Per-tenant encrypted credentials per platform | `tenant_id`, `platform`, `encrypted_access_token bytea`, `encrypted_refresh_token bytea`, `token_expires_at`, `scopes text[]`, `updated_at`; PK `(tenant_id, platform)` |
| `tenant_usage` | Monthly per-tenant AI cost + API call accounting | `tenant_id`, `month` (date, truncated to first of month), `ai_tokens_input`, `ai_tokens_output`, `ai_cost_cents`, `images_generated`, `videos_generated`, `emails_sent`, `api_calls`; PK `(tenant_id, month)` |
| `sites` | One row per managed site under a tenant | `id`, `tenant_id`, `domain`, `wix_site_id` (nullable), `timezone`, `parent_config_id` (nullable, optional Kuzey-style inheritance), `created_at` |
| `site_config` | Versioned per-site config blobs (mirrors Kleo's 4 tabs) | `site_id` PK, `tenant_id`, `general jsonb`, `content_focus jsonb`, `brand_voice jsonb`, `plan_preferences jsonb`, `schema_version`, `updated_at` |
| `campaigns` | First-class campaign object | `id`, `tenant_id`, `site_id`, `name`, `type` enum (`product_launch`/`lead_gen`/`evergreen`/`event`/`reactive`), `launch_date` (nullable, used by `product_launch`), `goal_type` enum, `goal_value`, `audience_brief jsonb`, `language_config jsonb`, `channel_config jsonb`, `voice_modifier`, `pillar_id` (nullable FK), `status` enum (`draft`/`active`/`paused`/`completed`), `leadorch_run_id` (nullable cross-schema FK), `created_at`, `updated_at`, `completed_at` |
| `pillars` | Evergreen brand themes (a campaign property, not a competitor concept) | `id`, `tenant_id`, `site_id`, `name`, `description`, `topics jsonb` |
| `documents` | Uploaded tenant docs + git-synced markdown | `id`, `tenant_id`, `source` (`upload`/`git`), `source_filename`, `document_type` enum (`product_doc`/`marketing`/`brand_guideline`/`company_info`/`competitor`/`persona`/`golden_example`/`sales_deck`), `r2_key`, `mime_type`, `version`, `ingested_at`, `superseded_at` (nullable) |
| `document_chunks` | Chunked + embedded content | `id`, `tenant_id`, `document_id`, `chunk_index`, `chunk_text`, `embedding vector(1536)`, `section_title` (nullable), `superseded boolean` default false, `created_at` |
| `content_drafts` | Approval-queue state machine | `id`, `tenant_id`, `campaign_id`, `site_id`, `pillar`, `channel`, `status` enum (`generating`/`pending_review`/`approved`/`scheduled`/`published`/`measured`/`dismissed`/`failed`), `payload jsonb`, `assets jsonb`, `score_human`, `dismiss_reason`, `publish_at`, `published_ref`, `cost_cents` |
| `publish_log` | Cadence enforcement (e.g., LinkedIn ≤1/day) | `tenant_id`, `channel`, `published_at`, `draft_id` |
| `content_metrics` | Multi-window metrics pulled from every analytics layer | `draft_id`, `tenant_id`, `window` enum (`1h`/`24h`/`7d`/`30d`), `impressions`, `clicks`, `engagement`, `attributed_leads`, `fetched_at` |
| `assets` | Generated image/video references in R2 | `id`, `tenant_id`, `r2_key`, `mime`, `generation_params jsonb`, `cost_cents` |

The `content_drafts.status` transitions are explicit functions in `src/queue/transitions.ts` — no implicit state changes (LeadOrch v4 pattern; reuse it).

**Credential encryption**: AES-256-GCM. Master key in Cloudflare Workers Secrets, envelope-encrypted per-tenant data keys. Master key rotated annually via dual-write window. Reuse LeadOrch's `lib/crypto.ts`.

**Cross-schema FK**: `marketing.campaigns.leadorch_run_id → leadorch.runs.id`. Enables H3 integration.

### Critical files to be created

| Path | Purpose |
|---|---|
| `hailmery/src/db/schema.ts` | Drizzle schema for all tables above |
| `hailmery/src/db/rls.sql` | RLS policy DDL applied per migration |
| `hailmery/src/generation/blog.ts` | RAG + prompt-cached Sonnet 4.6; **H1 deliverable hinges on this file** |
| `hailmery/src/generation/social.ts` | Per-platform copy variants |
| `hailmery/src/generation/image.ts` | Router: Ideogram (text overlay) / Imagen (photoreal) / FLUX (security imagery) |
| `hailmery/src/generation/video.ts` | Router: Kling (multi-shot) / Veo (iteration). No Sora. |
| `hailmery/src/generation/email.ts` | Composes campaign emails for SendGrid |
| `hailmery/src/agents/strategist.ts` | Strategist (Claude Sonnet 4.6); reads unified analytics + corpus + campaign brief; outputs JSON brief |
| `hailmery/src/agents/guardian.ts` | Brand guardian (Claude Haiku 4.5); LLM-as-judge + factual validator |
| `hailmery/src/adapters/index.ts` | `ChannelAdapter` interface |
| `hailmery/src/adapters/{hubspot,sendgrid,ga4,gsc,umami,gtm,google-ads,meta-ads,linkedin-ads,buffer,wix-blog,linkedin,x,meta,tiktok,pinterest,threads,gbp}.ts` | One per platform |
| `hailmery/src/services/mailsync.ts` | Bidirectional HubSpot ↔ SendGrid event bridge |
| `hailmery/src/services/secrets.ts` | Encrypt/decrypt + token refresh scheduling |
| `hailmery/src/services/budget.ts` | Per-tenant cost accounting + 429 on overage |
| `hailmery/src/queue/transitions.ts` | State machine; only mutator of `content_drafts.status` |
| `hailmery/src/workflows/generation.ts` | Cloudflare Workflow for generation pipeline |
| `hailmery/src/workflows/publish.ts` | Cloudflare Workflow for publish + cadence + secrets refresh |
| `hailmery/src/workflows/ingestion.ts` | Cloudflare Workflow for document ingestion (extract → chunk → embed → upsert) |
| `hailmery/src/workflows/metrics.ts` | Nightly metrics ETL (BigQuery + GSC + Umami + Google Ads + adapter `fetchMetrics`) |
| `hailmery/src/corpus/sync.ts` | Watches `corpus/{tenant}/{site}/*.md` for git-backed seed corpus |
| `hailmery/src/triggers/{cron,timeline,manual,leadorch,analytics,webhook}.ts` | One per trigger type |
| `hailmery/gtm-templates/*.json` | Pre-built GTM container templates per tenant archetype |
| `corpus/apire/*.md`, `corpus/osm/*.md` | Canonical strategic corpus (git-versioned; structural fix for Kleo's Aug-2025 freeze problem) |

---

## The intelligence loop

End-to-end pass, from a tenant signing up to the AI learning from its own performance:

**1. Ingest.** Tenant uploads PDFs, DOCX, markdown, sales decks, brand guidelines, competitor docs through `/documents`. Files land in R2 at `tenant/{tenant_id}/corpus/{filename}`. The Ingestion Workflow extracts text (pdf-parse / mammoth / Claude vision for images), chunks at 512 tokens with 64-token overlap preserving section metadata, embeds with `text-embedding-3-small`, upserts to `document_chunks` tagged with `document_type`. The git-backed corpus for APIRE/OSM is the same pipeline with `source='git'`.

**2. Configure.** Operator creates a campaign in the dashboard. Required: `name`, `type`, `audience_brief`, `language_config`, `channel_config`, `voice_modifier`. Optional: `launch_date` (required for `product_launch`), `pillar_id`, `goal_type`+`goal_value`, `leadorch_run_id`. If a tenant has no specific campaign, all generation falls back to the auto-created default evergreen campaign.

**3. Plan.** Strategist agent (Claude Sonnet 4.6, prompt-cached) reads: the tenant's `site_config.brand_voice`, the campaign brief, top-k=8 corpus chunks via pgvector cosine on the campaign topic embedding, the latest aggregated `content_metrics` for the tenant ("top 5 themes by engagement in last 30 days"), and any LeadOrch ICP context if the campaign was triggered from a run. Outputs a JSON brief: which channels, how many of each, what timing, what success metric per piece.

**4. Generate.** Specialist sub-agents fan out in parallel (one per channel), each calling the appropriate Claude/OpenAI/Vertex/fal.ai endpoint. Every prompt includes: brand voice rubric, campaign brief, top-5 golden examples retrieved from `document_chunks` where `document_type='golden_example'`, and platform-specific tone constraints. For `product_launch` campaigns, the timeline-phase logic (T-6w / T-4w / T-2w / T-1w / T-0 / T+1w) selects the right content angle automatically.

**5. Guard.** Brand Guardian (Claude Haiku 4.5) scores every draft against the brand voice rubric, banned terms, and a factual validator that scans for product/feature names not present in the corpus (kills Kleo's #1 failure mode — hallucinated feature names like APIRE's W-004). Drafts below threshold are auto-regenerated up to 3× then escalated for human review with the guardian's score and reasoning.

**6. Approve.** Drafts land in `marketing.leadorch.io/review/{draft}`. Side-by-side modal: existing top performer on the left, AI draft on the right. Buttons: Approve & schedule / Edit / Dismiss with reason. Dismiss reasons (preset list: off-brand / factually wrong / hallucinated / generic / off-topic, plus free text) are captured to feed V2's few-shot training pool.

**7. Publish.** PublishWorkflow checks `tenant_secrets.token_expires_at` for the target adapter. If within 24h of expiry, refresh first (Meta 60d, TikTok 24h, LinkedIn 60d, Google 6mo idle). Then call the adapter with an idempotency key (`{draft_id}:{retry_count}`). On success, write `publish_log`. On 429, exponential backoff + per-provider Redis token bucket.

**8. Measure.** Metrics ETL Workflow runs nightly: BigQuery query against the GA4 export (yesterday's sessions, conversions, source/medium), GSC daily sync, Umami pull, Google Ads daily, and per-adapter `fetchMetrics()` for each published draft at 1h/24h/7d/30d windows. SendGrid webhook events arrive in real time and write directly to `content_metrics`. Mail-sync service mirrors them to HubSpot Timeline.

**9. Learn.** Top-decile drafts (by engagement in their window) are auto-tagged `document_type='golden_example'`. Bottom-decile drafts + dismiss reasons become few-shot examples for the Brand Guardian's "what bad looks like" prompt. Performance vectors are written back to memory; the Strategist's next run retrieves "top 5 themes by engagement last 30 days, bottom 5 worst" as part of its context.

**10. Drift check.** Every 20 published pieces per tenant, a drift-check job has Claude compare the latest 10 against the tenant's golden set (semantically + lexically). If divergence exceeds threshold, the tenant gets a banner: "Voice drift detected — review and re-curate golden examples." Auto-generation pauses until acknowledged.

**11. Cross-loop with LeadOrch.** Engagement events with `utm_campaign={campaign_id}` and `utm_content={draft_id}` are joined to `leadorch.contacts` via email hash + UTM cookie. The mail-sync also pushes opens/clicks to LeadOrch's contact timeline. A nightly job populates `leadorch.contact_signals` with hailmery-derived score deltas ("opened 3 emails, no clicks" = +5; "clicked 2 pricing-page links" = +20). LeadOrch's scoring model consumes the column directly.

---

## Phased roadmap

### V0 — weekend, no OAuth, prove content quality
Single APIRE tenant operationally, but the schema is already multi-tenant. Cloudflare local dev, Drizzle pushed to a Neon dev branch.

- `pnpm create` Hono Worker scaffold + Drizzle + Neon dev branch
- Schema: `tenants`, `tenant_secrets` (empty), `sites`, `site_config`, `campaigns`, `pillars`, `documents`, `document_chunks`, `content_drafts` (status enum + payload jsonb)
- RLS policies applied; `app.tenant_id` session-var helper in the Hono middleware
- Seed `tenants` with APIRE and OSM (both as rows; only APIRE used initially); seed `sites` accordingly
- Hand-paste APIRE's canonical strategic corpus into `corpus/apire/*.md` (4-layer architecture names, Ben/Priya/Claudia personas, 27 threat categories, EU/NIS2 positioning)
- `src/corpus/sync.ts` — markdown-only ingestion (defer PDF/DOCX to V1)
- `src/generation/blog.ts` — RAG top-k=8 → prompt-cached Sonnet 4.6 → Markdown frontmatter + body
- `src/agents/guardian.ts` — basic factual validator (scans for product/feature names not in corpus)
- CLI: `pnpm gen blog --tenant apire "topic seed"` → writes `out/apire/{date}-{slug}.md`
- Single settings UI page at `/settings/brand-voice` editing `site_config.brand_voice` (proves the Neon write path through RLS)

**V0 success criterion**: 10 generated APIRE blog drafts that Yigit would publish Monday morning. If they don't pass this taste test, no integration work matters — stop and fix the corpus or prompt.

### V1 — 2–4 weeks, internship-ready
Add the publishing surface + the integration gauntlet. Baran runs his weekly marketing entirely through hailmery on APIRE.

**Day 1 in parallel with build (the OAuth review clock starts now)**:
- Register Google Cloud project + OAuth consent screen
- Submit GBP quota application
- Submit Google Ads developer token application (read-only intent)
- Register Meta, X, TikTok, LinkedIn apps
- Register SendGrid account + domain authentication (SPF/DKIM/DMARC) for OSM and APIRE
- Open HubSpot Free CRM + connect both as test tenants

**Adapters added in V1**:
- `hubspot.ts` (private app token, no review)
- `sendgrid.ts` (API key, webhook receiver)
- `wix-blog.ts` (REST + API key; transitional)
- `buffer.ts` (covers FB/IG/X/LI/Pin/TT temporarily, $5/channel/mo)
- `gbp.ts`, `ga4.ts` (BigQuery query, **not** the GA4 API), `gsc.ts`, `umami.ts`, `gtm.ts`
- `google-ads.ts` — READ-ONLY

**Services and workflows in V1**:
- `services/mailsync.ts` — SendGrid webhooks → `content_metrics` + HubSpot Timeline API; bidirectional unsubscribe propagation within 1h
- `services/secrets.ts` — token refresh scheduling
- `services/budget.ts` — per-tenant cap with 429 enforcement
- `workflows/ingestion.ts` — PDF/DOCX/image ingestion (pdf-parse, mammoth, Claude vision)
- `workflows/metrics.ts` — nightly BigQuery → `content_metrics` aggregation

**UI in V1**:
- Approval queue: pillar dashboards + side-by-side modal + dismiss-reason capture (preset + free text)
- Campaign creation form + default evergreen auto-creation per tenant
- Content calendar (month grid, drag-to-reschedule, color by pillar)
- Per-URL keyword editor (same UX as Kleo's, no 5/day cap)
- Strategy doc generator (`src/strategy/render.ts` Markdown template → Pandoc PDF, regenerated on every settings save)
- Document upload UI + ingestion progress
- Connections page: OAuth + private-app-token connectors with status badges

**Cadence in V1**:
- Cloudflare Cron Trigger every 15min → publish tick
- Every 6h → generation tick (top up queue to depth 5 per pillar per active campaign)
- Nightly 03:00 site-local → metrics tick + BigQuery aggregation + token refresh sweep

**Brand bootstrap flow (new tenant onboarding from V1)**:
- After document ingestion, generate 30 blog drafts + 30 social posts in 3 varied tones (formal/technical, conversational, authoritative)
- Surface in dashboard labeled "Voice Calibration — pick the ones that sound like you"
- User approves 10–20 → tagged `document_type='golden_example'`
- Future generation retrieves top-5 golden examples per campaign type

**Umami in V1**: deployed as a Worker against the Neon `umami.*` schema; script embedded on the APIRE rebuild (and OSM as soon as Baran is ready). Hailmery reads via Umami's API.

**OSM in V1**: brought on mid-V1 once Baran confirms OSM's stack and publishing surface — this forces per-tenant config to be real, not aspirational. Pending questions for Baran are tracked under the V0/V1 onboarding task.

### V2 — 2–3 months, native social + intelligence
As each OAuth review clears, swap Buffer → native adapter via `plan_preferences.publish_via` flag per channel. Expected order: LinkedIn → X → Meta → TikTok → Pinterest.

- **Meta caveat**: BUC quota is engagement-gated. APIRE has near-zero IG engagement, so the quota will be tiny for ~60d post-approval. Keep Buffer in the IG path during that ramp.
- **TikTok submission framing**: "marketing assistant with human approval queue" — show the approval modal in the screencast. "AI auto-publisher" framing gets rejected.
- **Google Ads — write capabilities**: A/B ad copy generation, negative-keyword suggestions, budget reallocation recommendations. Still gated on human approval; no autonomous spend in V2.
- **Reactive triggers active**: GSC keyword spike → reactive blog campaign. Analytics anomaly → variant-B generation. External webhooks registered (Stripe payment events, new Wix product, Shopify order milestone).
- **Brand drift check** runs every 20 pieces.
- **Multi-site UI**: tenant switcher in top nav + sub-site switcher. Per-tenant config import wizard for additional Kuzey sites if Baran wants them onboarded.
- **Approval queue at scale**: silently introduce bulk-approve + auto-approve-high-confidence thresholds (Guardian score >0.9 → optional auto-approve per channel).

### V3 — 3–6 months, LeadOrch integration + public SaaS
The product becomes irreplaceable when the integration ships.

- **Cross-schema FK live**: `marketing.campaigns.leadorch_run_id` → `leadorch.runs.id`
- **Webhook**: LeadOrch `run.completed` → hailmery creates a `lead_gen` campaign with `audience_brief` populated from LeadOrch's `ICPStrategy` JSON (no duplicate persona modeling)
- **Retargeting integration**: LeadOrch's discovered companies → Meta Custom Audience + LinkedIn Matched Audience via the Ads adapters; refreshed weekly. Engagement triggers warmer audiences.
- **Engagement → lead score**: `marketing.engagement_signals` joins `content_metrics` to `leadorch.contacts` via UTM + email-hash matching. Nightly job populates `leadorch.contact_signals`.
- **Public surface**: LeadOrch admin dashboard absorbs marketing-engine tabs (shared design system makes this near-free). Single demo flow: "Discover → Attract → Score → Close."
- **Public SaaS launch**: `/onboarding` route — enter company, domain, upload brand documents, connect first platform (Google), choose plan. Stripe billing per plan. Per-tenant budget enforcement is the foundation for usage-based pricing.
- **Monorepo graduation**: hailmery + LeadOrch + OSM rebuilt into a single pnpm workspace with shared design system, shared types, shared auth. ~1–2 weeks of refactor that pays for itself in every cross-app feature thereafter.

---

## Hard decisions (locked recommendations + rationale)

| Decision | Locked answer |
|---|---|
| Code organization | Three sibling repos (`hailmery/`, `ctact/`, `osm/`), shared Neon DB. Graduate to monorepo at H3. |
| Multi-tenancy | Shared Neon, single `marketing.*` schema, `tenant_id` on every row, Neon RLS enforced. From day 1. |
| HubSpot | Reintegrated as tenant-connectable CRM. Mail sync with SendGrid is a core feature. Fallback for non-HubSpot tenants = LeadOrch contacts + Listmonk. |
| Email delivery | SendGrid for all marketing email (clean IPs, SPF/DKIM/DMARC per tenant domain). Resend only for system emails. |
| Mail sync | Bidirectional HubSpot ↔ SendGrid event sync via `src/services/mailsync.ts`. SendGrid webhooks → hailmery → HubSpot Timeline + Engagement APIs. Unsubscribes propagate both ways within 1h. |
| Analytics: own sites (OSM, APIRE) | Umami self-hosted on Neon (`umami.*` schema). Cookieless, GDPR-native, free, no token limits. |
| Analytics: tenant sites | GA4 → BigQuery export. Read from BigQuery only. GSC API for keyword/impression data. |
| Tag management | GTM with pre-built hailmery container templates per tenant archetype. |
| Orchestrator | Custom Cloudflare Workflows. No n8n. |
| Paid ads V1 | Read-only Google Ads adapter. No automated spend until V2 + developer token approval. |
| Social bridge | Buffer ($5/channel/mo) temporary during OAuth review window. Swap to direct adapters per platform as reviews clear. |
| Primary content AI | Claude Sonnet 4.6 (text); Opus 4.7 (quarterly strategy); Haiku 4.5 (classification + guardian). Ideogram 3.0 (image, text-in-image wins); Imagen 4 (photoreal); FLUX.2 [pro] (open-model fallback). Kling 3.0 Standard (video, multi-shot); Veo 3.1 Fast (iteration). **Sora REMOVED — API dies 2026-09-24.** |
| Campaign model | Campaigns are top-level. Types: `product_launch / lead_gen / evergreen / event / reactive`. Default evergreen campaign auto-created per tenant. Pillars are a property on campaigns (`campaigns.pillar_id`), not a competing concept. |
| Brand corpus | Git-backed markdown for APIRE/OSM bootstrap + user upload pipeline (PDF/DOCX/MD/images) for all tenants. |
| Brand bootstrapping (no golden examples) | Hybrid: ingest existing docs for factual grounding + 60-draft AI voice-calibration flow → user picks 10–20 → those become the tenant's golden set. |
| Wix Blog API | Transition adapter only. Removed when APIRE rebuilds onto Cloudflare. |
| HubSpot pricing trap | Hard-cap tenant HubSpot plan at Starter ($20/mo). Never recommend Pro ($3K onboarding). |
| Zoho | Study as architectural reference (ecosystem-as-product). Do not integrate. |
| ICP for hailmery SaaS | Founders and lean teams overwhelmed by digital marketing chaos. "Focus on product, AI handles marketing." |
| Horizons | H1 — internship proof (APIRE quality test). H2 — standalone tool (OSM + APIRE). H3 — LeadOrch integration + public SaaS launch. |
| LeadOrch connection | Shared Neon DB, cross-schema FK `marketing.campaigns.leadorch_run_id → leadorch.runs.id`. `run.completed` webhook → hailmery creates `lead_gen` campaign. |
| LLM vendor lock | Claude direct via Anthropic SDK, no abstraction. Prompt caching is Claude-specific and central to the cost model. |
| Metrics ingestion timing | Live in V1 even before learning prompt-injection lands in V2 (so V3 has historical data ready). |

---

## Known weaknesses (build with mitigations in place)

| Weakness | Mitigation built into design |
|---|---|
| **Hallucinated feature names** (Kleo's W-004 on APIRE) | Brand Guardian factual validator scans for product/feature names not present in corpus; flags for human review. ~50 LOC, kills the #1 Kleo failure mode. |
| **Corpus drift / silent staleness** (Kleo's Aug-2025 freeze) | Git-backed corpus + quarterly `followup` skill reminder. Every change is a commit. |
| **Brand voice drift after 50+ posts** | Retrieve top-5 golden examples on every generation; every 20 new posts run drift check (Claude compares latest 10 against golden set). |
| **OAuth review chicken-and-egg** | Buffer fallback in V1 + submit reviews day 1. Don't gate the product on review timelines. |
| **Google Ads developer token review (2–4 wks, sometimes more)** | Submit day 1 of V1. Build V1 in read-only mode. Real automation in V2. |
| **BUC engagement throttle** (new Meta apps get tiny quotas) | Keep Buffer in IG path for ~60d post-Meta-approval. |
| **TikTok SELF_ONLY mode until audit clears** | Buffer covers TikTok during this period. Frame app submission as "marketing assistant with mandatory human approval queue." |
| **Dirty sender IP killing email deliverability** | SendGrid with per-tenant domain auth (SPF/DKIM/DMARC). Dedicated subuser IP for tenants >10k emails/month. |
| **SendGrid shared pool contamination** | Monitor bounce + spam-report rates per tenant. Auto-pause sending if spam rate > 0.08% (Google/Yahoo 2024 threshold). |
| **Mail sync desync on unsubscribes** | Propagate unsubscribes bidirectionally within 1h via webhooks. Log every unsubscribe event. Compliance-critical. |
| **GA4 25,000 API token/day quota** | Never query GA4 API from UI. Read from BigQuery export only. Pre-aggregate nightly. |
| **GSC 75% impression data gap** (known platform limitation per Indig Feb 2026) | Supplement with Umami (own sites) + platform metrics. Never treat GSC as the sole source of truth. |
| **GSC URL Inspection 2K/day cap** | Cache aggressively, inspect on-demand only (post-publish or keyword edit), never sitewide sweep. |
| **HubSpot $3K onboarding cliff** | Hard-cap tenant HubSpot recommendation at Starter. Build own pipeline CRM in LeadOrch to replace Pro features. |
| **OAuth token storage = juicy target** | AES-256-GCM with master key in Workers Secrets, envelope encryption per tenant. Reuse LeadOrch's `lib/crypto.ts`. Never log tokens. |
| **Image content-policy rejections** (Imagen rejects some security imagery) | FLUX.2 fallback router for security-domain prompts. |
| **Generic AI-stock image style** (Kleo's failure on APIRE) | Brand-voice tab includes `image_style` field with example references; Ideogram prompt template includes per-tenant style block. |
| **No cross-site config in Kleo** | Per-tenant by default + optional `parent_config` inheritance for the Kuzey case (29 sites can share a Kuzey-level base). |
| **Dismiss-reasons thrown away** (Kleo) | First-class field on dismiss; preset reasons + free text; becomes V2 few-shot training. |
| **No learning loop** (Kleo's biggest flaw) | Metrics in V1, learning prompt-injection in V2, full closed loop with LeadOrch in V3. |
| **Wix Blog API undocumented edges** | Prototype publish→fetch round-trip in V0 before depending on it in V1. |
| **Campaign timeline generation starting late** | At `product_launch` campaign creation, immediately generate T-6w content. Do not wait for the cron tick — urgency mode. |
| **Cloudflare cold-start on rare admin opens** | Acceptable for operator tool (5×/day). Cron triggers warm the worker enough. |
| **Sora 2 API shutdown 2026-09-24** | Already excluded from the stack. Kling 3.0 + Veo 3.1 Fast are the only video models. |

---

## LeadOrch integration (H3) — design specifics

LeadOrch lives at `~/Desktop/ctact` (Cloudflare Workers + Hono + Neon + Drizzle, same as hailmery). v4 ICP Discovery is live with two Cloudflare Workflows (`PipelineWorkflow`, `ICPDiscoveryWorkflow`) and admin telemetry.

- **Shared DB, separate schemas**: both apps point to the same Neon instance; cross-schema FK `marketing.campaigns.leadorch_run_id → leadorch.runs.id`.
- **Auth share**: LeadOrch's session cookie validates on the hailmery Worker (read the existing JWT; don't rebuild auth).
- **Webhook**: LeadOrch fires `run.completed` → hailmery creates a `lead_gen` campaign with `audience_brief` populated from `ICPStrategy` JSON (enriched personas, Apollo-friendly tags, competitor keywords).
- **Engagement → lead score**: nightly job joins `content_metrics` → `leadorch.contacts` via UTM (`utm_campaign={campaign_id}` + `utm_content={draft_id}`) and hashed email match for HubSpot/SendGrid opens. Updates `leadorch.contact_signals` consumed by the scorer.
- **Custom Audience upload**: LeadOrch's discovered companies/contacts → Meta Custom Audience + LinkedIn Matched Audience via the Ads adapters. Refresh weekly.
- **Demo dashboard**: at H3 end, one Pages app shows the whole funnel — "Discover (LeadOrch) → Attract (hailmery) → Score (LeadOrch) → Close." Public demo for the combined product.

Traps already learned in LeadOrch v4 (see `~/.claude/projects/-Users-xxxyxxx/memory/project_ctact.md`) carry over:
- AsyncLocalStorage does NOT cross Workflow `step.do()` boundaries — thread `runContext` explicitly
- Drizzle raw SQL can't serialize JS arrays — use `sql.join(arr.map(v => sql\`${v}\`), sql\`, \`)`
- Apollo `mixed_companies/search` is sparse — use `organizations/search`

---

## Build vehicle (decide at start of V0)

Two real options:

- **crew-mcp run** (`~/Desktop/crew-mcp/`) — V0 is greenfield + parallelizable (schema + generation + ingestion + CLI + 1 UI tab); maps to `backend` + `frontend-design` + `generic` subroles. Spawn 4 worker tabs, Lead orchestrates, validator stage catches drift. Caveat: crew-mcp can't do OAuth setup or live integration tests; those stay on main thread.
- **Main-thread Claude** — slower but tighter; better if you want to learn the codebase as it's built or pause/redirect mid-build.

Recommendation when V0 starts: **crew-mcp for V0** (clean greenfield, parallelizable), **main-thread for V1 OAuth dance**, **crew-mcp for V2 native-adapter fan-out** (one adapter per run, validator checks interface match).

---

## Verification (how to know each phase landed)

### V0
- `pnpm gen blog --tenant apire "AI security for EU CISOs facing NIS2"` produces a Markdown file in `out/apire/`
- Read 10 generated drafts side-by-side with Kleo's last 10 APIRE blog posts. **Manual taste test: do these read like APIRE (canonical 4-layer names, Ben/Priya/Claudia personas, EU/NIS2 framing) or generic AI slop?**
- Settings UI saves brand voice → next generation reflects it
- No hallucinated feature names (Brand Guardian validator over the 10 drafts)
- Wix Blog publish→fetch round-trip works end-to-end (prototype)
- RLS confirmed: cross-tenant query returns zero rows when `app.tenant_id` is set to a different tenant

### V1
- Baran publishes a week's content end-to-end through hailmery on APIRE (blog → social → email → GBP post) without touching Kleo
- Approval queue dismiss-reasons populating
- GA4 (via BigQuery) + GSC + Umami + SendGrid metrics flowing into `content_metrics` nightly
- Mail sync confirmed: SendGrid open event appears on the matching HubSpot contact's Timeline within 1 minute
- Strategy PDF regenerates on settings save
- Cadence enforcement blocks a 2nd LinkedIn post in the same day
- All 6 OAuth review submissions are in the pipeline
- Document ingestion: a tenant can upload a PDF and see chunks in pgvector within 5 minutes
- Brand bootstrap flow: a new tenant completes voice calibration in <30 minutes
- Per-tenant budget cap fires 429 when exceeded

### V2
- Each native adapter swap is a one-line config change; no business logic touched
- Meta IG quota usable (>10 posts/day) after engagement ramp
- Google Ads campaign creates + budget + A/B copy rotates (with human approval)
- OSM + APIRE both fully operated through hailmery; 2–3 additional Kuzey sites onboarded
- Drift check produces actionable signal at the 20-post threshold

### V3
- LeadOrch run completion triggers hailmery generation for the discovered ICP
- LeadOrch admin shows engagement-derived lead-score signal column
- Top-decile generated content auto-feeds next generation as "good examples"
- One unified demo dashboard ships
- First non-Kuzey tenant signs up via the public onboarding flow and produces published content within 1 week

---

## Critical files reference

- `~/Desktop/baran-context/wix-marketing-agent/wix-structure.md` — full Kleo operating manual (parity target)
- `~/Desktop/ctact/` — LeadOrch repo; integration target and stack template
- `~/Desktop/crew-mcp/` — optional build vehicle; read its `CLAUDE.md` before invoking
- `~/Desktop/icp-gold-standards/` — LeadOrch's ICP ground truth; same library can grade hailmery's audience targeting at H3
- `~/.claude/projects/-Users-xxxyxxx/memory/reference_wix_operating_manual.md` — pointer index to the Wix docs
- `~/.claude/projects/-Users-xxxyxxx/memory/project_ctact.md` — LeadOrch state, traps, deploy commands
- `~/.claude/plans/swirling-tumbling-bengio.md` — the rewrite spec that produced this PLAN.md (analysis + locked decisions + verification matrix)
