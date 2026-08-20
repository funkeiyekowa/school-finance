"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { fmtMoney, fmtDate, fmtDateTime, exportCSV } from "@/lib/utils";
import { PageHeader, LoadingSpinner } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { Download, Printer } from "lucide-react";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";
import type { IncomeEntry, ExpenseEntry, Student, FeeSchedule, Vendor } from "@/lib/types";

const REPORTS = [
  { id: "income_summary", label: "Income Summary" },
  { id: "expense_summary", label: "Expense Summary" },
  { id: "income_by_student", label: "Income by Student" },
  { id: "expense_by_vendor", label: "Expense by Vendor" },
  { id: "student_fee_balances", label: "Student Fee Balances" },
  { id: "monthly_cashflow", label: "Monthly Cash Flow" },
  { id: "reconciliation_status", label: "Reconciliation Status" },
  { id: "outstanding_balances", label: "Outstanding Balances" },
] as const;

type ReportId = (typeof REPORTS)[number]["id"];

export default function ReportsPage() {
  const supabase = createClient();
  const [activeReport, setActiveReport] = useState<ReportId>("income_summary");
  const [income, setIncome] = useState<IncomeEntry[]>([]);
  const [expenses, setExpenses] = useState<ExpenseEntry[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [fees, setFees] = useState<FeeSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [incRes, expRes, studRes, feeRes] = await Promise.all([
      supabase.from("income_entries").select("*").order("date"),
      supabase.from("expense_entries").select("*").order("date"),
      supabase.from("students").select("*").eq("status", "active"),
      supabase.from("fee_schedules").select("*").eq("active", true),
    ]);
    setIncome(incRes.data ?? []);
    setExpenses(expRes.data ?? []);
    setStudents(studRes.data ?? []);
    setFees(feeRes.data ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  function filterByDate<T extends { date: string }>(arr: T[]): T[] {
    return arr.filter(r => {
      if (dateFrom && r.date < dateFrom) return false;
      if (dateTo && r.date > dateTo) return false;
      return true;
    });
  }

  const filteredIncome = filterByDate(income);
  const filteredExpenses = filterByDate(expenses);

  // --- Report data computations ---
  function getIncomeSummary() {
    const byCategory: Record<string, { count: number; total: number }> = {};
    filteredIncome.forEach(r => {
      if (!byCategory[r.category]) byCategory[r.category] = { count: 0, total: 0 };
      byCategory[r.category].count++;
      byCategory[r.category].total += r.amount;
    });
    return Object.entries(byCategory).map(([cat, v]) => ({
      Category: cat, "Count": v.count,
      "Total (₦)": fmtMoney(v.total), _total: v.total,
    })).sort((a, b) => b._total - a._total);
  }

  function getExpenseSummary() {
    const byCategory: Record<string, { count: number; total: number }> = {};
    filteredExpenses.forEach(r => {
      if (!byCategory[r.category]) byCategory[r.category] = { count: 0, total: 0 };
      byCategory[r.category].count++;
      byCategory[r.category].total += r.amount;
    });
    return Object.entries(byCategory).map(([cat, v]) => ({
      Category: cat, "Count": v.count,
      "Total (₦)": fmtMoney(v.total), _total: v.total,
    })).sort((a, b) => b._total - a._total);
  }

  function getIncomeByStudent() {
    const map: Record<string, { name: string; count: number; total: number }> = {};
    filteredIncome.forEach(r => {
      const key = r.student_id || "unattributed";
      if (!map[key]) map[key] = { name: r.student_name || "Unattributed", count: 0, total: 0 };
      map[key].count++;
      map[key].total += r.amount;
    });
    return Object.values(map).sort((a, b) => b.total - a.total).map(v => ({
      Student: v.name, "Receipts": v.count,
      "Total Paid (₦)": fmtMoney(v.total), _total: v.total,
    }));
  }

  function getExpenseByVendor() {
    const map: Record<string, { name: string; count: number; total: number }> = {};
    filteredExpenses.forEach(r => {
      const key = r.vendor_id || "unattributed";
      if (!map[key]) map[key] = { name: r.vendor_name || "Unattributed", count: 0, total: 0 };
      map[key].count++;
      map[key].total += r.amount;
    });
    return Object.values(map).sort((a, b) => b.total - a.total).map(v => ({
      Vendor: v.name, "Vouchers": v.count,
      "Total Paid (₦)": fmtMoney(v.total), _total: v.total,
    }));
  }

  function getStudentFeeBalances() {
    const paidMap: Record<string, number> = {};
    income.forEach(r => { if (r.student_id) paidMap[r.student_id] = (paidMap[r.student_id] || 0) + r.amount; });
    return students.map(s => {
      const due = fees.filter(f => !f.grade || f.grade === s.grade).reduce((sum, f) => sum + f.amount, 0);
      const paid = paidMap[s.id] || 0;
      const balance = due - paid;
      return {
        "Student": s.full_name, "Code": s.student_code, "Grade": s.grade || "—",
        "Total Due (₦)": fmtMoney(due), "Paid (₦)": fmtMoney(paid),
        "Balance (₦)": fmtMoney(Math.max(0, balance)),
        "Status": balance <= 0 ? "Paid" : paid > 0 ? "Part paid" : "Unpaid",
        _balance: balance,
      };
    }).sort((a, b) => b._balance - a._balance);
  }

  function getMonthlyCashFlow() {
    const map: Record<string, { income: number; expenses: number }> = {};
    [...filteredIncome, ...filteredExpenses].forEach(r => {
      const key = r.date.substring(0, 7);
      if (!map[key]) map[key] = { income: 0, expenses: 0 };
    });
    filteredIncome.forEach(r => { const k = r.date.substring(0, 7); if (map[k]) map[k].income += r.amount; else map[k] = { income: r.amount, expenses: 0 }; });
    filteredExpenses.forEach(r => { const k = r.date.substring(0, 7); if (map[k]) map[k].expenses += r.amount; else map[k] = { income: 0, expenses: r.amount }; });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).map(([month, v]) => ({
      Month: month, "Income (₦)": fmtMoney(v.income), "Expenses (₦)": fmtMoney(v.expenses),
      "Net (₦)": fmtMoney(v.income - v.expenses),
      _income: v.income, _expenses: v.expenses, _net: v.income - v.expenses,
    }));
  }

  function getReconStatus() {
    return [
      { "Ledger": "Income", "Total": income.length, "Reconciled": income.filter(r => r.reconciled).length, "Unreconciled": income.filter(r => !r.reconciled).length },
      { "Ledger": "Expenses", "Total": expenses.length, "Reconciled": expenses.filter(r => r.reconciled).length, "Unreconciled": expenses.filter(r => !r.reconciled).length },
    ];
  }

  function getOutstandingBalances() {
    return getStudentFeeBalances().filter(s => s._balance > 0).map(s => ({
      Student: s.Student, Grade: s.Grade, "Balance (₦)": s["Balance (₦)"], Status: s.Status,
    }));
  }

  function getReportData(): Record<string, unknown>[] {
    switch (activeReport) {
      case "income_summary": return getIncomeSummary();
      case "expense_summary": return getExpenseSummary();
      case "income_by_student": return getIncomeByStudent();
      case "expense_by_vendor": return getExpenseByVendor();
      case "student_fee_balances": return getStudentFeeBalances();
      case "monthly_cashflow": return getMonthlyCashFlow();
      case "reconciliation_status": return getReconStatus();
      case "outstanding_balances": return getOutstandingBalances();
    }
  }

  function handleExport() {
    const data = getReportData();
    if (!data.length) return;
    // Remove internal _ keys
    const clean = data.map(row => Object.fromEntries(Object.entries(row).filter(([k]) => !k.startsWith("_"))));
    exportCSV(clean, `report-${activeReport}`);
  }

  const data = getReportData();
  const cols = data.length > 0 ? Object.keys(data[0]).filter(k => !k.startsWith("_")) : [];

  const cashFlowData = activeReport === "monthly_cashflow"
    ? getMonthlyCashFlow().map(r => ({ month: r.Month, income: r._income, expenses: r._expenses }))
    : [];

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="Reports" subtitle="Generate and export financial reports">
        <Button variant="secondary" size="sm" onClick={() => window.print()}>
          <Printer size={14} /> Print
        </Button>
        <Button size="sm" onClick={handleExport}>
          <Download size={14} /> Export CSV
        </Button>
      </PageHeader>

      {/* Report selector */}
      <div className="flex flex-wrap gap-2">
        {REPORTS.map(r => (
          <button key={r.id} onClick={() => setActiveReport(r.id)}
            className={cn(
              "px-3 py-1.5 rounded-lg text-sm font-medium transition-all border",
              activeReport === r.id
                ? "bg-[#0F2A47] text-white border-[#0F2A47]"
                : "bg-white text-gray-600 border-gray-200 hover:border-[#0F2A47] hover:text-[#0F2A47]"
            )}>
            {r.label}
          </button>
        ))}
      </div>

      {/* Date filters */}
      <div className="flex flex-wrap gap-3 items-center bg-white border border-gray-200 rounded-xl p-4">
        <span className="text-sm text-gray-500 font-medium">Filter by date:</span>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">From</label>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">To</label>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]" />
        </div>
        {(dateFrom || dateTo) && (
          <button onClick={() => { setDateFrom(""); setDateTo(""); }} className="text-xs text-gray-400 hover:text-gray-600 underline">
            Clear
          </button>
        )}
      </div>

      {loading ? <LoadingSpinner /> : (
        <>
          {/* Chart for monthly cash flow */}
          {activeReport === "monthly_cashflow" && cashFlowData.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Monthly Cash Flow</CardTitle></CardHeader>
              <CardContent className="pt-0">
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={cashFlowData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F0" />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#9CA3AF" }} />
                    <YAxis tick={{ fontSize: 11, fill: "#9CA3AF" }} tickFormatter={v => `₦${(v / 1000).toFixed(0)}k`} />
                    <Tooltip formatter={(v: number) => fmtMoney(v)} />
                    <Legend />
                    <Line type="monotone" dataKey="income" stroke="#0F2A47" strokeWidth={2} name="Income" dot={false} />
                    <Line type="monotone" dataKey="expenses" stroke="#EF4444" strokeWidth={2} name="Expenses" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Table */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>{REPORTS.find(r => r.id === activeReport)?.label}</CardTitle>
              <span className="text-xs text-gray-400">{data.length} rows</span>
            </CardHeader>
            <div className="overflow-x-auto">
              {data.length === 0 ? (
                <div className="p-8 text-center text-gray-400 text-sm">No data for the selected period.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[#0F2A47] text-white">
                      {cols.map(col => (
                        <th key={col} className="text-left px-4 py-3 text-xs font-semibold">{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((row, i) => (
                      <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                        {cols.map(col => (
                          <td key={col} className={cn(
                            "px-4 py-3",
                            String(row[col]).startsWith("₦") ? "font-semibold" : "text-gray-700"
                          )}>
                            {String(row[col] ?? "—")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
