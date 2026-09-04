"use client";

/**
 * useDisplayName — resolve a friendly display name for the signed-in user.
 *
 * Students, parents and staff frequently have a synthetic login email
 * (e.g. s124.<org_id>@student.local) AND a profiles.full_name that is just
 * the business code (e.g. "s024") rather than a real name. Showing either
 * of those in the UI is confusing, so this hook resolves the REAL person's
 * name from the role-appropriate table:
 *   students.full_name        (by profile_id)
 *   staff_members.full_name   (by user_id, then email)
 *   parent_profiles.full_name (by profile_id, then email)
 *
 * It is keyed on the authenticated user (auth uid / email) — never on a
 * business code — so it can never resolve across tenants.
 *
 * Precedence: a resolved REAL name always beats a code-like profile name.
 * The hook only short-circuits (no query) when profiles.full_name is already
 * a genuine human name. It NEVER returns the synthetic *.local email or a
 * bare code.
 */

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";

const SYNTHETIC_EMAIL = /@[^@]*\.local$/i;
// Bare business-code shapes we must NOT treat as a real name:
//   s024, S123, STF001, VEN-0001, 12345, s124.<uuid> (synthetic local-part)
const BARE_CODE = /^(?:[a-z]{0,4}[-.]?\d{2,}|stf\d+|ven-?\d+)$/i;

/** Is this string a real person name, or just a code / synthetic id? */
function isCodeLike(name: string, email: string): boolean {
  const n = name.trim();
  if (!n) return true;
  if (BARE_CODE.test(n)) return true;
  // Matches the login email local-part (e.g. profile.full_name === "s024"
  // and email === "s024.<org>@student.local").
  const local = (email.split("@")[0] || "").split(".")[0].toLowerCase();
  if (local && n.toLowerCase() === local) return true;
  // A real name almost always has a space or is clearly alphabetic and
  // longer than a code; a single token with digits is code-like.
  if (/\d/.test(n) && !/\s/.test(n)) return true;
  return false;
}

export function useDisplayName(): string {
  const { user, profile } = useAuth();
  const [resolved, setResolved] = useState<string | null>(null);

  const profileName = (profile?.full_name || "").trim();
  const email = profile?.email || user?.email || "";
  const synthetic = SYNTHETIC_EMAIL.test(email);
  const profileNameIsReal = !isCodeLike(profileName, email);

  useEffect(() => {
    let cancelled = false;
    setResolved(null);
    if (!user) return;
    // Only skip the lookup when the profile already has a genuine name.
    if (profileNameIsReal) return;

    const supabase = createClient();
    (async () => {
      const pick = <T,>(d: T | null) => {
        const v = (d as { full_name?: string } | null)?.full_name?.trim();
        // Guard against the child table ALSO storing a code.
        return v && !isCodeLike(v, email) ? v : undefined;
      };

      let name: string | undefined;
      const s = await supabase.from("students").select("full_name").eq("profile_id", user.id).limit(1).maybeSingle();
      name = pick(s.data);

      if (!name) {
        const st = await supabase.from("staff_members").select("full_name").eq("user_id", user.id).limit(1).maybeSingle();
        name = pick(st.data);
      }
      if (!name && user.email) {
        const st2 = await supabase.from("staff_members").select("full_name").ilike("email", user.email).limit(1).maybeSingle();
        name = pick(st2.data);
      }
      if (!name) {
        const p = await supabase.from("parent_profiles").select("full_name").eq("profile_id", user.id).limit(1).maybeSingle();
        name = pick(p.data);
      }
      if (!name && user.email) {
        const p2 = await supabase.from("parent_profiles").select("full_name").ilike("email", user.email).limit(1).maybeSingle();
        name = pick(p2.data);
      }

      if (!cancelled && name) setResolved(name);
    })();
    return () => { cancelled = true; };
  }, [user, profileNameIsReal, email]);

  // Precedence:
  //   1. a genuine profiles.full_name
  //   2. the resolved real name from the role table
  //   3. a non-synthetic email local-part (real emails only)
  //   4. "Account" — never the code / synthetic id
  if (profileNameIsReal) return profileName;
  if (resolved) return resolved;
  if (!synthetic && email) {
    const local = email.split("@")[0];
    if (!isCodeLike(local, email)) return local;
  }
  return "Account";
}
