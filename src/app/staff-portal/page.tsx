"use client";

/**
 * /staff-portal — legacy top-level entry.
 *
 * Staff portal is now school-scoped at /s/<slug>/staff-portal. This page:
 *   1. If the browser remembers a school (sf_last_school cookie), it
 *      redirects there on mount.
 *   2. Otherwise it shows a small chooser that lets the user type their
 *      school's slug and submit — the form POSTs (client-side) to
 *      /s/<slug>/staff-portal.
 *
 * Kept as a client component so we can read cookies without hitting the
 * server. Visual language mirrors the deep-navy + gold of the school-
 * scoped staff portal.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { ShieldCheck, ChevronRight } from "lucide-react";

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

export default function StaffPortalLegacyPage() {
  const router = useRouter();
  const [slugInput, setSlugInput] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // A signed-in user must never be asked "which school?" here. Route a
    // platform super admin straight to Platform Admin (they're independent
    // of any school), and any other signed-in user to their dashboard.
    // Only an anonymous visitor sees the school chooser.
    let cancelled = false;
    const failSafe = setTimeout(() => { if (!cancelled) setChecking(false); }, 4000);

    (async () => {
      try {
        const supabase = createClient();
        const { data: { session } } = await supabase.auth.getSession();
        if (cancelled) return;
        if (!session?.user) { setChecking(false); return; }
        // Any authenticated session: hard-navigate to /dashboard, whose role
        // router sends super admins to Platform Admin and everyone else to
        // their school. Never make a signed-in user pick a school here.
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
    router.replace(`/s/${cleaned}/staff-portal`);
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "#0a1929" }}>
        <div className="text-white/60 text-sm">Loading&hellip;</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ backgroundColor: "#0a1929" }}>
      <div className="w-full max-w-md">
        <Link href="/" className="flex items-center gap-3 mb-8 justify-center group">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#D4AF37] to-[#7a5f14] flex items-center justify-center transition-transform group-hover:scale-105">
            <ShieldCheck size={22} className="text-[#0a1929]" />
          </div>
          <div className="text-white">
            <div className="font-bold text-lg">Smart &amp; Thrive O/S</div>
            <div className="text-xs text-[#D4AF37]/70 uppercase tracking-wider">Staff Portal</div>
          </div>
        </Link>

        <div className="bg-[#0f2438] rounded-2xl shadow-2xl border border-[#D4AF37]/20 p-8">
          <h2 className="text-2xl font-bold text-white">Which school?</h2>
          <p className="text-sm text-white/60 mt-1 mb-5">
            Every staff sign-in lives under the school it belongs to. Enter
            your school&apos;s address slug and we&apos;ll take you there.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="slug" className="block text-xs font-semibold text-white/70 mb-1.5">
                School Slug
              </label>
              <div className="flex items-stretch overflow-hidden rounded-lg border border-white/10 bg-black/20 focus-within:ring-2 focus-within:ring-[#D4AF37]">
                <span className="px-3 flex items-center text-white/40 text-sm font-mono">/s/</span>
                <input
                  id="slug"
                  type="text"
                  required
                  autoFocus
                  value={slugInput}
                  onChange={e => setSlugInput(e.target.value)}
                  placeholder="grant-schools"
                  className="flex-1 py-2.5 pr-3 bg-transparent text-sm text-white placeholder:text-white/30 focus:outline-none font-mono"
                />
                <span className="px-3 flex items-center text-white/40 text-sm font-mono">/staff-portal</span>
              </div>
            </div>

            {error && (
              <div role="alert" className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300">
                {error}
              </div>
            )}

            <button
              type="submit"
              className="w-full py-2.5 rounded-lg bg-gradient-to-r from-[#D4AF37] to-[#7a5f14] text-[#0a1929] font-semibold text-sm hover:shadow-lg hover:shadow-[#D4AF37]/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f2438] transition-all flex items-center justify-center gap-2 group"
            >
              Continue <ChevronRight size={16} className="transition-transform group-hover:translate-x-0.5" />
            </button>
          </form>

          <p className="mt-6 text-center text-xs text-white/40">
            Not sure of the slug? Ask your school administrator or check the
            URL of your school&apos;s public site.
          </p>
        </div>
      </div>
    </div>
  );
}
