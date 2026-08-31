/**
 * Multi-provider registry for the AI text-generation proxy.
 *
 * Why this exists:
 *   • OpenAI, Groq, Google Gemini, and OpenRouter all expose an
 *     OpenAI-compatible /chat/completions endpoint (same request and
 *     response shape), so one code path can drive any of them.
 *   • We want to be able to configure several providers' API keys at
 *     once and let EACH SCHOOL pick its own active provider + model,
 *     optionally overriding with its own API key, instead of one
 *     platform-wide toggle.
 *   • A platform admin can ALSO register additional OpenAI-compatible
 *     providers at runtime (e.g. Z.ai/GLM) from Dashboard → Platform →
 *     AI Provider → "Manage custom providers" — see
 *     src/lib/ai/customProviders.ts and supabase/custom_ai_providers.sql.
 *     Those are converted to the same AiProviderConfig shape below and
 *     merged into pickProvider()'s search order, so adding a 5th (or
 *     50th) provider never requires a code change or redeploy again.
 *
 * Resolution order (see resolveForOrg in src/lib/ai/resolve.ts):
 *   1. org_ai_settings row for the caller's org (provider + model +
 *      optional key override) — set from Dashboard → AI Provider.
 *   2. platform_settings.active_ai_provider (platform-wide default,
 *      set from Dashboard → Platform → AI Provider by a super admin).
 *   3. AI_PROVIDER env var.
 *   4. First provider — built-in (in registry order) or custom (in
 *      creation order) — that has a platform key configured in Vercel.
 *
 * If nothing resolves, the app tells the caller AI isn't configured
 * rather than silently failing.
 */

export type AiProviderId = "openai" | "groq" | "gemini" | "openrouter";

export interface AiProviderConfig {
  /**
   * String, not AiProviderId: a custom provider (see
   * src/lib/ai/customProviders.ts) supplies an arbitrary lowercase slug
   * here (e.g. "zai"), not one of the 4 built-in literal ids.
   */
  id: string;
  label: string;
  /** Full chat-completions endpoint URL. */
  baseUrl: string;
  /**
   * Env var name(s) that may hold this provider's platform-wide (shared)
   * API key, checked in order (case-insensitive — Vercel dashboards often
   * get the casing of a var name slightly wrong, e.g. "openrouter" instead
   * of "OPENROUTER"). Some deployments prefix these with a tenant/school
   * name (e.g. GRANTSCHOOL_GROK_API_KEY for Groq) instead of the plain
   * name the provider actually documents — list every name in use here so
   * a single-tenant deployment's existing Vercel vars work without forcing
   * a rename. The first candidate with a non-empty value wins.
   */
  apiKeyEnvCandidates: string[];
  /** Env var that can override the default model for this provider. */
  modelEnv: string;
  defaultModel: string;
  /** Extra headers some providers require beyond Authorization + Content-Type. */
  extraHeaders?: Record<string, string>;
  /** True if this provider publishes fixed $0-cost model ids we can offer as "free". */
  supportsFreeModelDiscovery?: boolean;
}

// Registry order also doubles as fallback preference order when
// nothing more specific resolves.
export const AI_PROVIDERS: Record<AiProviderId, AiProviderConfig> = {
  openai: {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1/chat/completions",
    apiKeyEnvCandidates: ["OPENAI_API_KEY", "GRANTSCHOOL_OPENAI_API_KEY"],
    modelEnv: "OPENAI_MODEL",
    defaultModel: "gpt-4o-mini",
  },
  groq: {
    id: "groq",
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1/chat/completions",
    apiKeyEnvCandidates: ["GROQ_API_KEY", "GRANTSCHOOL_GROQ_API_KEY", "GRANTSCHOOL_GROK_API_KEY", "GROK_API_KEY"],
    modelEnv: "GROQ_MODEL",
    // llama-3.3-70b-versatile 404s on some Groq accounts ("does not exist
    // or you do not have access to it"). Groq retires/gates preview models
    // without much notice. llama-3.1-8b-instant is their long-standing
    // generally-available small model, far less likely to be gated.
    // Override via GROQ_MODEL in Vercel if this changes again - check
    // https://console.groq.com/docs/models for the current list.
    defaultModel: "llama-3.1-8b-instant",
  },
  gemini: {
    id: "gemini",
    label: "Google Gemini",
    // Google's OpenAI-compatibility layer.
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    apiKeyEnvCandidates: ["GEMINI_API_KEY", "GRANTSCHOOL_GEMINI_API_KEY"],
    modelEnv: "GEMINI_MODEL",
    // gemini-2.5-flash was retired for new API keys (404, "no longer
    // available to new users"). Google's own error names this replacement.
    // Override via GEMINI_MODEL in Vercel any time Google renames again.
    defaultModel: "gemini-3.6-flash",
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1/chat/completions",
    apiKeyEnvCandidates: ["OPENROUTER_API_KEY", "GRANTSCHOOL_OPENROUTER_API_KEY", "GRANTSCHOOL_openrouter_API_KEY"],
    modelEnv: "OPENROUTER_MODEL",
    defaultModel: "meta-llama/llama-3.3-70b-instruct:free",
    // OpenRouter asks (not strictly requires) for these for their leaderboard/attribution.
    extraHeaders: {
      "HTTP-Referer": "https://school-finance.vercel.app",
      "X-Title": "Smart & Thrive O/S",
    },
    supportsFreeModelDiscovery: true,
  },
};

export const AI_PROVIDER_IDS = Object.keys(AI_PROVIDERS) as AiProviderId[];

/**
 * Reads the first non-empty env var among `names`, matching case-
 * insensitively against the real process.env keys. This tolerates Vercel
 * env vars that were typed with unexpected casing (we've seen e.g.
 * "GRANTSCHOOL_openrouter_API_KEY" with a lowercase provider name) without
 * requiring anyone to go rename them in the dashboard.
 */
export function readEnvCandidates(names: string[]): string | undefined {
  const lowerToActualKey = new Map<string, string>();
  for (const key of Object.keys(process.env)) {
    lowerToActualKey.set(key.toLowerCase(), key);
  }
  for (const name of names) {
    const actualKey = lowerToActualKey.get(name.toLowerCase());
    const value = actualKey ? process.env[actualKey] : undefined;
    if (value) return value;
  }
  return undefined;
}

export interface ResolvedProvider {
  config: AiProviderConfig;
  apiKey: string;
  model: string;
  /** true when apiKey came from an org's own override rather than the shared platform key. */
  usingOrgKey: boolean;
}

/**
 * Picks a provider given a preferred id and an optional org-supplied
 * key override, searching the 4 built-in providers plus any
 * platform-registered custom providers (see customProviders, defaults
 * to none so existing callers that don't pass any keep working exactly
 * as before). If the preferred id names a known provider (built-in or
 * custom), that provider is tried first — using the org key if given,
 * else the platform's shared env-var key — before falling back through
 * the rest in registry/creation order. Returns null if nothing resolves.
 */
export function pickProvider(
  preferredId?: string | null,
  preferredModel?: string | null,
  orgOverrideKey?: string | null,
  customProviders: AiProviderConfig[] = [],
): ResolvedProvider | null {
  const requested = (preferredId || "").trim().toLowerCase();
  const allConfigs: AiProviderConfig[] = [
    ...AI_PROVIDER_IDS.map((id) => AI_PROVIDERS[id]),
    ...customProviders,
  ];
  const order: AiProviderConfig[] = requested
    ? [
        ...allConfigs.filter((c) => c.id.toLowerCase() === requested),
        ...allConfigs.filter((c) => c.id.toLowerCase() !== requested),
      ]
    : allConfigs;

  for (const config of order) {
    const isPreferred = config.id.toLowerCase() === requested;
    const apiKey = (isPreferred && orgOverrideKey) || readEnvCandidates(config.apiKeyEnvCandidates);
    if (apiKey) {
      const model =
        (isPreferred && preferredModel) ||
        process.env[config.modelEnv] ||
        config.defaultModel;
      return { config, apiKey, model, usingOrgKey: Boolean(isPreferred && orgOverrideKey) };
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

/** Which BUILT-IN providers currently have a platform-wide key configured in Vercel. */
export function listConfiguredProviders(): AiProviderId[] {
  return AI_PROVIDER_IDS.filter((id) => !!readEnvCandidates(AI_PROVIDERS[id].apiKeyEnvCandidates));
}

/** The actual configured platform-wide key for one built-in provider, if any (never logged/returned to clients). */
export function getConfiguredKey(id: AiProviderId): string | undefined {
  return readEnvCandidates(AI_PROVIDERS[id].apiKeyEnvCandidates);
}
