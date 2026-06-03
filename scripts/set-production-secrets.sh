#!/bin/bash
# Run this from ~/Desktop/hailmery
# after wrangler deploy
# Each command will prompt for the value
#
# Worker runtime secrets (set as Cloudflare Workers Secrets — never committed):
#   DATABASE_URL              hailmery_app role connection string (NOT neondb_owner)
#   ANTHROPIC_API_KEY         Claude Sonnet/Haiku generation + Brand Guardian
#   OPENAI_API_KEY            text-embedding-3-small (corpus + topic embeddings)
#   GOOGLE_API_KEY            Gemini 3 Pro image generation
#   SECRETS_KEY               AES-256-GCM master key (use the base64 value, NOT hex)
#   SENDGRID_API_KEY          transactional mail send
#   SENDGRID_WEBHOOK_SECRET   verifies inbound SendGrid event webhook signatures
#   HUBSPOT_API_KEY           CRM sync
#   HUBSPOT_EVENT_TEMPLATE_ID HubSpot timeline event template id
#   BUFFER_ACCESS_TOKEN       Buffer publish API
#   IDEOGRAM_API_KEY          alternate image provider (IMAGE_PROVIDER=ideogram)
#
# Per-tenant credentials (Buffer profile map, GSC OAuth, etc.) are NOT Worker
# secrets — they are AES-encrypted into the DB by scripts/seed-tenant-secrets.mjs
# (DEPLOY.md Step 8) using SECRETS_KEY from your local .env.

set -e

echo "Setting Hailmery production secrets..."

wrangler secret put DATABASE_URL
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put OPENAI_API_KEY
wrangler secret put GOOGLE_API_KEY
wrangler secret put SECRETS_KEY
wrangler secret put SENDGRID_API_KEY
wrangler secret put SENDGRID_WEBHOOK_SECRET
wrangler secret put HUBSPOT_API_KEY
wrangler secret put HUBSPOT_EVENT_TEMPLATE_ID
wrangler secret put BUFFER_ACCESS_TOKEN
wrangler secret put IDEOGRAM_API_KEY

echo "All secrets set. Verify at:"
echo "https://dash.cloudflare.com"
