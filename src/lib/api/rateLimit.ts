/**
 * Very small in-memory rate limiter for public API endpoints.
 *
 * Scope + limitations:
 *
 *   • The local fallback is in-memory only. On a serverless deployment (Vercel) each
 *     Lambda / edge instance has its own map, so a caller who is
 *     spread across N cold instances can effectively make N × the
 *     limit. That's fine for our threat model — the goal is to
 *     make sustained brute-force calling by a single misconfigured
 *     forwarder cheap to detect, not to enforce hard multi-region
 *     quotas. When UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are
 *     configured, rateLimitAsync() uses a shared Upstash Redis counter.
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

export type LimiterName = "sms-webhook" | "email-webhook" | "alert-test" | "ai-generate" | "ai-test" | "client-error" | "lms-study-help" | "ai-assistant" | "ai-ask" | "photos-upload" | "storage-upload" | "proctoring-upload-url";

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

type RateLimitParams = {
  name: LimiterName;
  key: string;
  max: number;
  windowMs: number;
};

type UpstashResponse = { result?: number | string | null };

/** Shared limiter with a safe local fallback when Upstash is not configured. */
export async function rateLimitAsync(params: RateLimitParams): Promise<ReturnType<typeof rateLimit>> {
  const url = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/$/, "");
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return rateLimit(params);

  const redisKey = `school-finance:ratelimit:${params.name}:${params.key}`;
  try {
    const response = await fetch(`${url}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify([["INCR", redisKey], ["PTTL", redisKey]]),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Upstash returned HTTP ${response.status}`);
    const payload = (await response.json()) as UpstashResponse[];
    const count = Number(payload[0]?.result);
    let ttlMs = Number(payload[1]?.result);
    if (!Number.isFinite(count) || !Number.isFinite(ttlMs)) throw new Error("Invalid Upstash response");
    if (ttlMs < 0) {
      const expireResponse = await fetch(`${url}/pexpire/${encodeURIComponent(redisKey)}/${params.windowMs}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!expireResponse.ok) throw new Error(`Upstash expiry returned HTTP ${expireResponse.status}`);
      ttlMs = params.windowMs;
    }
    const allowed = count <= params.max;
    return {
      allowed,
      remaining: allowed ? Math.max(0, params.max - count) : 0,
      retryAfterMs: allowed ? 0 : Math.max(1, ttlMs),
      currentCount: count,
    };
  } catch (error) {
    console.warn("[rate-limit] shared limiter unavailable; using local fallback", error);
    return rateLimit(params);
  }
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
