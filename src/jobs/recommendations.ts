// Weekly recommendations engine (Session 8) — the "tells me what to do" layer.
//
// Wired to the "0 3 * * *" nightly cron (src/jobs/scheduler.ts → runNightlyTick),
// AFTER runNightlyMetrics so it reads freshly-written content_metrics /
// performance_score / golden_example. For every active tenant it:
//
//   1. Gathers a clean structured summary from real data sources in ONE
//      tenant-scoped transaction — per-channel performance, keyword-based topic
//      clusters, queue depth + cadence (derived from content_drafts, not the
//      sparse publish_log), the latest intelligence brief, the tenant's
//      top-scoring posts, and active campaigns.
//   2. Asks Sonnet 4.6 to reason over that summary and emit the top 5 ranked,
//      data-backed actions for the week. NO web_search — recommendations reason
//      over internal data, not web research.
//   3. Replaces this week's pending recommendations with the fresh set.
//
// Best-effort by design: API keys are read from process.env (mirrored from
// Worker secrets by mirrorEnvToProcess); every query carries an explicit
// tenant_id predicate inside withTenantDb (never RLS alone); the cron tick
// swallows per-tenant failures so one tenant never blocks the fleet.
//
// DATA-FIDELITY NOTES (see Session 8 analysis):
//   - All measured content for the V0 tenants is LinkedIn-dominant, so
//     channel_rebalance has thin cross-channel signal; the prompt is told to
//     prefer stronger types over forcing a weak one.
//   - Imported Buffer posts carry their ORIGINAL (historical) publish_at, so a
//     hard "last 7 days" window is ~empty. recentWinners ranks by score with a
//     days_since label instead of a recency cutoff, so engagement_followup still
//     surfaces real winners.
//   - The intelligence brief is weekly and may be a few days stale; we read the
//     most-recent brief regardless of week and flag its age.

import { sql } from 'drizzle-orm';
import type { NeonDatabase } from 'drizzle-orm/neon-serverless';
import type Anthropic from '@anthropic-ai/sdk';
import { anthropic, MODELS } from '../lib/ai.js';
import { withTenantDb, getAllActiveTenants } from '../lib/tenant.js';
import { makeDb } from '../db/client.js';
import { mirrorEnvToProcess, type PipelineEnv } from '../workflows/types.js';
import { mondayOf } from './intelligence.js';

type Db = NeonDatabase<Record<string, unknown>>;

export const RECOMMENDATION_TYPES = [
  'content_gap',
  'channel_rebalance',
  'trending_opportunity',
  'queue_health',
  'engagement_followup',
  // SEO: a striking-distance Search Console query (rank 4-20, high impressions)
  // not yet covered by a post. Data-gated — only surfaces when GSC is connected.
  'seo_opportunity',
] as const;
export type RecommendationType = (typeof RECOMMENDATION_TYPES)[number];

export const RECOMMENDATION_ACTION_TYPES = ['generate', 'approve', 'review_queue'] as const;
export type RecommendationActionType = (typeof RECOMMENDATION_ACTION_TYPES)[number];

// Channels the dashboard "Generate now" modal + /api/generate-now accept. A
// recommendation's suggested channel is normalised into this set so the modal
// pre-fill always matches an option (else the Select shows nothing).
const VALID_ACTION_CHANNELS = new Set(['blog', 'linkedin', 'x', 'instagram', 'email', 'tiktok']);

// We need at least this many SCORED posts before recommendations are meaningful.
const MIN_SCORED_POSTS = 5;

// Keyword-based topic clusters spanning the AI-security / compliance marketing
// space for both tenants (APIRE leans NIS2 / EU AI Act / prompt injection / DLP;
// OSM leans CTEM / exposure management). This is deliberately NOT an LLM call.
const TOPIC_KEYWORDS: Array<{ topic: string; keywords: string[] }> = [
  { topic: 'NIS2', keywords: ['nis2', 'nis 2'] },
  { topic: 'EU AI Act', keywords: ['ai act', 'artificial intelligence act'] },
  { topic: 'Prompt injection', keywords: ['prompt injection', 'prompt-injection'] },
  { topic: 'Data exfiltration / DLP', keywords: ['data exfiltration', 'exfiltration', 'data loss prevention', 'dlp'] },
  { topic: 'CTEM / exposure management', keywords: ['ctem', 'continuous threat exposure', 'exposure management', 'attack surface'] },
  { topic: 'Shadow AI', keywords: ['shadow ai'] },
  { topic: 'Zero trust', keywords: ['zero trust', 'zero-trust'] },
  { topic: 'DORA', keywords: ['dora', 'digital operational resilience'] },
  { topic: 'Threat detection & response', keywords: ['threat detection', 'threat hunting', 'detection and response', 'mdr', 'xdr'] },
  { topic: 'Compliance & audit', keywords: ['compliance', 'iso 27001', 'soc 2', 'gdpr', 'audit'] },
  { topic: 'LLM / AI security', keywords: ['llm security', 'ai security', 'model security', 'genai', 'ai api'] },
  { topic: 'Ransomware', keywords: ['ransomware'] },
  { topic: 'Phishing & social engineering', keywords: ['phishing', 'social engineering'] },
  { topic: 'Incident response', keywords: ['incident response', 'security operations', 'soc team'] },
  { topic: 'Vulnerability & CVE', keywords: ['vulnerability', 'cve-', 'zero-day', 'zero day', 'patch'] },
];

const MS_PER_DAY = 1000 * 60 * 60 * 24;

// ── public types ──────────────────────────────────────────────────────────────

export interface RecommendationDraft {
  type: RecommendationType;
  title: string;
  description: string;
  reasoning: string;
  actionType: RecommendationActionType;
  actionParams: Record<string, unknown>;
  priorityScore: number;
  dataSnapshot: Record<string, unknown>;
}

export interface RecommendationResult {
  tenantId: string;
  skipped: boolean;
  reason?: string;
  generated?: number;
  weekOf?: string;
  scoredPosts?: number;
  recommendations?: Array<{
    type: string;
    title: string;
    priorityScore: number;
    actionType: string;
  }>;
}

// ── gathered-data shapes ────────────────────────────────────────────────────────

interface ChannelPerf {
  channel: string;
  postCount: number;
  scoredCount: number;
  avgScore: number | null;
  medianScore: number | null;
  recentCount: number; // posts in the last 14 days (by effective publish date)
}

interface TopicPerf {
  topic: string;
  postCount: number;
  scoredCount: number;
  avgScore: number | null;
  daysSinceLastPost: number | null;
}

interface QueueChannel {
  channel: string;
  approvedCount: number;
  pendingCount: number;
  scheduledCount: number;
  daysSinceLastPublish: number | null;
}

interface TrendingTopic {
  topic: string;
  angle: string;
  urgency: string;
  suggestedChannel: string;
  isCovered: boolean;
  daysSinceCovered: number | null;
}

interface RecentWinner {
  draftId: string;
  channel: string;
  score: number;
  snippet: string;
  topic: string | null;
  daysSincePublished: number | null;
}

interface ActiveCampaign {
  id: string;
  name: string;
  type: string;
  goalType: string;
}

interface SeoQuery {
  query: string;
  impressions: number;
  clicks: number;
  position: number;
}

interface SeoStriking extends SeoQuery {
  // True when an existing post already covers the query's terms — Sonnet should
  // only recommend an seo_opportunity for UNcovered striking-distance queries.
  isCovered: boolean;
}

interface SeoData {
  weekOf: string | null;
  topQueries: SeoQuery[];
  strikingDistance: SeoStriking[];
}

interface GatheredData {
  tenantName: string;
  channelPerf: ChannelPerf[];
  topicPerf: TopicPerf[];
  queueStatus: QueueChannel[];
  trendingTopics: TrendingTopic[];
  trendingBriefWeekOf: string | null;
  trendingBriefAgeDays: number | null;
  recentWinners: RecentWinner[];
  campaigns: ActiveCampaign[];
  // SEO opportunities from Google Search Console — null when GSC isn't connected
  // (or has no data yet for the tenant), in which case the SEO block is omitted.
  seo: SeoData | null;
  totalScoredPosts: number;
}

// Raw published/measured draft row used for keyword bucketing + coverage checks.
interface DraftTextRow extends Record<string, unknown> {
  id: string;
  channel: string;
  text: string;
  performance_score: string | null;
  published_at: string | null;
}

// SQL CASE that collapses channel aliases into the four canonical buckets — same
// normalisation the analytics routes use (twitter→x, wix-blog→blog, sendgrid→email).
const CHANNEL_NORM = sql`CASE
  WHEN lower(channel) IN ('x', 'twitter') THEN 'x'
  WHEN lower(channel) IN ('blog', 'wix-blog') THEN 'blog'
  WHEN lower(channel) = 'sendgrid' THEN 'email'
  ELSE lower(channel)
END`;

// Effective publish date for a draft. Imported posts carry their original
// publish_at; own-published posts may only have updated_at. publish_log is too
// sparse to rely on (it records only hailmery's ~dozen own publishes), so cadence
// derives from content_drafts.
const EFFECTIVE_PUBLISH = sql`COALESCE(publish_at, updated_at)`;

// ── data gathering — one tenant-scoped transaction, explicit tenant_id ──────────

async function gatherData(db: Db, tenantId: string): Promise<GatheredData> {
  return withTenantDb(db, tenantId, async (tx) => {
    // Tenant name (getAllActiveTenants returns only {id}).
    const nameRows = await tx.execute<{ name: string }>(
      sql`SELECT name FROM marketing.tenants WHERE id = ${tenantId} LIMIT 1`,
    );
    const tenantName = nameRows.rows[0]?.name ?? 'the company';

    // 1) Per-channel performance over published/measured content.
    const cpRows = await tx.execute<Record<string, any>>(sql`
      SELECT ${CHANNEL_NORM} AS channel,
             count(*)::int AS post_count,
             count(performance_score)::int AS scored_count,
             round(avg(performance_score)::numeric, 3) AS avg_score,
             round((percentile_cont(0.5) WITHIN GROUP (ORDER BY performance_score))::numeric, 3) AS median_score,
             count(*) FILTER (
               WHERE ${EFFECTIVE_PUBLISH} >= now() - interval '14 days'
             )::int AS recent_count
      FROM marketing.content_drafts
      WHERE tenant_id = ${tenantId}
        AND status IN ('published', 'measured')
      GROUP BY 1
      ORDER BY post_count DESC
    `);
    const channelPerf: ChannelPerf[] = cpRows.rows.map((r) => ({
      channel: String(r.channel),
      postCount: Number(r.post_count ?? 0),
      scoredCount: Number(r.scored_count ?? 0),
      avgScore: r.avg_score == null ? null : Number(r.avg_score),
      medianScore: r.median_score == null ? null : Number(r.median_score),
      recentCount: Number(r.recent_count ?? 0),
    }));

    // 2) All published/measured drafts' text + score + effective publish date —
    //    drives keyword topic clusters AND trending-coverage checks (one read).
    const draftRows = await tx.execute<DraftTextRow>(sql`
      SELECT id,
             ${CHANNEL_NORM} AS channel,
             left(lower(
               coalesce(payload->>'title','')   || ' ' ||
               coalesce(payload->>'subject','') || ' ' ||
               coalesce(payload->>'text','')    || ' ' ||
               coalesce(payload->>'excerpt','') || ' ' ||
               coalesce(payload->>'body','')
             ), 2000) AS text,
             performance_score,
             ${EFFECTIVE_PUBLISH} AS published_at
      FROM marketing.content_drafts
      WHERE tenant_id = ${tenantId}
        AND status IN ('published', 'measured')
    `);
    const drafts = draftRows.rows;
    const topicPerf = buildTopicClusters(drafts);

    // 3) Queue depth + cadence per channel — counts from content_drafts.
    const qRows = await tx.execute<Record<string, any>>(sql`
      SELECT ${CHANNEL_NORM} AS channel,
             count(*) FILTER (WHERE status = 'approved')::int       AS approved_count,
             count(*) FILTER (WHERE status = 'pending_review')::int AS pending_count,
             count(*) FILTER (WHERE status = 'scheduled')::int      AS scheduled_count,
             max(${EFFECTIVE_PUBLISH}) FILTER (
               WHERE status IN ('published', 'measured')
             ) AS last_publish_at
      FROM marketing.content_drafts
      WHERE tenant_id = ${tenantId}
      GROUP BY 1
      HAVING count(*) FILTER (WHERE status IN ('approved','pending_review','scheduled','published','measured')) > 0
      ORDER BY channel
    `);
    const queueStatus: QueueChannel[] = qRows.rows.map((r) => ({
      channel: String(r.channel),
      approvedCount: Number(r.approved_count ?? 0),
      pendingCount: Number(r.pending_count ?? 0),
      scheduledCount: Number(r.scheduled_count ?? 0),
      daysSinceLastPublish: daysSince(r.last_publish_at),
    }));

    // 4) Latest intelligence brief (most recent week, tolerant of staleness).
    const briefRows = await tx.execute<Record<string, any>>(sql`
      SELECT week_of, topics, generated_at
      FROM marketing.intelligence_briefs
      WHERE tenant_id = ${tenantId}
      ORDER BY week_of DESC
      LIMIT 1
    `);
    const brief = briefRows.rows[0] ?? null;
    const { trendingTopics, trendingBriefWeekOf, trendingBriefAgeDays } = buildTrending(brief, drafts);

    // 5) Top performers by score (NO recency cutoff — imported winners are
    //    historical). days_since lets Sonnet prefer fresher ones.
    const winnerRows = await tx.execute<Record<string, any>>(sql`
      SELECT id,
             ${CHANNEL_NORM} AS channel,
             performance_score,
             left(coalesce(payload->>'title', payload->>'subject', payload->>'text', payload->>'excerpt', ''), 120) AS snippet,
             ${EFFECTIVE_PUBLISH} AS published_at
      FROM marketing.content_drafts
      WHERE tenant_id = ${tenantId}
        AND status IN ('published', 'measured')
        AND performance_score IS NOT NULL
        AND performance_score > 1.5
      ORDER BY performance_score DESC
      LIMIT 8
    `);
    const recentWinners: RecentWinner[] = winnerRows.rows.map((r) => {
      const snippet = String(r.snippet ?? '').replace(/\s+/g, ' ').trim();
      return {
        draftId: String(r.id),
        channel: String(r.channel),
        score: Number(r.performance_score),
        snippet,
        topic: topicOf(snippet.toLowerCase()),
        daysSincePublished: daysSince(r.published_at),
      };
    });

    // 6) Active campaigns.
    const campRows = await tx.execute<Record<string, any>>(sql`
      SELECT id, name, type, goal_type
      FROM marketing.campaigns
      WHERE tenant_id = ${tenantId} AND status = 'active'
      ORDER BY created_at
    `);
    const campaigns: ActiveCampaign[] = campRows.rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      type: String(r.type),
      goalType: String(r.goal_type),
    }));

    // 7) GSC keyword opportunities (latest synced week). Aggregated per query
    //    across pages so the same term on several URLs counts once; min(position)
    //    is the best rank that term holds. Empty when Google isn't connected.
    const kwRows = await tx.execute<Record<string, any>>(sql`
      WITH latest AS (
        SELECT max(week_of) AS w FROM marketing.gsc_keywords WHERE tenant_id = ${tenantId}
      )
      SELECT k.query,
             sum(k.impressions)::int AS impressions,
             sum(k.clicks)::int AS clicks,
             round(min(k.position)::numeric, 1) AS position,
             max(k.week_of) AS week_of
      FROM marketing.gsc_keywords k, latest
      WHERE k.tenant_id = ${tenantId} AND k.week_of = latest.w
      GROUP BY k.query
      ORDER BY impressions DESC
      LIMIT 50
    `);
    const seo = buildSeo(kwRows.rows, drafts);

    const totalScoredPosts = channelPerf.reduce((sum, c) => sum + c.scoredCount, 0);

    return {
      tenantName,
      channelPerf,
      topicPerf,
      queueStatus,
      trendingTopics,
      trendingBriefWeekOf,
      trendingBriefAgeDays,
      recentWinners,
      campaigns,
      seo,
      totalScoredPosts,
    };
  });
}

// ── SEO opportunity helpers ─────────────────────────────────────────────────────

// "Striking distance" = ranks on page 2 (position 4-20) with real demand
// (>100 weekly impressions). These are the queries one strong, targeted post can
// push onto page 1, so they're the highest-leverage blog topics.
const SEO_STRIKING_MIN_POSITION = 4;
const SEO_STRIKING_MAX_POSITION = 20;
const SEO_STRIKING_MIN_IMPRESSIONS = 100;

function buildSeo(rows: Record<string, any>[], drafts: DraftTextRow[]): SeoData | null {
  if (rows.length === 0) return null;
  const weekOf = rows[0].week_of ? String(rows[0].week_of).slice(0, 10) : null;
  const all: SeoQuery[] = rows.map((r) => ({
    query: String(r.query ?? ''),
    impressions: Number(r.impressions ?? 0),
    clicks: Number(r.clicks ?? 0),
    position: r.position == null ? 0 : Number(r.position),
  }));

  const strikingDistance: SeoStriking[] = all
    .filter(
      (k) =>
        k.position >= SEO_STRIKING_MIN_POSITION &&
        k.position <= SEO_STRIKING_MAX_POSITION &&
        k.impressions > SEO_STRIKING_MIN_IMPRESSIONS,
    )
    .map((k) => ({ ...k, isCovered: isQueryCovered(k.query, drafts) }))
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 5);

  return { weekOf, topQueries: all.slice(0, 10), strikingDistance };
}

/** Loose coverage check: a draft already covers the query if its text contains
 *  all the query's significant terms (or the full query when it has none). */
function isQueryCovered(query: string, drafts: DraftTextRow[]): boolean {
  const q = query.toLowerCase();
  const terms = significantTerms(q);
  if (terms.length === 0) return drafts.some((d) => d.text.includes(q));
  return drafts.some((d) => terms.every((t) => d.text.includes(t)));
}

// ── keyword bucketing helpers ───────────────────────────────────────────────────

function buildTopicClusters(drafts: DraftTextRow[]): TopicPerf[] {
  const now = Date.now();
  const clusters: TopicPerf[] = [];
  for (const { topic, keywords } of TOPIC_KEYWORDS) {
    const matches = drafts.filter((d) => keywords.some((k) => d.text.includes(k)));
    if (matches.length === 0) continue;
    const scores = matches
      .map((d) => (d.performance_score == null ? null : Number(d.performance_score)))
      .filter((s): s is number => s != null && Number.isFinite(s));
    const avgScore = scores.length ? round(scores.reduce((a, b) => a + b, 0) / scores.length, 3) : null;
    const lastTs = matches
      .map((d) => (d.published_at ? new Date(d.published_at).getTime() : NaN))
      .filter((t) => Number.isFinite(t));
    const daysSinceLastPost = lastTs.length
      ? Math.floor((now - Math.max(...lastTs)) / MS_PER_DAY)
      : null;
    clusters.push({
      topic,
      postCount: matches.length,
      scoredCount: scores.length,
      avgScore,
      daysSinceLastPost,
    });
  }
  // Highest-performing clusters first (nulls last).
  clusters.sort((a, b) => (b.avgScore ?? -1) - (a.avgScore ?? -1));
  return clusters;
}

/** The first topic cluster a piece of (lowercased) text matches, or null. */
function topicOf(lowerText: string): string | null {
  for (const { topic, keywords } of TOPIC_KEYWORDS) {
    if (keywords.some((k) => lowerText.includes(k))) return topic;
  }
  return null;
}

function buildTrending(
  brief: Record<string, any> | null,
  drafts: DraftTextRow[],
): { trendingTopics: TrendingTopic[]; trendingBriefWeekOf: string | null; trendingBriefAgeDays: number | null } {
  if (!brief) return { trendingTopics: [], trendingBriefWeekOf: null, trendingBriefAgeDays: null };

  const topics = Array.isArray(brief.topics) ? brief.topics : [];
  const weekOf = brief.week_of ? String(brief.week_of).slice(0, 10) : null;
  const ageDays = brief.generated_at ? daysSince(brief.generated_at) : null;

  // Coverage check against the 30 most-recently published posts.
  const recent = [...drafts]
    .sort((a, b) => tsOf(b.published_at) - tsOf(a.published_at))
    .slice(0, 30);
  const now = Date.now();

  const trendingTopics: TrendingTopic[] = topics.map((t: any) => {
    const topicStr = typeof t?.topic === 'string' ? t.topic : '';
    const terms = significantTerms(topicStr);
    let isCovered = false;
    let coveredTs = -1;
    for (const d of recent) {
      if (terms.length > 0 && terms.some((term) => d.text.includes(term))) {
        isCovered = true;
        coveredTs = Math.max(coveredTs, tsOf(d.published_at));
      }
    }
    return {
      topic: topicStr,
      angle: typeof t?.angle === 'string' ? t.angle : '',
      urgency: typeof t?.urgency === 'string' ? t.urgency : 'trending',
      suggestedChannel: typeof t?.suggested_channel === 'string' ? t.suggested_channel : 'linkedin',
      isCovered,
      daysSinceCovered: isCovered && coveredTs > 0 ? Math.floor((now - coveredTs) / MS_PER_DAY) : null,
    };
  });

  return { trendingTopics, trendingBriefWeekOf: weekOf, trendingBriefAgeDays: ageDays };
}

/** Lowercased words >3 chars from a topic title — used for coverage matching. */
function significantTerms(topic: string): string[] {
  return topic
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w));
}

const STOPWORDS = new Set([
  'this', 'that', 'with', 'from', 'your', 'about', 'what', 'when', 'will',
  'have', 'they', 'their', 'into', 'than', 'them', 'then', 'over', 'under',
  'while', 'which', 'these', 'those', 'after', 'before', 'should', 'could',
]);

function daysSince(ts: unknown): number | null {
  if (!ts) return null;
  const t = new Date(String(ts)).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / MS_PER_DAY));
}

function tsOf(ts: unknown): number {
  if (!ts) return 0;
  const t = new Date(String(ts)).getTime();
  return Number.isFinite(t) ? t : 0;
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

// ── prompt construction ─────────────────────────────────────────────────────────

function buildDataContext(d: GatheredData): string {
  const fmtScore = (s: number | null) => (s == null ? 'n/a' : `${s.toFixed(2)}x`);

  const channelLines = d.channelPerf.length
    ? d.channelPerf
        .map(
          (c) =>
            `- ${c.channel}: ${c.postCount} measured posts (${c.scoredCount} scored), ` +
            `avg ${fmtScore(c.avgScore)} median, ${c.recentCount} in last 14d`,
        )
        .join('\n')
    : '- (no measured posts yet)';

  const topicLines = d.topicPerf.length
    ? d.topicPerf
        .slice(0, 10)
        .map(
          (t) =>
            `- "${t.topic}": avg ${fmtScore(t.avgScore)} across ${t.postCount} posts ` +
            `(${t.scoredCount} scored)` +
            (t.daysSinceLastPost == null ? '' : `, last posted ${t.daysSinceLastPost}d ago`),
        )
        .join('\n')
    : '- (no recognised topic clusters in posted content)';

  const queueLines = d.queueStatus.length
    ? d.queueStatus
        .map(
          (q) =>
            `- ${q.channel}: ${q.approvedCount} approved, ${q.pendingCount} pending review, ` +
            `${q.scheduledCount} scheduled` +
            (q.daysSinceLastPublish == null
              ? ', never published'
              : `, last published ${q.daysSinceLastPublish}d ago`),
        )
        .join('\n')
    : '- (queue is empty)';

  let trendingBlock: string;
  if (d.trendingTopics.length) {
    const staleNote =
      d.trendingBriefAgeDays != null && d.trendingBriefAgeDays > 7
        ? ` (NOTE: brief is ${d.trendingBriefAgeDays}d old — some "breaking" items may have aged)`
        : '';
    trendingBlock =
      `(from intelligence brief week_of ${d.trendingBriefWeekOf ?? 'unknown'}${staleNote})\n` +
      d.trendingTopics
        .map(
          (t) =>
            `- "${t.topic}" [${t.urgency}, suggested ${t.suggestedChannel}]: ` +
            (t.isCovered
              ? `covered ${t.daysSinceCovered ?? '?'}d ago`
              : 'NOT YET COVERED') +
            (t.angle ? ` — angle: ${t.angle}` : ''),
        )
        .join('\n');
  } else {
    trendingBlock = '- (no intelligence brief available)';
  }

  const winnerLines = d.recentWinners.length
    ? d.recentWinners
        .map(
          (w) =>
            `- ${w.channel} (score ${w.score.toFixed(2)}x` +
            (w.daysSincePublished == null ? '' : `, ${w.daysSincePublished}d ago`) +
            (w.topic ? `, topic ${w.topic}` : '') +
            `): "${w.snippet}"`,
        )
        .join('\n')
    : '- (no posts scored above 1.5x median)';

  const campaignLines = d.campaigns.length
    ? d.campaigns
        .map((c) => `- ${c.name} [id ${c.id}] (${c.type}, goal ${c.goalType})`)
        .join('\n')
    : '- (no active campaigns)';

  // SEO block only when GSC is connected + has data; otherwise a one-line note so
  // Sonnet knows the signal is absent (and won't invent an seo_opportunity).
  let seoBlock: string;
  if (d.seo && (d.seo.strikingDistance.length || d.seo.topQueries.length)) {
    const parts: string[] = [];
    if (d.seo.strikingDistance.length) {
      parts.push(
        'Striking-distance queries (rank 4-20, >100 impressions/wk — page-2 terms one strong post can lift to page 1):',
        ...d.seo.strikingDistance.map(
          (s) =>
            `- "${s.query}": ${s.impressions} impressions, avg position ${s.position}, ${s.clicks} clicks — ` +
            (s.isCovered ? 'has related content already' : 'NOT YET COVERED by a post'),
        ),
      );
    }
    if (d.seo.topQueries.length) {
      parts.push(
        'Top queries by impressions:',
        ...d.seo.topQueries
          .slice(0, 8)
          .map((q) => `- "${q.query}": ${q.impressions} impressions, position ${q.position}`),
      );
    }
    seoBlock = parts.join('\n');
  } else {
    seoBlock = '- (no Google Search Console data — Google not connected, or no keywords synced yet)';
  }

  return [
    `CHANNEL PERFORMANCE (published/measured content):`,
    channelLines,
    ``,
    `TOP PERFORMING TOPIC CLUSTERS (keyword-tagged, ranked by avg score):`,
    topicLines,
    ``,
    `QUEUE STATUS (approval pipeline + cadence, from content_drafts):`,
    queueLines,
    ``,
    `TRENDING TOPICS THIS WEEK:`,
    trendingBlock,
    ``,
    `TOP PERFORMERS (score > 1.5x median; ranked by score, prefer recent):`,
    winnerLines,
    ``,
    `ACTIVE CAMPAIGNS:`,
    campaignLines,
    ``,
    `SEO OPPORTUNITIES (Google Search Console${d.seo?.weekOf ? `, week of ${d.seo.weekOf}` : ''}):`,
    seoBlock,
  ].join('\n');
}

const SYSTEM_PROMPT = (tenantName: string) =>
  [
    `You are the hailmery recommendations engine for ${tenantName}.`,
    `Your job: analyse this brand's real marketing performance data and identify the`,
    `top 5 highest-impact actions for THIS WEEK.`,
    ``,
    `Return ONLY a valid JSON array — no preamble, no markdown fences, no commentary`,
    `outside the JSON. Each recommendation must be specific, data-backed, and`,
    `immediately actionable.`,
    ``,
    `Recommendation types:`,
    `- content_gap: a high-performing topic cluster hasn't been posted recently`,
    `- channel_rebalance: a channel consistently under- or over-performs`,
    `- trending_opportunity: a trending brief topic not yet covered`,
    `- queue_health: a channel is running low on approved/pending content`,
    `- engagement_followup: build on a recent high-performer (same topic)`,
    `- seo_opportunity: a Google Search Console query with real demand (>100 impressions/wk)`,
    `  where the brand ranks position 4-20 (page 2) and NO post targets it — one`,
    `  authoritative blog post can move it from page 2 to page 1. Use action_type`,
    `  "generate", channel "blog", and set action_params.topic to the exact query.`,
    `  Only emit this when the SEO OPPORTUNITIES section lists uncovered striking-`,
    `  distance queries; never invent one when that data is absent.`,
    ``,
    `Rules:`,
    `1. Return exactly 5 recommendations, ranked by impact (highest priority first).`,
    `2. Every recommendation MUST cite specific numbers from the data (scores, counts, days).`,
    `3. action_params must contain everything needed to execute the action.`,
    `4. priority_score: 8-10 = urgent (this week), 5-7 = important, 1-4 = nice to have.`,
    `5. reasoning must be 1-2 sentences, citing the exact data point.`,
    `6. Never recommend the same action twice.`,
    `7. Prefer recommendations with a clear ROI signal over vague "post more" advice.`,
    `8. If a type lacks signal (e.g. only one channel has measured content, so`,
    `   channel_rebalance is meaningless), DO NOT force it — substitute a second,`,
    `   genuinely data-backed recommendation of a stronger type instead. Five strong`,
    `   recommendations beat four strong plus one generic.`,
    ``,
    `For action_type=generate, action_params.channel MUST be one of:`,
    `blog, linkedin, x, instagram, email, tiktok.`,
  ].join('\n');

const USER_PROMPT = (tenantName: string, dataContext: string) =>
  [
    `Here is the current marketing performance data for ${tenantName}. Analyse it and`,
    `return the top 5 recommendations.`,
    ``,
    dataContext,
    ``,
    `Return a JSON array with exactly 5 objects, each having:`,
    `{`,
    `  "type": "content_gap|channel_rebalance|trending_opportunity|queue_health|engagement_followup|seo_opportunity",`,
    `  "title": "Short action title (max 60 chars)",`,
    `  "description": "1-2 sentence description of what to do and why",`,
    `  "reasoning": "The specific data point that drives this (cite the number)",`,
    `  "action_type": "generate|approve|review_queue",`,
    `  "action_params": {`,
    `    "topic": "specific topic string if action_type=generate",`,
    `    "channel": "blog|linkedin|x|instagram|email|tiktok",`,
    `    "campaign_id": "uuid of relevant active campaign if applicable",`,
    `    "draft_ids": ["uuid", ...]  // if action_type=approve`,
    `  },`,
    `  "priority_score": 1-10,`,
    `  "data_snapshot": { /* the raw numbers used in reasoning */ }`,
    `}`,
  ].join('\n');

// ── Sonnet reasoning call (no web_search) ───────────────────────────────────────

async function callSonnet(tenantName: string, dataContext: string): Promise<RecommendationDraft[]> {
  const response = await anthropic().messages.create({
    model: MODELS.SONNET,
    max_tokens: 4096,
    system: [{ type: 'text', text: SYSTEM_PROMPT(tenantName) }],
    messages: [{ role: 'user', content: USER_PROMPT(tenantName, dataContext) }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');

  return parseRecommendations(text);
}

/** Pull a JSON array out of the model response, tolerating ```json fences and
 *  surrounding prose, then coerce + validate each element. */
export function parseRecommendations(text: string): RecommendationDraft[] {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  let body = fence ? fence[1] : text;
  const start = body.indexOf('[');
  const end = body.lastIndexOf(']');
  if (start !== -1 && end !== -1 && end > start) body = body.slice(start, end + 1);

  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];

  return raw
    .map((r) => coerceRecommendation(r))
    .filter((r): r is RecommendationDraft => r !== null);
}

function coerceRecommendation(r: unknown): RecommendationDraft | null {
  if (!r || typeof r !== 'object') return null;
  const o = r as Record<string, unknown>;

  const type = o.type;
  if (typeof type !== 'string' || !(RECOMMENDATION_TYPES as readonly string[]).includes(type)) {
    return null; // unknown type → malformed, drop it
  }
  const title = typeof o.title === 'string' ? o.title.trim().slice(0, 200) : '';
  const description = typeof o.description === 'string' ? o.description.trim() : '';
  const reasoning = typeof o.reasoning === 'string' ? o.reasoning.trim() : '';
  if (!title || !description || !reasoning) return null;

  const actionTypeRaw = typeof o.action_type === 'string' ? o.action_type : '';
  const actionType: RecommendationActionType = (RECOMMENDATION_ACTION_TYPES as readonly string[]).includes(
    actionTypeRaw,
  )
    ? (actionTypeRaw as RecommendationActionType)
    : 'review_queue';

  const actionParams = normalizeActionParams(o.action_params, actionType);

  let priorityScore = 5;
  const ps = Number(o.priority_score);
  if (Number.isFinite(ps)) priorityScore = Math.min(10, Math.max(1, Math.round(ps)));

  const dataSnapshot =
    o.data_snapshot && typeof o.data_snapshot === 'object' && !Array.isArray(o.data_snapshot)
      ? (o.data_snapshot as Record<string, unknown>)
      : {};

  return {
    type: type as RecommendationType,
    title,
    description,
    reasoning,
    actionType,
    actionParams,
    priorityScore,
    dataSnapshot,
  };
}

function normalizeActionParams(raw: unknown, actionType: RecommendationActionType): Record<string, unknown> {
  const params: Record<string, unknown> =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {};

  // Normalise channel into the modal's option set so "Generate now" pre-fill matches.
  if (typeof params.channel === 'string') {
    const norm = normActionChannel(params.channel);
    if (norm) params.channel = norm;
    else delete params.channel;
  }
  // A generate action with no usable channel defaults to linkedin (the modal default).
  if (actionType === 'generate' && typeof params.channel !== 'string') {
    params.channel = 'linkedin';
  }
  // Keep draft_ids only as a string[].
  if (params.draft_ids !== undefined) {
    params.draft_ids = Array.isArray(params.draft_ids)
      ? params.draft_ids.filter((x) => typeof x === 'string')
      : [];
  }
  return params;
}

function normActionChannel(ch: unknown): string | undefined {
  if (typeof ch !== 'string') return undefined;
  let c = ch.toLowerCase().trim();
  if (c === 'twitter') c = 'x';
  if (c === 'wix-blog') c = 'blog';
  if (c === 'sendgrid') c = 'email';
  if (c === 'gbp') c = 'linkedin';
  return VALID_ACTION_CHANNELS.has(c) ? c : undefined;
}

// ── per-tenant entry point ──────────────────────────────────────────────────────

export async function generateRecommendations(opts: {
  db: Db;
  tenantId: string;
  weekOf?: string;
}): Promise<RecommendationResult> {
  const { db, tenantId } = opts;
  const weekOf = opts.weekOf ?? mondayOf();

  const data = await gatherData(db, tenantId);

  // Need a floor of scored posts, else recommendations would be guesswork.
  if (data.totalScoredPosts < MIN_SCORED_POSTS) {
    console.log(
      `[recommendations] skipping tenant=${tenantId}: only ${data.totalScoredPosts} scored posts`,
    );
    return {
      tenantId,
      skipped: true,
      reason: 'insufficient_data',
      scoredPosts: data.totalScoredPosts,
    };
  }

  const dataContext = buildDataContext(data);
  const recs = (await callSonnet(data.tenantName, dataContext)).slice(0, 5);

  if (recs.length === 0) {
    throw new Error('Sonnet returned no valid recommendations');
  }

  // expires_at = the Monday AFTER weekOf (one week window).
  const expiresAt = new Date(`${weekOf}T00:00:00.000Z`);
  expiresAt.setUTCDate(expiresAt.getUTCDate() + 7);
  const expiresIso = expiresAt.toISOString();

  // Replace this week's pending set (idempotent re-run), then insert fresh rows.
  await withTenantDb(db, tenantId, async (tx) => {
    await tx.execute(sql`
      DELETE FROM marketing.recommendations
      WHERE tenant_id = ${tenantId} AND week_of = ${weekOf}::date AND status = 'pending'
    `);
    for (const r of recs) {
      await tx.execute(sql`
        INSERT INTO marketing.recommendations
          (tenant_id, type, title, description, reasoning, action_type, action_params,
           priority_score, data_snapshot, status, week_of, expires_at)
        VALUES (
          ${tenantId},
          ${r.type}::marketing.recommendation_type,
          ${r.title}, ${r.description}, ${r.reasoning},
          ${r.actionType}::marketing.recommendation_action_type,
          ${JSON.stringify(r.actionParams)}::jsonb,
          ${r.priorityScore},
          ${JSON.stringify(r.dataSnapshot)}::jsonb,
          'pending',
          ${weekOf}::date,
          ${expiresIso}::timestamptz
        )
      `);
    }
  });

  console.log(
    `[recommendations] tenant=${tenantId} week_of=${weekOf} generated=${recs.length} ` +
      `scored=${data.totalScoredPosts}`,
  );

  return {
    tenantId,
    skipped: false,
    generated: recs.length,
    weekOf,
    scoredPosts: data.totalScoredPosts,
    recommendations: recs.map((r) => ({
      type: r.type,
      title: r.title,
      priorityScore: r.priorityScore,
      actionType: r.actionType,
    })),
  };
}

// ── cron tick — fleet-wide nightly run (called from runNightlyTick) ─────────────

export async function runRecommendationsTick(env: PipelineEnv): Promise<void> {
  mirrorEnvToProcess(env);
  const db = makeDb(env.DATABASE_URL);
  const tenants = await getAllActiveTenants(db);
  const weekOf = mondayOf();
  for (const tenant of tenants) {
    try {
      await generateRecommendations({ db, tenantId: tenant.id, weekOf });
    } catch (err) {
      console.error(
        `[recommendations] tenant ${tenant.id} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}
