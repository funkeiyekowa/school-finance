"use client";

/**
 * School-scoped login — one form, role resolved server-side via
 * resolve_login_context(p_slug). No role tabs, no persona picker.
 *
 * Accepts either an email OR a student code (letter+digits, or anything
 * without '@'). Student codes are translated to <code>@student.local for
 * signInWithPassword, matching the existing convention in /auth/login.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Eye, EyeOff, Lock, ChevronRight, User, GraduationCap } from "lucide-react";

interface Props {
  slug: string;
  schoolName: string;
  logoUrl: string | null;
  found: boolean;
}

interface LoginContext {
  role: "student" | "parent" | "teacher" | "admin" | null;
  redirect: string | null;
  organization_id: string | null;
  organization_name: string | null;
  student_id: string | null;
  reason?: string;
}

const STUDENT_CODE_RE = /^[A-Za-z]\d+$/;

export default function SchoolLoginForm({ slug, schoolName, logoUrl, found }: Props) {
  const supabase = createClient();
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
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
    if (!identifier.trim() || !password) {
      setError("Enter your email or student code, and your password.");
      return;
    }

    setLoading(true);
    try {
      // 1. Decide login email.
      const raw = identifier.trim();
      let loginEmail: string;
      if (raw.includes("@")) {
        loginEmail = raw.toLowerCase();
      } else {
        const codeUpper = raw.toUpperCase();
        if (!STUDENT_CODE_RE.test(codeUpper) && /\s/.test(codeUpper)) {
          setError("Student codes look like S288 (letter + digits).");
          setLoading(false);
          return;
        }
        // Optionally verify the student code exists first for a better error
        // message, but fall back to trying the derived email so a legacy
        // code without verify_student_code still works.
        try {
          const { data: verify } = await supabase.rpc("verify_student_code", { p_code: codeUpper });
          const v = verify as { exists?: boolean; active?: boolean; login_email?: string; has_auth?: boolean } | null;
          if (v?.exists === false) {
            setError("Student code not found at this school.");
            setLoading(false);
            return;
          }
          if (v?.exists && v.active === false) {
            setError("This student account is not active.");
            setLoading(false);
            return;
          }
          if (v?.login_email) {
            loginEmail = v.login_email;
          } else {
            loginEmail = `${codeUpper.toLowerCase()}@student.local`;
          }
        } catch {
          loginEmail = `${codeUpper.toLowerCase()}@student.local`;
        }
      }

      // 2. Sign in.
      const { data: signData, error: signErr } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password,
      });
      if (signErr) {
        setError(signErr.message);
        setLoading(false);
        return;
      }
      if (!signData?.user) {
        setError("Sign-in did not return a session. Try again.");
        setLoading(false);
        return;
      }

      // 3. Resolve role for THIS school.
      const { data: ctxData, error: ctxErr } = await supabase.rpc("resolve_login_context", { p_slug: slug });
      if (ctxErr) {
        setError(`Could not verify your school access: ${ctxErr.message}`);
        await supabase.auth.signOut();
        setLoading(false);
        return;
      }
      const ctx = ctxData as LoginContext | null;

      if (!ctx || !ctx.role || !ctx.redirect) {
        await supabase.auth.signOut();
        setError(`This account is not attached to ${schoolName}.`);
        setLoading(false);
        return;
      }

      // Remember which school this user came in through so middleware can
      // redirect unauth visits to the right /s/<slug>/login next time.
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
    <div className="min-h-screen flex">
      {/* Left brand panel */}
      <div
        className="hidden lg:flex lg:w-1/2 relative overflow-hidden text-white"
        style={{
          backgroundImage: "url(/login-bg-student.svg)",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        <div className="relative z-10 flex flex-col justify-between p-12 w-full">
          <Link href={`/s/${slug}`} className="flex items-center gap-3 group">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt={schoolName}
                className="w-12 h-12 rounded-xl object-cover bg-white/10 shadow-lg transition-transform group-hover:scale-105"
              />
            ) : (
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#C9A227] to-[#8a6d1a] flex items-center justify-center shadow-lg shadow-[#C9A227]/30 transition-transform group-hover:scale-105">
                <GraduationCap size={26} className="text-white" />
              </div>
            )}
            <div>
              <div className="font-bold text-xl">{schoolName}</div>
              <div className="text-xs text-white/60">Sign in to your portal</div>
            </div>
          </Link>

          <div className="space-y-6">
            <h1 className="text-4xl font-bold leading-tight">
              Welcome back<br />
              <span className="text-[#C9A227]">to {schoolName}.</span>
            </h1>
            <p className="text-white/70 text-lg max-w-md leading-relaxed">
              One sign-in. Students, parents, teachers and administrators
              all get taken to the right place automatically.
            </p>
          </div>

          <div className="text-xs text-white/40">
            &copy; {new Date().getFullYear()} {schoolName} &middot; secure &amp; private
          </div>
        </div>
      </div>

      {/* Right form card */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-12 bg-[#F7F5F0]">
        <div className="w-full max-w-md">
          <Link href={`/s/${slug}`} className="lg:hidden flex items-center gap-3 mb-8 justify-center group">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt={schoolName} className="w-11 h-11 rounded-xl object-cover" />
            ) : (
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#C9A227] to-[#8a6d1a] flex items-center justify-center">
                <GraduationCap size={22} className="text-white" />
              </div>
            )}
            <div>
              <div className="font-bold text-lg text-[#0F2A47]">{schoolName}</div>
              <div className="text-xs text-gray-500">Sign in to your portal</div>
            </div>
          </Link>

          <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8">
            <h2 className="text-2xl font-bold text-[#0F2A47]">Sign in</h2>
            <p className="text-sm text-gray-500 mt-1 mb-5">
              Use your email or student code.
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="identifier" className="block text-xs font-semibold text-gray-600 mb-1.5">
                  Email or Student Code
                </label>
                <div className="relative">
                  <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    id="identifier"
                    type="text"
                    autoComplete="username"
                    required
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder="you@example.com or S288"
                    className="w-full pl-10 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="password" className="text-xs font-semibold text-gray-600">
                    Password
                  </label>
                  <Link href="/auth/forgot-password" className="text-xs text-[#C9A227] hover:underline">
                    Forgot?
                  </Link>
                </div>
                <div className="relative">
                  <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    className="w-full pl-10 pr-10 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {error && (
                <div role="alert" className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 rounded-lg bg-gradient-to-r from-[#C9A227] to-[#8a6d1a] text-white font-semibold text-sm hover:shadow-lg hover:shadow-[#C9A227]/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A227] focus-visible:ring-offset-2 transition-all disabled:opacity-60 flex items-center justify-center gap-2 group"
              >
                {loading ? (
                  <>
                    <span className="inline-block w-3.5 h-3.5 border-2 border-white/70 border-t-transparent rounded-full animate-spin" />
                    Signing in&hellip;
                  </>
                ) : (
                  <>
                    Sign In <ChevronRight size={16} className="transition-transform group-hover:translate-x-0.5" />
                  </>
                )}
              </button>
            </form>

            <p className="mt-6 text-center text-xs text-gray-500">
              Students use their school-issued code. Parents use the email you
              gave the school. Teachers and admins use their staff email.
            </p>
          </div>

          <div className="text-center mt-4 text-xs text-gray-400">
            Wrong school?{" "}
            <Link href="/login" className="text-gray-500 hover:underline">
              Sign in without a school link
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
