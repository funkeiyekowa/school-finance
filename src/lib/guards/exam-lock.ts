/**
 * Unified server-side Exam Lock guard.
 *
 * One helper answering one question regardless of surface (middleware, API
 * route handler, server action): "Does this authenticated user currently have
 * an in-progress CBT attempt, and if so, is this specific operation on the
 * approved exam-session list?"
 *
 * Three outcomes:
 *   UNLOCKED — no active attempt, normal access.
 *   LOCKED   — active attempt, caller is confined to exam-session operations.
 *   ERROR    — lock resolution failed (DB timeout, RPC absent) → fail-closed:
 *              do NOT grant normal access (could be hiding an active attempt).
 *
 * The exam-session allowlist:
 *   - The take page for the active exam
 *   - get_attempt_questions, save_exam_answer, submit_exam_attempt RPCs
 *   - Heartbeat / proctoring-event writes
 *   - Required auth/session operations (login, logout, token refresh)
 *   - Static assets and _next internals
 *
 * Everything else is rejected for the locked student.
 */

// ---- Exam-session allowlist patterns ----
// Paths/operations a locked student may access during an active attempt.

/** Dashboard paths allowed during exam lock. `{examId}` is replaced at runtime. */
const EXAM_LOCKED_PAGE_PATTERNS = [
  /^\/dashboard\/cbt\/[^/]+\/take$/,       // the take page itself
];

/** API paths allowed during exam lock. */
const EXAM_LOCKED_API_PATTERNS = [
  /^\/api\/ai\/ask$/,                       // AI ask — will be blocked by the interlock anyway, but allow the request through so the 403 message is clear
  // Auth / session endpoints that must never be blocked
  /^\/api\/auth\//,
];

/**
 * Supabase RPC names a locked student may call (these go directly to
 * Supabase, not through /api, so they're enforced by the RPCs' own
 * SECURITY DEFINER ownership checks, not by middleware). Listed here
 * for documentation; the middleware cannot intercept them.
 */
export const EXAM_ALLOWED_RPCS = [
  "start_exam_attempt",
  "get_attempt_questions",
  "save_exam_answer",
  "submit_exam_attempt",
  "has_active_exam_attempt",
  "get_active_exam_lock",
];

export type ExamLockResult =
  | { status: "unlocked" }
  | { status: "locked"; examId: string; attemptId: string }
  | { status: "error"; reason: string };

/**
 * Check whether the given pathname is on the exam-session allowlist.
 * If a specific examId is provided, the take-page pattern is narrowed
 * to that exact exam.
 */
export function isExamAllowedPath(
  pathname: string,
  kind: "page" | "api",
  examId?: string,
): boolean {
  // Auth, login, logout, static assets — always allowed
  if (pathname.startsWith("/auth") || pathname.startsWith("/login") ||
      pathname.startsWith("/_next") || pathname === "/favicon.ico" ||
      pathname.startsWith("/s/")) {
    return true;
  }

  if (kind === "page") {
    if (examId) {
      return pathname === `/dashboard/cbt/${examId}/take`;
    }
    return EXAM_LOCKED_PAGE_PATTERNS.some(p => p.test(pathname));
  }

  if (kind === "api") {
    return EXAM_LOCKED_API_PATTERNS.some(p => p.test(pathname));
  }

  return false;
}

/**
 * For API route handlers: check whether the student is exam-locked and
 * whether this specific API path is on the allowlist. Returns a Response
 * to send back immediately (403) if access is denied, or null to proceed.
 *
 * Call this after authentication but before any business logic.
 * Requires the caller to provide the lock result (from resolveExamLock
 * or a cached check) so the DB call isn't duplicated.
 */
export function enforceExamLockForApi(
  lockResult: ExamLockResult,
  pathname: string,
): Response | null {
  if (lockResult.status === "unlocked") return null;

  if (lockResult.status === "error") {
    // Fail-closed for APIs too: if we can't verify, reject non-essential requests
    if (isExamAllowedPath(pathname, "api")) return null;
    return Response.json(
      { error: "Could not verify exam session. Please try again." },
      { status: 503 },
    );
  }

  // status === "locked"
  if (isExamAllowedPath(pathname, "api")) return null;
  return Response.json(
    { error: "This action is not available while you are taking an exam." },
    { status: 403 },
  );
}
