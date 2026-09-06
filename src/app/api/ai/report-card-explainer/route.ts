/**
 * Parent/student-facing, report-card-grounded plain-language explainer.
 *
 * Fills the one portal with no AI feature at all (Parent Portal) using the
 * existing, already-wired student_term_summary preset and the shared
 * runAiCompletion path -- no new provider, no new preset, no schema change.
 *
 * Authorization mirrors /api/ai/lms-study-help: authenticated session ->
 * role check -> organization-bound, published-only report card -> caller
 * owns the student (self or linked parent) -> grounded, redaction-free
 * (report data has no free-text contact fields) numeric/text context ->
 * existing provider -> ai_generation_log.
 */

import { NextResponse } from "next/server";
import { runAiCompletion } from "@/lib/ai/server";
import { getAuthorizedReportCard, groundedReportCardSystemPrompt } from "@/lib/ai/reportCardAccess";
import { callerKey, rateLimitAsync } from "@/lib/api/rateLimit";
import { requireActiveSession } from "@/lib/api/requireSession";

const RATE_MAX = 10;
const RATE_WINDOW_MS = 60_000;

interface Body {
  report_card_id?: string;
}

export async function POST(request: Request) {
  const session = await requireActiveSession();
  if (session instanceof Response) return session;

  if (session.role !== "student" && session.role !== "parent") {
    return NextResponse.json({ error: "Student or parent access required." }, { status: 403 });
  }

  const ip = callerKey(request);
  const [ipRl, userRl] = await Promise.all([
    rateLimitAsync({ name: "report-card-explainer", key: ip, max: RATE_MAX, windowMs: RATE_WINDOW_MS }),
    rateLimitAsync({ name: "report-card-explainer", key: `user:${session.user.id}`, max: RATE_MAX, windowMs: RATE_WINDOW_MS }),
  ]);
  const effectiveRl = ipRl.allowed ? userRl : ipRl;
  if (!effectiveRl.allowed) {
    return NextResponse.json(
      { error: "Too many requests -- try again in a moment." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(effectiveRl.retryAfterMs / 1000)) } },
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const reportCardId = (body.report_card_id ?? "").trim();
  if (!reportCardId || reportCardId.length > 200) {
    return NextResponse.json({ error: "report_card_id is required." }, { status: 400 });
  }

  const access = await getAuthorizedReportCard(session, reportCardId);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });

  const { context } = access;
  const systemOverride = groundedReportCardSystemPrompt(context);
  // The systemOverride above carries the full grounded data and is the
  // authoritative guardrail. We ALSO pass the same real numbers through the
  // student_term_summary preset's own compose(), rather than leaving its
  // defaults as placeholders ("the student", blank average, etc.) -- this
  // keeps the user turn itself grounded, not just the system prompt.
  const result = await runAiCompletion({
    kind: "student_term_summary",
    input: [context.teacherComment, context.principalComment].filter(Boolean).join("\n") || "No additional teacher/principal notes were recorded.",
    extra: {
      student_name: context.studentFirstName,
      term: context.term,
      average: `${context.averageScore}%`,
      position: context.positionInClass ? `${context.positionInClass} of ${context.classSize ?? "?"}` : "",
      attendance: context.attendanceTotal > 0 ? `${context.attendancePresent} / ${context.attendanceTotal} days` : "",
    },
    source: "report-card-explainer",
    orgId: session.organizationId,
    userId: session.user.id,
    request,
    systemOverride,
  });

  if (result.error || !result.output) {
    return NextResponse.json({ error: "The report card explainer is unavailable right now. Try again later." }, { status: 502 });
  }

  return NextResponse.json({
    output: result.output,
    elapsed_ms: result.elapsed_ms,
    ai_generated: true,
    review_required: true,
    source: { report_card_id: access.context.reportCardId, term: access.context.term },
  });
}
