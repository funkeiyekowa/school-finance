"use client";

/**
 * Printable blank score sheet for a class × subject × term.
 *
 * Teachers can print it, fill scores by hand during marking, then
 * type them back into the digital gradebook. Uses the school's
 * letterhead, current scoring bands from assessment_types, and a
 * summary row at the bottom for the class total.
 */

import { Suspense, useEffect, useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { useBranding } from "@/lib/hooks/useBranding";
import { LoadingSpinner } from "@/components/ui/PageHeader";
import { PrintableLetterhead, PrintableFooter } from "@/components/print/PrintableLetterhead";
import { Printer } from "lucide-react";

interface ClassRow { id: string; name: string; short_code: string | null; }
interface Subject { id: string; name: string; short_code: string; }
interface AssessType { id: string; name: string; short_code: string; max_score: number; sort_order: number; }
interface Student { id: string; full_name: string; student_code: string; }

export default function AssessmentPrintPage() {
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
  const subjectId = params.get("subject") ?? "";
  const term = params.get("term") ?? "Term 1";

  const [cls, setCls] = useState<ClassRow | null>(null);
  const [subject, setSubject] = useState<Subject | null>(null);
  const [types, setTypes] = useState<AssessType[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId || !classId || !subjectId) { setLoading(false); return; }
    (async () => {
      const [cRes, sRes, tRes] = await Promise.all([
        supabase.from("classes").select("id, name, short_code").eq("id", classId).maybeSingle(),
        supabase.from("subjects").select("id, name, short_code").eq("id", subjectId).maybeSingle(),
        supabase.from("assessment_types").select("*").eq("active", true).order("sort_order"),
      ]);
      const cls = cRes.data as ClassRow | null;
      setCls(cls);
      setSubject(sRes.data as Subject ?? null);
      setTypes((tRes.data as AssessType[]) ?? []);
      if (cls) {
        const { data: st } = await supabase.from("students")
          .select("id, full_name, student_code")
          .eq("status", "active")
          .or(`grade.eq.${cls.name},grade.eq.${cls.short_code ?? "__none__"}`)
          .order("full_name");
        setStudents((st as Student[]) ?? []);
      }
      setLoading(false);
    })();
  }, [supabase, orgId, classId, subjectId]);

  if (loading || !branding) return <div className="p-8"><LoadingSpinner /></div>;
  if (!cls || !subject) return <div className="p-8 text-center text-gray-500">Missing class or subject.</div>;

  const maxTotal = types.reduce((s, t) => s + t.max_score, 0);

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      <div className="no-print sticky top-0 z-10 text-white px-6 py-3 flex items-center justify-between shadow-md" style={{ background: branding.primaryColor }}>
        <div>
          <p className="text-xs uppercase tracking-wider font-bold" style={{ color: branding.accentColor }}>Score Sheet · {branding.schoolName}</p>
          <p className="text-sm font-medium">{subject.name} — {cls.name} — {term}</p>
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
            eyebrow="Class Score Sheet"
            accent="purple"
            right={
              <div>
                <p className="text-[10px] text-gray-500 uppercase font-bold">Subject</p>
                <p className="text-sm font-bold" style={{ color: branding.primaryColor }}>{subject.name}</p>
                <p className="text-[11px] text-gray-500 mt-0.5">{cls.name} · {term}</p>
              </div>
            }
          />

          <table className="w-full text-xs border-collapse">
            <thead>
              <tr style={{ background: branding.primaryColor, color: "#fff" }}>
                <th className="text-left px-2 py-2 border w-10">#</th>
                <th className="text-left px-2 py-2 border">Student</th>
                <th className="text-left px-2 py-2 border w-24">Code</th>
                {types.map(t => (
                  <th key={t.id} className="text-center px-2 py-2 border w-16">
                    {t.short_code}<br /><span className="text-[9px] font-normal opacity-70">/{t.max_score}</span>
                  </th>
                ))}
                <th className="text-center px-2 py-2 border w-16">Total<br /><span className="text-[9px] font-normal opacity-70">/{maxTotal}</span></th>
                <th className="text-center px-2 py-2 border w-16">Grade</th>
              </tr>
            </thead>
            <tbody>
              {students.length === 0 ? (
                <tr><td colSpan={types.length + 5} className="py-6 text-center text-gray-400 italic">No students in this class.</td></tr>
              ) : students.map((s, i) => (
                <tr key={s.id}>
                  <td className="border px-2 py-1.5 text-gray-500">{i + 1}</td>
                  <td className="border px-2 py-1.5">{s.full_name}</td>
                  <td className="border px-2 py-1.5 text-gray-500 font-mono">{s.student_code}</td>
                  {types.map(t => (
                    <td key={t.id} className="border h-8"></td>
                  ))}
                  <td className="border h-8"></td>
                  <td className="border h-8"></td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-6 grid grid-cols-2 gap-8 text-[10px] text-gray-500">
            <div>
              <p style={{ borderTop: `1px solid ${branding.primaryColor}` }}></p>
              <p className="mt-1">Class Teacher / Marker</p>
              <p className="text-xs mt-4">Marked on ______________________________</p>
            </div>
            <div>
              <p style={{ borderTop: `1px solid ${branding.primaryColor}` }}></p>
              <p className="mt-1">Head of Department / Vetter</p>
              <p className="text-xs mt-4">Vetted on ______________________________</p>
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
