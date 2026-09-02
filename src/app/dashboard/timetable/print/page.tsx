"use client";

/**
 * Printable class timetable.
 *
 * ?class=<class_id> selects which class's timetable to print.
 * A single sheet with the school letterhead, class name, and the
 * standard periods × days grid — ready to laminate and hand out.
 */

import { Suspense, useEffect, useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { useBranding } from "@/lib/hooks/useBranding";
import { cn } from "@/lib/utils";
import { LoadingSpinner } from "@/components/ui/PageHeader";
import { PrintableLetterhead, PrintableFooter } from "@/components/print/PrintableLetterhead";
import { Printer } from "lucide-react";

interface ClassRow { id: string; name: string; }
interface SubjectRow { id: string; name: string; short_code: string; }
interface PeriodRow { id: string; name: string; short_code: string; start_time: string; end_time: string; is_break: boolean; sort_order: number; }
interface EntryRow { id: string; class_id: string; subject_id: string; period_id: string; teacher_name: string | null; day_of_week: number; room: string | null; }

const DAYS = [
  { num: 1, short: "Mon", label: "Monday" },
  { num: 2, short: "Tue", label: "Tuesday" },
  { num: 3, short: "Wed", label: "Wednesday" },
  { num: 4, short: "Thu", label: "Thursday" },
  { num: 5, short: "Fri", label: "Friday" },
];

export default function TimetablePrintPage() {
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

  const [cls, setCls] = useState<ClassRow | null>(null);
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [periods, setPeriods] = useState<PeriodRow[]>([]);
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId || !classId) { setLoading(false); return; }
    (async () => {
      const [cRes, subRes, perRes, entRes] = await Promise.all([
        supabase.from("classes").select("id, name").eq("id", classId).maybeSingle(),
        supabase.from("subjects").select("id, name, short_code").eq("active", true),
        supabase.from("periods").select("*").eq("active", true).order("sort_order"),
        supabase.from("timetable_entries").select("*").eq("class_id", classId),
      ]);
      setCls((cRes.data as ClassRow) ?? null);
      setSubjects((subRes.data as SubjectRow[]) ?? []);
      setPeriods((perRes.data as PeriodRow[]) ?? []);
      setEntries((entRes.data as EntryRow[]) ?? []);
      setLoading(false);
    })();
  }, [supabase, orgId, classId]);

  if (loading || !branding) return <div className="p-8"><LoadingSpinner /></div>;
  if (!cls) return <div className="p-8 text-center text-gray-500">Select a class first.</div>;

  const subjectById = new Map(subjects.map((s) => [s.id, s]));
  function entryFor(periodId: string, day: number): EntryRow | undefined {
    return entries.find((e) => e.period_id === periodId && e.day_of_week === day);
  }

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      <div className="no-print sticky top-0 z-10 text-white px-6 py-3 flex items-center justify-between shadow-md" style={{ background: branding.primaryColor }}>
        <div>
          <p className="text-xs uppercase tracking-wider font-bold" style={{ color: branding.accentColor }}>Class Timetable · {branding.schoolName}</p>
          <p className="text-sm font-medium">{cls.name}</p>
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
            eyebrow="Class Timetable"
            accent="navy"
            right={
              <div>
                <p className="text-[10px] text-gray-500 uppercase font-bold">Class</p>
                <p className="text-lg font-bold" style={{ color: branding.primaryColor }}>{cls.name}</p>
                <p className="text-[11px] text-gray-500 mt-0.5">Effective {new Date().toLocaleDateString("en-GB")}</p>
              </div>
            }
          />

          <table className="w-full text-xs border-collapse">
            <thead>
              <tr style={{ background: branding.primaryColor, color: "#fff" }}>
                <th className="text-left px-2 py-2 border w-28">Period</th>
                {DAYS.map((d) => (
                  <th key={d.num} className="text-center px-2 py-2 border">{d.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {periods.map((p) => (
                <tr key={p.id} className={cn(p.is_break && "bg-amber-50")}>
                  <td className="px-2 py-2 border align-top">
                    <p className="font-semibold" style={{ color: branding.primaryColor }}>{p.short_code}</p>
                    <p className="text-[10px] text-gray-500">
                      {String(p.start_time).substring(0, 5)}–{String(p.end_time).substring(0, 5)}
                    </p>
                    {p.is_break && <p className="text-[10px] font-bold text-amber-600 mt-0.5">BREAK</p>}
                  </td>
                  {DAYS.map((d) => {
                    if (p.is_break) {
                      return <td key={d.num} className="border text-center text-[10px] italic text-amber-700">Break</td>;
                    }
                    const e = entryFor(p.id, d.num);
                    if (!e) return <td key={d.num} className="border align-top text-center text-gray-300">—</td>;
                    const subj = subjectById.get(e.subject_id);
                    return (
                      <td key={d.num} className="border p-1.5 align-top">
                        <p className="text-xs font-semibold" style={{ color: branding.primaryColor }}>{subj?.name ?? "?"}</p>
                        {e.teacher_name && <p className="text-[10px] text-gray-500">{e.teacher_name}</p>}
                        {e.room && <p className="text-[10px] text-gray-400">Room {e.room}</p>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-4 flex items-center justify-between text-[10px] text-gray-500">
            <p>Total periods scheduled: {entries.length}</p>
            <p>Printed {new Date().toLocaleString("en-GB")}</p>
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
