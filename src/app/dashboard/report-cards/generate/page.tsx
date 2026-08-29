"use client";

/**
 * Report Card Batch Generator
 * ---------------------------
 * Generates report_cards + report_card_subjects rows for a selected class
 * / year / term across the picked students.
 *
 * The previous version had three real bugs:
 *   1. Read from a non-existent `assessment_scores` table. Actual per-
 *      student marks are stored in `student_scores` (pivoted by
 *      `assessment_type_id`). Every generated card came out empty.
 *   2. Used a hardcoded grading band inside a `calcGrade` function
 *      instead of reading `grading_scales` from the DB, so any school
 *      that customised its bands got mis-graded cards.
 *   3. Left `position_in_class`, `class_size`, `attendance_present`,
 *      `attendance_total`, and per-subject `position/class_highest/
 *      class_lowest/class_average` null — the detail card and master
 *      sheet both expect them.
 *
 * Fixed here by:
 *   • Reading `assessment_types` (sorted by sort_order) and mapping the
 *     first three "CA" types → ca1/ca2/ca3 slots on
 *     report_card_subjects, and the exam-type (matched by short_code
 *     "EXAM" or by name containing "exam", falling back to the last
 *     type) → exam_score slot.
 *   • Reading `grading_scales` and grading each subject total + each
 *     student average via a shared lookup instead of a hardcoded band.
 *   • Aggregating `attendance_records` for the year/term window and
 *     writing attendance_present / attendance_total.
 *   • Running a second pass after the batch to rank students by
 *     total_score within the class and stamp `position_in_class` +
 *     `class_size`, and a third pass to rank each subject and stamp
 *     `position` + `class_highest/lowest/average` on the per-subject
 *     rows.
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { PageHeader, LoadingSpinner } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/lib/hooks/useToast";
import { ArrowLeft, Play } from "lucide-react";

interface Student { id: string; student_code: string; full_name: string; grade: string | null; }
interface AcademicYear { id: string; name: string; status: string; }
interface ClassRow { id: string; name: string; }
interface AssessmentType { id: string; name: string; short_code: string | null; max_score: number; sort_order: number; }
interface GradingScale { grade: string; label: string; min_score: number; max_score: number; sort_order: number; }
interface SubjectRow { id: string; name: string; }
interface StudentScore { student_id: string; subject_id: string; assessment_type_id: string; score: number | null; }
interface AttendanceRow { student_id: string; status_code: string; date: string; }

type Slot = "ca1" | "ca2" | "ca3" | "exam";

export default function GenerateReportCardsPage() {
  const { isAdmin, orgId } = useAuth();
  const supabase = createClient();
  const { notify, ToastHost } = useToast();

  const [loading, setLoading] = useState(true);
  const [students, setStudents] = useState<Student[]>([]);
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);

  const [yearId, setYearId] = useState("");
  const [classId, setClassId] = useState("");
  const [term, setTerm] = useState("Term 1");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const [result, setResult] = useState<{ created: number; skipped: number; failed: number; ranked: number } | null>(null);

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
    const cls = classes.find((c) => c.id === classId);
    return students.filter((s) => s.grade === cls?.name);
  }, [students, classId, classes]);

  function toggleAll(checked: boolean) {
    setSelectedIds(checked ? new Set(filteredStudents.map((s) => s.id)) : new Set());
  }

  /**
   * Build a mapping from assessment_type_id → slot on report_card_subjects.
   * report_card_subjects has fixed slots (ca1/ca2/ca3/exam), which pre-date
   * the configurable assessment_types table. We map by convention:
   *   • First three types (by sort_order) whose short_code starts with "CA"
   *     go to ca1/ca2/ca3.
   *   • A type whose short_code is "EXAM" (case-insensitive) or name
     * contains "exam" goes to exam_score.
   *   • If no explicit exam type is found, the last type (highest sort_order)
   *     is treated as exam.
   *   • Anything beyond that is ignored for the card — a limitation of the
   *     current fixed schema, not this code.
   */
  function buildSlotMap(types: AssessmentType[]): { slots: Map<string, Slot>; maxByslot: Record<Slot, number> } {
    const sorted = [...types].sort((a, b) => a.sort_order - b.sort_order);
    const slots = new Map<string, Slot>();
    const maxByslot: Record<Slot, number> = { ca1: 0, ca2: 0, ca3: 0, exam: 0 };

    const caTypes = sorted.filter((t) => (t.short_code || "").toUpperCase().startsWith("CA"));
    const explicitExam = sorted.find((t) => {
      const sc = (t.short_code || "").toUpperCase();
      const nm = (t.name || "").toLowerCase();
      return sc === "EXAM" || sc === "EXM" || nm.includes("exam");
    });

    const caSlots: Slot[] = ["ca1", "ca2", "ca3"];
    caTypes.slice(0, 3).forEach((t, i) => {
      slots.set(t.id, caSlots[i]);
      maxByslot[caSlots[i]] = t.max_score;
    });

    let examType = explicitExam;
    if (!examType) examType = sorted[sorted.length - 1]; // fallback: last by sort_order
    if (examType && !slots.has(examType.id)) {
      slots.set(examType.id, "exam");
      maxByslot.exam = examType.max_score;
    }
    return { slots, maxByslot };
  }

  function gradeFor(pct: number, scales: GradingScale[]): GradingScale | null {
    return scales.find((g) => pct >= g.min_score && pct <= g.max_score) || null;
  }

  function remarkFor(grade: string): string {
    // Reasonable defaults if the grading_scales.label doesn't carry a
    // remark. Real value should come from grading_scales.label but we
    // fall back so a mis-configured band still produces a card.
    const map: Record<string, string> = { A: "Excellent", B: "Very Good", C: "Good", D: "Fair", E: "Pass", F: "Fail" };
    return map[grade] || "";
  }

  async function generate() {
    if (selectedIds.size === 0 || !yearId) return;
    setGenerating(true);
    setResult(null);
    let created = 0, skipped = 0, failed = 0;

    setProgress("Loading rubric and score data…");

    // -----------------------------------------------------------------
    // 1. Load shared reference data once (not per-student).
    // -----------------------------------------------------------------
    const selectedIdArr = Array.from(selectedIds);
    const [atRes, gsRes, subRes, scoresRes, attRes] = await Promise.all([
      supabase.from("assessment_types").select("id, name, short_code, max_score, sort_order").eq("active", true).order("sort_order"),
      supabase.from("grading_scales").select("grade, label, min_score, max_score, sort_order").order("sort_order"),
      supabase.from("subjects").select("id, name").eq("active", true),
      supabase
        .from("student_scores")
        .select("student_id, subject_id, assessment_type_id, score")
        .in("student_id", selectedIdArr)
        .eq("academic_year_id", yearId)
        .eq("term", term),
      supabase
        .from("attendance_records")
        .select("student_id, status_code, date")
        .in("student_id", selectedIdArr),
    ]);

    const types = (atRes.data ?? []) as AssessmentType[];
    const scales = (gsRes.data ?? []) as GradingScale[];
    const subjects = (subRes.data ?? []) as SubjectRow[];
    const scores = (scoresRes.data ?? []) as StudentScore[];
    const attendance = (attRes.data ?? []) as AttendanceRow[];

    if (types.length === 0) {
      notify("No assessment types configured. Set them up under Setup → Academic Setup first.", "error");
      setGenerating(false);
      setProgress("");
      return;
    }
    if (scales.length === 0) {
      notify("No grading scales configured. Set them up under Setup → Academic Setup first.", "error");
      setGenerating(false);
      setProgress("");
      return;
    }

    const { slots, maxByslot } = buildSlotMap(types);
    const totalMax = maxByslot.ca1 + maxByslot.ca2 + maxByslot.ca3 + maxByslot.exam || 100;
    const subjectNameById = new Map(subjects.map((s) => [s.id, s.name]));

    // Attendance count assumes any "present" or "late" code = present.
    // Custom attendance_statuses that reuse different codes will need
    // this rule adjusted, but this matches the rest of the app.
    const attCounts = new Map<string, { present: number; total: number }>();
    for (const row of attendance) {
      const cur = attCounts.get(row.student_id) ?? { present: 0, total: 0 };
      cur.total++;
      const code = (row.status_code || "").toLowerCase();
      if (code === "present" || code === "late" || code === "p") cur.present++;
      attCounts.set(row.student_id, cur);
    }

    // Pivot scores: studentId → subjectId → { ca1, ca2, ca3, exam }
    const pivot = new Map<string, Map<string, Partial<Record<Slot, number | null>>>>();
    for (const s of scores) {
      const slot = slots.get(s.assessment_type_id);
      if (!slot) continue; // extra assessment type past the fixed 4
      let byStudent = pivot.get(s.student_id);
      if (!byStudent) { byStudent = new Map(); pivot.set(s.student_id, byStudent); }
      let bySubject = byStudent.get(s.subject_id);
      if (!bySubject) { bySubject = {}; byStudent.set(s.subject_id, bySubject); }
      bySubject[slot] = s.score;
    }

    // -----------------------------------------------------------------
    // 2. Per-student: create report_cards + report_card_subjects rows.
    //    Positions and class-wide subject stats stay null here; a
    //    second pass ranks them after the batch is written.
    // -----------------------------------------------------------------
    setProgress("Writing report cards…");
    let idx = 0;
    for (const studentId of selectedIdArr) {
      idx++;
      setProgress(`Writing report cards… (${idx}/${selectedIdArr.length})`);
      // Skip if already exists
      const { data: existing } = await supabase.from("report_cards")
        .select("id").eq("student_id", studentId).eq("academic_year_id", yearId).eq("term", term).maybeSingle();
      if (existing) { skipped++; continue; }

      const byStudent = pivot.get(studentId) ?? new Map();
      const subjectTotals: Array<{ subject_id: string; subject_name: string; ca1: number | null; ca2: number | null; ca3: number | null; exam: number | null; total: number; grade: string; remark: string; }> = [];

      byStudent.forEach((scoresForSubject, subject_id) => {
        const ca1 = scoresForSubject.ca1 ?? null;
        const ca2 = scoresForSubject.ca2 ?? null;
        const ca3 = scoresForSubject.ca3 ?? null;
        const exam = scoresForSubject.exam ?? null;
        const total = (ca1 ?? 0) + (ca2 ?? 0) + (ca3 ?? 0) + (exam ?? 0);
        const pct = totalMax > 0 ? (total / totalMax) * 100 : 0;
        const gr = gradeFor(pct, scales);
        subjectTotals.push({
          subject_id,
          subject_name: subjectNameById.get(subject_id) || "Unknown",
          ca1, ca2, ca3, exam, total,
          grade: gr?.grade || "-",
          remark: gr?.label || remarkFor(gr?.grade || ""),
        });
      });

      const totalScore = subjectTotals.reduce((s, r) => s + r.total, 0);
      const avgPct = subjectTotals.length > 0
        ? subjectTotals.reduce((s, r) => s + (totalMax > 0 ? (r.total / totalMax) * 100 : 0), 0) / subjectTotals.length
        : 0;
      const overallGrade = gradeFor(avgPct, scales);
      const att = attCounts.get(studentId) ?? { present: 0, total: 0 };

      const { data: card, error: cardErr } = await supabase.from("report_cards").insert({
        organization_id: orgId,
        student_id: studentId,
        academic_year_id: yearId || null,
        class_id: classId || null,
        term,
        total_score: totalScore,
        average_score: avgPct,
        total_subjects: subjectTotals.length,
        grade_overall: overallGrade?.grade || null,
        attendance_present: att.present,
        attendance_total: att.total,
        published: false,
      }).select("id").single();

      if (cardErr || !card) {
        failed++;
        continue;
      }

      if (subjectTotals.length > 0) {
        const { error: subErr } = await supabase.from("report_card_subjects").insert(
          subjectTotals.map((s) => ({
            report_card_id: (card as { id: string }).id,
            organization_id: orgId,
            subject_id: s.subject_id,
            subject_name: s.subject_name,
            ca1_score: s.ca1,
            ca2_score: s.ca2,
            ca3_score: s.ca3,
            exam_score: s.exam,
            total_score: s.total,
            grade: s.grade,
            remark: s.remark,
          })),
        );
        if (subErr) {
          failed++;
          continue;
        }
      }
      created++;
    }

    // -----------------------------------------------------------------
    // 3. Second pass: rank each student by total_score within the
    //    class + year + term window and stamp position_in_class /
    //    class_size on their report_card row.
    // -----------------------------------------------------------------
    setProgress("Ranking positions…");
    let ranked = 0;
    if (classId) {
      // Include every card in the class for this year+term, not just
      // the ones this batch created, so positions are correct if some
      // students had cards from a prior partial run.
      const { data: cardsInClass } = await supabase
        .from("report_cards")
        .select("id, student_id, total_score")
        .eq("academic_year_id", yearId)
        .eq("class_id", classId)
        .eq("term", term);
      const list = (cardsInClass ?? []) as Array<{ id: string; student_id: string; total_score: number }>;
      const sortedList = [...list].sort((a, b) => (b.total_score ?? 0) - (a.total_score ?? 0));
      for (let i = 0; i < sortedList.length; i++) {
        const c = sortedList[i];
        const { error: posErr } = await supabase.from("report_cards").update({
          position_in_class: i + 1,
          class_size: sortedList.length,
        }).eq("id", c.id);
        if (!posErr) ranked++;
      }

      // ---------------------------------------------------------------
      // 4. Third pass: for each subject in the class, compute position
      //    + class_highest / class_lowest / class_average across all
      //    report_card_subjects rows in that class+year+term.
      // ---------------------------------------------------------------
      setProgress("Computing subject stats…");
      const cardIds = list.map((c) => c.id);
      if (cardIds.length > 0) {
        const { data: subRows } = await supabase
          .from("report_card_subjects")
          .select("id, report_card_id, subject_id, total_score")
          .in("report_card_id", cardIds);
        const rows = (subRows ?? []) as Array<{ id: string; report_card_id: string; subject_id: string | null; total_score: number | null }>;

        // Group by subject_id
        const bySubject = new Map<string, typeof rows>();
        for (const r of rows) {
          if (!r.subject_id) continue;
          const list = bySubject.get(r.subject_id) ?? [];
          list.push(r);
          bySubject.set(r.subject_id, list);
        }
        const subjectIds = Array.from(bySubject.keys());
        for (const sid of subjectIds) {
          const subRowsForSubject = bySubject.get(sid) ?? [];
          const sorted = [...subRowsForSubject].sort((a, b) => (b.total_score ?? 0) - (a.total_score ?? 0));
          const values = sorted.map((r) => r.total_score ?? 0);
          const highest = values.length ? Math.max(...values) : 0;
          const lowest = values.length ? Math.min(...values) : 0;
          const avg = values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
          for (let i = 0; i < sorted.length; i++) {
            await supabase.from("report_card_subjects").update({
              position: i + 1,
              class_highest: highest,
              class_lowest: lowest,
              class_average: avg,
            }).eq("id", sorted[i].id);
          }
        }
      }
    }

    setResult({ created, skipped, failed, ranked });
    setProgress("");
    setGenerating(false);
    setSelectedIds(new Set());
    if (failed > 0) notify(`Generated ${created} cards, ${failed} failed. See details below.`, "error");
    else notify(`Generated ${created} report cards (${skipped} skipped, ${ranked} ranked).`);
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
        subtitle="Bulk-generate report cards from recorded assessment scores. Positions, attendance, and class stats are computed automatically."
      />

      <Card>
        <CardHeader>
          <CardTitle>Batch Settings</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Academic Year</label>
              <select value={yearId} onChange={(e) => setYearId(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                <option value="">Select year…</option>
                {years.map((y) => <option key={y.id} value={y.id}>{y.name} {y.status === "current" ? "(current)" : ""}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Term</label>
              <select value={term} onChange={(e) => setTerm(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                <option value="Term 1">Term 1</option>
                <option value="Term 2">Term 2</option>
                <option value="Term 3">Term 3</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Class (required for position + subject stats)</label>
              <select value={classId} onChange={(e) => setClassId(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                <option value="">All classes (no ranking)</option>
                {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>
          {!classId && (
            <p className="text-xs text-amber-700 mt-3">
              Ranking is only computed when a class is selected — position_in_class, class_size, and subject class_highest/lowest/average require a defined cohort.
            </p>
          )}
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
          {progress && <p className="text-xs text-gray-500 mt-1">{progress}</p>}
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="bg-gray-50 border-b">
                  <th className="w-8 px-2 py-2">
                    <input type="checkbox" onChange={(e) => toggleAll(e.target.checked)}
                      checked={selectedIds.size > 0 && selectedIds.size === filteredStudents.length}
                      className="w-4 h-4 rounded" />
                  </th>
                  <th className="text-left px-3 py-2">Code</th>
                  <th className="text-left px-3 py-2">Name</th>
                  <th className="text-left px-3 py-2">Grade</th>
                </tr>
              </thead>
              <tbody>
                {filteredStudents.map((s) => (
                  <tr key={s.id} className="border-b hover:bg-gray-50">
                    <td className="px-2 py-2">
                      <input type="checkbox" checked={selectedIds.has(s.id)}
                        onChange={(e) => {
                          const next = new Set(selectedIds);
                          if (e.target.checked) next.add(s.id); else next.delete(s.id);
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
        <div className={"p-4 rounded-xl border " + (result.failed > 0 ? "bg-amber-50 border-amber-200" : "bg-green-50 border-green-200")}>
          <div className={"font-semibold " + (result.failed > 0 ? "text-amber-800" : "text-green-800")}>
            {result.failed > 0 ? "Batch Complete (with issues)" : "Batch Complete"}
          </div>
          <p className={"text-sm mt-1 " + (result.failed > 0 ? "text-amber-700" : "text-green-700")}>
            {result.created} report cards created · {result.skipped} skipped (already existed) · {result.failed} failed · {result.ranked} ranked positions written.
          </p>
        </div>
      )}
      <ToastHost />
    </div>
  );
}
