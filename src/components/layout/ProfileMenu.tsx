"use client";

/**
 * Top-right account menu, visible on every dashboard page regardless of
 * role. Lives in the persistent SchoolBrandBar (not the sidebar user card
 * in AppShell, which is staff-photo-focused and scrolls out of view on long
 * sidebars) so "change my password" / "who am I signed in as" is always in
 * the same, standard place -- the corner every SaaS user already checks.
 *
 * Deliberately does its own inline password-change form rather than
 * linking out to a page: this is meant to be a two-click action from
 * anywhere, not a navigation. Reuses the same validation rules as
 * ForcePasswordChange (min length, can't reuse the shared default) so the
 * two paths behave identically.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { useDisplayName } from "@/lib/hooks/useDisplayName";
import { signOutToSchoolLogin } from "@/lib/auth/signOutToSchoolLogin";
import { cn } from "@/lib/utils";
import {
  UserCircle, ChevronDown, KeyRound, LogOut, Lock, Eye, EyeOff, Check, Loader2,
} from "lucide-react";

export function ProfileMenu() {
  const supabase = createClient();
  const { user, profile, membership, signOut } = useAuth();
  const displayName = useDisplayName();
  const [open, setOpen] = useState(false);
  const [changingPw, setChangingPw] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
        setChangingPw(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Close on Escape -- standard dropdown behavior, and the password form
  // has its own inputs a user may want to back out of quickly.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { setOpen(false); setChangingPw(false); }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  if (!user) return null;

  const name = displayName;
  const initial = name.charAt(0).toUpperCase();
  const roleLabel = (membership?.role || profile?.role || "").replace(/_/g, " ");
  // Hide the synthetic <code>.<org>@student.local login email from the menu.
  const showEmail = !/@[^@]*\.local$/i.test(user.email || "");

  async function handleSignOut() {
    await signOut();
    signOutToSchoolLogin();
  }

  return (
    <div ref={boxRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="flex items-center gap-2 pl-1.5 pr-2 py-1.5 rounded-full hover:bg-gray-100 transition-colors"
      >
        <div className="w-8 h-8 rounded-full bg-[#0F2A47] text-[#C9A227] flex items-center justify-center text-xs font-bold shrink-0">
          {initial}
        </div>
        <ChevronDown size={14} className="text-gray-400 hidden sm:block" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute z-50 right-0 mt-2 w-72 bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#0F2A47] text-[#C9A227] flex items-center justify-center text-sm font-bold shrink-0">
              {initial}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-gray-900 truncate">{name}</div>
              {showEmail && <div className="text-xs text-gray-500 truncate">{user.email}</div>}
              {roleLabel && (
                <div className="text-[10px] uppercase tracking-wide font-bold text-[#C9A227] mt-0.5">
                  {roleLabel}
                </div>
              )}
            </div>
          </div>

          {changingPw ? (
            <ChangePasswordForm
              supabase={supabase}
              onDone={() => { setChangingPw(false); setOpen(false); }}
              onCancel={() => setChangingPw(false)}
            />
          ) : (
            <div className="py-1">
              <Link
                href="/dashboard/my-profile"
                role="menuitem"
                onClick={() => setOpen(false)}
                className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                <UserCircle size={16} className="text-gray-400" />
                My profile
              </Link>
              <button
                type="button"
                role="menuitem"
                onClick={() => setChangingPw(true)}
                className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 text-left"
              >
                <KeyRound size={16} className="text-gray-400" />
                Change password
              </button>
              <div className="my-1 border-t border-gray-100" />
              <button
                type="button"
                role="menuitem"
                onClick={handleSignOut}
                className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-red-600 hover:bg-red-50 text-left"
              >
                <LogOut size={16} />
                Sign out
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ChangePasswordForm({
  supabase, onDone, onCancel,
}: {
  supabase: ReturnType<typeof createClient>;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (next.length < 8) return setError("Password must be at least 8 characters.");
    if (next === "ChangeMe123!") return setError("Choose a new password — you can't reuse the default.");
    if (next !== confirm) return setError("Passwords do not match.");

    setSaving(true);
    const { error: authErr } = await supabase.auth.updateUser({ password: next });
    setSaving(false);
    if (authErr) { setError(authErr.message); return; }

    setSuccess(true);
    setTimeout(onDone, 900);
  }

  if (success) {
    return (
      <div className="px-4 py-6 flex flex-col items-center text-center gap-2">
        <div className="w-9 h-9 rounded-full bg-green-100 text-green-600 flex items-center justify-center">
          <Check size={18} />
        </div>
        <p className="text-sm font-semibold text-gray-800">Password updated.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="p-4 space-y-3">
      <div>
        <label htmlFor="pm-new-pw" className="block text-xs font-semibold text-gray-700 mb-1">
          New password
        </label>
        <div className="relative">
          <Lock size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            id="pm-new-pw"
            type={show ? "text" : "password"}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            required
            minLength={8}
            autoFocus
            autoComplete="new-password"
            className="w-full rounded-lg border border-gray-300 pl-8 pr-9 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
            placeholder="At least 8 characters"
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 p-1"
            aria-label={show ? "Hide password" : "Show password"}
          >
            {show ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
      </div>

      <div>
        <label htmlFor="pm-confirm-pw" className="block text-xs font-semibold text-gray-700 mb-1">
          Confirm new password
        </label>
        <div className="relative">
          <Lock size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            id="pm-confirm-pw"
            type={show ? "text" : "password"}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
            className="w-full rounded-lg border border-gray-300 pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
          />
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-lg bg-red-50 border border-red-200 p-2.5 text-xs text-red-700">
          {error}
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className={cn(
            "flex-1 py-2 rounded-lg text-xs font-semibold text-gray-600 hover:bg-gray-100 border border-gray-200"
          )}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="flex-1 py-2 rounded-lg bg-gradient-to-r from-[#C9A227] to-[#8a6d1a] text-white text-xs font-semibold hover:shadow-md disabled:opacity-50 flex items-center justify-center gap-1.5"
        >
          {saving ? <><Loader2 size={13} className="animate-spin" /> Saving…</> : "Save"}
        </button>
      </div>
    </form>
  );
}
