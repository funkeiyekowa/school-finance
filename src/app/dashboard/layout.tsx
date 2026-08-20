import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AuthProvider } from "@/lib/context/AuthContext";
import { AppShell } from "@/components/layout/AppShell";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  // Try to get profile
  let { data: profile } = await supabase
    .from("profiles").select("*").eq("id", user.id).single();

  // If no profile yet (trigger didn't fire or failed), create one now
  if (!profile) {
    const { data: existingCount } = await supabase
      .from("profiles")
      .select("id", { count: "exact", head: true });

    const isFirstUser = (existingCount === null || (Array.isArray(existingCount) && existingCount.length === 0));

    await supabase.from("profiles").upsert({
      id: user.id,
      email: user.email || "",
      full_name: user.user_metadata?.full_name || user.email?.split("@")[0] || "User",
      role: isFirstUser ? "admin" : "pending",
      active: isFirstUser,
    });

    // Re-fetch
    const { data: newProfile } = await supabase
      .from("profiles").select("*").eq("id", user.id).single();

    if (!newProfile) {
      // Something is seriously wrong — maybe RLS is blocking the insert
      // Sign the user out and send to login
      await supabase.auth.signOut();
      redirect("/auth/login");
    }

    profile = newProfile;
  }

  if (!profile.active) redirect("/auth/pending");

  return (
    <AuthProvider>
      <AppShell>{children}</AppShell>
    </AuthProvider>
  );
}
