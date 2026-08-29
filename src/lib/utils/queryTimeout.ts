/**
 * withTimeout — resolve a promise or reject after `ms` milliseconds.
 *
 * Supabase queries can, in rare conditions (dropped socket, RLS
 * recursion, a paused project waking up), hang without ever resolving.
 * A page whose load() awaits such a query sits on its loading spinner
 * forever. Wrapping the await in withTimeout converts an indefinite
 * hang into a fast, catchable rejection so the page can show an error
 * and a retry instead of an eternal skeleton.
 *
 * Usage:
 *   try {
 *     const res = await withTimeout(supabase.from("x").select("*"), 12000);
 *   } catch (e) {
 *     setError("Taking too long — check your connection and retry.");
 *   }
 *
 * Note: Supabase's PostgrestBuilder is thenable, so `Promise.resolve`
 * coerces it correctly. The underlying request is not actually
 * cancelled (fetch has no abort wired here) — we simply stop waiting on
 * it, which is what unblocks the UI.
 */
export class QueryTimeoutError extends Error {
  constructor(ms: number) {
    super(`Request timed out after ${ms}ms`);
    this.name = "QueryTimeoutError";
  }
}

export function withTimeout<T>(promise: PromiseLike<T>, ms = 12000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new QueryTimeoutError(ms)), ms);
    Promise.resolve(promise).then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}
