"use client";

/**
 * Organization switcher.
 *
 * Shows the active tenant and lets the user move between the schools they
 * belong to. Platform admins additionally see every organization, marked as
 * support access.
 *
 * The switch itself is a server-side RPC (see AuthContext.switchOrg) because
 * RLS resolves the tenant from org_memberships.is_default — changing it only
 * in the client would display a new school name while still reading the old
 * school's data.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/context/AuthContext";
import { cn } from "@/lib/utils";
import { Check, ChevronsUpDown, Building2, LifeBuoy, Search, AlertTriangle } from "lucide-react";

export function OrgSwitcher({ collapsed = false }: { collapsed?: boolean }) {
  const router = useRouter();
  const { org, orgId, availableOrgs, switchOrg, switchingOrg, isSupportSession, membership } = useAuth();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return availableOrgs;
    return availableOrgs.filter(
      (o) => o.name.toLowerCase().includes(q) || (o.slug ?? "").toLowerCase().includes(q)
    );
  }, [availableOrgs, query]);

  const members = filtered.filter((o) => !o.is_support_access);
  const supportOnly = filtered.filter((o) => o.is_support_access);

  // Nothing to switch between and no org loaded: stay out of the way.
  if (!org && availableOrgs.length === 0) return null;

  async function handleSelect(targetId: string) {
    setError(null);
    const res = await switchOrg(targetId);
    if (!res.ok) {
      setError(res.error ?? "Could not switch organization");
      return;
    }
    setOpen(false);
    setQuery("");
    // Data on the current page belongs to the previous tenant.
    router.refresh();
  }

  const single = availableOrgs.length <= 1;

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => !single && setOpen((v) => !v)}
        disabled={switchingOrg}
        aria-haspopup={single ? undefined : "listbox"}
        aria-expanded={single ? undefined : open}
        aria-label={single ? `Active school: ${org?.name ?? "None"}` : "Switch school"}
        className={cn(
          "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors",
          single ? "cursor-default" : "hover:bg-[#1B3E63] cursor-pointer",
          switchingOrg && "opacity-60"
        )}
      >
        <div className="w-7 h-7 rounded-md bg-[#C9A227] flex items-center justify-center shrink-0 overflow-hidden">
          {org?.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={org.logo_url} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="text-[#0F2A47] text-xs font-bold">
              {(org?.name ?? "?").charAt(0).toUpperCase()}
            </span>
          )}
        </div>

        {!collapsed && (
          <>
            <div className="flex-1 min-w-0">
              <div className="text-white text-sm font-semibold truncate leading-tight">
                {org?.name ?? "No school selected"}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[#C9A227] text-[10px] uppercase tracking-wide font-bold truncate">
                  {membership?.role?.replace("_", " ") ?? org?.plan ?? ""}
                </span>
                {isSupportSession && (
                  <span className="inline-flex items-center gap-0.5 text-[9px] font-bold text-amber-300 bg-amber-900/40 px-1 rounded">
                    <LifeBuoy size={8} /> SUPPORT
                  </span>
                )}
              </div>
            </div>
            {!single && (
              <ChevronsUpDown size={14} className="text-[#7A9EC0] shrink-0" />
            )}
          </>
        )}
      </button>

      {switchingOrg && !collapsed && (
        <div className="px-2.5 pb-1 text-[10px] text-[#7A9EC0]">Switching tenant…</div>
      )}

      {error && !collapsed && (
        <div className="mx-2 mb-2 flex items-start gap-1.5 text-[10px] text-red-200 bg-red-900/40 rounded p-1.5">
          <AlertTriangle size={10} className="mt-px shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {open && !single && (
        <div
          role="listbox"
          className="absolute z-50 left-2 right-2 mt-1 bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden"
        >
          {availableOrgs.length > 6 && (
            <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100">
              <Search size={13} className="text-gray-400 shrink-0" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find a school"
                aria-label="Find a school"
                className="w-full text-xs outline-none placeholder:text-gray-400"
              />
            </div>
          )}

          <div className="max-h-72 overflow-y-auto py-1">
            {members.length > 0 && (
              <div className="px-3 pt-1 pb-0.5 text-[10px] font-bold uppercase tracking-wide text-gray-400">
                Your schools
              </div>
            )}
            {members.map((o) => (
              <OrgRow
                key={o.organization_id}
                name={o.name}
                slug={o.slug}
                role={o.membership_role}
                status={o.status}
                active={o.organization_id === orgId}
                onSelect={() => handleSelect(o.organization_id)}
              />
            ))}

            {supportOnly.length > 0 && (
              <div className="px-3 pt-2 pb-0.5 text-[10px] font-bold uppercase tracking-wide text-gray-400 flex items-center gap-1 border-t border-gray-100 mt-1">
                <LifeBuoy size={9} /> Support access
              </div>
            )}
            {supportOnly.map((o) => (
              <OrgRow
                key={o.organization_id}
                name={o.name}
                slug={o.slug}
                role="platform admin"
                status={o.status}
                support
                active={o.organization_id === orgId}
                onSelect={() => handleSelect(o.organization_id)}
              />
            ))}

            {filtered.length === 0 && (
              <div className="px-3 py-4 text-xs text-gray-400 text-center">No schools match.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function OrgRow({
  name, slug, role, status, active, support, onSelect,
}: {
  name: string;
  slug: string;
  role: string;
  status: string | null;
  active: boolean;
  support?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={onSelect}
      className={cn(
        "w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-gray-50 transition-colors",
        active && "bg-[#FBF6E8]"
      )}
    >
      <div className={cn(
        "w-6 h-6 rounded flex items-center justify-center shrink-0 text-[10px] font-bold",
        support ? "bg-amber-100 text-amber-700" : "bg-[#0F2A47] text-[#C9A227]"
      )}>
        {support ? <LifeBuoy size={11} /> : name.charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold text-gray-900 truncate">{name}</div>
        <div className="text-[10px] text-gray-500 truncate">
          {role.replace("_", " ")}
          {slug ? ` · ${slug}` : ""}
        </div>
      </div>
      {status && status !== "active" && (
        <span className={cn(
          "text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0",
          status === "trial" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"
        )}>
          {status}
        </span>
      )}
      {active && <Check size={13} className="text-[#C9A227] shrink-0" />}
    </button>
  );
}

/**
 * Compact always-visible badge for the active tenant. Used in the mobile top
 * bar so the operating context is never ambiguous.
 */
export function ActiveOrgBadge() {
  const { org, isSupportSession } = useAuth();
  if (!org) return null;
  return (
    <span className="inline-flex items-center gap-1.5 max-w-[10rem]">
      <Building2 size={12} className="text-[#C9A227] shrink-0" />
      <span className="truncate text-xs font-semibold">{org.name}</span>
      {isSupportSession && (
        <span className="text-[9px] font-bold text-amber-300 bg-amber-900/40 px-1 rounded shrink-0">
          SUPPORT
        </span>
      )}
    </span>
  );
}
