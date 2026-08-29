"use client";

/**
 * Full-screen modal that blocks all interaction until the user
 * changes their default password. Triggered by
 * profiles.must_change_password === true.
 *
 * Applies to any authenticated role — parent, teacher, staff, admin.
 * Students who log in via the /dashboard/student-portal already
 * have their own modal driven by students.must_change_password.
 */

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { Lock, Eye, EyeOff, ShieldCheck } from "lucide-react";

export default function ForcePasswordChange() {
  const supabase = createClient();
  const { profile, refreshProfile, signOut } = useAuth();
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mustChange =
    !!profile && (profile as unknown as { must_change_password?: boolean }).must_change_password === true;

  if (!mustChange) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (next.length < 8) return setError("Password must be at least 8 characters.");
    if (next === "ChangeMe123!") return setError("Choose a new password — you can't reuse the default.");
    if (next !== confirm) return setError("Passwords do not match.");

    setSaving(true);
    const { error: authErr } = await supabase.auth.updateUser({ password: next });
    if (authErr) {
      setError(authErr.message);
      setSaving(false);
      return;
    }

    const { error: rpcErr } = await supabase.rpc("clear_must_change_password");
    if (rpcErr) {
      await supabase
        .from("profiles")
        .update({ must_change_password: false })
        .eq("id", profile?.id ?? "");
    }

    await refreshProfile();
    setSaving(false);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="force-pw-title"
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: "rgba(15, 42, 71, 0.72)", backdropFilter: "blur(6px)" }}
    >
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-6 pt-6 pb-4 border-b border-gray-100">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#C9A227] to-[#8a6d1a] flex items-center justify-center mb-3">
            <ShieldCheck size={20} className="text-white" />
          </div>
          <h2 id="force-pw-title" className="text-lg font-bold text-[#0F2A47]">
            Set a new password
          </h2>
          <p className="text-sm text-gray-600 mt-1">
            You&apos;re signed in with the default password. Please choose a
            new one before continuing — this can&apos;t be skipped.
          </p>
        </div>

        <form onSubmit={submit} className="p-6 space-y-4">
          <div>
            <label htmlFor="new-pw" className="block text-xs font-semibold text-gray-700 mb-1">
              New password
            </label>
            <div className="relative">
              <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                id="new-pw"
                type={show ? "text" : "password"}
                value={next}
                onChange={(e) => setNext(e.target.value)}
                required
                minLength={8}
                autoFocus
                autoComplete="new-password"
                className="w-full rounded-lg border border-gray-300 pl-9 pr-10 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
                placeholder="At least 8 characters"
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 p-1"
                aria-label={show ? "Hide password" : "Show password"}
              >
                {show ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="confirm-pw" className="block text-xs font-semibold text-gray-700 mb-1">
              Confirm new password
            </label>
            <div className="relative">
              <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                id="confirm-pw"
                type={show ? "text" : "password"}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                className="w-full rounded-lg border border-gray-300 pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
              />
            </div>
          </div>

          {error && (
            <div role="alert" className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            className="w-full py-2.5 rounded-lg bg-gradient-to-r from-[#C9A227] to-[#8a6d1a] text-white font-semibold text-sm hover:shadow-lg disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save new password"}
          </button>

          <button
            type="button"
            onClick={() => signOut()}
            className="w-full text-xs text-gray-500 hover:text-gray-700 pt-2"
          >
            Sign out instead
          </button>
        </form>
      </div>
    </div>
  );
}
