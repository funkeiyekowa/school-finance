import { createClient } from "@/lib/supabase/server";

interface StaffSessionOptions {
  /** Effective permission required for this action in the active organization. */
  permission?: string;
}

const STAFF_ROLES = new Set([
  "owner", "admin", "editor", "staff", "bursar", "accountant",
  "teacher", "developer", "super_admin",
]);
const PRIVILEGED_ROLES = new Set(["owner", "admin", "super_admin"]);

/**
 * Guard for staff API routes. Authorization is based only on the active
 * (default) organization membership; a role in another organization cannot
 * grant access. Viewers and users without an active organization are denied.
 */
export async function requireStaffSession(
  options: StaffSessionOptions = {},
): Promise<Response | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }

  const { data: membership, error: membershipError } = await supabase
    .from("org_memberships")
    .select("organization_id, role")
    .eq("user_id", user.id)
    .eq("active", true)
    .eq("is_default", true)
    .maybeSingle();

  const activeMembership = membership as {
    organization_id?: string;
    role?: string;
  } | null;
  const role = activeMembership?.role;
  if (
    membershipError ||
    !activeMembership?.organization_id ||
    !role ||
    !STAFF_ROLES.has(role)
  ) {
    return Response.json({ error: "Not authorized." }, { status: 403 });
  }

  if (options.permission && !PRIVILEGED_ROLES.has(role)) {
    const { data: roleConfig, error: permissionsError } = await supabase
      .from("roles")
      .select("permissions")
      .eq("organization_id", activeMembership.organization_id)
      .eq("name", role)
      .limit(1)
      .maybeSingle();
    const permissions = roleConfig?.permissions as Record<string, boolean> | null;

    if (permissionsError || permissions?.[options.permission] !== true) {
      return Response.json(
        { error: `Permission required: ${options.permission}.` },
        { status: 403 },
      );
    }
  }

  return null;
}
