import { supabase } from "@/lib/supabase";
import type {
  AssignmentRow,
  AttemptRow,
  ExamRow,
  QuestionRow,
  StartAttemptResult,
  SubmitResult,
  ViolationResult,
} from "@/lib/exam-types";

/**
 * Mobile CBT — Phase 2.
 *
 * Adds NO backend surface. Every call below already exists and is already
 * used by the web exam runner (src/app/dashboard/cbt/[examId]/take/page.tsx).
 *
 * The server remains the sole authority:
 *   - start_exam_attempt validates published status, the starts_at/ends_at
 *     window, cbt_exam_assignments membership and max_attempts.
 *   - get_attempt_questions strips is_correct / answer_text before returning.
 *   - save_exam_answer verifies ownership + in_progress and stamps
 *     organization_id server-side (never sent by the client).
 *   - record_violation reads the limit from exams.settings and IGNORES the
 *     p_max_violations argument. It is passed only because the deployed
 *     function signature requires it — it does not and must not influence the
 *     server's decision.
 *   - submit_exam_attempt grades server-side.
 */

function asObject<T>(value: unknown): T {
  return (value ?? {}) as T;
}

function firstRow<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T | undefined) ?? null;
  return (value as T | null) ?? null;
}

/** Resolves the students row linked to the signed-in user, mirroring my-exams. */
export async function resolveStudent(userId: string, email: string | null): Promise<{ id: string; grade: string | null } | null> {
  const { data: byProfile } = await supabase
    .from("students")
    .select("id, grade")
    .eq("profile_id", userId)
    .maybeSingle();
  if (byProfile) return byProfile as { id: string; grade: string | null };

  if (!email) return null;
  const { data: byEmail } = await supabase
    .from("students")
    .select("id, grade")
    .eq("guardian_email", email)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  return (byEmail as { id: string; grade: string | null } | null) ?? null;
}

export interface ExamListPayload {
  exams: ExamRow[];
  attempts: AttemptRow[];
}

/**
 * Exams visible to this student. Permissive UI filter mirroring my-exams and
 * can_take_exam(); start_exam_attempt enforces the exact rule server-side.
 */
export async function fetchStudentExams(student: { id: string; grade: string | null }): Promise<ExamListPayload> {
  const [examResp, attemptResp, assignResp] = await Promise.all([
    supabase.from("exams").select("*").eq("status", "published"),
    supabase.from("exam_attempts").select("*").eq("student_id", student.id).order("started_at", { ascending: false }),
    supabase.from("cbt_exam_assignments").select("*").eq("student_id", student.id),
  ]);

  const allExams = (examResp.data as ExamRow[]) ?? [];
  const attempts = (attemptResp.data as AttemptRow[]) ?? [];
  const assignments = (assignResp.data as AssignmentRow[]) ?? [];

  const now = Date.now();
  const directIds = new Set(
    assignments
      .filter(
        (a) =>
          (!a.available_from || new Date(a.available_from).getTime() <= now) &&
          (!a.available_to || new Date(a.available_to).getTime() >= now),
      )
      .map((a) => a.exam_id),
  );

  const exams = allExams.filter((e) => {
    if (directIds.has(e.id)) return true;
    if (!e.class_id) return true;
    return student.grade != null;
  });

  return { exams, attempts };
}

export async function fetchExam(examId: string): Promise<ExamRow | null> {
  const { data } = await supabase.from("exams").select("*").eq("id", examId).single();
  return (data as ExamRow | null) ?? null;
}

/** Exam the student is currently locked into, if any. */
export async function fetchActiveExamLock(): Promise<string | null> {
  const { data } = await supabase.rpc("get_active_exam_lock");
  const row = firstRow<{ exam_id?: string }>(data);
  return row?.exam_id ?? null;
}

export async function startAttempt(examId: string): Promise<StartAttemptResult> {
  const { data, error } = await supabase.rpc("start_exam_attempt", { p_exam: examId });
  if (error) throw new Error(error.message || "Unable to start the exam.");
  return asObject<StartAttemptResult>(data);
}

export async function fetchAttemptQuestions(attemptId: string): Promise<QuestionRow[]> {
  const { data, error } = await supabase.rpc("get_attempt_questions", { p_attempt: attemptId });
  if (error) throw new Error(error.message || "Could not load the exam questions.");
  const rows = (data ?? []) as {
    id: string;
    question_text: string;
    question_type: string;
    options: unknown;
    marks: number;
    sort_order: number | null;
  }[];
  return rows.map((r) => ({
    id: r.id,
    question_text: r.question_text,
    question_type: r.question_type,
    marks: r.marks,
    sort_order: r.sort_order,
    options: Array.isArray(r.options) ? (r.options as { id: string; text: string }[]).map((o) => ({ id: o.id, text: o.text })) : [],
  }));
}

/** Server-recorded strike count. Students cannot read proctoring_events directly. */
export async function fetchProctoringState(attemptId: string): Promise<number | null> {
  const { data, error } = await supabase.rpc("get_attempt_proctoring_state", { p_attempt: attemptId });
  if (error) return null;
  const count = (data as { violation_count?: number } | null)?.violation_count;
  return typeof count === "number" ? count : null;
}

export async function fetchSavedAnswers(attemptId: string): Promise<{ question_id: string; selected_option: string | null; answer_text: string | null; flagged: boolean | null }[]> {
  const { data } = await supabase
    .from("exam_answers")
    .select("question_id, selected_option, answer_text, flagged")
    .eq("attempt_id", attemptId);
  return (data as { question_id: string; selected_option: string | null; answer_text: string | null; flagged: boolean | null }[]) ?? [];
}

/**
 * Persists one answer through the SECURITY DEFINER RPC. A direct table upsert
 * is rejected by RLS (no organization_id), which historically caused silently
 * unsaved answers and zero-graded papers — never bypass this.
 */
export async function saveAnswer(params: {
  attemptId: string;
  questionId: string;
  selectedOption: string | null;
  answerText: string | null;
  flagged: boolean;
}): Promise<boolean> {
  const { data, error } = await supabase.rpc("save_exam_answer", {
    p_attempt: params.attemptId,
    p_question: params.questionId,
    p_selected_option: params.selectedOption,
    p_answer_text: params.answerText,
    p_flagged: params.flagged,
  });
  const res = asObject<{ ok?: boolean }>(data);
  return !error && res.ok === true;
}

/**
 * Records a proctoring violation. The limit is decided server-side from
 * exams.settings; p_max_violations is sent only to satisfy the deployed
 * signature and carries no authority.
 */
export async function recordViolation(attemptId: string, kind: string, maxViolations: number): Promise<ViolationResult | null> {
  const { data, error } = await supabase.rpc("record_violation", {
    p_attempt: attemptId,
    p_kind: kind.replace(/ /g, "_"),
    p_max_violations: maxViolations,
  });
  if (error) return null;
  return asObject<ViolationResult>(data);
}

export async function logProctoringEvent(attemptId: string, eventType: string, eventData: Record<string, unknown>): Promise<void> {
  try {
    await supabase.rpc("log_proctoring_event", { p_attempt: attemptId, p_event_type: eventType, p_event_data: eventData });
  } catch {
    // Telemetry only — never block the exam on a failed event log.
  }
}

/**
 * Submits and grades. Prefers the 3-arg overload that records why the attempt
 * ended, falling back to the 2-arg form when the newer migration has not been
 * applied — a student's paper is never blocked by deploy ordering.
 */
export async function submitAttempt(attemptId: string, timedOut: boolean, reason?: string): Promise<SubmitResult> {
  let { data, error } = await supabase.rpc("submit_exam_attempt", {
    p_attempt: attemptId,
    p_timed_out: timedOut,
    p_reason: reason ?? (timedOut ? "timed_out" : "manual"),
  });
  if (error && (error.code === "PGRST202" || /Could not find the function/i.test(error.message))) {
    ({ data, error } = await supabase.rpc("submit_exam_attempt", { p_attempt: attemptId, p_timed_out: timedOut }));
  }
  if (error) throw new Error(error.message || "Could not submit your exam.");
  return asObject<SubmitResult>(data);
}

export async function fetchAttemptReview(attemptId: string): Promise<
  {
    question_id: string;
    question_text: string;
    options: { id: string; text: string; is_correct: boolean }[];
    marks: number;
    explanation: string | null;
    selected_option: string | null;
    is_correct: boolean | null;
    marks_awarded: number | null;
  }[]
> {
  const { data, error } = await supabase.rpc("get_attempt_review", { p_attempt: attemptId });
  if (error) throw new Error(error.message || "Could not load the review.");
  const rows = (data ?? []) as {
    question_id: string;
    question_text: string;
    options: unknown;
    marks: number;
    explanation: string | null;
    selected_option: string | null;
    is_correct: boolean | null;
    marks_awarded: number | null;
  }[];
  return rows.map((r) => ({
    ...r,
    options: Array.isArray(r.options) ? (r.options as { id: string; text: string; is_correct: boolean }[]) : [],
  }));
}
