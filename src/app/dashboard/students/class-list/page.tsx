"use client";

/**
 * Printable class list.
 *
 * All students in a chosen class with columns useful to a class
 * teacher: number, name, admission code, gender, DOB, guardian
 * name + phone, plus an empty "notes" column.
 * ?class=<class_name> — filters students whose grade matches.
 */

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { useBranding } from "@/lib/hooks/useBranding";
import { fmtDate } from "@/lib/utils";
import { LoadingSpinner } from "@/components/ui/PageHeader";
import { PrintableLetterhead, PrintableFooter } from "@/components/print/PrintableLetterhead";
import { Printer } from "lucide-react";

interface Student {
  id: string; full_name: string; student_code: string; grade: string | null;
  gender: string | null; date_of_birth: string | null;
  guardian_name: string | null; guardian_phone: string | null;
}

export default function ClassListPage() {
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
  const gradeFilter = params.get("class") ?? "";

  const [rows, setRows] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId) return;
    (async () => {
      let q = supabase.from("students")
        .select("id, full_name, student_code, grade, gender, date_of_birth, guardian_name, guardian_phone")
        .eq("status", "active");
      if (gradeFilter) q = q.eq("grade", gradeFilter);
      const { data } = await q.order("full_name");
      setRows((data as Student[]) ?? []);
      setLoading(false);
    })();
  }, [supabase, orgId, gradeFilter]);

  if (loading || !branding) return <div className="p-8"><LoadingSpinner /></div>;

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      <div className="no-print sticky top-0 z-10 text-white px-6 py-3 flex items-center justify-between shadow-md" style={{ background: branding.primaryColor }}>
        <div>
          <p className="text-xs uppercase tracking-wider font-bold" style={{ color: branding.accentColor }}>Class List · {branding.schoolName}</p>
          <p className="text-sm font-medium">{gradeFilter || "All active students"} · {rows.length} student{rows.length === 1 ? "" : "s"}</p>
        </div>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold hover:opacity-90"
          style={{ background: branding.accentColor, color: branding.primaryColor }}
        >
          <Printer size={14} /> Print / Save as PDF
        </button>
      </div>

      <div className="max-w-5xl mx-auto py-6 print:py-0 print:max-w-full">
        <div className="bg-white shadow-sm rounded-lg p-8 print:shadow-none print:rounded-none">
          <PrintableLetterhead
            branding={branding}
            eyebrow="Class List"
            accent="navy"
            right={
              <div>
                <p className="text-[10px] text-gray-500 uppercase font-bold">Class</p>
                <p className="text-lg font-bold" style={{ color: branding.primaryColor }}>{gradeFilter || "All"}</p>
                <p className="text-[11px] text-gray-500 mt-0.5">Total: {rows.length}</p>
              </div>
            }
          />

          <table className="w-full text-xs border-collapse">
            <thead>
              <tr style={{ background: branding.primaryColor, color: "#fff" }}>
                <th className="text-left px-2 py-2 border w-10">#</th>
                <th className="text-left px-2 py-2 border">Name</th>
                <th className="text-left px-2 py-2 border w-24">Adm. no.</th>
                <th className="text-left px-2 py-2 border w-16">Sex</th>
                <th className="text-left px-2 py-2 border w-24">DOB</th>
                <th className="text-left px-2 py-2 border">Guardian</th>
                <th className="text-left px-2 py-2 border w-32">Phone</th>
                <th className="text-left px-2 py-2 border w-40">Notes</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={8} className="py-4 text-center text-gray-400 italic">No students match this class.</td></tr>
              ) : rows.map((s, i) => (
                <tr key={s.id}>
                  <td className="border px-2 py-1.5 text-gray-500">{i + 1}</td>
                  <td className="border px-2 py-1.5 font-medium">{s.full_name}</td>
                  <td className="border px-2 py-1.5 text-gray-500 font-mono">{s.student_code}</td>
                  <td className="border px-2 py-1.5 capitalize">{s.gender ?? "—"}</td>
                  <td className="border px-2 py-1.5">{s.date_of_birth ? fmtDate(s.date_of_birth) : "—"}</td>
                  <td className="border px-2 py-1.5">{s.guardian_name ?? "—"}</td>
                  <td className="border px-2 py-1.5">{s.guardian_phone ?? "—"}</td>
                  <td className="border h-8"></td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-6 grid grid-cols-2 gap-8 text-[10px] text-gray-500">
            <div><p style={{ borderTop: `1px solid ${branding.primaryColor}` }}></p><p className="mt-1">Class Teacher</p></div>
            <div className="text-right"><p style={{ borderTop: `1px solid ${branding.primaryColor}` }}></p><p className="mt-1">Head of Section</p></div>
          </div>

          <PrintableFooter branding={branding} />
        </div>
      </div>

      <style>{`@media print { @page { size: A4 landscape; margin: 12mm; } }`}</style>
    </div>
  );
}
