"use client";

/**
 * Printable attendance register.
 *
 * ?class=<class_id>&date=<yyyy-mm-dd>&mode=blank|marked
 *
 * blank  — classic paper register: students on one axis, columns
 *          for one full working week; teacher ticks by hand.
 * marked — one column showing the currently-recorded status for
 *          the selected date.
 *
 * Uses the school letterhead.
 */

import { Suspense, useEffect, useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { useBranding } from "@/lib/hooks/useBranding";
import { fmtDate } from "@/lib/utils";
import { LoadingSpinner } from "@/components/ui/PageHeader";
import { PrintableLetterhead, PrintableFooter } from "@/components/print/PrintableLetterhead";
import { Printer } from "lucide-react";

interface ClassRow { id: string; name: string; short_code: string | null; }
interface StudentRow { id: string; student_code: string; full_name: string; }
interface RecordRow { student_id: string; status: string; }

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

export default function AttendancePrintPage() {
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

  const classId = params.get("class") ?? "";
  const dateStr = params.get("date") ?? new Date().toISOString().slice(0, 10);
  const mode = (params.get("mode") ?? "blank") as "blank" | "marked";

  const [cls, setCls] = useState<ClassRow | null>(null);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId || !classId) { setLoading(false); return; }
    (async () => {
      const cRes = await supabase.from("classes").select("id, name, short_code").eq("id", classId).maybeSingle();
      const cls = cRes.data as ClassRow | null;
      setCls(cls);
      if (!cls) { setLoading(false); return; }
      const { data: st } = await supabase.from("students")
        .select("id, student_code, full_name")
        .eq("status", "active")
        .or(`grade.eq.${cls.name},grade.eq.${cls.short_code ?? "__none__"}`)
        .order("full_name");
      setStudents((st as StudentRow[]) ?? []);
      if (mode === "marked") {
        const { data: rec } = await supabase.from("attendance_records")
          .select("student_id, status")
          .eq("class_id", classId)
          .eq("date", dateStr);
        setRecords((rec as RecordRow[]) ?? []);
      }
      setLoading(false);
    })();
  }, [supabase, orgId, classId, dateStr, mode]);

  if (loading || !branding) return <div className="p-8"><LoadingSpinner /></div>;
  if (!cls) return <div className="p-8 text-center text-gray-500">Select a class first.</div>;

  const recByStudent = new Map(records.map((r) => [r.student_id, r.status]));

  // For blank mode: build columns from Monday-of-week to Friday-of-week
  const weekStart = new Date(dateStr);
  const dow = weekStart.getDay() || 7; // 1..7 (Sun=7)
  weekStart.setDate(weekStart.getDate() - (dow - 1));
  const weekDates: string[] = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    weekDates.push(d.toISOString().slice(0, 10));
  }

  const eyebrow = mode === "marked" ? "Marked Register" : "Weekly Attendance Register";

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      <div className="no-print sticky top-0 z-10 text-white px-6 py-3 flex items-center justify-between shadow-md" style={{ background: branding.primaryColor }}>
        <div>
          <p className="text-xs uppercase tracking-wider font-bold" style={{ color: branding.accentColor }}>{eyebrow} · {branding.schoolName}</p>
          <p className="text-sm font-medium">{cls.name} — {students.length} student{students.length === 1 ? "" : "s"}</p>
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
            eyebrow={eyebrow}
            accent="emerald"
            right={
              <div>
                <p className="text-[10px] text-gray-500 uppercase font-bold">Class</p>
                <p className="text-lg font-bold" style={{ color: branding.primaryColor }}>{cls.name}</p>
                {mode === "blank" ? (
                  <p className="text-[11px] text-gray-500 mt-0.5">Week of {fmtDate(weekDates[0])}</p>
                ) : (
                  <p className="text-[11px] text-gray-500 mt-0.5">{fmtDate(dateStr)}</p>
                )}
              </div>
            }
          />

          <table className="w-full text-xs border-collapse">
            <thead>
              <tr style={{ background: branding.primaryColor, color: "#fff" }}>
                <th className="text-left px-2 py-2 border w-10">#</th>
                <th className="text-left px-2 py-2 border">Student</th>
                <th className="text-left px-2 py-2 border w-24">Code</th>
                {mode === "blank" ? DAYS.map((d, i) => (
                  <th key={d} className="text-center px-2 py-2 border w-16">
                    {d}<br /><span className="text-[9px] font-normal opacity-70">{weekDates[i].slice(5)}</span>
                  </th>
                )) : (
                  <th className="text-center px-2 py-2 border w-24">Status</th>
                )}
              </tr>
            </thead>
            <tbody>
              {students.length === 0 ? (
                <tr><td colSpan={mode === "blank" ? 8 : 4} className="py-6 text-center text-gray-400 italic">No students in this class.</td></tr>
              ) : students.map((s, i) => (
                <tr key={s.id}>
                  <td className="border px-2 py-1.5 text-gray-500">{i + 1}</td>
                  <td className="border px-2 py-1.5">{s.full_name}</td>
                  <td className="border px-2 py-1.5 text-gray-500 font-mono">{s.student_code}</td>
                  {mode === "blank" ? DAYS.map((d) => (
                    <td key={d} className="border h-8"></td>
                  )) : (
                    <td className="border px-2 py-1.5 text-center capitalize">{recByStudent.get(s.id) ?? "—"}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>

          {mode === "blank" && (
            <div className="mt-3 flex items-center gap-6 text-[10px] text-gray-600">
              <span><strong>Key:</strong></span>
              <span><span className="inline-block w-4 text-center font-bold">P</span> Present</span>
              <span><span className="inline-block w-4 text-center font-bold">A</span> Absent</span>
              <span><span className="inline-block w-4 text-center font-bold">L</span> Late</span>
              <span><span className="inline-block w-4 text-center font-bold">E</span> Excused</span>
            </div>
          )}

          <div className="mt-6 grid grid-cols-2 gap-8 text-[10px] text-gray-500">
            <div>
              <p>_______________________________</p>
              <p>Class Teacher</p>
            </div>
            <div className="text-right">
              <p>_______________________________</p>
              <p>Head of School</p>
            </div>
          </div>

          <PrintableFooter branding={branding} />
        </div>
      </div>

      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 12mm; }
        }
      `}</style>
    </div>
  );
}
