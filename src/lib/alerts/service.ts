/**
 * Server-side helpers for the unauthenticated alert endpoints.
 *
 * These routes are called by external systems (the SMS gateway and the
 * Gmail Apps Script), so they can't rely on a user session. They use the
 * service-role key and authenticate callers with a shared secret instead.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role client — bypasses RLS. Never expose to the browser.
 *
 * IMPORTANT: no silent fallback to the anon key. A route that expects
 * service-role privilege but runs with anon privilege silently fails in
 * dangerous ways: it will succeed against tables where an RLS policy
 * happens to let anon through, and quietly do nothing everywhere else,
 * producing hard-to-diagnose bugs. Better to throw at boot so a
 * misconfigured deploy is caught on the very first request.
 */
export function createServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
  if (!serviceKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. This route requires the " +
      "service-role key; refusing to fall back to the anon key. Add it to " +
      "the environment (Supabase → Project Settings → API → service_role)."
    );
  }
  return createClient(url, serviceKey);
}

/**
 * Read the caller's shared secret from either a header or the request body.
 * Apps Script can set headers, but allowing a body field keeps manual
 * testing with curl simple.
 */
export function extractSecret(
  request: Request,
  body?: Record<string, unknown> | null
): string | null {
  const header =
    request.headers.get("x-webhook-secret") ||
    request.headers.get("x-api-key") ||
    null;
  if (header) return header.trim();

  const auth = request.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();

  const url = new URL(request.url);
  const fromQuery = url.searchParams.get("secret");
  if (fromQuery) return fromQuery.trim();

  const fromBody = body?.secret;
  return typeof fromBody === "string" ? fromBody.trim() : null;
}

/**
 * Constant-time string comparison.
 * A plain `===` on a secret leaks length and position information through
 * timing, so compare every character regardless of early mismatches.
 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export interface SecretCheck {
  ok: boolean;
  status: number;
  message?: string;
  settings?: Record<string, unknown>;
}

async function verifySchoolSecret(
  supabase: SupabaseClient,
  provided: string | null,
  column: "email_webhook_secret" | "sms_webhook_secret",
  channel: "Email" | "SMS"
): Promise<SecretCheck> {
  if (!provided) {
    return { ok: false, status: 401, message: "Invalid or missing webhook secret." };
  }

  // The service role bypasses RLS, so never use `.limit(1)` here: that would
  // bind every webhook to whichever school's settings row Postgres returned
  // first. Compare against every configured tenant and return only the row
  // whose secret authenticated this request.
  const { data, error } = await supabase
    .from("school_settings")
    .select("*")
    .not(column, "is", null);

  if (error) {
    return { ok: false, status: 500, message: "School settings could not be loaded." };
  }

  const matches = (data ?? []).filter(row => {
    const expected = (row as Record<string, unknown>)[column];
    return typeof expected === "string" && safeEqual(provided, expected);
  });

  if (matches.length === 0) {
    return { ok: false, status: 401, message: "Invalid or missing webhook secret." };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      status: 409,
      message: `${channel} webhook secret is assigned to more than one school. Generate a unique secret for each school.`,
    };
  }

  const settings = matches[0] as Record<string, unknown>;
  if (typeof settings.organization_id !== "string") {
    return { ok: false, status: 500, message: "School settings are missing an organization." };
  }

  return { ok: true, status: 200, settings };
}

/**
 * Verify the caller's secret against `school_settings.email_webhook_secret`
 * and return the settings row so callers don't need a second query.
 */
export async function verifyEmailSecret(
  supabase: SupabaseClient,
  provided: string | null
): Promise<SecretCheck> {
  return verifySchoolSecret(supabase, provided, "email_webhook_secret", "Email");
}

/**
 * Same, for SMS gateway callers.
 * `school_settings.sms_webhook_secret` is set from Setup → SMS Alerts.
 */
export async function verifySmsSecret(
  supabase: SupabaseClient,
  provided: string | null
): Promise<SecretCheck> {
  return verifySchoolSecret(supabase, provided, "sms_webhook_secret", "SMS");
}
