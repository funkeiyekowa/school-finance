"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { PageHeader, LoadingSpinner } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ArrowLeft, GraduationCap, Play } from "lucide-react";

interface Student { id: string; student_code: string; full_name: string; grade: string | null; }
interface AcademicYear { id: string; name: string; status: string; }
interface ClassRow { id: string; name: string; }
interface Subject { id: string; name: string; class_id: string | null; }
interface AssessmentResult { student_id: string; subject_id: string | null; subject_name: string; ca1: number | null; ca2: number | null; ca3: number | null; exam: number | null; total: number | null; }

function calcGrade(score: number): string {
  if (score >= 75) return "A";
  if (score >= 65) return "B";
  if (score >= 55) return "C";
  if (score >= 45) return "D";
  if (score >= 40) return "E";
  return "F";
}

function calcRemark(grade: string): string {
  const map: Record<string, string> = {
    A: "Excellent", B: "Very Good", C: "Good", D: "Fair", E: "Pass", F: "Fail",
  };
  return map[grade] || "";
}

export default function GenerateReportCardsPage() {
  const router = useRouter();
  const { isAdmin, orgId, profile } = useAuth();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [students, setStudents] = useState<Student[]>([]);
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);

  const [yearId, setYearId] = useState("");
  const [classId, setClassId] = useState("");
  const [term, setTerm] = useState("Term 1");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [st, yr, cl] = await Promise.all([
      supabase.from("students").select("id, student_code, full_name, grade").eq("status", "active").order("full_name"),
      supabase.from("academic_years").select("*").order("name", { ascending: false }),
      supabase.from("classes").select("id, name").eq("active", true).order("sequence"),
    ]);
    setStudents((st.data ?? []) as Student[]);
    setYears((yr.data ?? []) as AcademicYear[]);
    setClasses((cl.data ?? []) as ClassRow[]);
    const cur = (yr.data ?? []).find((y) => (y as { status: string }).status === "current");
    if (cur) setYearId((cur as { id: string }).id);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const filteredStudents = useMemo(() => {
    if (!classId) return students;
    const cls = classes.find(c => c.id === classId);
    return students.filter(s => s.grade === cls?.name);
  }, [students, classId, classes]);

  function toggleAll(checked: boolean) {
    setSelectedIds(checked ? new Set(filteredStudents.map(s => s.id)) : new Set());
  }

  async function generate() {
    if (selectedIds.size === 0) return;
    setGenerating(true);
    let created = 0, skipped = 0;

    for (const studentId of Array.from(selectedIds)) {
      // Skip if already exists
      const { data: existing } = await supabase.from("report_cards")
        .select("id").eq("student_id", studentId).eq("academic_year_id", yearId).eq("term", term).maybeSingle();
      if (existing) { skipped++; continue; }

      // Pull assessment scores for this student, year, term
      const { data: assessments } = await supabase.from("assessment_scores")
        .select("subject_name, subject_id, ca1_score, ca2_score, ca3_score, exam_score")
        .eq("student_id", studentId)
        .eq("academic_year_id", yearId)
        .eq("term", term);

      const subjectRows = (assessments ?? []) as unknown as { subject_name: string; subject_id: string | null; ca1_score: number | null; ca2_score: number | null; ca3_score: number | null; exam_score: number | null; }[];

      const subjectTotals = subjectRows.map(r => {
        const total = (r.ca1_score || 0) + (r.ca2_score || 0) + (r.ca3_score || 0) + (r.exam_score || 0);
        const grade = calcGrade(total);
        return { ...r, total, grade, remark: calcRemark(grade) };
      });

      const totalScore = subjectTotals.reduce((s, r) => s + r.total, 0);
      const avgScore = subjectTotals.length > 0 ? totalScore / subjectTotals.length : 0;

      const { data: card } = await supabase.from("report_cards").insert({
        organization_id: orgId,
        student_id: studentId,
        academic_year_id: yearId || null,
        class_id: classId || null,
        term,
        total_score: totalScore,
        average_score: avgScore,
        total_subjects: subjectTotals.length,
        grade_overall: calcGrade(avgScore),
        published: false,
      }).select().single();

      if (card) {
        const cardTyped = card as unknown as { id: string };
        if (subjectTotals.length > 0) {
          await supabase.from("report_card_subjects").insert(
            subjectTotals.map(s => ({
              report_card_id: cardTyped.id,
              organization_id: orgId,
              subject_id: s.subject_id,
              subject_name: s.subject_name,
              ca1_score: s.ca1_score,
              ca2_score: s.ca2_score,
              ca3_score: s.ca3_score,
              exam_score: s.exam_score,
              total_score: s.total,
              grade: s.grade,
              remark: s.remark,
            }))
          );
        }
        created++;
      }
    }

    setResult({ created, skipped });
    setGenerating(false);
    setSelectedIds(new Set());
  }

  if (loading) return <LoadingSpinner />;
  if (!isAdmin) return <div className="p-8 text-center text-gray-500">Admin access required.</div>;

  return (
    <div className="space-y-6">
      <Link href="/dashboard/report-cards" className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-[#C9A227]">
        <ArrowLeft size={14} /> Back
      </Link>

      <PageHeader
        title="Generate Report Cards"
        subtitle="Bulk-generate report cards from recorded assessment scores"
      />

      <Card>
        <CardHeader>
          <CardTitle>Batch Settings</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Academic Year</label>
              <select value={yearId} onChange={e => setYearId(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                <option value="">Select year…</option>
                {years.map(y => <option key={y.id} value={y.id}>{y.name} {y.status === "current" ? "(current)" : ""}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Term</label>
              <select value={term} onChange={e => setTerm(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                <option value="Term 1">Term 1</option>
                <option value="Term 2">Term 2</option>
                <option value="Term 3">Term 3</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Class (filter)</label>
              <select value={classId} onChange={e => setClassId(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                <option value="">All classes</option>
                {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Select Students ({filteredStudents.length})</CardTitle>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">{selectedIds.size} selected</span>
              <Button size="sm" variant="gold" disabled={selectedIds.size === 0 || !yearId} loading={generating} onClick={generate}>
                <Play size={14} /> Generate {selectedIds.size} Report Cards
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="bg-gray-50 border-b">
                  <th className="w-8 px-2 py-2">
                    <input type="checkbox" onChange={e => toggleAll(e.target.checked)}
                      checked={selectedIds.size > 0 && selectedIds.size === filteredStudents.length}
                      className="w-4 h-4 rounded" />
                  </th>
                  <th className="text-left px-3 py-2">Code</th>
                  <th className="text-left px-3 py-2">Name</th>
                  <th className="text-left px-3 py-2">Grade</th>
                </tr>
              </thead>
              <tbody>
                {filteredStudents.map(s => (
                  <tr key={s.id} className="border-b hover:bg-gray-50">
                    <td className="px-2 py-2">
                      <input type="checkbox" checked={selectedIds.has(s.id)}
                        onChange={e => {
                          const next = new Set(selectedIds);
                          e.target.checked ? next.add(s.id) : next.delete(s.id);
                          setSelectedIds(next);
                        }}
                        className="w-4 h-4 rounded" />
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{s.student_code}</td>
                    <td className="px-3 py-2 font-medium">{s.full_name}</td>
                    <td className="px-3 py-2 text-gray-600">{s.grade || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {result && (
        <div className="p-4 bg-green-50 border border-green-200 rounded-xl">
          <div className="font-semibold text-green-800">Batch Complete</div>
          <p className="text-sm text-green-700 mt-1">
            {result.created} report cards created. {result.skipped} skipped (already existed).
          </p>
        </div>
      )}
    </div>
  );
}
