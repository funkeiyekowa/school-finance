"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { fmtMoney, fmtDate, cn } from "@/lib/utils";
import { KpiCard, LoadingSpinner, PageHeader } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/Badge";
import Link from "next/link";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { TrendingUp, TrendingDown, Scale, AlertTriangle, RefreshCw } from "lucide-react";
import type { IncomeEntry, ExpenseEntry, StudentWithBalance } from "@/lib/types";

const CHART_COLORS = ["#0F2A47", "#C9A227", "#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6"];

interface DashboardData {
  totalIncome: number;
  totalExpenses: number;
  netBalance: number;
  outstandingFees: number;
  unreconciledIncome: number;
  unreconciledExpenses: number;
  incomeByCategory: { name: string; value: number }[];
  expenseByCategory: { name: string; value: number }[];
  monthlyCashFlow: { month: string; income: number; expenses: number }[];
  studentBalances: StudentWithBalance[];
  recentIncome: IncomeEntry[];
  smsAlertsNeedReview: number;
}

export default function DashboardPage() {
  const { profile } = useAuth();
  const supabase = createClient();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [incomeRes, expenseRes, studentsRes, feesRes, smsRes] = await Promise.all([
        supabase.from("income_entries").select("*").order("date", { ascending: false }).limit(500),
        supabase.from("expense_entries").select("*").order("date", { ascending: false }).limit(500),
        supabase.from("students").select("*").eq("status", "active"),
        supabase.from("fee_schedules").select("*").eq("active", true),
        supabase.from("sms_inbox").select("id", { count: "exact", head: true }).eq("match_status", "needs_review"),
      ]);

      const income: IncomeEntry[] = incomeRes.data ?? [];
      const expenses: ExpenseEntry[] = expenseRes.data ?? [];
      const students = studentsRes.data ?? [];
      const fees = feesRes.data ?? [];

      const totalIncome = income.reduce((s, r) => s + (r.amount || 0), 0);
      const totalExpenses = expenses.reduce((s, r) => s + (r.amount || 0), 0);
      const netBalance = totalIncome - totalExpenses;
      const unreconciledIncome = income.filter(r => !r.reconciled).length;
      const unreconciledExpenses = expenses.filter(r => !r.reconciled).length;

      // Income by category
      const incByCat: Record<string, number> = {};
      income.forEach(r => { incByCat[r.category] = (incByCat[r.category] || 0) + r.amount; });
      const incomeByCategory = Object.entries(incByCat).map(([name, value]) => ({ name, value }));

      // Expense by category
      const expByCat: Record<string, number> = {};
      expenses.forEach(r => { expByCat[r.category] = (expByCat[r.category] || 0) + r.amount; });
      const expenseByCategory = Object.entries(expByCat).map(([name, value]) => ({ name, value }));

      // Monthly cash flow (last 6 months)
      const monthlyMap: Record<string, { income: number; expenses: number }> = {};
      const now = new Date();
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = d.toLocaleDateString("en-NG", { month: "short", year: "2-digit" });
        monthlyMap[key] = { income: 0, expenses: 0 };
      }
      income.forEach(r => {
        const d = new Date(r.date);
        const key = d.toLocaleDateString("en-NG", { month: "short", year: "2-digit" });
        if (monthlyMap[key]) monthlyMap[key].income += r.amount;
      });
      expenses.forEach(r => {
        const d = new Date(r.date);
        const key = d.toLocaleDateString("en-NG", { month: "short", year: "2-digit" });
        if (monthlyMap[key]) monthlyMap[key].expenses += r.amount;
      });
      const monthlyCashFlow = Object.entries(monthlyMap).map(([month, vals]) => ({ month, ...vals }));

      // Student balances
      const paidByStudent: Record<string, number> = {};
      income.forEach(r => {
        if (r.student_id) paidByStudent[r.student_id] = (paidByStudent[r.student_id] || 0) + r.amount;
      });

      const studentBalances: StudentWithBalance[] = students.map(s => {
        const totalDue = fees
          .filter(f => !f.grade || f.grade === s.grade)
          .reduce((sum, f) => sum + (f.amount || 0), 0);
        const totalPaid = paidByStudent[s.id] || 0;
        const balance = totalDue - totalPaid;
        const payment_status = balance <= 0 ? "paid" : totalPaid > 0 ? "partial" : "unpaid";
        return { ...s, total_due: totalDue, total_paid: totalPaid, balance, payment_status };
      });

      const outstandingFees = studentBalances
        .filter(s => s.balance > 0)
        .reduce((sum, s) => sum + s.balance, 0);

      setData({
        totalIncome, totalExpenses, netBalance, outstandingFees,
        unreconciledIncome, unreconciledExpenses,
        incomeByCategory, expenseByCategory, monthlyCashFlow,
        studentBalances: studentBalances.sort((a, b) => b.balance - a.balance),
        recentIncome: income.slice(0, 5),
        smsAlertsNeedReview: smsRes.count ?? 0,
      });
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="p-6"><LoadingSpinner /></div>;
  if (!data) return null;

  const { totalIncome, totalExpenses, netBalance, outstandingFees,
    unreconciledIncome, unreconciledExpenses, incomeByCategory,
    expenseByCategory, monthlyCashFlow, studentBalances, recentIncome, smsAlertsNeedReview } = data;

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Dashboard"
        subtitle="Every figure below is live from your ledgers."
      >
        <button onClick={load} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-lg hover:bg-white border border-transparent hover:border-gray-200 transition-all">
          <RefreshCw size={14} />
          Refresh
        </button>
      </PageHeader>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Total Income"
          value={fmtMoney(totalIncome)}
          icon={<TrendingUp size={18} className="text-green-500" />}
          sub={`${(data.recentIncome.length)} receipts`}
          colorClass="text-green-700"
        />
        <KpiCard
          label="Total Expenses"
          value={fmtMoney(totalExpenses)}
          icon={<TrendingDown size={18} className="text-red-500" />}
          colorClass="text-red-700"
        />
        <KpiCard
          label="Net Position"
          value={fmtMoney(netBalance)}
          icon={<Scale size={18} className="text-[#C9A227]" />}
          sub="Income less expenses"
          colorClass={netBalance >= 0 ? "text-[#0F2A47]" : "text-red-700"}
        />
        <KpiCard
          label="Outstanding Fees"
          value={fmtMoney(outstandingFees)}
          icon={<AlertTriangle size={18} className="text-amber-500" />}
          sub={`${unreconciledIncome + unreconciledExpenses} entries unreconciled`}
          colorClass="text-amber-700"
        />
      </div>

      {/* SMS Alert banner */}
      {smsAlertsNeedReview > 0 && (
        <Link href="/dashboard/sms-alerts"
          className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl hover:bg-amber-100 transition-colors">
          <AlertTriangle size={18} className="text-amber-600 shrink-0" />
          <span className="text-sm font-medium text-amber-800">
            {smsAlertsNeedReview} SMS payment {smsAlertsNeedReview === 1 ? "alert needs" : "alerts need"} review
          </span>
          <span className="ml-auto text-amber-600 text-sm font-medium">Review →</span>
        </Link>
      )}

      {/* Charts row */}
      <div className="grid lg:grid-cols-5 gap-4">
        {/* Cash flow chart - wider */}
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Cash flow by month</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={monthlyCashFlow} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="incomeGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0F2A47" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#0F2A47" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="expenseGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#EF4444" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#EF4444" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F0" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#9CA3AF" }} />
                <YAxis tick={{ fontSize: 11, fill: "#9CA3AF" }} tickFormatter={v => `₦${(v/1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => fmtMoney(v)} />
                <Area type="monotone" dataKey="income" stroke="#0F2A47" fill="url(#incomeGrad)" strokeWidth={2} name="Income" />
                <Area type="monotone" dataKey="expenses" stroke="#EF4444" fill="url(#expenseGrad)" strokeWidth={2} name="Expenses" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Fee balances */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Fee balances</CardTitle>
            <Link href="/dashboard/students" className="text-xs text-[#0F2A47] hover:underline font-medium">
              All students
            </Link>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            {studentBalances.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">No students yet</p>
            ) : (
              studentBalances.slice(0, 6).map(s => (
                <Link key={s.id} href={`/dashboard/students/${s.id}`}
                  className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0 hover:bg-gray-50 -mx-2 px-2 rounded-lg transition-colors">
                  <div>
                    <div className="text-sm font-medium text-gray-900">{s.full_name}</div>
                    <div className="text-xs text-gray-400">{s.grade || "—"}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold text-gray-900">{fmtMoney(s.balance)}</div>
                    <StatusBadge status={s.payment_status} />
                  </div>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Category charts */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Income by Category</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {incomeByCategory.length === 0 ? (
              <p className="text-sm text-gray-400 py-8 text-center">No income recorded yet</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={incomeByCategory} cx="40%" cy="50%" innerRadius={55} outerRadius={90}
                    dataKey="value" nameKey="name" paddingAngle={3}>
                    {incomeByCategory.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => fmtMoney(v)} />
                  <Legend iconType="circle" iconSize={8} formatter={(value) => (
                    <span className="text-xs text-gray-600">{value}</span>
                  )} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Expenses by Category</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {expenseByCategory.length === 0 ? (
              <p className="text-sm text-gray-400 py-8 text-center">No expenses recorded yet</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={expenseByCategory} layout="vertical" margin={{ left: 80, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#F0F0F0" />
                  <XAxis type="number" tick={{ fontSize: 10, fill: "#9CA3AF" }}
                    tickFormatter={v => `₦${(v/1000).toFixed(0)}k`} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "#4B5563" }} width={80} />
                  <Tooltip formatter={(v: number) => fmtMoney(v)} />
                  <Bar dataKey="value" fill="#C9A227" radius={[0, 4, 4, 0]} name="Amount" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent payments */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Recent Income</CardTitle>
          <Link href="/dashboard/income" className="text-xs text-[#0F2A47] hover:underline font-medium">
            View all →
          </Link>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#0F2A47] text-white">
                <th className="text-left px-4 py-3 text-xs font-semibold">Receipt</th>
                <th className="text-left px-4 py-3 text-xs font-semibold">Date</th>
                <th className="text-left px-4 py-3 text-xs font-semibold">Student</th>
                <th className="text-left px-4 py-3 text-xs font-semibold">Category</th>
                <th className="text-right px-4 py-3 text-xs font-semibold">Amount</th>
                <th className="text-left px-4 py-3 text-xs font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {recentIncome.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-8 text-gray-400">No payments yet</td></tr>
              ) : (
                recentIncome.map(r => (
                  <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-[#0F2A47] font-semibold">{r.receipt_no}</td>
                    <td className="px-4 py-3 text-gray-600">{fmtDate(r.date)}</td>
                    <td className="px-4 py-3">{r.student_name || "—"}</td>
                    <td className="px-4 py-3 text-gray-600">{r.category}</td>
                    <td className="px-4 py-3 text-right font-semibold">{fmtMoney(r.amount)}</td>
                    <td className="px-4 py-3">
                      <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium",
                        r.reconciled ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600")}>
                        {r.reconciled ? "Reconciled" : "Unreconciled"}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
