"use client";

/**
 * useDisplayName — resolve a friendly display name for the signed-in user.
 *
 * Students, parents and staff frequently have no profiles.full_name and a
 * synthetic login email (e.g. s124.<org_id>@student.local). Showing that
 * identifier in the UI is confusing, so this hook resolves the REAL person's
 * name from the role-appropriate table:
 *   students.full_name       (by profile_id)
 *   staff_members.full_name  (by user_id, then email)
 *   parent_profiles.full_name(by profile_id, then email)
 *
 * It is keyed on the authenticated user (auth uid / email) — never on a
 * business code — so it can never resolve across tenants. When the profile
 * already carries a good name, no extra query is made.
 *
 * Returns a name that is guaranteed NOT to be the synthetic *.local email.
 */

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";

const SYNTHETIC_EMAIL = /@[^@]*\.local$/i;

export function useDisplayName(): string {
  const { user, profile } = useAuth();
  const [resolved, setResolved] = useState<string | null>(null);

  const profileName = (profile?.full_name || "").trim();
  const email = profile?.email || user?.email || "";
  const synthetic = SYNTHETIC_EMAIL.test(email);

  useEffect(() => {
    let cancelled = false;
    setResolved(null);
    if (!user) return;
    // Profile already has a usable, non-synthetic name — nothing to fetch.
    if (profileName && !synthetic) return;

    const supabase = createClient();
    (async () => {
      const first = <T,>(d: T | null) => (d as { full_name?: string } | null)?.full_name?.trim();

      let name: string | undefined;
      const s = await supabase.from("students").select("full_name").eq("profile_id", user.id).limit(1).maybeSingle();
      name = first(s.data);

      if (!name) {
        const st = await supabase.from("staff_members").select("full_name").eq("user_id", user.id).limit(1).maybeSingle();
        name = first(st.data);
      }
      if (!name && user.email) {
        const st2 = await supabase.from("staff_members").select("full_name").ilike("email", user.email).limit(1).maybeSingle();
        name = first(st2.data);
      }
      if (!name) {
        const p = await supabase.from("parent_profiles").select("full_name").eq("profile_id", user.id).limit(1).maybeSingle();
        name = first(p.data);
      }
      if (!name && user.email) {
        const p2 = await supabase.from("parent_profiles").select("full_name").ilike("email", user.email).limit(1).maybeSingle();
        name = first(p2.data);
      }

      if (!cancelled && name) setResolved(name);
    })();
    return () => { cancelled = true; };
  }, [user, profileName, synthetic]);

  return (
    profileName ||
    resolved ||
    (synthetic ? "" : email.split("@")[0]) ||
    "Account"
  );
}
