"use client";

/**
 * Bulk-printable report cards.
 *
 * Accepts a comma-separated list of report card ids in the `ids`
 * query parameter and stacks each as a print-optimized card with a
 * page break between them. A sticky "Print / Save as PDF" button
 * fires the browser dialog so a whole class can be saved in one go.
 */

import { Suspense, useEffect, useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useBranding } from "@/lib/hooks/useBranding";
import { LoadingSpinner } from "@/components/ui/PageHeader";
import { PrintableLetterhead, PrintableFooter } from "@/components/print/PrintableLetterhead";
import { Printer } from "lucide-react";

interface Card {
  id: string; student_id: string; term: string; session_name: string | null;
  total_score: number; average_score: number; total_subjects: number;
  position_in_class: number | null; class_size: number | null;
  grade_overall: string | null; attendance_present: number; attendance_total: number;
  teacher_comment: string | null; principal_comment: string | null;
  next_term_begins: string | null; published: boolean;
}
interface SubjectRow {
  id: string; report_card_id: string; subject_name: string;
  ca1_score: number | null; ca2_score: number | null; ca3_score: number | null;
  exam_score: number | null; total_score: number | null;
  grade: string | null; remark: string | null;
}
interface Student { id: string; student_code: string; full_name: string; }

export default function ReportCardBatchPrint() {
  return (
    <Suspense fallback={<div className="p-8"><LoadingSpinner /></div>}>
      <Inner />
    </Suspense>
  );
}

function Inner() {
  const params = useSearchParams();
  const supabase = useMemo(() => createClient(), []);
  const branding = useBranding();
  const ids = (params.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);

  const [cards, setCards] = useState<Card[]>([]);
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (ids.length === 0) { setLoading(false); return; }
    (async () => {
      const [cRes, sRes] = await Promise.all([
        supabase.from("report_cards").select("*").in("id", ids),
        supabase.from("report_card_subjects").select("*").in("report_card_id", ids),
      ]);
      const cardRows = (cRes.data as Card[]) ?? [];
      const subjRows = (sRes.data as SubjectRow[]) ?? [];
      const studentIds = Array.from(new Set(cardRows.map((c) => c.student_id)));
      const { data: stRes } = studentIds.length
        ? await supabase.from("students").select("id, student_code, full_name").in("id", studentIds)
        : { data: [] };
      setCards(cardRows);
      setSubjects(subjRows);
      setStudents((stRes as Student[]) ?? []);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, params.get("ids")]);

  const studentById = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);
  const subjectsByCard = useMemo(() => {
    const m = new Map<string, SubjectRow[]>();
    subjects.forEach((s) => {
      const arr = m.get(s.report_card_id) ?? [];
      arr.push(s);
      m.set(s.report_card_id, arr);
    });
    return m;
  }, [subjects]);

  if (loading || !branding) return <div className="p-8"><LoadingSpinner /></div>;
  if (cards.length === 0) return <div className="p-8 text-center text-gray-500">No report cards selected.</div>;

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      <div className="no-print sticky top-0 z-10 bg-[#0F2A47] text-white px-6 py-3 flex items-center justify-between shadow-md">
        <div>
          <p className="text-xs uppercase tracking-wider text-[#C9A227] font-bold">Batch Report Cards</p>
          <p className="text-sm font-medium">{cards.length} report card{cards.length === 1 ? "" : "s"} — {branding.schoolName}</p>
        </div>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 bg-[#C9A227] text-[#0F2A47] px-4 py-2 rounded-lg text-sm font-bold hover:bg-[#e6bf39] transition-colors"
        >
          <Printer size={14} /> Print / Save as PDF
        </button>
      </div>

      <div className="max-w-3xl mx-auto py-6 print:py-0 print:max-w-full">
        {cards.map((c) => {
          const st = studentById.get(c.student_id);
          const subs = subjectsByCard.get(c.id) ?? [];
          const attendancePct = c.attendance_total > 0
            ? Math.round((c.attendance_present / c.attendance_total) * 100) : 0;

          return (
            <div key={c.id} className="bg-white shadow-sm rounded-lg p-8 mb-4 print:shadow-none print:mb-0 print:rounded-none rc-page">
              <PrintableLetterhead
                branding={branding}
                eyebrow="Student Report Card"
                accent="gold"
                right={
                  <div>
                    <p className="text-base font-bold" style={{ color: branding.primaryColor }}>{st?.full_name ?? "Student"}</p>
                    <p className="text-xs text-gray-500">{st?.student_code ?? ""}</p>
                    <p className="text-[11px] text-gray-500 mt-0.5">{c.session_name ?? ""} · {c.term}</p>
                    {!c.published && (
                      <p className="text-[10px] mt-1 text-amber-700 font-bold uppercase">Draft</p>
                    )}
                  </div>
                }
              />

              {/* Summary strip */}
              <div className="grid grid-cols-4 gap-2 mb-4">
                <div className="rounded-lg bg-gray-50 p-2 text-center">
                  <p className="text-[10px] text-gray-500 uppercase">Total</p>
                  <p className="font-bold text-[#0F2A47]">{c.total_score}</p>
                </div>
                <div className="rounded-lg bg-gray-50 p-2 text-center">
                  <p className="text-[10px] text-gray-500 uppercase">Average</p>
                  <p className="font-bold text-emerald-700">{c.average_score.toFixed(1)}%</p>
                </div>
                <div className="rounded-lg bg-gray-50 p-2 text-center">
                  <p className="text-[10px] text-gray-500 uppercase">Position</p>
                  <p className="font-bold text-[#0F2A47]">
                    {c.position_in_class ? `${c.position_in_class} / ${c.class_size ?? "—"}` : "—"}
                  </p>
                </div>
                <div className="rounded-lg bg-gray-50 p-2 text-center">
                  <p className="text-[10px] text-gray-500 uppercase">Grade</p>
                  <p className="font-bold text-[#C9A227]">{c.grade_overall ?? "—"}</p>
                </div>
              </div>

              {/* Subject table */}
              {subs.length > 0 && (
                <table className="w-full text-xs mb-4">
                  <thead>
                    <tr className="border-b-2 border-[#0F2A47] text-[10px] uppercase">
                      <th className="text-left py-1">Subject</th>
                      <th className="text-right py-1">CA1</th>
                      <th className="text-right py-1">CA2</th>
                      <th className="text-right py-1">CA3</th>
                      <th className="text-right py-1">Exam</th>
                      <th className="text-right py-1">Total</th>
                      <th className="text-center py-1">Grade</th>
                      <th className="text-left py-1">Remark</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subs.map((s) => (
                      <tr key={s.id} className="border-b border-gray-100">
                        <td className="py-1 font-medium">{s.subject_name}</td>
                        <td className="py-1 text-right">{s.ca1_score ?? "—"}</td>
                        <td className="py-1 text-right">{s.ca2_score ?? "—"}</td>
                        <td className="py-1 text-right">{s.ca3_score ?? "—"}</td>
                        <td className="py-1 text-right">{s.exam_score ?? "—"}</td>
                        <td className="py-1 text-right font-semibold">{s.total_score ?? "—"}</td>
                        <td className="py-1 text-center">{s.grade ?? "—"}</td>
                        <td className="py-1">{s.remark ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {/* Attendance */}
              <div className="rounded-lg bg-gray-50 p-3 mb-3 flex items-center justify-between text-xs">
                <span className="font-semibold text-[#0F2A47]">Attendance</span>
                <span>{c.attendance_present} / {c.attendance_total} days ({attendancePct}%)</span>
              </div>

              {/* Comments */}
              {(c.teacher_comment || c.principal_comment) && (
                <div className="space-y-2 text-xs mb-4">
                  {c.teacher_comment && (
                    <div>
                      <p className="text-[10px] text-gray-500 uppercase font-bold">Teacher&apos;s comment</p>
                      <p className="whitespace-pre-wrap italic">&ldquo;{c.teacher_comment}&rdquo;</p>
                    </div>
                  )}
                  {c.principal_comment && (
                    <div>
                      <p className="text-[10px] text-gray-500 uppercase font-bold">Principal&apos;s comment</p>
                      <p className="whitespace-pre-wrap italic">&ldquo;{c.principal_comment}&rdquo;</p>
                    </div>
                  )}
                </div>
              )}

              {c.next_term_begins && (
                <p className="text-xs text-gray-500 mb-3">Next term begins: <strong>{c.next_term_begins}</strong></p>
              )}

              {/* Footer signatures */}
              <div className="pt-3 mt-3 border-t border-gray-200 grid grid-cols-2 gap-6 text-[10px] text-gray-500">
                <div>
                  <p>_______________________________</p>
                  <p>Class Teacher</p>
                </div>
                <div className="text-right">
                  <p>_______________________________</p>
                  <p>Principal</p>
                </div>
              </div>
              <PrintableFooter branding={branding} />
            </div>
          );
        })}
      </div>

      <style>{`
        @media print {
          .rc-page { page-break-after: always; }
          .rc-page:last-child { page-break-after: auto; }
          @page { size: A4; margin: 15mm; }
        }
      `}</style>
    </div>
  );
}
