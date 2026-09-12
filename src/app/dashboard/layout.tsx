import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AuthProvider } from "@/lib/context/AuthContext";
import { AppShell } from "@/components/layout/AppShell";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();

  if (!user || userError) redirect("/auth/login");

  // Fetch profile using maybeSingle to avoid errors when RLS blocks or no row exists
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, active, organization_id, must_change_password")
    .eq("id", user.id).maybeSingle();

  if (!profile) {
    // Profiles and memberships are provisioned by trusted server/database flows.
    // Never bootstrap the first browser user as an administrator.
    redirect("/auth/pending");
  }

  const legitimateRoles = ["student","parent","teacher","admin","owner","super_admin","developer","editor","staff","bursar","accountant","viewer"];
  const profileOrgId = (profile as { organization_id?: string | null }).organization_id ?? null;
  const hasLegitRole = legitimateRoles.includes(profile.role ?? "");
  const hasOrg = Boolean(profileOrgId);

  // Block if deactivated OR if role/org is not legitimate.
  // Original bug: `&&` meant a deactivated user with a real role passed through.
  if (!profile.active || !hasLegitRole || !hasOrg) redirect("/auth/pending");

  return (
    <AuthProvider>
      <AppShell>{children}</AppShell>
    </AuthProvider>
  );
}
