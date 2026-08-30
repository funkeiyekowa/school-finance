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
  /** organizations.status, when the brand RPC resolved. */
  status?: string | null;
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

/* Module-scope helpers so they aren't nested function declarations inside
   the component (which trips TS strict-mode inside blocks). */
// Accept anything thenable (Supabase PostgrestBuilder is not strictly a Promise
// under TS but resolves like one). Coerce via Promise.resolve.
function raceWithTimeout(pr: unknown, ms: number): Promise<{ data: unknown } | null> {
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), ms));
  return Promise.race([
    Promise.resolve(pr as PromiseLike<{ data: unknown }>),
    timeout,
  ]) as Promise<{ data: unknown } | null>;
}
function raceWithTimeoutRpc(
  pr: unknown,
  ms: number,
): Promise<{ data: unknown; error: { message: string } | null }> {
  const timeout = new Promise<{ data: null; error: { message: string } }>((resolve) =>
    setTimeout(() => resolve({ data: null, error: { message: "timeout" } }), ms),
  );
  return Promise.race([
    Promise.resolve(pr as PromiseLike<{ data: unknown; error: { message: string } | null }>),
    timeout,
  ]) as Promise<{ data: unknown; error: { message: string } | null }>;
}

export default function SchoolLoginForm({ slug, schoolName, logoUrl, found, status }: Props) {
  // Org lifecycle: 'active' and 'trial' are the only states that should
  // accept new sign-ins. 'suspended' and 'cancelled' orgs return found=true
  // from the brand RPC but must not admit users — surface a clear banner
  // instead of a generic auth failure downstream.
  const orgSuspended = found && status !== undefined && status !== null
    && status !== "active" && status !== "trial";
  const supabase = createClient();
  const router = useRouter();
  const [persona, setPersona] = useState<"student" | "parent">("student");
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
    if (orgSuspended) {
      setError(`This school's account is currently ${status}. Please contact the school administrator.`);
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

      // 3a. Refuse super-admin AND staff sign-in on this URL.
      //     Each subquery times out after 4 s and soft-fails (returns null)
      //     rather than blocking the whole login flow. If we truly cannot
      //     tell whether the user is staff, we prefer to let them through
      //     to resolve_login_context, which is the authoritative gate.
      if (signData.user) {
        const [profRes, memRes, staffRes] = await Promise.all([
          raceWithTimeout(supabase.from("profiles").select("role").eq("id", signData.user.id).maybeSingle(), 4000),
          raceWithTimeout(supabase.from("org_memberships").select("role").eq("user_id", signData.user.id).limit(20), 4000),
          raceWithTimeout(supabase.from("staff_members").select("id").eq("user_id", signData.user.id).limit(1), 4000),
        ]);

        const pr = (profRes?.data ?? null) as { role?: string } | null;
        const mArr = (memRes?.data ?? []) as { role: string }[];
        const staffArr = (staffRes?.data ?? []) as unknown[];

        const isSuperAdmin =
          mArr.some((x) => x.role === "super_admin") ||
          pr?.role === "super_admin" ||
          pr?.role === "developer";
        if (isSuperAdmin) {
          await supabase.auth.signOut();
          setError("Invalid email or password.");
          setLoading(false);
          return;
        }
        const isStaff =
          staffArr.length > 0 ||
          mArr.some((x) => ["owner", "admin", "editor", "staff", "teacher"].includes(x.role)) ||
          (pr?.role ? ["owner", "admin", "editor", "staff", "teacher"].includes(pr.role) : false);
        if (isStaff) {
          await supabase.auth.signOut();
          setError(`Staff accounts sign in at the Staff Portal. Please visit /s/${slug}/staff-portal.`);
          setLoading(false);
          return;
        }
      }

      // 3. Resolve role for THIS school. 8-second timeout so a slow
      //    Postgres reply doesn't leave the button spinning forever.
      const rpcResult = await raceWithTimeoutRpc(
        supabase.rpc("resolve_login_context", { p_slug: slug }),
        8000
      );
      const ctxData = (rpcResult as { data: unknown }).data;
      const ctxErr = (rpcResult as { error?: { message: string } | null }).error ?? null;
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

      // Enforce the persona tab (item 2): a Parent tab requires role=parent;
      // a Student tab requires role=student.
      if (persona === "parent" && ctx.role !== "parent") {
        await supabase.auth.signOut();
        setError("This account is not a parent account. Switch to the Student tab or contact your school.");
        setLoading(false);
        return;
      }
      if (persona === "student" && ctx.role !== "student") {
        await supabase.auth.signOut();
        setError("This account is not a student account. Switch to the Parent tab or contact your school.");
        setLoading(false);
        return;
      }

      // Remember which school + portal this user came in through so
      // middleware and sign-out can route them back correctly.
      try {
        document.cookie = `sf_last_school=${encodeURIComponent(slug)}; path=/; max-age=${60 * 60 * 24 * 90}; samesite=lax`;
        document.cookie = `sf_last_portal=student; path=/; max-age=${60 * 60 * 24 * 90}; samesite=lax`;
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
            <h2 className="text-2xl font-bold text-[#0F2A47]">
              {persona === "parent" ? "Parent Login" : "Student Login"}
            </h2>
            <p className="text-sm text-gray-500 mt-1 mb-5">
              {persona === "parent"
                ? "Sign in with the email address you gave the school."
                : "Sign in with your student code or the email issued by your school."}
            </p>

            {/* Persona tabs — student first, parent second */}
            <div className="grid grid-cols-2 gap-1.5 mb-5 p-1 bg-gray-100 rounded-lg">
              <button
                type="button"
                onClick={() => { setPersona("student"); setError(""); }}
                className={`py-2 px-3 rounded-md text-sm font-semibold transition-all flex items-center justify-center gap-1.5 ${
                  persona === "student" ? "bg-[#0F2A47] text-white shadow" : "text-gray-600 hover:text-gray-900"
                }`}
              >
                <GraduationCap size={14} /> Student
              </button>
              <button
                type="button"
                onClick={() => { setPersona("parent"); setError(""); }}
                className={`py-2 px-3 rounded-md text-sm font-semibold transition-all flex items-center justify-center gap-1.5 ${
                  persona === "parent" ? "bg-[#0F2A47] text-white shadow" : "text-gray-600 hover:text-gray-900"
                }`}
              >
                <User size={14} /> Parent
              </button>
            </div>

            {orgSuspended && (
              <div role="alert" className="mb-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <span className="font-semibold">{schoolName}</span> is currently <span className="font-semibold">{status}</span> on the platform. Sign-in is disabled until an administrator reactivates the account.
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="identifier" className="block text-xs font-semibold text-gray-600 mb-1.5">
                  {persona === "parent" ? "Email address" : "Email or Student Code"}
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
                    placeholder={persona === "parent" ? "you@example.com" : "S288 or you@school.com"}
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
                disabled={loading || orgSuspended}
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
              {persona === "parent"
                ? "This is the Parent Portal. Teachers and admins should use the Staff Portal."
                : "Students use the school-issued code. Parents should switch to the Parent tab."}
            </p>
          </div>

        </div>
      </div>
    </div>
  );
}
