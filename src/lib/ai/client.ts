/**
 * Thin browser-side client for the AI proxy.
 *
 * Any component that needs an AI assist calls `generateWithAi(...)`;
 * the request is authenticated by the user's browser session cookies
 * automatically, and the server route enforces staff-only + rate
 * limiting. Never exposes the model key.
 */

import type { AiTaskKind } from "@/lib/ai/prompts";

export interface GenerateOptions {
  kind: AiTaskKind;
  input: string;
  extra?: Record<string, string>;
  /** Where the call originated — used for the audit log. */
  source: string;
}

export interface GenerateResult {
  output: string;
  tokens: { prompt: number; response: number };
  elapsed_ms: number;
}

export async function generateWithAi(opts: GenerateOptions): Promise<GenerateResult> {
  const resp = await fetch("/api/ai/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(opts),
  });
  const payload = await resp.json().catch(() => ({} as { error?: string }));
  if (!resp.ok) {
    throw new Error((payload as { error?: string }).error || `AI request failed (${resp.status})`);
  }
  return payload as GenerateResult;
}

export interface AskAssistantOptions {
  input: string;
  /** Free-text hint about where the user is (e.g. current pathname). */
  page?: string;
  source?: string;
}

/**
 * Client for /api/ai/assistant — the always-available help FAB.
 *
 * Deliberately separate from generateWithAi(): this hits a route that
 * every signed-in role (parents and students included) can reach, and it
 * only ever runs the fixed `assistant_help` preset server-side — the
 * caller cannot pick a different kind or override the system prompt.
 */
export async function askAssistant(opts: AskAssistantOptions): Promise<GenerateResult> {
  const resp = await fetch("/api/ai/assistant", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      input: opts.input,
      source: opts.source || "ai_fab",
      extra: opts.page ? { page: opts.page } : undefined,
    }),
  });
  const payload = await resp.json().catch(() => ({} as { error?: string }));
  if (!resp.ok) {
    throw new Error((payload as { error?: string }).error || `AI request failed (${resp.status})`);
  }
  return payload as GenerateResult;
}

/**
 * Client for /api/ai/ask — the admin-configurable AI Learning Assistant
 * available to every role. The server enforces the school's rules,
 * allowed roles, banned topics and length limits; here we just send the
 * question.
 */
export async function askLearningAssistant(input: string, source = "ai_assistant_page"): Promise<GenerateResult> {
  const resp = await fetch("/api/ai/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input, source }),
  });
  const payload = await resp.json().catch(() => ({} as { error?: string }));
  if (!resp.ok) {
    throw new Error((payload as { error?: string }).error || `AI request failed (${resp.status})`);
  }
  return payload as GenerateResult;
}

export interface ReportCardExplainerResult {
  output: string;
  ai_generated: true;
  review_required: true;
  elapsed_ms: number;
  source: { report_card_id: string; term: string };
}

/**
 * Client for /api/ai/report-card-explainer — a grounded, read-only,
 * plain-language explanation of ONE already-published report card, for the
 * signed-in student themselves or a linked parent. The server re-verifies
 * ownership of the report card independently of RLS before calling AI.
 */
export async function explainReportCard(reportCardId: string): Promise<ReportCardExplainerResult> {
  const resp = await fetch("/api/ai/report-card-explainer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ report_card_id: reportCardId }),
  });
  const payload = await resp.json().catch(() => ({} as { error?: string }));
  if (!resp.ok) {
    throw new Error((payload as { error?: string }).error || `AI request failed (${resp.status})`);
  }
  return payload as ReportCardExplainerResult;
}
