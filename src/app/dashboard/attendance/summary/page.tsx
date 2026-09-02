"use client";

/**
 * Printable attendance summary.
 *
 * Per-class attendance % over a chosen date range. Great for
 * management + termly review.
 * ?from=YYYY-MM-DD&to=YYYY-MM-DD
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

interface ClassRow { id: string; name: string; }
interface Student { id: string; grade: string | null; }
interface Rec { class_id: string | null; student_id: string; status_code: string; date: string; }

export default function AttendanceSummaryPage() {
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

  const today = new Date();
  const monthAgo = new Date(today); monthAgo.setDate(today.getDate() - 30);
  const from = params.get("from") ?? monthAgo.toISOString().slice(0, 10);
  const to = params.get("to") ?? today.toISOString().slice(0, 10);

  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [records, setRecords] = useState<Rec[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId) return;
    (async () => {
      const [c, r, s] = await Promise.all([
        supabase.from("classes").select("id, name").eq("active", true).order("name"),
        supabase.from("attendance_records").select("class_id, student_id, status_code, date").gte("date", from).lte("date", to),
        supabase.from("students").select("id, grade").eq("status", "active"),
      ]);
      setClasses((c.data as ClassRow[]) ?? []);
      setRecords((r.data as Rec[]) ?? []);
      setStudents((s.data as Student[]) ?? []);
      setLoading(false);
    })();
  }, [supabase, orgId, from, to]);

  if (loading || !branding) return <div className="p-8"><LoadingSpinner /></div>;

  const rows = classes.map(c => {
    const recs = records.filter(r => r.class_id === c.id);
    const present = recs.filter(r => r.status_code === "P" || r.status_code === "present").length;
    const uniqueDays = new Set(recs.map(r => r.date)).size;
    const enrolled = students.filter(s => s.grade === c.name).length;
    return {
      name: c.name,
      records: recs.length,
      present,
      pct: recs.length > 0 ? Math.round((present / recs.length) * 100) : 0,
      days: uniqueDays,
      enrolled,
    };
  }).filter(r => r.records > 0);

  const overall = {
    records: rows.reduce((s, r) => s + r.records, 0),
    present: rows.reduce((s, r) => s + r.present, 0),
  };
  const overallPct = overall.records > 0 ? Math.round((overall.present / overall.records) * 100) : 0;

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      <div className="no-print sticky top-0 z-10 text-white px-6 py-3 flex items-center justify-between shadow-md" style={{ background: branding.primaryColor }}>
        <div>
          <p className="text-xs uppercase tracking-wider font-bold" style={{ color: branding.accentColor }}>Attendance Summary · {branding.schoolName}</p>
          <p className="text-sm font-medium">{fmtDate(from)} — {fmtDate(to)} · Overall {overallPct}%</p>
        </div>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold hover:opacity-90"
          style={{ background: branding.accentColor, color: branding.primaryColor }}
        >
          <Printer size={14} /> Print / Save as PDF
        </button>
      </div>

      <div className="max-w-4xl mx-auto py-6 print:py-0 print:max-w-full">
        <div className="bg-white shadow-sm rounded-lg p-8 print:shadow-none print:rounded-none">
          <PrintableLetterhead
            branding={branding}
            eyebrow="Attendance Summary"
            accent="emerald"
            right={
              <div>
                <p className="text-[10px] text-gray-500 uppercase font-bold">Period</p>
                <p className="text-sm font-bold" style={{ color: branding.primaryColor }}>{fmtDate(from)} — {fmtDate(to)}</p>
                <p className="text-[11px] text-gray-500 mt-0.5">Overall attendance rate: <strong>{overallPct}%</strong></p>
              </div>
            }
          />

          <table className="w-full text-xs border-collapse">
            <thead>
              <tr style={{ background: branding.primaryColor, color: "#fff" }}>
                <th className="text-left px-2 py-2 border">Class</th>
                <th className="text-right px-2 py-2 border">Enrolled</th>
                <th className="text-right px-2 py-2 border">Days recorded</th>
                <th className="text-right px-2 py-2 border">Records</th>
                <th className="text-right px-2 py-2 border">Present</th>
                <th className="text-right px-2 py-2 border">Absent-equiv</th>
                <th className="text-right px-2 py-2 border">Rate %</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={7} className="py-4 text-center text-gray-400 italic">No attendance recorded for this period.</td></tr>
              ) : rows.map(r => (
                <tr key={r.name}>
                  <td className="border px-2 py-1.5 font-semibold">{r.name}</td>
                  <td className="border px-2 py-1.5 text-right">{r.enrolled}</td>
                  <td className="border px-2 py-1.5 text-right">{r.days}</td>
                  <td className="border px-2 py-1.5 text-right">{r.records}</td>
                  <td className="border px-2 py-1.5 text-right text-emerald-700">{r.present}</td>
                  <td className="border px-2 py-1.5 text-right text-red-700">{r.records - r.present}</td>
                  <td className="border px-2 py-1.5 text-right font-bold" style={{ color: r.pct >= 90 ? "#065F46" : r.pct >= 75 ? "#92400E" : "#991B1B" }}>{r.pct}%</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-6 grid grid-cols-2 gap-8 text-[10px] text-gray-500">
            <div><p style={{ borderTop: `1px solid ${branding.primaryColor}` }}></p><p className="mt-1">Head of School</p></div>
            <div className="text-right"><p style={{ borderTop: `1px solid ${branding.primaryColor}` }}></p><p className="mt-1">Prefect / Attendance Officer</p></div>
          </div>

          <PrintableFooter branding={branding} />
        </div>
      </div>

      <style>{`@media print { @page { size: A4; margin: 15mm; } }`}</style>
    </div>
  );
}
