// V0 batch runner — generates the 10 blog drafts + 30 social posts in a single
// process to reuse Neon and Anthropic connections (faster + cheaper than
// 20 separate CLI invocations).
//
//   pnpm exec tsx --env-file=.env scripts/v0-pipeline.ts
//
// Outputs:
//   out/apire/{date}-{slug}.md  + .guardian.json   (10 blogs)
//   out/apire/social/{topic-slug}/{linkedin,x,hook}.txt + pack.json (30 = 10*3)
//   out/apire/_v0-summary.json — manifest

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { db } from '../src/db/client.js';
import { findTenantBySlug } from '../src/lib/tenant.js';
import { generateBlog } from '../src/generation/blog.js';
import { generateSocialPack } from '../src/generation/social.js';
import { brandGuardian } from '../src/agents/guardian.js';

const TOPICS = [
  'AI security for EU CISOs facing NIS2 compliance',
  'Why API security is not enough for AI systems',
  'EU AI Act Article 10 compliance for enterprise',
  'Zero-day AI threat detection without code changes',
  'GDPR compliance for companies using OpenAI APIs',
  'AI gateway security vs traditional WAF',
  'Prompt injection attacks — what they are and how to stop them',
  'How APIRE protects AI in 5 minutes with no code changes',
  'NIS2 directive obligations for AI-powered companies',
  'Data exfiltration through AI APIs — the hidden risk',
];

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

async function main() {
  const tenant = await findTenantBySlug(db, 'apire');
  if (!tenant) throw new Error("Tenant 'apire' not found — run pnpm db:seed");

  const outDir = join(process.cwd(), 'out', tenant.slug);
  const socialRoot = join(outDir, 'social');
  await mkdir(outDir, { recursive: true });
  await mkdir(socialRoot, { recursive: true });

  const manifest: {
    tenant: string;
    blogs: Array<{
      topic: string;
      file: string;
      guardianFile: string;
      title: string;
      slug: string;
      wordCount: number;
      guardianScore: number;
      flaggedCount: number;
      flagged: Array<{ term: string; quote: string; reasoning: string }>;
      sources: string[];
      usage: Record<string, number | undefined>;
    }>;
    social: Array<{
      topic: string;
      dir: string;
      linkedinWords: number;
      xChars: number;
      hookChars: number;
      sources: string[];
      usage: Record<string, number | undefined>;
    }>;
    timings: { startedAt: string; finishedAt: string; durationSec: number };
    totals: { blogs: number; social: number };
  } = {
    tenant: tenant.slug,
    blogs: [],
    social: [],
    timings: { startedAt: new Date().toISOString(), finishedAt: '', durationSec: 0 },
    totals: { blogs: 0, social: 0 },
  };

  const t0 = Date.now();

  // === BLOG PASS ===
  for (let i = 0; i < TOPICS.length; i++) {
    const topic = TOPICS[i];
    console.log(`\n=== [blog ${i + 1}/${TOPICS.length}] ${topic} ===`);

    try {
      const draft = await generateBlog({
        db,
        tenantId: tenant.id,
        tenantName: tenant.name,
        topic,
      });
      console.log(
        `[blog] usage in=${draft.usage.input_tokens} out=${draft.usage.output_tokens} cache_read=${draft.usage.cache_read_input_tokens ?? 0}`
      );

      const guardian = await brandGuardian({ db, tenantId: tenant.id, draftText: draft.body });
      console.log(
        `[blog] guardian score=${guardian.score.toFixed(2)} flagged=${guardian.flagged.length}`
      );
      for (const f of guardian.flagged) console.warn(`  ⚠ ${f.term} — ${f.reasoning}`);

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

      const wordCount = draft.body.split(/\s+/).filter(Boolean).length;
      manifest.blogs.push({
        topic,
        file: mdPath,
        guardianFile: guardianPath,
        title: draft.frontmatter.title,
        slug: draft.frontmatter.slug,
        wordCount,
        guardianScore: guardian.score,
        flaggedCount: guardian.flagged.length,
        flagged: guardian.flagged,
        sources: draft.sources,
        usage: draft.usage,
      });
    } catch (err) {
      console.error(`[blog] FAILED for "${topic}":`, (err as Error).message);
      manifest.blogs.push({
        topic,
        file: '',
        guardianFile: '',
        title: '',
        slug: '',
        wordCount: 0,
        guardianScore: 0,
        flaggedCount: -1,
        flagged: [{ term: 'ERROR', quote: '', reasoning: (err as Error).message }],
        sources: [],
        usage: {},
      });
    }
  }

  // === SOCIAL PASS ===
  for (let i = 0; i < TOPICS.length; i++) {
    const topic = TOPICS[i];
    console.log(`\n=== [social ${i + 1}/${TOPICS.length}] ${topic} ===`);
    try {
      const pack = await generateSocialPack({
        db,
        tenantId: tenant.id,
        tenantName: tenant.name,
        topic,
      });
      const topicSlug = slugify(topic);
      const dir = join(socialRoot, topicSlug);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'linkedin.txt'), pack.linkedin + '\n', 'utf-8');
      await writeFile(join(dir, 'x.txt'), pack.x + '\n', 'utf-8');
      await writeFile(join(dir, 'hook.txt'), pack.hook + '\n', 'utf-8');
      await writeFile(
        join(dir, 'pack.json'),
        JSON.stringify(
          {
            tenant: tenant.slug,
            topic,
            sources: pack.sources,
            usage: pack.usage,
            pack: { linkedin: pack.linkedin, x: pack.x, hook: pack.hook },
          },
          null,
          2
        ),
        'utf-8'
      );

      const linkedinWords = pack.linkedin.split(/\s+/).filter(Boolean).length;
      console.log(`[social] linkedin=${linkedinWords}w x=${pack.x.length}c hook=${pack.hook.length}c`);

      manifest.social.push({
        topic,
        dir,
        linkedinWords,
        xChars: pack.x.length,
        hookChars: pack.hook.length,
        sources: pack.sources,
        usage: pack.usage,
      });
    } catch (err) {
      console.error(`[social] FAILED for "${topic}":`, (err as Error).message);
      manifest.social.push({
        topic,
        dir: '',
        linkedinWords: 0,
        xChars: 0,
        hookChars: 0,
        sources: [],
        usage: { error: 1 as unknown as number },
      });
    }
  }

  const t1 = Date.now();
  manifest.timings.finishedAt = new Date(t1).toISOString();
  manifest.timings.durationSec = Math.round((t1 - t0) / 1000);
  manifest.totals.blogs = manifest.blogs.filter((b) => b.file).length;
  manifest.totals.social = manifest.social.filter((s) => s.dir).length;

  await writeFile(join(outDir, '_v0-summary.json'), JSON.stringify(manifest, null, 2), 'utf-8');

  console.log(`\n=== DONE ===`);
  console.log(`Blogs generated:  ${manifest.totals.blogs}/${TOPICS.length}`);
  console.log(`Social packs:     ${manifest.totals.social}/${TOPICS.length}`);
  console.log(`Duration:         ${manifest.timings.durationSec}s`);
  console.log(`Summary manifest: ${join(outDir, '_v0-summary.json')}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
