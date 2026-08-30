/**
 * Server-side AI proxy.
 *
 * Why this exists:
 *   • We never want an OPENAI_API_KEY (or any other model key) to
 *     leave the server. All AI calls originate here so the key stays
 *     in the server env only.
 *   • Gives us one place to enforce staff-only access, rate limits,
 *     and structured logging into ai_generation_log.
 *   • Lets us swap providers (OpenAI, Anthropic, a local model)
 *     without touching every caller — the presets in @/lib/ai/prompts
 *     stay stable.
 *
 * Provider: any OpenAI-compatible chat-completions API — OpenAI,
 * Groq, Google Gemini, or OpenRouter. The active one is chosen, in
 * priority order, by: (1) platform_settings.active_ai_provider — set
 * from Dashboard → Platform → AI Provider, no redeploy needed; (2)
 * the AI_PROVIDER env var; (3) the first provider below with a key
 * configured. Falls back to a helpful error when no provider has a
 * key configured so a school can still install the app without
 * wiring AI on day 1.
 */

import { NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/api/requireStaff";
import { rateLimit, callerKey } from "@/lib/api/rateLimit";
import { logError, requestContext } from "@/lib/errors/logError";
import { AI_PRESETS, type AiTaskKind } from "@/lib/ai/prompts";
import { pickProvider } from "@/lib/ai/providers";
import { createClient } from "@/lib/supabase/server";

const AI_RATE_MAX = 30;
const AI_RATE_WINDOW_MS = 60_000; // 30 requests/minute per user IP

interface Body {
  kind?: AiTaskKind;
  input?: string;
  extra?: Record<string, string>;
  source?: string; // free-form origin tag: 'ai_module', 'report_card_comment', 'announcement', ...
}

export async function POST(request: Request) {
  const guard = await requireStaffSession();
  if (guard) return guard;

  const ip = callerKey(request);
  const rl = rateLimit({ name: "ai-generate", key: ip, max: AI_RATE_MAX, windowMs: AI_RATE_WINDOW_MS });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Try again in a moment." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const kind = body.kind;
  const input = (body.input ?? "").trim();
  const extra = body.extra ?? {};
  const source = body.source || "ai_module";

  if (!kind || !(kind in AI_PRESETS)) {
    return NextResponse.json({ error: "Unknown AI task kind." }, { status: 400 });
  }
  if (!input && kind !== "principal_comment" && kind !== "class_teacher_comment") {
    return NextResponse.json({ error: "Prompt input is empty." }, { status: 400 });
  }

  // Resolve org + user for logging, and check the dashboard's DB
  // toggle for the active provider. The staff session guard already
  // verified auth, so this only errors under Supabase outages.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase.from("profiles").select("organization_id").eq("id", user.id).maybeSingle()
    : { data: null };
  const orgId = (profile as { organization_id?: string | null } | null)?.organization_id ?? null;

  // A super admin's choice in Dashboard → Platform → AI Provider
  // (stored in platform_settings.active_ai_provider) takes priority
  // over the AI_PROVIDER env var if it names a provider that has a
  // key configured; otherwise pickProvider() falls back to the env
  // var, then to the first configured provider. Never let a missing
  // RPC (e.g. migration not yet applied) block AI generation.
  let dbPreferred: string | null = null;
  try {
    const { data: rpcData } = await supabase.rpc("get_active_ai_provider");
    dbPreferred = (rpcData as string | null) ?? null;
  } catch {
    // RPC not present yet (migration not applied) — fall through to env var.
  }

  const provider = pickProvider(dbPreferred || process.env.AI_PROVIDER);
  if (!provider) {
    return NextResponse.json(
      {
        error:
          "AI is not configured on this deployment. Set an API key for at least one provider " +
          "(OPENAI_API_KEY, GROQ_API_KEY, GEMINI_API_KEY, or OPENROUTER_API_KEY) in the server environment.",
      },
      { status: 503 },
    );
  }

  const preset = AI_PRESETS[kind];
  const userTurn = preset.compose(input, extra);
  const maxTokens = preset.maxTokens ?? 400;

  const started = Date.now();
  let output = "";
  let errorMsg: string | null = null;
  let promptTokens = 0;
  let responseTokens = 0;

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
        temperature: 0.6,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: preset.system },
          { role: "user", content: userTurn },
        ],
      }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`${provider.config.label} error ${resp.status}: ${text.slice(0, 300)}`);
    }

    const payload = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    output = payload.choices?.[0]?.message?.content?.trim() ?? "";
    promptTokens = payload.usage?.prompt_tokens ?? 0;
    responseTokens = payload.usage?.completion_tokens ?? 0;
    if (!output) {
      throw new Error("AI returned an empty response.");
    }
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : "AI call failed";
    await logError({
      source: "ai-generate",
      severity: "error",
      message: errorMsg,
      context: { kind, source, promptLen: userTurn.length, model: `${provider.config.id}:${provider.model}` },
      organizationId: orgId,
      ...requestContext(request),
    });
  }

  // Best-effort log — never blocks the response.
  try {
    const svcUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (svcUrl && svcKey) {
      const { createClient: svcClient } = await import("@supabase/supabase-js");
      const svc = svcClient(svcUrl, svcKey, { auth: { persistSession: false, autoRefreshToken: false } });
      await (svc.from("ai_generation_log") as unknown as {
        insert: (row: Record<string, unknown>) => Promise<unknown>;
      }).insert({
        organization_id: orgId,
        user_id: user?.id ?? null,
        source,
        category: kind,
        prompt_len: userTurn.length,
        response_len: output.length,
        model: `${provider.config.id}:${provider.model}`,
        tokens_prompt: promptTokens,
        tokens_response: responseTokens,
        error: errorMsg,
      });
    }
  } catch {
    // never let logging failure bubble up
  }

  if (errorMsg) {
    return NextResponse.json({ error: errorMsg }, { status: 502 });
  }
  return NextResponse.json({
    output,
    kind,
    tokens: { prompt: promptTokens, response: responseTokens },
    elapsed_ms: Date.now() - started,
  });
}
