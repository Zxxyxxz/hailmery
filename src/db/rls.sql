-- ──────────────────────────────────────────────────────────────────
-- Hailmery V0 — RLS policies and pgvector setup
-- Applied by src/db/migrate.ts AFTER drizzle-kit pushes the schema.
-- ──────────────────────────────────────────────────────────────────

-- 1. Required extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()

-- 2. HNSW index for fast cosine ANN on document_chunks.embedding.
--    Cosine is what text-embedding-3-small ships normalized for.
CREATE INDEX IF NOT EXISTS document_chunks_embedding_hnsw
  ON marketing.document_chunks
  USING hnsw (embedding vector_cosine_ops);

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
--    The expression `current_setting('app.tenant_id', true)::uuid = tenant_id`
--    matches the PLAN.md contract: the Worker/CLI sets `app.tenant_id` at
--    the start of every request, and queries are filtered transparently.
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
        USING (current_setting('app.tenant_id', true)::uuid = tenant_id)
        WITH CHECK (current_setting('app.tenant_id', true)::uuid = tenant_id)
    $p$, tbl);
  END LOOP;
END $$;
