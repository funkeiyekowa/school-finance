/**
 * Resolves the effective AI provider for one organization, combining:
 *   1. org_ai_settings (per-school provider/model + optional own key)
 *   2. platform_settings.active_ai_provider (platform-wide default)
 *   3. AI_PROVIDER env var
 *   4. first platform-configured provider — built-in or custom
 *
 * This is the single call site /api/ai/generate should use instead of
 * calling pickProvider() directly, so per-school overrides are honored
 * without every caller re-deriving the priority chain.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { pickProvider, type ResolvedProvider } from "@/lib/ai/providers";
import { listCustomProviderConfigs } from "@/lib/ai/customProviders";
import { decryptProviderKey } from "@/lib/ai/keyCrypto";
import { logError } from "@/lib/errors/logError";

interface ResolveArgs {
  /** A Supabase client carrying the caller's session (RLS applies) — used only for the RPC call, no service-role needed here. */
  supabase: SupabaseClient;
  organizationId: string | null;
}

export async function resolveProviderForOrg({ supabase, organizationId }: ResolveArgs): Promise<ResolvedProvider | null> {
  // Platform admin-registered providers (e.g. Z.ai) — RLS lets any
  // authenticated client read these, so this is safe before we even
  // know whether the caller belongs to an org.
  const customProviders = await listCustomProviderConfigs(supabase);

  if (!organizationId) {
    return pickProvider(process.env.AI_PROVIDER, null, null, customProviders);
  }

  let preferredProvider: string | null = null;
  let preferredModel: string | null = null;
  let hasKeyOverride = false;

  try {
    const { data, error } = await supabase
      .rpc("resolve_ai_provider_for_org", { p_org: organizationId })
      .maybeSingle();
    if (!error && data) {
      const row = data as { provider?: string | null; model?: string | null; has_key_override?: boolean };
      preferredProvider = row.provider ?? null;
      preferredModel = row.model ?? null;
      hasKeyOverride = Boolean(row.has_key_override);
    }
  } catch {
    // RPC not present yet (migration not applied) — fall through to env var chain.
  }

  let orgOverrideKey: string | null = null;
  if (hasKeyOverride) {
    orgOverrideKey = await fetchAndDecryptOrgKey(organizationId, preferredProvider);
  }

  return pickProvider(preferredProvider || process.env.AI_PROVIDER, preferredModel, orgOverrideKey, customProviders);
}

/**
 * The ciphertext column is never exposed to RLS-scoped clients (see
 * ai_provider_settings_v2.sql — org_ai_settings has no client-facing
 * SELECT policy at all). So reading it requires the service-role
 * client, scoped here to exactly one column of one row.
 */
async function fetchAndDecryptOrgKey(organizationId: string, provider: string | null): Promise<string | null> {
  if (!provider) return null;
  try {
    const svcUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!svcUrl || !svcKey) return null;

    const { createClient: createServiceClient } = await import("@supabase/supabase-js");
    const svc = createServiceClient(svcUrl, svcKey, { auth: { persistSession: false, autoRefreshToken: false } });

    const { data, error } = await svc
      .from("org_ai_settings")
      .select("override_api_key_ciphertext, active_provider")
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (error || !data) return null;
    const row = data as { override_api_key_ciphertext: string | null; active_provider: string | null };
    if (!row.override_api_key_ciphertext) return null;
    // Only decrypt if the stored override is actually for the provider we resolved to —
    // guards against a stale override key for a provider the school has since switched away from.
    if (row.active_provider && row.active_provider !== provider) return null;

    return decryptProviderKey(row.override_api_key_ciphertext);
  } catch (err) {
    // Never let a decrypt failure (e.g. AI_KEY_ENCRYPTION_SECRET rotated) break generation —
    // fall back to the platform key chain, but log it so an admin notices.
    await logError({
      source: "ai-resolve-org-key",
      severity: "warn",
      message: err instanceof Error ? err.message : "Failed to decrypt org AI key override",
      context: { organizationId },
    });
    return null;
  }
}
