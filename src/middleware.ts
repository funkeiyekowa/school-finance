import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Two jobs:
 *   1. Refresh the Supabase session cookie (unchanged behaviour).
 *   2. Map an incoming hostname to the school that owns it.
 *
 * Host mapping rule: if the request arrives on a host that is NOT the platform
 * host, it belongs to a tenant's public website, so it is rewritten onto
 * /site/tenant/... where the tenant is resolved from the Host header.
 *
 * Application routes (/dashboard, /auth, /api, /s) are never rewritten, so a
 * school's staff can still reach the app from their own domain.
 *
 * Configure the platform host with NEXT_PUBLIC_PLATFORM_HOST, e.g.
 * "schoolsuite.com". Without it, only localhost and *.vercel.app are treated
 * as platform hosts.
 */

/** Paths that always belong to the application, never to a tenant site. */
const APP_PREFIXES = [
  "/dashboard",
  "/auth",
  "/api",
  "/s/",          // slug-addressed public sites
  "/site/",       // internal rewrite target
  "/preview-draft", // studio draft preview (no sidebar)
  "/_next",
  "/favicon.ico",
];

function isPlatformHost(host: string): boolean {
  const h = host.toLowerCase().split(":")[0];

  if (h === "localhost" || h === "127.0.0.1" || h === "0.0.0.0" || h.endsWith(".localhost")) {
    return true;
  }
  // Preview deployments
  if (h.endsWith(".vercel.app") || h.endsWith(".netlify.app")) return true;

  const configured = (process.env.NEXT_PUBLIC_PLATFORM_HOST ?? "").toLowerCase().trim();
  if (configured) {
    if (h === configured || h === `www.${configured}`) return true;
    // A tenant subdomain of the platform host is still a tenant site, so it
    // must NOT be treated as the platform host here.
  }

  return false;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";

  // Static assets slip through the matcher occasionally — bail instantly.
  if (pathname.startsWith("/_next") || pathname === "/favicon.ico") {
    return NextResponse.next();
  }

  const isAppPath = APP_PREFIXES.some(p => pathname.startsWith(p));

  const configured = (process.env.NEXT_PUBLIC_PLATFORM_HOST ?? "").toLowerCase().trim();
  const bareHost = host.toLowerCase().split(":")[0];
  const isTenantSubdomain =
    configured !== "" &&
    bareHost.endsWith(`.${configured}`) &&
    bareHost !== `www.${configured}`;

  const belongsToTenant = !isPlatformHost(host) || isTenantSubdomain;

  // Tenant's public website: rewrite, no session refresh needed.
  if (belongsToTenant && !isAppPath) {
    const url = request.nextUrl.clone();
    url.pathname = `/site/tenant${pathname === "/" ? "" : pathname}`;
    return NextResponse.rewrite(url);
  }

  // App routes: refresh session only for protected paths (/dashboard, etc.)
  // updateSession skips the network call for /auth, /s and other public paths.
  return await updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
