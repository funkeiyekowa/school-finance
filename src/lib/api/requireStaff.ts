import { createClient } from "@/lib/supabase/server";

/**
 * Guard for API routes that should only accept requests from a
 * signed-in staff member (owner/admin/editor/staff/bursar/accountant/
 * teacher/developer/super_admin). Returns a Response to short-circuit
 * on failure, or null when the caller may proceed.
 *
 * Usage:
 *
 *   const guard = await requireStaffSession();
 *   if (guard) return guard;
 *   // ... proceed
 */
export async function requireStaffSession(): Promise<Response | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }

  const [{ data: memberships }, { data: profile }] = await Promise.all([
    supabase
      .from("org_memberships")
      .select("role")
      .eq("user_id", user.id)
      .eq("active", true),
    supabase
      .from("profiles")
      .select("role, active")
      .eq("id", user.id)
      .maybeSingle(),
  ]);

  const staffRoles = new Set([
    "owner", "admin", "editor", "staff", "bursar", "accountant",
    "teacher", "developer", "super_admin", "viewer",
  ]);
  const membershipRole = (memberships ?? []).map((m: { role: string }) => m.role);
  const profileRole = (profile as { role?: string; active?: boolean } | null)?.role;
  const profileActive = (profile as { active?: boolean } | null)?.active ?? true;

  const isStaff =
    membershipRole.some(r => staffRoles.has(r)) ||
    (profileRole ? staffRoles.has(profileRole) && profileActive : false);

  if (!isStaff) {
    return Response.json({ error: "Not authorized." }, { status: 403 });
  }
  return null;
}
