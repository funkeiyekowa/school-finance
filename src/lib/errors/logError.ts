/**
 * Structured error logging seam.
 *
 * Callers use this in place of `console.error(...)` in server-side
 * paths (API routes, webhooks) and in error boundaries. It records
 * errors in three places, whichever apply:
 *
 *   1. Console — always, so local development sees stack traces.
 *   2. `public.error_log` table via the service-role Supabase
 *      client — persists errors so an admin can review recent
 *      failures inside the app.
 *   3. Sentry (or another APM) — if `NEXT_PUBLIC_SENTRY_DSN` is
 *      set, this delegates to a lazy-loaded @sentry/nextjs. Adding
 *      the SDK is a follow-up; the seam is here so wiring is a
 *      config change rather than a code change.
 *
 * The function best-efforts the DB write and never throws, so a
 * logger failure cannot cascade into a webhook 500 or a broken
 * error boundary.
 */

import { createClient as createBrowserClient } from "@supabase/supabase-js";

export type ErrorSeverity = "error" | "warn" | "info";

export interface LogErrorOptions {
  /** Which subsystem raised this — e.g. "sms-webhook", "ui:global-error". */
  source: string;
  /** Freeform error message. Required. */
  message: string;
  /** Full JS stack when available. */
  stack?: string | null;
  /** Arbitrary structured context (never secrets). */
  context?: Record<string, unknown> | null;
  /** Defaults to "error". */
  severity?: ErrorSeverity;
  /** HTTP request path — populated automatically when a Request is passed. */
  requestPath?: string | null;
  /** Source IP if available (Vercel sets x-forwarded-for). */
  requestIp?: string | null;
  /** User-agent header if available. */
  userAgent?: string | null;
  /** Owning organization when known — helps per-tenant filtering. */
  organizationId?: string | null;
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

/**
 * A cached service-role client. Reused across invocations of the
 * same server process; a fresh one is created only if the module
 * is torn down. This is safe — the service-role key is only ever
 * loaded from env and never rotated at runtime.
 */
let cachedClient: ReturnType<typeof createBrowserClient> | null = null;
function serviceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null;
  if (!cachedClient) {
    cachedClient = createBrowserClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { "x-application-name": "school-finance/logError" } },
    });
  }
  return cachedClient;
}

/**
 * Best-effort structured log. Awaits the DB write when called with
 * `await` so callers who want to be sure the row landed can wait;
 * otherwise fire-and-forget is fine.
 */
export async function logError(opts: LogErrorOptions): Promise<void> {
  const severity: ErrorSeverity = opts.severity ?? "error";

  // 1. Always echo to console — Vercel/CI still collects this.
  const consoleMethod =
    severity === "error" ? console.error : severity === "warn" ? console.warn : console.log;
  consoleMethod(`[${opts.source}] ${opts.message}`, {
    stack: opts.stack,
    context: opts.context,
  });

  // 2. Persist to Supabase. Never throw from here — swallow every
  //    error and log it to the console instead, so a broken logger
  //    can't crash the caller's happy path.
  const client = serviceClient();
  if (client) {
    try {
      // Typed as `never[]` by the untyped createClient overload;
      // the row shape matches the error_log table exactly.
      await (client.from("error_log") as unknown as {
        insert: (row: Record<string, unknown>) => Promise<unknown>;
      }).insert({
        organization_id: opts.organizationId ?? null,
        source: opts.source,
        severity,
        message: opts.message,
        stack: opts.stack ?? null,
        context: opts.context ?? {},
        request_ip: opts.requestIp ?? null,
        request_path: opts.requestPath ?? null,
        user_agent: opts.userAgent ?? null,
      });
    } catch (dbErr) {
      console.error("[logError] failed to persist:", dbErr);
    }
  }

  // 3. Forward to Sentry when configured.
  //
  // Only takes effect if the app is running in a context where
  // Sentry has already been initialised globally — e.g. via
  // `Sentry.init(...)` in a `sentry.server.config.ts` that the
  // hosting environment loads. We check for `Sentry.captureException`
  // on the runtime globalThis to avoid a static import of
  // `@sentry/nextjs` (which would force it to be a hard dependency
  // and fail the build for anyone not using Sentry).
  //
  // To wire real Sentry: `npm install @sentry/nextjs`, run
  // `npx @sentry/wizard@latest -i nextjs`, then set
  // NEXT_PUBLIC_SENTRY_DSN. No changes to this file are required.
  if (process.env.NEXT_PUBLIC_SENTRY_DSN && severity === "error") {
    try {
      const g = globalThis as unknown as {
        Sentry?: { captureException?: (e: unknown, ctx?: unknown) => void };
      };
      if (g.Sentry?.captureException) {
        const error = new Error(opts.message);
        if (opts.stack) error.stack = opts.stack;
        g.Sentry.captureException(error, {
          tags: { source: opts.source, severity },
          extra: opts.context ?? {},
        });
      }
    } catch (sentryErr) {
      console.error("[logError] sentry forward failed:", sentryErr);
    }
  }
}

/**
 * Convenience helper to build LogErrorOptions from an incoming
 * Request. Pulls request-specific fields (path, IP, UA) so
 * callers don't repeat themselves.
 */
export function requestContext(request: Request): Pick<LogErrorOptions, "requestPath" | "requestIp" | "userAgent"> {
  const url = new URL(request.url);
  return {
    requestPath: url.pathname,
    requestIp:
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip") ??
      null,
    userAgent: request.headers.get("user-agent"),
  };
}
