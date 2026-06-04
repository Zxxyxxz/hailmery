// Shared env + small helpers for the generation/publish pipelines.
//
// The pipelines run in two places: as Cloudflare Workflows (the autonomous
// path, triggered by cron / campaign creation / the dashboard) and inline
// (the immediate /api/publish path, and a fallback when a Workflow binding is
// absent — e.g. some local-dev configurations). Both paths share the same env
// shape and the same step functions, so behaviour can't drift between them.

/** Minimal Cloudflare R2 binding surface — enough for generateImage(). */
export interface R2Like {
  put(key: string, value: ArrayBuffer | Uint8Array, options?: unknown): Promise<unknown>;
}

/**
 * Everything the pipelines read from the Worker environment. The two Workflow
 * bindings are optional on the type so the inline path (and unit tests) can
 * construct a PipelineEnv without them.
 */
export interface PipelineEnv {
  DATABASE_URL: string;
  ANTHROPIC_API_KEY: string;
  OPENAI_API_KEY: string;
  SECRETS_KEY: string;
  IDEOGRAM_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  IMAGE_PROVIDER?: string;
  R2_PUBLIC_BASE_URL?: string;
  HUBSPOT_EVENT_TEMPLATE_ID?: string;
  // R2 bucket binding. MUST match the wrangler.toml binding name (`R2`) — the
  // Cloudflare runtime injects bindings onto `env` by their configured name, so
  // an out-of-sync name here reads back `undefined` and silently disables R2.
  R2?: R2Like;
  GENERATION_WORKFLOW?: WorkflowBinding;
  PUBLISH_WORKFLOW?: WorkflowBinding;
}

/**
 * The slice of Cloudflare's `Workflow` binding we use. Typed locally rather
 * than importing the experimental global so the inline path stays portable.
 */
export interface WorkflowBinding {
  create(options?: { id?: string; params?: unknown }): Promise<{ id: string }>;
}

/**
 * The generation modules (lib/ai.ts, generation/image.ts) read their API keys
 * from process.env so the same code runs under the Node CLI and the Worker.
 * Worker secrets live on `env`, so we mirror them across before any generation
 * call. nodejs_compat gives the Worker a mutable process.env.
 */
export function mirrorEnvToProcess(env: PipelineEnv): void {
  if (env.ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;
  if (env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = env.OPENAI_API_KEY;
  if (env.IDEOGRAM_API_KEY) process.env.IDEOGRAM_API_KEY = env.IDEOGRAM_API_KEY;
  if (env.GOOGLE_API_KEY) process.env.GOOGLE_API_KEY = env.GOOGLE_API_KEY;
  if (env.IMAGE_PROVIDER) process.env.IMAGE_PROVIDER = env.IMAGE_PROVIDER;
  if (env.R2_PUBLIC_BASE_URL) process.env.R2_PUBLIC_BASE_URL = env.R2_PUBLIC_BASE_URL;
}

export type TriggerReason = 'cron' | 'campaign_created' | 'manual' | 'leadorch_event';

export interface GenerationParams {
  tenantId: string;
  campaignId: string;
  triggerReason: TriggerReason;
  /** Restrict generation to these channels (else use the campaign channel_config). */
  channels?: string[];
}

export interface PublishParams {
  /** When omitted/null, the publish tick processes every active tenant. */
  tenantId?: string | null;
}
