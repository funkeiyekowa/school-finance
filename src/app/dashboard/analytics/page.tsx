"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { fmtMoney, cn } from "@/lib/utils";
import { PageHeader, LoadingSpinner } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { TrendingUp, TrendingDown, Users, GraduationCap, DollarSign, CheckCircle2, AlertTriangle, BarChart3 } from "lucide-react";

interface KPI { label: string; value: string | number; change?: string; trend?: "up" | "down" | "neutral"; icon: React.ReactNode; }

export default function AnalyticsPage() {
  const { profile } = useAuth();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);

  // Data
  const [totalStudents, setTotalStudents] = useState(0);
  const [activeStudents, setActiveStudents] = useState(0);
  const [totalIncome, setTotalIncome] = useState(0);
  const [totalExpenses, setTotalExpenses] = useState(0);
  const [totalFeesDue, setTotalFeesDue] = useState(0);
  const [totalPaid, setTotalPaid] = useState(0);
  const [attendanceRate, setAttendanceRate] = useState(0);
  const [examAverage, setExamAverage] = useState(0);
  const [staffCount, setStaffCount] = useState(0);
  const [monthlyIncome, setMonthlyIncome] = useState<{ month: string; amount: number }[]>([]);
  const [topClasses, setTopClasses] = useState<{ name: string; count: number }[]>([]);

  const load = useCallback(async () => {
    const [stuRes, incRes, expRes, feeRes, attRes, scoreRes, staffRes] = await Promise.all([
      supabase.from("students").select("id, status, grade"),
      supabase.from("income_entries").select("amount, date"),
      supabase.from("expense_entries").select("amount"),
      supabase.from("fee_schedules").select("amount").eq("active", true),
      supabase.from("attendance_records").select("status_code"),
      supabase.from("exam_attempts").select("percentage").eq("status", "submitted"),
      supabase.from("staff_members").select("id").eq("status", "active"),
    ]);

    const students = stuRes.data ?? [];
    const active = students.filter((s: { status: string }) => s.status === "active");
    setTotalStudents(students.length);
    setActiveStudents(active.length);

    const income = (incRes.data ?? []) as { amount: number; date: string }[];
    setTotalIncome(income.reduce((s, r) => s + r.amount, 0));
    setTotalExpenses((expRes.data ?? []).reduce((s: number, r: { amount: number }) => s + r.amount, 0));

    const fees = (feeRes.data ?? []) as { amount: number }[];
    setTotalFeesDue(fees.reduce((s, f) => s + f.amount, 0) * active.length);
    setTotalPaid(income.reduce((s, r) => s + r.amount, 0));

    // Attendance rate
    const attRecords = (attRes.data ?? []) as { status_code: string }[];
    const present = attRecords.filter(a => a.status_code === "present" || a.status_code === "late").length;
    setAttendanceRate(attRecords.length > 0 ? Math.round((present / attRecords.length) * 100) : 0);

    // Exam average
    const scores = (scoreRes.data ?? []) as { percentage: number | null }[];
    const validScores = scores.filter(s => s.percentage != null).map(s => s.percentage!);
    setExamAverage(validScores.length > 0 ? Math.round(validScores.reduce((s, v) => s + v, 0) / validScores.length) : 0);

    setStaffCount((staffRes.data ?? []).length);

    // Monthly income (last 6 months)
    const months: Record<string, number> = {};
    for (const entry of income) {
      const month = entry.date.substring(0, 7); // YYYY-MM
      months[month] = (months[month] || 0) + entry.amount;
    }
    const sortedMonths = Object.entries(months).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 6).reverse();
    setMonthlyIncome(sortedMonths.map(([month, amount]) => ({ month, amount })));

    // Top classes by enrollment
    const classCounts: Record<string, number> = {};
    for (const s of active) {
      const g = (s as { grade: string | null }).grade || "Unassigned";
      classCounts[g] = (classCounts[g] || 0) + 1;
    }
    setTopClasses(Object.entries(classCounts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => ({ name, count })));

    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="p-6"><LoadingSpinner /></div>;

  const collectionRate = totalFeesDue > 0 ? Math.round((totalPaid / totalFeesDue) * 100) : 0;
  const netBalance = totalIncome - totalExpenses;
  const outstanding = Math.max(0, totalFeesDue - totalPaid);

  const kpis: KPI[] = [
    { label: "Active Students", value: activeStudents, icon: <GraduationCap size={20} className="text-blue-600" />, trend: "up" },
    { label: "Total Revenue", value: fmtMoney(totalIncome), icon: <TrendingUp size={20} className="text-green-600" />, trend: "up" },
    { label: "Total Expenses", value: fmtMoney(totalExpenses), icon: <TrendingDown size={20} className="text-red-600" />, trend: "neutral" },
    { label: "Net Balance", value: fmtMoney(netBalance), icon: <DollarSign size={20} className="text-[#0F2A47]" />, trend: netBalance >= 0 ? "up" : "down" },
    { label: "Fee Collection", value: `${collectionRate}%`, icon: <CheckCircle2 size={20} className="text-green-600" />, trend: collectionRate >= 70 ? "up" : "down" },
    { label: "Outstanding", value: fmtMoney(outstanding), icon: <AlertTriangle size={20} className="text-amber-600" />, trend: outstanding > 0 ? "down" : "up" },
    { label: "Attendance Rate", value: `${attendanceRate}%`, icon: <Users size={20} className="text-purple-600" />, trend: attendanceRate >= 75 ? "up" : "down" },
    { label: "Exam Average", value: `${examAverage}%`, icon: <BarChart3 size={20} className="text-[#C9A227]" />, trend: examAverage >= 50 ? "up" : "down" },
  ];

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="Analytics" subtitle={`School performance overview — ${profile?.full_name || ""}`} />

      {/* KPI Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {kpis.map(kpi => (
          <Card key={kpi.label}>
            <CardContent className="py-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-xs text-gray-500 mb-1">{kpi.label}</div>
                  <div className="text-xl font-bold text-[#0F2A47]">{kpi.value}</div>
                </div>
                <div className={cn("p-2 rounded-lg", kpi.trend === "up" ? "bg-green-50" : kpi.trend === "down" ? "bg-red-50" : "bg-gray-50")}>
                  {kpi.icon}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        {/* Monthly Revenue Chart (bar visualization) */}
        <Card>
          <CardHeader><CardTitle>Monthly Revenue</CardTitle></CardHeader>
          <CardContent>
            {monthlyIncome.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">No income data available.</p>
            ) : (
              <div className="space-y-2">
                {monthlyIncome.map(m => {
                  const max = Math.max(...monthlyIncome.map(x => x.amount), 1);
                  const pct = Math.round((m.amount / max) * 100);
                  return (
                    <div key={m.month} className="flex items-center gap-3">
                      <span className="text-xs text-gray-500 w-16 shrink-0">{m.month}</span>
                      <div className="flex-1 h-6 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-[#C9A227] rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs font-semibold text-[#0F2A47] w-20 text-right">{fmtMoney(m.amount)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Class Enrollment Distribution */}
        <Card>
          <CardHeader><CardTitle>Enrollment by Class</CardTitle></CardHeader>
          <CardContent>
            {topClasses.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">No enrollment data.</p>
            ) : (
              <div className="space-y-2">
                {topClasses.map(c => {
                  const max = Math.max(...topClasses.map(x => x.count), 1);
                  const pct = Math.round((c.count / max) * 100);
                  return (
                    <div key={c.name} className="flex items-center gap-3">
                      <span className="text-xs text-gray-600 w-20 shrink-0 truncate font-medium">{c.name}</span>
                      <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs font-bold text-[#0F2A47] w-8 text-right">{c.count}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick Insights */}
      <Card>
        <CardHeader><CardTitle>Quick Insights</CardTitle></CardHeader>
        <CardContent>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div className="p-3 rounded-lg border bg-green-50 border-green-200">
              <div className="text-xs font-semibold text-green-700 mb-1">Revenue Health</div>
              <p className="text-sm text-green-800">
                {collectionRate >= 80 ? "Excellent collection rate. " : collectionRate >= 50 ? "Moderate collection. Consider follow-ups. " : "Low collection rate. Action needed. "}
                {fmtMoney(outstanding)} outstanding across {activeStudents} students.
              </p>
            </div>
            <div className={cn("p-3 rounded-lg border", attendanceRate >= 75 ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-200")}>
              <div className={cn("text-xs font-semibold mb-1", attendanceRate >= 75 ? "text-green-700" : "text-amber-700")}>Attendance</div>
              <p className={cn("text-sm", attendanceRate >= 75 ? "text-green-800" : "text-amber-800")}>
                {attendanceRate >= 90 ? "Excellent attendance across the school." : attendanceRate >= 75 ? "Good attendance. Minor improvements possible." : "Attendance below target. Review absentee patterns."}
              </p>
            </div>
            <div className={cn("p-3 rounded-lg border", examAverage >= 60 ? "bg-blue-50 border-blue-200" : "bg-amber-50 border-amber-200")}>
              <div className={cn("text-xs font-semibold mb-1", examAverage >= 60 ? "text-blue-700" : "text-amber-700")}>Academic Performance</div>
              <p className={cn("text-sm", examAverage >= 60 ? "text-blue-800" : "text-amber-800")}>
                {examAverage >= 70 ? "Strong academic performance." : examAverage >= 50 ? "Average performance. Identify weak areas." : examAverage > 0 ? "Below average. Academic intervention recommended." : "No exam data yet."}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Stats */}
      <Card>
        <CardHeader><CardTitle>School Summary</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
            <div><div className="text-2xl font-bold text-[#0F2A47]">{totalStudents}</div><div className="text-xs text-gray-500">Total Students</div></div>
            <div><div className="text-2xl font-bold text-[#0F2A47]">{staffCount}</div><div className="text-xs text-gray-500">Active Staff</div></div>
            <div><div className="text-2xl font-bold text-[#0F2A47]">{topClasses.length}</div><div className="text-xs text-gray-500">Classes</div></div>
            <div><div className="text-2xl font-bold text-[#0F2A47]">{collectionRate}%</div><div className="text-xs text-gray-500">Collection Rate</div></div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
