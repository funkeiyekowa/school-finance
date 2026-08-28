"use client";

/**
 * /login — Student + Parent unified sign-in.
 *
 * Design brief: premium split layout, brand mark, background image
 * slot from public/login-bg-student.svg, micro-animations on hover,
 * accessible focus rings. Persona is a segmented toggle. Students
 * sign in by code; parents by email.
 */

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { GraduationCap, Users, Eye, EyeOff, Mail, Lock, ChevronRight, User } from "lucide-react";

type Persona = "student" | "parent";

export default function LoginPage() {
  const supabase = createClient();
  const [persona, setPersona] = useState<Persona>("student");
  const [studentCode, setStudentCode] = useState("");
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
      let loginEmail = email;
      if (persona === "student") {
        const code = studentCode.trim().toUpperCase();
        if (!code) { setError("Enter your student code."); setLoading(false); return; }
        const { data: verify, error: verifyErr } = await supabase.rpc("verify_student_code", { p_code: code });
        if (verifyErr) { setError("Login system error. Contact your school."); setLoading(false); return; }
        const result = verify as { exists: boolean; active: boolean; login_email: string; has_auth: boolean } | null;
        if (!result?.exists) { setError("Student code not found. Check with your school."); setLoading(false); return; }
        if (!result.active) { setError("This student account is not active."); setLoading(false); return; }
        if (!result.has_auth) { setError("Login not set up for this student. Contact your school."); setLoading(false); return; }
        loginEmail = result.login_email;
      }
      const { data: authData, error: signErr } = await supabase.auth.signInWithPassword({ email: loginEmail, password });
      if (signErr) { setError(signErr.message); setLoading(false); return; }

      // Route by role.
      const metaRole = (authData?.user?.app_metadata as { role?: string } | undefined)?.role;
      let role = metaRole;
      if (!role && authData?.user) {
        const { data: prof } = await supabase.from("profiles").select("role").eq("id", authData.user.id).maybeSingle();
        role = (prof as { role?: string } | null)?.role;
      }
      let dest = "/dashboard";
      if (role === "student") dest = "/dashboard/student-portal";
      else if (role === "parent") dest = "/dashboard/parent-portal";
      window.location.href = dest;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection error - check your internet.");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex">
      {/* Left: brand marketing panel */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden text-white"
        style={{
          backgroundImage: "url(/login-bg-student.svg)",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}>
        <div className="relative z-10 flex flex-col justify-between p-12 w-full">
          <Link href="/" className="flex items-center gap-3 group">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#C9A227] to-[#8a6d1a] flex items-center justify-center shadow-lg shadow-[#C9A227]/30 transition-transform group-hover:scale-105">
              <GraduationCap size={26} className="text-white" />
            </div>
            <div>
              <div className="font-bold text-xl">Grant Schools</div>
              <div className="text-xs text-white/60">Student &amp; Parent Portal</div>
            </div>
          </Link>

          <div className="space-y-6">
            <h1 className="text-4xl font-bold leading-tight">
              Your learning<br />
              <span className="text-[#C9A227]">at your fingertips.</span>
            </h1>
            <p className="text-white/70 text-lg max-w-md leading-relaxed">
              Exams, results, attendance, announcements &mdash; every child&apos;s
              journey, tracked in one place your family can trust.
            </p>
            <ul className="space-y-2 text-sm text-white/60">
              <li className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-[#C9A227]" /> View report cards the day they publish</li>
              <li className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-[#C9A227]" /> Sit CBTs from any device</li>
              <li className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-[#C9A227]" /> Read announcements as they happen</li>
            </ul>
          </div>

          <div className="text-xs text-white/40">
            &copy; {new Date().getFullYear()} Grant Schools &middot; secure &amp; private
          </div>
        </div>
      </div>

      {/* Right: login card */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-12 bg-[#F7F5F0]">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <Link href="/" className="lg:hidden flex items-center gap-3 mb-8 justify-center group">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#C9A227] to-[#8a6d1a] flex items-center justify-center transition-transform group-hover:scale-105">
              <GraduationCap size={22} className="text-white" />
            </div>
            <div>
              <div className="font-bold text-lg text-[#0F2A47]">Grant Schools</div>
              <div className="text-xs text-gray-500">Student &amp; Parent Portal</div>
            </div>
          </Link>

          <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8">
            <h2 className="text-2xl font-bold text-[#0F2A47]">Welcome back</h2>
            <p className="text-sm text-gray-500 mt-1 mb-5">Sign in as a <span className="font-semibold">{persona}</span></p>

            {/* Persona toggle */}
            <div className="grid grid-cols-2 gap-1.5 mb-5 p-1 bg-gray-100 rounded-lg">
              <button
                type="button"
                onClick={() => setPersona("student")}
                className={`py-2 px-3 rounded-md text-sm font-semibold transition-all flex items-center justify-center gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A227] ${
                  persona === "student" ? "bg-white shadow text-[#0F2A47]" : "text-gray-500 hover:text-gray-700"
                }`}
              >
                <GraduationCap size={14} /> Student
              </button>
              <button
                type="button"
                onClick={() => setPersona("parent")}
                className={`py-2 px-3 rounded-md text-sm font-semibold transition-all flex items-center justify-center gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A227] ${
                  persona === "parent" ? "bg-white shadow text-[#0F2A47]" : "text-gray-500 hover:text-gray-700"
                }`}
              >
                <Users size={14} /> Parent
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {persona === "student" ? (
                <div>
                  <label htmlFor="studentCode" className="block text-xs font-semibold text-gray-600 mb-1.5">Student Code</label>
                  <div className="relative">
                    <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      id="studentCode"
                      type="text"
                      required
                      value={studentCode}
                      onChange={e => setStudentCode(e.target.value.toUpperCase())}
                      placeholder="e.g. S288"
                      className="w-full pl-10 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227] font-mono tracking-wider"
                    />
                  </div>
                </div>
              ) : (
                <div>
                  <label htmlFor="email" className="block text-xs font-semibold text-gray-600 mb-1.5">Email Address</label>
                  <div className="relative">
                    <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      id="email"
                      type="email"
                      required
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder="parent@example.com"
                      className="w-full pl-10 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
                    />
                  </div>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="password" className="text-xs font-semibold text-gray-600">Password</label>
                  <Link href="/auth/forgot-password" className="text-xs text-[#C9A227] hover:underline">Forgot?</Link>
                </div>
                <div className="relative">
                  <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    required
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    className="w-full pl-10 pr-10 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none focus-visible:text-[#0F2A47]"
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
                {loading ? "Signing in…" : (<>Sign In <ChevronRight size={16} className="transition-transform group-hover:translate-x-0.5" /></>)}
              </button>
            </form>

            <p className="mt-6 text-center text-xs text-gray-500">
              {persona === "student"
                ? "Ask your class teacher for your student code."
                : "Use the email you gave the school as your child's guardian."}
            </p>
          </div>

          <div className="text-center mt-4 text-xs text-gray-400">
            Are you staff? <span className="text-gray-500">Staff access is via your school administrator&apos;s direct link.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
