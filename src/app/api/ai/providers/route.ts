/**
 * GET /api/ai/providers
 *
 * Reports which AI providers have a platform-wide API key configured
 * on this deployment — booleans only, never the key values — plus,
 * for OpenRouter, the live catalog of currently-free models and (if
 * a platform OpenRouter key is set) that key's live quota/usage so
 * the settings screens can show real numbers instead of guesses.
 *
 * Staff-gated (not super-admin-only): any staff member landing on
 * the AI Studio page benefits from knowing AI is configured, and
 * this leaks nothing sensitive. Writing the active selection is a
 * separate concern, gated by platform_settings'/org_ai_settings'
 * own authorization checks.
 */

import { NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/api/requireStaff";
import { AI_PROVIDERS, AI_PROVIDER_IDS, listConfiguredProviders, getConfiguredKey } from "@/lib/ai/providers";
import { listOpenRouterFreeModels, getOpenRouterKeyStatus } from "@/lib/ai/openrouter";
import { listGroqModels, listGeminiModels } from "@/lib/ai/modelCatalog";

export async function GET() {
  const guard = await requireStaffSession();
  if (guard) return guard;

  const configured = new Set(listConfiguredProviders());
  const providers = AI_PROVIDER_IDS.map((id) => ({
    id,
    label: AI_PROVIDERS[id].label,
    configured: configured.has(id),
  }));

  const freeModels = await listOpenRouterFreeModels();

  // Live model lists for Groq and Gemini too — same reasoning as OpenRouter's
  // free-model list: a hardcoded single "default model" string is exactly
  // what caused this deployment's earlier 404s (Groq and Google each retired
  // the previous default without much warning). These endpoints require a
  // real key (unlike OpenRouter's public /models list), so only fetch when
  // the platform actually has one configured for that provider.
  const groqKey = getConfiguredKey("groq");
  const geminiKey = getConfiguredKey("gemini");
  const [groqModels, geminiModels] = await Promise.all([
    groqKey ? listGroqModels(groqKey) : Promise.resolve([]),
    geminiKey ? listGeminiModels(geminiKey) : Promise.resolve([]),
  ]);

  let openRouterKeyStatus = null;
  const orKey = getConfiguredKey("openrouter");
  if (orKey) {
    openRouterKeyStatus = await getOpenRouterKeyStatus(orKey);
  }

  return NextResponse.json({
    providers,
    openRouterFreeModels: freeModels,
    openRouterKeyStatus,
    groqModels,
    geminiModels,
  });
}
