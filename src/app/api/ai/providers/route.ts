/**
 * GET /api/ai/providers
 *
 * Reports which AI providers have an API key configured on this
 * deployment — booleans only, never the key values — so the
 * Dashboard → Platform → AI Provider screen can show which options
 * are actually usable before a super admin picks one.
 *
 * Staff-gated (not super-admin-only): any staff member landing on
 * the AI Studio page benefits from knowing AI is configured, and
 * this leaks nothing sensitive. Writing the active selection is a
 * separate concern, gated by platform_settings' RLS policy.
 */

import { NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/api/requireStaff";
import { AI_PROVIDERS, AI_PROVIDER_IDS, listConfiguredProviders } from "@/lib/ai/providers";

export async function GET() {
  const guard = await requireStaffSession();
  if (guard) return guard;

  const configured = new Set(listConfiguredProviders());
  const providers = AI_PROVIDER_IDS.map((id) => ({
    id,
    label: AI_PROVIDERS[id].label,
    configured: configured.has(id),
  }));

  return NextResponse.json({ providers });
}
