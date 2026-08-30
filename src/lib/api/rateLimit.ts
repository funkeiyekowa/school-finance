/**
 * Very small in-memory rate limiter for public API endpoints.
 *
 * Scope + limitations:
 *
 *   • In-memory only. On a serverless deployment (Vercel) each
 *     Lambda / edge instance has its own map, so a caller who is
 *     spread across N cold instances can effectively make N × the
 *     limit. That's fine for our threat model — the goal is to
 *     make sustained brute-force calling by a single misconfigured
 *     forwarder cheap to detect, not to enforce hard multi-region
 *     quotas. Upstash or a Redis-backed limiter can replace this
 *     seam later without changing callers.
 *
 *   • Fixed-window buckets. A caller who spikes at the boundary
 *     between windows can burst up to 2× the limit briefly. Again,
 *     acceptable for detection.
 *
 *   • Never throws. If the map somehow grows unbounded (memory
 *     pressure), each check just re-uses the last bucket rather
 *     than crashing the request.
 *
 * Trip events are meant to be logged via `logError()` by the
 * caller so an admin can see them in error_log.
 */

interface Bucket {
  windowStart: number; // ms epoch
  count: number;
}

type LimiterName = "sms-webhook" | "email-webhook" | "alert-test" | "ai-generate" | "ai-test" | "client-error";

const store = new Map<string, Bucket>();

/**
 * Attempt to admit a request. Returns { allowed: true, remaining }
 * if under the limit and increments the counter, or { allowed:
 * false, retryAfterMs, currentCount } if the caller has exceeded
 * their allowance in this window.
 */
export function rateLimit(params: {
  name: LimiterName;
  key: string;
  /** Requests permitted per window, per key. */
  max: number;
  /** Window length in milliseconds. */
  windowMs: number;
}): {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
  currentCount: number;
} {
  const { name, key, max, windowMs } = params;
  const now = Date.now();
  const storeKey = `${name}:${key}`;
  const bucket = store.get(storeKey);

  if (!bucket || now - bucket.windowStart >= windowMs) {
    // New window
    store.set(storeKey, { windowStart: now, count: 1 });
    return {
      allowed: true,
      remaining: Math.max(0, max - 1),
      retryAfterMs: 0,
      currentCount: 1,
    };
  }

  bucket.count += 1;
  const remaining = Math.max(0, max - bucket.count);
  if (bucket.count > max) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: bucket.windowStart + windowMs - now,
      currentCount: bucket.count,
    };
  }
  return {
    allowed: true,
    remaining,
    retryAfterMs: 0,
    currentCount: bucket.count,
  };
}

/**
 * Best-effort caller identity for rate limiting: prefer the
 * forwarded IP, fall back to the immediate remote, fall back to
 * "unknown" (which means one shared bucket for all unknown callers
 * — deliberately strict, so a proxy that strips headers still
 * gets bounded).
 */
export function callerKey(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() || "unknown";
  return request.headers.get("x-real-ip") || "unknown";
}
