"use client";

/**
 * /dashboard/setup/subject-teachers
 *
 * Lets a school admin assign a teacher to a class for a subject (item
 * 14), e.g. "Mrs. Johnson teaches Mathematics to JSS1". A class can
 * have many subject-teacher slots (one per subject) -- this is
 * separate from the single Class Teacher assigned on the Staff form.
 *
 * Backed by supabase/subject_teacher_allocation_module.sql:
 *   - set_subject_teacher(p_staff_id, p_class_id, p_subject_id)
 *   - list_subject_teachers()
 * Writes into the existing teacher_assignments table (role =
 * 'subject_teacher') -- no new schema.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { PageHeader, LoadingSpinner } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { ArrowLeft, GraduationCap, Trash2 } from "lucide-react";

interface ClassRow { id: string; name: string; }
interface SubjectRow { id: string; name: string; short_code: string; }
interface StaffRow { id: string; full_name: string; }
interface AllocationRow {
  class_id: string;
  class_name: string;
  subject_id: string;
  subject_name: string;
  staff_id: string;
  staff_name: string;
}

export default function SubjectTeacherAllocationPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const { isOrgAdmin } = useAuth();

  const [loading, setLoading] = useState(true);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [teachers, setTeachers] = useState<StaffRow[]>([]);
  const [allocations, setAllocations] = useState<AllocationRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [selectedClassId, setSelectedClassId] = useState("");
  const [savingKey, setSavingKey] = useState<string | null>(null); // subject_id currently saving

  const load = useCallback(async () => {
    setLoading(true);
    const [classesRes, subjectsRes, teachersRes, allocRes] = await Promise.all([
      supabase.from("classes").select("id, name").eq("active", true).order("sequence"),
      supabase.from("subjects").select("id, name, short_code").eq("active", true).order("name"),
      supabase.from("staff_members").select("id, full_name").eq("staff_type", "teaching").eq("status", "active").order("full_name"),
      supabase.rpc("list_subject_teachers"),
    ]);
    setClasses((classesRes.data as ClassRow[]) ?? []);
    setSubjects((subjectsRes.data as SubjectRow[]) ?? []);
    setTeachers((teachersRes.data as StaffRow[]) ?? []);
    setAllocations((allocRes.data as AllocationRow[]) ?? []);
    if (!selectedClassId && classesRes.data && classesRes.data.length > 0) {
      setSelectedClassId((classesRes.data[0] as ClassRow).id);
    }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  if (!isOrgAdmin) {
    return <div className="p-6 text-gray-500">Only school administrators can manage subject-teacher allocations.</div>;
  }
  if (loading) return <div className="p-6"><LoadingSpinner /></div>;

  // Subjects relevant to the selected class: either general (no class_id
  // restriction isn't tracked on this table beyond class_id itself being
  // optional) so we show every active subject -- schools mostly share a
  // subject list across classes and can filter visually by name/code.
  const allocationFor = (subjectId: string): AllocationRow | undefined =>
    allocations.find((a) => a.class_id === selectedClassId && a.subject_id === subjectId);

  async function assign(subjectId: string, staffId: string) {
    setError(null);
    setSavingKey(subjectId);
    const { error: rpcErr } = await supabase.rpc("set_subject_teacher", {
      p_staff_id: staffId || null,
      p_class_id: selectedClassId,
      p_subject_id: subjectId,
    });
    setSavingKey(null);
    if (rpcErr) { setError(rpcErr.message); return; }
    setNotice("Saved.");
    await load();
  }

  async function clearAssignment(a: AllocationRow) {
    if (!confirm(`Remove ${a.staff_name} as the ${a.subject_name} teacher for ${a.class_name}?`)) return;
    await assign(a.subject_id, "");
  }

  const selectedClass = classes.find((c) => c.id === selectedClassId);

  return (
    <div className="p-6 space-y-5 max-w-4xl">
      <button
        onClick={() => router.push("/dashboard/setup")}
        className="text-xs text-gray-500 hover:text-[#0F2A47] flex items-center gap-1"
      >
        <ArrowLeft size={12} /> Back to Setup
      </button>

      <PageHeader
        title="Subject Teacher Allocation"
        subtitle="Assign a teacher to each subject for a class."
        icon={<GraduationCap size={22} />}
      />

      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {notice && <div role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">{notice}</div>}

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <CardTitle>Class</CardTitle>
            <select
              value={selectedClassId}
              onChange={(e) => { setSelectedClassId(e.target.value); setNotice(null); }}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227] bg-white min-w-[180px]"
            >
              {classes.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {subjects.length === 0 ? (
            <p className="text-sm text-gray-400 italic">No subjects have been set up yet.</p>
          ) : !selectedClass ? (
            <p className="text-sm text-gray-400 italic">No classes have been set up yet.</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {subjects.map((subj) => {
                const current = allocationFor(subj.id);
                return (
                  <div key={subj.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div>
                      <p className="text-sm font-medium text-gray-800">{subj.name}</p>
                      <p className="text-[11px] text-gray-400">{subj.short_code}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        value={current?.staff_id ?? ""}
                        disabled={savingKey === subj.id}
                        onChange={(e) => assign(subj.id, e.target.value)}
                        className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227] bg-white min-w-[200px]"
                      >
                        <option value="">Not assigned</option>
                        {teachers.map((t) => (
                          <option key={t.id} value={t.id}>{t.full_name}</option>
                        ))}
                      </select>
                      {current && (
                        <button
                          onClick={() => clearAssignment(current)}
                          className="p-1.5 rounded text-gray-400 hover:text-red-600"
                          title="Remove this assignment"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {allocations.length > 0 && (
        <Card>
          <CardHeader><CardTitle>All allocations ({allocations.length})</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {allocations
                .slice()
                .sort((a, b) => a.class_name.localeCompare(b.class_name) || a.subject_name.localeCompare(b.subject_name))
                .map((a) => (
                  <div key={`${a.class_id}-${a.subject_id}`} className="text-xs text-gray-600 flex items-center justify-between border border-gray-100 rounded-lg px-3 py-2">
                    <span><strong>{a.class_name}</strong> · {a.subject_name}</span>
                    <span className="text-gray-800 font-medium">{a.staff_name}</span>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
