/**
 * Server-side helpers for the unauthenticated alert endpoints.
 *
 * These routes are called by external systems (the SMS gateway and the
 * Gmail Apps Script), so they can't rely on a user session. They use the
 * service-role key and authenticate callers with a shared secret instead.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Service-role client — bypasses RLS. Never expose to the browser. */
export function createServiceClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
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

/**
 * Verify the caller's secret against `school_settings.email_webhook_secret`
 * and return the settings row so callers don't need a second query.
 */
export async function verifyEmailSecret(
  supabase: SupabaseClient,
  provided: string | null
): Promise<SecretCheck> {
  const { data, error } = await supabase
    .from("school_settings")
    .select("*")
    .limit(1)
    .single();

  if (error || !data) {
    return { ok: false, status: 500, message: "School settings not found." };
  }

  const settings = data as Record<string, unknown>;
  const expected = settings.email_webhook_secret as string | null;

  if (!expected) {
    return {
      ok: false,
      status: 503,
      message:
        "Email alerts are not configured yet. Open Setup → Email Alerts and generate a secret.",
    };
  }
  if (!provided || !safeEqual(provided, expected)) {
    return { ok: false, status: 401, message: "Invalid or missing webhook secret." };
  }

  return { ok: true, status: 200, settings };
}
