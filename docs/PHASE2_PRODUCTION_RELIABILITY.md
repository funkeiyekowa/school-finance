# Phase 2 — Production Reliability

## Shared rate limiting

API rate limits now use `rateLimitAsync()`. When both `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are configured, counters are shared across Vercel instances through Upstash Redis. If either variable is absent or the service is temporarily unavailable, the existing in-process limiter is used as a safe fallback and a warning is emitted.

AI endpoints enforce both IP and authenticated-user buckets where a user identity is available. Webhooks, uploads, and the client-error sink retain IP protection because they can be unauthenticated.

No external service or credential was provisioned by this change. To enable distributed limits, create an Upstash Redis database and add the two variables to Vercel/local environments.

## File upload security

The profile-photo, website-media, message-attachment, and proctoring URL paths now apply server-side size limits, MIME allowlists, magic-byte/content checks, safe filenames, and bounded path segments. Executable extensions are never preserved from the client filename; the stored extension is derived from the validated MIME type. Website media and private message attachments remain rooted under the authenticated organization, and conversation membership is checked before a message attachment is written.

Proctoring still uses a direct signed upload URL to avoid the Vercel request-body limit. The API validates the declared chunk size, recording type, attempt ownership, organization, and active attempt state before issuing the URL. Supabase Storage cannot inspect the bytes after a direct signed upload in this route, so live verification of bucket policies and provider-side content enforcement remains outstanding.

## Webhook security

SMS and email webhooks continue to authenticate against the per-school shared secret using constant-time comparison, reject duplicate secrets across schools, apply IP rate limits, and record authorization/rate-limit/processing failures through the structured error logger. If a provider sends `x-webhook-timestamp`, it is now required to be within a five-minute replay window. The header is optional for backwards compatibility with the existing SMS gateway and Gmail Apps Script integrations, which currently provide a shared secret rather than a signed-body HMAC. No provider credentials or secrets were changed.

## Bootstrap and mutation error handling

The Phase 1 bootstrap fix remains in force: a first authenticated user is not made an administrator by client-side or dashboard logic. Organization membership and role grants remain the onboarding boundary.

Leads, Staff, Inventory, and Timetable now surface initial-load failures instead of silently rendering empty data. Existing mutation paths already checked Supabase errors; the remaining load/RPC calls now capture and display their errors so an RLS or network failure is actionable.

## Production observability

High-value failures use the existing `logError()` seam, which writes structured rows to `public.error_log` when the service key is available and always emits a server log. Webhook authentication/rate-limit/processing errors and storage upload failures include request path, IP, user-agent, tenant (when known), and safe contextual fields. AI completion usage remains recorded by `ai_generation_log` with provider, model, token counts, and elapsed time. No secret values, file contents, or request bodies are logged.

## Verification boundary

The shared limiter path is covered by static/unit checks and safe fallback behavior. Live multi-instance enforcement requires a configured Upstash database and a deployment test; that external verification remains outstanding. Live Supabase Storage signature enforcement, real provider replay/signature behavior, production Vercel environment configuration, and role-specific live account tests were not performed here.
