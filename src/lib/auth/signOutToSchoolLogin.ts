/**
 * signOutToSchoolLogin
 *
 * Read the last-known school slug from the `sf_last_school` cookie and
 * navigate the user to the login screen they came in through.
 *
 * A second cookie `sf_last_portal` records which portal they logged in
 * through — `staff` or `student`. Sign-out then returns them to the
 * matching entry point:
 *   - staff   -> /s/<slug>/staff-portal
 *   - student -> /s/<slug>/login       (student + parent share this form)
 *
 * Both cookies are written by the login forms on successful sign-in.
 * When neither is known, we fall back to /login.
 */

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

export function readLastSchoolSlug(): string | null {
  if (typeof document === "undefined") return null;
  try {
    const match = document.cookie.match(/(?:^|;\s*)sf_last_school=([^;]+)/);
    if (!match) return null;
    const raw = decodeURIComponent(match[1] ?? "").trim().toLowerCase();
    if (!raw || !SLUG_RE.test(raw)) return null;
    return raw;
  } catch {
    return null;
  }
}

export function readLastPortal(): "staff" | "student" | null {
  if (typeof document === "undefined") return null;
  try {
    const m = document.cookie.match(/(?:^|;\s*)sf_last_portal=([^;]+)/);
    if (!m) return null;
    const raw = decodeURIComponent(m[1] ?? "").trim().toLowerCase();
    if (raw === "staff" || raw === "student") return raw;
    return null;
  } catch {
    return null;
  }
}

/** Write the sf_last_portal cookie. Called by both login forms on success. */
export function writeLastPortal(portal: "staff" | "student"): void {
  if (typeof document === "undefined") return;
  try {
    document.cookie = `sf_last_portal=${portal}; path=/; max-age=${60 * 60 * 24 * 90}; samesite=lax`;
  } catch {
    // cookies disabled — non-fatal
  }
}

export function schoolLoginPathForCookie(): string {
  const slug = readLastSchoolSlug();
  if (!slug) return "/login";
  const portal = readLastPortal();
  return portal === "staff" ? `/s/${slug}/staff-portal` : `/s/${slug}/login`;
}

/**
 * Perform the redirect. Uses location.assign so any lingering in-memory
 * auth state from the previous session is guaranteed cleared.
 */
export function signOutToSchoolLogin(): void {
  if (typeof window === "undefined") return;
  window.location.assign(schoolLoginPathForCookie());
}
