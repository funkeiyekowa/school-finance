"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { cn } from "@/lib/utils";
import { PageHeader, LoadingSpinner } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { FileBarChart, CheckCircle2, Clock } from "lucide-react";

interface ScoreRow { id: string; subject_id: string; assessment_type_id: string; score: number | null; term: string | null; }
interface SubjectRow { id: string; name: string; short_code: string; }
interface TypeRow { id: string; name: string; short_code: string; max_score: number; sort_order: number; }
interface GradeRow { grade: string; label: string; min_score: number; max_score: number; }
interface AttemptRow { id: string; exam_id: string; total_score: number | null; percentage: number | null; passed: boolean | null; status: string; submitted_at: string | null; }
interface ExamRow { id: string; title: string; total_marks: number; }
interface AttendanceRow { status_code: string; }

export default function MyResultsPage() {
  const { user } = useAuth();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);

  const [scores, setScores] = useState<ScoreRow[]>([]);
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [types, setTypes] = useState<TypeRow[]>([]);
  const [grades, setGrades] = useState<GradeRow[]>([]);
  const [attempts, setAttempts] = useState<AttemptRow[]>([]);
  const [exams, setExams] = useState<ExamRow[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [studentId, setStudentId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) { setLoading(false); return; }

    // Find student record linked to this user (by email match or parent_students)
    const { data: stuData } = await supabase
      .from("students")
      .select("id")
      .eq("guardian_email", user.email)
      .limit(1)
      .maybeSingle();
    const sId = stuData?.id;
    if (!sId) { setLoading(false); return; }
    setStudentId(sId);

    const [scRes, subRes, typRes, grdRes, attRes, exRes, atdRes] = await Promise.all([
      supabase.from("student_scores").select("id, subject_id, assessment_type_id, score, term").eq("student_id", sId),
      supabase.from("subjects").select("id, name, short_code").eq("active", true).order("name"),
      supabase.from("assessment_types").select("id, name, short_code, max_score, sort_order").eq("active", true).order("sort_order"),
      supabase.from("grading_scales").select("grade, label, min_score, max_score").order("sort_order"),
      supabase.from("exam_attempts").select("id, exam_id, total_score, percentage, passed, status, submitted_at").eq("student_id", sId).eq("status", "submitted").order("submitted_at", { ascending: false }),
      supabase.from("exams").select("id, title, total_marks"),
      supabase.from("attendance_records").select("status_code").eq("student_id", sId).order("date", { ascending: false }).limit(200),
    ]);

    setScores(scRes.data as ScoreRow[] ?? []);
    setSubjects(subRes.data as SubjectRow[] ?? []);
    setTypes(typRes.data as TypeRow[] ?? []);
    setGrades(grdRes.data as GradeRow[] ?? []);
    setAttempts(attRes.data as AttemptRow[] ?? []);
    setExams(exRes.data as ExamRow[] ?? []);
    setAttendance(atdRes.data as AttendanceRow[] ?? []);
    setLoading(false);
  }, [user, supabase]);

  useEffect(() => { load(); }, [load]);

  function getGrade(percentage: number): GradeRow | null {
    return grades.find(g => percentage >= g.min_score && percentage <= g.max_score) || null;
  }

  if (loading) return <div className="p-6"><LoadingSpinner /></div>;
  if (!studentId) return <div className="p-6 text-gray-500">No student record linked to your account.</div>;

  // Attendance summary
  const totalAtt = attendance.length;
  const presentAtt = attendance.filter(a => a.status_code === "present" || a.status_code === "late").length;
  const attPercentage = totalAtt > 0 ? Math.round((presentAtt / totalAtt) * 100) : 0;

  // Group scores by subject
  const subjectScores = subjects.filter(sub => scores.some(s => s.subject_id === sub.id)).map(sub => {
    const subScores = scores.filter(s => s.subject_id === sub.id);
    const total = subScores.reduce((s, sc) => s + (sc.score ?? 0), 0);
    const maxTotal = types.reduce((s, t) => s + t.max_score, 0);
    const pct = maxTotal > 0 ? Math.round((total / maxTotal) * 100) : 0;
    const grade = getGrade(pct);
    return { subject: sub, total, maxTotal, percentage: pct, grade, scores: subScores };
  });

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="My Results" subtitle="View your academic performance, exam results, and attendance" />

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border p-4 text-center">
          <div className="text-2xl font-bold text-[#0F2A47]">{subjectScores.length}</div>
          <div className="text-xs text-gray-500">Subjects</div>
        </div>
        <div className="bg-white rounded-xl border p-4 text-center">
          <div className="text-2xl font-bold text-green-700">{attempts.filter(a => a.passed).length}</div>
          <div className="text-xs text-gray-500">Exams Passed</div>
        </div>
        <div className="bg-white rounded-xl border p-4 text-center">
          <div className="text-2xl font-bold text-[#0F2A47]">{attempts.length}</div>
          <div className="text-xs text-gray-500">CBT Attempts</div>
        </div>
        <div className="bg-white rounded-xl border p-4 text-center">
          <div className={cn("text-2xl font-bold", attPercentage >= 75 ? "text-green-700" : attPercentage >= 50 ? "text-amber-700" : "text-red-700")}>{attPercentage}%</div>
          <div className="text-xs text-gray-500">Attendance</div>
        </div>
      </div>

      {/* Subject scores */}
      {subjectScores.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Subject Results</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="bg-gray-50 border-b">
                  <th className="text-left px-3 py-2 font-semibold text-gray-600">Subject</th>
                  {types.map(t => <th key={t.id} className="text-center px-2 py-2 font-semibold text-gray-600 text-xs">{t.short_code}<br /><span className="font-normal text-gray-400">/{t.max_score}</span></th>)}
                  <th className="text-center px-3 py-2 font-semibold text-gray-600">Total</th>
                  <th className="text-center px-3 py-2 font-semibold text-gray-600">Grade</th>
                </tr></thead>
                <tbody>
                  {subjectScores.map(row => (
                    <tr key={row.subject.id} className="border-b">
                      <td className="px-3 py-2 font-medium">{row.subject.name}</td>
                      {types.map(t => {
                        const sc = row.scores.find(s => s.assessment_type_id === t.id);
                        return <td key={t.id} className="text-center px-2 py-2 text-gray-600">{sc?.score ?? "—"}</td>;
                      })}
                      <td className="text-center px-3 py-2 font-bold">{row.total}/{row.maxTotal}</td>
                      <td className="text-center px-3 py-2">
                        {row.grade && <span className={cn("px-2 py-0.5 rounded text-xs font-bold",
                          row.grade.grade === "A" ? "bg-green-100 text-green-700" :
                          row.grade.grade === "B" ? "bg-blue-100 text-blue-700" :
                          row.grade.grade === "F" ? "bg-red-100 text-red-700" :
                          "bg-gray-100 text-gray-700"
                        )}>{row.grade.grade}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* CBT results */}
      {attempts.length > 0 && (
        <Card>
          <CardHeader><CardTitle>CBT / Online Exam Results</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {attempts.map(att => {
                const exam = exams.find(e => e.id === att.exam_id);
                return (
                  <div key={att.id} className="flex items-center justify-between p-3 rounded-lg border">
                    <div>
                      <div className="text-sm font-semibold">{exam?.title || "Exam"}</div>
                      <div className="text-xs text-gray-400">{att.submitted_at ? new Date(att.submitted_at).toLocaleDateString() : ""}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-bold">{att.total_score}/{exam?.total_marks || "?"}</span>
                      <span className="text-sm text-gray-500">({att.percentage}%)</span>
                      {att.passed !== null && (
                        <span className={cn("text-xs font-bold px-2 py-0.5 rounded", att.passed ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700")}>
                          {att.passed ? "PASSED" : "FAILED"}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
