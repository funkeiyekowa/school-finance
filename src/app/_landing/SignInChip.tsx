"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LogIn } from "lucide-react";
import { readLastSchoolSlug } from "@/lib/auth/signOutToSchoolLogin";

/**
 * Landing-page "Sign in" chip.
 *
 * Reads the sf_last_school cookie on mount and, if present, points to
 * /s/<slug>/login. Otherwise falls back to /login (the chooser). Rendered
 * on the client so we can read the cookie without cache-busting the whole
 * marketing page.
 */
export default function LandingSignInChip({ variant = "light" }: { variant?: "light" | "dark" }) {
  const [href, setHref] = useState("/login");

  useEffect(() => {
    const slug = readLastSchoolSlug();
    if (slug) setHref(`/s/${slug}/login`);
  }, []);

  if (variant === "dark") {
    return (
      <Link
        href={href}
        className="inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold text-white/90 border border-white/25 hover:bg-white/10 transition-colors"
      >
        <LogIn size={14} /> Sign in
      </Link>
    );
  }

  return (
    <Link
      href={href}
      className="hidden sm:inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold text-[#0F2A47] hover:bg-black/5 transition-colors"
    >
      <LogIn size={13} /> Sign in
    </Link>
  );
}
