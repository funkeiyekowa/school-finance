"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, BookOpenCheck, LockKeyhole, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { PageHeader, LoadingSpinner } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { cn, fmtDate } from "@/lib/utils";

interface Criterion { id?: string; title: string; description: string; maxPoints: number | string; }
interface Assignment {
  id: string; title: string; maxScore: number; dueDate: string | null;
  lesson: { id: string; title: string } | null;
  course: { id: string; title: string } | null;
  rubric: null | { id: string; title: string; description: string | null; totalPoints: number; updatedAt: string; locked: boolean; criteria: Criterion[] };
}

export default function RubricStudioPage() {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selected = useMemo(() => assignments.find((assignment) => assignment.id === selectedId) ?? null, [assignments, selectedId]);
  const total = criteria.reduce((sum, criterion) => sum + (Number(criterion.maxPoints) || 0), 0);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const response = await fetch("/api/lms/rubrics", { cache: "no-store" });
      const payload = await response.json() as { assignments?: Assignment[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "Rubric Studio could not be loaded.");
      setAssignments(payload.assignments ?? []);
      setSelectedId((current) => current || payload.assignments?.[0]?.id || "");
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Rubric Studio could not be loaded."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!selected) { setTitle(""); setDescription(""); setCriteria([]); return; }
    setTitle(selected.rubric?.title || `${selected.title} rubric`);
    setDescription(selected.rubric?.description || "");
    setCriteria(selected.rubric?.criteria.map((criterion) => ({ ...criterion })) || [{ title: "Understanding and accuracy", description: "", maxPoints: selected.maxScore }]);
    setNotice(null); setError(null);
  }, [selected]);

  function updateCriterion(index: number, update: Partial<Criterion>) {
    setCriteria((current) => current.map((criterion, position) => position === index ? { ...criterion, ...update } : criterion));
  }

  async function saveRubric() {
    if (!selected) return;
    if (Math.abs(total - selected.maxScore) > 0.001) { setError(`Criterion maximums must total exactly ${selected.maxScore}. Current total: ${total}.`); return; }
    if (criteria.some((criterion) => !criterion.title.trim() || Number(criterion.maxPoints) <= 0)) { setError("Every criterion requires a title and positive maximum points."); return; }
    setSaving(true); setError(null); setNotice(null);
    try {
      const response = await fetch("/api/lms/rubrics", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ assignmentId: selected.id, title, description, criteria: criteria.map((criterion) => ({ title: criterion.title, description: criterion.description, maxPoints: Number(criterion.maxPoints) })) }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Rubric could not be saved.");
      setNotice("Rubric saved. Students will see it with the assignment.");
      await load();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Rubric could not be saved."); }
    finally { setSaving(false); }
  }

  if (loading) return <div className="p-6"><LoadingSpinner /></div>;

  return (
    <div className="p-6 space-y-5">
      <PageHeader icon={<BookOpenCheck size={24} />} gradient="purple" title="Rubric Studio" subtitle="Define transparent criteria before grading begins" />
      {error && !assignments.length ? <div role="alert" className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"><span className="flex items-center gap-2"><AlertCircle size={16} />{error}</span><Button size="sm" variant="secondary" onClick={() => void load()}><RefreshCw size={12} />Retry</Button></div> : assignments.length === 0 ? <div className="rounded-xl border border-dashed bg-white py-14 text-center text-sm text-gray-500">Create an LMS assignment before building a rubric.</div> : (
        <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
          <aside className="space-y-2">
            {assignments.map((assignment) => <button key={assignment.id} onClick={() => setSelectedId(assignment.id)} className={cn("w-full rounded-xl border p-3 text-left", selectedId === assignment.id ? "border-[#C9A227] bg-[#FBF6E8]" : "bg-white hover:border-slate-300")}><div className="flex items-start justify-between gap-2"><span className="text-sm font-semibold text-[#0F2A47]">{assignment.title}</span>{assignment.rubric?.locked && <LockKeyhole size={13} className="shrink-0 text-amber-700" />}</div><p className="mt-1 text-xs text-gray-500">{assignment.course?.title || "Course"}{assignment.lesson ? ` · ${assignment.lesson.title}` : ""}</p><p className="mt-1 text-[11px] text-gray-400">Max {assignment.maxScore}{assignment.dueDate ? ` · due ${fmtDate(assignment.dueDate)}` : ""} · {assignment.rubric ? `${assignment.rubric.criteria.length} criteria` : "No rubric"}</p></button>)}
          </aside>

          {selected && <section className="rounded-2xl border bg-white p-5 shadow-sm">
            {selected.rubric?.locked && <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><LockKeyhole size={15} className="shrink-0" />This rubric is locked because scoring has begun. Existing assessment history is protected from structural changes.</div>}
            <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-medium text-gray-700">Rubric title<input value={title} maxLength={200} disabled={selected.rubric?.locked} onChange={(event) => setTitle(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 disabled:bg-gray-100" /></label><label className="text-sm font-medium text-gray-700">Assignment maximum<input value={selected.maxScore} readOnly className="mt-1 w-full rounded-lg border bg-gray-50 px-3 py-2" /></label></div>
            <label className="mt-3 block text-sm font-medium text-gray-700">Description<textarea value={description} maxLength={2000} disabled={selected.rubric?.locked} onChange={(event) => setDescription(event.target.value)} rows={2} className="mt-1 w-full rounded-lg border px-3 py-2 disabled:bg-gray-100" /></label>
            <div className="mt-5 flex items-center justify-between"><h2 className="font-semibold text-[#0F2A47]">Criteria</h2><span className={cn("text-sm font-bold", Math.abs(total - selected.maxScore) < 0.001 ? "text-emerald-700" : "text-red-700")}>{total} / {selected.maxScore} points</span></div>
            <div className="mt-3 space-y-3">{criteria.map((criterion, index) => <div key={criterion.id || index} className="grid gap-2 rounded-xl border bg-slate-50 p-3 sm:grid-cols-[1fr_120px_36px]"><div className="space-y-2"><input value={criterion.title} maxLength={200} disabled={selected.rubric?.locked} onChange={(event) => updateCriterion(index, { title: event.target.value })} placeholder="Criterion title" className="w-full rounded-lg border px-3 py-2 text-sm disabled:bg-gray-100" /><textarea value={criterion.description} maxLength={2000} disabled={selected.rubric?.locked} onChange={(event) => updateCriterion(index, { description: event.target.value })} placeholder="What does success look like?" rows={2} className="w-full rounded-lg border px-3 py-2 text-xs disabled:bg-gray-100" /></div><label className="text-xs font-semibold text-gray-500">Max points<input type="number" min={0.01} step={0.5} value={criterion.maxPoints} disabled={selected.rubric?.locked} onChange={(event) => updateCriterion(index, { maxPoints: event.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm disabled:bg-gray-100" /></label><button disabled={selected.rubric?.locked || criteria.length === 1} onClick={() => setCriteria((current) => current.filter((_, position) => position !== index))} aria-label={`Remove ${criterion.title || `criterion ${index + 1}`}`} className="self-start rounded-lg p-2 text-red-500 hover:bg-red-50 disabled:opacity-30"><Trash2 size={15} /></button></div>)}</div>
            {!selected.rubric?.locked && criteria.length < 20 && <button onClick={() => setCriteria((current) => [...current, { title: "", description: "", maxPoints: "" }])} className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[#0F2A47] hover:text-[#C9A227]"><Plus size={13} />Add criterion</button>}
            {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}{notice && <p role="status" className="mt-3 text-sm text-emerald-700">{notice}</p>}
            <div className="mt-5 flex justify-end"><Button variant="gold" loading={saving} disabled={selected.rubric?.locked || Math.abs(total - selected.maxScore) > 0.001} onClick={saveRubric}><Save size={13} />Save rubric</Button></div>
          </section>}
        </div>
      )}
    </div>
  );
}
