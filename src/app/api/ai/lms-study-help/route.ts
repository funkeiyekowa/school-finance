/**
 * Student-facing AI study helper for a specific LMS lesson.
 *
 * Deliberately a SEPARATE route from /api/ai/generate rather than
 * relaxing that route's requireStaffSession() gate: that route is
 * staff-only by design (it exposes report-card comment drafting,
 * announcement drafting, etc — nothing a student should reach), and
 * broadening it to admit students would let a student call ANY preset,
 * not just the study helper. This route instead:
 *
 *   1. Allows the "student" role (checked directly, not via
 *      requireStaffSession).
 *   2. Never accepts lesson content from the client — it looks up the
 *      lesson's stored content server-side from lesson_id, so a
 *      student cannot smuggle an arbitrary prompt into the system
 *      turn.
 *   3. Verifies the caller is the enrolled student for that lesson's
 *      course before answering — a student cannot ask about a lesson
 *      they are not enrolled in.
 *   4. System-prompts the model to answer ONLY from the given lesson
 *      content and refuse anything off-topic, so this cannot become a
 *      general-purpose free chat.
 *   5. Uses its own rate-limit bucket ("lms-study-help"), tighter than
 *      the general ai-generate limit, since this is reachable by every
 *      student in the school rather than just staff.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimit, callerKey } from "@/lib/api/rateLimit";
import { logError, requestContext } from "@/lib/errors/logError";
import { resolveProviderForOrg } from "@/lib/ai/resolve";

const RATE_MAX = 15;
const RATE_WINDOW_MS = 60_000; // 15 questions/minute per caller IP

interface Body {
  lesson_id?: string;
  question?: string;
}

export async function POST(request: Request) {
  const ip = callerKey(request);
  const rl = rateLimit({ name: "lms-study-help", key: ip, max: RATE_MAX, windowMs: RATE_WINDOW_MS });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "You're asking a lot of questions at once -- try again in a moment." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } },
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

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  // Resolve the caller's student record. Mirrors the pattern already
  // used by the Student Portal's exam page: students.profile_id first,
  // guardian_email as a legacy fallback.
  const { data: byProfile } = await supabase
    .from("students")
    .select("id, organization_id, full_name")
    .eq("profile_id", user.id)
    .maybeSingle();
  let student = byProfile as { id: string; organization_id: string | null; full_name: string } | null;
  if (!student) {
    const { data: byEmail } = await supabase
      .from("students")
      .select("id, organization_id, full_name")
      .eq("guardian_email", user.email)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    student = byEmail as { id: string; organization_id: string | null; full_name: string } | null;
  }
  if (!student) {
    return NextResponse.json({ error: "No student record found for this account." }, { status: 403 });
  }

  // Look up the lesson server-side -- content NEVER comes from the client.
  const { data: lesson } = await supabase
    .from("lms_lessons")
    .select("id, title, content, status, course_id, organization_id")
    .eq("id", lessonId)
    .maybeSingle();
  if (!lesson || lesson.status !== "published" || lesson.organization_id !== student.organization_id) {
    return NextResponse.json({ error: "Lesson not found." }, { status: 404 });
  }

  // Verify enrollment: the student must be actively enrolled in this
  // lesson's course.
  const { data: enrollment } = await supabase
    .from("lms_enrollments")
    .select("id")
    .eq("course_id", lesson.course_id)
    .eq("student_id", student.id)
    .eq("status", "active")
    .maybeSingle();
  if (!enrollment) {
    return NextResponse.json({ error: "You are not enrolled in this course." }, { status: 403 });
  }

  const provider = await resolveProviderForOrg({ supabase, organizationId: student.organization_id });
  if (!provider) {
    return NextResponse.json(
      { error: "AI study help is not configured for this school yet." },
      { status: 503 },
    );
  }

  const lessonContent = (lesson.content ?? "").slice(0, 6000); // guard against runaway prompt size
  const system =
    "You are a patient study helper for a school student, answering questions about ONE specific lesson. " +
    "Answer ONLY using the lesson content given below -- never introduce outside facts, opinions, or topics. " +
    "If the question is unrelated to this lesson's content, say you can only help with this lesson and suggest " +
    "the student re-read the relevant section. Keep answers to 2-5 sentences, plain and encouraging, suitable " +
    "for a school-age reader. No emoji.\n\n" +
    `Lesson title: ${lesson.title}\n\nLesson content:\n${lessonContent}`;

  const started = Date.now();
  let output = "";
  let errorMsg: string | null = null;

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
        temperature: 0.4,
        max_tokens: 300,
        messages: [
          { role: "system", content: system },
          { role: "user", content: question },
        ],
      }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`${provider.config.label} error ${resp.status}: ${text.slice(0, 300)}`);
    }

    const payload = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    output = payload.choices?.[0]?.message?.content?.trim() ?? "";
    if (!output) {
      throw new Error("The study helper had no answer -- try rephrasing your question.");
    }
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : "AI call failed";
    await logError({
      source: "lms-study-help",
      severity: "error",
      message: errorMsg,
      context: { lessonId, model: `${provider.config.id}:${provider.model}` },
      organizationId: student.organization_id,
      ...requestContext(request),
    });
  }

  if (errorMsg) {
    return NextResponse.json({ error: errorMsg }, { status: 502 });
  }

  return NextResponse.json({ output, elapsed_ms: Date.now() - started });
}
