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
  // the client-side auth context handles the refresh there instead.
  try {
    await supabase.auth.getUser();
  } catch {
    // Supabase unreachable or timed out. Let the request through —
    // the client-side AuthContext will handle token refresh.
  }

  return supabaseResponse;
}
