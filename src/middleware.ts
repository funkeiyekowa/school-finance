import { NextResponse, type NextRequest } from "next/server";
import { updateSession, resolveExamLock } from "@/lib/supabase/middleware";

/**
 * Minimal edge middleware.
 *
 * Vercel Edge Middleware has a hard 25-second execution budget per
 * request. A previous version issued 2 Supabase round-trips on every
 * request (updateSession + resolve_login_context), which meant one
 * slow Postgres reply produced a MIDDLEWARE_INVOCATION_TIMEOUT 504
 * for the whole request. This version:
 *
 *   • Never calls a Postgres RPC in the middleware. Signed-in
 *     redirects off /s/<slug>/login are done client-side by the
 *     login page itself.
 *   • Only calls Supabase (updateSession) for /dashboard/* — the
 *     one path where session refresh actually matters. Public
 *     routes, /_next, static assets, /site/tenant, /s/<slug>/login,
 *     the landing page, and every /api/* route skip Supabase.
 *   • Wraps the one Supabase call in an 8-second timeout so a
 *     hanging session refresh returns immediately instead of
 *     dragging the whole request over the 25 s edge limit.
 *   • Still handles tenant-subdomain rewrites and unauth-redirect
 *     for /dashboard/* (cookie sniff only).
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

function slugFromReferer(referer: string | null): string | null {
  if (!referer) return null;
  try {
    const u = new URL(referer);
    const m = /^\/s\/([^/]+)(?:\/|$)/.exec(u.pathname);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function readCookie(request: NextRequest, name: string): string | null {
  return request.cookies.get(name)?.value ?? null;
}

function hasSupabaseSession(request: NextRequest): boolean {
  if (request.cookies.has("sb-access-token")) return true;
  for (const c of request.cookies.getAll()) {
    if (c.name.startsWith("sb-") && c.name.endsWith("-auth-token")) return true;
  }
  return false;
}

/** Wrap a promise with a hard timeout so the edge budget is never exceeded. */
function withTimeout(p: Promise<NextResponse>, ms: number): Promise<NextResponse | null> {
  return Promise.race([
    p,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

/** Generic hard-timeout wrapper (returns `fallback` if `p` doesn't settle). */
function withTimeoutT<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

/** True when the pathname is the take page for the given exam (the one route
 *  a locked student is allowed to see). */
function isActiveExamTakePath(pathname: string, examId: string): boolean {
  return pathname === `/dashboard/cbt/${examId}/take`;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";

  // Fast-path static assets.
  if (pathname.startsWith("/_next") || pathname === "/favicon.ico") {
    return NextResponse.next();
  }

  const isAppPath = APP_PREFIXES.some((p) => pathname.startsWith(p));

  // Tenant subdomain rewrite — only for non-app paths on non-platform hosts.
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

  // /dashboard/* — unauth cookie sniff (no Supabase call) then session refresh.
  if (pathname.startsWith("/dashboard")) {
    if (!hasSupabaseSession(request)) {
      const slug =
        readCookie(request, "sf_last_school") ||
        slugFromReferer(request.headers.get("referer"));
      const url = request.nextUrl.clone();
      url.pathname = slug ? `/s/${slug}/login` : "/login";
      url.search = "";
      return NextResponse.redirect(url);
    }

    // Perf: skip the server-side session refresh for prefetches and
    // soft (RSC) navigations. These fire constantly as the user hovers
    // and clicks links, and each one used to trigger a getUser() network
    // round-trip to Supabase auth — the main cause of laggy/hanging
    // navigation. They don't need it: dashboard pages are client-rendered
    // and the browser Supabase client auto-refreshes its own token, and
    // the server auth gate in dashboard/layout.tsx only runs on full
    // document loads anyway. So we only pay the refresh cost on a real
    // document navigation (hard load / refresh), and even then cap it at
    // 3 s so a slow auth reply can never hang the request.
    const isPrefetch =
      request.headers.get("next-router-prefetch") === "1" ||
      request.headers.get("purpose") === "prefetch";
    const isRscNav = request.headers.get("rsc") === "1";
    if (isPrefetch || isRscNav) {
      return NextResponse.next();
    }

    const refreshed = await withTimeout(updateSession(request), 3000);

    // ---- EXAM LOCK (server-authoritative) ----
    // On a real document load into /dashboard/*, if the signed-in user is a
    // student with an in-progress CBT attempt, they may ONLY be on that
    // exam's take page. Any other dashboard URL (typed, new tab, back/forward,
    // a stale link) is redirected straight to the active exam — the requested
    // page is never rendered. The check is one indexed, cookie-authed RPC,
    // hard-capped at 2s and fail-open (a slow/absent RPC never locks anyone
    // out; the client-side shell guard is the backstop).
    const lockedExamId = await withTimeoutT(resolveExamLock(request), 2000, null);
    if (lockedExamId && !isActiveExamTakePath(pathname, lockedExamId)) {
      const url = request.nextUrl.clone();
      url.pathname = `/dashboard/cbt/${lockedExamId}/take`;
      url.search = "";
      return NextResponse.redirect(url);
    }

    return refreshed ?? NextResponse.next();
  }

  // Everything else: no Supabase touch, no timeout, no risk.
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
