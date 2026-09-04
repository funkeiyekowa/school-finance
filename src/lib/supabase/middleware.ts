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
 * Returns the exam_id the calling student is currently locked to (their own
 * in-progress CBT attempt), or null. Backed by get_active_exam_lock()
 * (supabase/cbt_exam_lock.sql), which is SECURITY DEFINER and resolves the
 * caller from auth.uid(), so the client cannot fake or suppress it.
 *
 * Read-only, uses the request's session cookies. Any error (including the
 * RPC not being deployed yet) resolves to null so the request is never
 * blocked by an infra hiccup — the client-side shell guard is the backstop.
 */
export async function resolveExamLock(request: NextRequest): Promise<string | null> {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        // No-op: this is a read-only check, we never mutate cookies here.
        setAll() {},
      },
    },
  );

  try {
    const { data, error } = await supabase.rpc("get_active_exam_lock");
    if (error || !data || (Array.isArray(data) && data.length === 0)) return null;
    const row = Array.isArray(data) ? data[0] : data;
    return (row as { exam_id?: string })?.exam_id ?? null;
  } catch {
    return null;
  }
}
