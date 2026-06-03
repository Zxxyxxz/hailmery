# Deploying Hailmery to Cloudflare

Step-by-step manual guide for deploying the Hailmery marketing command center to
Cloudflare. It assumes no prior Cloudflare Workers experience — follow each step
in order. The Worker (API + cron jobs + Workflows) deploys via `wrangler deploy`;
the dashboard (React SPA) deploys to Cloudflare Pages.

All commands run from the repo root (`~/Desktop/hailmery`) unless stated otherwise.

---

## Prerequisites

- **Cloudflare account with the Workers paid plan.** The free plan caps cron
  triggers and Workflows in ways that break the publish/generation pipelines —
  the paid plan ($5/mo) is required.
- **wrangler CLI authenticated.** Run `wrangler whoami`; if it does not show your
  account, run `wrangler login` and complete the browser flow.
- **Neon DB with the `hailmery_app` role created.** This role is created by
  `pnpm db:migrate` (it lives in `src/db/rls.sql`). Set its password in the Neon
  dashboard (Roles → `hailmery_app` → reset password) and copy the connection
  string — you will use it for `DATABASE_URL`.
- **All API keys ready** (see `scripts/set-production-secrets.sh` for the full
  list). Have them in front of you before Step 3.

---

## Step 1 — Create R2 buckets

In the Cloudflare dashboard:

1. Go to **R2 Object Storage**.
2. Create a bucket named **`hailmery-assets`**.
3. Create a bucket named **`hailmery-assets-preview`** (used by `wrangler dev`
   and preview deploys via `preview_bucket_name` in `wrangler.toml`).
4. Note the bucket endpoint URL (you'll need it later if you make the bucket
   public for image CDN delivery).

These names must match the `[[r2_buckets]]` block in `wrangler.toml` exactly.

---

## Step 2 — Deploy the Worker

```bash
cd ~/Desktop/hailmery
wrangler deploy
```

Note the Worker URL printed at the end of the output — it looks like
`hailmery-api.ACCOUNT.workers.dev`. You'll need it in Step 6.

---

## Step 3 — Set all secrets

```bash
bash scripts/set-production-secrets.sh
```

Each line prompts you to paste a value (input is hidden).

- **`DATABASE_URL`** — use the **`hailmery_app`** role connection string from
  Neon, NOT the `neondb_owner` string. The app role has `NOBYPASSRLS`, so RLS
  policies are enforced as a real backstop. Format:
  ```
  postgresql://hailmery_app:PASSWORD@ep-xxx.region.aws.neon.tech/neondb?sslmode=require
  ```
- **`SECRETS_KEY`** — use the **base64** value from `.env` (NOT the old hex
  value). This is the AES-256-GCM master key; it must match the key used to seed
  per-tenant secrets in Step 8, or decryption will fail at runtime.

---

## Step 4 — Run database migrations

After secrets are set:

```bash
wrangler dev          # start the local worker briefly to confirm it boots, then Ctrl-C
pnpm db:push          # if needed for a fresh schema (drizzle-kit push)
pnpm db:migrate       # applies RLS policies + indexes + the hailmery_app role
pnpm db:seed          # inserts the OSM and APIRE tenants
```

`db:migrate` and `db:seed` run locally against Neon using `DATABASE_URL` from
your `.env` (the `neondb_owner` admin string) — they do not use the Worker
secret. Migrations and seeds need the owner role; the deployed Worker uses the
restricted `hailmery_app` role.

---

## Step 5 — Build and deploy the dashboard

```bash
cd dashboard
pnpm build
cd ..
wrangler pages deploy dashboard/dist \
  --project-name hailmery-dashboard
```

Note the Pages URL printed in the output (e.g. `hailmery-dashboard.pages.dev`).

---

## Step 6 — Update the API URL

Edit `dashboard/.env.production` and replace the placeholder with the actual
Worker URL from Step 2:

```
VITE_API_URL=https://hailmery-api.ACCOUNT.workers.dev
```

`VITE_API_URL` is baked into the bundle at build time, so you must rebuild and
redeploy after changing it:

```bash
cd dashboard && pnpm build && cd ..
wrangler pages deploy dashboard/dist \
  --project-name hailmery-dashboard
```

---

## Step 7 — Configure the custom domain

In the Cloudflare dashboard:

1. Go to **Workers & Pages → hailmery-dashboard**.
2. Open **Custom domains → Add domain**.
3. Enter: **`marketing.leadorch.io`**.
4. Follow the DNS verification steps (Cloudflare adds the CNAME automatically if
   the zone is on Cloudflare).
5. Wait for the SSL certificate to provision (5–15 min).

---

## Step 8 — Seed tenant secrets

Per-tenant credentials (Buffer profile map, HubSpot/SendGrid tokens, GSC OAuth)
are AES-encrypted into the DB rather than stored as Worker secrets. Seed them
from your local `.env`:

```bash
npx tsx --env-file=.env scripts/seed-tenant-secrets.mjs apire
npx tsx --env-file=.env scripts/seed-tenant-secrets.mjs osm
```

This uses `SECRETS_KEY` from `.env` — it must be the same base64 key you set as
the Worker secret in Step 3.

---

## Step 9 — Verify deployment

Open **marketing.leadorch.io** and confirm:

- Queue page loads with APIRE drafts ✓
- **Create Now** generates a LinkedIn post ✓
- **Publish Now** sends to Buffer ✓
- Analytics page shows the published count ✓

---

## Known limitations at launch

- **PDF upload** extracts text in the Node path only; Worker-side PDF parsing
  produces 0 chunks (see [doc-extraction-runtime] note). md/txt/docx extract fine
  in the Worker.
- **Image attachment in Buffer posts** requires a public R2 CDN URL. Wire this up
  after confirming the R2 bucket is made public.
- **LinkedIn native analytics** uses the LinkedIn V2 API (not yet wired).
- **Google Search Console OAuth** needs a manual token capture after deploy.
