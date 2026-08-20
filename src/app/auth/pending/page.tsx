"use client";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export default function PendingPage() {
  const router = useRouter();
  const supabase = createClient();

  async function checkAgain() {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase
        .from("profiles").select("*").eq("id", user.id).single();
      if (profile?.active) {
        window.location.href = "/dashboard";
      } else {
        window.location.reload();
      }
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    window.location.href = "/auth/login";
  }

  return (
    <div className="min-h-screen bg-[#F7F5F0] flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h2 className="text-2xl font-bold text-[#0F2A47] mb-2">Waiting for approval</h2>
        <p className="text-gray-600 mb-6 leading-relaxed">
          Your account has been created. An admin needs to approve your access before you can use the app.
          Ask your school admin to open <strong>Team</strong> in the sidebar and approve your account.
        </p>
        <div className="flex gap-3 justify-center">
          <button onClick={checkAgain}
            className="px-4 py-2 bg-[#0F2A47] text-white rounded-lg text-sm font-medium hover:bg-[#1B3E63]">
            Check again
          </button>
          <button onClick={signOut}
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50">
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
