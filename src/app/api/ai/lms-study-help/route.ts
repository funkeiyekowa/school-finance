/** Student-facing, lesson-grounded AI study help. */

import { NextResponse } from "next/server";
import { runAiCompletion } from "@/lib/ai/server";
import { getAuthorizedStudentLesson, groundedLessonSystemPrompt } from "@/lib/ai/studentLesson";
import { callerKey, rateLimitAsync } from "@/lib/api/rateLimit";
import { requireActiveSession } from "@/lib/api/requireSession";

const RATE_MAX = 15;
const RATE_WINDOW_MS = 60_000;

interface Body {
  lesson_id?: string;
  question?: string;
}

export async function POST(request: Request) {
  const session = await requireActiveSession();
  if (session instanceof Response) return session;

  const ip = callerKey(request);
  const [ipRl, userRl] = await Promise.all([
    rateLimitAsync({ name: "lms-study-help", key: ip, max: RATE_MAX, windowMs: RATE_WINDOW_MS }),
    rateLimitAsync({ name: "lms-study-help", key: `user:${session.user.id}`, max: RATE_MAX, windowMs: RATE_WINDOW_MS }),
  ]);
  const effectiveRl = ipRl.allowed ? userRl : ipRl;
  if (!effectiveRl.allowed) {
    return NextResponse.json(
      { error: "You're asking a lot of questions at once -- try again in a moment." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(effectiveRl.retryAfterMs / 1000)) } },
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const lessonId = (body.lesson_id ?? "").trim();
  const question = (body.question ?? "").trim();
  if (!lessonId) return NextResponse.json({ error: "lesson_id is required." }, { status: 400 });
  if (!question) return NextResponse.json({ error: "Ask a question first." }, { status: 400 });
  if (question.length > 600) {
    return NextResponse.json({ error: "Question is too long -- keep it under 600 characters." }, { status: 400 });
  }
  if (session.role !== "student") {
    return NextResponse.json({ error: "Student access required." }, { status: 403 });
  }

  // The shared authorization helper binds the student lookup to
  // .eq("profile_id", session.user.id) and .eq("organization_id", session.organizationId).
  const access = await getAuthorizedStudentLesson(session, lessonId);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });

  const systemOverride = groundedLessonSystemPrompt(
    access.context,
    "Answer the student's question in 2-5 plain, encouraging sentences suitable for a school-age reader. No emoji.",
  );
  const result = await runAiCompletion({
    kind: "lms_study_help",
    input: question,
    source: "lms-study-help",
    orgId: session.organizationId,
    userId: session.user.id,
    request,
    systemOverride,
  });

  if (result.error || !result.output) {
    return NextResponse.json({ error: "The study helper is unavailable right now. Try again later." }, { status: 502 });
  }

  return NextResponse.json({
    output: result.output,
    elapsed_ms: result.elapsed_ms,
    ai_generated: true,
    source: { lesson_id: access.context.lessonId, title: access.context.lessonTitle },
  });
}
