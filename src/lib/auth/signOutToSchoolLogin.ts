/**
 * signOutToSchoolLogin
 *
 * Read the last-known school slug from the `sf_last_school` cookie and
 * navigate the user to `/s/<slug>/login`. Falls back to `/login` when we
 * do not know which school this browser most recently used.
 *
 * The cookie is written by /s/[slug]/login/LoginForm.tsx on successful
 * sign-in, so a returning user always lands back at THEIR school's login
 * screen — which is what Mrs Abudu expects when she signs out.
 *
 * This helper does NOT sign the user out itself. Callers that already
 * hold a Supabase client (e.g. AuthContext.signOut) should call
 * supabase.auth.signOut() first, then this helper for the redirect.
 * Callers that just want the redirect can use it standalone.
 */
export function readLastSchoolSlug(): string | null {
  if (typeof document === "undefined") return null;
  try {
    const match = document.cookie.match(/(?:^|;\s*)sf_last_school=([^;]+)/);
    if (!match) return null;
    const raw = decodeURIComponent(match[1] ?? "").trim().toLowerCase();
    if (!raw) return null;
    // Defensive: cookie values live in the URL path, so keep it slug-safe.
    if (!/^[a-z0-9][a-z0-9-]*$/.test(raw)) return null;
    return raw;
  } catch {
    return null;
  }
}

export function schoolLoginPathForCookie(): string {
  const slug = readLastSchoolSlug();
  return slug ? `/s/${slug}/login` : "/login";
}

/**
 * Perform the redirect. Uses a hard navigation (location.assign) so any
 * in-memory auth state from the previous session is guaranteed cleared.
 */
export function signOutToSchoolLogin(): void {
  if (typeof window === "undefined") return;
  window.location.assign(schoolLoginPathForCookie());
}
