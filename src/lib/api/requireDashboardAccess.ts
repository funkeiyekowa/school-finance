import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

type DashboardAccessOptions = {
  roles?: readonly string[];
  permissions?: readonly string[];
  adminOnly?: boolean;
};

/** Server-side gate for dashboard route groups. UI menu visibility is not a boundary. */
export async function requireDashboardAccess(options: DashboardAccessOptions): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: membership, error } = await supabase
    .from("org_memberships")
    .select("organization_id, role")
    .eq("user_id", user.id)
    .eq("active", true)
    .eq("is_default", true)
    .maybeSingle();
  const active = membership as { organization_id?: string; role?: string } | null;
  if (error || !active?.organization_id || !active.role) redirect("/auth/pending");

  const role = active.role;
  const privileged = ["owner", "admin", "super_admin", "developer"].includes(role);
  const allowedByRole = options.roles?.includes(role) ?? false;
  const adminOnlyAllowed = options.adminOnly && ["owner", "admin", "super_admin"].includes(role);
  if (privileged || allowedByRole || adminOnlyAllowed) return;

  if (options.permissions?.length) {
    const { data: roleConfig, error: permissionError } = await supabase
      .from("roles")
      .select("permissions")
      .eq("organization_id", active.organization_id)
      .eq("name", role)
      .maybeSingle();
    const permissions = roleConfig?.permissions as Record<string, boolean> | null;
    if (!permissionError && options.permissions.some((key) => permissions?.[key] === true)) return;
  }

  redirect("/dashboard");
}
