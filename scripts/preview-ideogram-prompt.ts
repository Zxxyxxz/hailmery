// Preview-only harness: runs STEP 1 of generateImage() — the Haiku 4.5
// Ideogram-prompt builder — for the most recent blog draft of a tenant, and
// prints the prompt. It NEVER calls the Ideogram API.
//
// The data-loading block below is copied verbatim from generateImage()
// (src/generation/image.ts, the draft + visual-guidelines retrieval) so the
// prompt produced here is byte-for-byte what the real pipeline would send.
//
//   pnpm tsx --env-file=.env scripts/preview-ideogram-prompt.ts [tenant-slug] [image-type]
//
// Defaults: tenant=apire, image-type=blog_header.

import { sql } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { findTenantBySlug, withTenantDb } from '../src/lib/tenant.js';
import { embedOne } from '../src/corpus/embedder.js';
import {
  ASPECT,
  IMAGE_TYPES,
  buildImagePrompt,
  conceptFromPayload,
  type ImageType,
} from '../src/generation/image.js';

const hr = '─'.repeat(72);

async function main() {
  const slug = process.argv[2] ?? 'apire';
  const imageType = (process.argv[3] ?? 'blog_header') as ImageType;
  if (!IMAGE_TYPES.includes(imageType)) {
    throw new Error(`Unknown imageType '${imageType}'. Expected: ${IMAGE_TYPES.join(', ')}`);
  }

  const tenant = await findTenantBySlug(db, slug);
  if (!tenant) throw new Error(`No tenant '${slug}'. Run pnpm db:seed?`);

  const { ratio, dims } = ASPECT[imageType];

  // ── load most-recent blog draft + tenant visual-identity guidelines ──────
  // (visual retrieval mirrors generateImage exactly)
  const visualVec = await embedOne(
    'brand visual identity colour palette typography logo illustration photography visual style design system',
  );
  const vlit = sql.raw(`'[${visualVec.join(',')}]'::vector`);

  const loaded = await withTenantDb(db, tenant.id, async (tx) => {
    const dr = await tx.execute<{ id: string; payload: Record<string, unknown>; channel: string; created_at: string }>(sql`
      SELECT id, payload, channel, created_at FROM marketing.content_drafts
      WHERE tenant_id = ${tenant.id} AND channel = 'blog'
      ORDER BY created_at DESC
      LIMIT 1
    `);
    const draft = dr.rows[0];
    if (!draft) throw new Error(`No blog drafts in content_drafts for tenant ${slug}`);

    const vr = await tx.execute<{ chunk_text: string; source_filename: string }>(sql`
      SELECT dc.chunk_text, d.source_filename
      FROM marketing.document_chunks dc
      JOIN marketing.documents d ON dc.document_id = d.id
      WHERE dc.superseded = false
      ORDER BY dc.embedding <=> ${vlit}
      LIMIT 6
    `);
    return { draft, visual: vr.rows };
  });

  const draft = loaded.draft;
  const conceptText = conceptFromPayload(draft.payload, draft.channel);
  const visualGuidelines = loaded.visual.map((c) => c.chunk_text.trim()).join('\n\n');

  console.log(`${hr}`);
  console.log(`TENANT       : ${tenant.name} (${tenant.slug})`);
  console.log(`DRAFT ID     : ${draft.id}`);
  console.log(`DRAFT TITLE  : ${(draft.payload as Record<string, unknown>).title ?? '(none)'}`);
  console.log(`CREATED AT   : ${draft.created_at}`);
  console.log(`IMAGE TYPE   : ${imageType} (${dims}, ${ratio})`);
  console.log(`VISUAL CHUNKS: ${loaded.visual.length} retrieved from corpus`);
  console.log(`SOURCES      : ${[...new Set(loaded.visual.map((c) => c.source_filename))].join(', ') || '(none)'}`);
  console.log(`${hr}\n`);

  console.log('[preview] calling buildImagePrompt() — Sonnet 4.6 classify + write — NO image API call...\n');

  // ── STEP 1 ONLY: classify + build the prompt. STEP 2 (the provider call) is
  //    intentionally not invoked. ─────────────────────────────────────────
  const built = await buildImagePrompt({
    conceptText,
    channel: draft.channel,
    visualGuidelines,
    imageType,
    dims,
    ratio,
  });
  const { prompt, categoryLetter, category, validation } = built;

  console.log(`${hr}`);
  console.log(`CATEGORY     : ${categoryLetter} (${category})`);
  console.log(
    `VALIDATION   : ${validation.passed ? 'PASS' : 'FAIL'} — no_text=${validation.checks.noText} ` +
      `no_brand_names=${validation.checks.noBrandNames} words(${validation.wordCount})=${validation.checks.wordCount} ` +
      `brand_hex=${validation.checks.brandHex}` +
      (validation.failures.length ? ` failures=[${validation.failures.join('; ')}]` : ''),
  );
  console.log(`IMAGE PROMPT (${imageType}, ${ratio}) — ${prompt.length} chars`);
  console.log(`${hr}`);
  console.log(prompt);
  console.log(`${hr}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
