import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      `Supabase environment variables are missing. URL: ${url ? "set" : "MISSING"}, Key: ${key ? "set" : "MISSING"}`
    );
  }

  return createBrowserClient(url, key);
}
