"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { PageHeader, LoadingSpinner } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { ArrowLeft, Printer, CheckCircle2, Award, GraduationCap, Users } from "lucide-react";

interface ReportCardFull {
  id: string; student_id: string; academic_year_id: string | null; class_id: string | null;
  term: string; session_name: string | null; total_score: number; average_score: number;
  total_subjects: number; position_in_class: number | null; class_size: number | null;
  grade_overall: string | null; attendance_present: number; attendance_total: number;
  teacher_comment: string | null; principal_comment: string | null;
  next_term_begins: string | null; published: boolean;
}
interface SubjectRow {
  id: string; subject_name: string; ca1_score: number | null; ca2_score: number | null;
  ca3_score: number | null; exam_score: number | null; total_score: number | null;
  grade: string | null; remark: string | null; teacher_name: string | null;
  position: number | null; class_highest: number | null; class_average: number | null;
}
interface Student { id: string; student_code: string; full_name: string; grade: string | null; gender: string | null; date_of_birth: string | null; }

export default function ReportCardDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { isAdmin, profile } = useAuth();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [rc, setRc] = useState<ReportCardFull | null>(null);
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [student, setStudent] = useState<Student | null>(null);
  const [yearName, setYearName] = useState<string>("");
  const [className, setClassName] = useState<string>("");
  const [teacherComment, setTeacherComment] = useState("");
  const [principalComment, setPrincipalComment] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: cardData } = await supabase.from("report_cards").select("*").eq("id", id).single();
    if (cardData) {
      const card = cardData as unknown as ReportCardFull;
      setRc(card);
      setTeacherComment(card.teacher_comment || "");
      setPrincipalComment(card.principal_comment || "");
      const [sub, stu, yr, cl] = await Promise.all([
        supabase.from("report_card_subjects").select("*").eq("report_card_id", id),
        supabase.from("students").select("*").eq("id", card.student_id).single(),
        card.academic_year_id ? supabase.from("academic_years").select("name").eq("id", card.academic_year_id).single() : Promise.resolve({ data: null }),
        card.class_id ? supabase.from("classes").select("name").eq("id", card.class_id).single() : Promise.resolve({ data: null }),
      ]);
      setSubjects((sub.data ?? []) as SubjectRow[]);
      setStudent(stu.data as Student);
      setYearName((yr.data as { name: string } | null)?.name || "");
      setClassName((cl.data as { name: string } | null)?.name || "");
    }
    setLoading(false);
  }, [id, supabase]);

  useEffect(() => { load(); }, [load]);

  async function saveComments() {
    setSaving(true);
    await supabase.from("report_cards").update({
      teacher_comment: teacherComment,
      principal_comment: principalComment,
      updated_at: new Date().toISOString(),
    }).eq("id", id);
    setSaving(false);
    load();
  }

  async function publish() {
    setSaving(true);
    await supabase.from("report_cards").update({
      published: true,
      published_at: new Date().toISOString(),
      published_by: profile?.id,
    }).eq("id", id);
    setSaving(false);
    load();
  }

  function printCard() { window.print(); }

  if (loading) return <LoadingSpinner />;
  if (!rc || !student) return <div className="p-8 text-center text-gray-500">Report card not found.</div>;

  const attendancePct = rc.attendance_total > 0 ? Math.round((rc.attendance_present / rc.attendance_total) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between print:hidden">
        <Link href="/dashboard/report-cards" className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-[#C9A227]">
          <ArrowLeft size={14} /> Back to Report Cards
        </Link>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={printCard}><Printer size={14} /> Print</Button>
          {isAdmin && !rc.published && (
            <Button variant="gold" size="sm" onClick={publish} loading={saving}><CheckCircle2 size={14} /> Publish</Button>
          )}
        </div>
      </div>

      {/* Printable card */}
      <Card className="print:shadow-none print:border-0">
        <CardContent className="p-8">
          <div className="text-center border-b-4 border-[#C9A227] pb-4 mb-6">
            <h1 className="text-3xl font-bold text-[#0F2A47]">STUDENT REPORT CARD</h1>
            <p className="text-gray-600 mt-1">{rc.session_name || yearName} · {rc.term}</p>
          </div>

          <div className="grid grid-cols-2 gap-6 mb-6 text-sm">
            <div className="space-y-1">
              <div><span className="text-gray-500">Name: </span><span className="font-semibold">{student.full_name}</span></div>
              <div><span className="text-gray-500">Student Code: </span><span className="font-mono">{student.student_code}</span></div>
              <div><span className="text-gray-500">Class: </span><span className="font-semibold">{className || student.grade}</span></div>
              <div><span className="text-gray-500">Gender: </span>{student.gender || "—"}</div>
            </div>
            <div className="space-y-1 text-right">
              <div><span className="text-gray-500">Average: </span><span className="font-bold text-lg">{Number(rc.average_score).toFixed(1)}%</span></div>
              <div><span className="text-gray-500">Grade: </span>
                <span className={cn("px-2 py-0.5 rounded text-sm font-bold ml-1",
                  rc.grade_overall === "A" ? "bg-green-100 text-green-700" :
                  rc.grade_overall === "B" ? "bg-blue-100 text-blue-700" :
                  "bg-amber-100 text-amber-700"
                )}>{rc.grade_overall || "—"}</span>
              </div>
              <div><span className="text-gray-500">Position: </span><span className="font-semibold">{rc.position_in_class ? `${rc.position_in_class} of ${rc.class_size || "?"}` : "—"}</span></div>
              <div><span className="text-gray-500">Attendance: </span>{rc.attendance_present}/{rc.attendance_total} ({attendancePct}%)</div>
            </div>
          </div>

          <table className="w-full text-sm border border-gray-300 mb-6">
            <thead className="bg-[#0F2A47] text-white">
              <tr>
                <th className="px-2 py-2 text-left">Subject</th>
                <th className="px-2 py-2 text-center">CA1</th>
                <th className="px-2 py-2 text-center">CA2</th>
                <th className="px-2 py-2 text-center">CA3</th>
                <th className="px-2 py-2 text-center">Exam</th>
                <th className="px-2 py-2 text-center">Total</th>
                <th className="px-2 py-2 text-center">Grade</th>
                <th className="px-2 py-2 text-center">Position</th>
                <th className="px-2 py-2 text-left">Remark</th>
              </tr>
            </thead>
            <tbody>
              {subjects.map(s => (
                <tr key={s.id} className="border-b border-gray-200">
                  <td className="px-2 py-2 font-medium">{s.subject_name}</td>
                  <td className="px-2 py-2 text-center">{s.ca1_score ?? "—"}</td>
                  <td className="px-2 py-2 text-center">{s.ca2_score ?? "—"}</td>
                  <td className="px-2 py-2 text-center">{s.ca3_score ?? "—"}</td>
                  <td className="px-2 py-2 text-center">{s.exam_score ?? "—"}</td>
                  <td className="px-2 py-2 text-center font-semibold">{s.total_score ?? "—"}</td>
                  <td className="px-2 py-2 text-center font-bold">{s.grade || "—"}</td>
                  <td className="px-2 py-2 text-center text-xs">{s.position ?? "—"}</td>
                  <td className="px-2 py-2 text-xs text-gray-600">{s.remark || "—"}</td>
                </tr>
              ))}
              {subjects.length === 0 && (
                <tr><td colSpan={9} className="text-center py-6 text-gray-400">No subjects recorded.</td></tr>
              )}
            </tbody>
            <tfoot className="bg-gray-50 font-semibold">
              <tr>
                <td className="px-2 py-2" colSpan={5}>TOTAL</td>
                <td className="px-2 py-2 text-center">{Number(rc.total_score).toFixed(1)}</td>
                <td className="px-2 py-2 text-center" colSpan={3}>{rc.total_subjects} subjects</td>
              </tr>
            </tfoot>
          </table>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1 uppercase">Class Teacher&apos;s Comment</label>
              {isAdmin && !rc.published ? (
                <textarea
                  value={teacherComment}
                  onChange={e => setTeacherComment(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227] print:border-0"
                />
              ) : (
                <p className="p-3 bg-gray-50 rounded-lg text-sm text-gray-700 min-h-[80px]">{rc.teacher_comment || "—"}</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1 uppercase">Principal&apos;s Comment</label>
              {isAdmin && !rc.published ? (
                <textarea
                  value={principalComment}
                  onChange={e => setPrincipalComment(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227] print:border-0"
                />
              ) : (
                <p className="p-3 bg-gray-50 rounded-lg text-sm text-gray-700 min-h-[80px]">{rc.principal_comment || "—"}</p>
              )}
            </div>
          </div>

          {isAdmin && !rc.published && (
            <div className="flex justify-end gap-2 print:hidden">
              <Button variant="secondary" size="sm" onClick={saveComments} loading={saving}>Save Comments</Button>
            </div>
          )}

          <div className="mt-8 pt-4 border-t border-gray-200 grid grid-cols-3 gap-4 text-center text-xs text-gray-600">
            <div>
              <div className="border-b border-gray-400 h-8 mb-1"></div>
              <div>Class Teacher</div>
            </div>
            <div>
              <div className="border-b border-gray-400 h-8 mb-1"></div>
              <div>Principal</div>
            </div>
            <div>
              <div className="border-b border-gray-400 h-8 mb-1"></div>
              <div>Parent / Guardian</div>
            </div>
          </div>

          {rc.next_term_begins && (
            <p className="text-center text-sm text-gray-600 mt-4">
              Next term begins: <span className="font-semibold">{rc.next_term_begins}</span>
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
