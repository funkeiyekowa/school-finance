/**
 * GET/POST /api/ai/org-settings
 *
 * Per-school AI provider settings — the school-level counterpart to
 * Dashboard → Platform → AI Provider (which sets the platform-wide
 * default). An org admin (or a super admin currently switched into
 * that school) can:
 *   - see the effective provider/model (their own choice, or
 *     "inheriting platform default")
 *   - pick a provider + model for their school only
 *   - optionally paste their own API key for that provider, stored
 *     encrypted (see @/lib/ai/keyCrypto) — never returned by GET
 *   - remove their own key to fall back to the shared platform key
 *   - see their school's own usage rollup from ai_generation_log
 *
 * Authorization is enforced in Postgres (_is_org_admin_for /
 * _is_platform_super_admin, see ai_provider_settings_v2.sql) via the
 * RPCs this route calls with the caller's own session — no
 * service-role needed for reads. Only the POST path that stores a
 * key override touches the service-role client, and only to write
 * the ciphertext column that has no client-facing SELECT policy.
 */

import { NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/api/requireStaff";
import { createClient } from "@/lib/supabase/server";
import { logError, requestContext } from "@/lib/errors/logError";
import { encryptProviderKey } from "@/lib/ai/keyCrypto";
import { AI_PROVIDERS, type AiProviderId } from "@/lib/ai/providers";

interface PostBody {
  organizationId?: string;
  provider?: AiProviderId | "" | null; // "" or null = clear override, inherit platform default
  model?: string | null;
  apiKey?: string | null; // present + non-empty = set/replace; absent = leave as-is; "" = explicitly clear
}

export async function GET(request: Request) {
  const guard = await requireStaffSession();
  if (guard) return guard;

  const url = new URL(request.url);
  const organizationId = url.searchParams.get("organizationId");
  if (!organizationId) {
    return NextResponse.json({ error: "organizationId is required." }, { status: 400 });
  }

  const supabase = await createClient();

  const [settingsRes, usageRes] = await Promise.all([
    supabase.rpc("get_org_ai_settings", { p_org: organizationId }).maybeSingle(),
    supabase.rpc("get_org_ai_usage", { p_org: organizationId, p_days: 30 }),
  ]);

  if (settingsRes.error) {
    return NextResponse.json({ error: settingsRes.error.message }, { status: 403 });
  }

  return NextResponse.json({
    settings: settingsRes.data ?? {
      active_provider: null, active_model: null, has_key_override: false,
      override_key_added_at: null, updated_at: null,
    },
    usage: usageRes.data ?? [],
  });
}

export async function POST(request: Request) {
  const guard = await requireStaffSession();
  if (guard) return guard;

  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const { organizationId } = body;
  if (!organizationId) {
    return NextResponse.json({ error: "organizationId is required." }, { status: 400 });
  }
  if (body.provider && !AI_PROVIDERS[body.provider as AiProviderId]) {
    return NextResponse.json({ error: "Unknown provider id." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Re-check authorization server-side via the same RPC gate the DB uses —
  // belt-and-braces so this route never trusts the client's own org-switch state.
  const { data: isAdmin, error: adminCheckError } = await supabase.rpc("_is_org_admin_for", { p_org: organizationId });
  const { data: isSuper } = await supabase.rpc("_is_platform_super_admin");
  if (adminCheckError || !(isAdmin || isSuper)) {
    return NextResponse.json({ error: "Not authorized for this school." }, { status: 403 });
  }

  const svcUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!svcUrl || !svcKey) {
    return NextResponse.json({ error: "Server is missing its service-role configuration." }, { status: 500 });
  }

  const { createClient: createServiceClient } = await import("@supabase/supabase-js");
  const svc = createServiceClient(svcUrl, svcKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const update: Record<string, unknown> = {
    organization_id: organizationId,
    updated_by: user?.id ?? null,
  };

  if (body.provider !== undefined) {
    update.active_provider = body.provider || null;
  }
  if (body.model !== undefined) {
    update.active_model = body.model || null;
  }

  if (body.apiKey !== undefined) {
    if (body.apiKey === "" || body.apiKey === null) {
      update.override_api_key_ciphertext = null;
      update.override_key_added_at = null;
    } else {
      try {
        update.override_api_key_ciphertext = encryptProviderKey(body.apiKey);
        update.override_key_added_at = new Date().toISOString();
      } catch (err) {
        await logError({
          source: "ai-org-settings",
          severity: "error",
          message: err instanceof Error ? err.message : "Failed to encrypt org AI key",
          organizationId,
          ...requestContext(request),
        });
        return NextResponse.json(
          { error: "Server cannot store API keys right now (encryption is not configured). Contact the platform admin." },
          { status: 500 },
        );
      }
    }
  }

  const { error: upsertError } = await svc
    .from("org_ai_settings")
    .upsert(update, { onConflict: "organization_id" });

  if (upsertError) {
    await logError({
      source: "ai-org-settings",
      severity: "error",
      message: upsertError.message,
      organizationId,
      ...requestContext(request),
    });
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
