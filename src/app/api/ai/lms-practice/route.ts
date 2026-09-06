/** Student-facing, lesson-grounded practice and flashcard generation. */

import { NextResponse } from "next/server";
import { parseAiJsonObject } from "@/lib/ai/json";
import { runAiCompletion } from "@/lib/ai/server";
import { getAuthorizedStudentLesson, groundedLessonSystemPrompt } from "@/lib/ai/studentLesson";
import { callerKey, rateLimitAsync } from "@/lib/api/rateLimit";
import { requireActiveSession } from "@/lib/api/requireSession";

const RATE_MAX = 8;
const RATE_WINDOW_MS = 60_000;
const MAX_COUNT = 10;

interface Body {
  lesson_id?: string;
  mode?: "practice" | "flashcards";
  count?: number;
}

interface PracticeQuestion {
  question: string;
  answer: string;
  explanation: string;
}

interface Flashcard {
  front: string;
  back: string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export async function POST(request: Request) {
  const session = await requireActiveSession();
  if (session instanceof Response) return session;

  const ip = callerKey(request);
  const [ipRl, userRl] = await Promise.all([
    rateLimitAsync({ name: "lms-practice", key: ip, max: RATE_MAX, windowMs: RATE_WINDOW_MS }),
    rateLimitAsync({ name: "lms-practice", key: `user:${session.user.id}`, max: RATE_MAX, windowMs: RATE_WINDOW_MS }),
  ]);
  const effectiveRl = ipRl.allowed ? userRl : ipRl;
  if (!effectiveRl.allowed) {
    return NextResponse.json(
      { error: "Practice generation is rate limited -- try again in a moment." },
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
  const mode = body.mode ?? "practice";
  const count = Number.isInteger(body.count) ? Math.min(MAX_COUNT, Math.max(1, body.count as number)) : 5;
  if (!lessonId || lessonId.length > 200) return NextResponse.json({ error: "lesson_id is required." }, { status: 400 });
  if (mode !== "practice" && mode !== "flashcards") {
    return NextResponse.json({ error: "mode must be practice or flashcards." }, { status: 400 });
  }

  const access = await getAuthorizedStudentLesson(session, lessonId);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });

  const instruction = mode === "practice"
    ? `Return ONLY valid JSON exactly in this shape: {"questions":[{"question":"...","answer":"...","explanation":"..."}]}. Generate ${count} questions. Every answer and explanation must be supported by the approved source.`
    : `Return ONLY valid JSON exactly in this shape: {"cards":[{"front":"...","back":"..."}]}. Generate ${count} concise cards. Every back must be supported by the approved source.`;
  const systemOverride = groundedLessonSystemPrompt(access.context, instruction);
  const result = await runAiCompletion({
    kind: mode === "practice" ? "lms_practice" : "lms_flashcards",
    input: `Create ${count} ${mode === "practice" ? "practice questions" : "flashcards"} from this lesson.`,
    source: `lms-${mode}`,
    orgId: session.organizationId,
    userId: session.user.id,
    request,
    systemOverride,
  });

  if (result.error || !result.output) {
    return NextResponse.json({ error: "Practice generation is unavailable right now. Try again later." }, { status: 502 });
  }

  const parsed = parseAiJsonObject<{ questions?: unknown; cards?: unknown }>(result.output);
  if (!parsed) return NextResponse.json({ error: "The AI returned an invalid practice response. Try again." }, { status: 502 });

  if (mode === "practice") {
    const questions = Array.isArray(parsed.questions)
      ? parsed.questions
        .filter((item): item is PracticeQuestion => {
          if (!item || typeof item !== "object") return false;
          const value = item as Record<string, unknown>;
          return isNonEmptyString(value.question) && isNonEmptyString(value.answer) && isNonEmptyString(value.explanation);
        })
        .slice(0, count)
      : [];
    if (!questions.length) return NextResponse.json({ error: "The AI returned no usable practice questions. Try again." }, { status: 502 });
    return NextResponse.json({
      mode,
      questions,
      ai_generated: true,
      review_required: true,
      source: { lesson_id: access.context.lessonId, title: access.context.lessonTitle },
      elapsed_ms: result.elapsed_ms,
    });
  }

  const cards = Array.isArray(parsed.cards)
    ? parsed.cards
      .filter((item): item is Flashcard => {
        if (!item || typeof item !== "object") return false;
        const value = item as Record<string, unknown>;
        return isNonEmptyString(value.front) && isNonEmptyString(value.back);
      })
      .slice(0, count)
    : [];
  if (!cards.length) return NextResponse.json({ error: "The AI returned no usable flashcards. Try again." }, { status: 502 });
  return NextResponse.json({
    mode,
    cards,
    ai_generated: true,
    review_required: true,
    source: { lesson_id: access.context.lessonId, title: access.context.lessonTitle },
    elapsed_ms: result.elapsed_ms,
  });
}
