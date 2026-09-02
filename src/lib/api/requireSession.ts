import { createClient } from "@/lib/supabase/server";

/**
 * Guard for API routes that should be usable by ANY signed-in member of
 * a school — not just staff. Use this only for endpoints that are safe
 * for every role (they must not expose or accept anything a student or
 * parent shouldn't see/do). requireStaffSession() remains the guard for
 * anything sensitive.
 *
 * Returns { user, organizationId, role } on success, or a Response to
 * return immediately on failure.
 */
export async function requireActiveSession(): Promise<
  | { user: { id: string }; organizationId: string; role: string }
  | Response
> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }

  const { data: membership, error } = await supabase
    .from("org_memberships")
    .select("organization_id, role")
    .eq("user_id", user.id)
    .eq("active", true)
    .eq("is_default", true)
    .maybeSingle();

  const activeMembership = membership as { organization_id?: string; role?: string } | null;
  if (error || !activeMembership?.organization_id || !activeMembership?.role) {
    return Response.json({ error: "No active school membership." }, { status: 403 });
  }

  return { user: { id: user.id }, organizationId: activeMembership.organization_id, role: activeMembership.role };
}
