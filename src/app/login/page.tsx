"use client";

/**
 * /login — legacy top-level entry.
 *
 * Every school lives at /s/<slug>/login. This page:
 *   1. If the browser remembers a school (sf_last_school cookie), it
 *      redirects there on mount.
 *   2. Otherwise it shows a chooser (school slug -> /s/<slug>/login).
 *
 * The full student + parent sign-in form that used to live here is now
 * only rendered inside /s/<slug>/login/LoginForm.tsx, because a login
 * form without a school context can't decide where to send the user.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { GraduationCap, ChevronRight } from "lucide-react";

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

export default function LegacyLoginPage() {
  const router = useRouter();
  const [slugInput, setSlugInput] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // If someone reaches /login while ALREADY signed in, never make them
    // pick a school — route them where they belong:
    //   • platform super admin (profiles.role='developer' OR any active
    //     super_admin membership) -> Platform Admin. Super admins are
    //     independent of any school, so they must NOT see the chooser.
    //   • any other signed-in user -> their dashboard, which resolves
    //     their own org server-side.
    // Only a genuinely anonymous visitor sees the school chooser.
    let cancelled = false;
    // Hard safety net: if the session check hangs for any reason, fall back
    // to the chooser rather than an infinite "Loading…".
    const failSafe = setTimeout(() => { if (!cancelled) setChecking(false); }, 4000);

    (async () => {
      try {
        const supabase = createClient();
        const { data: { session } } = await supabase.auth.getSession();
        if (cancelled) return;
        if (!session?.user) { setChecking(false); return; }

        // Any authenticated session leaves the chooser immediately. We do a
        // HARD navigation to /dashboard (not router.replace) so no client
        // RSC/soft-nav loop can bounce us back to /login. /dashboard's own
        // role router then sends super admins to Platform Admin and everyone
        // else to their school view — no fragile RLS query needed here.
        window.location.replace("/dashboard");
      } catch {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => { cancelled = true; clearTimeout(failSafe); };
  }, [router]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const cleaned = slugInput.trim().toLowerCase();
    if (!cleaned) { setError("Enter your school's slug."); return; }
    if (!SLUG_RE.test(cleaned)) {
      setError("Slugs look like grant-schools — letters, digits and hyphens only.");
      return;
    }
    router.replace(`/s/${cleaned}/login`);
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F7F5F0]">
        <div className="text-sm text-gray-500">Loading&hellip;</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-[#F7F5F0]">
      <div className="w-full max-w-md">
        <Link href="/" className="flex items-center gap-3 mb-8 justify-center group">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#C9A227] to-[#8a6d1a] flex items-center justify-center transition-transform group-hover:scale-105">
            <GraduationCap size={22} className="text-white" />
          </div>
          <div>
            <div className="font-bold text-lg text-[#0F2A47]">Smart &amp; Thrive O/S</div>
            <div className="text-xs text-gray-500">School sign-in</div>
          </div>
        </Link>

        <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8">
          <h2 className="text-2xl font-bold text-[#0F2A47]">Which school?</h2>
          <p className="text-sm text-gray-500 mt-1 mb-5">
            Every sign-in lives under the school it belongs to. Enter your
            school&apos;s address slug and we&apos;ll take you there.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="slug" className="block text-xs font-semibold text-gray-600 mb-1.5">
                School Slug
              </label>
              <div className="flex items-stretch overflow-hidden rounded-lg border border-gray-300 bg-white focus-within:ring-2 focus-within:ring-[#C9A227]">
                <span className="px-3 flex items-center text-gray-400 text-sm font-mono">/s/</span>
                <input
                  id="slug"
                  type="text"
                  required
                  autoFocus
                  value={slugInput}
                  onChange={e => setSlugInput(e.target.value)}
                  placeholder="grant-schools"
                  className="flex-1 py-2.5 pr-3 bg-transparent text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none font-mono"
                />
                <span className="px-3 flex items-center text-gray-400 text-sm font-mono">/login</span>
              </div>
            </div>

            {error && (
              <div role="alert" className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
                {error}
              </div>
            )}

            <button
              type="submit"
              className="w-full py-2.5 rounded-lg bg-gradient-to-r from-[#C9A227] to-[#8a6d1a] text-white font-semibold text-sm hover:shadow-lg hover:shadow-[#C9A227]/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A227] focus-visible:ring-offset-2 transition-all flex items-center justify-center gap-2 group"
            >
              Continue <ChevronRight size={16} className="transition-transform group-hover:translate-x-0.5" />
            </button>
          </form>

          <p className="mt-6 text-center text-xs text-gray-500">
            Not sure of the slug? Ask your school administrator or check the
            URL of your school&apos;s public site.
          </p>
        </div>
      </div>
    </div>
  );
}
