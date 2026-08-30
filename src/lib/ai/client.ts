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
