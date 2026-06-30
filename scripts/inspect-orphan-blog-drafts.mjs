// Inspect the 2 blog drafts that are status='published' but never reached Wix.
//   pnpm exec tsx --env-file=.env scripts/inspect-orphan-blog-drafts.mjs
import { makeDb } from '../src/db/client.ts';
import { withTenantDb } from '../src/lib/tenant.ts';
import { sql } from 'drizzle-orm';

const APIRE = '6daebc34-7fd0-4542-8527-cfcd125a5f72';
const db = makeDb(process.env.DATABASE_URL);

const rows = await withTenantDb(db, APIRE, async (tx) => {
  const r = await tx.execute(sql`
    SELECT cd.id, LEFT(cd.id::text, 8) AS short, cd.status, cd.channel,
           cd.campaign_id, cd.created_at, cd.updated_at,
           cd.published_ref, cd.failed_reason, cd.dismiss_reason, cd.score_human,
           cd.guardian_breakdown,
           cd.payload->>'title'         AS title,
           cd.payload->>'slug'          AS slug,
           cd.payload->>'excerpt'       AS excerpt,
           cd.payload->>'guardianScore' AS guardian_score,
           cd.payload->>'guardianNotes' AS guardian_notes,
           cd.payload->>'flagged'       AS flagged,
           cd.payload->'tags'           AS tags,
           cd.payload->'sources'        AS sources,
           length(cd.payload->>'body')  AS body_len,
           left(cd.payload->>'body', 700) AS body_head,
           (SELECT count(*) FROM marketing.publish_log pl
             WHERE pl.draft_id = cd.id AND pl.tenant_id = ${APIRE}) AS publish_log_rows
    FROM marketing.content_drafts cd
    WHERE cd.tenant_id = ${APIRE}
      AND LEFT(cd.id::text, 8) IN ('d0f907d6', 'dd681d5d')`);
  return r.rows;
});

for (const r of rows) {
  console.log('\n' + '='.repeat(70));
  console.log(`${r.short}  "${r.title}"`);
  console.log('='.repeat(70));
  console.log(`status=${r.status}  channel=${r.channel}  campaign_id=${r.campaign_id}`);
  console.log(`created=${r.created_at}  updated=${r.updated_at}`);
  console.log(`published_ref=${JSON.stringify(r.published_ref)}  failed_reason=${JSON.stringify(r.failed_reason)}  dismiss_reason=${JSON.stringify(r.dismiss_reason)}`);
  console.log(`publish_log_rows=${r.publish_log_rows}  score_human=${r.score_human}`);
  console.log(`slug=${r.slug}`);
  console.log(`guardianScore=${r.guardian_score}  flagged=${r.flagged}  body_len=${r.body_len}`);
  console.log(`guardian_breakdown=${r.guardian_breakdown ? JSON.stringify(r.guardian_breakdown).slice(0, 300) : 'null'}`);
  console.log(`guardianNotes=${r.guardian_notes ? String(r.guardian_notes).slice(0, 400) : 'null'}`);
  console.log(`excerpt=${r.excerpt}`);
  console.log(`tags=${JSON.stringify(r.tags)}`);
  console.log(`sources=${JSON.stringify(r.sources)?.slice(0, 300)}`);
  console.log(`\n--- BODY HEAD (${r.body_len} chars total) ---\n${r.body_head}`);
}
console.log(`\n\n(${rows.length} drafts found)`);
process.exit(0);
