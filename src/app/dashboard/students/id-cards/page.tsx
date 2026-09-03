"use client";

/**
 * Bulk-printable student ID cards.
 *
 * ?class=<grade> filter or ?ids=<comma-list>. 2-up A4 grid,
 * monogram fallback when no photo. Includes admission number,
 * class, and guardian phone for quick contact if a student is
 * separated from a group.
 */

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { useBranding } from "@/lib/hooks/useBranding";
import { LoadingSpinner } from "@/components/ui/PageHeader";
import { Printer } from "lucide-react";

interface Student {
  id: string; full_name: string; student_code: string;
  grade: string | null; date_of_birth: string | null;
  guardian_phone: string | null; guardian_name: string | null;
  photo_url: string | null;
}

export default function StudentIdCardsPage() {
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
  const ids = (params.get("ids") ?? "").split(",").map(s => s.trim()).filter(Boolean);
  const grade = params.get("class") ?? "";

  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId) return;
    (async () => {
      let q = supabase.from("students")
        .select("id, full_name, student_code, grade, date_of_birth, guardian_phone, guardian_name, photo_url")
        .eq("status", "active");
      if (ids.length > 0) q = q.in("id", ids);
      else if (grade) q = q.eq("grade", grade);
      const { data } = await q.order("full_name");
      setStudents((data as Student[]) ?? []);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, orgId, params.get("ids"), grade]);

  if (loading || !branding) return <div className="p-8"><LoadingSpinner /></div>;

  const validThroughYear = new Date().getFullYear() + 1;

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      <div className="no-print sticky top-0 z-10 text-white px-6 py-3 flex items-center justify-between shadow-md" style={{ background: branding.primaryColor }}>
        <div>
          <p className="text-xs uppercase tracking-wider font-bold" style={{ color: branding.accentColor }}>Student ID Cards · {branding.schoolName}</p>
          <p className="text-sm font-medium">{grade ? `${grade} · ` : ""}{students.length} card{students.length === 1 ? "" : "s"}</p>
        </div>
        <button
          onClick={() => window.print()}
          disabled={students.length === 0}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold hover:opacity-90 disabled:opacity-40"
          style={{ background: branding.accentColor, color: branding.primaryColor }}
        >
          <Printer size={14} /> Print / Save as PDF
        </button>
      </div>

      <div className="max-w-4xl mx-auto p-6 print:p-0 print:max-w-full">
        <div className="grid grid-cols-2 gap-4 print:gap-2">
          {students.map(s => {
            const monogram = s.full_name.split(/\s+/).filter(Boolean).slice(0, 2)
              .map(w => w[0]?.toUpperCase() ?? "").join("");
            return (
              <div
                key={s.id}
                className="rounded-xl overflow-hidden shadow-md bg-white print:shadow-none print:rounded-md id-card"
                style={{ border: `2px solid ${branding.primaryColor}` }}
              >
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
                    <p className="text-[10px] font-bold uppercase tracking-widest truncate" style={{ color: branding.accentColor }}>Student Identity Card</p>
                    <p className="text-[11px] font-semibold truncate">{branding.schoolName}</p>
                  </div>
                </div>

                <div className="p-4 flex gap-3">
                  {s.photo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={s.photo_url}
                      alt={s.full_name}
                      className="h-24 w-20 rounded-md object-cover shrink-0"
                      style={{ border: `2px solid ${branding.accentColor}` }}
                    />
                  ) : (
                    <div
                      className="h-24 w-20 rounded-md flex items-center justify-center shrink-0 text-2xl font-bold text-white"
                      style={{ background: `linear-gradient(135deg, ${branding.primaryColor}, ${branding.accentColor})`, border: `2px solid ${branding.accentColor}` }}
                    >
                      {monogram || "S"}
                    </div>
                  )}
                  <div className="flex-1 min-w-0 text-xs">
                    <p className="font-bold text-sm truncate" style={{ color: branding.primaryColor }}>{s.full_name}</p>
                    <p className="text-gray-500 truncate">{s.grade ?? "—"}</p>
                    <div className="mt-2 space-y-0.5 text-[10px]">
                      <p><span className="text-gray-400">Adm no:</span> <span className="font-medium">{s.student_code}</span></p>
                      {s.guardian_name && <p className="truncate"><span className="text-gray-400">Guardian:</span> {s.guardian_name}</p>}
                      {s.guardian_phone && <p className="truncate"><span className="text-gray-400">Contact:</span> {s.guardian_phone}</p>}
                    </div>
                  </div>
                </div>

                <div className="px-4 py-1.5 flex items-center justify-between text-[9px]" style={{ background: branding.accentColor, color: branding.primaryColor }}>
                  <span className="font-semibold">Valid through {validThroughYear}</span>
                  <span>{branding.phone ?? ""}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <style>{`@media print { @page { size: A4; margin: 12mm; } .id-card { break-inside: avoid; } }`}</style>
    </div>
  );
}
