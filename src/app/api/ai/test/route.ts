/**
 * POST /api/ai/test — "Test connection" button on both AI Provider
 * settings pages (platform-wide and school-level).
 *
 * Why this exists: previously the only way to discover a bad model id
 * or a rejected key was to save the setting, go to AI Studio, run a
 * real task, and read a generic error there. That's exactly how a
 * stale default model (Groq's llama-3.3-70b-versatile, Gemini's
 * gemini-2.5-flash — both retired) went unnoticed until a user hit
 * "AI returns an empty response" on an unrelated page. This route lets
 * an admin verify a provider/model/key combination — saved or not yet
 * saved — right where they're choosing it, using the exact same
 * request path /api/ai/generate uses (same model call, same
 * AI_PRESETS, same error text), so what passes here is guaranteed to
 * also work from AI Studio.
 *
 * Two callers, two authorization shapes:
 *   - Platform test: organizationId omitted. Requires platform super
 *     admin (checked via the same _is_platform_super_admin RPC the
 *     org-settings route already trusts).
 *   - School test: organizationId provided. Requires org admin (or
 *     platform super admin) for that org, and an org's own API key
 *     override is honored via the same encrypt/decrypt path as
 *     resolveProviderForOrg — never trusts a client-supplied key.
 *
 * Deliberately calls pickProvider() directly (not resolveProviderForOrg)
 * so it tests the provider/model the caller is looking at right now on
 * the settings screen, whether or not that choice has been saved yet.
 */

import { NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/api/requireStaff";
import { rateLimit, callerKey } from "@/lib/api/rateLimit";
import { pickProvider } from "@/lib/ai/providers";
import { decryptProviderKey } from "@/lib/ai/keyCrypto";
import { AI_PRESETS } from "@/lib/ai/prompts";
import { createClient } from "@/lib/supabase/server";

const TEST_RATE_MAX = 10;
const TEST_RATE_WINDOW_MS = 60_000;

interface Body {
  organizationId?: string | null;
  provider?: string | null;
  model?: string | null;
}

export async function POST(request: Request) {
  const guard = await requireStaffSession();
  if (guard) return guard;

  const ip = callerKey(request);
  const rl = rateLimit({ name: "ai-test", key: ip, max: TEST_RATE_MAX, windowMs: TEST_RATE_WINDOW_MS });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many test requests. Try again in a moment." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const organizationId = body.organizationId || null;
  const requestedProvider = body.provider || null;
  const requestedModel = body.model || null;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  // Authorization: mirror /api/ai/org-settings exactly — never trust
  // client-side org-switch state, always re-verify server-side.
  if (organizationId) {
    const { data: authorized } = await supabase.rpc("_is_org_admin_for", { p_org: organizationId });
    if (!authorized) {
      const { data: isSuper } = await supabase.rpc("_is_platform_super_admin");
      if (!isSuper) {
        return NextResponse.json({ error: "Not authorized for this school." }, { status: 403 });
      }
    }
  } else {
    const { data: isSuper } = await supabase.rpc("_is_platform_super_admin");
    if (!isSuper) {
      return NextResponse.json({ error: "Platform super admin only." }, { status: 403 });
    }
  }

  // If testing a specific school, honor that school's own key override
  // (if any) for the requested provider — same decrypt path resolve.ts
  // uses, so the test reflects what generate/route.ts will actually do.
  let orgOverrideKey: string | null = null;
  if (organizationId && requestedProvider) {
    orgOverrideKey = await fetchOrgOverrideKeyForTest(organizationId, requestedProvider);
  }

  const provider = pickProvider(requestedProvider, requestedModel, orgOverrideKey);
  if (!provider) {
    return NextResponse.json(
      { error: "No API key configured for this provider on this deployment." },
      { status: 503 },
    );
  }

  const preset = AI_PRESETS.connection_test;
  const started = Date.now();

  try {
    const resp = await fetch(provider.config.baseUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        "Content-Type": "application/json",
        ...(provider.config.extraHeaders ?? {}),
      },
      body: JSON.stringify({
        model: provider.model,
        temperature: 0,
        max_tokens: preset.maxTokens ?? 10,
        messages: [
          { role: "system", content: preset.system },
          { role: "user", content: preset.compose("", {}) },
        ],
      }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      return NextResponse.json(
        {
          ok: false,
          error: `${provider.config.label} error ${resp.status}: ${text.slice(0, 300)}`,
          model: `${provider.config.id}:${provider.model}`,
        },
        { status: 200 }, // 200 so the client can render the failure inline without a network-error branch
      );
    }

    const payload = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
    };
    const choice = payload.choices?.[0];
    const output = choice?.message?.content?.trim() ?? "";

    if (!output) {
      const reason = choice?.finish_reason ? ` (finish_reason: ${choice.finish_reason})` : "";
      return NextResponse.json({
        ok: false,
        error: `${provider.config.label} (${provider.model}) returned an empty response${reason}.`,
        model: `${provider.config.id}:${provider.model}`,
      });
    }

    return NextResponse.json({
      ok: true,
      model: `${provider.config.id}:${provider.model}`,
      usingOrgKey: provider.usingOrgKey,
      elapsed_ms: Date.now() - started,
    });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : "Network error calling the provider.",
      model: `${provider.config.id}:${provider.model}`,
    });
  }
}

async function fetchOrgOverrideKeyForTest(organizationId: string, provider: string): Promise<string | null> {
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
    if (row.active_provider && row.active_provider !== provider) return null;

    return decryptProviderKey(row.override_api_key_ciphertext);
  } catch {
    return null;
  }
}
