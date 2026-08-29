"use client";

/**
 * /admin-console - stealth super-admin sign-in.
 *
 * IMPORTANT: This page is intentionally NEVER linked from any public
 * page, sidebar, or footer. It is discoverable ONLY by direct URL. Do
 * NOT add it to a navigation menu, marketing page, /login chooser, or
 * staff-portal chooser in a future refactor. If a super-admin loses the
 * URL, they type it in.
 *
 * Distinctive mono/dark aesthetic (no gold, just gray + green terminal
 * accent). Pre-check rejects non-super-admins IMMEDIATELY after signing
 * in so a normal admin who guesses the URL is signed out before ever
 * reaching the console.
 */

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Terminal, Lock, Mail, ChevronRight, Eye, EyeOff, ShieldAlert } from "lucide-react";

export default function AdminConsolePage() {
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { data: authData, error: signErr } = await supabase.auth.signInWithPassword({ email, password });
      if (signErr) { setError(signErr.message); setLoading(false); return; }

      // Pre-check: only super_admin (via membership.role) or role=developer
      // (via profiles) may proceed. Anything else is signed out.
      let isSuper = false;
      if (authData?.user) {
        const [{ data: prof }, { data: mem }] = await Promise.all([
          supabase.from("profiles").select("role, active").eq("id", authData.user.id).maybeSingle(),
          supabase.from("org_memberships").select("role").eq("user_id", authData.user.id).eq("role", "super_admin").limit(1),
        ]);
        const p = prof as { role?: string; active?: boolean } | null;
        const m = (mem ?? []) as { role: string }[];
        if (m.length > 0) isSuper = true;
        else if (p?.role === "developer" && p.active) isSuper = true;
      }

      if (!isSuper) {
        await supabase.auth.signOut();
        setError("Access denied. The admin console is for platform super-admins only.");
        setLoading(false);
        return;
      }

      window.location.href = "/dashboard/platform";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection error - check your internet.");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6"
      style={{
        backgroundColor: "#000000",
        backgroundImage: "url(/login-bg-admin.svg)",
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}>
      <div className="w-full max-w-md">
        <Link href="/" className="flex items-center justify-center gap-2.5 mb-8 group">
          <div className="w-10 h-10 rounded-md bg-white/5 border border-white/10 flex items-center justify-center transition-colors group-hover:border-white/30">
            <Terminal size={20} className="text-emerald-400" />
          </div>
          <div className="text-white">
            <div className="font-mono font-bold text-sm tracking-wider">SMART_AND_THRIVE_OS</div>
            <div className="text-[10px] text-white/40 uppercase tracking-[0.2em]">Admin Console</div>
          </div>
        </Link>

        <div className="bg-black/60 backdrop-blur-xl rounded-lg border border-white/10 p-8 shadow-2xl">
          <div className="flex items-center gap-2 mb-1">
            <ShieldAlert size={14} className="text-emerald-400" />
            <span className="text-[10px] font-mono uppercase tracking-widest text-emerald-400">Restricted</span>
          </div>
          <h2 className="text-xl font-mono text-white">Platform Super Admin</h2>
          <p className="text-xs text-white/50 mt-1 mb-6 font-mono">
            &gt; authenticate to continue_
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-[10px] font-mono uppercase tracking-widest text-white/60 mb-1.5">Email</label>
              <div className="relative">
                <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="admin@grantschools.local"
                  className="w-full pl-10 pr-3 py-2.5 bg-white/5 border border-white/10 rounded-md text-sm text-white placeholder:text-white/20 font-mono focus:outline-none focus:ring-1 focus:ring-emerald-400 focus:border-emerald-400"
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="block text-[10px] font-mono uppercase tracking-widest text-white/60 mb-1.5">Password</label>
              <div className="relative">
                <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  required
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-10 pr-10 py-2.5 bg-white/5 border border-white/10 rounded-md text-sm text-white placeholder:text-white/20 font-mono focus:outline-none focus:ring-1 focus:ring-emerald-400 focus:border-emerald-400"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/70 focus:outline-none"
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            {error && (
              <div role="alert" className="p-3 rounded-md bg-red-500/10 border border-red-500/30 text-xs text-red-300 font-mono">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-md bg-emerald-500 text-black font-mono font-bold text-sm uppercase tracking-wider hover:bg-emerald-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-black transition-all disabled:opacity-60 flex items-center justify-center gap-2 group"
            >
              {loading ? "authenticating…" : (<>authenticate <ChevronRight size={14} className="transition-transform group-hover:translate-x-0.5" /></>)}
            </button>

            <p className="text-[10px] text-white/30 font-mono text-center pt-2">
              All authentication attempts are logged and monitored.
            </p>
          </form>
        </div>

        <p className="text-center text-[10px] text-white/25 font-mono mt-4 tracking-widest uppercase">
          Not a super-admin? <Link href="/staff-portal" className="text-emerald-400/60 hover:text-emerald-400">Staff Portal</Link>
        </p>
      </div>
    </div>
  );
}
