/**
 * Live model-catalog lookups for Groq and Google Gemini, mirroring
 * src/lib/ai/openrouter.ts's approach for OpenRouter.
 *
 * Why this exists: hardcoding one "default model" string per provider
 * is exactly what broke this deployment twice - Groq retired
 * llama-3.3-70b-versatile and Google retired gemini-2.5-flash for new
 * API keys, both with only a 404 at request time as warning. Rather
 * than keep guessing at a new hardcoded default that will eventually
 * go stale the same way, both AI Provider settings screens now offer
 * a live-fetched model picker for Groq and Gemini too, the same way
 * OpenRouter's free-model list already works: fetch each provider's
 * own model catalog with the platform's configured key, cache briefly,
 * and fall back to a short known-reasonable static list only if the
 * live fetch fails outright (key missing, network error, provider
 * outage) so the picker is never completely empty.
 *
 * Both endpoints require a real API key (unlike OpenRouter's public
 * /models list), so these calls only run for a provider that already
 * has a platform key configured — never expose or log the key itself.
 */

export interface ModelOption {
  id: string;
  label: string;
  contextLength: number | null;
}

interface CacheEntry {
  at: number;
  models: ModelOption[];
}

const CACHE_MS = 10 * 60 * 1000; // 10 minutes — catalogs change rarely
const groqCache = new Map<string, CacheEntry>(); // keyed by a short hash of the key, so a rotated key re-fetches
const geminiCache = new Map<string, CacheEntry>();

function cacheKeyFor(apiKey: string): string {
  // Not a security boundary (this cache lives in server memory only) —
  // just enough to avoid conflating two different keys' cached catalogs.
  return apiKey.slice(0, 8) + ":" + apiKey.length;
}

const GROQ_STATIC_FALLBACK: ModelOption[] = [
  { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B Instant", contextLength: 131072 },
  { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B Versatile", contextLength: 131072 },
  { id: "gemma2-9b-it", label: "Gemma 2 9B", contextLength: 8192 },
];

/**
 * Fetches Groq's live model list (GET /openai/v1/models, Bearer-authed
 * with the platform key). Returns every model Groq reports for this
 * key — Groq does not expose a $0/free-tier marker the way OpenRouter
 * does, so unlike listOpenRouterFreeModels this is not filtered to
 * "free" models, just to models this key can actually see.
 */
export async function listGroqModels(apiKey: string): Promise<ModelOption[]> {
  const cacheKey = cacheKeyFor(apiKey);
  const cached = groqCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.models;

  try {
    const resp = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
      next: { revalidate: 600 },
    });
    if (!resp.ok) throw new Error(`Groq models list ${resp.status}`);
    const payload = (await resp.json()) as { data?: Array<{ id: string; context_window?: number }> };
    const models = (payload.data ?? [])
      .map((m) => ({ id: m.id, label: m.id, contextLength: m.context_window ?? null }))
      .sort((a, b) => a.label.localeCompare(b.label));
    if (models.length === 0) throw new Error("Groq returned an empty model list");
    groqCache.set(cacheKey, { at: Date.now(), models });
    return models;
  } catch {
    if (cached) return cached.models; // stale-but-real beats a guess
    return GROQ_STATIC_FALLBACK;
  }
}

const GEMINI_STATIC_FALLBACK: ModelOption[] = [
  { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash", contextLength: null },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", contextLength: null },
];

/**
 * Fetches Gemini's live model list (GET /v1beta/models?key=..., Google's
 * own auth convention — the key is a query param, not a Bearer header).
 * Filtered to models that support generateContent (chat), since the
 * catalog also lists embedding/vision-only models we can't drive
 * through the OpenAI-compatible chat endpoint we call elsewhere.
 */
export async function listGeminiModels(apiKey: string): Promise<ModelOption[]> {
  const cacheKey = cacheKeyFor(apiKey);
  const cached = geminiCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.models;

  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
      { next: { revalidate: 600 } },
    );
    if (!resp.ok) throw new Error(`Gemini models list ${resp.status}`);
    const payload = (await resp.json()) as {
      models?: Array<{ name: string; displayName?: string; supportedGenerationMethods?: string[]; inputTokenLimit?: number }>;
    };
    const models = (payload.models ?? [])
      .filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
      // API returns "models/gemini-3.6-flash" — the chat endpoint wants just "gemini-3.6-flash".
      .map((m) => ({
        id: m.name.replace(/^models\//, ""),
        label: m.displayName || m.name.replace(/^models\//, ""),
        contextLength: m.inputTokenLimit ?? null,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
    if (models.length === 0) throw new Error("Gemini returned an empty model list");
    geminiCache.set(cacheKey, { at: Date.now(), models });
    return models;
  } catch {
    if (cached) return cached.models;
    return GEMINI_STATIC_FALLBACK;
  }
}
