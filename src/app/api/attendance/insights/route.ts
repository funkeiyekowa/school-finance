/**
 * POST /api/attendance/insights
 *
 * Generates AI-powered attendance insights for a school, class, or student scope.
 * Student identifiers are never sent to the AI — only opaque refs built server-side.
 *
 * Authorization flow:
 *   1. auth.getUser() → 401 if not signed in
 *   2. get_my_attendance_capture_settings RPC → 403 if ai_insights_enabled is false
 *   3. current_user_org_id() → 403 if missing
 *   4. phase1_active_role() → determine role
 *   5. Allowed class IDs — teachers see only assigned classes; hr_access roles see all
 *   6. Build payload → call AI → validate → resolve refs → return
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { resolveProviderForOrg } from "@/lib/ai/resolve";
import { AI_PRESETS } from "@/lib/ai/prompts";
import { buildInsightsPayload, validateAndSanitizeResponse, resolveRefs } from "@/lib/attendance/ai-insights";
import type { InsightsRequest } from "@/lib/attendance/ai-insights-types";

const HR_ACCESS_ROLES = new Set([
  "owner", "admin", "developer", "editor", "staff", "bursar", "accountant", "super_admin",
]);

function makeServiceSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service role env vars missing");
  return createServiceClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function POST(request: Request) {
  // 1. Auth check
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  // 2. Check ai_insights_enabled
  const { data: captureSettings, error: cfgError } = await supabase.rpc(
    "get_my_attendance_capture_settings"
  );
  if (cfgError || !captureSettings) {
    return NextResponse.json({ error: "Could not load capture settings." }, { status: 403 });
  }
  const settings = captureSettings as Record<string, unknown>;
  if (!settings.ai_insights_enabled) {
    return NextResponse.json(
      { error: "AI insights are not enabled for this organisation." },
      { status: 403 }
    );
  }

  // 3. Resolve org ID
  const { data: orgIdData, error: orgError } = await supabase.rpc("current_user_org_id");
  if (orgError || !orgIdData) {
    return NextResponse.json({ error: "Could not determine organisation." }, { status: 403 });
  }
  const v_org_id = orgIdData as string;

  // 4. Determine role
  const { data: roleData } = await supabase.rpc("phase1_active_role");
  const activeRole = (roleData as string | null) ?? "";

  // 5. Determine allowed_class_ids
  let allowed_class_ids: string[] = [];

  if (activeRole === "teacher") {
    const { data: ta } = await supabase
      .from("teacher_assignments")
      .select("class_id")
      .eq("user_id", user.id)
      .eq("active", true)
      .eq("organization_id", v_org_id);
    allowed_class_ids = ((ta ?? []) as { class_id: string }[]).map((r) => r.class_id);
  } else if (HR_ACCESS_ROLES.has(activeRole)) {
    const { data: allClasses } = await supabase
      .from("classes")
      .select("id")
      .eq("organization_id", v_org_id)
      .eq("active", true);
    allowed_class_ids = ((allClasses ?? []) as { id: string }[]).map((r) => r.id);
  } else {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  // 6. Parse and validate request body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const req = body as Partial<InsightsRequest>;
  if (
    !req.scope ||
    !["class", "student", "school"].includes(req.scope) ||
    !req.date_from ||
    !req.date_to ||
    !req.capability ||
    !["patterns", "anomaly", "summary", "warnings", "data_quality", "all"].includes(req.capability)
  ) {
    return NextResponse.json(
      { error: "Invalid request: scope, date_from, date_to, and capability are required." },
      { status: 400 }
    );
  }

  // Teacher class_id restriction
  if (activeRole === "teacher" && req.class_id) {
    if (!allowed_class_ids.includes(req.class_id)) {
      return NextResponse.json(
        { error: "Not authorized for this class." },
        { status: 403 }
      );
    }
  }

  // Scope allowed_class_ids further if a specific class_id was requested
  const scopedClassIds =
    req.class_id && allowed_class_ids.includes(req.class_id)
      ? [req.class_id]
      : allowed_class_ids;

  const insightsRequest: InsightsRequest = {
    scope: req.scope,
    class_id: req.class_id,
    student_id: req.student_id,
    date_from: req.date_from,
    date_to: req.date_to,
    capability: req.capability,
  };

  // 7. Build payload (uses service client for broader data access)
  const svc = makeServiceSupabase();

  let payload, refMap;
  try {
    ({ payload, refMap } = await buildInsightsPayload({
      supabase: svc,
      org_id: v_org_id,
      allowed_class_ids: scopedClassIds,
      request: insightsRequest,
    }));
  } catch (err) {
    console.error("[insights] buildInsightsPayload error:", err);
    return NextResponse.json({ error: "Failed to build insights payload." }, { status: 500 });
  }

  // 8. Early exit if no data
  if (payload.student_stats.length === 0 && payload.class_stats.length === 0) {
    return NextResponse.json({
      generated_at: new Date().toISOString(),
      summary: "No attendance data found for this period.",
      findings: [],
    });
  }

  // 9. Call AI using the resolved provider (same pattern as generate/route.ts)
  const provider = await resolveProviderForOrg({ supabase, organizationId: v_org_id });
  if (!provider) {
    return NextResponse.json(
      { error: "AI is not configured on this deployment." },
      { status: 503 }
    );
  }

  const preset = AI_PRESETS["attendance_insights" as keyof typeof AI_PRESETS];
  const userTurn = JSON.stringify(payload);
  const maxTokens = preset?.maxTokens ?? 2000;

  let rawOutput = "";
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
        temperature: 0.2,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: preset.system },
          { role: "user", content: userTurn },
        ],
      }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`AI provider error ${resp.status}: ${text.slice(0, 300)}`);
    }

    const aiPayload = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    rawOutput = aiPayload.choices?.[0]?.message?.content?.trim() ?? "";
    if (!rawOutput) throw new Error("AI returned empty response");
  } catch (err) {
    console.error("[insights] AI call error:", err);
    return NextResponse.json(
      { error: "AI generation failed. Please try again." },
      { status: 500 }
    );
  }

  // 10. Validate and sanitize AI response
  let validated;
  try {
    validated = validateAndSanitizeResponse(rawOutput);
  } catch (err) {
    console.error("[insights] validateAndSanitizeResponse error:", err);
    return NextResponse.json(
      { error: "AI returned an unexpected response format." },
      { status: 500 }
    );
  }

  // 11. Resolve refs (display_name populated server-side only)
  const resolved = resolveRefs(validated, refMap);

  return NextResponse.json(resolved);
}
