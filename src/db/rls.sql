-- ──────────────────────────────────────────────────────────────────
-- Hailmery V0 — RLS policies and pgvector setup
-- Applied by src/db/migrate.ts AFTER drizzle-kit pushes the schema.
-- ──────────────────────────────────────────────────────────────────

-- 1. Required extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()

-- 1b. Pipeline schema additions (Chunk 6 — scheduling/publish).
--     Idempotent so `pnpm db:migrate` provisions them WITHOUT a destructive
--     `db:push` that would drop and recreate policies. Drizzle's schema.ts is
--     still the source of truth + types; this mirrors the diff for the migrate
--     path. Both run BEFORE the RLS loops below so the new table picks up the
--     uniform tenant_isolation policy automatically.

-- content_drafts.failed_reason — set when a publish attempt fails (no retry).
ALTER TABLE IF EXISTS marketing.content_drafts
  ADD COLUMN IF NOT EXISTS failed_reason text;

-- metrics_window enum (already created by drizzle-kit for content_metrics, but
-- guard so the migrate path is self-contained on a fresh branch).
DO $$ BEGIN
  CREATE TYPE marketing.metrics_window AS ENUM ('1h', '24h', '7d', '30d');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- metrics_queue — delayed metrics-fetch work queue (1h / 24h after publish).
CREATE TABLE IF NOT EXISTS marketing.metrics_queue (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  draft_id    uuid NOT NULL REFERENCES marketing.content_drafts(id),
  fetch_at    timestamptz NOT NULL,
  "window"    marketing.metrics_window NOT NULL,
  fetched     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS metrics_queue_tenant_idx ON marketing.metrics_queue (tenant_id);
CREATE INDEX IF NOT EXISTS metrics_queue_due_idx    ON marketing.metrics_queue (fetch_at) WHERE fetched = false;
CREATE INDEX IF NOT EXISTS metrics_queue_draft_idx  ON marketing.metrics_queue (draft_id, "window");

-- 2. HNSW index for fast cosine ANN on document_chunks.embedding.
--    Cosine is what text-embedding-3-small ships normalized for.
--    Only run if the table actually exists (lets us call this migration
--    before AND after drizzle-kit push).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname = 'marketing' AND tablename = 'document_chunks'
  ) THEN
    CREATE INDEX IF NOT EXISTS document_chunks_embedding_hnsw
      ON marketing.document_chunks
      USING hnsw (embedding vector_cosine_ops);
  END IF;
END $$;

-- 3. Enable AND FORCE RLS on every marketing.* table.
--    FORCE makes RLS apply even to the table owner, so seed/CLI scripts must
--    either set app.tenant_id or temporarily `SET LOCAL row_security = off`.
DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'marketing'
  LOOP
    EXECUTE format('ALTER TABLE marketing.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE marketing.%I FORCE ROW LEVEL SECURITY', tbl);
  END LOOP;
END $$;

-- 4. Drop existing policies (idempotent re-apply).
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'marketing'
  LOOP
    EXECUTE format('DROP POLICY %I ON %I.%I',
      pol.policyname, pol.schemaname, pol.tablename);
  END LOOP;
END $$;

-- 5. Uniform tenant-isolation policy on every table.
--    Default mode: `current_setting('app.tenant_id', true)::uuid = tenant_id`
--    Bypass mode: `current_setting('app.rls_bypass', true) = 'true'` lets the
--    seed and migration scripts insert across tenants without bypassing RLS
--    via role attribute (which would defeat the policy entirely).
--
--    The `true` second arg to current_setting returns NULL if unset, which
--    will fail the equality and return zero rows — fail-closed by design.
DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'marketing'
  LOOP
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON marketing.%I
        USING (
          NULLIF(current_setting('app.tenant_id', true), '')::uuid = tenant_id
          OR current_setting('app.rls_bypass', true) = 'true'
        )
        WITH CHECK (
          NULLIF(current_setting('app.tenant_id', true), '')::uuid = tenant_id
          OR current_setting('app.rls_bypass', true) = 'true'
        )
    $p$, tbl);
  END LOOP;
END $$;

-- 6. Note on role attributes:
--    Neon's default `neondb_owner` role ships with BYPASSRLS = true and
--    Neon does not permit altering its attributes. The application MUST
--    connect as a non-bypass role (e.g. `hailmery_app`, created by the RLS
--    test) for tenant_isolation to actually apply. The seed and migration
--    scripts continue to run as the owner using the `app.rls_bypass = true`
--    escape hatch above. The RLS verification test (`pnpm test:rls`)
--    creates the non-bypass role and exercises the policy from it.
