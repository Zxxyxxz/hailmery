# Kleo Replacement → LeadOrch-Integrated Marketing Engine

## Context

Yigit is the developer for Baran's Kuzey Global Wix agency (29 sites; OSM + APIRE are the marketing focus). Today both sites rely on Wix Studio's AI Marketing Agent ("Kleo") for SEO, social, paid ads, email, and the Marketing Strategy doc. Kleo has documented failure modes on APIRE (hallucinated feature names, TOFU-only keywords, generic AI-stock images, strategy doc frozen Aug 2025, only 1/8 social platforms connected, no learning loop, no CMS grounding). The internship goal is to replace Kleo with a self-hosted tool Yigit owns end-to-end, prove it on OSM/APIRE during the internship, then graduate it into a real product that integrates with LeadOrch (`leadorch.io`, the Cloudflare-Workers B2B lead-gen SaaS Yigit already ships).

The combined product is the **closing loop** for LeadOrch: LeadOrch finds the right companies/people → this engine attracts them and warms them with content + retargeted ads → engagement signals feed back to LeadOrch for lead-scoring. Neither product half exists in the market in a single tool.

This plan is the full technical blueprint: stack, architecture, build phases, integration timeline, and known weaknesses. It is deliberately long — Yigit asked for a reference doc he can return to, not a one-pager.

---

## Goals (three horizons)

| Horizon | Outcome | Time | Success criterion |
|---|---|---|---|
| **H1 — Internship demo** | Generates publishable SEO/social drafts for OSM & APIRE that beat Kleo's quality. No live publishing yet. | 1 weekend → 2 wks | 10 blog drafts + 30 social drafts Baran would actually post. |
| **H2 — Standalone tool** | Full pillar coverage, approval queue, direct publishing to Wix Blog + Buffer-fronted social + HubSpot + Google Business + GA4/GSC read. Per-site config for OSM/APIRE first, all 29 Kuzey sites possible. | 4–10 wks (OAuth review on critical path) | Baran uses it daily; Kleo retired on OSM/APIRE. |
| **H3 — LeadOrch-integrated engine** | Shared Neon DB; LeadOrch ICP runs trigger persona-targeted content + retargeting; engagement metrics flow back to LeadOrch as lead-score signals. Native social adapters replace Buffer. Learning loop closes. | 3–6 mo | LeadOrch demo shows "discover → attract → score → close" in one dashboard. |

---

## Recommended tech stack

The single most important decision: **match LeadOrch's stack exactly** so integration is free, deploy/ops mental model carries over, and Yigit reuses his own muscle memory.

### Runtime
- **Cloudflare Workers + Hono** (TypeScript) — same as LeadOrch backend
- **Cloudflare Workflows** for long-running generation jobs (parity with LeadOrch's `PipelineWorkflow` / `ICPDiscoveryWorkflow`). Critical lesson already learned: AsyncLocalStorage does NOT cross `step.do()` boundaries — thread `runContext` explicitly (see [project_ctact.md](../projects/-Users-xxxyxxx/memory/project_ctact.md))
- **Durable Objects** for per-site state machines (one DO per site = natural sharding for 29 Kuzey sites)
- **Cloudflare Queues** for scheduled publish ticks (cron triggers fan out into queues)
- **R2** for generated images/video assets (cheap, no egress; behind a CDN signed URL)

### Data
- **Neon Postgres + Drizzle ORM** — same instance as LeadOrch (separate schema `marketing.*` so the join story works without cross-DB pain)
- **sqlite-vec is the wrong call here** (no Cloudflare native support); use **`pgvector`** in the same Neon DB for the corpus embeddings
- **Embeddings**: OpenAI `text-embedding-3-small` ($0.02/1M tokens) — cheapest reasonable option; Voyage AI is the upgrade path if quality bites

### Frontend
- **Cloudflare Pages** (React 19 + Vite + Tailwind) — same as LeadOrch admin. Shared design tokens with LeadOrch admin from day 1 so H3 can absorb the UI into one dashboard
- **shadcn/ui + Recharts** (Recharts already in LeadOrch; reuse the charting setup)
- **TanStack Query** for the few client-reactive surfaces (approval queue, calendar)

### Content generation (validated Apr 2026 pricing)
- **Text**: **Claude Sonnet 4.6** ($3/$15 per Mtok, 1M ctx, prompt caching 90% off cached input) is the workhorse. **Claude Opus 4.7** for the quarterly Marketing Strategy regeneration only — its reasoning is worth $25/Mtok output for the 10×/yr strategy pass. **Claude Haiku 4.5** ($1/$5) for cheap classification (e.g., "is this draft on-brand?"). Estimated $0.07–0.15 per blog post.
- **Images**: **Ideogram 3.0** ($0.06/image) is primary — only model with reliable in-image text rendering, which kills 80% of manual edits. **Imagen 4** ($0.04) for photoreal hero images. **FLUX.2 [pro]** via Replicate ($0.015 base) as the open-model fallback for security-domain imagery that Sora/Imagen content policies sometimes reject.
- **Video**: **Kling 3.0 Standard** ($0.084/sec, multi-shot up to 15s) for social reels — cheapest legitimate path and multi-scene is exactly what social wants. **Sora 2** ($0.10/sec, native audio) when audio matters. **Veo 3.1 Fast** ($0.15/sec) as iteration engine.
- **Budget envelope**: ~$16/mo for the H1 cadence (50 blog/100 image/20 video); ~$80/mo at H2 cadence across two sites.

### External integration layer (the OAuth gauntlet)
- **Google stack** (GA4 + Search Console + Google Business Profile + YouTube + Google Ads): 1 OAuth app, no review for analytics; GBP needs quota application; Google Ads needs developer token. Submit GBP application **V1 day 1**.
- **Meta Graph API** (Facebook + Instagram): 2–4 wk review, BUC quota engagement-gated (newbie apps throttled regardless of approval).
- **X v2**: pay-per-use $0.01/post (better than $200/mo Basic for low volume).
- **LinkedIn**: 1–2 wk review, ~1 post/day algorithmic ceiling.
- **TikTok**: 2–6 wk review, must frame as "marketing assistant with human approval queue" to pass content review.
- **Pinterest**: trial tier useless, standard tier pricing opaque — defer to H2.
- **Buffer**: $5/channel/mo aggregator covers FB/IG/X/LI/Pin/TT — **deliberate V1 fallback** to publish socially during the 4–10wk review wait.
- **HubSpot**: free tier (5 active contacts) or $50/mo Starter; private app, no review.

### Why NOT Node + Hetzner (the obvious alt I'd usually pick)
Cloudflare Workers has cold-start downsides for low-volume cron, but: LeadOrch already runs there, integration is the long game, Yigit ships Workers code weekly, and Hetzner adds a second ops surface. The 50ms cold-start cost is invisible for a marketing tool the operator opens 5×/day.

---

## System architecture

### Component map (mirrors LeadOrch's separation)

```
┌─────────────────────────────────────────────────────────────────┐
│  Cloudflare Pages — admin UI (React 19 + Vite + Tailwind)       │
│  Routes: /sites/[id]/settings · /pillars/[p] · /review/[draft]  │
│          /calendar · /keywords · /strategy · /analytics         │
└──────────────────────────────┬──────────────────────────────────┘
                               │ Hono server actions / REST
┌──────────────────────────────▼──────────────────────────────────┐
│  marketing-api Worker (Hono) — auth, CRUD, queue triggers       │
└────┬───────────────────┬───────────────────┬────────────────────┘
     │                   │                   │
┌────▼─────┐   ┌─────────▼─────────┐   ┌─────▼──────────────┐
│ Per-site │   │ GenerationWorkflow│   │ PublishWorkflow    │
│ DO       │   │ (Cloudflare WF)   │   │ (Cloudflare WF)    │
│ — state  │   │ — RAG → LLM →     │   │ — adapter.publish  │
│ — quota  │   │   image/video →   │   │ — quota check      │
│ accting  │   │   draft           │   │ — metrics enqueue  │
└──────────┘   └─────────┬─────────┘   └─────┬──────────────┘
                         │                   │
                ┌────────▼───────────────────▼─────────┐
                │  Neon Postgres (schema: marketing.*) │
                │  + pgvector for corpus embeddings    │
                │  Shared instance with LeadOrch       │
                └──────────────────────────────────────┘
                         ▲
                         │ R2 stores generated images/video
                ┌────────┴───────────┐
                │ Channel adapters   │ (one file per platform)
                │ src/adapters/*.ts  │
                └────────────────────┘
```

### Database schema (Drizzle, schema `marketing`)

| Table | Purpose | Key columns |
|---|---|---|
| `sites` | One row per Kuzey site under management | `id`, `domain`, `wix_site_id`, `timezone`, `created_at` |
| `site_config` | Mirrors Kleo's 4 settings tabs as versioned JSON blobs | `site_id`, `general`, `content_focus`, `brand_voice`, `plan_preferences`, `schema_version`, `updated_at` |
| `site_corpus` | Canonical strategic chunks (git-backed → DB) | `site_id`, `source_path`, `chunk_text`, `embedding vector(1536)`, `updated_at` |
| `content_drafts` | Approval-queue state machine | `id`, `site_id`, `pillar`, `channel`, `status enum`, `payload jsonb`, `assets jsonb`, `score_human`, `dismiss_reason`, `publish_at`, `published_ref`, `cost_cents` |
| `publish_log` | Cadence enforcement (LinkedIn ≤1/day, TikTok ≤20/day) | `site_id`, `channel`, `published_at`, `draft_id` |
| `content_metrics` | Pulled from GA4/GSC/adapter `fetchMetrics()` | `draft_id`, `window`, `impressions`, `clicks`, `engagement`, `attributed_leads`, `fetched_at` |
| `assets` | Reference into R2 | `id`, `r2_key`, `mime`, `generation_params jsonb`, `cost_cents` |

The `content_drafts.status` enum is the integrity backbone: `generating → pending_review → approved → scheduled → published → measured`, plus terminal `dismissed` and `failed`. Transitions are explicit functions in `src/queue/transitions.ts` — no implicit state changes (LeadOrch v4 enforces this pattern; reuse it).

### Critical files to be created

| Path | Purpose |
|---|---|
| `marketing-app/src/db/schema.ts` | Drizzle schema for the tables above |
| `marketing-app/src/generation/blog.ts` | RAG + prompt-cached Sonnet 4.6; **the H1 deliverable hinges on this file** |
| `marketing-app/src/generation/social.ts` | Per-platform copy variants (LI long-form vs X short vs IG caption) |
| `marketing-app/src/generation/image.ts` | Router: Ideogram for text-overlay, Imagen for photoreal, FLUX for security imagery |
| `marketing-app/src/generation/video.ts` | Router: Kling for multi-shot, Sora for audio, Veo for iteration |
| `marketing-app/src/adapters/index.ts` | `ChannelAdapter` interface: `draft / publish / fetchMetrics / listExisting / quotaState` |
| `marketing-app/src/adapters/{wix-blog,buffer,hubspot,gbp,ga4,gsc,linkedin,meta,x,tiktok}.ts` | One per platform; all conform to interface |
| `marketing-app/src/queue/transitions.ts` | State machine; only place that mutates `content_drafts.status` |
| `marketing-app/src/workflows/generation.ts` | Cloudflare Workflow for generation pipeline |
| `marketing-app/src/workflows/publish.ts` | Cloudflare Workflow for publish + cadence check |
| `marketing-app/src/corpus/sync.ts` | Watches `corpus/{site_id}/*.md` git repo, embeds + upserts to `site_corpus` |
| `corpus/osm/*.md`, `corpus/apire/*.md` | Canonical strategic corpus (git-versioned, the structural fix for Kleo's freeze problem) |

---

## Phased roadmap

### V0 — One weekend, no OAuth, prove content quality

Single-site (APIRE), Cloudflare local dev, Drizzle pushed to a Neon dev branch, generation engine wired to Sonnet 4.6 with prompt-cached APIRE corpus. **Output is Markdown files to a `out/` directory** — no publishing, no UI beyond a settings page.

The weekend's success criterion is: **10 generated blog drafts that Yigit would actually publish on APIRE Monday morning.** If Sonnet + the APIRE corpus + the brand-voice prompt doesn't pass this taste test, no amount of integration scaffolding helps. Stop and fix the corpus/prompt before building V1.

Concretely:
1. `pnpm create` Hono Worker scaffold + Drizzle + Neon dev branch
2. Schema: `sites`, `site_config`, `site_corpus`, `content_drafts` (status enum + payload jsonb)
3. Seed `sites` with APIRE; hand-paste APIRE's canonical strategic corpus into `corpus/apire/*.md` (4-layer architecture names, 3 personas Ben/Priya/Claudia, 27 threat categories from CMS, positioning)
4. `src/corpus/sync.ts` — embed + upsert
5. `src/generation/blog.ts` — RAG top-k=8 → prompt-cached Sonnet 4.6 → Markdown frontmatter + body
6. CLI: `pnpm gen blog "topic seed"` → writes `out/{date}-{slug}.md`
7. One UI page at `/settings/brand-voice` that edits `site_config.brand_voice` (proves the Neon write path)

### V1 — 2–4 weeks, internship-ready

Add the publishing surface for OSM and APIRE. Goal: Baran can run his weekly marketing entirely through this tool, publishing to Wix Blog + social (via Buffer) + Google Business + HubSpot email.

- **Day 1 actions (in parallel with build)**: register Google Cloud project + OAuth consent screen, apply for GBP quota, register Meta app, X dev account, TikTok dev account, LinkedIn app. The 4–10wk OAuth review clock starts NOW because H2 depends on it.
- **Adapters (V1)**: `wix-blog.ts` (REST + API key, no review), `buffer.ts` (covers FB/IG/X/LI/Pin/TT via single $5/channel/mo account), `gbp.ts`, `hubspot.ts`, `ga4.ts` (read), `gsc.ts` (read)
- **Approval queue UI**: pillar dashboards + side-by-side modal (existing top performer left, AI draft right, Approve/Dismiss/Regenerate). **Capture dismiss-reason as training data** — Kleo throws this away; we keep it for the H3 learning loop.
- **Scheduler**: Cloudflare Cron Trigger every 15min → publish tick; every 6h → generation tick (top up queue to depth 5 per pillar); nightly 03:00 site-local → metrics tick.
- **Per-URL keyword editor**: same UI as Kleo's, no 5/day cap (that was business-model, not technical).
- **Strategy doc generator**: `src/strategy/render.ts` Markdown templating → Pandoc PDF, regenerated on every settings save.
- **Content calendar view**: month grid, drag-to-reschedule, color by pillar.
- **Second site**: add OSM mid-V1 — forces per-site config to be real, not aspirational.

### V2 — 2–3 months, native social adapters land

As each OAuth review clears, swap Buffer → native adapter via the `plan_preferences.publish_via` flag (per-channel). Expected approval order: LinkedIn → X → Meta → TikTok → Pinterest.

- **Meta caveat**: BUC quota is engagement-gated. APIRE has near-zero IG engagement so the quota will be tiny for ~60d post-approval. Keep Buffer in the IG path during that ramp.
- **TikTok submission framing**: "marketing assistant with human approval queue" — show the approval modal in the screencast. "AI auto-publisher" framing gets rejected.
- **Google Ads adapter**: this is its own beast (Customer Match audiences, conversion uploads, budget allocation, A/B copy rotation, negative-keyword maintenance). Schedule its own 3–4wk sub-project.
- **Multi-site UI**: site switcher in the top nav. Drop a per-site config import wizard for the remaining 27 Kuzey sites if Baran wants them onboarded.

### V3 — 3–6 months, LeadOrch integration + learning loop

This is where the project becomes irreplaceable. **The integration is the differentiator.**

**Schema merge**: `marketing.content_drafts` and `leadorch.runs` already share the same Neon instance. Add:
- `marketing.audience_targets` — references `leadorch.runs.id`; tells the engine "generate content for the ICP this LeadOrch run discovered"
- `marketing.engagement_signals` — joins `content_metrics` to `leadorch.contacts` via UTM + email-hash matching; feeds back as a lead-score signal

**Generation triggers**:
- New LeadOrch run completes → if the ICP has ≥5 scored companies, enqueue a `GenerationWorkflow` for persona-targeted content (blog + LinkedIn post + retargeting ad copy)
- Use LeadOrch's `ICPStrategy` output (enriched personas + competitor keywords) directly as the generation prompt's audience block — no duplicate persona modeling

**Closing the loop (learning)**:
- Engagement metrics from `content_metrics` join to LeadOrch's `runs` → "HSBC contacts who opened this email get +15 lead score"
- The top-decile generated content (by metric) becomes the auto-populated "good examples" block in the next generation's prompt — this is the single biggest improvement over Kleo, which has no feedback signal at all
- Dismiss-reasons collected since V1 become a separate few-shot training set: "don't generate like this"

**Retargeting integration**:
- LeadOrch's discovered companies → Meta Custom Audience + LinkedIn Matched Audience upload (via the Ads adapter)
- Engagement triggers warmer audiences (e.g., "people who read 2+ blog posts → high-intent audience")

**Public-surface**:
- LeadOrch admin dashboard absorbs marketing-engine tabs (shared design system makes this near-free)
- Single demo flow: "Find ideal customers → publish content they'll see → score who engages → close" in one screen

---

## Hard decisions (locked recommendations + rationale)

1. **Stack alignment with LeadOrch**: **Cloudflare Workers + Hono + Neon Drizzle + Pages.** Rationale: shared Neon instance enables H3 integration without ETL, Yigit already ships this stack, ops surface stays single. Cost: 50ms cold start, no native cron persistence (mitigated by DOs and Workflows).
2. **Wix Blog API vs self-hosted blog**: **Wix Blog API for H1+H2.** OSM/APIRE's SEO equity lives on Wix domains; moving forfeits ranked URLs. Accept lock-in.
3. **Per-site config from day 1**: **Yes**, even though V0 has one site. Schema cost = one foreign key; retrofit is painful. Kuzey's 29 sites = forcing function.
4. **Buffer in V1**: **Yes, via adapter interface.** It's a feature, not a hack — buys 2 months of social publishing during OAuth review.
5. **Solo vs multi-tenant SaaS**: **Single-tenant through H2.** H3's LeadOrch integration is the productization move; if H3 becomes a sellable product, multi-tenant in H4. Don't pay the 3× scope multiplier early.
6. **LLM vendor lock**: **Claude direct via Anthropic SDK**, no abstraction. Prompt caching is Claude-specific and central to the cost model.
7. **Canonical corpus = git-backed Markdown** at `corpus/{site_id}/*.md`. Every change has a diff and a date. **This is the single most important anti-Kleo decision** — it's why Kleo's APIRE strategy froze in Aug 2025.
8. **Metrics ingestion in V1, learning prompt-injection in V2**: deferring metrics means H3 has no historical data. The learning prompt is one template change once data exists.

---

## Known weaknesses (build with mitigations in place)

| Weakness | Mitigation built into design |
|---|---|
| **Hallucinated feature names** (Kleo's W-004 on APIRE) | Post-generation validator scans for product/feature names not present in corpus; flags for human review. ~50 LOC, kills the #1 Kleo failure mode. |
| **Corpus drift / silent staleness** (Kleo's Aug-2025 freeze) | Git-backed corpus + quarterly `followup` skill reminder. Every change is a commit. |
| **OAuth review chicken-and-egg** | Buffer fallback in V1 + submit reviews day 1. Don't gate the product on review timelines. |
| **BUC engagement throttle** (new Meta apps get tiny quotas) | Keep Buffer in IG path for ~60d post-Meta-approval. |
| **TikTok content category rejection risk** | Frame as "marketing assistant with approval queue", show modal in screencast. |
| **GSC URL Inspection 2K/day cap** | Cache aggressively, inspect on-demand only (post-publish or keyword edit), never sitewide sweep. |
| **GA4 token budget burn** | Pre-aggregate nightly into `content_metrics`; never query GA4 from UI. |
| **OAuth token storage = juicy target** | Encrypt at rest with key in Workers secret store; reuse LeadOrch's `lib/crypto.ts` pattern. Never log tokens. |
| **Image content-policy rejections** (Sora/Imagen reject security imagery) | FLUX.2 fallback router for security-domain prompts. |
| **Generic AI-stock image style** (Kleo's failure on APIRE) | Brand-voice tab includes `image_style` field with example references; Ideogram prompt template includes per-site style block. |
| **No cross-site config in Kleo** | Per-site by default but with optional `parent_config` inheritance for the Kuzey case (29 sites can share a Kuzey-level base; per-site overrides). |
| **Dismiss-reasons thrown away** (Kleo) | First-class field on dismiss; preset reasons (off-brand / factually wrong / hallucinated / generic / off-topic); becomes V3 few-shot training. |
| **No learning loop** (Kleo's biggest flaw) | Metrics in V1, learning prompt-injection in V2, full closed loop with LeadOrch in V3. |
| **Wix Blog API undocumented edges** | Prototype publish→fetch round-trip in V0, before depending on it in V1. |
| **Cloudflare cold-start on rare admin opens** | Acceptable for operator tool (5×/day). Cron triggers warm the worker enough. |

---

## LeadOrch integration (H3) — design specifics

LeadOrch is at `~/Desktop/ctact` (Cloudflare Workers + Hono + Neon + Drizzle, same as this engine). v4 ICP Discovery is live as of 2026-04-15 with two Cloudflare Workflows (`PipelineWorkflow`, `ICPDiscoveryWorkflow`) and admin telemetry. The integration shape:

- **Shared DB, separate schemas**: both apps point to the same Neon instance; cross-schema FKs (`marketing.audience_targets.run_id → leadorch.runs.id`).
- **Auth share**: LeadOrch's session cookie validates on the marketing-app Worker (read the existing JWT; don't rebuild auth).
- **Webhook**: LeadOrch fires `run.completed` event → marketing-app Worker enqueues `GenerationWorkflow` if the ICP qualifies.
- **Prompt reuse**: LeadOrch's `ICPStrategy` JSON (enriched personas, Apollo-friendly tags, competitor keywords) drops directly into the generation prompt's audience block. No duplicate persona modeling.
- **Engagement → lead score**: nightly job joins `content_metrics` → `leadorch.contacts` via UTM params (`utm_source=marketing-engine&utm_campaign={draft_id}`) + hashed email match for HubSpot opens. Updates a new `leadorch.contact_signals` table consumed by the scorer.
- **Custom Audience upload**: LeadOrch's discovered companies/contacts → Meta Custom Audience + LinkedIn Matched Audience via the Ads adapter. Refresh weekly.
- **Demo dashboard**: at H3 end, one Pages app shows the whole funnel — "Discover (LeadOrch) → Attract (marketing engine) → Score (LeadOrch) → Close". This is the public demo for the combined product.

The traps already learned in LeadOrch v4 ([project_ctact.md](../projects/-Users-xxxyxxx/memory/project_ctact.md)) carry over:
- AsyncLocalStorage does not cross Workflow `step.do()` boundaries — thread `runContext` explicitly
- Drizzle raw SQL can't serialize JS arrays — use `sql.join(arr.map(v => sql\`${v}\`), sql\`, \`)`
- Apollo `mixed_companies/search` is sparse — use `organizations/search`

---

## Build vehicle (decide at start of V0)

The plan is neutral on build vehicle. Two real options:

- **crew-mcp run** ([`~/Desktop/crew-mcp/`](../../../../Desktop/crew-mcp/)) — V0 is greenfield + parallelizable (schema + generation + CLI + 1 UI tab); maps to `backend` + `frontend-design` + `generic` subroles. Spawn 4 worker tabs, Lead orchestrates, validator stage catches drift. Caveat: crew-mcp can't do OAuth setup or live integration tests; those stay on main thread regardless.
- **Main-thread Claude** — slower but tighter; better if you want to learn the codebase as it's built or pause/redirect mid-build.

Recommendation when V0 starts: **crew-mcp for V0** (clean greenfield, parallelizable, exactly its sweet spot), **main-thread for V1 OAuth dance**, **crew-mcp for V2 native-adapter fan-out** (one adapter per run, validator checks interface match).

---

## Verification (how to know each phase landed)

### V0
- `pnpm gen blog "AI security for EU CISOs facing NIS2"` produces a Markdown file in `out/`
- Read 10 generated drafts side-by-side with Kleo's last 10 APIRE blog posts. **Manual taste test: do these read like APIRE (canonical 4-layer names, Ben/Priya/Claudia personas, EU/NIS2 framing) or generic AI slop?**
- Settings UI saves brand voice → next generation reflects it
- No hallucinated feature names (run validator over the 10 drafts)

### V1
- Baran publishes a week's content end-to-end through the tool (blog → social → email → GBP post) without touching Kleo
- Approval queue dismiss-reasons populating
- GA4/GSC metrics flowing into `content_metrics` nightly
- Strategy PDF regenerates on settings save
- Cadence enforcement blocks a 2nd LinkedIn post in the same day
- All 6 OAuth review submissions are in the pipeline

### V2
- Each native adapter swap is a one-line config change; no business logic touched
- Meta IG quota usable (>10 posts/day) after engagement ramp
- Google Ads campaign creates + budget + A/B copy rotates
- OSM + APIRE both fully operated through the tool; 2–3 additional Kuzey sites onboarded

### V3
- LeadOrch run completion triggers marketing generation for the discovered ICP
- LeadOrch admin shows engagement-derived lead-score signal column
- Top-decile generated content auto-feeds next generation as "good examples"
- One unified demo dashboard ships

---

## Critical files reference

- `~/Desktop/baran-context/wix-marketing-agent/wix-structure.md` — full Kleo operating manual (parity target)
- `~/Desktop/ctact/` — LeadOrch repo; the integration target and stack template
- `~/Desktop/crew-mcp/` — optional build vehicle; read its `CLAUDE.md` before invoking
- `~/Desktop/icp-gold-standards/` — LeadOrch's ICP ground truth; same library can grade the marketing engine's audience targeting at H3
- `~/.claude/projects/-Users-xxxyxxx/memory/reference_wix_operating_manual.md` — pointer index to the Wix docs
- `~/.claude/projects/-Users-xxxyxxx/memory/project_ctact.md` — LeadOrch state, traps, deploy commands
