# hailmery — V0

AI marketing command center. V0 scaffolds the multi-tenant foundation and proves content quality on APIRE before any external publishing is wired up. See `PLAN.md` for the full product vision.

## What V0 ships

1. Hono Worker on Cloudflare + Drizzle ORM against Neon Postgres
2. `marketing.*` schema, every table tenant-scoped, Neon RLS enforced
3. Markdown ingestion → 512/64 chunks → OpenAI `text-embedding-3-small` → pgvector
4. APIRE corpus seeded from `corpus/apire/*.md`
5. `src/generation/blog.ts` — RAG top-k=8 + prompt-cached Claude Sonnet 4.6
6. CLI: `pnpm gen blog --tenant apire "topic"` → `out/{slug}/{date}-{slug}.md`
7. Brand Guardian (Haiku 4.5) flags hallucinated product/feature names → JSON report
8. UI: `/settings/brand-voice` writes `marketing.site_config.brand_voice`
9. Wix Blog publish→fetch prototype in `tests/wix-blog-prototype.ts`
10. RLS verification in `tests/rls.test.ts`

**Out of V0 scope** (deferred to V1+): social adapters, campaign UI, approval queue, HubSpot, SendGrid, Google Ads, video gen.

## Prerequisites

- Node 20.6+ (for `tsx --env-file`)
- pnpm 9+
- A Neon project with a `dev` branch
- OpenAI + Anthropic API keys
- (Optional, only for V0 step #9) a Wix API key + site ID

## First-run setup

```bash
pnpm install
cp .env.example .env          # fill in DATABASE_URL, OPENAI_API_KEY, ANTHROPIC_API_KEY
pnpm db:migrate               # creates marketing.* schema, enables pgvector + RLS
pnpm db:seed                  # inserts OSM + APIRE tenants
pnpm ingest --tenant apire    # ingest everything in corpus/apire/*.md
```

## Daily use

```bash
# Generate a blog draft
pnpm gen blog --tenant apire "AI security for EU CISOs facing NIS2"
#   → writes out/apire/2026-05-20-ai-security-for-eu-cisos-facing-nis2.md
#   → writes out/apire/2026-05-20-ai-security-for-eu-cisos-facing-nis2.guardian.json

# Re-ingest after editing corpus/apire/*.md
pnpm ingest --tenant apire

# Open the settings UI
pnpm dev                      # then visit http://localhost:8787/settings/brand-voice?tenant=apire
```

## Verification

```bash
# RLS isolation — OSM session must NOT see APIRE's chunks
pnpm test:rls

# Wix Blog round-trip (requires WIX_* env vars)
pnpm test:wix
```

## Corpus contract

`corpus/{tenant_slug}/*.md` — one file per logical document. Plain markdown; the chunker reads tokens, not headings, so structure is preserved but does not drive splits. Re-running `pnpm ingest` upserts: existing documents are versioned, old chunks marked `superseded=true`, new chunks inserted.

For APIRE, populate with canonical strategic content: 4-layer architecture names, Ben/Priya/Claudia personas, 27 threat categories, EU/NIS2 positioning. `corpus/apire/_starter.md` is a placeholder skeleton — replace with real content before relying on output quality.

## V0 success criterion

`pnpm gen blog --tenant apire "AI security for EU CISOs facing NIS2"` produces a draft that reads like APIRE (canonical names, personas, EU framing), not generic AI output. If the taste test fails, fix the corpus or prompt before building V1.
