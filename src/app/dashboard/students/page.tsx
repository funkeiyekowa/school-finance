"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { fmtMoney, today } from "@/lib/utils";
import { PageHeader, LoadingSpinner, EmptyState } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import { StatusBadge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { ImportStudentsModal } from "@/components/students/ImportStudentsModal";
import { cn } from "@/lib/utils";
import { GraduationCap, Plus, Search, ChevronRight, Upload, Trash2, Check, X, Pencil } from "lucide-react";
import Link from "next/link";
import type { Student, FeeSchedule } from "@/lib/types";

interface StudentWithBalance extends Student {
  total_due: number;
  total_paid: number;
  balance: number;
  payment_status: "paid" | "partial" | "unpaid";
}

// Columns editable directly in the grid, in display order.
const EDITABLE_COLUMNS: { key: keyof Student; label: string; type: "text" | "select"; options?: string[] }[] = [
  { key: "full_name", label: "Full Name", type: "text" },
  { key: "grade", label: "Grade", type: "text" },
  { key: "guardian_name", label: "Guardian", type: "text" },
  { key: "guardian_phone", label: "Phone", type: "text" },
  { key: "status", label: "Enrollment", type: "select", options: ["active", "inactive"] },
];

export default function StudentsPage() {
  const { canEdit, isAdmin, profile } = useAuth();
  const supabase = createClient();
  const [students, setStudents] = useState<StudentWithBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);

  // Inline edit state: which cell is being edited
  const [editingCell, setEditingCell] = useState<{ id: string; key: string } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StudentWithBalance | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [studRes, incRes, feeRes] = await Promise.all([
      supabase.from("students").select("*").order("full_name"),
      supabase.from("income_entries").select("student_id, amount"),
      supabase.from("fee_schedules").select("*").eq("active", true),
    ]);
    const students: Student[] = studRes.data ?? [];
    const income = incRes.data ?? [];
    const fees: FeeSchedule[] = feeRes.data ?? [];

    const paidMap: Record<string, number> = {};
    income.forEach(r => {
      if (r.student_id) paidMap[r.student_id] = (paidMap[r.student_id] || 0) + r.amount;
    });

    const withBalances: StudentWithBalance[] = students.map(s => {
      const total_due = fees.filter(f => !f.grade || f.grade === s.grade).reduce((sum, f) => sum + f.amount, 0);
      const total_paid = paidMap[s.id] || 0;
      const balance = total_due - total_paid;
      const payment_status = balance <= 0 ? "paid" : total_paid > 0 ? "partial" : "unpaid";
      return { ...s, total_due, total_paid, balance, payment_status };
    });

    setStudents(withBalances);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (editingCell && inputRef.current) inputRef.current.focus();
  }, [editingCell]);

  const filtered = students.filter(s => {
    const q = search.toLowerCase();
    const matchSearch = !q || s.full_name.toLowerCase().includes(q) || s.student_code.toLowerCase().includes(q) || (s.grade || "").toLowerCase().includes(q);
    const matchStatus = !filterStatus || s.payment_status === filterStatus;
    return matchSearch && matchStatus;
  });

  const totals = {
    paid: students.filter(s => s.payment_status === "paid").length,
    partial: students.filter(s => s.payment_status === "partial").length,
    unpaid: students.filter(s => s.payment_status === "unpaid").length,
    outstanding: students.reduce((sum, s) => sum + Math.max(0, s.balance), 0),
  };

  function startEdit(studentId: string, key: string, currentValue: string) {
    if (!canEdit) return;
    setEditingCell({ id: studentId, key });
    setEditValue(currentValue || "");
  }

  function cancelEdit() {
    setEditingCell(null);
    setEditValue("");
  }

  async function saveEdit() {
    if (!editingCell) return;
    const { id, key } = editingCell;
    setSavingId(id);

    const { error } = await supabase
      .from("students")
      .update({ [key]: editValue || null, updated_at: new Date().toISOString() })
      .eq("id", id);

    if (!error) {
      setStudents(prev => prev.map(s => s.id === id ? { ...s, [key]: editValue } : s));
      await supabase.from("activity_log").insert({
        user_email: profile?.email, user_name: profile?.full_name,
        action: "Edit Student", details: `Updated ${key} for student ${id}`,
      });
    }

    setSavingId(null);
    setEditingCell(null);
    setEditValue("");
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setSavingId(deleteTarget.id);
    const { error } = await supabase.from("students").delete().eq("id", deleteTarget.id);
    if (!error) {
      setStudents(prev => prev.filter(s => s.id !== deleteTarget.id));
      await supabase.from("activity_log").insert({
        user_email: profile?.email, user_name: profile?.full_name,
        action: "Delete Student", details: `${deleteTarget.student_code} — ${deleteTarget.full_name}`,
      });
    }
    setSavingId(null);
    setDeleteTarget(null);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") { e.preventDefault(); saveEdit(); }
    if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
  }

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="Students" subtitle={`${students.length} students registered · Click any cell to edit`}>
        {canEdit && (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setShowImport(true)}>
              <Upload size={16} /> Import
            </Button>
            <Button onClick={() => setShowAdd(true)}>
              <Plus size={16} /> Add Student
            </Button>
          </div>
        )}
      </PageHeader>

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Paid in Full", value: totals.paid, color: "text-green-700" },
          { label: "Part Paid", value: totals.partial, color: "text-amber-700" },
          { label: "Unpaid", value: totals.unpaid, color: "text-red-700" },
          { label: "Total Outstanding", value: fmtMoney(totals.outstanding), color: "text-[#0F2A47]" },
        ].map(item => (
          <div key={item.label} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="text-xs text-gray-500 font-medium mb-1">{item.label}</div>
            <div className={`text-xl font-bold ${item.color}`}>{item.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search by name, ID, or grade…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
          />
        </div>
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227] bg-white"
        >
          <option value="">All statuses</option>
          <option value="paid">Paid in full</option>
          <option value="partial">Part paid</option>
          <option value="unpaid">Unpaid</option>
        </select>
      </div>

      {loading ? <LoadingSpinner /> : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#0F2A47] text-white">
                  <th className="text-left px-4 py-3 text-xs font-semibold">Student</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold">Grade</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold">Guardian</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold">Phone</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold">Balance</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold">Enrolled</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={8}><EmptyState message="No students found." icon={<GraduationCap size={32} />} /></td></tr>
                ) : (
                  filtered.map(s => {
                    const isSaving = savingId === s.id;
                    return (
                      <tr key={s.id} className={cn("border-b border-gray-50 hover:bg-gray-50 transition-colors group", isSaving && "opacity-50")}>
                        {/* Name — editable */}
                        <EditableCell
                          value={s.full_name}
                          isEditing={editingCell?.id === s.id && editingCell.key === "full_name"}
                          canEdit={canEdit}
                          editValue={editValue}
                          setEditValue={setEditValue}
                          onStartEdit={() => startEdit(s.id, "full_name", s.full_name)}
                          onSave={saveEdit}
                          onCancel={cancelEdit}
                          onKeyDown={handleKeyDown}
                          inputRef={inputRef}
                          renderDisplay={() => (
                            <>
                              <div className="font-medium text-gray-900">{s.full_name}</div>
                              <div className="text-xs text-gray-400 font-mono">{s.student_code}</div>
                            </>
                          )}
                        />
                        {/* Grade — editable */}
                        <EditableCell
                          value={s.grade || ""}
                          isEditing={editingCell?.id === s.id && editingCell.key === "grade"}
                          canEdit={canEdit}
                          editValue={editValue}
                          setEditValue={setEditValue}
                          onStartEdit={() => startEdit(s.id, "grade", s.grade || "")}
                          onSave={saveEdit}
                          onCancel={cancelEdit}
                          onKeyDown={handleKeyDown}
                          inputRef={editingCell?.key === "grade" ? inputRef : undefined}
                          renderDisplay={() => <span className="text-gray-600">{s.grade || "—"}</span>}
                        />
                        {/* Guardian — editable */}
                        <EditableCell
                          value={s.guardian_name || ""}
                          isEditing={editingCell?.id === s.id && editingCell.key === "guardian_name"}
                          canEdit={canEdit}
                          editValue={editValue}
                          setEditValue={setEditValue}
                          onStartEdit={() => startEdit(s.id, "guardian_name", s.guardian_name || "")}
                          onSave={saveEdit}
                          onCancel={cancelEdit}
                          onKeyDown={handleKeyDown}
                          inputRef={editingCell?.key === "guardian_name" ? inputRef : undefined}
                          renderDisplay={() => <span className="text-gray-600">{s.guardian_name || "—"}</span>}
                        />
                        {/* Phone — editable */}
                        <EditableCell
                          value={s.guardian_phone || ""}
                          isEditing={editingCell?.id === s.id && editingCell.key === "guardian_phone"}
                          canEdit={canEdit}
                          editValue={editValue}
                          setEditValue={setEditValue}
                          onStartEdit={() => startEdit(s.id, "guardian_phone", s.guardian_phone || "")}
                          onSave={saveEdit}
                          onCancel={cancelEdit}
                          onKeyDown={handleKeyDown}
                          inputRef={editingCell?.key === "guardian_phone" ? inputRef : undefined}
                          renderDisplay={() => <span className="text-gray-600">{s.guardian_phone || "—"}</span>}
                        />
                        <td className="px-4 py-3 text-right font-bold">{fmtMoney(Math.max(0, s.balance))}</td>
                        <td className="px-4 py-3"><StatusBadge status={s.payment_status} /></td>
                        {/* Enrollment status — editable select */}
                        <td className="px-4 py-3">
                          {canEdit ? (
                            <select
                              value={s.status}
                              onChange={async (e) => {
                                const newStatus = e.target.value;
                                setSavingId(s.id);
                                const { error } = await supabase.from("students").update({ status: newStatus, updated_at: new Date().toISOString() }).eq("id", s.id);
                                if (!error) setStudents(prev => prev.map(st => st.id === s.id ? { ...st, status: newStatus } : st));
                                setSavingId(null);
                              }}
                              className={cn(
                                "text-xs font-semibold px-2 py-1 rounded-lg border-0 focus:ring-2 focus:ring-[#C9A227] cursor-pointer",
                                s.status === "active" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                              )}
                            >
                              <option value="active">Active</option>
                              <option value="inactive">Inactive</option>
                            </select>
                          ) : (
                            <span className={cn("text-xs font-semibold px-2 py-0.5 rounded-full", s.status === "active" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500")}>
                              {s.status === "active" ? "Active" : "Inactive"}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Link href={`/dashboard/students/${s.id}`}
                              className="flex items-center gap-1 text-xs text-[#0F2A47] hover:underline font-medium">
                              View <ChevronRight size={12} />
                            </Link>
                            {canEdit && (
                              <button
                                onClick={() => setDeleteTarget(s)}
                                title="Delete student"
                                className="text-gray-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {showAdd && <AddStudentModal onClose={() => { setShowAdd(false); load(); }} />}
      {showImport && <ImportStudentsModal onClose={() => { setShowImport(false); load(); }} />}

      {deleteTarget && (
        <Modal open onClose={() => setDeleteTarget(null)} title="Delete Student" size="sm">
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Are you sure you want to delete <strong>{deleteTarget.full_name}</strong> ({deleteTarget.student_code})?
              This does not delete their payment history, but they will no longer appear in the students list.
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setDeleteTarget(null)}>Cancel</Button>
              <Button variant="danger" onClick={confirmDelete}>Delete</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// A single grid cell that toggles between display text and an inline
// input on click. Kept generic so every editable column in the table
// shares the same click / save / cancel / keyboard behavior.
function EditableCell({
  value, isEditing, canEdit, editValue, setEditValue,
  onStartEdit, onSave, onCancel, onKeyDown, inputRef, renderDisplay,
}: {
  value: string;
  isEditing: boolean;
  canEdit: boolean;
  editValue: string;
  setEditValue: (v: string) => void;
  onStartEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  inputRef?: React.RefObject<HTMLInputElement>;
  renderDisplay: () => React.ReactNode;
}) {
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
      onClick={canEdit ? onStartEdit : undefined}
      className={cn("px-4 py-3", canEdit && "cursor-pointer hover:bg-[#FBF6E8] relative group/cell")}
    >
      <div className="flex items-center gap-2">
        <div className="flex-1">{renderDisplay()}</div>
        {canEdit && <Pencil size={11} className="text-gray-300 opacity-0 group-hover/cell:opacity-100 shrink-0" />}
      </div>
    </td>
  );
}

function AddStudentModal({ onClose }: { onClose: () => void }) {
  const supabase = createClient();
  const { profile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    student_code: "", full_name: "", grade: "", academic_year: "",
    gender: "", date_of_birth: "", admission_date: today(),
    guardian_name: "", guardian_phone: "", guardian_email: "", address: "", notes: "",
  });

  useEffect(() => {
    supabase.from("students").select("student_code").then(({ data }) => {
      const codes = new Set((data ?? []).map(s => s.student_code));
      let code: string;
      do {
        code = `S${String(Math.floor(Math.random() * 1000)).padStart(3, "0")}`;
      } while (codes.has(code));
      setForm(f => ({ ...f, student_code: code }));
    });
  }, [supabase]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.full_name.trim()) { setError("Full name is required."); return; }
    setLoading(true);
    setError("");
    const { error } = await supabase.from("students").insert({
      ...form,
      status: "active",
    });
    if (error) { setError(error.message); setLoading(false); }
    else {
      await supabase.from("activity_log").insert({
        user_email: profile?.email, user_name: profile?.full_name,
        action: "Add Student", details: `${form.student_code} — ${form.full_name}`,
      });
      onClose();
    }
  }

  return (
    <Modal open onClose={onClose} title="Add New Student" size="lg">
      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}
      <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Input label="Student ID" value={form.student_code} onChange={set("student_code")} required />
        <Input label="Full Name" value={form.full_name} onChange={set("full_name")} required />
        <Input label="Class / Grade" value={form.grade} onChange={set("grade")} placeholder="e.g. Grade 5 / SS2" />
        <Input label="Academic Year" value={form.academic_year} onChange={set("academic_year")} placeholder="e.g. 2025/2026" />
        <Select label="Gender" value={form.gender} onChange={set("gender")}
          options={[{ value: "Male", label: "Male" }, { value: "Female", label: "Female" }, { value: "Other", label: "Other" }]}
          placeholder="Select gender" />
        <Input label="Date of Birth" type="date" value={form.date_of_birth} onChange={set("date_of_birth")} />
        <Input label="Admission Date" type="date" value={form.admission_date} onChange={set("admission_date")} />
        <div className="sm:col-span-2">
          <Input label="Address" value={form.address} onChange={set("address")} />
        </div>
        <Input label="Guardian Name" value={form.guardian_name} onChange={set("guardian_name")} />
        <Input label="Guardian Phone" value={form.guardian_phone} onChange={set("guardian_phone")} placeholder="+234 800 000 0000" />
        <div className="sm:col-span-2">
          <Input label="Guardian Email" type="email" value={form.guardian_email} onChange={set("guardian_email")} />
        </div>
        <div className="sm:col-span-2 flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={loading} variant="gold">Add Student</Button>
        </div>
      </form>
    </Modal>
  );
}
