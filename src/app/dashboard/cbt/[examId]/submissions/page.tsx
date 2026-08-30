"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { cn } from "@/lib/utils";
import { PageHeader, LoadingSpinner } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ArrowLeft, ClipboardCheck, CheckCircle2, AlertTriangle } from "lucide-react";

interface Submission {
  id: string;
  student_id: string;
  student_name: string | null;
  student_code: string | null;
  attempt_number: number;
  status: string;
  total_score: number | null;
  total_marks: number | null;
  percentage: number | null;
  passed: boolean | null;
  submitted_at: string | null;
  started_at: string | null;
  needs_grading: boolean;
}

interface OptionRow { id: string; text: string; is_correct?: boolean }

interface AnswerRow {
  sort_order: number;
  question_id: string;
  question_text: string;
  question_type: string;
  marks: number;
  options: OptionRow[] | null;
  model_answer: string | null;
  explanation: string | null;
  answer_id: string | null;
  selected_option: string | null;
  answer_text: string | null;
  is_correct: boolean | null;
  marks_awarded: number | null;
}

interface AttemptMeta {
  id: string;
  status: string;
  total_score: number | null;
  total_marks: number | null;
  percentage: number | null;
  passed: boolean | null;
}

// Only essays are graded by hand here; every other type is auto-graded on
// submit_exam_attempt and shown read-only.
function isManual(type: string): boolean {
  return type === "essay";
}

export default function ExamSubmissionsPage() {
  const { examId } = useParams<{ examId: string }>();
  const { canEdit, membership } = useAuth();
  const supabase = createClient();
  // Mirror of the server-side can_grade_org(): admins/staff (canEdit) plus
  // teachers. The RPCs enforce this again server-side, so this only controls
  // what the client bothers to render.
  const canGrade = canEdit || membership?.role === "teacher";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [examTitle, setExamTitle] = useState("Exam");
  const [subs, setSubs] = useState<Submission[]>([]);

  // Detail / grading state
  const [active, setActive] = useState<Submission | null>(null);
  const [answers, setAnswers] = useState<AnswerRow[]>([]);
  const [attemptMeta, setAttemptMeta] = useState<AttemptMeta | null>(null);
  const [marks, setMarks] = useState<Record<string, string>>({});
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadSubs = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data: ex } = await supabase
      .from("exams").select("title").eq("id", examId).maybeSingle();
    setExamTitle((ex as { title: string } | null)?.title ?? "Exam");

    const { data, error: err } = await supabase.rpc("get_exam_submissions", { p_exam: examId });
    if (err) { setError(err.message); setLoading(false); return; }
    const res = data as { ok: boolean; submissions: Submission[] } | null;
    setSubs(res?.submissions ?? []);
    setLoading(false);
  }, [examId, supabase]);

  useEffect(() => {
    if (canGrade) loadSubs();
    else setLoading(false);
  }, [canGrade, loadSubs]);

  async function openAttempt(sub: Submission) {
    setActive(sub);
    setLoadingDetail(true);
    setAnswers([]);
    setAttemptMeta(null);
    setMarks({});
    const { data, error: err } = await supabase.rpc("get_attempt_answers", { p_attempt: sub.id });
    if (err) { setError(err.message); setLoadingDetail(false); return; }
    const res = data as { ok: boolean; attempt: AttemptMeta; answers: AnswerRow[] } | null;
    const rows = res?.answers ?? [];
    setAnswers(rows);
    setAttemptMeta(res?.attempt ?? null);
    const seed: Record<string, string> = {};
    for (const r of rows) {
      if (isManual(r.question_type)) {
        seed[r.question_id] = r.marks_awarded != null ? String(r.marks_awarded) : "";
      }
    }
    setMarks(seed);
    setLoadingDetail(false);
  }

  // Live preview of the total the attempt will get once saved: hand-entered
  // marks for essays + the existing auto-graded marks for everything else.
  function previewScore(): { score: number; total: number } {
    let score = 0;
    let total = 0;
    for (const a of answers) {
      total += Number(a.marks) || 0;
      if (isManual(a.question_type)) {
        const v = Math.max(0, Math.min(Number(marks[a.question_id] || 0) || 0, Number(a.marks) || 0));
        score += v;
      } else {
        score += Number(a.marks_awarded) || 0;
      }
    }
    return { score, total };
  }

  async function saveGrades() {
    if (!active) return;
    setSaving(true);
    setError(null);
    const payload = answers
      .filter(a => isManual(a.question_type))
      .map(a => ({
        question_id: a.question_id,
        marks: Math.max(0, Math.min(Number(marks[a.question_id] || 0) || 0, Number(a.marks) || 0)),
      }));
    const { error: err } = await supabase.rpc("grade_attempt", { p_attempt: active.id, p_marks: payload });
    setSaving(false);
    if (err) { setError(err.message); return; }
    setActive(null);
    await loadSubs();
  }

  function renderStudentAnswer(a: AnswerRow) {
    const type = a.question_type;
    if (type === "multiple_choice" || type === "true_false") {
      const opt = (a.options ?? []).find(o => o.id === a.selected_option);
      return opt ? opt.text : (a.selected_option || <span className="text-gray-400">No answer</span>);
    }
    if (type === "multi_answer") {
      const ids = (a.selected_option ?? "").split(",").map(s => s.trim()).filter(Boolean);
      const texts = ids.map(id => (a.options ?? []).find(o => o.id === id)?.text ?? id);
      return texts.length ? texts.join(", ") : <span className="text-gray-400">No answer</span>;
    }
    if (type === "matching") {
      try {
        const pairs = a.selected_option ? JSON.parse(a.selected_option) as { left: string; right: string }[] : [];
        return pairs.length
          ? pairs.map((p, i) => <div key={i}>{p.left} → {p.right}</div>)
          : <span className="text-gray-400">No answer</span>;
      } catch { return <span className="text-gray-400">No answer</span>; }
    }
    // text-entry + essay
    return a.answer_text?.trim()
      ? <span className="whitespace-pre-wrap">{a.answer_text}</span>
      : <span className="text-gray-400">No answer</span>;
  }

  if (!canGrade) {
    return <div className="p-6 text-gray-500">You don&apos;t have permission to grade exams.</div>;
  }
  if (loading) return <div className="p-6"><LoadingSpinner /></div>;

  // ---------- Grading detail view ----------
  if (active) {
    const pv = previewScore();
    const essays = answers.filter(a => isManual(a.question_type));
    return (
      <div className="p-6 space-y-5">
        <button onClick={() => setActive(null)} className="flex items-center gap-1 text-sm text-[#0F2A47] hover:underline">
          <ArrowLeft size={14} /> Back to submissions
        </button>
        <PageHeader
          title={`Grade — ${active.student_name || "Student"}`}
          subtitle={`${examTitle} · Attempt #${active.attempt_number}${active.student_code ? " · " + active.student_code : ""}`}
        />

        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <AlertTriangle size={16} /> {error}
          </div>
        )}

        {loadingDetail ? <LoadingSpinner /> : (
          <>
            {essays.length === 0 && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700">
                This attempt has no essay questions to grade. Saving will simply confirm the auto-graded score and mark it as graded.
              </div>
            )}

            <div className="space-y-3">
              {answers.map((a, idx) => {
                const manual = isManual(a.question_type);
                return (
                  <Card key={a.question_id}>
                    <CardContent className="py-4 space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="text-sm font-semibold text-[#0F2A47]">
                          <span className="text-gray-400 mr-1">Q{idx + 1}.</span>
                          <span className="whitespace-pre-wrap">{a.question_text}</span>
                        </div>
                        <span className="shrink-0 text-xs uppercase tracking-wide text-gray-400">{a.question_type.replace("_", " ")}</span>
                      </div>

                      <div className="rounded-lg bg-gray-50 border px-3 py-2 text-sm text-gray-700">
                        <div className="text-[11px] font-semibold uppercase text-gray-400 mb-1">Student answer</div>
                        {renderStudentAnswer(a)}
                      </div>

                      {manual && a.model_answer && (
                        <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
                          <div className="text-[11px] font-semibold uppercase text-amber-500 mb-1">Model answer / rubric</div>
                          <span className="whitespace-pre-wrap">{a.model_answer}</span>
                        </div>
                      )}

                      <div className="flex items-center justify-between pt-1">
                        {manual ? (
                          <label className="flex items-center gap-2 text-sm">
                            <span className="text-gray-600">Marks awarded</span>
                            <input
                              type="number"
                              min={0}
                              max={a.marks}
                              step="0.5"
                              value={marks[a.question_id] ?? ""}
                              onChange={e => setMarks(prev => ({ ...prev, [a.question_id]: e.target.value }))}
                              className="w-20 rounded-md border px-2 py-1 text-sm text-right focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
                            />
                            <span className="text-gray-400">/ {a.marks}</span>
                          </label>
                        ) : (
                          <div className="flex items-center gap-2 text-sm">
                            {a.is_correct === true && <span className="flex items-center gap-1 text-green-700"><CheckCircle2 size={14} /> Correct</span>}
                            {a.is_correct === false && <span className="text-red-600">Incorrect</span>}
                            {a.is_correct === null && <span className="text-gray-400">Not auto-graded</span>}
                          </div>
                        )}
                        <span className="text-sm font-semibold text-[#0F2A47]">
                          {manual ? (marks[a.question_id] || 0) : (a.marks_awarded ?? 0)} / {a.marks}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            <div className="sticky bottom-0 flex items-center justify-between rounded-xl border bg-white px-4 py-3 shadow-sm">
              <div className="text-sm">
                <span className="text-gray-500">Total after grading: </span>
                <span className="font-bold text-[#0F2A47]">{pv.score} / {pv.total}</span>
                <span className="text-gray-400"> ({pv.total > 0 ? Math.round((pv.score / pv.total) * 100) : 0}%)</span>
              </div>
              <Button variant="gold" onClick={saveGrades} disabled={saving}>
                <ClipboardCheck size={14} /> {saving ? "Saving…" : "Save grades"}
              </Button>
            </div>
          </>
        )}
      </div>
    );
  }

  // ---------- Submissions list view ----------
  const pending = subs.filter(s => s.needs_grading).length;
  return (
    <div className="p-6 space-y-5">
      <Link href="/dashboard/cbt" className="flex items-center gap-1 text-sm text-[#0F2A47] hover:underline">
        <ArrowLeft size={14} /> Back to CBT
      </Link>
      <PageHeader
        title={`Submissions — ${examTitle}`}
        subtitle={pending > 0 ? `${pending} attempt${pending === 1 ? "" : "s"} awaiting grading` : "All submissions graded or auto-graded"}
      />

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      <Card>
        <CardHeader><CardTitle>Attempts</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50 border-b">
                <th className="text-left px-3 py-2 font-semibold text-gray-600">Student</th>
                <th className="text-left px-3 py-2 font-semibold text-gray-600">Status</th>
                <th className="text-center px-3 py-2 font-semibold text-gray-600">Score</th>
                <th className="text-center px-3 py-2 font-semibold text-gray-600">%</th>
                <th className="text-left px-3 py-2 font-semibold text-gray-600">Submitted</th>
                <th className="text-right px-3 py-2 font-semibold text-gray-600">Action</th>
              </tr></thead>
              <tbody>
                {subs.map(s => (
                  <tr key={s.id} className="border-b hover:bg-gray-50">
                    <td className="px-3 py-2">
                      <div className="font-medium">{s.student_name || "Student"}</div>
                      {s.student_code && <div className="text-xs text-gray-400">{s.student_code}</div>}
                    </td>
                    <td className="px-3 py-2">
                      <span className={cn("px-2 py-0.5 rounded text-[10px] font-bold uppercase",
                        s.status === "graded" ? "bg-green-100 text-green-700" :
                        s.status === "timed_out" ? "bg-amber-100 text-amber-700" :
                        "bg-gray-100 text-gray-600")}>{s.status.replace("_", " ")}</span>
                      {s.needs_grading && <span className="ml-2 px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-red-100 text-red-700">Needs grading</span>}
                    </td>
                    <td className="px-3 py-2 text-center font-semibold">{s.total_score ?? 0}/{s.total_marks ?? "?"}</td>
                    <td className="px-3 py-2 text-center text-gray-600">{s.percentage != null ? `${s.percentage}%` : "—"}</td>
                    <td className="px-3 py-2 text-gray-500 text-xs">{s.submitted_at ? new Date(s.submitted_at).toLocaleString() : "—"}</td>
                    <td className="px-3 py-2 text-right">
                      <Button size="sm" variant={s.needs_grading ? "gold" : "secondary"} onClick={() => openAttempt(s)}>
                        {s.needs_grading ? "Grade" : "Review"}
                      </Button>
                    </td>
                  </tr>
                ))}
                {subs.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-400">No submissions yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
