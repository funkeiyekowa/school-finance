"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { cn } from "@/lib/utils";
import { PageHeader, LoadingSpinner } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Plus, AlertTriangle, Save } from "lucide-react";

interface ClassRow { id: string; name: string; }
interface SubjectRow { id: string; name: string; short_code: string; }
interface PeriodRow { id: string; name: string; short_code: string; start_time: string; end_time: string; is_break: boolean; sort_order: number; }
interface EntryRow { id: string; class_id: string; subject_id: string; period_id: string; teacher_name: string | null; day_of_week: number; room: string | null; }

const DAYS = [
  { num: 1, label: "Monday", short: "Mon" },
  { num: 2, label: "Tuesday", short: "Tue" },
  { num: 3, label: "Wednesday", short: "Wed" },
  { num: 4, label: "Thursday", short: "Thu" },
  { num: 5, label: "Friday", short: "Fri" },
];

export default function TimetablePage() {
  const { canEdit, profile, orgId } = useAuth();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [periods, setPeriods] = useState<PeriodRow[]>([]);
  const [entries, setEntries] = useState<EntryRow[]>([]);

  const [selectedClassId, setSelectedClassId] = useState<string>("");
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const [editEntry, setEditEntry] = useState<EntryRow | null>(null);
  const [form, setForm] = useState({ subject_id: "", teacher_name: "", room: "", period_id: "", day_of_week: "1" });

  const load = useCallback(async () => {
    const [clsRes, subRes, perRes, entRes] = await Promise.all([
      supabase.from("classes").select("id, name").eq("active", true).order("sequence"),
      supabase.from("subjects").select("id, name, short_code").eq("active", true).order("name"),
      supabase.from("periods").select("*").eq("active", true).order("sort_order"),
      supabase.from("timetable_entries").select("*"),
    ]);
    setClasses(clsRes.data as ClassRow[] ?? []);
    setSubjects(subRes.data as SubjectRow[] ?? []);
    setPeriods(perRes.data as PeriodRow[] ?? []);
    setEntries(entRes.data as EntryRow[] ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const classEntries = entries.filter(e => e.class_id === selectedClassId);

  function getEntry(periodId: string, day: number): EntryRow | undefined {
    return classEntries.find(e => e.period_id === periodId && e.day_of_week === day);
  }

  function openAdd(periodId: string, day: number) {
    setEditEntry(null);
    setForm({ subject_id: "", teacher_name: "", room: "", period_id: periodId, day_of_week: String(day) });
    setConflict(null);
    setShowModal(true);
  }

  function openEdit(entry: EntryRow) {
    setEditEntry(entry);
    setForm({
      subject_id: entry.subject_id,
      teacher_name: entry.teacher_name || "",
      room: entry.room || "",
      period_id: entry.period_id,
      day_of_week: String(entry.day_of_week),
    });
    setConflict(null);
    setShowModal(true);
  }

  function detectConflicts(): string | null {
    const day = parseInt(form.day_of_week);
    const periodId = form.period_id;
    const teacher = form.teacher_name.trim().toLowerCase();

    // Teacher conflict: same teacher in the same period/day for a different class
    if (teacher) {
      const teacherConflict = entries.find(e =>
        e.period_id === periodId &&
        e.day_of_week === day &&
        e.teacher_name?.toLowerCase() === teacher &&
        e.class_id !== selectedClassId &&
        e.id !== editEntry?.id
      );
      if (teacherConflict) {
        const conflictClass = classes.find(c => c.id === teacherConflict.class_id);
        return `Teacher "${form.teacher_name}" is already scheduled in ${conflictClass?.name || "another class"} at this time.`;
      }
    }

    // Room conflict: same room in the same period/day
    const room = form.room.trim().toLowerCase();
    if (room) {
      const roomConflict = entries.find(e =>
        e.period_id === periodId &&
        e.day_of_week === day &&
        e.room?.toLowerCase() === room &&
        e.class_id !== selectedClassId &&
        e.id !== editEntry?.id
      );
      if (roomConflict) {
        const conflictClass = classes.find(c => c.id === roomConflict.class_id);
        return `Room "${form.room}" is already booked by ${conflictClass?.name || "another class"} at this time.`;
      }
    }

    return null;
  }

  async function saveEntry() {
    const detected = detectConflicts();
    if (detected) { setConflict(detected); return; }

    setSaving(true);
    const payload = {
      class_id: selectedClassId,
      subject_id: form.subject_id,
      period_id: form.period_id,
      day_of_week: parseInt(form.day_of_week),
      teacher_name: form.teacher_name.trim() || null,
      room: form.room.trim() || null,
      organization_id: orgId,
      updated_at: new Date().toISOString(),
    };

    if (editEntry) {
      await supabase.from("timetable_entries").update(payload).eq("id", editEntry.id);
    } else {
      const { error } = await supabase.from("timetable_entries").insert(payload);
      if (error?.code === "23505") {
        setConflict("This slot already has an entry for this class. Edit the existing one instead.");
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    setShowModal(false);
    load();
  }

  async function deleteEntry() {
    if (!editEntry) return;
    if (!confirm("Remove this timetable entry?")) return;
    await supabase.from("timetable_entries").delete().eq("id", editEntry.id);
    setShowModal(false);
    load();
  }

  if (loading) return <div className="p-6"><LoadingSpinner /></div>;

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="Timetable" subtitle="Manage class timetables — assign subjects, teachers, and rooms to periods" />

      {/* Class selector */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-end gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Class</label>
              <select value={selectedClassId} onChange={e => setSelectedClassId(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227] min-w-[180px]">
                <option value="">Select class...</option>
                {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            {selectedClassId && (
              <span className="text-xs text-gray-500 pb-2">
                {classEntries.length} entries scheduled
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Timetable grid */}
      {selectedClassId && (
        <Card>
          <CardContent className="py-0 overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50">
                  <th className="text-left px-2 py-3 font-semibold text-gray-600 border-r w-24">Period</th>
                  {DAYS.map(d => (
                    <th key={d.num} className="text-center px-2 py-3 font-semibold text-gray-600 border-r last:border-r-0 min-w-[140px]">
                      {d.short}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {periods.map(period => (
                  <tr key={period.id} className={cn("border-t", period.is_break && "bg-amber-50")}>
                    <td className="px-2 py-2 border-r text-xs">
                      <div className="font-medium text-gray-700">{period.short_code}</div>
                      <div className="text-[10px] text-gray-400">
                        {String(period.start_time).substring(0, 5)}–{String(period.end_time).substring(0, 5)}
                      </div>
                    </td>
                    {DAYS.map(day => {
                      if (period.is_break) {
                        return (
                          <td key={day.num} className="px-2 py-2 text-center text-xs text-amber-600 italic border-r last:border-r-0">
                            {period.name}
                          </td>
                        );
                      }
                      const entry = getEntry(period.id, day.num);
                      const subject = entry ? subjects.find(s => s.id === entry.subject_id) : null;
                      return (
                        <td key={day.num} className="px-1 py-1 border-r last:border-r-0 align-top">
                          {entry ? (
                            <button
                              onClick={() => canEdit && openEdit(entry)}
                              className="w-full text-left p-1.5 rounded bg-blue-50 border border-blue-100 hover:border-blue-300 transition-colors"
                            >
                              <div className="text-xs font-semibold text-blue-800 truncate">{subject?.short_code || subject?.name || "?"}</div>
                              {entry.teacher_name && <div className="text-[10px] text-blue-600 truncate">{entry.teacher_name}</div>}
                              {entry.room && <div className="text-[10px] text-gray-400">{entry.room}</div>}
                            </button>
                          ) : (
                            canEdit && (
                              <button
                                onClick={() => openAdd(period.id, day.num)}
                                className="w-full h-full min-h-[40px] flex items-center justify-center rounded border border-dashed border-gray-200 hover:border-[#C9A227] hover:bg-[#FBF6E8] transition-colors text-gray-300 hover:text-[#C9A227]"
                              >
                                <Plus size={14} />
                              </button>
                            )
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {!selectedClassId && (
        <div className="text-center py-12 text-gray-400 text-sm">
          Select a class above to view and manage its timetable.
        </div>
      )}

      {/* Add/Edit Modal */}
      {showModal && (
        <Modal open onClose={() => setShowModal(false)} title={editEntry ? "Edit Timetable Entry" : "Add Timetable Entry"} size="md">
          <div className="space-y-4">
            {conflict && (
              <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                <AlertTriangle size={16} className="text-red-600 shrink-0 mt-0.5" />
                <p className="text-xs text-red-800">{conflict}</p>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
              <select value={form.subject_id} onChange={e => { setForm(f => ({ ...f, subject_id: e.target.value })); setConflict(null); }}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227] bg-white">
                <option value="">Select subject...</option>
                {subjects.map(s => <option key={s.id} value={s.id}>{s.name} ({s.short_code})</option>)}
              </select>
            </div>

            <Input label="Teacher" value={form.teacher_name} onChange={e => { setForm(f => ({ ...f, teacher_name: e.target.value })); setConflict(null); }} placeholder="Mr. Adewale" />
            <Input label="Room (optional)" value={form.room} onChange={e => { setForm(f => ({ ...f, room: e.target.value })); setConflict(null); }} placeholder="Room 12" />

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Day</label>
                <select value={form.day_of_week} onChange={e => { setForm(f => ({ ...f, day_of_week: e.target.value })); setConflict(null); }}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227] bg-white">
                  {DAYS.map(d => <option key={d.num} value={d.num}>{d.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Period</label>
                <select value={form.period_id} onChange={e => { setForm(f => ({ ...f, period_id: e.target.value })); setConflict(null); }}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227] bg-white">
                  {periods.filter(p => !p.is_break).map(p => <option key={p.id} value={p.id}>{p.name} ({String(p.start_time).substring(0, 5)})</option>)}
                </select>
              </div>
            </div>

            <div className="flex justify-between pt-2">
              <div>
                {editEntry && (
                  <Button variant="danger" size="sm" onClick={deleteEntry}>Remove</Button>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button>
                <Button variant="gold" loading={saving} onClick={saveEntry} disabled={!form.subject_id}>
                  <Save size={14} /> {editEntry ? "Update" : "Add"}
                </Button>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
