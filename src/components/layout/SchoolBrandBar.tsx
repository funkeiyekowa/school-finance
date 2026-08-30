"use client";

/**
 * Persistent school header shown at the top of every dashboard page.
 *
 * Reads the active org from AuthContext (already loaded once at the
 * layout level, so this component makes no extra network calls) and
 * renders the school name + logo + slug. Purpose: users should always
 * be able to tell which school they are currently signed in to at a
 * glance, without having to open the sidebar org switcher. Especially
 * useful for support sessions and for parents/students who might have
 * multiple children across schools in the future.
 *
 * Hidden entirely when no org is set (very brief window during boot).
 */

import { useAuth } from "@/lib/context/AuthContext";
import { School } from "lucide-react";

export function SchoolBrandBar() {
  const { org } = useAuth();
  if (!org) return null;

  return (
    <div className="shrink-0 flex items-center gap-3 px-5 py-2.5 bg-white border-b border-gray-100">
      {org.logo_url ? (
        // Explicit <img> because Next Image needs a configured remote host,
        // and these logos live on user-controlled Supabase storage.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={org.logo_url}
          alt={org.name || "School logo"}
          className="w-9 h-9 rounded-lg object-cover border border-gray-100"
        />
      ) : (
        <div className="w-9 h-9 rounded-lg bg-[#0F2A47] text-[#C9A227] flex items-center justify-center">
          <School size={18} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="font-bold text-sm text-[#0F2A47] leading-tight truncate">
          {org.name || "Your school"}
        </div>
        {org.slug && (
          <div className="text-[11px] text-gray-500 font-mono tracking-wide truncate">
            /{org.slug}
          </div>
        )}
      </div>
    </div>
  );
}
