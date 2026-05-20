// CLI: pnpm gen blog --tenant apire "topic seed"
//
// Pipeline:
//   1. Resolve tenant slug → tenant_id
//   2. RAG + Sonnet 4.6 generation → frontmatter + body
//   3. Brand Guardian (Haiku 4.5) scan → JSON report
//   4. Write out/{slug}/{date}-{post-slug}.md  +  .guardian.json

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { db } from '../db/client.js';
import { findTenantBySlug } from '../lib/tenant.js';
import { generateBlog } from '../generation/blog.js';
import { brandGuardian } from '../agents/guardian.js';

function parseArgs(argv: string[]) {
  // shape: [kind] [--flag value]... ["topic"]
  if (argv.length < 1) throw new Error('Usage: pnpm gen blog --tenant <slug> "<topic>"');
  const kind = argv[0];
  if (kind !== 'blog') throw new Error(`Unknown gen kind: ${kind}`);

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

async function main() {
  const { tenant: tenantSlug, topic } = parseArgs(process.argv.slice(2));

  const tenant = await findTenantBySlug(db, tenantSlug);
  if (!tenant) {
    console.error(`No tenant '${tenantSlug}'. Did you run pnpm db:seed?`);
    process.exit(1);
  }

  console.log(`[gen] tenant=${tenant.name} topic="${topic}"`);

  // 1. Generate
  console.log('[gen] generating blog draft via Claude Sonnet 4.6...');
  const draft = await generateBlog({
    db,
    tenantId: tenant.id,
    tenantName: tenant.name,
    topic,
  });

  console.log(`[gen] usage: in=${draft.usage.input_tokens} out=${draft.usage.output_tokens} cache_read=${draft.usage.cache_read_input_tokens ?? 0}`);

  // 2. Run brand guardian over the body
  console.log('[gen] running Brand Guardian via Claude Haiku 4.5...');
  const guardian = await brandGuardian({ db, tenantId: tenant.id, draftText: draft.body });
  console.log(`[gen] guardian score=${guardian.score.toFixed(2)} flagged=${guardian.flagged.length}`);
  if (guardian.flagged.length > 0) {
    for (const f of guardian.flagged) {
      console.warn(`  ⚠ ${f.term} — ${f.reasoning}`);
    }
  }

  // 3. Write files
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
    JSON.stringify(
      { tenant: tenant.slug, topic, sources: draft.sources, usage: draft.usage, guardian },
      null,
      2
    ),
    'utf-8'
  );

  console.log(`\n[gen] wrote ${mdPath}`);
  console.log(`[gen] wrote ${guardianPath}`);
}

function escapeYaml(s: string): string {
  if (/[:#"'\[\]{}|>!&*]/.test(s)) return JSON.stringify(s);
  return s;
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
