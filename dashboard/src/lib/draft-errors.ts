// Failed-draft error humanizer. `failedReason` is a free-form publish-adapter
// error string (Error.message, ≤500 chars) — NOT an enum — so we match by
// substring/regex against known root causes and fall back to the raw text.

export interface TranslatedError {
  /** Short human-readable headline. */
  message: string
  /** Suggested next step. */
  action: string
  /** In-app link to fix it, or null when the fix is "dismiss & regenerate". */
  actionPath: string | null
  /** Coarse bucket so the page can group "N posts failed for the same reason". */
  category: 'channel_setup' | 'scheduling' | 'content' | 'unknown'
}

interface Rule {
  test: RegExp
  result: TranslatedError
}

const RULES: Rule[] = [
  {
    test: /no buffer channel\/profile id mapped for channel:\s*linkedin/i,
    result: {
      message: 'LinkedIn channel not configured',
      action: 'Fix in Settings → Platforms',
      actionPath: '/settings?tab=platforms',
      category: 'channel_setup',
    },
  },
  {
    test: /no buffer channel\/profile id mapped for channel:\s*(twitter|x)\b/i,
    result: {
      message: 'X / Twitter channel not configured',
      action: 'Fix in Settings → Platforms',
      actionPath: '/settings?tab=platforms',
      category: 'channel_setup',
    },
  },
  {
    test: /no buffer channel\/profile id mapped/i,
    result: {
      message: 'Channel not configured in Buffer',
      action: 'Fix in Settings → Platforms',
      actionPath: '/settings?tab=platforms',
      category: 'channel_setup',
    },
  },
  {
    test: /no_adapter_for_channel:\s*blog|no adapter.*blog/i,
    result: {
      message: 'Blog publishing connection missing',
      action: 'Fix in Settings → Platforms',
      actionPath: '/settings?tab=platforms',
      category: 'channel_setup',
    },
  },
  {
    test: /no[_ ]adapter[_ ]for[_ ]channel/i,
    result: {
      message: 'Publishing connection missing for this channel',
      action: 'Fix in Settings → Platforms',
      actionPath: '/settings?tab=platforms',
      category: 'channel_setup',
    },
  },
  {
    test: /not (connected|authenticated)|invalid api key|unauthorized|401|403/i,
    result: {
      message: 'Platform connection rejected the publish',
      action: 'Reconnect in Settings → Platforms',
      actionPath: '/settings?tab=platforms',
      category: 'channel_setup',
    },
  },
  {
    test: /sender.*(not verified|not authenticated)|domain.*not verified|from address/i,
    result: {
      message: 'Email sender domain not authenticated',
      action: 'Authenticate domain in Settings → Platforms',
      actionPath: '/settings?tab=platforms',
      category: 'channel_setup',
    },
  },
  {
    test: /dueat must be in the future|publish.*in the past|scheduled time.*pass/i,
    result: {
      message: 'Scheduled time has passed',
      action: 'Dismiss and re-generate',
      actionPath: null,
      category: 'scheduling',
    },
  },
  {
    test: /cannot read propert(y|ies) of (undefined|null)|is not defined|unexpected token/i,
    result: {
      message: 'Draft content incomplete — needs regeneration',
      action: 'Dismiss and re-generate',
      actionPath: null,
      category: 'content',
    },
  },
]

/** Map a raw failedReason to a friendly message + fix action. */
export function translateDraftError(raw: string | null): TranslatedError {
  const text = (raw ?? '').trim()
  if (!text) {
    return {
      message: 'Publishing failed',
      action: 'Dismiss and re-generate',
      actionPath: null,
      category: 'unknown',
    }
  }
  for (const rule of RULES) {
    if (rule.test.test(text)) return rule.result
  }
  return {
    message: 'Publishing failed',
    action: 'Dismiss and re-generate',
    actionPath: null,
    category: 'unknown',
  }
}
