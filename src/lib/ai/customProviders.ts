/**
 * Custom AI providers — lets a platform admin register any additional
 * OpenAI-chat-compatible provider (base URL + which Vercel env var holds
 * its key + default model) from Dashboard → Platform → AI Provider →
 * "Manage custom providers", with NO code change or redeploy needed for
 * the next one. Backed by public.platform_ai_custom_providers (see
 * supabase/custom_ai_providers.sql).
 *
 * The API key VALUE is never stored in the database — only the NAME of
 * the Vercel env var holding it (api_key_env_name), read at request time
 * via readEnvCandidates(), exactly like every built-in provider's
 * apiKeyEnvCandidates already works.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AiProviderConfig } from "@/lib/ai/providers";

export interface CustomProviderRow {
  id: string;
  provider_key: string;
  label: string;
  base_url: string;
  api_key_env_name: string;
  default_model: string;
  extra_headers: Record<string, string> | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

/** Converts a DB row into the same shape pickProvider() already understands. */
export function toProviderConfig(row: CustomProviderRow): AiProviderConfig {
  return {
    id: row.provider_key,
    label: row.label,
    baseUrl: row.base_url,
    apiKeyEnvCandidates: [row.api_key_env_name],
    modelEnv: `${row.provider_key.toUpperCase()}_MODEL`,
    defaultModel: row.default_model,
    extraHeaders:
      row.extra_headers && Object.keys(row.extra_headers).length > 0 ? row.extra_headers : undefined,
  };
}

/**
 * Lists every ENABLED custom provider as full DB rows. RLS on
 * platform_ai_custom_providers already allows SELECT to any
 * authenticated user (same reasoning as platform_modules — nothing
 * here is secret, only a label/URL/model/env-var-NAME), so this works
 * with a normal RLS-scoped client — no service role needed.
 *
 * Swallows any error (including "relation does not exist" when
 * supabase/custom_ai_providers.sql hasn't been run yet) and returns an
 * empty list, so this feature is purely additive — nothing regresses
 * for a deployment that hasn't applied the migration.
 */
export async function listCustomProviderRows(supabase: SupabaseClient): Promise<CustomProviderRow[]> {
  try {
    const { data, error } = await supabase
      .from("platform_ai_custom_providers")
      .select("id, provider_key, label, base_url, api_key_env_name, default_model, extra_headers, enabled, created_at, updated_at")
      .eq("enabled", true)
      .order("created_at", { ascending: true });
    if (error || !data) return [];
    return data as CustomProviderRow[];
  } catch {
    return [];
  }
}

/** Convenience: the ready-to-use AiProviderConfig[] for pickProvider(). */
export async function listCustomProviderConfigs(supabase: SupabaseClient): Promise<AiProviderConfig[]> {
  const rows = await listCustomProviderRows(supabase);
  return rows.map(toProviderConfig);
}
