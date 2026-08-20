import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AuthProvider } from "@/lib/context/AuthContext";
import { AppShell } from "@/components/layout/AppShell";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  // Try to get profile — may not exist yet if trigger is still running
  const { data: profile } = await supabase
    .from("profiles").select("*").eq("id", user.id).single();

  // If profile doesn't exist yet, create it manually as a fallback
  if (!profile) {
    const { data: existingProfiles } = await supabase
      .from("profiles")
      .select("id")
      .limit(1);

    const isFirstUser = !existingProfiles || existingProfiles.length === 0;

    await supabase.from("profiles").upsert({
      id: user.id,
      email: user.email!,
      full_name: user.user_metadata?.full_name || user.email?.split("@")[0] || "User",
      role: isFirstUser ? "admin" : "pending",
      active: isFirstUser,
    });

    // Re-fetch the profile
    const { data: newProfile } = await supabase
      .from("profiles").select("*").eq("id", user.id).single();

    if (!newProfile) redirect("/auth/login");
    if (!newProfile.active) redirect("/auth/pending");

    return (
      <AuthProvider>
        <AppShell>{children}</AppShell>
      </AuthProvider>
    );
  }

  if (!profile.active) redirect("/auth/pending");

  return (
    <AuthProvider>
      <AppShell>{children}</AppShell>
    </AuthProvider>
  );
}
