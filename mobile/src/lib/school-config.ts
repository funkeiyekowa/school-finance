import { supabase } from "@/lib/supabase";

/**
 * Fallback used only if the platform_settings RPC is unreachable
 * (offline first launch, RPC not yet migrated, etc). Keeps the app
 * usable without a network round trip blocking startup indefinitely.
 */
const FALLBACK_SLUG = "grant-schools";

/**
 * Resolves the default school slug the app should boot straight into,
 * so most users never see the manual "enter your school" screen.
 * Reads platform_settings.default_mobile_school_slug via a public
 * SECURITY DEFINER RPC (get_default_mobile_school_slug) — safe to call
 * before authentication. Falls back to FALLBACK_SLUG on any error so a
 * misconfigured or unreachable backend never blocks app boot.
 */
export async function getDefaultSchoolSlug(): Promise<string> {
  try {
    const { data, error } = await supabase.rpc("get_default_mobile_school_slug");
    if (error || typeof data !== "string" || !data.trim()) return FALLBACK_SLUG;
    return data.trim().toLowerCase();
  } catch {
    return FALLBACK_SLUG;
  }
}
