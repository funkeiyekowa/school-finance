"use client";

/**
 * School-scoped staff portal form.
 *
 * Restricts sign-in to STAFF roles at the school named by the URL slug.
 * Rejected roles:
 *   - student / parent  -> "not a staff member" then sign out
 *   - super_admin       -> generic invalid-credentials error, then sign out
 *   - anything else     -> "not a staff member" then sign out
 *
 * On success, uses the redirect returned by resolve_login_context so
 * a teacher lands on /dashboard/teaching, an admin on /dashboard, etc.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ShieldCheck, BookOpen, Eye, EyeOff, Mail, Lock, ChevronRight } from "lucide-react";

interface Props {
  slug: string;
  schoolName: string;
  logoUrl: string | null;
  found: boolean;
}

type Persona = "teacher" | "admin";

interface LoginContext {
  role: "student" | "parent" | "teacher" | "admin" | null;
  redirect: string | null;
  organization_id: string | null;
  organization_name: string | null;
  student_id: string | null;
  reason?: string;
}

const STAFF_PROFILE_ROLES = new Set([
  "owner", "admin", "editor", "staff", "teacher",
  "bursar", "accountant", "developer",
]);

export default function StaffLoginForm({ slug, schoolName, logoUrl, found }: Props) {
  const supabase = createClient();
  const router = useRouter();
  const [persona, setPersona] = useState<Persona>("admin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!found) {
      setError("School not found. Check the address in your browser.");
      return;
    }
    if (!email.trim() || !password) {
      setError("Enter your work email and password.");
      return;
    }

    setLoading(true);
    try {
      // 1. Sign in.
      const { data: authData, error: signErr } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (signErr) { setError(signErr.message); setLoading(false); return; }
      if (!authData?.user) {
        setError("Sign-in did not return a session. Try again.");
        setLoading(false);
        return;
      }

      // 2. Refuse super-admin sign-in here — show generic error to avoid leaking console path.
      const [{ data: prof, error: profErr }, { data: superMem, error: superErr }] = await Promise.all([
        supabase.from("profiles").select("role").eq("id", authData.user.id).maybeSingle(),
        supabase.from("org_memberships").select("role").eq("user_id", authData.user.id).eq("role", "super_admin").limit(1),
      ]);
      if (profErr) { setError(`Could not read profile: ${profErr.message}`); await supabase.auth.signOut(); setLoading(false); return; }
      if (superErr) { setError(`Could not verify staff access: ${superErr.message}`); await supabase.auth.signOut(); setLoading(false); return; }
      const p = prof as { role?: string } | null;
      const superMemArr = (superMem ?? []) as { role: string }[];
      if (superMemArr.length > 0 || p?.role === "super_admin") {
        await supabase.auth.signOut();
        setError("Invalid email or password.");
        setLoading(false);
        return;
      }

      // 3. Resolve role for THIS school.
      const { data: ctxData, error: ctxErr } = await supabase.rpc("resolve_login_context", { p_slug: slug });
      if (ctxErr) {
        await supabase.auth.signOut();
        setError(`Could not verify your school access: ${ctxErr.message}`);
        setLoading(false);
        return;
      }
      const ctx = ctxData as LoginContext | null;

      const isStaffProfileRole = p?.role ? STAFF_PROFILE_ROLES.has(p.role) : false;
      const isStaffCtxRole = ctx?.role === "teacher" || ctx?.role === "admin";

      if (!ctx || !ctx.role || !ctx.redirect || !isStaffCtxRole || !isStaffProfileRole) {
        await supabase.auth.signOut();
        setError(`This account is not a staff member of ${schoolName}.`);
        setLoading(false);
        return;
      }

      // Remember the school for the sign-out redirect helper.
      try {
        document.cookie = `sf_last_school=${encodeURIComponent(slug)}; path=/; max-age=${60 * 60 * 24 * 90}; samesite=lax`;
      } catch {
        // Cookies disabled — non-fatal.
      }

      router.replace(ctx.redirect);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection error - check your internet.");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex text-white" style={{ backgroundColor: "#0a1929" }}>
      {/* Left brand panel */}
      <div
        className="hidden lg:flex lg:w-1/2 relative overflow-hidden"
        style={{
          backgroundImage: "url(/login-bg-staff.svg)",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        <div className="relative z-10 flex flex-col justify-between p-12 w-full">
          <Link href={`/s/${slug}`} className="flex items-center gap-3 group">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt={schoolName} className="w-12 h-12 rounded-xl object-cover bg-white/10 shadow-lg transition-transform group-hover:scale-105" />
            ) : (
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#D4AF37] to-[#7a5f14] flex items-center justify-center shadow-lg shadow-[#D4AF37]/30 transition-transform group-hover:scale-105">
                <ShieldCheck size={26} className="text-[#0a1929]" />
              </div>
            )}
            <div>
              <div className="font-bold text-xl">{schoolName}</div>
              <div className="text-xs text-[#D4AF37]/70 tracking-wider uppercase">Staff Portal</div>
            </div>
          </Link>

          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#D4AF37]/10 border border-[#D4AF37]/30 text-[#D4AF37] text-xs font-semibold">
              Restricted access
            </div>
            <h1 className="text-4xl font-bold leading-tight">
              For teachers &amp;<br />
              <span className="text-[#D4AF37]">administrators only.</span>
            </h1>
            <p className="text-white/60 text-lg max-w-md leading-relaxed">
              Attendance, assessments, CBT, finance, admissions - the full
              school console. Please sign in with your school-issued account.
            </p>
          </div>

          <div className="text-xs text-white/30">
            All sessions on this portal are logged and audited.
          </div>
        </div>
      </div>

      {/* Right form card */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-md">
          <Link href={`/s/${slug}`} className="lg:hidden flex items-center gap-3 mb-8 justify-center group">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt={schoolName} className="w-11 h-11 rounded-xl object-cover" />
            ) : (
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#D4AF37] to-[#7a5f14] flex items-center justify-center">
                <ShieldCheck size={22} className="text-[#0a1929]" />
              </div>
            )}
            <div>
              <div className="font-bold text-lg">{schoolName}</div>
              <div className="text-xs text-[#D4AF37]/70 uppercase tracking-wider">Staff Portal</div>
            </div>
          </Link>

          <div className="bg-[#0f2438] rounded-2xl shadow-2xl border border-[#D4AF37]/20 p-8">
            <h2 className="text-2xl font-bold text-white">Staff sign in</h2>
            <p className="text-sm text-white/60 mt-1 mb-5">
              Continuing as <span className="text-[#D4AF37] font-semibold">{persona === "admin" ? "Administrator" : "Teacher"}</span>
            </p>

            {/* Persona toggle - purely cosmetic; role is decided server-side */}
            <div className="grid grid-cols-2 gap-1.5 mb-5 p-1 bg-black/30 rounded-lg">
              <button
                type="button"
                onClick={() => setPersona("admin")}
                className={`py-2 px-3 rounded-md text-sm font-semibold transition-all flex items-center justify-center gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] ${
                  persona === "admin" ? "bg-[#D4AF37] text-[#0a1929] shadow" : "text-white/60 hover:text-white"
                }`}
              >
                <ShieldCheck size={14} /> Admin
              </button>
              <button
                type="button"
                onClick={() => setPersona("teacher")}
                className={`py-2 px-3 rounded-md text-sm font-semibold transition-all flex items-center justify-center gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] ${
                  persona === "teacher" ? "bg-[#D4AF37] text-[#0a1929] shadow" : "text-white/60 hover:text-white"
                }`}
              >
                <BookOpen size={14} /> Teacher
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-xs font-semibold text-white/70 mb-1.5">Work Email</label>
                <div className="relative">
                  <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
                  <input
                    id="email"
                    type="email"
                    autoComplete="username"
                    required
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@school.com"
                    className="w-full pl-10 pr-3 py-2.5 bg-black/20 border border-white/10 rounded-lg text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-[#D4AF37] focus:border-transparent"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="password" className="text-xs font-semibold text-white/70">Password</label>
                  <Link href="/auth/forgot-password" className="text-xs text-[#D4AF37] hover:underline">Forgot?</Link>
                </div>
                <div className="relative">
                  <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    className="w-full pl-10 pr-10 py-2.5 bg-black/20 border border-white/10 rounded-lg text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-[#D4AF37] focus:border-transparent"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/80 focus:outline-none"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {error && (
                <div role="alert" className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 rounded-lg bg-gradient-to-r from-[#D4AF37] to-[#7a5f14] text-[#0a1929] font-semibold text-sm hover:shadow-lg hover:shadow-[#D4AF37]/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f2438] transition-all disabled:opacity-60 flex items-center justify-center gap-2 group"
              >
                {loading ? (
                  <>
                    <span className="inline-block w-3.5 h-3.5 border-2 border-[#0a1929]/50 border-t-transparent rounded-full animate-spin" />
                    Signing in&hellip;
                  </>
                ) : (
                  <>Sign In <ChevronRight size={16} className="transition-transform group-hover:translate-x-0.5" /></>
                )}
              </button>
            </form>

            <p className="mt-6 text-center text-xs text-white/40">
              Access issues? Contact your school&apos;s IT administrator.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
