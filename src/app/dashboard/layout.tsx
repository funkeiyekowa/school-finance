import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AuthProvider } from "@/lib/context/AuthContext";
import { AppShell } from "@/components/layout/AppShell";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();

  if (!user || userError) redirect("/auth/login");

  // Fetch profile — the DB trigger should have created it on signup
  const { data: profile, error: profileError } = await supabase
    .from("profiles").select("*").eq("id", user.id).maybeSingle();

  // If profile doesn't exist, the user just signed up and trigger may not have run.
  // Show pending page which tells them to wait / contact admin.
  if (!profile) {
    redirect("/auth/pending");
  }

  if (!profile.active) redirect("/auth/pending");

  return (
    <AuthProvider>
      <AppShell>{children}</AppShell>
    </AuthProvider>
  );
}
