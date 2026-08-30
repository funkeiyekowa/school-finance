/**
 * Multi-provider registry for the AI text-generation proxy.
 *
 * Why this exists:
 *   • OpenAI, Groq, Google Gemini, and OpenRouter all expose an
 *     OpenAI-compatible /chat/completions endpoint (same request and
 *     response shape), so one code path can drive any of them.
 *   • We want to be able to configure several providers' API keys at
 *     once (e.g. keep OpenAI configured but run on Groq's free tier
 *     day-to-day) and flip between them with a single env var instead
 *     of a code change or redeploy-with-different-code.
 *
 * How to switch providers:
 *   1. Set the API key env var for whichever provider(s) you want
 *      available (see PROVIDER_KEY_ENV below).
 *   2. Set AI_PROVIDER to that provider's id ("openai" | "groq" |
 *      "gemini" | "openrouter") in the server environment.
 *   3. Redeploy. That's it — no code touches needed to switch again
 *      later, just change AI_PROVIDER and redeploy.
 *
 * If AI_PROVIDER is unset (or points at a provider with no key
 * configured), resolveActiveProvider() falls back to the first
 * provider below — in registry order — that has a key set, so the
 * app still works if the toggle is forgotten.
 */

export type AiProviderId = "openai" | "groq" | "gemini" | "openrouter";

export interface AiProviderConfig {
  id: AiProviderId;
  label: string;
  /** Full chat-completions endpoint URL. */
  baseUrl: string;
  /** Env var holding this provider's API key. */
  apiKeyEnv: string;
  /** Env var that can override the default model for this provider. */
  modelEnv: string;
  defaultModel: string;
  /** Extra headers some providers require beyond Authorization + Content-Type. */
  extraHeaders?: Record<string, string>;
}

// Registry order also doubles as fallback preference order when
// AI_PROVIDER isn't set or its key is missing.
export const AI_PROVIDERS: Record<AiProviderId, AiProviderConfig> = {
  openai: {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1/chat/completions",
    apiKeyEnv: "OPENAI_API_KEY",
    modelEnv: "OPENAI_MODEL",
    defaultModel: "gpt-4o-mini",
  },
  groq: {
    id: "groq",
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1/chat/completions",
    apiKeyEnv: "GROQ_API_KEY",
    modelEnv: "GROQ_MODEL",
    defaultModel: "llama-3.3-70b-versatile",
  },
  gemini: {
    id: "gemini",
    label: "Google Gemini",
    // Google's OpenAI-compatibility layer.
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    apiKeyEnv: "GEMINI_API_KEY",
    modelEnv: "GEMINI_MODEL",
    defaultModel: "gemini-2.5-flash",
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1/chat/completions",
    apiKeyEnv: "OPENROUTER_API_KEY",
    modelEnv: "OPENROUTER_MODEL",
    defaultModel: "meta-llama/llama-3.3-70b-instruct:free",
    // OpenRouter asks (not strictly requires) for these for their leaderboard/attribution.
    extraHeaders: {
      "HTTP-Referer": "https://school-finance.vercel.app",
      "X-Title": "Smart & Thrive O/S",
    },
  },
};

export const AI_PROVIDER_IDS = Object.keys(AI_PROVIDERS) as AiProviderId[];

export interface ResolvedProvider {
  config: AiProviderConfig;
  apiKey: string;
  model: string;
}

/**
 * Picks a provider given a preferred id (which may come from the
 * platform_settings.active_ai_provider DB toggle, or from the
 * AI_PROVIDER env var, or be empty/invalid). If the preferred id
 * names a provider with a key configured, that one wins. Otherwise
 * falls back to the first configured provider in registry order.
 * Returns null if no provider has a key set anywhere.
 */
export function pickProvider(preferredId?: string | null): ResolvedProvider | null {
  const requested = (preferredId || "").trim().toLowerCase() as AiProviderId;
  const order: AiProviderId[] =
    requested && AI_PROVIDERS[requested]
      ? [requested, ...AI_PROVIDER_IDS.filter((id) => id !== requested)]
      : AI_PROVIDER_IDS;

  for (const id of order) {
    const config = AI_PROVIDERS[id];
    const apiKey = process.env[config.apiKeyEnv];
    if (apiKey) {
      const model = process.env[config.modelEnv] || config.defaultModel;
      return { config, apiKey, model };
    }
  }
  return null;
}

/**
 * Env-var-only resolution (AI_PROVIDER toggle + fallback). Kept for
 * callers that don't have a DB-driven preference to check first.
 */
export function resolveActiveProvider(): ResolvedProvider | null {
  return pickProvider(process.env.AI_PROVIDER);
}

/** Which providers currently have a key configured — useful for diagnostics/UI. */
export function listConfiguredProviders(): AiProviderId[] {
  return AI_PROVIDER_IDS.filter((id) => !!process.env[AI_PROVIDERS[id].apiKeyEnv]);
}
