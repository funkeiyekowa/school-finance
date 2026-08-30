/**
 * Server-side AI proxy.
 *
 * Why this exists:
 *   • We never want an OPENAI_API_KEY (or any other model key) to
 *     leave the server. All AI calls originate here so the key stays
 *     in the server env (or, for a school with its own key, encrypted
 *     in the DB and decrypted here) only.
 *   • Gives us one place to enforce staff-only access, rate limits,
 *     and structured logging into ai_generation_log.
 *   • Lets us swap providers (OpenAI, Groq, Gemini, OpenRouter, or a
 *     school's own key) without touching every caller — the presets
 *     in @/lib/ai/prompts stay stable.
 *
 * Provider resolution (see @/lib/ai/resolve — resolveProviderForOrg):
 *   1. org_ai_settings for the caller's school — provider + model,
 *      optionally with that school's own API key (Dashboard → AI Provider).
 *   2. platform_settings.active_ai_provider — platform-wide default
 *      (Dashboard → Platform → AI Provider, super-admin only).
 *   3. AI_PROVIDER env var.
 *   4. First provider below with a platform-shared key configured.
 * Falls back to a helpful error when nothing resolves so a school
 * can still install the app without wiring AI on day 1.
 */

import { NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/api/requireStaff";
import { rateLimit, callerKey } from "@/lib/api/rateLimit";
import { logError, requestContext } from "@/lib/errors/logError";
import { AI_PRESETS, type AiTaskKind } from "@/lib/ai/prompts";
import { resolveProviderForOrg } from "@/lib/ai/resolve";
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
  if (!input && kind !== "principal_comment" && kind !== "class_teacher_comment" && kind !== "connection_test") {
    return NextResponse.json({ error: "Prompt input is empty." }, { status: 400 });
  }

  // Resolve org + user for logging and per-school provider resolution.
  // The staff session guard already verified auth, so this only errors
  // under Supabase outages.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase.from("profiles").select("organization_id").eq("id", user.id).maybeSingle()
    : { data: null };
  const orgId = (profile as { organization_id?: string | null } | null)?.organization_id ?? null;

  const provider = await resolveProviderForOrg({ supabase, organizationId: orgId });
  if (!provider) {
    return NextResponse.json(
      {
        error:
          "AI is not configured on this deployment. Set an API key for at least one provider " +
          "(OPENAI_API_KEY, GROQ_API_KEY, GEMINI_API_KEY, or OPENROUTER_API_KEY) in the server environment, " +
          "or add your school's own key under Dashboard → AI Provider.",
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
    const choice = payload.choices?.[0] as
      | { message?: { content?: string }; finish_reason?: string }
      | undefined;
    output = choice?.message?.content?.trim() ?? "";
    promptTokens = payload.usage?.prompt_tokens ?? 0;
    responseTokens = payload.usage?.completion_tokens ?? 0;
    if (!output) {
      // A 200 OK with no content usually means: the model hit its token
      // limit before producing visible output, a content filter silently
      // dropped the reply, or (for OpenRouter free models specifically)
      // the model is temporarily overloaded. Naming the model and finish
      // reason here turns a generic "empty response" into something an
      // admin can actually act on from the AI Provider page.
      const reason = choice?.finish_reason ? ` (finish_reason: ${choice.finish_reason})` : "";
      throw new Error(
        `${provider.config.label} (${provider.model}) returned an empty response${reason}. ` +
          "Try a different model on Dashboard → AI Provider, or try again in a moment.",
      );
    }
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : "AI call failed";
    await logError({
      source: "ai-generate",
      severity: "error",
      message: errorMsg,
      context: {
        kind, source, promptLen: userTurn.length,
        model: `${provider.config.id}:${provider.model}`,
        usingOrgKey: provider.usingOrgKey,
      },
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
    model: `${provider.config.id}:${provider.model}`,
    usingOrgKey: provider.usingOrgKey,
    tokens: { prompt: promptTokens, response: responseTokens },
    elapsed_ms: Date.now() - started,
  });
}
