import { createBrowserClient, type CookieOptions } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser-side Supabase client.
 *
 * The old implementation created a fresh Supabase client on every call
 * to createClient(). Every page had 3-6 components each calling it in
 * their render body, which meant on every mount:
 *   - a new fetch listener chain,
 *   - a new auth subscription,
 *   - a new storage adapter,
 * and none of the query cache carried across renders. That's the biggest
 * lever we had on client-side latency.
 *
 * The fix is a module-scope singleton keyed by URL. The browser only ever
 * uses ONE Supabase client for the lifetime of the tab, which lets:
 *   - the shared auth session survive component remounts,
 *   - the fetch layer reuse HTTP/2 connections and warm DNS,
 *   - the storage adapter avoid re-reading cookies on every render.
 */
let _client: SupabaseClient | null = null;

export function createClient(): SupabaseClient {
  if (_client) return _client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      `Supabase env vars missing. URL: ${url ? "set" : "MISSING"}, Key: ${key ? "set" : "MISSING"}`
    );
  }

  _client = createBrowserClient(url, key);
  return _client;
}

/** Exposed so tests / dev overrides can nuke the singleton. Not used in prod. */
export function __resetClient() {
  _client = null;
}
