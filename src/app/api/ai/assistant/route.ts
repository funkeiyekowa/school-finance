/**
 * Server-side AI proxy for the always-available "assistant" FAB.
 *
 * Unlike /api/ai/generate (staff-only — used by AI Studio, report-card
 * comments, announcements, etc.), this route is reachable by ANY signed-in
 * member of a school, including parents and students. It exists solely to
 * back AiAssistantFab's "how do I use this platform?" chat, so it is
 * deliberately narrow:
 *   • Only ever runs the single `assistant_help` preset (kind is not
 *     accepted from the client) — no caller can smuggle a different,
 *     possibly-sensitive preset through this door.
 *   • Uses the same provider-resolution / logging path as /api/ai/generate
 *     via the shared runAiCompletion() helper, so behaviour (and the
 *     ai_generation_log audit trail) stays identical between the two
 *     routes.
 *   • Rate-limited under its own bucket ("ai-assistant") so a chatty
 *     student can't consume the staff-facing AI budget.
 */

import { NextResponse } from "next/server";
import { requireActiveSession } from "@/lib/api/requireSession";
import { rateLimit, callerKey } from "@/lib/api/rateLimit";
import { runAiCompletion } from "@/lib/ai/server";

const AI_RATE_MAX = 20;
const AI_RATE_WINDOW_MS = 60_000; // 20 requests/minute per caller IP

interface Body {
  input?: string;
  source?: string;
  extra?: Record<string, string>;
}

export async function POST(request: Request) {
  const session = await requireActiveSession();
  if (session instanceof Response) return session;

  const ip = callerKey(request);
  const rl = rateLimit({ name: "ai-assistant", key: ip, max: AI_RATE_MAX, windowMs: AI_RATE_WINDOW_MS });
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

  const input = (body.input ?? "").trim();
  const source = body.source || "ai_fab";
  const extra = body.extra ?? {};
  if (!input) {
    return NextResponse.json({ error: "Question is empty." }, { status: 400 });
  }

  const result = await runAiCompletion({
    kind: "assistant_help",
    input,
    extra,
    source,
    orgId: session.organizationId,
    userId: session.user.id,
    request,
  });

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }
  return NextResponse.json({
    output: result.output,
    kind: "assistant_help",
    model: result.model,
    usingOrgKey: result.usingOrgKey,
    tokens: result.tokens,
    elapsed_ms: result.elapsed_ms,
  });
}
