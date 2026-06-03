// CLI:
//   pnpm gen blog   --tenant apire "topic seed"
//   pnpm gen social --tenant apire --channel linkedin "topic seed"
//   pnpm gen email  --tenant apire --type newsletter "topic seed" [--audience "..."]
//   pnpm gen image  --tenant apire --draft-id <uuid> --type blog_header
//
// blog still writes out/{slug}/{date}-{post-slug}.md (+ .guardian.json).
// social/email generate through the DB (content_drafts, status=pending_review),
// print the full output for a quality check, and also drop a copy under out/.
// image builds an Ideogram prompt + (when IDEOGRAM_API_KEY is set) the image.

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { db } from '../db/client.js';
import { findTenantBySlug } from '../lib/tenant.js';
import { generateBlog } from '../generation/blog.js';
import { generateSocial } from '../generation/social.js';
import { generateEmail } from '../generation/email.js';
import { generateImage } from '../generation/image.js';
import { brandGuardian } from '../agents/guardian.js';

const KINDS = new Set(['blog', 'social', 'email', 'image']);

interface ParsedArgs {
  kind: string;
  tenant: string;
  channel?: string;
  type?: string;
  draftId?: string;
  audience?: string;
  topic: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  if (argv.length < 1) {
    throw new Error('Usage: pnpm gen <blog|social|email|image> --tenant <slug> [flags] "<topic>"');
  }
  const kind = argv[0];
  if (!KINDS.has(kind)) throw new Error(`Unknown gen kind: ${kind} (expected blog | social | email | image)`);

  let tenant: string | undefined;
  let channel: string | undefined;
  let type: string | undefined;
  let draftId: string | undefined;
  let audience: string | undefined;
  const positional: string[] = [];

  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--tenant') tenant = argv[++i];
    else if (a === '--channel') channel = argv[++i];
    else if (a === '--type') type = argv[++i];
    else if (a === '--draft-id') draftId = argv[++i];
    else if (a === '--audience') audience = argv[++i];
    else if (a.startsWith('--')) throw new Error(`Unknown flag: ${a}`);
    else positional.push(a);
  }

  if (!tenant) throw new Error('Missing --tenant');
  const topic = positional.join(' ');

  if (kind === 'social' && !channel) throw new Error('social requires --channel <linkedin|x|instagram|tiktok|gbp>');
  if (kind === 'email' && !type) throw new Error('email requires --type <newsletter|drip|outreach>');
  if (kind === 'image') {
    if (!draftId) throw new Error('image requires --draft-id <uuid>');
    if (!type) throw new Error('image requires --type <blog_header|social_square|email_header|ad_creative>');
  }
  if (kind !== 'image' && topic.length === 0) throw new Error('Missing topic');

  return { kind, tenant, channel, type, draftId, audience, topic };
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

function escapeYaml(s: string): string {
  if (/[:#"'\[\]{}|>!&*]/.test(s)) return JSON.stringify(s);
  return s;
}

const hr = '─'.repeat(64);

// ── blog ────────────────────────────────────────────────────────────
async function runBlog(tenant: { id: string; name: string; slug: string }, topic: string) {
  console.log('[gen blog] generating draft via Claude Sonnet 4.6...');
  const draft = await generateBlog({ db, tenantId: tenant.id, tenantName: tenant.name, topic });
  console.log(
    `[gen blog] usage: in=${draft.usage.input_tokens} out=${draft.usage.output_tokens} cache_read=${draft.usage.cache_read_input_tokens ?? 0}`,
  );

  console.log('[gen blog] running Brand Guardian via Claude Haiku 4.5...');
  const guardian = await brandGuardian({ db, tenantId: tenant.id, draftText: draft.body });
  console.log(`[gen blog] guardian score=${guardian.score.toFixed(2)} flagged=${guardian.flagged.length}`);
  for (const f of guardian.flagged) console.warn(`  ⚠ ${f.term} — ${f.reasoning}`);

  const outDir = join(process.cwd(), 'out', tenant.slug);
  await mkdir(outDir, { recursive: true });
  const baseName = `${draft.frontmatter.date}-${draft.frontmatter.slug}`;
  const mdPath = join(outDir, `${baseName}.md`);
  const guardianPath = join(outDir, `${baseName}.guardian.json`);

  const fmYaml = [
    '---',
    `title: ${escapeYaml(draft.frontmatter.title)}`,
    `slug: ${draft.frontmatter.slug}`,
    `date: ${draft.frontmatter.date}`,
    `tags: [${draft.frontmatter.tags.join(', ')}]`,
    `excerpt: ${escapeYaml(draft.frontmatter.excerpt)}`,
    `sources: [${draft.sources.map((s) => `"${s}"`).join(', ')}]`,
    `guardian_score: ${guardian.score.toFixed(2)}`,
    '---',
    '',
  ].join('\n');

  await writeFile(mdPath, fmYaml + draft.body + '\n', 'utf-8');
  await writeFile(
    guardianPath,
    JSON.stringify({ tenant: tenant.slug, topic, sources: draft.sources, usage: draft.usage, guardian }, null, 2),
    'utf-8',
  );
  console.log(`[gen blog] wrote ${mdPath}`);
  console.log(`[gen blog] wrote ${guardianPath}`);
}

// ── social ──────────────────────────────────────────────────────────
async function runSocial(tenant: { id: string; slug: string }, channel: string, topic: string) {
  console.log(`[gen social] channel=${channel} — generating via Claude Sonnet 4.6...`);
  const res = await generateSocial({ db, tenantId: tenant.id, topic, channel });
  console.log(
    `[gen social] usage: in=${res.usage.input_tokens} out=${res.usage.output_tokens} cache_read=${res.usage.cache_read_input_tokens ?? 0}`,
  );
  console.log(`[gen social] draft id=${res.draftId} guardian=${res.guardianScore.toFixed(2)} flagged=${res.flaggedCount}`);
  console.log(`[gen social] ${res.channelLabel} — ${res.wordCount} words / ${res.charCount} chars`);
  console.log(`\n${hr}\n${res.channelLabel.toUpperCase()} POST\n${hr}\n${res.text}\n${hr}\n`);

  const outDir = join(process.cwd(), 'out', tenant.slug, 'social', slugify(topic));
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, `${channel}.txt`), res.text + '\n', 'utf-8');
  await writeFile(
    join(outDir, `${channel}.json`),
    JSON.stringify({ tenant: tenant.slug, topic, ...res }, null, 2),
    'utf-8',
  );
  console.log(`[gen social] wrote ${join(outDir, `${channel}.txt`)}`);
}

// ── email ───────────────────────────────────────────────────────────
async function runEmail(tenant: { id: string; slug: string }, type: string, topic: string, audience?: string) {
  console.log(`[gen email] type=${type} — generating via Claude Sonnet 4.6...`);
  const res = await generateEmail({ db, tenantId: tenant.id, emailType: type, topic, audienceBrief: audience });
  console.log(
    `[gen email] usage: in=${res.usage.input_tokens} out=${res.usage.output_tokens} cache_read=${res.usage.cache_read_input_tokens ?? 0}`,
  );
  console.log(`[gen email] draft id=${res.draftId ?? '(not queued)'} guardian=${res.guardianScore.toFixed(2)} flagged=${res.flaggedCount}`);

  const outDir = join(process.cwd(), 'out', tenant.slug, 'email', `${type}-${slugify(topic)}`);
  await mkdir(outDir, { recursive: true });

  if (res.newsletter) {
    const n = res.newsletter;
    console.log(`\n${hr}\nNEWSLETTER\n${hr}`);
    console.log(`Subject (${n.subjectLine.length} chars): ${n.subjectLine}`);
    console.log(`Preview (${n.previewText.length} chars): ${n.previewText}\n`);
    console.log(`PLAIN TEXT:\n${n.plainText}\n${hr}\n`);
    await writeFile(join(outDir, 'newsletter.html'), n.htmlBody, 'utf-8');
    await writeFile(join(outDir, 'newsletter.txt'), n.plainText, 'utf-8');
  }
  if (res.sequence) {
    console.log(`\n${hr}\nDRIP SEQUENCE (${res.sequence.length} emails)\n${hr}`);
    for (const e of res.sequence) {
      console.log(`\n— Day ${e.dayOffset} —`);
      console.log(`Subject (${e.subject.length}): ${e.subject}`);
      console.log(`Preview (${e.previewText.length}): ${e.previewText}`);
      console.log(`Plain:\n${e.plainText}`);
      await writeFile(join(outDir, `day-${e.dayOffset}.html`), e.htmlBody, 'utf-8');
      await writeFile(join(outDir, `day-${e.dayOffset}.txt`), e.plainText, 'utf-8');
    }
    console.log(`\n${hr}\n`);
  }
  if (res.outreach) {
    const o = res.outreach;
    console.log(`\n${hr}\nOUTREACH (cold email — not queued)\n${hr}`);
    console.log(`Subject (${o.subject.length}): ${o.subject}`);
    console.log(`Opening: ${o.openingLine}`);
    console.log(`Body:\n${o.body}\n${hr}\n`);
    await writeFile(join(outDir, 'outreach.txt'), `Subject: ${o.subject}\n\n${o.openingLine}\n\n${o.body}\n`, 'utf-8');
  }

  await writeFile(join(outDir, 'meta.json'), JSON.stringify({ tenant: tenant.slug, type, topic, ...res }, null, 2), 'utf-8');
  console.log(`[gen email] wrote ${outDir}/`);
}

// ── image ───────────────────────────────────────────────────────────
async function runImage(tenant: { id: string; slug: string }, draftId: string, type: string) {
  console.log(`[gen image] draft=${draftId} type=${type} — classifying + building prompt via Claude Sonnet 4.6...`);
  const res = await generateImage({ db, tenantId: tenant.id, draftId, imageType: type });
  console.log(
    `[gen image] category=${res.categoryLetter} (${res.category}) provider=${res.provider} model=${res.model}`,
  );
  const v = res.validation;
  console.log(
    `[gen image] validation ${v.passed ? 'PASS' : 'FAIL'} — ` +
      `no_text=${v.checks.noText} no_brand_names=${v.checks.noBrandNames} ` +
      `words(${v.wordCount})=${v.checks.wordCount} brand_hex=${v.checks.brandHex}` +
      (v.failures.length ? ` failures=[${v.failures.join('; ')}]` : ''),
  );
  console.log(`\n${hr}\nIMAGE PROMPT (${res.imageType}, ${res.aspectRatio})\n${hr}\n${res.prompt}\n${hr}\n`);
  if (res.skipped) {
    console.warn(`[gen image] ${res.provider} key not set — API call skipped, placeholder returned.`);
  } else {
    console.log(`[gen image] stored to ${res.storedTo}; r2_key=${res.r2Key}`);
  }
  console.log(`[gen image] url: ${res.url}`);
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const tenant = await findTenantBySlug(db, parsed.tenant);
  if (!tenant) {
    console.error(`No tenant '${parsed.tenant}'. Did you run pnpm db:seed?`);
    process.exit(1);
  }

  console.log(
    `[gen] kind=${parsed.kind} tenant=${tenant.name}` +
      (parsed.channel ? ` channel=${parsed.channel}` : '') +
      (parsed.type ? ` type=${parsed.type}` : '') +
      (parsed.topic ? ` topic="${parsed.topic}"` : ''),
  );

  switch (parsed.kind) {
    case 'blog':
      await runBlog(tenant, parsed.topic);
      break;
    case 'social':
      await runSocial(tenant, parsed.channel!, parsed.topic);
      break;
    case 'email':
      await runEmail(tenant, parsed.type!, parsed.topic, parsed.audience);
      break;
    case 'image':
      await runImage(tenant, parsed.draftId!, parsed.type!);
      break;
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
