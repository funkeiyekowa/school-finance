"use client";

/**
 * /dashboard/setup/class-teachers
 *
 * Class Teacher Allocation (many-to-many). Lets a school admin allocate
 * classes to teaching staff where:
 *   - a class can have MANY class teachers, and
 *   - a teacher can hold MANY classes.
 *
 * This is the many-to-many companion to the SINGLE homeroom class
 * teacher set on the Staff form (set_class_teacher). Both write into the
 * existing teacher_assignments table (role='class_teacher',
 * subject_id=NULL) -- no new schema.
 *
 * Backed by supabase/class_teacher_allocation_module.sql:
 *   - add_class_teacher(p_staff_id, p_class_id)
 *   - remove_class_teacher(p_staff_id, p_class_id)
 *   - list_class_teacher_allocations()
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { PageHeader, LoadingSpinner } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { ArrowLeft, Users, Check, Search, GraduationCap, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";

interface ClassRow { id: string; name: string; }
interface StaffRow { id: string; full_name: string; job_title: string | null; }
interface AllocationRow {
  class_id: string;
  class_name: string;
  staff_id: string;
  staff_name: string;
}

export default function ClassTeacherAllocationPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const { isOrgAdmin } = useAuth();

  const [loading, setLoading] = useState(true);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [teachers, setTeachers] = useState<StaffRow[]>([]);
  const [allocations, setAllocations] = useState<AllocationRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [selectedClassId, setSelectedClassId] = useState("");
  const [search, setSearch] = useState("");
  const [savingStaffId, setSavingStaffId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [classesRes, teachersRes, allocRes] = await Promise.all([
      supabase.from("classes").select("id, name").eq("active", true).order("sequence"),
      supabase
        .from("staff_members")
        .select("id, full_name, job_title")
        .eq("staff_type", "teaching")
        .eq("status", "active")
        .order("full_name"),
      supabase.rpc("list_class_teacher_allocations"),
    ]);
    setClasses((classesRes.data as ClassRow[]) ?? []);
    setTeachers((teachersRes.data as StaffRow[]) ?? []);
    setAllocations((allocRes.data as AllocationRow[]) ?? []);
    setSelectedClassId((prev) => {
      if (prev) return prev;
      const first = (classesRes.data as ClassRow[] | null)?.[0];
      return first ? first.id : "";
    });
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  if (!isOrgAdmin) {
    return <div className="p-6 text-gray-500">Only school administrators can manage class-teacher allocations.</div>;
  }
  if (loading) return <div className="p-6"><LoadingSpinner /></div>;

  const selectedClass = classes.find((c) => c.id === selectedClassId);

  const isAllocated = (staffId: string): boolean =>
    allocations.some((a) => a.class_id === selectedClassId && a.staff_id === staffId);

  /** Class names a given teacher currently holds (for the chip under each name). */
  const classesFor = (staffId: string): string[] =>
    allocations
      .filter((a) => a.staff_id === staffId)
      .map((a) => a.class_name)
      .sort((x, y) => x.localeCompare(y));

  async function toggle(staffId: string) {
    if (!selectedClassId) return;
    setError(null);
    setNotice(null);
    setSavingStaffId(staffId);
    const alreadyAllocated = isAllocated(staffId);
    const rpc = alreadyAllocated ? "remove_class_teacher" : "add_class_teacher";
    const { error: rpcErr } = await supabase.rpc(rpc, {
      p_staff_id: staffId,
      p_class_id: selectedClassId,
    });
    setSavingStaffId(null);
    if (rpcErr) { setError(rpcErr.message); return; }
    setNotice(alreadyAllocated ? "Teacher removed from this class." : "Teacher allocated to this class.");
    await load();
  }

  const filteredTeachers = teachers.filter((t) => {
    const q = search.trim().toLowerCase();
    return !q || t.full_name.toLowerCase().includes(q) || (t.job_title ?? "").toLowerCase().includes(q);
  });

  const allocatedCountForSelected = allocations.filter((a) => a.class_id === selectedClassId).length;

  // "All allocations" grouped by class, each class listing its teachers.
  const byClass = classes
    .map((c) => ({
      class: c,
      teachers: allocations
        .filter((a) => a.class_id === c.id)
        .map((a) => a.staff_name)
        .sort((x, y) => x.localeCompare(y)),
    }))
    .filter((g) => g.teachers.length > 0);

  return (
    <div className="p-6 space-y-5 max-w-4xl">
      <button
        onClick={() => router.push("/dashboard/setup")}
        className="text-xs text-gray-500 hover:text-[#0F2A47] flex items-center gap-1"
      >
        <ArrowLeft size={12} /> Back to Setup
      </button>

      <PageHeader
        title="Class Teacher Allocation"
        subtitle="Allocate classes to teaching staff. A class can have several class teachers, and a teacher can hold several classes."
        icon={<Users size={22} />}
      />

      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {notice && <div role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">{notice}</div>}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <CardTitle>Class</CardTitle>
              <select
                value={selectedClassId}
                onChange={(e) => { setSelectedClassId(e.target.value); setNotice(null); setError(null); }}
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227] bg-white min-w-[180px]"
              >
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            {selectedClass && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#0F2A47]/5 px-3 py-1 text-xs font-medium text-[#0F2A47]">
                <UserPlus size={12} className="text-[#C9A227]" />
                {allocatedCountForSelected} teacher{allocatedCountForSelected === 1 ? "" : "s"} on {selectedClass.name}
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {!selectedClass ? (
            <p className="text-sm text-gray-400 italic">No classes have been set up yet.</p>
          ) : teachers.length === 0 ? (
            <p className="text-sm text-gray-400 italic">No active teaching staff have been added yet.</p>
          ) : (
            <>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search teachers by name or title…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
                />
              </div>

              <p className="text-xs text-gray-500">
                Tick a teacher to allocate them to <strong className="text-gray-700">{selectedClass.name}</strong>. Untick to remove.
              </p>

              <div className="divide-y divide-gray-100">
                {filteredTeachers.length === 0 ? (
                  <p className="py-3 text-sm text-gray-400 italic">No teachers match “{search}”.</p>
                ) : filteredTeachers.map((t) => {
                  const allocated = isAllocated(t.id);
                  const held = classesFor(t.id);
                  const busy = savingStaffId === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      disabled={busy}
                      onClick={() => toggle(t.id)}
                      className={cn(
                        "w-full flex items-center justify-between gap-3 py-2.5 px-1 text-left transition-colors rounded-lg",
                        busy ? "opacity-50" : "hover:bg-[#FBF6E8]"
                      )}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span
                          className={cn(
                            "flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors",
                            allocated
                              ? "bg-[#0F2A47] border-[#0F2A47] text-white"
                              : "border-gray-300 bg-white text-transparent"
                          )}
                          aria-hidden
                        >
                          <Check size={13} />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-gray-800 truncate">{t.full_name}</span>
                          {held.length > 0 ? (
                            <span className="block text-[11px] text-gray-400 truncate">
                              Classes: {held.join(", ")}
                            </span>
                          ) : (
                            t.job_title && <span className="block text-[11px] text-gray-400 truncate">{t.job_title}</span>
                          )}
                        </span>
                      </div>
                      <span className={cn(
                        "shrink-0 text-[11px] font-semibold uppercase tracking-wide",
                        allocated ? "text-[#0F2A47]" : "text-gray-300"
                      )}>
                        {allocated ? "Allocated" : ""}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {byClass.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GraduationCap size={16} className="text-[#C9A227]" />
              All allocations ({allocations.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {byClass.map((g) => (
                <div key={g.class.id} className="border border-gray-100 rounded-lg px-3 py-2">
                  <div className="text-xs font-semibold text-[#0F2A47] mb-1">
                    {g.class.name}
                    <span className="ml-1 font-normal text-gray-400">
                      · {g.teachers.length} teacher{g.teachers.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {g.teachers.map((name) => (
                      <span key={name} className="inline-flex items-center rounded-full bg-[#FBF6E8] px-2 py-0.5 text-[11px] font-medium text-[#0F2A47]">
                        {name}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
