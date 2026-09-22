"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowLeft, CheckCircle2, ClipboardCheck, Clock3, RefreshCw, Save } from "lucide-react";
import { PageHeader, LoadingSpinner } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { cn, fmtDate } from "@/lib/utils";

interface QueueItem {
  id: string;
  response_text: string | null;
  status: string;
  score: number | null;
  feedback: string | null;
  ai_suggested_score: number | null;
  submitted_at: string;
  graded_at: string | null;
  overdue: boolean;
  assignment: { id: string; title: string; maxScore: number; dueDate: string | null };
  lesson: { id: string; title: string } | null;
  course: { id: string; title: string } | null;
  student: { id: string; full_name: string; student_code: string; grade: string | null };
}

interface QueuePayload {
  counts: { total: number; pending: number; graded: number; overdue: number };
  items: QueueItem[];
  error?: string;
}

type Filter = "pending" | "overdue" | "graded" | "all";

export default function GradingQueuePage() {
  const [payload, setPayload] = useState<QueuePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("pending");
  const [selected, setSelected] = useState<QueueItem | null>(null);
  const [score, setScore] = useState("");
  const [feedback, setFeedback] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/lms/grading-queue", { cache: "no-store" });
      const result = await response.json() as QueuePayload;
      if (!response.ok) throw new Error(result.error || "Could not load grading queue.");
      setPayload(result);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load grading queue.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => (payload?.items ?? []).filter((item) => {
    if (filter === "pending") return item.status !== "graded";
    if (filter === "overdue") return item.overdue;
    if (filter === "graded") return item.status === "graded";
    return true;
  }), [filter, payload]);

  function openGrade(item: QueueItem) {
    setSelected(item);
    setScore(item.score == null ? (item.ai_suggested_score == null ? "" : String(item.ai_suggested_score)) : String(item.score));
    setFeedback(item.feedback || "");
    setSaveError(null);
  }

  async function saveGrade() {
    if (!selected) return;
    const numericScore = Number(score);
    if (!Number.isFinite(numericScore) || numericScore < 0 || numericScore > selected.assignment.maxScore) {
      setSaveError(`Enter a score between 0 and ${selected.assignment.maxScore}.`);
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const response = await fetch("/api/lms/grading-queue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ submissionId: selected.id, score: numericScore, feedback }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Grade could not be saved.");
      setSelected(null);
      await load();
    } catch (gradeError) {
      setSaveError(gradeError instanceof Error ? gradeError.message : "Grade could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="p-6"><LoadingSpinner /></div>;

  return (
    <div className="p-6 space-y-5">
      <Link href="/dashboard/teaching" className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-[#0F2A47]">
        <ArrowLeft size={13} /> My Teaching
      </Link>
      <PageHeader icon={<ClipboardCheck size={24} />} gradient="purple" title="Grading Queue" subtitle="Review submissions, give feedback, and publish authoritative grades" />

      {error ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <span className="flex items-center gap-2"><AlertCircle size={17} /> {error}</span>
          <Button size="sm" variant="secondary" onClick={() => void load()}><RefreshCw size={13} /> Retry</Button>
        </div>
      ) : payload && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric label="Pending" value={payload.counts.pending} tone="text-amber-700" />
            <Metric label="Overdue" value={payload.counts.overdue} tone="text-red-700" />
            <Metric label="Graded" value={payload.counts.graded} tone="text-emerald-700" />
            <Metric label="Total" value={payload.counts.total} tone="text-[#0F2A47]" />
          </div>

          <div className="flex gap-2 overflow-x-auto">
            {(["pending", "overdue", "graded", "all"] as Filter[]).map((value) => (
              <button key={value} onClick={() => setFilter(value)} className={cn("rounded-lg px-3 py-2 text-xs font-semibold capitalize", filter === value ? "bg-[#0F2A47] text-white" : "border bg-white text-gray-600 hover:bg-gray-50")}>{value}</button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-white py-14 text-center text-sm text-gray-500">
              <CheckCircle2 size={30} className="mx-auto mb-2 text-emerald-500" />
              No {filter === "all" ? "" : `${filter} `}submissions in your authorized courses.
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map((item) => (
                <Card key={item.id} className={cn(item.overdue && item.status !== "graded" && "border-red-200")}>
                  <CardContent className="flex flex-col gap-4 py-4 lg:flex-row lg:items-center">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-[#0F2A47]">{item.student.full_name}</h3>
                        <span className="font-mono text-[10px] text-gray-400">{item.student.student_code}</span>
                        {item.overdue && item.status !== "graded" && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">Overdue</span>}
                      </div>
                      <p className="mt-1 text-sm text-gray-700">{item.assignment.title}</p>
                      <p className="text-xs text-gray-400">{item.course?.title || "Course"}{item.lesson ? ` · ${item.lesson.title}` : ""} · Submitted {fmtDate(item.submitted_at)}</p>
                      <p className="mt-2 line-clamp-2 whitespace-pre-wrap text-xs text-gray-600">{item.response_text || "No text response submitted."}</p>
                    </div>
                    <div className="flex items-center justify-between gap-4 lg:justify-end">
                      <div className="text-right text-xs">
                        {item.status === "graded" ? <><div className="font-bold text-emerald-700">{item.score} / {item.assignment.maxScore}</div><div className="text-gray-400">Graded</div></> : <><div className="font-semibold text-amber-700">Awaiting review</div><div className="text-gray-400">Max {item.assignment.maxScore}</div></>}
                      </div>
                      <Button size="sm" variant={item.status === "graded" ? "secondary" : "gold"} onClick={() => openGrade(item)}>{item.status === "graded" ? "Review grade" : "Grade"}</Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="grade-title">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div><h2 id="grade-title" className="font-bold text-[#0F2A47]">Grade {selected.student.full_name}</h2><p className="text-xs text-gray-500">{selected.assignment.title}</p></div>
              <button onClick={() => setSelected(null)} className="text-sm text-gray-400 hover:text-gray-700">Close</button>
            </div>
            <div className="mb-4 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-xl border bg-gray-50 p-3 text-sm text-gray-700">{selected.response_text || "No text response submitted."}</div>
            {selected.ai_suggested_score != null && <div className="mb-3 rounded-lg border border-purple-200 bg-purple-50 p-3 text-xs text-purple-800">AI suggestion: {selected.ai_suggested_score} / {selected.assignment.maxScore}. Review it independently before saving.</div>}
            <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
              <label className="text-sm font-medium text-gray-700">Score<input type="number" min={0} max={selected.assignment.maxScore} step="0.5" value={score} onChange={(event) => setScore(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
              <label className="text-sm font-medium text-gray-700">Feedback<textarea rows={4} maxLength={5000} value={feedback} onChange={(event) => setFeedback(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
            </div>
            {saveError && <p role="alert" className="mt-3 text-sm text-red-700">{saveError}</p>}
            <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={() => setSelected(null)}>Cancel</Button><Button variant="gold" loading={saving} onClick={saveGrade}><Save size={13} /> Save authoritative grade</Button></div>
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return <div className="rounded-xl border bg-white p-4"><div className={cn("text-2xl font-bold", tone)}>{value}</div><div className="mt-1 flex items-center gap-1 text-xs text-gray-500"><Clock3 size={11} />{label}</div></div>;
}
