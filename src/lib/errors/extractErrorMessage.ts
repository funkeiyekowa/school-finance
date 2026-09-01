/**
 * Extracts a human-readable message from an unknown thrown value.
 *
 * Supabase/PostgREST errors are PLAIN OBJECTS (`{ message, details, hint,
 * code }`), not JS `Error` instances -- so `err instanceof Error` is always
 * false for them, and code that falls back to a generic string on that
 * check silently discards the real database error message. This happened
 * in SeedDataPanel.tsx (masking real seed/delete failures behind "Failed to
 * seed data") and again in usePaginatedData.ts (masking a real
 * staff_paginated/students_paginated error behind "Unknown error" while the
 * page rendered an indistinguishable "no results" empty state).
 *
 * Use this instead of `e instanceof Error ? e.message : fallback` anywhere
 * a Supabase call's thrown/rejected value is being turned into UI text.
 */
export function extractErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    const e = err as { message?: string; details?: string; hint?: string; code?: string };
    const parts = [e.message, e.details, e.hint].filter(Boolean);
    if (parts.length > 0) return parts.join(" — ") + (e.code ? ` (${e.code})` : "");
  }
  return fallback;
}
