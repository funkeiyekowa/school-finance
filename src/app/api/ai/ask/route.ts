/**
 * POST /api/ai/ask — the admin-configurable AI Learning Assistant.
 *
 * Reachable by ANY signed-in member of a school (teachers, students,
 * parents, staff), but every school's admin controls the behaviour via
 * org_assistant_config (see supabase/ai_assistant_module.sql):
 *   • enabled            — off = this route refuses for that school
 *   • allowed_roles      — the caller's role must be in this set
 *   • custom_rules       — house rules injected into the system prompt
 *   • banned_topics      — the assistant is told to refuse these
 *   • max_input_chars    — questions longer than this are rejected
 *   • student_safe_mode  — adds age-appropriate guardrails
 *
 * The system prompt is built HERE, server-side, from the school's config
 * and passed to runAiCompletion() as systemOverride — the client can only
 * send a question, never steer the assistant's rules. Uses the shared
 * provider-resolution + audit-log path, and its own rate-limit bucket.
 */

import { NextResponse } from "next/server";
import { requireActiveSession } from "@/lib/api/requireSession";
import { rateLimit, callerKey } from "@/lib/api/rateLimit";
import { runAiCompletion } from "@/lib/ai/server";
import { createClient } from "@/lib/supabase/server";

const AI_RATE_MAX = 15;
const AI_RATE_WINDOW_MS = 60_000; // 15 questions/minute per caller

interface Body {
  input?: string;
  source?: string;
}

interface AssistantConfig {
  enabled: boolean;
  allowed_roles: string[];
  custom_rules: string | null;
  banned_topics: string[];
  max_input_chars: number;
  student_safe_mode: boolean;
}

function buildSystemPrompt(cfg: AssistantConfig): string {
  const parts: string[] = [
    "You are a helpful learning assistant for a school. Be clear, patient and encouraging, " +
      "and use plain British English. Explain concepts step by step at a level appropriate to the " +
      "person asking. Prefer teaching the method over just handing over a final answer, especially " +
      "for homework-style questions.",
  ];

  if (cfg.student_safe_mode) {
    parts.push(
      "SAFETY: Your audience includes school-age children. Keep everything strictly age-appropriate. " +
        "Refuse anything sexual, violent, hateful, self-harm-related, or otherwise unsafe for minors, " +
        "and never share personal contact details or encourage meeting strangers.",
    );
  }

  if (cfg.banned_topics.length > 0) {
    parts.push(
      "You must NOT discuss the following topics. If asked, politely decline and suggest the student " +
        `speak to a teacher: ${cfg.banned_topics.join(", ")}.`,
    );
  }

  if (cfg.custom_rules && cfg.custom_rules.trim()) {
    // Admin house rules are additive guardrails — presented as authoritative
    // instructions the assistant must follow on top of the baseline.
    parts.push(`SCHOOL RULES (must always be followed):\n${cfg.custom_rules.trim()}`);
  }

  parts.push(
    "If a request falls outside what a school assistant should answer, politely decline and suggest " +
      "asking a teacher. Never claim to have access to live school records.",
  );

  return parts.join("\n\n");
}

export async function POST(request: Request) {
  const session = await requireActiveSession();
  if (session instanceof Response) return session;

  const ip = callerKey(request);
  const rl = rateLimit({ name: "ai-ask", key: ip, max: AI_RATE_MAX, windowMs: AI_RATE_WINDOW_MS });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "You're asking a lot very quickly. Please wait a moment and try again." },
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
  if (!input) {
    return NextResponse.json({ error: "Your question is empty." }, { status: 400 });
  }

  const supabase = await createClient();

  // CBT interlock — enforced server-side, never on a client flag. If the
  // caller has a CBT attempt still in progress, the AI Assistant is blocked
  // so it can't be used to answer live exam questions. This holds until the
  // attempt is submitted / auto-submitted / timed out (status leaves
  // 'in_progress'). Checked before anything else AI-related runs.
  const { data: hasActiveExam } = await supabase.rpc("has_active_exam_attempt");
  if (hasActiveExam === true) {
    return NextResponse.json(
      { error: "AI Assistant is unavailable while you are taking an exam." },
      { status: 403 },
    );
  }

  // Load this school's assistant configuration.
  const { data: cfgRow, error: cfgErr } = await supabase
    .rpc("get_org_assistant_config", { p_org: session.organizationId })
    .maybeSingle();

  if (cfgErr) {
    return NextResponse.json({ error: "Could not load the assistant configuration." }, { status: 500 });
  }

  const cfg = (cfgRow ?? {
    enabled: true,
    allowed_roles: ["owner", "admin", "editor", "staff", "teacher", "bursar", "accountant", "student", "parent"],
    custom_rules: null,
    banned_topics: [],
    max_input_chars: 2000,
    student_safe_mode: true,
  }) as AssistantConfig;

  if (!cfg.enabled) {
    return NextResponse.json(
      { error: "The AI assistant is turned off for your school. Ask an administrator to enable it." },
      { status: 403 },
    );
  }

  if (!cfg.allowed_roles.includes(session.role)) {
    return NextResponse.json(
      { error: "Your account type does not have access to the AI assistant." },
      { status: 403 },
    );
  }

  if (input.length > cfg.max_input_chars) {
    return NextResponse.json(
      { error: `Your question is too long (max ${cfg.max_input_chars} characters). Please shorten it.` },
      { status: 400 },
    );
  }

  const result = await runAiCompletion({
    kind: "learning_assistant",
    input,
    extra: { role: session.role },
    source: body.source || "ai_ask",
    orgId: session.organizationId,
    userId: session.user.id,
    request,
    systemOverride: buildSystemPrompt(cfg),
  });

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }
  return NextResponse.json({
    output: result.output,
    model: result.model,
    tokens: result.tokens,
    elapsed_ms: result.elapsed_ms,
  });
}
