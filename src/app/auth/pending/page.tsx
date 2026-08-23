"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export default function PendingPage() {
  const router = useRouter();
  const supabase = createClient();
  const [schoolCode, setSchoolCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinResult, setJoinResult] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [hasOrg, setHasOrg] = useState<boolean | null>(null);

  useEffect(() => {
    // Check if the user already has an org membership.
    supabase.from("org_memberships").select("id").limit(1).then(({ data }) => {
      setHasOrg((data ?? []).length > 0);
    });
  }, [supabase]);

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

  async function joinSchool() {
    if (!schoolCode.trim()) {
      setJoinError("Please enter your school code.");
      return;
    }
    setJoining(true);
    setJoinError(null);
    setJoinResult(null);

    const { data, error } = await supabase.rpc("join_school_by_code", {
      p_code: schoolCode.trim(),
    });

    setJoining(false);
    if (error) {
      setJoinError(error.message.includes("does not exist")
        ? "The school code system is not set up yet. Ask your platform administrator to run fix_profile_isolation.sql."
        : error.message);
      return;
    }
    const result = data as { ok?: boolean; error?: string; message?: string; approved?: boolean } | null;
    if (result?.ok) {
      setJoinResult(result.message ?? "Joined successfully.");
      setHasOrg(true);
      if (result.approved) {
        setTimeout(() => { window.location.href = "/dashboard"; }, 1500);
      }
    } else {
      setJoinError(result?.error ?? "Could not join that school.");
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

        {hasOrg === false && (
          <>
            <h2 className="text-2xl font-bold text-[#0F2A47] mb-2">Join your school</h2>
            <p className="text-gray-600 mb-6 leading-relaxed">
              Enter the school code your administrator shared with you. If you do not have one,
              ask them — it is shown under <strong>Team → Invite</strong> in their dashboard.
            </p>
            <div className="space-y-3">
              <input
                type="text"
                value={schoolCode}
                onChange={e => setSchoolCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                placeholder="School code (e.g. AB3F9K)"
                maxLength={8}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg text-center text-lg font-mono tracking-widest uppercase focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
              />
              {joinError && (
                <p className="text-sm text-red-600">{joinError}</p>
              )}
              {joinResult && (
                <p className="text-sm text-green-700 font-medium">{joinResult}</p>
              )}
              <button
                onClick={joinSchool}
                disabled={joining || !schoolCode.trim()}
                className="w-full px-4 py-2.5 bg-[#C9A227] text-[#0F2A47] rounded-lg text-sm font-bold hover:opacity-90 disabled:opacity-60 transition-opacity"
              >
                {joining ? "Joining…" : "Join school"}
              </button>
            </div>
          </>
        )}

        {hasOrg !== false && (
          <>
            <h2 className="text-2xl font-bold text-[#0F2A47] mb-2">Waiting for approval</h2>
            <p className="text-gray-600 mb-6 leading-relaxed">
              Your request has been received. A school administrator needs to approve your
              access before you can use the app. Ask them to open <strong>Team</strong> in
              the sidebar and approve your account.
            </p>
          </>
        )}

        <div className="flex gap-3 justify-center mt-6">
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
