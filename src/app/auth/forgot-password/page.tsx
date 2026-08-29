"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const supabase = createClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");
    const target = email.trim().toLowerCase();

    // Item 9: check the email exists before Supabase silently returns 200.
    // The auth_email_exists RPC is SECURITY DEFINER and does not leak PII
    // beyond a boolean — safe to expose to anonymous callers.
    try {
      const { data: exists, error: chkErr } = await supabase.rpc("auth_email_exists", { p_email: target });
      if (!chkErr && exists === false) {
        setError("Email is not on the system.");
        setLoading(false);
        return;
      }
    } catch {
      // RPC not yet installed — fall through to Supabase which will 200 silently.
    }

    const { error } = await supabase.auth.resetPasswordForEmail(target, {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    });
    setLoading(false);
    if (error) setError(error.message);
    else setMessage("Check your email for a password reset link.");
  }

  return (
    <div className="min-h-screen bg-[#F7F5F0] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 mb-8 justify-center">
          <div className="w-8 h-8 rounded-lg bg-[#0F2A47] flex items-center justify-center">
            <svg viewBox="0 0 24 24" className="w-4 h-4 text-[#C9A227]" fill="currentColor">
              <path d="M12 3L1 9l11 6 9-4.91V17h2V9L12 3zM5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82z"/>
            </svg>
          </div>
          <span className="font-bold text-[#0F2A47]">School Finance Suite</span>
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-1">Reset password</h2>
        <p className="text-gray-500 text-sm mb-6">We&apos;ll send you a reset link.</p>
        {message && <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">{message}</div>}
        {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]" />
          </div>
          <button type="submit" disabled={loading}
            className="w-full py-2.5 bg-[#0F2A47] text-white rounded-lg font-semibold text-sm hover:bg-[#1B3E63] disabled:opacity-60">
            {loading ? "Sending…" : "Send reset link"}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-gray-500">
          <Link href="/auth/login" className="text-[#0F2A47] hover:underline font-medium">Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
