"use client";

/**
 * Student Finance Module
 *
 * Fee schedules, outstanding balances, payment status, and payment history
 * linked to student records. Separated from the Student Information System
 * so schools can subscribe to SIS without finance, or vice versa.
 *
 * Premium features:
 * - Balance cards with collection rate
 * - Filterable by payment status, grade, or amount range
 * - Direct "Record Payment" action per student
 * - Debtors list export
 * - Click any row to see full fee breakdown
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { fmtMoney } from "@/lib/utils";
import { PageHeader, LoadingSpinner, EmptyState } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";
import { Wallet, Search, GraduationCap, TrendingUp, AlertTriangle, ChevronRight, Download, CircleDollarSign, PiggyBank, Receipt, Printer } from "lucide-react";
import Link from "next/link";
import type { Student, FeeSchedule } from "@/lib/types";

interface StudentFinance extends Student {
  total_due: number;
  total_paid: number;
  balance: number;
  payment_status: "paid" | "partial" | "unpaid";
  last_payment_date: string | null;
}

export default function StudentFinancePage() {
  const { isAdmin, canEdit } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const [students, setStudents] = useState<StudentFinance[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterGrade, setFilterGrade] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [studRes, incRes, feeRes] = await Promise.all([
      supabase.from("students").select("*").eq("status", "active").order("full_name"),
      supabase.from("income_entries").select("student_id, amount, date"),
      supabase.from("fee_schedules").select("*").eq("active", true),
    ]);
    const allStudents: Student[] = studRes.data ?? [];
    const income = incRes.data ?? [];
    const fees: FeeSchedule[] = feeRes.data ?? [];

    // Build a map of student_id -> total paid + last payment date
    const paidMap: Record<string, { total: number; lastDate: string | null }> = {};
    income.forEach(r => {
      if (r.student_id) {
        const prev = paidMap[r.student_id] || { total: 0, lastDate: null };
        prev.total += r.amount;
        if (!prev.lastDate || r.date > prev.lastDate) prev.lastDate = r.date;
        paidMap[r.student_id] = prev;
      }
    });

    const withFinance: StudentFinance[] = allStudents.map(s => {
      const total_due = fees
        .filter(f => !f.grade || f.grade === s.grade)
        .reduce((sum, f) => sum + f.amount, 0);
      const paid = paidMap[s.id] || { total: 0, lastDate: null };
      const balance = total_due - paid.total;
      const payment_status: "paid" | "partial" | "unpaid" =
        balance <= 0 ? "paid" : paid.total > 0 ? "partial" : "unpaid";
      return {
        ...s, total_due, total_paid: paid.total, balance,
        payment_status, last_payment_date: paid.lastDate,
      };
    });

    setStudents(withFinance);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const grades = useMemo(() =>
    Array.from(new Set(students.map(s => s.grade).filter(Boolean))).sort() as string[],
    [students]
  );

  const filtered = useMemo(() => students.filter(s => {
    const q = search.toLowerCase();
    if (q && !(
      s.full_name.toLowerCase().includes(q) ||
      s.student_code.toLowerCase().includes(q) ||
      (s.grade ?? "").toLowerCase().includes(q)
    )) return false;
    if (filterStatus && s.payment_status !== filterStatus) return false;
    if (filterGrade && s.grade !== filterGrade) return false;
    return true;
  }), [students, search, filterStatus, filterGrade]);

  // Aggregates
  const agg = useMemo(() => {
    const totalDue = students.reduce((s, st) => s + st.total_due, 0);
    const totalPaid = students.reduce((s, st) => s + st.total_paid, 0);
    const outstanding = students.reduce((s, st) => s + Math.max(0, st.balance), 0);
    const collectionRate = totalDue > 0 ? Math.round((totalPaid / totalDue) * 100) : 0;
    return {
      totalDue, totalPaid, outstanding, collectionRate,
      paid: students.filter(s => s.payment_status === "paid").length,
      partial: students.filter(s => s.payment_status === "partial").length,
      unpaid: students.filter(s => s.payment_status === "unpaid").length,
    };
  }, [students]);

  function exportDebtors() {
    const debtors = filtered.filter(s => s.balance > 0);
    const rows = [
      ["Student Code", "Full Name", "Grade", "Total Due", "Total Paid", "Balance", "Guardian", "Phone"],
      ...debtors.map(s => [
        s.student_code, s.full_name, s.grade ?? "", String(s.total_due),
        String(s.total_paid), String(s.balance), s.guardian_name ?? "", s.guardian_phone ?? "",
      ]),
    ];
    const csv = rows.map(r => r.map(c => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "debtors-list.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) return <div className="p-6"><LoadingSpinner /></div>;

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="Student Finance" subtitle="Fee balances, payment tracking, and collection analytics">
        <div className="flex gap-2 flex-wrap">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              const ids = filtered.map((s) => s.id).join(",");
              if (!ids) return;
              window.open(`/dashboard/student-finance/statements?ids=${ids}`, "_blank");
            }}
            disabled={filtered.length === 0}
            title="Open a printable fee statement for every student in the current filter"
          >
            <Printer size={14} /> Print statements
          </Button>
          <Button size="sm" variant="secondary" onClick={exportDebtors}>
            <Download size={14} /> Export Debtors
          </Button>
          <Link href="/dashboard/income">
            <Button size="sm" variant="gold">
              <Receipt size={14} /> Record Payment
            </Button>
          </Link>
        </div>
      </PageHeader>

      {/* Finance KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <FinanceCard label="Total Fees Due" value={fmtMoney(agg.totalDue)} icon={<Wallet size={16} />} />
        <FinanceCard label="Collected" value={fmtMoney(agg.totalPaid)} icon={<PiggyBank size={16} />} color="text-green-700" sub={`${agg.collectionRate}% collection rate`} />
        <FinanceCard label="Outstanding" value={fmtMoney(agg.outstanding)} icon={<AlertTriangle size={16} />} color="text-red-700" sub={`${agg.unpaid + agg.partial} students owe`} />
        <FinanceCard label="Fully Paid" value={String(agg.paid)} icon={<TrendingUp size={16} />} color="text-green-700" sub={`of ${students.length} active students`} />
      </div>

      {/* Payment status breakdown */}
      <div className="grid grid-cols-3 gap-3">
        {([
          { status: "paid", label: "Paid in Full", count: agg.paid, color: "bg-green-100 text-green-700 border-green-200" },
          { status: "partial", label: "Part Paid", count: agg.partial, color: "bg-amber-50 text-amber-700 border-amber-200" },
          { status: "unpaid", label: "Unpaid", count: agg.unpaid, color: "bg-red-50 text-red-700 border-red-200" },
        ] as const).map(item => (
          <button
            key={item.status}
            onClick={() => setFilterStatus(filterStatus === item.status ? "" : item.status)}
            className={cn(
              "rounded-xl border p-4 text-left transition-all",
              filterStatus === item.status ? `${item.color} ring-2 ring-offset-1 ring-current` : `${item.color} hover:shadow-sm`
            )}
          >
            <div className="text-2xl font-bold">{item.count}</div>
            <div className="text-xs font-medium mt-0.5">{item.label}</div>
          </button>
        ))}
      </div>

      {/* Search + Grade filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" placeholder="Search by name, ID, or grade…" value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]" />
        </div>
        <select value={filterGrade} onChange={e => setFilterGrade(e.target.value)}
          className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white" aria-label="Filter by grade">
          <option value="">All grades</option>
          {grades.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
        {(filterStatus || filterGrade) && (
          <button onClick={() => { setFilterStatus(""); setFilterGrade(""); }}
            className="text-xs text-gray-500 hover:text-red-600 underline whitespace-nowrap self-center">
            Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#0F2A47] text-white">
                <th className="text-left px-4 py-3 text-xs font-semibold">Student</th>
                <th className="text-left px-4 py-3 text-xs font-semibold">Class</th>
                <th className="text-right px-4 py-3 text-xs font-semibold">Fees Due</th>
                <th className="text-right px-4 py-3 text-xs font-semibold">Paid</th>
                <th className="text-right px-4 py-3 text-xs font-semibold">Balance</th>
                <th className="text-center px-4 py-3 text-xs font-semibold">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold">Last Payment</th>
                <th className="text-left px-4 py-3 text-xs font-semibold">Guardian</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={9}><EmptyState message="No students match." icon={<Wallet size={32} />} /></td></tr>
              ) : filtered.map(s => (
                <tr key={s.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{s.full_name}</div>
                    <div className="text-xs text-gray-500 font-mono">{s.student_code}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{s.grade ?? "—"}</td>
                  <td className="px-4 py-3 text-right text-gray-700">{fmtMoney(s.total_due)}</td>
                  <td className="px-4 py-3 text-right text-green-700 font-medium">{fmtMoney(s.total_paid)}</td>
                  <td className={cn("px-4 py-3 text-right font-bold", s.balance > 0 ? "text-red-700" : "text-green-700")}>
                    {fmtMoney(Math.max(0, s.balance))}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <StatusBadge status={s.payment_status} />
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {s.last_payment_date ? new Date(s.last_payment_date).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-xs text-gray-600">{s.guardian_name ?? "—"}</div>
                    {s.guardian_phone && (
                      <a href={`tel:${s.guardian_phone}`} className="text-[10px] text-gray-400 hover:underline">
                        {s.guardian_phone}
                      </a>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/dashboard/students/${s.id}`}
                      className="flex items-center gap-1 text-xs text-[#0F2A47] hover:underline font-medium">
                      Details <ChevronRight size={12} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-gray-100 text-xs text-gray-500 flex items-center justify-between">
          <span>Showing {filtered.length} of {students.length} active students</span>
          <span>
            Collection: <strong className="text-green-700">{agg.collectionRate}%</strong> · Outstanding: <strong className="text-red-700">{fmtMoney(agg.outstanding)}</strong>
          </span>
        </div>
      </Card>
    </div>
  );
}

function FinanceCard({ label, value, icon, color, sub }: { label: string; value: string; icon: React.ReactNode; color?: string; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center gap-2 mb-1">
        <span className={color ?? "text-[#0F2A47]"}>{icon}</span>
        <span className="text-xs text-gray-500 font-medium">{label}</span>
      </div>
      <div className={cn("text-xl font-bold", color ?? "text-[#0F2A47]")}>{value}</div>
      {sub && <div className="text-[10px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}
