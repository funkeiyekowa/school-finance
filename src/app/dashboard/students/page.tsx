"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { fmtMoney, fmtDate, today } from "@/lib/utils";
import { PageHeader, LoadingSpinner, EmptyState } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import { StatusBadge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { GraduationCap, Plus, Search, ChevronRight } from "lucide-react";
import Link from "next/link";
import type { Student, FeeSchedule } from "@/lib/types";

interface StudentWithBalance extends Student {
  total_due: number;
  total_paid: number;
  balance: number;
  payment_status: "paid" | "partial" | "unpaid";
}

export default function StudentsPage() {
  const { canEdit } = useAuth();
  const supabase = createClient();
  const [students, setStudents] = useState<StudentWithBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [showAdd, setShowAdd] = useState(false);

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

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="Students" subtitle={`${students.length} students registered`}>
        {canEdit && (
          <Button onClick={() => setShowAdd(true)}>
            <Plus size={16} /> Add Student
          </Button>
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
                  <th className="text-right px-4 py-3 text-xs font-semibold">Total Due</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold">Paid</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold">Balance</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={8}><EmptyState message="No students found." icon={<GraduationCap size={32} />} /></td></tr>
                ) : (
                  filtered.map(s => (
                    <tr key={s.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{s.full_name}</div>
                        <div className="text-xs text-gray-400 font-mono">{s.student_code}</div>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{s.grade || "—"}</td>
                      <td className="px-4 py-3 text-gray-600">{s.guardian_name || "—"}</td>
                      <td className="px-4 py-3 text-right font-medium">{fmtMoney(s.total_due)}</td>
                      <td className="px-4 py-3 text-right text-green-700 font-medium">{fmtMoney(s.total_paid)}</td>
                      <td className="px-4 py-3 text-right font-bold">{fmtMoney(Math.max(0, s.balance))}</td>
                      <td className="px-4 py-3"><StatusBadge status={s.payment_status} /></td>
                      <td className="px-4 py-3">
                        <Link href={`/dashboard/students/${s.id}`}
                          className="flex items-center gap-1 text-xs text-[#0F2A47] hover:underline font-medium">
                          View <ChevronRight size={12} />
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {showAdd && <AddStudentModal onClose={() => { setShowAdd(false); load(); }} />}
    </div>
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
      const codes = (data ?? []).map(s => s.student_code);
      const max = codes.reduce((m, c) => {
        const n = parseInt(c.replace(/\D/g, ""), 10);
        return isNaN(n) ? m : Math.max(m, n);
      }, 0);
      setForm(f => ({ ...f, student_code: `STU-${String(max + 1).padStart(4, "0")}` }));
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
