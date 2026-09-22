"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, ClipboardList, RefreshCw, Save } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { fmtDate, cn } from "@/lib/utils";

interface Assignment {
  id: string; title: string; instructions: string | null; maxScore: number; dueDate: string | null;
  submission: null | { id: string; response_text: string | null; status: string; score: number | null; feedback: string | null; submitted_at: string; graded_at: string | null };
  rubric: null | { id: string; title: string; description: string | null; totalPoints: number; criteria: Array<{ id: string; title: string; description: string | null; maxPoints: number }> };
}

export function StudentAssignments({ lessonId }: { lessonId: string }) {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const response = await fetch(`/api/lms/student-assignments?lesson_id=${encodeURIComponent(lessonId)}`, { cache: "no-store" });
      const payload = await response.json() as { assignments?: Assignment[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "Assignments could not be loaded.");
      const rows = payload.assignments ?? [];
      setAssignments(rows);
      setDrafts(Object.fromEntries(rows.map((assignment) => [assignment.id, assignment.submission?.response_text || ""])));
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Assignments could not be loaded."); }
    finally { setLoading(false); }
  }, [lessonId]);

  useEffect(() => { void load(); }, [load]);

  async function submit(assignment: Assignment) {
    const responseText = (drafts[assignment.id] || "").trim();
    if (!responseText) { setNotice((current) => ({ ...current, [assignment.id]: "Write a response before submitting." })); return; }
    setBusy(assignment.id); setNotice((current) => ({ ...current, [assignment.id]: "" }));
    try {
      const response = await fetch("/api/lms/student-assignments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ assignmentId: assignment.id, responseText }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Assignment could not be submitted.");
      setNotice((current) => ({ ...current, [assignment.id]: assignment.submission ? "Submission updated." : "Assignment submitted." }));
      await load();
    } catch (submitError) { setNotice((current) => ({ ...current, [assignment.id]: submitError instanceof Error ? submitError.message : "Assignment could not be submitted." })); }
    finally { setBusy(null); }
  }

  if (loading) return <section className="px-6 pb-6"><div className="h-28 animate-pulse rounded-xl bg-slate-100" /></section>;
  if (error) return <section className="px-6 pb-6"><div role="alert" className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"><span className="flex items-center gap-2"><AlertCircle size={16} />{error}</span><Button size="sm" variant="secondary" onClick={() => void load()}><RefreshCw size={12} />Retry</Button></div></section>;
  if (!assignments.length) return null;

  return <section className="px-6 pb-6 space-y-3" aria-labelledby="lesson-assignments-title">
    <h2 id="lesson-assignments-title" className="flex items-center gap-2 text-sm font-bold text-[#0F2A47]"><ClipboardList size={17} className="text-[#C9A227]" />Assignments</h2>
    {assignments.map((assignment) => {
      const graded = assignment.submission?.status === "graded";
      const overdue = !graded && !!assignment.dueDate && assignment.dueDate < new Date().toISOString().slice(0, 10);
      return <div key={assignment.id} className={cn("rounded-xl border bg-white p-4 shadow-sm", overdue && "border-red-200")}>
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold text-[#0F2A47]">{assignment.title}</h3><p className="text-xs text-gray-500">Maximum {assignment.maxScore}{assignment.dueDate ? ` · Due ${fmtDate(assignment.dueDate)}` : ""}{overdue ? " · Overdue" : ""}</p></div>{graded && <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-700">{assignment.submission?.score} / {assignment.maxScore}</span>}</div>
        {assignment.instructions && <p className="mt-3 whitespace-pre-wrap text-sm text-gray-700">{assignment.instructions}</p>}
        {assignment.rubric && <details className="mt-3 rounded-lg border bg-slate-50 p-3"><summary className="cursor-pointer text-xs font-semibold text-[#0F2A47]">View rubric · {assignment.rubric.totalPoints} points</summary>{assignment.rubric.description && <p className="mt-2 text-xs text-gray-600">{assignment.rubric.description}</p>}<div className="mt-2 space-y-1">{assignment.rubric.criteria.map((criterion) => <div key={criterion.id} className="flex justify-between gap-3 text-xs"><span><strong>{criterion.title}</strong>{criterion.description ? ` — ${criterion.description}` : ""}</span><span className="shrink-0 font-semibold">{criterion.maxPoints} pts</span></div>)}</div></details>}
        {graded ? <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900"><div className="flex items-center gap-1 font-semibold"><CheckCircle2 size={14} />Graded</div>{assignment.submission?.feedback && <p className="mt-1 whitespace-pre-wrap text-xs">{assignment.submission.feedback}</p>}</div> : <><label className="mt-3 block text-xs font-semibold text-gray-600">Your response<textarea value={drafts[assignment.id] || ""} maxLength={20000} onChange={(event) => setDrafts((current) => ({ ...current, [assignment.id]: event.target.value }))} rows={6} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm font-normal" placeholder="Write your response here…" /></label><div className="mt-2 flex flex-wrap items-center justify-between gap-2"><span className="text-[11px] text-gray-400">{(drafts[assignment.id] || "").length.toLocaleString()} / 20,000 characters</span><Button variant="gold" size="sm" loading={busy === assignment.id} onClick={() => void submit(assignment)}><Save size={12} />{assignment.submission ? "Update submission" : "Submit assignment"}</Button></div></>}
        {notice[assignment.id] && <p role="status" className={cn("mt-2 text-xs", notice[assignment.id].includes("submitted") || notice[assignment.id].includes("updated") ? "text-emerald-700" : "text-red-700")}>{notice[assignment.id]}</p>}
      </div>;
    })}
  </section>;
}
