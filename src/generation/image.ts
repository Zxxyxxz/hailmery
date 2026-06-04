// Image generator — Gemini 3 Pro Image (default) with an Ideogram fallback.
//
// Two steps:
//   1. Build a detailed image-generation prompt with Claude Sonnet 4.6. Sonnet
//      first CLASSIFIES the draft into one of three proven visual categories
//      (atmospheric / technical_human / professional_portrait), then writes a
//      cinematic, brand-accurate prompt grounded in the tenant's visual-identity
//      corpus. The built prompt is validated (no text, no brand names,
//      100-250 words, brand hex present) and regenerated once on failure.
//   2. Call the configured image provider, get PNG bytes, store them in R2
//      (Worker) or under out/_assets/ (CLI), record an assets row, and attach
//      the canonical R2 key to the draft.
//
// Provider routing (IMAGE_PROVIDER env, default `gemini`):
//   gemini       → Gemini 3 Pro Image  (generativelanguage.googleapis.com)
//   gemini-flash → faster/cheaper image model, same Gemini endpoint
//   ideogram     → legacy Ideogram 3.0 fallback
//
// R2 in V0: the Worker has an R2 binding; the CLI does not. We accept an
// optional binding (opts.r2) and fall back to writing the bytes locally under
// out/ so the CLI demo still produces a viewable file. Either way the assets
// row + draft attachment use the canonical R2 key so the Worker path is a
// drop-in once the binding is wired.
//
// If the selected provider's API key is unset we skip the API call entirely,
// return the built prompt + a placeholder URL, and warn — we never throw for a
// missing key. (The prompt, category, and validation result are still returned
// so the prompt-quality path is exercised even without a key.)

import { sql } from 'drizzle-orm';
import type { NeonDatabase } from 'drizzle-orm/neon-serverless';
import { anthropic, MODELS } from '../lib/ai.js';
import { embedOne } from '../corpus/embedder.js';
import { withTenantDb } from '../lib/tenant.js';
import { extractJson } from './context.js';

export const IMAGE_TYPES = ['blog_header', 'social_square', 'email_header', 'ad_creative'] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

export const ASPECT: Record<ImageType, { ratio: string; dims: string }> = {
  blog_header: { ratio: '16:9', dims: '1200x630' },
  social_square: { ratio: '1:1', dims: '1080x1080' },
  email_header: { ratio: '3:1', dims: '600x200' },
  ad_creative: { ratio: '1:1', dims: '1080x1080' },
};

// ── providers ────────────────────────────────────────────────────────────────
export const IMAGE_PROVIDERS = ['gemini', 'gemini-flash', 'ideogram'] as const;
export type ImageProvider = (typeof IMAGE_PROVIDERS)[number];
const DEFAULT_PROVIDER: ImageProvider = 'gemini';

// Gemini image model ids per tier. `gemini-3-pro-image` is the flagship image
// model; the flash tier points at the GA `gemini-2.5-flash-image` (Nano Banana)
// for faster/cheaper iteration. Override either with GEMINI_IMAGE_MODEL.
const GEMINI_MODELS: Record<'gemini' | 'gemini-flash', string> = {
  gemini: 'gemini-3-pro-image',
  'gemini-flash': 'gemini-2.5-flash-image',
};

const IDEOGRAM_MODEL = 'V_3'; // recorded in generation_params; V3 is implied by the endpoint
const IDEOGRAM_STYLE = 'REALISTIC';
const IDEOGRAM_RENDERING_SPEED = 'DEFAULT'; // FLASH | TURBO | DEFAULT | QUALITY
const IMAGE_COST_CENTS = 6;

function resolveProvider(explicit?: string): ImageProvider {
  const raw = (explicit ?? process.env.IMAGE_PROVIDER ?? DEFAULT_PROVIDER).toLowerCase();
  return (IMAGE_PROVIDERS as readonly string[]).includes(raw) ? (raw as ImageProvider) : DEFAULT_PROVIDER;
}

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

// ── prompt-build types ───────────────────────────────────────────────────────
export const IMAGE_CATEGORIES = ['atmospheric', 'technical_human', 'professional_portrait'] as const;
export type ImageCategory = (typeof IMAGE_CATEGORIES)[number];

const CATEGORY_LETTER: Record<ImageCategory, 'A' | 'B' | 'C'> = {
  atmospheric: 'A',
  technical_human: 'B',
  professional_portrait: 'C',
};

export interface PromptValidation {
  passed: boolean;
  wordCount: number;
  checks: {
    noText: boolean; // contains the "no text" guard phrase
    noBrandNames: boolean; // no company/product names / logos requested
    wordCount: boolean; // 100-250 words
    brandHex: boolean; // includes at least one tenant brand hex
  };
  failures: string[];
}

export interface PromptBuildResult {
  prompt: string;
  category: ImageCategory;
  categoryLetter: 'A' | 'B' | 'C';
  validation: PromptValidation;
  attempts: number;
}

export interface ImageResult {
  draftId: string;
  imageType: ImageType;
  aspectRatio: string;
  prompt: string;
  provider: ImageProvider;
  model: string;
  category: ImageCategory;
  categoryLetter: 'A' | 'B' | 'C';
  validation: PromptValidation;
  url: string;
  r2Key: string | null;
  skipped: boolean; // true when the selected provider's API key was absent
  storedTo: 'r2' | 'local' | 'none';
}

export async function generateImage(opts: {
  db: NeonDatabase<Record<string, unknown>>;
  tenantId: string;
  draftId: string;
  imageType: string;
  provider?: string;
  r2?: R2Like;
  publicBaseUrl?: string;
  /** Called once the prompt is built, before the provider call. Lets callers
   *  capture the exact prompt + validation even if the provider call throws. */
  onPromptBuilt?: (built: PromptBuildResult) => void;
}): Promise<ImageResult> {
  const { db, tenantId, draftId } = opts;

  const imageType = opts.imageType as ImageType;
  if (!IMAGE_TYPES.includes(imageType)) {
    throw new Error(`Unknown imageType '${opts.imageType}'. Expected one of: ${IMAGE_TYPES.join(', ')}`);
  }
  const provider = resolveProvider(opts.provider);
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

    // Explicit tenant filter required: the app's `neondb_owner` connection has
    // BYPASSRLS = true, so RLS does not scope this vector search — without the
    // predicate it would pull other tenants' visual guidelines into the prompt.
    const vr = await tx.execute<ChunkRow>(sql`
      SELECT dc.chunk_text, d.source_filename
      FROM marketing.document_chunks dc
      JOIN marketing.documents d ON dc.document_id = d.id
      WHERE dc.tenant_id = ${tenantId} AND dc.superseded = false
      ORDER BY dc.embedding <=> ${vlit}
      LIMIT 6
    `);
    return { draft, visual: vr.rows };
  });

  const conceptText = conceptFromPayload(loaded.draft.payload, loaded.draft.channel);
  const visualGuidelines = loaded.visual.map((c) => c.chunk_text.trim()).join('\n\n');

  // ── STEP 1: Sonnet 4.6 classifies + builds the prompt, then validates ─────
  const built = await buildImagePrompt({
    conceptText,
    channel: loaded.draft.channel,
    visualGuidelines,
    imageType,
    dims,
    ratio,
  });
  const { prompt, category, categoryLetter, validation } = built;
  opts.onPromptBuilt?.(built);

  console.log(
    `[image] provider=${provider} category=${categoryLetter} (${category}) ` +
      `prompt_valid=${validation.passed} attempts=${built.attempts} words=${validation.wordCount}` +
      (validation.failures.length ? ` failures=[${validation.failures.join(', ')}]` : ''),
  );

  // ── STEP 2: call the provider (or skip if its key is absent) ──────────────
  const model = provider === 'ideogram' ? IDEOGRAM_MODEL : GEMINI_MODELS[provider];
  const apiKey = provider === 'ideogram' ? process.env.IDEOGRAM_API_KEY : process.env.GOOGLE_API_KEY;
  const keyName = provider === 'ideogram' ? 'IDEOGRAM_API_KEY' : 'GOOGLE_API_KEY';

  if (!apiKey) {
    console.warn(
      `[image] ${keyName} not set — skipping ${provider} API call. Built prompt only; returning placeholder URL.`,
    );
    return {
      draftId,
      imageType,
      aspectRatio: ratio,
      prompt,
      provider,
      model,
      category,
      categoryLetter,
      validation,
      url: `https://placeholder.invalid/${r2Key}`,
      r2Key: null,
      skipped: true,
      storedTo: 'none',
    };
  }

  // Obtain PNG bytes from the chosen provider.
  let bytes: Uint8Array;
  let providerUrl: string | null = null; // Ideogram returns a hosted URL we can also surface
  if (provider === 'ideogram') {
    providerUrl = await callIdeogram(apiKey, prompt, ratio);
    bytes = new Uint8Array(await (await fetch(providerUrl)).arrayBuffer());
  } else {
    bytes = await callGeminiImage(prompt, ratio, GEMINI_MODELS[provider]);
  }

  // Store: R2 binding if present, else local fallback for the CLI demo. The
  // Worker runtime has neither R2 (in local dev) nor node:fs, so the local write
  // is best-effort — when it can't run we still return a viewable URL.
  let storedTo: 'r2' | 'local' | 'none';
  const base = opts.publicBaseUrl ?? process.env.R2_PUBLIC_BASE_URL;
  if (opts.r2) {
    await opts.r2.put(r2Key, bytes, { httpMetadata: { contentType: 'image/png' } });
    storedTo = 'r2';
  } else {
    // Try a local file write — works under the Node CLI; the Worker runtime has
    // no node:fs, so tolerate failure rather than failing the whole image.
    try {
      const { writeFile, mkdir } = await import('node:fs/promises');
      const path = await import('node:path');
      const localPath = path.join(process.cwd(), 'out', '_assets', tenantId, draftId, `${imageType}.png`);
      await mkdir(path.dirname(localPath), { recursive: true });
      await writeFile(localPath, bytes);
      storedTo = 'local';
      console.warn(`[image] no R2 binding in this runtime — wrote bytes to ${localPath} (deferred to Worker for real R2 upload).`);
    } catch (e) {
      storedTo = 'none';
      console.warn(`[image] no R2 binding and no local filesystem (${(e as Error).message}) — embedding the image inline so the dashboard can still render it.`);
    }
  }

  // Choose the URL the dashboard renders as <img src>. It must be browser-
  // loadable, so we never store a file:// path or a placeholder when we have
  // real pixels. Preference order:
  //   1. A real public CDN base over the canonical R2 key (set via
  //      R2_PUBLIC_BASE_URL once the bucket is exposed on a public domain).
  //   2. The provider's own hosted URL. Ideogram returns a CDN URL here;
  //      Gemini does NOT — it streams inline bytes — so providerUrl is null
  //      for the default Gemini provider.
  //   3. An inline data: URI built from the bytes. Always renders with no R2,
  //      no public domain, and no provider URL — this is what makes a freshly
  //      generated Gemini image show up immediately, including when R2 is
  //      unavailable or R2_PUBLIC_BASE_URL is not yet configured. It is heavier
  //      to store in the draft row, so it is a last resort: wiring
  //      R2_PUBLIC_BASE_URL (or a public bucket) replaces it with a short URL.
  const publicUrl = base
    ? `${base.replace(/\/$/, '')}/${r2Key}`
    : (providerUrl ?? `data:image/png;base64,${bytesToBase64(bytes)}`);

  // Record the asset + attach the key to the draft.
  await withTenantDb(db, tenantId, async (tx) => {
    await tx.execute(sql`
      INSERT INTO marketing.assets (tenant_id, r2_key, mime, generation_params, cost_cents)
      VALUES (
        ${tenantId}, ${r2Key}, 'image/png',
        ${JSON.stringify({
          prompt,
          provider,
          model,
          category,
          aspect_ratio: ratio,
          prompt_valid: validation.passed,
        })}::jsonb,
        ${IMAGE_COST_CENTS}
      )
    `);
    // Store the canonical R2 key under the image-type slot AND a browser-loadable
    // `imageUrl` the dashboard's DraftCard renders as a thumbnail.
    await tx.execute(sql`
      UPDATE marketing.content_drafts
      SET assets = COALESCE(assets, '{}'::jsonb) || ${JSON.stringify({ [imageType]: r2Key, imageUrl: publicUrl })}::jsonb,
          updated_at = now()
      WHERE id = ${draftId} AND tenant_id = ${tenantId}
    `);
  });

  return {
    draftId,
    imageType,
    aspectRatio: ratio,
    prompt,
    provider,
    model,
    category,
    categoryLetter,
    validation,
    url: publicUrl,
    r2Key,
    skipped: false,
    storedTo,
  };
}

// ── prompt construction (Sonnet 4.6, 3-category few-shot) ────────────────────

// The three proven gold-standard exemplars — one per category. Sonnet must
// match these patterns exactly for the category it selects.
const FEW_SHOT_A = `A cinematic, photorealistic visualization of layered AI security infrastructure. Five translucent glass shield membranes suspended in deep navy space (#060C2E), electric blue data streams (#18A4FB) pass through each layer at high velocity — the shields intercept and filter without slowing the flow. Each membrane glows faintly at the edges where data touches it. Motion blur in the streams communicates speed preserved. The architecture feels vast and authoritative, enterprise scale. Ultra-sharp, high contrast, photorealistic, no people, no text, no letters, no words, no labels anywhere in the image.`;

const FEW_SHOT_B = `A cinematic, photorealistic close-up of a dark curved monitor in a dim professional workspace. A terminal screen shows a config file being edited — one line highlighted in bright blue, indicating a single API endpoint being replaced. The highlighted line is the only text visible and it is intentionally unreadable at scroll distance. A developer's hands rest at the keyboard edge, partially visible in frame. The monitor glow in electric blue (#18A4FB) is the only light source in the deep navy (#060C2E) environment. Shallow depth of field, sharp at center monitor, bokeh background. Moody, technical, professional. High contrast, no readable text visible, no specific URLs or company names.`;

const FEW_SHOT_C = `A cinematic, photorealistic portrait of a senior security professional in their 50s, wearing a dark suit, working late in a modern European enterprise office. Dual monitors display structured data visualizations — compliance dashboards with geometric charts, intentionally unreadable at distance. The professional leans forward studying the screens, expression focused and authoritative. Electric blue (#18A4FB) screen glow illuminates their face from the left. Deep navy (#060C2E) office background, floor-to-ceiling windows show a city at night. Cinematic depth of field, subject sharp, background bokeh. Enterprise-grade, serious, expert. No readable text on screens, no text anywhere in the image.`;

const REQUIRED_NO_TEXT_SUFFIX =
  'no text, no letters, no words, no readable labels anywhere in the image';

/**
 * Builds the image-generation prompt with Sonnet 4.6: classify into one of
 * three visual categories, then write a cinematic, brand-accurate prompt that
 * follows the matching gold-standard exemplar. Validates the result and
 * regenerates once if validation fails. Returns the prompt, the chosen
 * category, and the validation report.
 */
export async function buildImagePrompt(args: {
  conceptText: string;
  channel: string;
  visualGuidelines: string;
  imageType: ImageType;
  dims: string;
  ratio: string;
}): Promise<PromptBuildResult> {
  const brandHexes = extractBrandHexes(args.visualGuidelines);

  const system = buildImageSystemPrompt(brandHexes);
  const baseUser = buildImageUserPrompt(args, brandHexes);

  // First attempt.
  let parsed = await runPromptModel(system, baseUser);
  let validation = validateImagePrompt(parsed.prompt, brandHexes);
  let attempts = 1;

  // Regenerate ONCE on failure, telling the model exactly what to fix.
  if (!validation.passed) {
    const fixUser = [
      baseUser,
      '',
      'Your previous attempt FAILED validation on: ' + validation.failures.join('; ') + '.',
      'Fix every failure. Reminders:',
      `- The prompt MUST end with: "${REQUIRED_NO_TEXT_SUFFIX}".`,
      '- 100-250 words, cinematic and specific.',
      `- Use at least one exact tenant brand hex (${brandHexes.join(', ') || '#060C2E / #18A4FB'}).`,
      '- Never name any company, product, or logo.',
    ].join('\n');
    parsed = await runPromptModel(system, fixUser);
    validation = validateImagePrompt(parsed.prompt, brandHexes);
    attempts = 2;
  }

  return {
    prompt: parsed.prompt,
    category: parsed.category,
    categoryLetter: CATEGORY_LETTER[parsed.category],
    validation,
    attempts,
  };
}

function buildImageSystemPrompt(brandHexes: string[]): string {
  return [
    'You are an art director writing a single image-generation prompt for a photorealistic image model (Gemini 3 Pro Image).',
    'You work in TWO steps, then output strict JSON.',
    '',
    'STEP 1 — CLASSIFY the draft content into exactly ONE of three visual categories:',
    '',
    'CATEGORY A — "atmospheric":',
    '  Use when: abstract security concepts, architecture explanations, compliance topics, thought-leadership posts about risk or strategy.',
    '  Visual style: no people, pure concept and light.',
    '',
    'CATEGORY B — "technical_human":',
    '  Use when: deployment instructions, API changes, developer-focused content, "how to" topics, posts targeting engineers or practitioners.',
    '  Visual style: person at a terminal, hands on keyboard, screen glow as the dominant light source.',
    '',
    'CATEGORY C — "professional_portrait":',
    '  Use when: executive/CISO-focused content, compliance deadlines, regulatory topics, thought leadership targeting security leaders.',
    '  Visual style: senior professional, enterprise office setting, authority and expertise.',
    '',
    'STEP 2 — WRITE the prompt for the chosen category, matching the gold-standard exemplar for that category EXACTLY in structure, tone, and cinematic specificity.',
    '',
    'GOLD STANDARD — CATEGORY A (atmospheric):',
    FEW_SHOT_A,
    '',
    'GOLD STANDARD — CATEGORY B (technical_human):',
    FEW_SHOT_B,
    '',
    'GOLD STANDARD — CATEGORY C (professional_portrait):',
    FEW_SHOT_C,
    '',
    'NON-NEGOTIABLE RULES for ALL categories:',
    '- Never request company names, product names, logos, or brand marks inside the image.',
    '- Never request readable URLs, code, or specific text — "intentionally unreadable at distance" is fine.',
    `- ALWAYS end the prompt with: "${REQUIRED_NO_TEXT_SUFFIX}".`,
    `- Use the tenant's EXACT brand hex values${brandHexes.length ? ` (${brandHexes.join(', ')})` : ''} inline next to the colors you describe — deep navy background and electric blue accents. Do not invent colors.`,
    '- The prompt must be 100-250 words, specific, and cinematic — never generic.',
    '',
    'OUTPUT — strict JSON only, no prose, no markdown fences:',
    '{ "category": "atmospheric" | "technical_human" | "professional_portrait", "prompt": "<the full image prompt>" }',
  ].join('\n');
}

function buildImageUserPrompt(
  args: {
    conceptText: string;
    channel: string;
    visualGuidelines: string;
    imageType: ImageType;
    dims: string;
    ratio: string;
  },
  brandHexes: string[],
): string {
  return [
    `Image type: ${args.imageType} (target ${args.dims}, aspect ratio ${args.ratio}).`,
    `Paired content channel: ${args.channel}.`,
    '',
    'Tenant brand hex values (use these exact codes — do not substitute):',
    brandHexes.length ? brandHexes.join(', ') : '(none retrieved — default to deep navy #060C2E + electric blue #18A4FB)',
    '',
    'Content this image accompanies (classify from it, then derive the concept):',
    args.conceptText || '(no draft text available — use an abstract representation of the topic, category A)',
    '',
    'Tenant visual guidelines (corpus excerpts — authoritative for palette + style):',
    args.visualGuidelines || '(none retrieved)',
    '',
    'Classify the content, then write the prompt for that category. Output the JSON now.',
  ].join('\n');
}

interface ParsedPrompt {
  category: ImageCategory;
  prompt: string;
}

async function runPromptModel(system: string, user: string): Promise<ParsedPrompt> {
  const response = await anthropic().messages.create({
    model: MODELS.SONNET,
    max_tokens: 900,
    system: [{ type: 'text', text: system }],
    messages: [{ role: 'user', content: user }],
  });
  const block = response.content.find((b) => b.type === 'text');
  if (!block || block.type !== 'text') throw new Error('Sonnet returned no prompt text');

  let category: ImageCategory = 'atmospheric';
  let prompt = block.text.trim();
  try {
    const obj = JSON.parse(extractJson(block.text)) as Partial<ParsedPrompt>;
    if (typeof obj.prompt === 'string' && obj.prompt.trim()) prompt = obj.prompt.trim();
    if (obj.category && (IMAGE_CATEGORIES as readonly string[]).includes(obj.category)) {
      category = obj.category as ImageCategory;
    }
  } catch {
    // Fall back to treating the whole response as the prompt (category default).
  }
  return { category, prompt };
}

// ── prompt validator ─────────────────────────────────────────────────────────

// Company / product / vendor names (plus "logo"/"trademark") that must never be
// requested inside the image. The tenant name is added dynamically per call.
const NAME_DENYLIST = [
  'apire',
  'openai',
  'anthropic',
  'azure',
  'aws',
  'amazon',
  'microsoft',
  'google',
  'gemini',
  'ideogram',
  'logo',
  'trademark',
  'brand mark',
  'wordmark',
];

export function validateImagePrompt(prompt: string, brandHexes: string[]): PromptValidation {
  const lower = prompt.toLowerCase();
  const wordCount = prompt.split(/\s+/).filter(Boolean).length;

  const noText = lower.includes('no text');
  const offendingName = NAME_DENYLIST.find((n) => lower.includes(n));
  const noBrandNames = !offendingName;
  const wordCountOk = wordCount >= 100 && wordCount <= 250;
  // Brand hex present: any retrieved tenant hex, else any 6-digit hex literal.
  const brandHex =
    brandHexes.length > 0
      ? brandHexes.some((h) => lower.includes(h.toLowerCase()))
      : /#[0-9a-f]{6}\b/i.test(prompt);

  const failures: string[] = [];
  if (!noText) failures.push('missing "no text" guard');
  if (!noBrandNames) failures.push(`requests a brand/product name ("${offendingName}")`);
  if (!wordCountOk) failures.push(`word count ${wordCount} outside 100-250`);
  if (!brandHex) failures.push('missing tenant brand hex');

  return {
    passed: failures.length === 0,
    wordCount,
    checks: { noText, noBrandNames, wordCount: wordCountOk, brandHex },
    failures,
  };
}

/** Pull unique #RRGGBB hex codes out of the retrieved visual-identity corpus. */
export function extractBrandHexes(visualGuidelines: string): string[] {
  const found = visualGuidelines.match(/#[0-9A-Fa-f]{6}\b/g) ?? [];
  // Preserve order, dedupe case-insensitively, keep the canonical brand palette
  // first (background + primary accents) when present.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const h of found) {
    const key = h.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(h.toUpperCase());
    }
  }
  return out.slice(0, 6);
}

// ── Gemini image API ─────────────────────────────────────────────────────────

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string }; text?: string }> };
  }>;
  promptFeedback?: { blockReason?: string };
}

/**
 * Calls Gemini's generateContent image endpoint and returns decoded PNG bytes.
 * Reads GOOGLE_API_KEY from the environment (the Worker mirrors its secret into
 * process.env before any generation call). `model` selects the pro vs flash tier.
 */
export async function callGeminiImage(
  prompt: string,
  aspectRatio: string,
  model: string = GEMINI_MODELS.gemini,
): Promise<Uint8Array> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_API_KEY not set');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseModalities: ['IMAGE', 'TEXT'],
      // Gemini honours an aspectRatio hint on the image config; harmless if the
      // model ignores it.
      imageConfig: { aspectRatio },
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Gemini API ${res.status}: ${txt.slice(0, 300)}`);
  }

  const json = (await res.json()) as GeminiResponse;
  if (json.promptFeedback?.blockReason) {
    throw new Error(`Gemini blocked the prompt: ${json.promptFeedback.blockReason}`);
  }
  const parts = json.candidates?.[0]?.content?.parts ?? [];
  const inline = parts.find((p) => p.inlineData?.data)?.inlineData;
  if (!inline?.data) {
    throw new Error(`Gemini response had no inline image data: ${JSON.stringify(json).slice(0, 300)}`);
  }
  return base64ToBytes(inline.data);
}

/** Decode a base64 string to bytes. Buffer is present in Node and under the
 *  Worker's nodejs_compat; atob is the cross-runtime fallback. */
function base64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Encode bytes to base64 — the inverse of base64ToBytes. Used to build the
 *  inline data: URI fallback so a generated image renders in the dashboard even
 *  when there is no R2 public URL or provider-hosted URL. btoa is the
 *  cross-runtime fallback when Buffer is absent. */
function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// ── Ideogram API (legacy fallback) ───────────────────────────────────────────

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

// ── backward-compat shim ─────────────────────────────────────────────────────
// The prompt-preview tool (scripts/preview-ideogram-prompt.ts) imported
// buildIdeogramPrompt and expected the prompt string back. Keep that contract
// by delegating to buildImagePrompt and returning just the prompt text.
export async function buildIdeogramPrompt(args: {
  conceptText: string;
  channel: string;
  visualGuidelines: string;
  imageType: ImageType;
  dims: string;
  ratio: string;
}): Promise<string> {
  const built = await buildImagePrompt(args);
  return built.prompt;
}

// ── helpers ──────────────────────────────────────────────────────────────────

export function conceptFromPayload(payload: Record<string, unknown>, channel: string): string {
  const pick = (k: string): string => (typeof payload[k] === 'string' ? (payload[k] as string) : '');
  const parts = [pick('title'), pick('subject'), pick('topic'), pick('text'), pick('body')].filter(Boolean);
  const text = parts.join('\n').trim();
  // Cap so we don't blow the prompt builder's budget on a long blog body.
  return `[${channel}] ${text}`.slice(0, 1200);
}
