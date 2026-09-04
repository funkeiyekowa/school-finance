/**
 * Shared guts of an AI completion call — provider resolution, the
 * actual model call, and best-effort logging into ai_generation_log.
 *
 * Factored out of /api/ai/generate so /api/ai/assistant (a separate,
 * more permissive route for the always-available help FAB) can reuse
 * the exact same call/log path instead of drifting out of sync.
 */

import { logError, requestContext } from "@/lib/errors/logError";
import { AI_PRESETS, type AiTaskKind } from "@/lib/ai/prompts";
import { resolveProviderForOrg } from "@/lib/ai/resolve";
import { createClient } from "@/lib/supabase/server";

export interface RunAiCompletionArgs {
  kind: AiTaskKind;
  input: string;
  extra?: Record<string, string>;
  source: string;
  orgId: string | null;
  userId: string | null;
  request: Request;
  /**
   * Optional replacement for the preset's fixed system prompt. Used only by
   * trusted server routes that build a system prompt at request time (e.g.
   * /api/ai/ask, which injects a school's configured assistant rules). The
   * client-facing /api/ai/generate route never sets this, so a caller can
   * never smuggle in their own system prompt.
   */
  systemOverride?: string;
}

export interface RunAiCompletionResult {
  output: string;
  error: string | null;
  model: string | null;
  usingOrgKey: boolean;
  tokens: { prompt: number; response: number };
  elapsed_ms: number;
}

export async function runAiCompletion({
  kind, input, extra, source, orgId, userId, request, systemOverride,
}: RunAiCompletionArgs): Promise<RunAiCompletionResult> {
  const started = Date.now();
  const supabase = await createClient();
  const provider = await resolveProviderForOrg({ supabase, organizationId: orgId });

  if (!provider) {
    return {
      output: "", error:
        "AI is not configured on this deployment. Set an API key for at least one provider " +
        "(OPENAI_API_KEY, GROQ_API_KEY, GEMINI_API_KEY, or OPENROUTER_API_KEY) in the server environment, " +
        "or add your school's own key under Dashboard → AI Provider.",
      model: null, usingOrgKey: false, tokens: { prompt: 0, response: 0 }, elapsed_ms: Date.now() - started,
    };
  }

  const preset = AI_PRESETS[kind];
  const userTurn = preset.compose(input, extra);
  const systemPrompt = systemOverride ?? preset.system;
  const maxTokens = preset.maxTokens ?? 400;

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
          { role: "system", content: systemPrompt },
          { role: "user", content: userTurn },
        ],
      }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`${provider.config.label} error ${resp.status}: ${text.slice(0, 300)}`);
    }

    const payload = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const choice = payload.choices?.[0];
    output = choice?.message?.content?.trim() ?? "";
    promptTokens = payload.usage?.prompt_tokens ?? 0;
    responseTokens = payload.usage?.completion_tokens ?? 0;
    if (!output) {
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
        user_id: userId,
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

  return {
    output, error: errorMsg, model: `${provider.config.id}:${provider.model}`,
    usingOrgKey: provider.usingOrgKey, tokens: { prompt: promptTokens, response: responseTokens },
    elapsed_ms: Date.now() - started,
  };
}
