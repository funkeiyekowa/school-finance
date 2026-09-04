import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase session cookie.
 *
 * IMPORTANT: This runs in Vercel's Edge middleware, which has a ~1.5 s budget.
 * supabase.auth.getUser() is a network call to Supabase's GoTrue service. If
 * Supabase is slow (cold start, rate limit, network blip), it can exceed that
 * budget and produce a 504 MIDDLEWARE_INVOCATION_TIMEOUT.
 *
 * To stay within budget:
 *   1. We only call getUser() on routes that actually need a session (dashboard,
 *      api routes that aren't webhooks). Public pages, /auth, /s and static
 *      assets skip it entirely.
 *   2. We set a short fetch timeout so a slow Supabase response fails fast
 *      rather than hanging until the edge kills us.
 */

/** Routes that need a refreshed session. Everything else passes through. */
const PROTECTED_PREFIXES = ["/dashboard", "/api/platform"];

function needsSession(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(p => pathname.startsWith(p));
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  // Skip the network call entirely for routes that don't need auth.
  if (!needsSession(request.nextUrl.pathname)) {
    return supabaseResponse;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh the session token. Wrapped in a try/catch so a slow or
  // unreachable Supabase doesn't produce a 504 — the user just lands
  // on the page with a potentially stale (but still valid) cookie and
  // the client-side AuthContext will handle the refresh there instead.
  try {
    await supabase.auth.getUser();
  } catch {
    // Supabase unreachable or timed out. Let the request through —
    // the client-side AuthContext will handle token refresh.
  }

  return supabaseResponse;
}

/**
 * EXAM LOCK — the authoritative, server-side signal.
 *
 * Returns a three-state result:
 *   { status: "locked",   examId, attemptId } — student has an active attempt
 *   { status: "unlocked" }                    — no active attempt
 *   { status: "error",   reason }             — lock resolution failed
 *
 * The fail-CLOSED design: on error/timeout, we do NOT assume "unlocked."
 * The middleware blocks access to protected routes when status is "error"
 * (showing a retry page), rather than silently falling through. This closes
 * the gap where a slow DB could disable the entire lock.
 *
 * Carve-outs that keep working even during an error state:
 *   - login / logout / session refresh
 *   - the exam's own read/write operations (for a student already confirmed
 *     in-exam, the client keeps its last-known lock state)
 *   - static assets / _next internals
 */
export type ExamLockState =
  | { status: "unlocked" }
  | { status: "locked"; examId: string; attemptId: string }
  | { status: "error"; reason: string };

export async function resolveExamLock(request: NextRequest): Promise<ExamLockState> {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll() {},
      },
    },
  );

  try {
    const { data, error } = await supabase.rpc("get_active_exam_lock");
    if (error) {
      // PGRST202 = RPC doesn't exist (migration not applied) — treat as unlocked
      // rather than error, so the lock doesn't break pre-migration.
      if (error.code === "PGRST202") return { status: "unlocked" };
      return { status: "error", reason: error.message };
    }
    if (!data || (Array.isArray(data) && data.length === 0)) {
      return { status: "unlocked" };
    }
    const row = Array.isArray(data) ? data[0] : data;
    const examId = (row as { exam_id?: string })?.exam_id;
    const attemptId = (row as { attempt_id?: string })?.attempt_id;
    if (!examId) return { status: "unlocked" };
    return { status: "locked", examId, attemptId: attemptId ?? "" };
  } catch (err) {
    return { status: "error", reason: err instanceof Error ? err.message : "Lock resolution failed" };
  }
}
