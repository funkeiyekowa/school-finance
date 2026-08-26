"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { fmtMoney } from "@/lib/utils";
import { PageHeader, KpiCard, LoadingSpinner } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { TrendingUp, TrendingDown, Receipt, ArrowLeftRight, Wallet, ArrowRight, MessageSquare } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, BarChart, Bar, Legend } from "recharts";

interface Income { id: string; date: string; amount: number; category: string; }
interface Expense { id: string; date: string; amount: number; category: string; }

export default function FinanceDashboardPage() {
  const { orgId } = useAuth();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [incomes, setIncomes] = useState<Income[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const dateStr = sixMonthsAgo.toISOString().split("T")[0];
    const [inc, exp] = await Promise.all([
      supabase.from("income_entries").select("id, date, amount, category").gte("date", dateStr),
      supabase.from("expense_entries").select("id, date, amount, category").gte("date", dateStr),
    ]);
    setIncomes((inc.data ?? []) as Income[]);
    setExpenses((exp.data ?? []) as Expense[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const totals = useMemo(() => {
    const income = incomes.reduce((s, i) => s + Number(i.amount), 0);
    const expense = expenses.reduce((s, e) => s + Number(e.amount), 0);
    return { income, expense, net: income - expense };
  }, [incomes, expenses]);

  const monthlyData = useMemo(() => {
    const monthKey = (d: string) => d.substring(0, 7);
    const map = new Map<string, { month: string; income: number; expense: number }>();
    incomes.forEach(i => {
      const k = monthKey(i.date);
      const cur = map.get(k) || { month: k, income: 0, expense: 0 };
      cur.income += Number(i.amount);
      map.set(k, cur);
    });
    expenses.forEach(e => {
      const k = monthKey(e.date);
      const cur = map.get(k) || { month: k, income: 0, expense: 0 };
      cur.expense += Number(e.amount);
      map.set(k, cur);
    });
    return Array.from(map.values()).sort((a, b) => a.month.localeCompare(b.month));
  }, [incomes, expenses]);

  const topCategories = useMemo(() => {
    const map = new Map<string, number>();
    incomes.forEach(i => map.set(i.category, (map.get(i.category) || 0) + Number(i.amount)));
    return Array.from(map.entries()).map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount).slice(0, 5);
  }, [incomes]);

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Finance Dashboard"
        subtitle="Revenue, expenses, cash flow — the last 6 months"
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Total Income" value={fmtMoney(totals.income)} icon={<TrendingUp size={18} />} colorClass="text-green-700" />
        <KpiCard label="Total Expenses" value={fmtMoney(totals.expense)} icon={<TrendingDown size={18} />} colorClass="text-red-700" />
        <KpiCard label="Net Position" value={fmtMoney(totals.net)} icon={<Wallet size={18} />} colorClass={totals.net >= 0 ? "text-green-700" : "text-red-700"} />
        <KpiCard label="Transactions" value={String(incomes.length + expenses.length)} icon={<Receipt size={18} />} colorClass="text-blue-700" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Income vs Expenses (Last 6 Months)</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={monthlyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip formatter={(v: number) => fmtMoney(v)} />
              <Legend />
              <Bar dataKey="income" name="Income" fill="#22c55e" radius={[6, 6, 0, 0]} />
              <Bar dataKey="expense" name="Expenses" fill="#ef4444" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Top Income Categories</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {topCategories.map(c => (
                <div key={c.category} className="flex items-center justify-between p-2 border-b">
                  <span className="text-sm text-gray-700">{c.category}</span>
                  <span className="font-semibold text-green-700">{fmtMoney(c.amount)}</span>
                </div>
              ))}
              {topCategories.length === 0 && <p className="text-gray-400 text-sm text-center py-6">No data yet.</p>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              <QuickAction href="/dashboard/income" label="Income" icon={<TrendingUp size={20} />} />
              <QuickAction href="/dashboard/expenses" label="Expenses" icon={<TrendingDown size={20} />} />
              <QuickAction href="/dashboard/receipts" label="Receipts" icon={<Receipt size={20} />} />
              <QuickAction href="/dashboard/reconciliation" label="Reconcile" icon={<ArrowLeftRight size={20} />} />
              <QuickAction href="/dashboard/student-finance" label="Student Finance" icon={<Wallet size={20} />} />
              <QuickAction href="/dashboard/sms-alerts" label="Payment Alerts" icon={<MessageSquare size={20} />} />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function QuickAction({ href, label, icon }: { href: string; label: string; icon: React.ReactNode }) {
  return (
    <Link href={href} className="group p-4 rounded-xl border border-gray-200 hover:border-[#C9A227] hover:shadow-md transition-all flex flex-col items-start gap-2 bg-white">
      <div className="text-[#C9A227]">{icon}</div>
      <div className="font-semibold text-sm text-gray-800">{label}</div>
      <ArrowRight size={14} className="text-gray-400 group-hover:text-[#C9A227] transition-colors" />
    </Link>
  );
}
