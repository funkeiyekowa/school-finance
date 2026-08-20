"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [tab, setTab] = useState<"signin" | "register">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const supabase = createClient();

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setError(error.message);
        setLoading(false);
      } else {
        window.location.href = "/dashboard";
      }
    } catch (err: any) {
      setError(err?.message || "Connection error — check your internet.");
      setLoading(false);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: name } },
    });
    if (error) {
      setError(error.message);
      setLoading(false);
    } else if (data.session) {
      // Auto-confirmed (email confirmation disabled) — go straight to dashboard
      window.location.href = "/dashboard";
    } else {
      // Email confirmation required
      setMessage("Account created! Check your email to confirm, then sign in.");
      setLoading(false);
      setTab("signin");
    }
  }

  async function handleGoogle() {
    setLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      setError(error.message);
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex">
      {/* Left panel */}
      <div
        className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12 relative overflow-hidden"
        style={{ backgroundColor: "#0F2A47" }}
      >
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-16">
            <div className="w-9 h-9 rounded-lg bg-[#C9A227] flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-5 h-5 text-[#0F2A47]" fill="currentColor">
                <path d="M12 3L1 9l11 6 9-4.91V17h2V9L12 3zM5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82z"/>
              </svg>
            </div>
            <span className="text-white font-bold text-lg">School Finance Suite</span>
          </div>
          <div className="mt-auto">
            <h1 className="text-4xl font-bold text-white leading-tight mb-4">
              Every naira in and out of your school, reconciled and auditable.
            </h1>
            <p className="text-[#B8C8DC] text-base leading-relaxed max-w-md">
              Fee receipts, expense vouchers, guardian balances, bank reconciliation and a full audit trail — with role-based access for your bursary team.
            </p>
          </div>
        </div>
        <div className="text-[#4A6A8A] text-sm">Premium edition</div>
        {/* Decorative circles */}
        <div className="absolute -bottom-20 -left-20 w-72 h-72 rounded-full bg-[#1B3E63] opacity-40" />
        <div className="absolute -top-10 -right-10 w-48 h-48 rounded-full bg-[#C9A227] opacity-10" />
      </div>

      {/* Right panel */}
      <div className="flex-1 flex flex-col justify-center items-center px-6 py-12 bg-[#F7F5F0]">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-2 mb-8 justify-center">
            <div className="w-8 h-8 rounded-lg bg-[#0F2A47] flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-4 h-4 text-[#C9A227]" fill="currentColor">
                <path d="M12 3L1 9l11 6 9-4.91V17h2V9L12 3zM5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82z"/>
              </svg>
            </div>
            <span className="font-bold text-[#0F2A47]">School Finance Suite</span>
          </div>

          <h2 className="text-2xl font-bold text-gray-900 mb-1">Welcome back</h2>
          <p className="text-gray-500 text-sm mb-6">The first person to register becomes the school Admin.</p>

          {/* Tabs */}
          <div className="flex rounded-lg border border-gray-200 p-1 mb-6 bg-white">
            <button
              onClick={() => { setTab("signin"); setError(""); setMessage(""); }}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${tab === "signin" ? "bg-[#0F2A47] text-white shadow-sm" : "text-gray-600 hover:text-gray-900"}`}
            >
              Sign in
            </button>
            <button
              onClick={() => { setTab("register"); setError(""); setMessage(""); }}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${tab === "register" ? "bg-[#0F2A47] text-white shadow-sm" : "text-gray-600 hover:text-gray-900"}`}
            >
              Register
            </button>
          </div>

          {message && (
            <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
              {message}
            </div>
          )}
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={tab === "signin" ? handleSignIn : handleRegister} className="space-y-4">
            {tab === "register" && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Your full name"
                  required
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227] focus:border-transparent"
                />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@school.edu.ng"
                required
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227] focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={6}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227] focus:border-transparent"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-[#0F2A47] text-white rounded-lg font-semibold text-sm hover:bg-[#1B3E63] transition-colors disabled:opacity-60"
            >
              {loading ? "Please wait…" : tab === "signin" ? "Sign in" : "Create account"}
            </button>
          </form>

          <div className="my-4 flex items-center gap-3">
            <div className="flex-1 h-px bg-gray-200" />
            <span className="text-gray-400 text-xs">or</span>
            <div className="flex-1 h-px bg-gray-200" />
          </div>

          <button
            onClick={handleGoogle}
            disabled={loading}
            className="w-full py-2.5 border border-gray-300 bg-white text-gray-700 rounded-lg font-medium text-sm hover:bg-gray-50 transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Continue with Google
          </button>

          {tab === "signin" && (
            <p className="mt-4 text-center text-sm text-gray-500">
              <Link href="/auth/forgot-password" className="text-[#0F2A47] hover:underline font-medium">
                Forgot password?
              </Link>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
