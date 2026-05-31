// Image generator — Ideogram 3.0.
//
// Two steps:
//   1. Build a detailed Ideogram prompt with Claude Haiku 4.5, grounded in the
//      tenant's visual-identity corpus + the draft's content.
//   2. Call the Ideogram API, download the result, store it in R2, record an
//      assets row, and attach the R2 key to the draft.
//
// R2 in V0: the Worker has an R2 binding; the CLI does not. We accept an
// optional binding (opts.r2) and fall back to writing the bytes locally under
// out/ so the CLI demo still produces a viewable file. Either way the assets
// row + draft attachment use the canonical R2 key so the Worker path is a
// drop-in once the binding is wired.
//
// If IDEOGRAM_API_KEY is unset we skip the API call entirely, return a
// placeholder URL, and warn — we never throw for a missing key.

import { sql } from 'drizzle-orm';
import type { NeonDatabase } from 'drizzle-orm/neon-serverless';
import { anthropic, MODELS } from '../lib/ai.js';
import { embedOne } from '../corpus/embedder.js';
import { withTenantDb } from '../lib/tenant.js';

export const IMAGE_TYPES = ['blog_header', 'social_square', 'email_header', 'ad_creative'] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

export const ASPECT: Record<ImageType, { ratio: string; dims: string }> = {
  blog_header: { ratio: '16:9', dims: '1200x630' },
  social_square: { ratio: '1:1', dims: '1080x1080' },
  email_header: { ratio: '3:1', dims: '600x200' },
  ad_creative: { ratio: '1:1', dims: '1080x1080' },
};

const IDEOGRAM_MODEL = 'V_3'; // recorded in generation_params; V3 is implied by the endpoint
const IDEOGRAM_STYLE = 'REALISTIC';
const IDEOGRAM_RENDERING_SPEED = 'DEFAULT'; // FLASH | TURBO | DEFAULT | QUALITY
const IMAGE_COST_CENTS = 6;

/** Minimal shape of a Cloudflare R2 binding — enough for put(). */
interface R2Like {
  put(key: string, value: ArrayBuffer | Uint8Array, options?: unknown): Promise<unknown>;
}

interface DraftRow extends Record<string, unknown> {
  payload: Record<string, unknown>;
  channel: string;
}
interface ChunkRow extends Record<string, unknown> {
  chunk_text: string;
  source_filename: string;
}

export interface ImageResult {
  draftId: string;
  imageType: ImageType;
  aspectRatio: string;
  prompt: string;
  url: string;
  r2Key: string | null;
  skipped: boolean; // true when IDEOGRAM_API_KEY was absent
  storedTo: 'r2' | 'local' | 'none';
}

export async function generateImage(opts: {
  db: NeonDatabase<Record<string, unknown>>;
  tenantId: string;
  draftId: string;
  imageType: string;
  r2?: R2Like;
  publicBaseUrl?: string;
}): Promise<ImageResult> {
  const { db, tenantId, draftId } = opts;

  const imageType = opts.imageType as ImageType;
  if (!IMAGE_TYPES.includes(imageType)) {
    throw new Error(`Unknown imageType '${opts.imageType}'. Expected one of: ${IMAGE_TYPES.join(', ')}`);
  }
  const { ratio, dims } = ASPECT[imageType];
  const r2Key = `assets/${tenantId}/${draftId}/${imageType}.png`;

  // ── Load the draft + the tenant's visual-identity guidelines ──────────────
  const visualVec = await embedOne(
    'brand visual identity colour palette typography logo illustration photography visual style design system',
  );
  const vlit = sql.raw(`'[${visualVec.join(',')}]'::vector`);

  const loaded = await withTenantDb(db, tenantId, async (tx) => {
    const dr = await tx.execute<DraftRow>(sql`
      SELECT payload, channel FROM marketing.content_drafts
      WHERE id = ${draftId} AND tenant_id = ${tenantId} LIMIT 1
    `);
    const draft = dr.rows[0];
    if (!draft) throw new Error(`Draft ${draftId} not found for tenant ${tenantId}`);

    const vr = await tx.execute<ChunkRow>(sql`
      SELECT dc.chunk_text, d.source_filename
      FROM marketing.document_chunks dc
      JOIN marketing.documents d ON dc.document_id = d.id
      WHERE dc.superseded = false
      ORDER BY dc.embedding <=> ${vlit}
      LIMIT 6
    `);
    return { draft, visual: vr.rows };
  });

  const conceptText = conceptFromPayload(loaded.draft.payload, loaded.draft.channel);
  const visualGuidelines = loaded.visual.map((c) => c.chunk_text.trim()).join('\n\n');

  // ── STEP 1: Haiku builds the Ideogram prompt ──────────────────────────────
  const prompt = await buildIdeogramPrompt({
    conceptText,
    channel: loaded.draft.channel,
    visualGuidelines,
    imageType,
    dims,
    ratio,
  });

  // ── STEP 2: call Ideogram (or skip if no key) ─────────────────────────────
  const apiKey = process.env.IDEOGRAM_API_KEY;
  if (!apiKey) {
    console.warn(
      `[image] IDEOGRAM_API_KEY not set — skipping API call. Built prompt only; returning placeholder URL.`,
    );
    return {
      draftId,
      imageType,
      aspectRatio: ratio,
      prompt,
      url: `https://placeholder.invalid/${r2Key}`,
      r2Key: null,
      skipped: true,
      storedTo: 'none',
    };
  }

  const ideogramUrl = await callIdeogram(apiKey, prompt, ratio);
  const bytes = new Uint8Array(await (await fetch(ideogramUrl)).arrayBuffer());

  // Store: R2 binding if present, else local fallback for the CLI demo.
  let storedTo: 'r2' | 'local';
  let publicUrl: string;
  if (opts.r2) {
    await opts.r2.put(r2Key, bytes, { httpMetadata: { contentType: 'image/png' } });
    storedTo = 'r2';
    const base = opts.publicBaseUrl ?? process.env.R2_PUBLIC_BASE_URL;
    publicUrl = base ? `${base.replace(/\/$/, '')}/${r2Key}` : ideogramUrl;
  } else {
    const { writeFile, mkdir } = await import('node:fs/promises');
    const path = await import('node:path');
    const localPath = path.join(process.cwd(), 'out', '_assets', tenantId, draftId, `${imageType}.png`);
    await mkdir(path.dirname(localPath), { recursive: true });
    await writeFile(localPath, bytes);
    storedTo = 'local';
    console.warn(`[image] no R2 binding in this runtime — wrote bytes to ${localPath} (deferred to Worker for real R2 upload).`);
    const base = opts.publicBaseUrl ?? process.env.R2_PUBLIC_BASE_URL;
    publicUrl = base ? `${base.replace(/\/$/, '')}/${r2Key}` : `file://${localPath}`;
  }

  // Record the asset + attach the key to the draft.
  await withTenantDb(db, tenantId, async (tx) => {
    await tx.execute(sql`
      INSERT INTO marketing.assets (tenant_id, r2_key, mime, generation_params, cost_cents)
      VALUES (
        ${tenantId}, ${r2Key}, 'image/png',
        ${JSON.stringify({ prompt, model: IDEOGRAM_MODEL, aspect_ratio: ratio })}::jsonb,
        ${IMAGE_COST_CENTS}
      )
    `);
    await tx.execute(sql`
      UPDATE marketing.content_drafts
      SET assets = COALESCE(assets, '{}'::jsonb) || ${JSON.stringify({ [imageType]: r2Key })}::jsonb,
          updated_at = now()
      WHERE id = ${draftId} AND tenant_id = ${tenantId}
    `);
  });

  return {
    draftId,
    imageType,
    aspectRatio: ratio,
    prompt,
    url: publicUrl,
    r2Key,
    skipped: false,
    storedTo,
  };
}

// ── prompt construction (Haiku 4.5) ─────────────────────────────────────────

export async function buildIdeogramPrompt(args: {
  conceptText: string;
  channel: string;
  visualGuidelines: string;
  imageType: ImageType;
  dims: string;
  ratio: string;
}): Promise<string> {
  const system = [
    'You are an art director writing a single image-generation prompt for Ideogram 3.0.',
    'Output ONLY the prompt text — no preamble, no quotes, no markdown.',
    '',
    'Non-negotiable style constraints for every prompt you write:',
    '- Background and accent/gradient colors MUST come from the tenant visual guidelines below — use the exact hex codes given there. Do NOT invent colors or default to purple/cyan; if the guidelines specify a blue palette, the image is blue.',
    '- Technical / security aesthetic — abstract, modern, premium.',
    '- NO stock-photo clichés: no handshakes, no padlocks on keyboards, no generic blue globes, no hooded hackers, no binary-rain backgrounds.',
    '- If any text appears in the image, render it in the tenant’s specified typeface (a geometric sans-serif when unspecified). Ideogram renders in-image text better than any other model — exploit that, keep text minimal and sharp.',
    '',
    'The tenant visual guidelines below are authoritative for palette, background, and typography — follow them precisely.',
    'Describe a specific visual concept relevant to the content — composition, focal subject, lighting, depth. Be concrete and vivid in 60-110 words.',
    `End the prompt with the rendering note: "Aspect ratio ${args.ratio} (${args.dims}), high detail, crisp edges."`,
  ].join('\n');

  const user = [
    `Image type: ${args.imageType} (target ${args.dims}, aspect ratio ${args.ratio}).`,
    `Paired content channel: ${args.channel}.`,
    '',
    'Content this image accompanies (derive the concept from it):',
    args.conceptText || '(no draft text available — use an abstract representation of the topic)',
    '',
    'Tenant visual guidelines (corpus excerpts):',
    args.visualGuidelines || '(none retrieved)',
    '',
    'Write the Ideogram prompt now.',
  ].join('\n');

  const response = await anthropic().messages.create({
    model: MODELS.HAIKU,
    max_tokens: 600,
    system: [{ type: 'text', text: system }],
    messages: [{ role: 'user', content: user }],
  });
  const block = response.content.find((b) => b.type === 'text');
  if (!block || block.type !== 'text') throw new Error('Haiku returned no prompt text');
  return block.text.trim();
}

// ── Ideogram API ────────────────────────────────────────────────────────────

interface IdeogramResponse {
  data?: Array<{ url?: string }>;
}

async function callIdeogram(apiKey: string, prompt: string, aspectRatio: string): Promise<string> {
  // Ideogram 3.0 lives on a dedicated endpoint that takes multipart/form-data
  // (not JSON) and spells the aspect ratio "16x9" — not "16:9" and not the
  // legacy enum. The model is implied by the endpoint, so there is no `model`
  // field. We omit Content-Type so fetch sets the multipart boundary itself.
  const form = new FormData();
  form.set('prompt', prompt);
  form.set('aspect_ratio', aspectRatio.replace(':', 'x'));
  form.set('rendering_speed', IDEOGRAM_RENDERING_SPEED);
  form.set('style_type', IDEOGRAM_STYLE);

  const res = await fetch('https://api.ideogram.ai/v1/ideogram-v3/generate', {
    method: 'POST',
    headers: { 'Api-Key': apiKey },
    body: form,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Ideogram API ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as IdeogramResponse;
  const url = json.data?.[0]?.url;
  if (!url) throw new Error(`Ideogram response had no image URL: ${JSON.stringify(json).slice(0, 300)}`);
  return url;
}

// ── helpers ──────────────────────────────────────────────────────────────────

export function conceptFromPayload(payload: Record<string, unknown>, channel: string): string {
  const pick = (k: string): string => (typeof payload[k] === 'string' ? (payload[k] as string) : '');
  const parts = [pick('title'), pick('subject'), pick('topic'), pick('text'), pick('body')].filter(Boolean);
  const text = parts.join('\n').trim();
  // Cap so we don't blow Haiku's budget on a long blog body.
  return `[${channel}] ${text}`.slice(0, 1200);
}
