// CLI:
//   pnpm gen blog --tenant apire "topic seed"
//   pnpm gen social --tenant apire "topic seed"
//
// Blog pipeline:
//   1. Resolve tenant slug → tenant_id
//   2. RAG + Sonnet 4.6 generation → frontmatter + body
//   3. Brand Guardian (Haiku 4.5) scan → JSON report
//   4. Write out/{slug}/{date}-{post-slug}.md  +  .guardian.json
//
// Social pipeline:
//   1. Resolve tenant
//   2. RAG + Sonnet 4.6 → LinkedIn + X + Hook
//   3. Write out/{slug}/social/{topic-slug}/{linkedin,x,hook}.txt and pack.json

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { db } from '../db/client.js';
import { findTenantBySlug } from '../lib/tenant.js';
import { generateBlog } from '../generation/blog.js';
import { generateSocialPack } from '../generation/social.js';
import { brandGuardian } from '../agents/guardian.js';

function parseArgs(argv: string[]) {
  if (argv.length < 1) throw new Error('Usage: pnpm gen <blog|social> --tenant <slug> "<topic>"');
  const kind = argv[0];
  if (kind !== 'blog' && kind !== 'social') {
    throw new Error(`Unknown gen kind: ${kind} (expected blog | social)`);
  }

  let tenant: string | undefined;
  const positional: string[] = [];

  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--tenant') {
      tenant = argv[++i];
    } else if (a.startsWith('--')) {
      throw new Error(`Unknown flag: ${a}`);
    } else {
      positional.push(a);
    }
  }

  if (!tenant) throw new Error('Missing --tenant');
  if (positional.length === 0) throw new Error('Missing topic');
  const topic = positional.join(' ');
  return { kind, tenant, topic };
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function escapeYaml(s: string): string {
  if (/[:#"'\[\]{}|>!&*]/.test(s)) return JSON.stringify(s);
  return s;
}

async function runBlog(tenant: { id: string; name: string; slug: string }, topic: string) {
  console.log('[gen blog] generating draft via Claude Sonnet 4.6...');
  const draft = await generateBlog({ db, tenantId: tenant.id, tenantName: tenant.name, topic });
  console.log(
    `[gen blog] usage: in=${draft.usage.input_tokens} out=${draft.usage.output_tokens} cache_read=${draft.usage.cache_read_input_tokens ?? 0}`
  );

  console.log('[gen blog] running Brand Guardian via Claude Haiku 4.5...');
  const guardian = await brandGuardian({ db, tenantId: tenant.id, draftText: draft.body });
  console.log(`[gen blog] guardian score=${guardian.score.toFixed(2)} flagged=${guardian.flagged.length}`);
  if (guardian.flagged.length > 0) {
    for (const f of guardian.flagged) console.warn(`  ⚠ ${f.term} — ${f.reasoning}`);
  }

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
    'utf-8'
  );

  console.log(`[gen blog] wrote ${mdPath}`);
  console.log(`[gen blog] wrote ${guardianPath}`);
}

async function runSocial(tenant: { id: string; name: string; slug: string }, topic: string) {
  console.log('[gen social] generating LinkedIn / X / Hook via Claude Sonnet 4.6...');
  const pack = await generateSocialPack({ db, tenantId: tenant.id, tenantName: tenant.name, topic });
  console.log(
    `[gen social] usage: in=${pack.usage.input_tokens} out=${pack.usage.output_tokens} cache_read=${pack.usage.cache_read_input_tokens ?? 0}`
  );

  const topicSlug = slugify(topic);
  const outDir = join(process.cwd(), 'out', tenant.slug, 'social', topicSlug);
  await mkdir(outDir, { recursive: true });

  await writeFile(join(outDir, 'linkedin.txt'), pack.linkedin + '\n', 'utf-8');
  await writeFile(join(outDir, 'x.txt'), pack.x + '\n', 'utf-8');
  await writeFile(join(outDir, 'hook.txt'), pack.hook + '\n', 'utf-8');
  await writeFile(
    join(outDir, 'pack.json'),
    JSON.stringify({ tenant: tenant.slug, topic, sources: pack.sources, usage: pack.usage, pack: { linkedin: pack.linkedin, x: pack.x, hook: pack.hook } }, null, 2),
    'utf-8'
  );

  console.log(`[gen social] wrote ${outDir}/`);
  console.log(`  linkedin (${pack.linkedin.split(/\s+/).filter(Boolean).length} words)`);
  console.log(`  x        (${pack.x.length} chars)`);
  console.log(`  hook     (${pack.hook.length} chars)`);
}

async function main() {
  const { kind, tenant: tenantSlug, topic } = parseArgs(process.argv.slice(2));

  const tenant = await findTenantBySlug(db, tenantSlug);
  if (!tenant) {
    console.error(`No tenant '${tenantSlug}'. Did you run pnpm db:seed?`);
    process.exit(1);
  }

  console.log(`[gen] kind=${kind} tenant=${tenant.name} topic="${topic}"`);

  if (kind === 'blog') await runBlog(tenant, topic);
  else await runSocial(tenant, topic);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
