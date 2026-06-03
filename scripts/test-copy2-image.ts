// Improvement 5 — end-to-end image pipeline test on the "Copy 2" LinkedIn post.
//
//   pnpm tsx --env-file=.env scripts/test-copy2-image.ts
//
// Inserts Copy 2 as a content_draft (channel=linkedin), runs generateImage()
// with type=social_square, and prints the category, the full built prompt, the
// validator result per rule, whether the Gemini API was actually called, and
// the saved image path. Then verifies the draft.assets jsonb was updated.

import { sql } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { findTenantBySlug, findFirstSiteForTenant, withTenantDb } from '../src/lib/tenant.js';
import { insertDraft } from '../src/generation/context.js';
import { generateImage, type ImageResult, type PromptBuildResult } from '../src/generation/image.js';

const hr = '═'.repeat(72);

const COPY_2 =
  "We built APIRE to solve the AI security problem you can't afford to ignore. " +
  'As practitioners, we deliver enterprise protection with zero-code deployment: ' +
  'swap api.openai.com to app.apire.io...';

async function main() {
  const tenant = await findTenantBySlug(db, 'apire');
  if (!tenant) throw new Error("No 'apire' tenant. Run pnpm db:seed.");
  const site = await findFirstSiteForTenant(db, tenant.id);
  if (!site) throw new Error('APIRE has no site. Run pnpm db:seed.');

  // 1. Insert Copy 2 as a content_draft.
  const draftId = await insertDraft({
    db,
    tenantId: tenant.id,
    siteId: site.id,
    campaignId: null,
    channel: 'linkedin',
    payload: { kind: 'social', channel: 'linkedin', topic: 'APIRE launch', text: COPY_2 },
  });
  console.log(`${hr}\nINSERTED DRAFT ${draftId} (channel=linkedin) for APIRE\n${hr}\n`);

  // 2. Run the image pipeline. Try the pro model first; if it is rate-limited
  //    (429), fall back to the cheaper flash model so we still attempt a real
  //    image. The onPromptBuilt hook captures the exact prompt even if the
  //    provider call throws.
  let built: PromptBuildResult | null = null;
  let res: ImageResult | undefined;
  const attempts: Array<{ provider: string; outcome: string }> = [];

  for (const provider of ['gemini', 'gemini-flash'] as const) {
    console.log(`Running generateImage(type=social_square, provider=${provider})…`);
    try {
      res = await generateImage({
        db,
        tenantId: tenant.id,
        draftId,
        imageType: 'social_square',
        provider,
        onPromptBuilt: (b) => {
          built = b;
        },
      });
      attempts.push({ provider, outcome: res.skipped ? 'skipped (no key)' : 'SUCCESS' });
      if (!res.skipped) break; // got an image
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      attempts.push({ provider, outcome: `ERROR — ${msg.replace(/\s+/g, ' ').slice(0, 140)}` });
    }
  }

  // 3. Report — the built prompt + validation are available regardless of the
  //    provider outcome (captured via onPromptBuilt).
  if (built) {
    const b: PromptBuildResult = built;
    console.log(`\n${hr}`);
    console.log(`CATEGORY SELECTED : ${b.categoryLetter}  (${b.category})`);
    console.log(`${hr}`);
    console.log(`FULL PROMPT (${b.validation.wordCount} words, build attempts=${b.attempts}):\n`);
    console.log(b.prompt);
    console.log(`\n${hr}`);
    const v = b.validation;
    console.log('VALIDATOR RESULTS:');
    console.log(`  contains "no text"      → ${v.checks.noText ? 'PASS' : 'FAIL'}`);
    console.log(`  no company/product name → ${v.checks.noBrandNames ? 'PASS' : 'FAIL'}`);
    console.log(`  100-250 words (${String(v.wordCount).padStart(3)})    → ${v.checks.wordCount ? 'PASS' : 'FAIL'}`);
    console.log(`  contains brand hex      → ${v.checks.brandHex ? 'PASS' : 'FAIL'}`);
    console.log(`  OVERALL                 → ${v.passed ? 'PASS' : `FAIL [${v.failures.join('; ')}]`}`);
  }

  console.log(`${hr}`);
  console.log('GEMINI API ATTEMPTS:');
  for (const a of attempts) console.log(`  ${a.provider.padEnd(13)} → ${a.outcome}`);
  console.log(`${hr}`);

  if (res && !res.skipped) {
    console.log(`PROVIDER / MODEL  : ${res.provider} / ${res.model}`);
    console.log(`STORED TO         : ${res.storedTo}`);
    console.log(`R2 KEY            : ${res.r2Key ?? '(none)'}`);
    console.log(`IMAGE URL/PATH    : ${res.url}`);

    // 4. Verify draft.assets was updated.
    const assets = await withTenantDb(db, tenant.id, async (tx) => {
      const r = await tx.execute<{ assets: Record<string, unknown> }>(sql`
        SELECT assets FROM marketing.content_drafts WHERE id = ${draftId} AND tenant_id = ${tenant.id} LIMIT 1
      `);
      return r.rows[0]?.assets ?? {};
    });
    console.log(`draft.assets jsonb: ${JSON.stringify(assets)}`);
    const ok = typeof (assets as Record<string, unknown>).social_square === 'string';
    console.log(ok ? `✓ draft.assets.social_square set` : '✗ draft.assets.social_square missing');
  } else {
    console.log('No image generated (all providers skipped or rate-limited). Prompt + validation above are real.');
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
