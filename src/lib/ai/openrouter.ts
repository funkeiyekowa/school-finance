/**
 * OpenRouter-specific helpers: live free-model discovery and
 * live key quota/usage lookup.
 *
 * OpenRouter is the one provider in our registry that hosts many
 * models behind one API key, several of them genuinely free
 * (":free" suffix, $0 pricing). Rather than hardcoding a model list
 * that silently goes stale when OpenRouter deprecates or re-prices
 * a model, we fetch their public /models list and filter to
 * currently-free ones at request time (cached briefly in memory).
 */

interface OpenRouterModel {
  id: string;
  name: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
}

export interface FreeModelOption {
  id: string;
  label: string;
  contextLength: number | null;
}

let cachedFreeModels: { at: number; models: FreeModelOption[] } | null = null;
const FREE_MODEL_CACHE_MS = 10 * 60 * 1000; // 10 minutes — model list changes rarely

/**
 * Fetches OpenRouter's live model catalog and returns only models
 * priced at $0 for both prompt and completion tokens — i.e.
 * genuinely free, not just cheap. No API key needed for this
 * endpoint (it's public), so this works even before a school has
 * any OpenRouter key configured.
 */
export async function listOpenRouterFreeModels(): Promise<FreeModelOption[]> {
  if (cachedFreeModels && Date.now() - cachedFreeModels.at < FREE_MODEL_CACHE_MS) {
    return cachedFreeModels.models;
  }

  try {
    const resp = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Accept: "application/json" },
      // Public catalog endpoint — safe to cache briefly at the fetch layer too.
      next: { revalidate: 600 },
    });
    if (!resp.ok) throw new Error(`OpenRouter models list ${resp.status}`);
    const payload = (await resp.json()) as { data?: OpenRouterModel[] };
    const models = (payload.data ?? [])
      .filter((m) => {
        const promptCost = parseFloat(m.pricing?.prompt ?? "0");
        const completionCost = parseFloat(m.pricing?.completion ?? "0");
        return m.id.endsWith(":free") || (promptCost === 0 && completionCost === 0);
      })
      .map((m) => ({ id: m.id, label: m.name || m.id, contextLength: m.context_length ?? null }))
      .sort((a, b) => a.label.localeCompare(b.label));

    cachedFreeModels = { at: Date.now(), models };
    return models;
  } catch {
    // Network hiccup or OpenRouter outage — fall back to the last good cache if we
    // have one (even if stale), else a short known-good static list so the picker
    // is never completely empty.
    if (cachedFreeModels) return cachedFreeModels.models;
    return [
      { id: "meta-llama/llama-3.3-70b-instruct:free", label: "Llama 3.3 70B (free)", contextLength: 65536 },
      { id: "nvidia/nemotron-3-ultra-550b-a55b:free", label: "Nemotron 3 Ultra 550B (free)", contextLength: null },
      { id: "minimax/minimax-m3:free", label: "MiniMax M3 (free)", contextLength: null },
    ];
  }
}

export interface OpenRouterKeyStatus {
  ok: boolean;
  label?: string;
  usage?: number;
  limit?: number | null;
  isFreeTier?: boolean;
  rateLimit?: { requests: number; interval: string } | null;
  error?: string;
}

/**
 * Calls OpenRouter's own /auth/key endpoint with the given key to
 * report real, live quota/usage for that key — not an estimate.
 * Docs: https://openrouter.ai/docs/api-reference/authentication
 * Never logs or returns the key itself.
 */
export async function getOpenRouterKeyStatus(apiKey: string): Promise<OpenRouterKeyStatus> {
  try {
    const resp = await fetch("https://openrouter.ai/api/v1/auth/key", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!resp.ok) {
      return { ok: false, error: `OpenRouter key check failed (${resp.status})` };
    }
    const payload = (await resp.json()) as {
      data?: {
        label?: string;
        usage?: number;
        limit?: number | null;
        is_free_tier?: boolean;
        rate_limit?: { requests: number; interval: string };
      };
    };
    const d = payload.data ?? {};
    return {
      ok: true,
      label: d.label,
      usage: d.usage,
      limit: d.limit ?? null,
      isFreeTier: d.is_free_tier,
      rateLimit: d.rate_limit ?? null,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Network error checking OpenRouter key" };
  }
}
