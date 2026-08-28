import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Three jobs:
 *   1. Refresh the Supabase session cookie (unchanged behaviour).
 *   2. Map an incoming hostname to the school that owns it.
 *   3. Bounce visitors to the right sign-in page:
 *        - unauth /dashboard/*   -> /s/<slug>/login when we know the slug
 *          (via sf_last_school cookie or the Referer), else /login.
 *        - auth   /s/<slug>/login -> the role's portal (via
 *          resolve_login_context) so a signed-in user does not stare at
 *          a sign-in form.
 *
 * Host mapping: a request on a non-platform host belongs to a tenant public
 * website and is rewritten onto /site/tenant/... . App routes
 * (/dashboard, /auth, /api, /s) are never rewritten so staff still reach
 * the app from their own domain.
 *
 * Configure the platform host with NEXT_PUBLIC_PLATFORM_HOST.
 */

const APP_PREFIXES = [
  "/dashboard",
  "/auth",
  "/api",
  "/s/",
  "/site/",
  "/preview-draft",
  "/_next",
  "/favicon.ico",
];

function isPlatformHost(host: string): boolean {
  const h = host.toLowerCase().split(":")[0];
  if (h === "localhost" || h === "127.0.0.1" || h === "0.0.0.0" || h.endsWith(".localhost")) return true;
  if (h.endsWith(".vercel.app") || h.endsWith(".netlify.app")) return true;
  const configured = (process.env.NEXT_PUBLIC_PLATFORM_HOST ?? "").toLowerCase().trim();
  if (configured) {
    if (h === configured || h === `www.${configured}`) return true;
  }
  return false;
}

/** Extract a school slug from a Referer URL that starts with /s/<slug>/. */
function slugFromReferer(referer: string | null): string | null {
  if (!referer) return null;
  try {
    const u = new URL(referer);
    const m = /^\/s\/([^\/]+)(?:\/|$)/.exec(u.pathname);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/** Read a cookie from the raw Cookie header without touching Set-Cookie. */
function readCookie(request: NextRequest, name: string): string | null {
  const c = request.cookies.get(name);
  return c?.value ?? null;
}

const ROLE_TO_DEST: Record<string, string> = {
  admin: "/dashboard",
  teacher: "/dashboard/teaching",
  student: "/dashboard/student-portal",
  parent: "/dashboard/parent-portal",
};

/**
 * When someone signed in visits /s/<slug>/login, look up their role for that
 * school and forward to the right portal. Never leaves them on the form.
 * Silently no-ops if the RPC fails or returns no role - the page will render
 * and the client can handle it.
 */
async function redirectSignedInAwayFromSchoolLogin(
  request: NextRequest,
  slug: string,
): Promise<NextResponse | null> {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookies) {
          cookies.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookies.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );
  try {
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) return null;
    const { data, error } = await supabase.rpc("resolve_login_context", { p_slug: slug });
    if (error || !data) return null;
    const ctx = data as { role?: string | null; redirect?: string | null };
    if (!ctx.role || !ctx.redirect) return null;
    const dest = ROLE_TO_DEST[ctx.role] ?? ctx.redirect ?? "/dashboard";
    const url = request.nextUrl.clone();
    url.pathname = dest;
    url.search = "";
    return NextResponse.redirect(url);
  } catch {
    return null;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";

  if (pathname.startsWith("/_next") || pathname === "/favicon.ico") {
    return NextResponse.next();
  }

  const isAppPath = APP_PREFIXES.some((p) => pathname.startsWith(p));

  const configured = (process.env.NEXT_PUBLIC_PLATFORM_HOST ?? "").toLowerCase().trim();
  const bareHost = host.toLowerCase().split(":")[0];
  const isTenantSubdomain =
    configured !== "" &&
    bareHost.endsWith(`.${configured}`) &&
    bareHost !== `www.${configured}`;

  const belongsToTenant = !isPlatformHost(host) || isTenantSubdomain;

  if (belongsToTenant && !isAppPath) {
    const url = request.nextUrl.clone();
    url.pathname = `/site/tenant${pathname === "/" ? "" : pathname}`;
    return NextResponse.rewrite(url);
  }

  // Auth-aware redirects on app routes.

  // 1. /dashboard/* protected paths: if the user has no auth cookie, send
  //    them to a school-scoped login when we know which school they came
  //    from. Do not run getUser() here - the Edge budget is tight.
  if (pathname.startsWith("/dashboard")) {
    const hasSession =
      request.cookies.has("sb-access-token") ||
      request.cookies.getAll().some((c) => c.name.startsWith("sb-") && c.name.endsWith("-auth-token"));
    if (!hasSession) {
      const slug =
        readCookie(request, "sf_last_school") ||
        slugFromReferer(request.headers.get("referer"));
      const url = request.nextUrl.clone();
      url.pathname = slug ? `/s/${slug}/login` : "/login";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  // 2. /s/<slug>/login while already signed in: forward to their portal.
  const loginMatch = /^\/s\/([^\/]+)\/login\/?$/.exec(pathname);
  if (loginMatch) {
    const slug = loginMatch[1];
    const hasSession =
      request.cookies.has("sb-access-token") ||
      request.cookies.getAll().some((c) => c.name.startsWith("sb-") && c.name.endsWith("-auth-token"));
    if (hasSession) {
      const redirected = await redirectSignedInAwayFromSchoolLogin(request, slug);
      if (redirected) return redirected;
    }
  }

  return await updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
