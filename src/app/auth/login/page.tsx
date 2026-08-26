"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { GraduationCap, Sparkles, ShieldCheck, Users, BookOpen, ChevronRight, Eye, EyeOff, School, Mail, Lock, User, Award, TrendingUp, Lightbulb } from "lucide-react";

type Persona = "admin" | "teacher" | "parent" | "student";

export default function LoginPage() {
  const [tab, setTab] = useState<"signin" | "register">("signin");
  const [persona, setPersona] = useState<Persona>("admin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [studentCode, setStudentCode] = useState("");
  const [name, setName] = useState("");
  const [schoolCode, setSchoolCode] = useState("");
  const [schoolName, setSchoolName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const supabase = createClient();

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      let loginEmail = email;
      // For students: verify code via RPC (bypasses RLS safely) and get login email
      if (persona === "student" && studentCode) {
        const code = studentCode.trim().toUpperCase();
        const { data: verify, error: verifyErr } = await supabase.rpc("verify_student_code", { p_code: code });
        if (verifyErr) {
          setError("Login system error. Contact your school.");
          setLoading(false);
          return;
        }
        const result = verify as { exists: boolean; active: boolean; login_email: string; has_auth: boolean } | null;
        if (!result || !result.exists) {
          setError("Student code not found. Check with your school.");
          setLoading(false);
          return;
        }
        if (!result.active) {
          setError("This student account is not active. Contact your school.");
          setLoading(false);
          return;
        }
        if (!result.has_auth) {
          setError("Login not set up for this student. Contact your school.");
          setLoading(false);
          return;
        }
        loginEmail = result.login_email;
      }
      const { error } = await supabase.auth.signInWithPassword({ email: loginEmail, password });
      if (error) {
        setError(error.message);
        setLoading(false);
      } else {
        window.location.href = "/dashboard";
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Connection error — check your internet.";
      setError(msg);
      setLoading(false);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (!schoolCode.trim()) {
      setError("Please enter your school code. Your school administrator can give you this.");
      return;
    }
    setLoading(true);
    setError("");

    const { data: lookup, error: lookupErr } = await supabase.rpc("lookup_school_code", {
      p_code: schoolCode.trim(),
    });
    if (!lookupErr) {
      const result = lookup as { found?: boolean } | null;
      if (result && result.found === false) {
        setError("No active school found with that code. Check with your school administrator.");
        setLoading(false);
        return;
      }
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: name, school_code: schoolCode.trim() } },
    });
    if (error) {
      setError(error.message);
      setLoading(false);
    } else if (data.session) {
      const { error: joinErr } = await supabase.rpc("join_school_by_code", {
        p_code: schoolCode.trim(),
      });
      if (joinErr) console.warn("join_school_by_code failed:", joinErr.message);
      window.location.href = "/auth/pending";
    } else {
      setMessage("Check your email to confirm your account, then log in.");
      setLoading(false);
    }
  }

  const personaConfig: Record<Persona, { label: string; icon: React.ReactNode; identifier: string; description: string }> = {
    admin: { label: "Admin / Staff", icon: <ShieldCheck size={16} />, identifier: "email", description: "School administrators, teachers, and staff" },
    teacher: { label: "Teacher", icon: <BookOpen size={16} />, identifier: "email", description: "Teaching staff portal" },
    parent: { label: "Parent", icon: <Users size={16} />, identifier: "email", description: "View your children's progress" },
    student: { label: "Student", icon: <GraduationCap size={16} />, identifier: "student_code", description: "Access your exams, results, and portal" },
  };

  const currentPersona = personaConfig[persona];

  return (
    <div className="min-h-screen flex bg-gradient-to-br from-[#0F2A47] via-[#1a3f6b] to-[#0F2A47]">
      {/* Left: Marketing Panel */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden">
        {/* Decorative gradient blobs */}
        <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-[#C9A227]/20 blur-3xl" />
        <div className="absolute bottom-0 right-0 w-96 h-96 rounded-full bg-[#C9A227]/10 blur-3xl" />
        <div className="absolute top-1/3 left-1/4 w-64 h-64 rounded-full bg-white/5 blur-2xl" />

        <div className="relative z-10 flex flex-col justify-between p-12 text-white w-full">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#C9A227] to-[#8a6d1a] flex items-center justify-center shadow-lg shadow-[#C9A227]/30">
              <GraduationCap size={26} className="text-white" />
            </div>
            <div>
              <div className="font-bold text-xl">Grant Schools</div>
              <div className="text-xs text-white/60">School Management Platform</div>
            </div>
          </div>

          <div className="space-y-8">
            <div>
              <div className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-[#C9A227]/20 border border-[#C9A227]/30 text-[#C9A227] text-xs font-semibold mb-4">
                <Sparkles size={12} /> Everything a school needs
              </div>
              <h1 className="text-4xl font-bold leading-tight">
                Run your school<br />like the best in the world.
              </h1>
              <p className="text-white/70 text-lg mt-4 max-w-md leading-relaxed">
                Finance, academics, admissions, communications, and reporting — one clean platform, built for African schools.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4 max-w-md">
              <div className="p-4 rounded-xl bg-white/5 backdrop-blur border border-white/10">
                <Award size={20} className="text-[#C9A227] mb-2" />
                <div className="font-semibold text-sm">Trusted by Schools</div>
                <div className="text-xs text-white/60 mt-1">Multi-tenant secure</div>
              </div>
              <div className="p-4 rounded-xl bg-white/5 backdrop-blur border border-white/10">
                <TrendingUp size={20} className="text-[#C9A227] mb-2" />
                <div className="font-semibold text-sm">Realtime Insights</div>
                <div className="text-xs text-white/60 mt-1">Data-driven decisions</div>
              </div>
              <div className="p-4 rounded-xl bg-white/5 backdrop-blur border border-white/10">
                <Users size={20} className="text-[#C9A227] mb-2" />
                <div className="font-semibold text-sm">Parent Portal</div>
                <div className="text-xs text-white/60 mt-1">Engage families</div>
              </div>
              <div className="p-4 rounded-xl bg-white/5 backdrop-blur border border-white/10">
                <Lightbulb size={20} className="text-[#C9A227] mb-2" />
                <div className="font-semibold text-sm">CBT & Exams</div>
                <div className="text-xs text-white/60 mt-1">Fully online</div>
              </div>
            </div>
          </div>

          <div className="text-xs text-white/40">
            © {new Date().getFullYear()} Grant Schools. All rights reserved.
          </div>
        </div>
      </div>

      {/* Right: Login Card */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-3 mb-8 justify-center">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#C9A227] to-[#8a6d1a] flex items-center justify-center">
              <GraduationCap size={22} className="text-white" />
            </div>
            <div className="text-white">
              <div className="font-bold text-lg">Grant Schools</div>
              <div className="text-xs text-white/60">Management Platform</div>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-2xl border border-white/10 p-8">
            {/* Tabs */}
            <div className="flex gap-1 p-1 rounded-xl bg-gray-100 mb-6">
              <button
                onClick={() => { setTab("signin"); setError(""); setMessage(""); }}
                className={`flex-1 py-2 px-4 text-sm font-semibold rounded-lg transition-all ${
                  tab === "signin" ? "bg-white shadow-sm text-[#0F2A47]" : "text-gray-500 hover:text-gray-700"
                }`}
              >
                Sign In
              </button>
              <button
                onClick={() => { setTab("register"); setError(""); setMessage(""); }}
                className={`flex-1 py-2 px-4 text-sm font-semibold rounded-lg transition-all ${
                  tab === "register" ? "bg-white shadow-sm text-[#0F2A47]" : "text-gray-500 hover:text-gray-700"
                }`}
              >
                Register School
              </button>
            </div>

            {tab === "signin" ? (
              <>
                <h2 className="text-2xl font-bold text-[#0F2A47]">Welcome back</h2>
                <p className="text-sm text-gray-500 mt-1 mb-5">Sign in as a <span className="font-semibold">{currentPersona.label}</span></p>

                {/* Persona chips */}
                <div className="grid grid-cols-4 gap-1.5 mb-5">
                  {(Object.entries(personaConfig) as [Persona, typeof personaConfig[Persona]][]).map(([key, cfg]) => (
                    <button
                      key={key}
                      onClick={() => { setPersona(key); setError(""); }}
                      className={`p-2 rounded-lg text-xs font-semibold transition-all border ${
                        persona === key
                          ? "bg-[#C9A227] text-white border-[#C9A227] shadow"
                          : "bg-white text-gray-600 border-gray-200 hover:border-[#C9A227]"
                      }`}
                    >
                      <div className="flex justify-center mb-1">{cfg.icon}</div>
                      {cfg.label.split(" ")[0]}
                    </button>
                  ))}
                </div>

                <form onSubmit={handleSignIn} className="space-y-4">
                  {persona === "student" ? (
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1.5">Student Code</label>
                      <div className="relative">
                        <GraduationCap size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                          type="text"
                          required
                          value={studentCode}
                          onChange={e => setStudentCode(e.target.value.toUpperCase())}
                          placeholder="e.g. GS-2025-001"
                          className="w-full pl-10 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227] font-mono"
                        />
                      </div>
                    </div>
                  ) : (
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1.5">Email Address</label>
                      <div className="relative">
                        <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                          type="email"
                          required
                          value={email}
                          onChange={e => setEmail(e.target.value)}
                          placeholder="you@school.com"
                          className="w-full pl-10 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
                        />
                      </div>
                    </div>
                  )}

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-semibold text-gray-600">Password</label>
                      <Link href="/auth/forgot-password" className="text-xs text-[#C9A227] hover:underline">Forgot?</Link>
                    </div>
                    <div className="relative">
                      <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        type={showPassword ? "text" : "password"}
                        required
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full pl-10 pr-10 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      >
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>

                  {error && (
                    <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
                      {error}
                    </div>
                  )}
                  {message && (
                    <div className="p-3 rounded-lg bg-green-50 border border-green-200 text-sm text-green-700">
                      {message}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-2.5 rounded-lg bg-gradient-to-r from-[#C9A227] to-[#8a6d1a] text-white font-semibold text-sm hover:shadow-lg hover:shadow-[#C9A227]/30 transition-all disabled:opacity-60 flex items-center justify-center gap-2"
                  >
                    {loading ? "Signing in…" : (<>Sign In <ChevronRight size={16} /></>)}
                  </button>
                </form>
              </>
            ) : (
              <>
                <h2 className="text-2xl font-bold text-[#0F2A47]">Register Your School</h2>
                <p className="text-sm text-gray-500 mt-1 mb-5">Join with your school code</p>
                <form onSubmit={handleRegister} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5">Full Name</label>
                    <div className="relative">
                      <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input type="text" required value={name} onChange={e => setName(e.target.value)}
                        className="w-full pl-10 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5">School Code</label>
                    <div className="relative">
                      <School size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input type="text" required value={schoolCode} onChange={e => setSchoolCode(e.target.value)}
                        placeholder="Ask your school admin"
                        className="w-full pl-10 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227] font-mono" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5">Email</label>
                    <div className="relative">
                      <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
                        className="w-full pl-10 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5">Password</label>
                    <div className="relative">
                      <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input type={showPassword ? "text" : "password"} required value={password} onChange={e => setPassword(e.target.value)}
                        className="w-full pl-10 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]" />
                    </div>
                  </div>
                  {error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>}
                  {message && <div className="p-3 rounded-lg bg-green-50 border border-green-200 text-sm text-green-700">{message}</div>}
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-2.5 rounded-lg bg-gradient-to-r from-[#C9A227] to-[#8a6d1a] text-white font-semibold text-sm hover:shadow-lg hover:shadow-[#C9A227]/30 transition-all disabled:opacity-60 flex items-center justify-center gap-2"
                  >
                    {loading ? "Creating…" : (<>Create Account <ChevronRight size={16} /></>)}
                  </button>
                </form>
              </>
            )}

            <div className="mt-6 pt-5 border-t border-gray-100 text-center text-xs text-gray-500">
              {currentPersona.description}
            </div>
          </div>

          <div className="text-center mt-4 text-xs text-white/50">
            Secure enterprise-grade authentication · Powered by Grant Schools
          </div>
        </div>
      </div>
    </div>
  );
}
