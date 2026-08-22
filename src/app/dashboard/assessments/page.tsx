"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { cn } from "@/lib/utils";
import { PageHeader, LoadingSpinner } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Save, CheckCircle2 } from "lucide-react";

interface ClassRow { id: string; name: string; }
interface SubjectRow { id: string; name: string; short_code: string; }
interface AssessmentTypeRow { id: string; name: string; short_code: string; weight: number; max_score: number; sort_order: number; }
interface GradeRow { grade: string; label: string; min_score: number; max_score: number; }
interface StudentRow { id: string; student_code: string; full_name: string; grade: string | null; }
interface ScoreRow { id: string; student_id: string; assessment_type_id: string; score: number | null; }

export default function AssessmentsPage() {
  const { canEdit, profile, orgId } = useAuth();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [types, setTypes] = useState<AssessmentTypeRow[]>([]);
  const [grades, setGrades] = useState<GradeRow[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [scores, setScores] = useState<ScoreRow[]>([]);

  const [selectedClassId, setSelectedClassId] = useState("");
  const [selectedSubjectId, setSelectedSubjectId] = useState("");
  const [selectedTerm, setSelectedTerm] = useState("Term 1");

  // Editable scores: student_id → { type_id → score }
  const [editScores, setEditScores] = useState<Record<string, Record<string, string>>>({});

  const loadBase = useCallback(async () => {
    const [clsRes, subRes, typRes, grdRes] = await Promise.all([
      supabase.from("classes").select("id, name").eq("active", true).order("sequence"),
      supabase.from("subjects").select("id, name, short_code").eq("active", true).order("name"),
      supabase.from("assessment_types").select("*").eq("active", true).order("sort_order"),
      supabase.from("grading_scales").select("grade, label, min_score, max_score").order("sort_order"),
    ]);
    setClasses(clsRes.data as ClassRow[] ?? []);
    setSubjects(subRes.data as SubjectRow[] ?? []);
    setTypes(typRes.data as AssessmentTypeRow[] ?? []);
    setGrades(grdRes.data as GradeRow[] ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { loadBase(); }, [loadBase]);

  // Load students + scores when class/subject/term change
  const loadScores = useCallback(async () => {
    if (!selectedClassId || !selectedSubjectId) { setStudents([]); setScores([]); setEditScores({}); return; }

    const selectedClass = classes.find(c => c.id === selectedClassId);
    if (!selectedClass) return;

    const { data: stuData } = await supabase
      .from("students")
      .select("id, student_code, full_name, grade")
      .eq("status", "active")
      .or(`grade.eq.${selectedClass.name},grade.eq.${selectedClass.id}`)
      .order("full_name");

    const stuList = stuData as StudentRow[] ?? [];
    setStudents(stuList);

    // Load existing scores
    const { data: scoreData } = await supabase
      .from("student_scores")
      .select("id, student_id, assessment_type_id, score")
      .eq("subject_id", selectedSubjectId)
      .eq("class_id", selectedClassId)
      .eq("term", selectedTerm);

    const scoreList = scoreData as ScoreRow[] ?? [];
    setScores(scoreList);

    // Pre-fill edit state
    const newEdit: Record<string, Record<string, string>> = {};
    for (const stu of stuList) {
      newEdit[stu.id] = {};
      for (const t of types) {
        const existing = scoreList.find(s => s.student_id === stu.id && s.assessment_type_id === t.id);
        newEdit[stu.id][t.id] = existing?.score != null ? String(existing.score) : "";
      }
    }
    setEditScores(newEdit);
  }, [selectedClassId, selectedSubjectId, selectedTerm, classes, types, supabase]);

  useEffect(() => { loadScores(); }, [loadScores]);

  function getTotal(studentId: string): number {
    let total = 0;
    for (const t of types) {
      const val = parseFloat(editScores[studentId]?.[t.id] || "0");
      if (!isNaN(val)) total += val;
    }
    return total;
  }

  function getGrade(total: number): GradeRow | null {
    // Normalize: total is sum of raw scores out of sum of max_scores
    const maxTotal = types.reduce((s, t) => s + t.max_score, 0);
    const percentage = maxTotal > 0 ? (total / maxTotal) * 100 : 0;
    return grades.find(g => percentage >= g.min_score && percentage <= g.max_score) || null;
  }

  async function saveAllScores() {
    if (!selectedClassId || !selectedSubjectId || students.length === 0) return;
    setSaving(true);

    const { data: yearData } = await supabase
      .from("academic_years").select("id").eq("status", "current").limit(1).maybeSingle();
    const yearId = yearData?.id || null;

    // Build upsert records
    const records: Record<string, unknown>[] = [];
    for (const stu of students) {
      for (const t of types) {
        const val = editScores[stu.id]?.[t.id];
        if (val === "" || val === undefined) continue; // skip empty
        records.push({
          student_id: stu.id,
          subject_id: selectedSubjectId,
          assessment_type_id: t.id,
          class_id: selectedClassId,
          academic_year_id: yearId,
          term: selectedTerm,
          score: parseFloat(val),
          recorded_by: profile?.full_name || profile?.email,
          organization_id: orgId,
        });
      }
    }

    if (records.length > 0) {
      // Delete existing and re-insert (handles the unique constraint cleanly)
      const studentIds = students.map(s => s.id);
      await supabase
        .from("student_scores")
        .delete()
        .eq("subject_id", selectedSubjectId)
        .eq("class_id", selectedClassId)
        .eq("term", selectedTerm)
        .in("student_id", studentIds);

      await supabase.from("student_scores").insert(records);
    }

    await supabase.from("activity_log").insert({
      user_email: profile?.email, user_name: profile?.full_name,
      action: "Record Assessment Scores",
      details: `${subjects.find(s => s.id === selectedSubjectId)?.name} — ${classes.find(c => c.id === selectedClassId)?.name} — ${selectedTerm} — ${students.length} students`,
      organization_id: orgId,
    });

    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
    loadScores();
  }

  if (loading) return <div className="p-6"><LoadingSpinner /></div>;

  const maxTotal = types.reduce((s, t) => s + t.max_score, 0);

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="Assessments & Gradebook" subtitle="Enter student scores and view calculated grades" />

      {/* Selectors */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Class</label>
              <select value={selectedClassId} onChange={e => setSelectedClassId(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227] min-w-[150px]">
                <option value="">Select class...</option>
                {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Subject</label>
              <select value={selectedSubjectId} onChange={e => setSelectedSubjectId(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227] min-w-[150px]">
                <option value="">Select subject...</option>
                {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Term</label>
              <select value={selectedTerm} onChange={e => setSelectedTerm(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]">
                <option value="Term 1">Term 1</option>
                <option value="Term 2">Term 2</option>
                <option value="Term 3">Term 3</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Score entry grid */}
      {selectedClassId && selectedSubjectId && students.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>
                {subjects.find(s => s.id === selectedSubjectId)?.name} — {classes.find(c => c.id === selectedClassId)?.name}
              </CardTitle>
              <span className="text-xs text-gray-500">{students.length} students</span>
            </div>
          </CardHeader>
          <CardContent className="py-0 overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b">
                  <th className="text-left px-2 py-2.5 font-semibold text-gray-600 sticky left-0 bg-gray-50 min-w-[180px]">Student</th>
                  {types.map(t => (
                    <th key={t.id} className="text-center px-2 py-2.5 font-semibold text-gray-600 min-w-[70px]">
                      <div>{t.short_code}</div>
                      <div className="text-[10px] font-normal text-gray-400">/{t.max_score}</div>
                    </th>
                  ))}
                  <th className="text-center px-2 py-2.5 font-semibold text-gray-600 min-w-[60px]">Total<br /><span className="text-[10px] font-normal text-gray-400">/{maxTotal}</span></th>
                  <th className="text-center px-2 py-2.5 font-semibold text-gray-600 min-w-[50px]">Grade</th>
                </tr>
              </thead>
              <tbody>
                {students.map(stu => {
                  const total = getTotal(stu.id);
                  const grade = getGrade(total);
                  return (
                    <tr key={stu.id} className="border-b hover:bg-gray-50">
                      <td className="px-2 py-1.5 sticky left-0 bg-white">
                        <div className="font-medium text-gray-900 text-xs">{stu.full_name}</div>
                        <div className="text-[10px] text-gray-400 font-mono">{stu.student_code}</div>
                      </td>
                      {types.map(t => (
                        <td key={t.id} className="px-1 py-1 text-center">
                          <input
                            type="number"
                            min="0"
                            max={t.max_score}
                            step="0.5"
                            value={editScores[stu.id]?.[t.id] ?? ""}
                            onChange={e => setEditScores(prev => ({
                              ...prev,
                              [stu.id]: { ...prev[stu.id], [t.id]: e.target.value },
                            }))}
                            className="w-14 px-1.5 py-1 border border-gray-200 rounded text-center text-sm focus:outline-none focus:ring-1 focus:ring-[#C9A227] focus:border-[#C9A227]"
                            disabled={!canEdit}
                          />
                        </td>
                      ))}
                      <td className="px-2 py-1.5 text-center font-bold text-[#0F2A47]">{total || "—"}</td>
                      <td className="px-2 py-1.5 text-center">
                        {grade ? (
                          <span className={cn("px-2 py-0.5 rounded text-xs font-bold",
                            grade.grade === "A" ? "bg-green-100 text-green-700" :
                            grade.grade === "B" ? "bg-blue-100 text-blue-700" :
                            grade.grade === "C" ? "bg-amber-100 text-amber-700" :
                            grade.grade === "F" ? "bg-red-100 text-red-700" :
                            "bg-gray-100 text-gray-700"
                          )}>{grade.grade}</span>
                        ) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {selectedClassId && selectedSubjectId && students.length === 0 && (
        <div className="text-center py-12 text-gray-400 text-sm">
          No active students found for this class.
        </div>
      )}

      {(!selectedClassId || !selectedSubjectId) && (
        <div className="text-center py-12 text-gray-400 text-sm">
          Select a class and subject above to enter scores.
        </div>
      )}

      {/* Save */}
      {selectedClassId && selectedSubjectId && students.length > 0 && canEdit && (
        <div className="flex items-center gap-3">
          <Button variant="gold" loading={saving} onClick={saveAllScores}>
            <Save size={14} /> Save All Scores
          </Button>
          {saved && (
            <span className="flex items-center gap-1 text-green-600 text-sm font-medium">
              <CheckCircle2 size={14} /> Saved
            </span>
          )}
        </div>
      )}

      {/* Grading scale reference */}
      {grades.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Grading Scale</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              {grades.map(g => (
                <div key={g.grade} className="flex items-center gap-2 text-xs bg-gray-50 rounded-lg px-3 py-1.5 border">
                  <span className="font-bold text-[#0F2A47]">{g.grade}</span>
                  <span className="text-gray-500">{g.min_score}–{g.max_score}%</span>
                  <span className="text-gray-400">({g.label})</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
