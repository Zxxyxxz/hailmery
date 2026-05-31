// Seeds marketing.content_drafts (and a couple of supporting rows) for the
// APIRE tenant from the V0 generation output in out/apire, so the approval-queue
// dashboard has real drafts to review. Idempotent: clears the tenant's drafts
// + seeded launch campaign first. Run: node scripts/seed-drafts.mjs
//
// This is a dev/demo convenience script — production drafts come from the
// Generation Workflow, not from disk.

import { Pool } from '@neondatabase/serverless'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const OUT = join(ROOT, 'out', 'apire')

// ── read DATABASE_URL from .env ──────────────────────────────────────
const env = readFileSync(join(ROOT, '.env'), 'utf8')
const url = env
  .match(/^DATABASE_URL=(.*)$/m)?.[1]
  ?.trim()
  .replace(/^["']|["']$/g, '')
if (!url) throw new Error('DATABASE_URL not found in .env')

// ── parse blog frontmatter ───────────────────────────────────────────
function parseBlog(md) {
  const m = md.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/)
  if (!m) return null
  const fm = {}
  for (const line of m[1].split('\n')) {
    const mm = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/)
    if (!mm) continue
    let v = mm[2].trim()
    if (v.startsWith('[') && v.endsWith(']')) {
      v = v.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
    } else if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    fm[mm[1]] = v
  }
  return { fm, body: m[2].trim() }
}

// ── gather drafts from disk ──────────────────────────────────────────
const blogs = []
if (existsSync(OUT)) {
  for (const f of readdirSync(OUT)) {
    if (!f.endsWith('.md')) continue
    const parsed = parseBlog(readFileSync(join(OUT, f), 'utf8'))
    if (parsed) blogs.push(parsed)
  }
}

const socials = []
const socialDir = join(OUT, 'social')
if (existsSync(socialDir)) {
  for (const slug of readdirSync(socialDir)) {
    const packPath = join(socialDir, slug, 'pack.json')
    if (!existsSync(packPath)) continue
    const pack = JSON.parse(readFileSync(packPath, 'utf8'))
    if (pack?.pack) socials.push(pack)
  }
}

// guardian scores spanning all three badge tiers (green ≥.97 / amber ≥.92 / red)
const TIERS = [0.98, 0.95, 0.91, 0.99, 0.93, 0.97, 0.9, 0.96, 0.94, 0.92]
const tier = (i) => TIERS[i % TIERS.length]

// ── build draft specs ────────────────────────────────────────────────
/** @type {{channel:string,payload:object,role:string}[]} */
const specs = []

blogs.forEach((b, i) => {
  specs.push({
    channel: 'blog',
    payload: {
      title: b.fm.title ?? 'Untitled',
      slug: b.fm.slug ?? '',
      excerpt: b.fm.excerpt ?? '',
      body: b.body,
      tags: Array.isArray(b.fm.tags) ? b.fm.tags : [],
      guardianScore:
        typeof b.fm.guardian_score === 'string'
          ? Number(b.fm.guardian_score)
          : (b.fm.guardian_score ?? tier(i)),
    },
    role: i < 2 ? 'published' : 'pending',
  })
})

socials.forEach((s, i) => {
  specs.push({
    channel: 'linkedin',
    payload: { text: s.pack.linkedin, guardianScore: tier(i) },
    role: i < 2 ? 'published' : 'pending',
  })
  specs.push({
    channel: 'twitter',
    payload: { text: s.pack.x, guardianScore: tier(i + 3) },
    role: i < 2 ? 'published' : 'pending',
  })
})

// a couple of email drafts synthesized from blog material
blogs.slice(2, 4).forEach((b, i) => {
  specs.push({
    channel: 'email',
    payload: {
      subject: b.fm.title ?? 'APIRE update',
      previewText: b.fm.excerpt ?? '',
      body: b.body.slice(0, 1200),
      guardianScore: tier(i + 5),
    },
    role: 'pending',
  })
})

// ── date helpers ──────────────────────────────────────────────────────
let pubIdx = 0
function nextPublished() {
  const d = new Date(Date.UTC(2026, 4, 20))
  d.setUTCDate(d.getUTCDate() + pubIdx * 2)
  d.setUTCHours(10, 0, 0, 0)
  pubIdx++
  return d.toISOString()
}
let pendIdx = 0
function nextPending() {
  const d = new Date(Date.UTC(2026, 4, 31))
  d.setUTCDate(d.getUTCDate() + Math.floor(pendIdx / 2))
  d.setUTCHours(pendIdx % 2 ? 13 : 9, 0, 0, 0)
  pendIdx++
  return d.toISOString()
}

async function main() {
  const pool = new Pool({ connectionString: url })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT set_config('app.rls_bypass', 'true', true)")

    const t = await client.query(`SELECT id FROM marketing.tenants WHERE slug = 'apire' LIMIT 1`)
    const tenantId = t.rows[0]?.id
    if (!tenantId) throw new Error('APIRE tenant not found — run pnpm db:seed first')
    const s = await client.query(
      `SELECT id FROM marketing.sites WHERE tenant_id = $1 ORDER BY created_at LIMIT 1`,
      [tenantId],
    )
    const siteId = s.rows[0].id
    const ev = await client.query(
      `SELECT id FROM marketing.campaigns WHERE tenant_id = $1 AND type = 'evergreen' ORDER BY created_at LIMIT 1`,
      [tenantId],
    )
    const evergreenId = ev.rows[0].id

    // reset prior demo state
    await client.query(
      `DELETE FROM marketing.content_metrics WHERE tenant_id = $1`,
      [tenantId],
    )
    await client.query(`DELETE FROM marketing.content_drafts WHERE tenant_id = $1`, [tenantId])
    await client.query(
      `DELETE FROM marketing.campaigns WHERE tenant_id = $1 AND name = 'NIS2 Readiness Launch'`,
      [tenantId],
    )

    // give the evergreen campaign a goal + channel cadence
    await client.query(
      `UPDATE marketing.campaigns
         SET goal_type = 'demo_requests', goal_value = 20,
             channel_config = $2::jsonb
       WHERE id = $1`,
      [
        evergreenId,
        JSON.stringify({
          linkedin: { postsPerWeek: 4, days: ['Mon', 'Wed', 'Fri'], time: '09:00' },
          twitter: { postsPerWeek: 5, days: ['Mon', 'Tue', 'Thu'], time: '13:00' },
          blog: { postsPerWeek: 1, days: ['Tue'], time: '09:00' },
          email: { postsPerWeek: 1, days: ['Thu'], time: '10:00' },
        }),
      ],
    )

    // a product-launch campaign with its own goal + launch date
    const launch = await client.query(
      `INSERT INTO marketing.campaigns
         (tenant_id, site_id, name, type, goal_type, goal_value, launch_date,
          channel_config, status)
       VALUES ($1, $2, 'NIS2 Readiness Launch', 'product_launch', 'demo_requests', 5,
               '2026-06-15T09:00:00Z', $3::jsonb, 'active')
       RETURNING id`,
      [
        tenantId,
        siteId,
        JSON.stringify({
          linkedin: { postsPerWeek: 3 },
          blog: { postsPerWeek: 1 },
          email: { postsPerWeek: 1 },
        }),
      ],
    )
    const launchId = launch.rows[0].id

    // insert drafts
    let i = 0
    let publishedDraftIds = []
    for (const spec of specs) {
      const campaignId = i % 5 === 0 ? launchId : evergreenId
      let status = spec.role === 'published' ? 'published' : 'pending_review'
      // sprinkle a few approved among the pending for calendar variety
      if (status === 'pending_review' && i % 7 === 3) status = 'approved'
      const publishAt = spec.role === 'published' ? nextPublished() : nextPending()
      const pillar =
        spec.channel === 'blog' ? 'Thought leadership' : spec.channel === 'email' ? 'Nurture' : 'Awareness'

      const res = await client.query(
        `INSERT INTO marketing.content_drafts
           (tenant_id, campaign_id, site_id, pillar, channel, status, payload, assets, publish_at, score_human)
         VALUES ($1,$2,$3,$4,$5,$6::marketing.draft_status,$7::jsonb,'{}'::jsonb,$8::timestamptz,$9)
         RETURNING id`,
        [
          tenantId,
          campaignId,
          siteId,
          pillar,
          spec.channel,
          status,
          JSON.stringify(spec.payload),
          publishAt,
          status === 'published' ? 5 : null,
        ],
      )
      if (status === 'published') publishedDraftIds.push(res.rows[0].id)
      i++
    }

    // metrics for published drafts (drives campaign progress bars)
    for (let k = 0; k < publishedDraftIds.length; k++) {
      await client.query(
        `INSERT INTO marketing.content_metrics
           (tenant_id, draft_id, "window", impressions, clicks, engagement, attributed_leads)
         VALUES ($1,$2,'7d',$3,$4,$5,$6)`,
        [tenantId, publishedDraftIds[k], 1200 + k * 300, 40 + k * 10, 15 + k * 4, 2 + (k % 3)],
      )
    }

    await client.query('COMMIT')
    console.log(
      `[seed-drafts] inserted ${specs.length} drafts (${publishedDraftIds.length} published) for APIRE`,
    )
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
