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

  // If no profile found — could be RLS issue or trigger didn't fire
  // Try to insert one (will succeed if RLS allows, fail silently if not)
  if (!profile) {
    // Check total profiles to determine if first user
    const { count } = await supabase
      .from("profiles")
      .select("*", { count: "exact", head: true });

    const isFirst = (count ?? 0) === 0;

    // Try to insert — RLS policy "Service can insert profiles" uses `with check (true)`
    await supabase.from("profiles").insert({
      id: user.id,
      email: user.email || "",
      full_name: user.user_metadata?.full_name || user.email?.split("@")[0] || "User",
      role: isFirst ? "admin" : "pending",
      active: isFirst,
    });

    // Re-fetch just the fields the shell needs.
    const { data: newProfile } = await supabase
      .from("profiles")
      .select("id, email, full_name, role, active, organization_id, must_change_password")
      .eq("id", user.id).maybeSingle();

    if (!newProfile) {
      // RLS is blocking everything — redirect to pending with explanation
      redirect("/auth/pending");
    }

    const _legitimateRolesN = ["student","parent","teacher","admin","owner","super_admin","developer","editor","staff"];
    const _newOrgId = (newProfile as { organization_id?: string | null }).organization_id ?? null;
    if (!newProfile.active && !(_legitimateRolesN.includes(newProfile.role ?? "") && Boolean(_newOrgId))) redirect("/auth/pending");

    return (
      <AuthProvider>
        <AppShell>{children}</AppShell>
      </AuthProvider>
    );
  }

  const _legitimateRoles = ["student","parent","teacher","admin","owner","super_admin","developer","editor","staff"];
  const _profileOrgId = (profile as { organization_id?: string | null }).organization_id ?? null;
  const _isLegit = _legitimateRoles.includes(profile.role ?? "") && Boolean(_profileOrgId);
  if (!profile.active && !_isLegit) redirect("/auth/pending");

  return (
    <AuthProvider>
      <AppShell>{children}</AppShell>
    </AuthProvider>
  );
}
