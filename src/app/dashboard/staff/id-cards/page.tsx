"use client";

/**
 * Bulk-printable staff ID cards.
 *
 * Accepts a `?ids=<comma-list>` (or defaults to all active staff)
 * and renders 4-per-A4-page CR80-ish cards with the school's
 * branding (logo, name, colours). One click prints or saves to PDF.
 */

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useBranding } from "@/lib/hooks/useBranding";
import { useAuth } from "@/lib/context/AuthContext";
import { LoadingSpinner } from "@/components/ui/PageHeader";
import { Printer } from "lucide-react";

interface Staff {
  id: string; staff_code: string; full_name: string;
  job_title: string | null; email: string | null; phone: string | null;
  department_id: string | null; date_joined: string | null;
}
interface Dept { id: string; name: string; }

export default function StaffIdCardsPage() {
  return (
    <Suspense fallback={<div className="p-8"><LoadingSpinner /></div>}>
      <Inner />
    </Suspense>
  );
}

function Inner() {
  const params = useSearchParams();
  const supabase = useMemo(() => createClient(), []);
  const { orgId } = useAuth();
  const branding = useBranding();

  const [staff, setStaff] = useState<Staff[]>([]);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [loading, setLoading] = useState(true);
  const ids = (params.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);

  useEffect(() => {
    if (!orgId) return;
    (async () => {
      let q = supabase.from("staff").select("id, staff_code, full_name, job_title, email, phone, department_id, date_joined")
        .eq("status", "active");
      if (ids.length > 0) q = q.in("id", ids);
      const [{ data: s }, { data: d }] = await Promise.all([
        q.order("full_name"),
        supabase.from("departments").select("id, name"),
      ]);
      setStaff((s as Staff[]) ?? []);
      setDepts((d as Dept[]) ?? []);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, orgId, params.get("ids")]);

  if (loading || !branding) return <div className="p-8"><LoadingSpinner /></div>;

  const deptById = new Map(depts.map((d) => [d.id, d]));
  const validThroughYear = new Date().getFullYear() + 1;

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      <div className="no-print sticky top-0 z-10 text-white px-6 py-3 flex items-center justify-between shadow-md" style={{ background: branding.primaryColor }}>
        <div>
          <p className="text-xs uppercase tracking-wider font-bold" style={{ color: branding.accentColor }}>Staff ID Cards · {branding.schoolName}</p>
          <p className="text-sm font-medium">{staff.length} card{staff.length === 1 ? "" : "s"}</p>
        </div>
        <button
          onClick={() => window.print()}
          disabled={staff.length === 0}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-40"
          style={{ background: branding.accentColor, color: branding.primaryColor }}
        >
          <Printer size={14} /> Print / Save as PDF
        </button>
      </div>

      <div className="max-w-4xl mx-auto p-6 print:p-0 print:max-w-full">
        <div className="grid grid-cols-2 gap-4 print:gap-2">
          {staff.map((s) => {
            const monogram = s.full_name.split(/\s+/).filter(Boolean).slice(0, 2)
              .map(w => w[0]?.toUpperCase() ?? "").join("");
            const dept = s.department_id ? deptById.get(s.department_id) : null;
            return (
              <div
                key={s.id}
                className="rounded-xl overflow-hidden shadow-md bg-white print:shadow-none print:rounded-md id-card"
                style={{ border: `2px solid ${branding.primaryColor}` }}
              >
                {/* Coloured top band with school name */}
                <div className="px-4 py-2 flex items-center gap-2" style={{ background: branding.primaryColor, color: "#fff" }}>
                  {branding.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={branding.logoUrl} alt="" className="h-6 w-6 rounded object-contain bg-white p-0.5" />
                  ) : (
                    <div className="h-6 w-6 rounded flex items-center justify-center text-[10px] font-bold" style={{ background: branding.accentColor, color: branding.primaryColor }}>
                      {branding.schoolName.slice(0, 1)}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-bold uppercase tracking-widest truncate" style={{ color: branding.accentColor }}>Staff Identity Card</p>
                    <p className="text-[11px] font-semibold truncate">{branding.schoolName}</p>
                  </div>
                </div>

                {/* Body */}
                <div className="p-4 flex gap-3">
                  <div
                    className="h-24 w-20 rounded-md flex items-center justify-center shrink-0 text-2xl font-bold text-white"
                    style={{ background: `linear-gradient(135deg, ${branding.primaryColor}, ${branding.accentColor})`, border: `2px solid ${branding.accentColor}` }}
                  >
                    {monogram || "S"}
                  </div>
                  <div className="flex-1 min-w-0 text-xs">
                    <p className="font-bold text-sm truncate" style={{ color: branding.primaryColor }}>{s.full_name}</p>
                    <p className="text-gray-500 truncate">{s.job_title ?? "Staff"}</p>
                    <div className="mt-2 space-y-0.5 text-[10px]">
                      <p><span className="text-gray-400">ID:</span> <span className="font-medium">{s.staff_code}</span></p>
                      {dept && <p><span className="text-gray-400">Dept:</span> {dept.name}</p>}
                      {s.phone && <p className="truncate"><span className="text-gray-400">Tel:</span> {s.phone}</p>}
                    </div>
                  </div>
                </div>

                {/* Footer strip */}
                <div className="px-4 py-1.5 flex items-center justify-between text-[9px]" style={{ background: branding.accentColor, color: branding.primaryColor }}>
                  <span className="font-semibold">Valid through {validThroughYear}</span>
                  <span>{branding.phone ?? branding.email ?? ""}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <style>{`
        @media print {
          @page { size: A4; margin: 12mm; }
          .id-card { break-inside: avoid; }
        }
      `}</style>
    </div>
  );
}
