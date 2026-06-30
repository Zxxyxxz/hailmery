// READ-ONLY diagnostic for the failed-draft investigation. Dumps every failed
// draft for a tenant (classified by error), plus approved drafts whose
// publish_at is already in the past, plus email-payload field presence. Never
// writes. Every query carries an explicit tenant_id predicate (rls_bypass is on
// only so we don't need app.tenant_id set_config per query).
//
//   npx tsx --env-file=.env scripts/diagnose-failed-drafts.mjs [tenantId]

import { Pool } from '@neondatabase/serverless';

const APIRE = '6daebc34-7fd0-4542-8527-cfcd125a5f72';
const TENANT = process.argv[2] || APIRE;
const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) { console.error('DATABASE_URL must be set (run with --env-file=.env)'); process.exit(1); }

const j = (v) => JSON.stringify(v, null, 2);

async function main() {
  const pool = new Pool({ connectionString: DB_URL });
  const client = await pool.connect();
  try {
    await client.query("SELECT set_config('app.rls_bypass', 'true', false)");

    console.log(`\n=== TENANT ${TENANT} ===`);

    const counts = await client.query(
      `SELECT status, count(*)::int AS n FROM marketing.content_drafts
       WHERE tenant_id = $1 GROUP BY status ORDER BY status`, [TENANT]);
    console.log('\n--- draft status counts ---');
    console.table(counts.rows);

    const failed = await client.query(
      `SELECT id, channel, publish_at, created_at, updated_at,
              left(failed_reason, 200) AS failed_reason,
              (payload ? 'html_body')  AS has_html_body,
              (payload ? 'from_email') AS has_from_email,
              (payload ? 'subject')    AS has_subject,
              (payload ? 'to_list')    AS has_to_list,
              (payload ? 'text')       AS has_text,
              payload->>'title'        AS title,
              payload->>'emailType'    AS email_type
         FROM marketing.content_drafts
        WHERE tenant_id = $1 AND status = 'failed'
        ORDER BY channel, updated_at`, [TENANT]);
    console.log(`\n--- ALL FAILED DRAFTS (${failed.rows.length}) ---`);
    for (const r of failed.rows) {
      console.log(`\n• ${r.id}  [${r.channel}]  updated=${r.updated_at?.toISOString?.() ?? r.updated_at}`);
      console.log(`    title: ${r.title ?? '(none)'}${r.email_type ? `  emailType=${r.email_type}` : ''}`);
      console.log(`    publish_at: ${r.publish_at?.toISOString?.() ?? r.publish_at}`);
      console.log(`    reason: ${r.failed_reason}`);
      if (r.channel === 'email' || r.channel === 'newsletter' || r.channel === 'drip')
        console.log(`    payload: html_body=${r.has_html_body} from_email=${r.has_from_email} subject=${r.has_subject} to_list=${r.has_to_list}`);
    }

    const pastApproved = await client.query(
      `SELECT id, channel, publish_at, updated_at, payload->>'title' AS title
         FROM marketing.content_drafts
        WHERE tenant_id = $1 AND status = 'approved' AND publish_at < now()
        ORDER BY publish_at`, [TENANT]);
    console.log(`\n--- APPROVED with publish_at IN THE PAST (${pastApproved.rows.length}) ---`);
    if (pastApproved.rows.length) {
      const agg = await client.query(
        `SELECT count(*)::int AS n, min(publish_at) AS oldest, max(publish_at) AS newest
           FROM marketing.content_drafts
          WHERE tenant_id = $1 AND status = 'approved' AND publish_at < now()`, [TENANT]);
      console.log(`count=${agg.rows[0].n}  oldest=${agg.rows[0].oldest?.toISOString?.() ?? agg.rows[0].oldest}  newest=${agg.rows[0].newest?.toISOString?.() ?? agg.rows[0].newest}`);
      for (const r of pastApproved.rows)
        console.log(`  • ${r.id} [${r.channel}] publish_at=${r.publish_at?.toISOString?.() ?? r.publish_at}  ${r.title ?? ''}`);
    }

    // Buffer-channel drafts (x/twitter) — does the mapping gap even matter?
    const xDrafts = await client.query(
      `SELECT status, channel, count(*)::int AS n FROM marketing.content_drafts
        WHERE tenant_id = $1 AND lower(channel) IN ('x','twitter')
        GROUP BY status, channel ORDER BY status`, [TENANT]);
    console.log('\n--- x/twitter drafts by status ---');
    console.table(xDrafts.rows);

    // blog drafts by status (does the alias gap even matter / are failures stale?)
    const blogDrafts = await client.query(
      `SELECT status, channel, count(*)::int AS n FROM marketing.content_drafts
        WHERE tenant_id = $1 AND lower(channel) IN ('blog','wix-blog')
        GROUP BY status, channel ORDER BY status`, [TENANT]);
    console.log('\n--- blog/wix-blog drafts by status ---');
    console.table(blogDrafts.rows);
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
