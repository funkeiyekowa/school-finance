"use client";

/**
 * Student Information System (SIS)
 *
 * Pure student master data — bio-data, demographics, guardian info, class
 * enrollment, and status. No finance here. Financial data lives at
 * /dashboard/student-finance.
 *
 * Premium features:
 * - Inline editing on every field (click any cell)
 * - Bulk import from Excel/CSV
 * - Advanced search + multi-filter (grade, gender, status, admission year)
 * - Quick stats: total, active, inactive, gender split
 * - Student photo placeholder with initials
 * - Bulk operations (developer)
 * - Responsive + accessible
 */

import { useState, useEffect, useCallback, useRef, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { fmtDateTime } from "@/lib/utils";
import { PageHeader, LoadingSpinner, EmptyState } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { ImportStudentsModal } from "@/components/students/ImportStudentsModal";
import { BulkDeleteBar, RowCheckbox } from "@/components/ui/BulkDeleteBar";
import { useBulkSelect } from "@/lib/hooks/useBulkSelect";
import { useToast } from "@/lib/hooks/useToast";
import { cn, today } from "@/lib/utils";
import { GraduationCap, Plus, Search, ChevronRight, Upload, Trash2, Check, X, Pencil, Filter, Users, UserCheck, UserX, Download, Printer } from "lucide-react";
import Link from "next/link";
import type { Student } from "@/lib/types";

export default function StudentsPage() {
  return (
    <Suspense fallback={<div className="p-6"><LoadingSpinner /></div>}>
      <StudentsPageInner />
    </Suspense>
  );
}

function StudentsPageInner() {
  const { canEdit, isAdmin, isDeveloper, profile } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const { notify, ToastHost } = useToast();
  const searchParams = useSearchParams();
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterGrade, setFilterGrade] = useState(() => searchParams.get("grade") || "");
  const [filterGender, setFilterGender] = useState("");
  const [filterStatus, setFilterStatus] = useState(() => searchParams.get("status") || "");
  const [showFilters, setShowFilters] = useState(() => !!(searchParams.get("grade") || searchParams.get("status")));
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const [editingCell, setEditingCell] = useState<{ id: string; key: string } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Student | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("students")
      .select("*")
      .order("last_name")
      .order("first_name");
    setStudents((data ?? []) as Student[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (editingCell && inputRef.current) inputRef.current.focus();
  }, [editingCell]);

  // Unique values for filter dropdowns
  const grades = useMemo(() =>
    Array.from(new Set(students.map(s => s.grade).filter(Boolean))).sort() as string[],
    [students]
  );
  const genders = useMemo(() =>
    Array.from(new Set(students.map(s => s.gender).filter(Boolean))).sort() as string[],
    [students]
  );

  const filtered = useMemo(() => students.filter(s => {
    const q = search.toLowerCase();
    if (q && !(
      s.full_name.toLowerCase().includes(q) ||
      s.student_code.toLowerCase().includes(q) ||
      (s.grade ?? "").toLowerCase().includes(q) ||
      (s.guardian_name ?? "").toLowerCase().includes(q) ||
      (s.guardian_phone ?? "").toLowerCase().includes(q)
    )) return false;
    if (filterGrade && s.grade !== filterGrade) return false;
    if (filterGender && s.gender !== filterGender) return false;
    if (filterStatus && s.status !== filterStatus) return false;
    return true;
  }), [students, search, filterGrade, filterGender, filterStatus]);

  // Stats
  const stats = useMemo(() => ({
    total: students.length,
    active: students.filter(s => s.status === "active").length,
    inactive: students.filter(s => s.status !== "active").length,
    male: students.filter(s => s.gender === "Male").length,
    female: students.filter(s => s.gender === "Female").length,
    classCount: grades.length,
  }), [students, grades]);

  const { selectedIds, toggle: toggleBulk, selectAll: bulkSelectAll, clearSelection: bulkClear } = useBulkSelect(filtered.map(s => s.id));

  // --- Edit logic ---
  function startEdit(id: string, key: string, val: string) {
    if (!canEdit) return;
    setEditingCell({ id, key });
    setEditValue(val || "");
  }
  function cancelEdit() { setEditingCell(null); setEditValue(""); }

  async function saveEdit() {
    if (!editingCell) return;
    const { id, key } = editingCell;
    setSavingId(id);

    const updates: Record<string, unknown> = { [key]: editValue || null, updated_at: new Date().toISOString() };

    // If editing a name field, recalculate full_name
    if (["last_name", "first_name", "middle_name"].includes(key)) {
      const student = students.find(s => s.id === id);
      const last = key === "last_name" ? editValue : ((student as Record<string, unknown>)?.last_name as string ?? "");
      const first = key === "first_name" ? editValue : ((student as Record<string, unknown>)?.first_name as string ?? "");
      const middle = key === "middle_name" ? editValue : ((student as Record<string, unknown>)?.middle_name as string ?? "");
      updates.full_name = [last, first, middle].filter(Boolean).join(" ");
    }

    const { error } = await supabase.from("students").update(updates).eq("id", id);
    if (error) {
      notify(`Save failed: ${error.message}`, "error");
    } else {
      setStudents(prev => prev.map(s => s.id === id ? { ...s, ...updates } as Student : s));
      await supabase.from("activity_log").insert({
        user_email: profile?.email, user_name: profile?.full_name,
        action: "Edit Student", details: `Updated ${key} for ${id}`,
      });
      notify("Saved");
    }
    setSavingId(null);
    cancelEdit();
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setSavingId(deleteTarget.id);
    const { error } = await supabase.from("students").delete().eq("id", deleteTarget.id);
    if (error) {
      notify(`Delete failed: ${error.message}`, "error");
      setSavingId(null);
      return;
    }
    setStudents(prev => prev.filter(s => s.id !== deleteTarget.id));
    await supabase.from("activity_log").insert({
      user_email: profile?.email, user_name: profile?.full_name,
      action: "Delete Student", details: `${deleteTarget.student_code} — ${deleteTarget.full_name}`,
    });
    notify(`Deleted ${deleteTarget.full_name}`);
    setSavingId(null);
    setDeleteTarget(null);
  }

  async function bulkDeleteSelected(ids: string[]) {
    // Single round-trip via .in() — the old for-await loop was one HTTP
    // request per selected id, which took multiple seconds on medium sets.
    if (ids.length === 0) return;
    const { error } = await supabase.from("students").delete().in("id", ids);
    if (error) { notify(`Bulk delete failed: ${error.message}`, "error"); return; }
    await supabase.from("activity_log").insert({
      user_email: profile?.email,
      user_name: profile?.full_name,
      action: "Bulk Delete Students",
      details: `${ids.length} students`,
    });
    notify(`Deleted ${ids.length} students`);
    load();
  }
  async function bulkDeleteAll() {
    const { error } = await supabase.from("students").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) { notify(`Purge failed: ${error.message}`, "error"); return; }
    notify("All students deleted");
    load();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") { e.preventDefault(); saveEdit(); }
    if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
  }

  const hasActiveFilters = !!(filterGrade || filterGender || filterStatus);

  return (
    <div className="p-6 space-y-5">
      <PageHeader
        title="Students"
        subtitle={`${stats.total} registered · ${stats.active} active · ${stats.classCount} classes`}
      >
        <div className="flex gap-2 flex-wrap">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => window.open(`/dashboard/students/class-list${filterGrade ? `?class=${encodeURIComponent(filterGrade)}` : ""}`, "_blank")}
            title="Printable class list on your school's letterhead"
          >
            <Printer size={14} /> Class list
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => window.open(`/dashboard/students/id-cards${filterGrade ? `?class=${encodeURIComponent(filterGrade)}` : ""}`, "_blank")}
            title="Printable student ID cards"
          >
            <Printer size={14} /> ID cards
          </Button>
          {canEdit && (
            <>
              <Button size="sm" variant="secondary" onClick={() => setShowImport(true)}>
                <Upload size={14} /> Import
              </Button>
              <Button size="sm" variant="gold" onClick={() => setShowAdd(true)}>
                <Plus size={14} /> Add Student
              </Button>
            </>
          )}
        </div>
      </PageHeader>

      {/* Quick stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="Total" value={stats.total} icon={<GraduationCap size={14} />} />
        <StatCard label="Active" value={stats.active} icon={<UserCheck size={14} />} color="text-green-700" />
        <StatCard label="Inactive" value={stats.inactive} icon={<UserX size={14} />} color="text-gray-500" />
        <StatCard label="Male" value={stats.male} icon={<Users size={14} />} color="text-blue-700" />
        <StatCard label="Female" value={stats.female} icon={<Users size={14} />} color="text-pink-700" />
        <StatCard label="Classes" value={stats.classCount} icon={<GraduationCap size={14} />} color="text-purple-700" />
      </div>

      {/* Search + Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search by name, ID, grade, or guardian…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
          />
        </div>
        <button
          onClick={() => setShowFilters(f => !f)}
          className={cn(
            "flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium border transition-colors",
            hasActiveFilters
              ? "bg-[#FBF6E8] border-[#C9A227] text-[#0F2A47]"
              : "bg-white border-gray-300 text-gray-600 hover:bg-gray-50"
          )}
        >
          <Filter size={14} />
          Filters
          {hasActiveFilters && (
            <span className="w-5 h-5 rounded-full bg-[#C9A227] text-white text-[10px] grid place-items-center font-bold">
              {[filterGrade, filterGender, filterStatus].filter(Boolean).length}
            </span>
          )}
        </button>
      </div>

      {showFilters && (
        <div className="flex flex-wrap gap-3 p-4 bg-white rounded-xl border border-gray-200">
          <select value={filterGrade} onChange={e => setFilterGrade(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white" aria-label="Filter by grade">
            <option value="">All grades</option>
            {grades.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
          <select value={filterGender} onChange={e => setFilterGender(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white" aria-label="Filter by gender">
            <option value="">All genders</option>
            {genders.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white" aria-label="Filter by status">
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="graduated">Graduated</option>
          </select>
          {hasActiveFilters && (
            <button
              onClick={() => { setFilterGrade(""); setFilterGender(""); setFilterStatus(""); }}
              className="text-xs text-gray-500 hover:text-red-600 underline"
            >
              Clear all
            </button>
          )}
        </div>
      )}

      {loading ? <LoadingSpinner /> : (
        <>
          <BulkDeleteBar selectedIds={selectedIds} totalCount={filtered.length} itemLabel="students"
            onDeleteSelected={bulkDeleteSelected} onDeleteAll={bulkDeleteAll}
            onSelectAll={bulkSelectAll} onClearSelection={bulkClear} isDeveloper={isDeveloper} />

          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#0F2A47] text-white">
                    {isDeveloper && <th className="w-8 px-2 py-3" />}
                    <th className="text-left px-4 py-3 text-xs font-semibold">ID</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold">Last Name</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold">First Name</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold">Middle</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold">Class</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold">Gender</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold">Guardian</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold">Phone</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold">Status</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr><td colSpan={isDeveloper ? 12 : 11}>
                      <EmptyState message="No students match your search." icon={<GraduationCap size={32} />} />
                    </td></tr>
                  ) : filtered.map(s => {
                    const busy = savingId === s.id;
                    return (
                      <tr key={s.id} className={cn("border-b border-gray-50 hover:bg-gray-50 group", busy && "opacity-50")}>
                        <RowCheckbox id={s.id} selectedIds={selectedIds} onToggle={toggleBulk} isDeveloper={isDeveloper} />
                        <td className="px-4 py-3 font-mono text-xs text-gray-500 font-semibold">{s.student_code}</td>
                        <EditCell id={s.id} field="last_name" value={(s as Record<string, unknown>).last_name as string ?? ""}
                          editing={editingCell} editValue={editValue} setEditValue={setEditValue}
                          canEdit={canEdit} onStart={startEdit} onSave={saveEdit} onCancel={cancelEdit}
                          onKeyDown={handleKeyDown} inputRef={inputRef} bold />
                        <EditCell id={s.id} field="first_name" value={(s as Record<string, unknown>).first_name as string ?? ""}
                          editing={editingCell} editValue={editValue} setEditValue={setEditValue}
                          canEdit={canEdit} onStart={startEdit} onSave={saveEdit} onCancel={cancelEdit}
                          onKeyDown={handleKeyDown} inputRef={inputRef} />
                        <EditCell id={s.id} field="middle_name" value={(s as Record<string, unknown>).middle_name as string ?? ""}
                          editing={editingCell} editValue={editValue} setEditValue={setEditValue}
                          canEdit={canEdit} onStart={startEdit} onSave={saveEdit} onCancel={cancelEdit}
                          onKeyDown={handleKeyDown} inputRef={inputRef} muted />
                        <EditCell id={s.id} field="grade" value={s.grade ?? ""}
                          editing={editingCell} editValue={editValue} setEditValue={setEditValue}
                          canEdit={canEdit} onStart={startEdit} onSave={saveEdit} onCancel={cancelEdit}
                          onKeyDown={handleKeyDown} inputRef={inputRef} />
                        <td className="px-4 py-3 text-gray-600 text-xs">{s.gender ?? "—"}</td>
                        <EditCell id={s.id} field="guardian_name" value={s.guardian_name ?? ""}
                          editing={editingCell} editValue={editValue} setEditValue={setEditValue}
                          canEdit={canEdit} onStart={startEdit} onSave={saveEdit} onCancel={cancelEdit}
                          onKeyDown={handleKeyDown} inputRef={inputRef} />
                        <EditCell id={s.id} field="guardian_phone" value={s.guardian_phone ?? ""}
                          editing={editingCell} editValue={editValue} setEditValue={setEditValue}
                          canEdit={canEdit} onStart={startEdit} onSave={saveEdit} onCancel={cancelEdit}
                          onKeyDown={handleKeyDown} inputRef={inputRef} muted />
                        <td className="px-4 py-3">
                          {canEdit ? (
                            <select value={s.status} onChange={async e => {
                              setSavingId(s.id);
                              await supabase.from("students").update({ status: e.target.value, updated_at: new Date().toISOString() }).eq("id", s.id);
                              setStudents(prev => prev.map(st => st.id === s.id ? { ...st, status: e.target.value } : st));
                              setSavingId(null);
                            }} className={cn("text-xs font-semibold px-2 py-1 rounded-lg border-0 cursor-pointer", s.status === "active" ? "bg-green-100 text-green-700" : s.status === "graduated" ? "bg-purple-100 text-purple-700" : "bg-gray-100 text-gray-500")}>
                              <option value="active">Active</option>
                              <option value="inactive">Inactive</option>
                              <option value="graduated">Graduated</option>
                            </select>
                          ) : (
                            <span className={cn("text-xs font-semibold px-2 py-0.5 rounded-full", s.status === "active" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500")}>{s.status}</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Link href={`/dashboard/students/${s.id}`} className="flex items-center gap-1 text-xs text-[#0F2A47] hover:underline font-medium">
                              View <ChevronRight size={12} />
                            </Link>
                            {canEdit && (
                              <button onClick={() => setDeleteTarget(s)} title="Delete student"
                                className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100">
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-3 border-t border-gray-100 text-xs text-gray-500 flex items-center justify-between">
              <span>Showing {filtered.length} of {students.length} students</span>
              <span className="text-[10px] text-gray-400">Click any cell to edit · Tab to navigate</span>
            </div>
          </Card>
        </>
      )}

      {showAdd && <AddStudentModal onClose={() => { setShowAdd(false); load(); }} />}
      {showImport && <ImportStudentsModal onCloseAction={() => { setShowImport(false); load(); }} />}
      {deleteTarget && (
        <Modal open onClose={() => setDeleteTarget(null)} title="Delete Student" size="sm">
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Delete <strong>{deleteTarget.full_name}</strong> ({deleteTarget.student_code})?
              Their payment history is preserved but they will no longer appear in the student list.
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setDeleteTarget(null)}>Cancel</Button>
              <Button variant="danger" onClick={confirmDelete}>Delete</Button>
            </div>
          </div>
        </Modal>
      )}
      <ToastHost />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function StatCard({ label, value, icon, color }: { label: string; value: number; icon: React.ReactNode; color?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3">
      <div className={cn("shrink-0", color ?? "text-[#0F2A47]")}>{icon}</div>
      <div>
        <div className="text-xs text-gray-500">{label}</div>
        <div className={cn("text-lg font-bold", color ?? "text-[#0F2A47]")}>{value}</div>
      </div>
    </div>
  );
}

function EditCell({ id, field, value, editing, editValue, setEditValue, canEdit, onStart, onSave, onCancel, onKeyDown, inputRef, bold, muted }: {
  id: string; field: string; value: string;
  editing: { id: string; key: string } | null;
  editValue: string; setEditValue: (v: string) => void;
  canEdit: boolean;
  onStart: (id: string, key: string, val: string) => void;
  onSave: () => void; onCancel: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  inputRef: React.RefObject<HTMLInputElement>;
  bold?: boolean; muted?: boolean;
}) {
  const isEditing = editing?.id === id && editing.key === field;
  if (isEditing) {
    return (
      <td className="px-2 py-1.5">
        <div className="flex items-center gap-1">
          <input
            ref={inputRef}
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            onKeyDown={onKeyDown}
            className="w-full px-2 py-1.5 text-sm border border-[#C9A227] rounded-md focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
          />
          <button onClick={onSave} className="text-green-600 hover:text-green-700 p-1"><Check size={14} /></button>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 p-1"><X size={14} /></button>
        </div>
      </td>
    );
  }
  return (
    <td
      onClick={canEdit ? () => onStart(id, field, value) : undefined}
      className={cn("px-4 py-3", canEdit && "cursor-pointer hover:bg-[#FBF6E8] group/cell")}
    >
      <div className="flex items-center gap-1.5">
        <span className={cn(
          bold ? "font-semibold text-gray-900" : muted ? "text-gray-500" : "text-gray-700"
        )}>{value || "—"}</span>
        {canEdit && <Pencil size={10} className="text-gray-300 opacity-0 group-hover/cell:opacity-100 shrink-0" />}
      </div>
    </td>
  );
}

function AddStudentModal({ onClose }: { onClose: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const { profile, orgId } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    student_code: "", last_name: "", first_name: "", middle_name: "",
    grade: "", academic_year: "", gender: "", date_of_birth: "",
    admission_date: today(), guardian_name: "", guardian_phone: "",
    guardian_email: "", address: "", notes: "",
  });

  const fullName = [form.last_name, form.first_name, form.middle_name].filter(Boolean).join(" ");

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    (async () => {
      // Prefer the atomic, org-scoped RPC so the suggested code is unique
      // WITHIN THIS SCHOOL only. Codes are per-org, so S123 in one school and
      // S123 in another are independent — the RPC scopes its scan to p_org.
      const { data: rpcCode, error: rpcErr } = await supabase.rpc("next_student_code", { p_org: orgId });
      if (!cancelled && !rpcErr && typeof rpcCode === "string" && rpcCode.trim()) {
        setForm(f => ({ ...f, student_code: rpcCode.trim() }));
        return;
      }
      // Fallback: generate a random code deduped against THIS org's codes only.
      const { data } = await supabase
        .from("students")
        .select("student_code")
        .eq("organization_id", orgId);
      if (cancelled) return;
      const codes = new Set((data ?? []).map(s => s.student_code));
      let code: string;
      do { code = `S${String(Math.floor(Math.random() * 1000)).padStart(3, "0")}`; } while (codes.has(code));
      setForm(f => ({ ...f, student_code: code }));
    })();
    return () => { cancelled = true; };
  }, [supabase, orgId]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.last_name.trim()) { setError("Last name is required."); return; }
    if (!form.first_name.trim()) { setError("First name is required."); return; }
    setLoading(true); setError("");
    // Use the ACTIVE org (orgId, which mirrors the DB's current_user_org_id())
    // rather than profile.organization_id. The students RLS WITH CHECK requires
    // organization_id = current_user_org_id(); when a user is switched into a
    // different school (e.g. a super-admin managing another school), their
    // profile.organization_id is a DIFFERENT (or null) org, which fails the
    // check — the "new row violates row-level security policy" error.
    const activeOrgId = orgId || profile?.organization_id || null;
    if (!activeOrgId) {
      setError("No active school context. Please refresh or switch to a school and try again.");
      setLoading(false);
      return;
    }
    const { error: err } = await supabase.from("students").insert({
      organization_id: activeOrgId,
      student_code: form.student_code, full_name: fullName,
      last_name: form.last_name, first_name: form.first_name,
      middle_name: form.middle_name || null, grade: form.grade || null,
      academic_year: form.academic_year || null, gender: form.gender || null,
      date_of_birth: form.date_of_birth || null, admission_date: form.admission_date || null,
      address: form.address || null, guardian_name: form.guardian_name || null,
      guardian_phone: form.guardian_phone || null, guardian_email: form.guardian_email || null,
      notes: form.notes || null, status: "active",
    });
    if (err) { setError(err.message); setLoading(false); return; }
    await supabase.from("activity_log").insert({
      user_email: profile?.email, user_name: profile?.full_name,
      action: "Add Student", details: `${form.student_code} — ${fullName}`,
    });
    onClose();
  }

  return (
    <Modal open onClose={onClose} title="Add New Student" size="xl">
      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}
      <form onSubmit={submit} className="space-y-5">
        <fieldset className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 border border-gray-200 rounded-xl">
          <legend className="text-xs font-bold uppercase tracking-wider text-gray-500 px-2">Identity</legend>
          <Input label="Student ID" value={form.student_code} onChange={set("student_code")} required />
          <Input label="Last Name *" value={form.last_name} onChange={set("last_name")} required placeholder="Okafor" />
          <Input label="First Name *" value={form.first_name} onChange={set("first_name")} required placeholder="Ada" />
          <Input label="Middle Name" value={form.middle_name} onChange={set("middle_name")} placeholder="Optional" />
          <Select label="Gender" value={form.gender} onChange={set("gender")}
            options={[{ value: "Male", label: "Male" }, { value: "Female", label: "Female" }]} placeholder="Select" />
          <Input label="Date of Birth" type="date" value={form.date_of_birth} onChange={set("date_of_birth")} />
        </fieldset>

        <fieldset className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 border border-gray-200 rounded-xl">
          <legend className="text-xs font-bold uppercase tracking-wider text-gray-500 px-2">Enrollment</legend>
          <Input label="Class / Grade" value={form.grade} onChange={set("grade")} placeholder="JSS1 / Grade 5" />
          <Input label="Academic Year" value={form.academic_year} onChange={set("academic_year")} placeholder="2026/2027" />
          <Input label="Admission Date" type="date" value={form.admission_date} onChange={set("admission_date")} />
        </fieldset>

        <fieldset className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 border border-gray-200 rounded-xl">
          <legend className="text-xs font-bold uppercase tracking-wider text-gray-500 px-2">Guardian / Parent</legend>
          <Input label="Guardian Name" value={form.guardian_name} onChange={set("guardian_name")} />
          <Input label="Guardian Phone" value={form.guardian_phone} onChange={set("guardian_phone")} placeholder="+234 800 000 0000" />
          <Input label="Guardian Email" type="email" value={form.guardian_email} onChange={set("guardian_email")} />
          <div className="sm:col-span-3">
            <Input label="Address" value={form.address} onChange={set("address")} />
          </div>
        </fieldset>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
          <textarea value={form.notes} onChange={set("notes")} rows={3} placeholder="Any additional information…"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]" />
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="gold" loading={loading}>Add Student</Button>
        </div>
      </form>
    </Modal>
  );
}
