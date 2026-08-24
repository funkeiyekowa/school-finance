/**
 * Draft management client helpers.
 *
 * Provides type-safe wrappers around the draft RPCs for use in the
 * Website Studio dashboard. All actual authorization and tenant scoping
 * is enforced server-side by the RPCs; these helpers handle the client-
 * side call mechanics and type narrowing only.
 *
 * Behavioral notes (Increment 1.1):
 *   - Publish retains the draft (reset to match published state).
 *   - Discard resets the draft to match the currently published config.
 *   - The server enforces theme-source exclusivity (not both set).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ThemeTokens } from "./types";

export interface DraftState {
  theme_key: string | null;
  custom_theme_id: string | null;
  brand: ThemeTokens;
  typography: { heading?: string; body?: string; accent?: string };
  last_saved_at: string | null;
  saved_by: string | null;
  published_at: string | null;
}

export interface SaveDraftParams {
  themeKey?: string | null;
  customThemeId?: string | null;
  brand?: ThemeTokens;
  typography?: { heading?: string; body?: string; accent?: string };
}

export interface RpcResult {
  ok: boolean;
  error?: string;
  code?: string;
  saved_at?: string;
  published_at?: string;
  reset_to?: string;
}

/**
 * Load the current draft state for the authenticated user's org.
 * Returns null if no draft exists yet. After the first save or publish,
 * a draft row always exists (it is never deleted).
 */
export async function loadDraft(
  supabase: SupabaseClient
): Promise<DraftState | null> {
  const { data, error } = await supabase
    .from("website_drafts")
    .select("theme_key, custom_theme_id, brand, typography, last_saved_at, saved_by, published_at")
    .maybeSingle();

  if (error || !data) return null;

  return {
    theme_key: data.theme_key,
    custom_theme_id: data.custom_theme_id,
    brand: (data.brand ?? {}) as ThemeTokens,
    typography: (data.typography ?? {}) as DraftState["typography"],
    last_saved_at: data.last_saved_at,
    saved_by: data.saved_by,
    published_at: data.published_at ?? null,
  };
}

/**
 * Save (upsert) the draft via the server-side RPC.
 * All authorization and exclusivity checks are enforced by the RPC.
 */
export async function saveDraft(
  supabase: SupabaseClient,
  params: SaveDraftParams
): Promise<RpcResult> {
  const { data, error } = await supabase.rpc("save_website_draft", {
    p_theme_key: params.themeKey ?? null,
    p_custom_theme_id: params.customThemeId ?? null,
    p_brand: params.brand ?? {},
    p_typography: params.typography ?? {},
  });

  if (error) return { ok: false, error: error.message };
  return (data as RpcResult) ?? { ok: false, error: "No response from server" };
}

/**
 * Publish the current draft, promoting it to the live site.
 * The RPC enforces: admin role, premium entitlement, atomic snapshot+promote.
 * After publish, the draft is retained (reset to match published state).
 */
export async function publishDraft(
  supabase: SupabaseClient
): Promise<RpcResult> {
  const { data, error } = await supabase.rpc("publish_website_draft");
  if (error) return { ok: false, error: error.message };
  return (data as RpcResult) ?? { ok: false, error: "No response from server" };
}

/**
 * Discard the draft, resetting it to match the currently published site.
 * The draft row is retained — its values are overwritten to match published.
 */
export async function discardDraft(
  supabase: SupabaseClient
): Promise<RpcResult> {
  const { data, error } = await supabase.rpc("discard_website_draft");
  if (error) return { ok: false, error: error.message };
  return (data as RpcResult) ?? { ok: false, error: "No response from server" };
}

/**
 * Determine whether the draft differs from the published state.
 * Used to show a "you have unpublished changes" indicator.
 *
 * Logic: if draft.published_at is set and equals draft.last_saved_at,
 * the draft is in sync (no divergence). Otherwise compare field-by-field.
 */
export function draftDiffersFromPublished(
  draft: DraftState | null,
  published: { theme_key: string; custom_theme_id: string | null; brand: unknown; typography: unknown }
): boolean {
  if (!draft) return false;

  if (draft.theme_key !== null && draft.theme_key !== published.theme_key) return true;
  if (draft.custom_theme_id !== published.custom_theme_id) return true;
  if (JSON.stringify(draft.brand) !== JSON.stringify(published.brand)) return true;
  if (JSON.stringify(draft.typography) !== JSON.stringify(published.typography)) return true;

  return false;
}
