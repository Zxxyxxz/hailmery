// Revert the 2 good-quality blog drafts that were marked published but never
// reached Wix back to 'pending_review' so Baran can re-publish properly.
//   pnpm exec tsx --env-file=.env scripts/revert-orphan-blog-drafts.mjs
import { makeDb } from '../src/db/client.ts';
import { withTenantDb } from '../src/lib/tenant.ts';
import { sql } from 'drizzle-orm';

const APIRE = '6daebc34-7fd0-4542-8527-cfcd125a5f72';
const db = makeDb(process.env.DATABASE_URL);

const updated = await withTenantDb(db, APIRE, async (tx) => {
  const r = await tx.execute(sql`
    UPDATE marketing.content_drafts
    SET status = 'pending_review',
        published_ref = NULL,
        failed_reason = NULL,
        updated_at = now()
    WHERE tenant_id = ${APIRE}
      AND channel = 'blog'
      AND status = 'published'
      AND published_ref IS NULL
      AND LEFT(id::text, 8) IN ('d0f907d6', 'dd681d5d')
    RETURNING LEFT(id::text, 8) AS short, status, published_ref, failed_reason,
              payload->>'title' AS title`);
  return r.rows;
});

console.log('Updated rows:', updated.length);
for (const r of updated) {
  console.log(`  ${r.short}  status=${r.status}  ref=${JSON.stringify(r.published_ref)}  failed=${JSON.stringify(r.failed_reason)}  "${r.title}"`);
}
process.exit(0);
