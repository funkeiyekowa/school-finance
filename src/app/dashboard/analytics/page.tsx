"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { fmtMoney, cn } from "@/lib/utils";
import { PageHeader, KpiCard, LoadingSpinner, EmptyState } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { TrendingUp, TrendingDown, Users, GraduationCap, Award, DollarSign, ChevronDown, ChevronRight, BarChart3, PieChart as PieIcon, Activity, Clock, BookOpen, FileBarChart } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, BarChart, Bar, PieChart, Pie, Cell, Legend, AreaChart, Area } from "recharts";

interface Student { id: string; full_name: string; grade: string | null; status: string; gender: string | null; }
interface Income { id: string; date: string; amount: number; category: string; student_name: string | null; }
interface Expense { id: string; date: string; amount: number; category: string; description: string | null; }
interface Attendance { id: string; student_id: string; date: string; status_code: string; }
interface AssessmentScore { id: string; student_id: string; subject_name: string; ca1_score: number | null; ca2_score: number | null; exam_score: number | null; }

const COLORS = ["#C9A227", "#0F2A47", "#22c55e", "#3b82f6", "#f59e0b", "#a855f7", "#ec4899", "#14b8a6"];

export default function AnalyticsPage() {
  const { orgId } = useAuth();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [students, setStudents] = useState<Student[]>([]);
  const [incomes, setIncomes] = useState<Income[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [scores, setScores] = useState<AssessmentScore[]>([]);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [drillDown, setDrillDown] = useState<{ type: string; value: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const yearAgo = new Date();
    yearAgo.setFullYear(yearAgo.getFullYear() - 1);
    const dateStr = yearAgo.toISOString().split("T")[0];
    const [st, inc, exp, at, sc] = await Promise.all([
      supabase.from("students").select("id, full_name, grade, status, gender"),
      supabase.from("income_entries").select("id, date, amount, category, student_name").gte("date", dateStr),
      supabase.from("expense_entries").select("id, date, amount, category, description").gte("date", dateStr),
      supabase.from("attendance_records").select("id, student_id, date, status_code").gte("date", dateStr),
      supabase.from("assessment_scores").select("id, student_id, subject_name, ca1_score, ca2_score, exam_score"),
    ]);
    setStudents((st.data ?? []) as Student[]);
    setIncomes((inc.data ?? []) as Income[]);
    setExpenses((exp.data ?? []) as Expense[]);
    setAttendance((at.data ?? []) as Attendance[]);
    setScores((sc.data ?? []) as AssessmentScore[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const kpis = useMemo(() => {
    const totalRev = incomes.reduce((s, i) => s + Number(i.amount), 0);
    const totalExp = expenses.reduce((s, i) => s + Number(i.amount), 0);
    const active = students.filter(s => s.status === "active").length;
    const present = attendance.filter(a => a.status_code === "P" || a.status_code === "present").length;
    return {
      revenue: totalRev,
      expenses: totalExp,
      net: totalRev - totalExp,
      students: active,
      attendance: attendance.length > 0 ? Math.round((present / attendance.length) * 100) : 0,
    };
  }, [incomes, expenses, students, attendance]);

  const monthlyFinance = useMemo(() => {
    const map = new Map<string, { month: string; income: number; expense: number; net: number }>();
    incomes.forEach(i => {
      const k = i.date.substring(0, 7);
      const cur = map.get(k) || { month: k, income: 0, expense: 0, net: 0 };
      cur.income += Number(i.amount);
      cur.net = cur.income - cur.expense;
      map.set(k, cur);
    });
    expenses.forEach(e => {
      const k = e.date.substring(0, 7);
      const cur = map.get(k) || { month: k, income: 0, expense: 0, net: 0 };
      cur.expense += Number(e.amount);
      cur.net = cur.income - cur.expense;
      map.set(k, cur);
    });
    return Array.from(map.values()).sort((a, b) => a.month.localeCompare(b.month));
  }, [incomes, expenses]);

  const studentsByGrade = useMemo(() => {
    const map = new Map<string, number>();
    students.filter(s => s.status === "active").forEach(s => {
      const g = s.grade || "Unassigned";
      map.set(g, (map.get(g) || 0) + 1);
    });
    return Array.from(map.entries()).map(([grade, count]) => ({ grade, count })).sort((a, b) => a.grade.localeCompare(b.grade));
  }, [students]);

  const genderData = useMemo(() => {
    const active = students.filter(s => s.status === "active");
    const male = active.filter(s => s.gender === "male" || s.gender === "M").length;
    const female = active.filter(s => s.gender === "female" || s.gender === "F").length;
    return [{ name: "Male", value: male }, { name: "Female", value: female }];
  }, [students]);

  const incomeCategoryData = useMemo(() => {
    const map = new Map<string, number>();
    incomes.forEach(i => map.set(i.category, (map.get(i.category) || 0) + Number(i.amount)));
    return Array.from(map.entries()).map(([name, value]) => ({ name, value }));
  }, [incomes]);

  const expenseCategoryData = useMemo(() => {
    const map = new Map<string, number>();
    expenses.forEach(e => map.set(e.category, (map.get(e.category) || 0) + Number(e.amount)));
    return Array.from(map.entries()).map(([name, value]) => ({ name, value }));
  }, [expenses]);

  const attendanceMonthly = useMemo(() => {
    const map = new Map<string, { month: string; present: number; total: number }>();
    attendance.forEach(a => {
      const k = a.date.substring(0, 7);
      const cur = map.get(k) || { month: k, present: 0, total: 0 };
      cur.total += 1;
      if (a.status_code === "P" || a.status_code === "present") cur.present += 1;
      map.set(k, cur);
    });
    return Array.from(map.values()).sort((a, b) => a.month.localeCompare(b.month))
      .map(x => ({ month: x.month, rate: x.total > 0 ? Math.round((x.present / x.total) * 100) : 0 }));
  }, [attendance]);

  const subjectPerformance = useMemo(() => {
    const map = new Map<string, { subject: string; total: number; count: number }>();
    scores.forEach(s => {
      const total = (s.ca1_score || 0) + (s.ca2_score || 0) + (s.exam_score || 0);
      const cur = map.get(s.subject_name) || { subject: s.subject_name, total: 0, count: 0 };
      cur.total += total;
      cur.count += 1;
      map.set(s.subject_name, cur);
    });
    return Array.from(map.values()).map(x => ({ subject: x.subject, avg: x.count > 0 ? Math.round(x.total / x.count) : 0 })).sort((a, b) => b.avg - a.avg);
  }, [scores]);

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics"
        subtitle="Whole-application performance snapshot — click any chart section to drill down"
      />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <KpiCard label="Active Students" value={String(kpis.students)} icon={<GraduationCap size={18} />} colorClass="text-blue-700" />
        <KpiCard label="Total Revenue" value={fmtMoney(kpis.revenue)} icon={<TrendingUp size={18} />} colorClass="text-green-700" />
        <KpiCard label="Total Expenses" value={fmtMoney(kpis.expenses)} icon={<TrendingDown size={18} />} colorClass="text-red-700" />
        <KpiCard label="Net Position" value={fmtMoney(kpis.net)} icon={<DollarSign size={18} />} colorClass={kpis.net >= 0 ? "text-green-700" : "text-red-700"} />
        <KpiCard label="Attendance Rate" value={`${kpis.attendance}%`} icon={<Clock size={18} />} colorClass="text-[#C9A227]" />
      </div>

      {/* Financial Trend */}
      <ExpandableCard title="Financial Trend (Last 12 Months)" icon={<TrendingUp size={16} />} sectionKey="finance-trend" expanded={expandedSection} setExpanded={setExpandedSection}>
        <ResponsiveContainer width="100%" height={340}>
          <AreaChart data={monthlyFinance}>
            <defs>
              <linearGradient id="colorInc" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#22c55e" stopOpacity={0.7} />
                <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="colorExp" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#ef4444" stopOpacity={0.7} />
                <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="month" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip formatter={(v: number) => fmtMoney(v)} />
            <Legend />
            <Area type="monotone" dataKey="income" stroke="#22c55e" fillOpacity={1} fill="url(#colorInc)" name="Income" />
            <Area type="monotone" dataKey="expense" stroke="#ef4444" fillOpacity={1} fill="url(#colorExp)" name="Expenses" />
            <Line type="monotone" dataKey="net" stroke="#0F2A47" strokeWidth={2.5} name="Net" dot={{ r: 3 }} />
          </AreaChart>
        </ResponsiveContainer>
        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="p-3 bg-green-50 rounded-lg">
            <div className="text-xs text-green-700 font-semibold">Best Month</div>
            <div className="text-lg font-bold text-green-800">
              {monthlyFinance.reduce((best, m) => m.net > best.net ? m : best, monthlyFinance[0])?.month || "—"}
            </div>
          </div>
          <div className="p-3 bg-blue-50 rounded-lg">
            <div className="text-xs text-blue-700 font-semibold">Avg Monthly Revenue</div>
            <div className="text-lg font-bold text-blue-800">
              {fmtMoney(monthlyFinance.length > 0 ? kpis.revenue / monthlyFinance.length : 0)}
            </div>
          </div>
          <div className="p-3 bg-amber-50 rounded-lg">
            <div className="text-xs text-amber-700 font-semibold">Profit Margin</div>
            <div className="text-lg font-bold text-amber-800">
              {kpis.revenue > 0 ? Math.round((kpis.net / kpis.revenue) * 100) : 0}%
            </div>
          </div>
        </div>
      </ExpandableCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Enrollment by grade */}
        <ExpandableCard title="Enrollment by Grade" icon={<GraduationCap size={16} />} sectionKey="enrollment" expanded={expandedSection} setExpanded={setExpandedSection}>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={studentsByGrade} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis type="number" tick={{ fontSize: 12 }} />
              <YAxis dataKey="grade" type="category" tick={{ fontSize: 12 }} width={80} />
              <Tooltip />
              <Bar dataKey="count" fill="#C9A227" radius={[0, 6, 6, 0]} style={{ cursor: "pointer" }} onClick={(d) => { const g = (d as unknown as { payload?: { grade?: string } }).payload?.grade; if (g) setDrillDown({ type: "grade", value: g }); }} />
            </BarChart>
          </ResponsiveContainer>
          {drillDown?.type === "grade" && (
            <DrilldownList
              title={`Students in ${drillDown.value}`}
              onClose={() => setDrillDown(null)}
              items={students.filter(s => s.grade === drillDown.value && s.status === "active").map(s => ({ id: s.id, name: s.full_name, detail: s.grade || "" }))}
            />
          )}
        </ExpandableCard>

        {/* Gender split */}
        <ExpandableCard title="Gender Distribution" icon={<Users size={16} />} sectionKey="gender" expanded={expandedSection} setExpanded={setExpandedSection}>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={genderData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label
                onClick={(d) => setDrillDown({ type: "gender", value: (d as { name: string }).name })}>
                {genderData.map((_, i) => <Cell key={i} fill={COLORS[i]} style={{ cursor: "pointer" }} />)}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
          {drillDown?.type === "gender" && (
            <DrilldownList
              title={`${drillDown.value} Students`}
              onClose={() => setDrillDown(null)}
              items={students.filter(s => {
                const g = s.gender;
                return s.status === "active" && ((drillDown.value === "Male" && (g === "male" || g === "M")) || (drillDown.value === "Female" && (g === "female" || g === "F")));
              }).map(s => ({ id: s.id, name: s.full_name, detail: s.grade || "" }))}
            />
          )}
        </ExpandableCard>

        {/* Income by category */}
        <ExpandableCard title="Income Categories" icon={<PieIcon size={16} />} sectionKey="income-cat" expanded={expandedSection} setExpanded={setExpandedSection}>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={incomeCategoryData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={(d) => `${(d as { name: string }).name}`}
                onClick={(d) => setDrillDown({ type: "income-cat", value: (d as { name: string }).name })}>
                {incomeCategoryData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} style={{ cursor: "pointer" }} />)}
              </Pie>
              <Tooltip formatter={(v: number) => fmtMoney(v)} />
            </PieChart>
          </ResponsiveContainer>
          {drillDown?.type === "income-cat" && (
            <DrilldownList
              title={`${drillDown.value} — Transactions`}
              onClose={() => setDrillDown(null)}
              items={incomes.filter(i => i.category === drillDown.value).slice(0, 20).map(i => ({
                id: i.id, name: i.student_name || i.category, detail: `${i.date} · ${fmtMoney(Number(i.amount))}`
              }))}
            />
          )}
        </ExpandableCard>

        {/* Expense by category */}
        <ExpandableCard title="Expense Categories" icon={<TrendingDown size={16} />} sectionKey="expense-cat" expanded={expandedSection} setExpanded={setExpandedSection}>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={expenseCategoryData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip formatter={(v: number) => fmtMoney(v)} />
              <Bar dataKey="value" fill="#ef4444" radius={[6, 6, 0, 0]} style={{ cursor: "pointer" }}
                onClick={(d) => setDrillDown({ type: "expense-cat", value: (d as { name: string }).name })} />
            </BarChart>
          </ResponsiveContainer>
          {drillDown?.type === "expense-cat" && (
            <DrilldownList
              title={`${drillDown.value} — Transactions`}
              onClose={() => setDrillDown(null)}
              items={expenses.filter(e => e.category === drillDown.value).slice(0, 20).map(e => ({
                id: e.id, name: e.description || e.category, detail: `${e.date} · ${fmtMoney(Number(e.amount))}`
              }))}
            />
          )}
        </ExpandableCard>
      </div>

      <ExpandableCard title="Attendance Trend (Last 12 Months)" icon={<Clock size={16} />} sectionKey="attend" expanded={expandedSection} setExpanded={setExpandedSection}>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={attendanceMonthly}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="month" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} domain={[0, 100]} />
            <Tooltip formatter={(v: number) => `${v}%`} />
            <Line type="monotone" dataKey="rate" stroke="#C9A227" strokeWidth={2.5} name="Attendance %" dot={{ r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      </ExpandableCard>

      <ExpandableCard title="Subject Performance" icon={<Award size={16} />} sectionKey="subj" expanded={expandedSection} setExpanded={setExpandedSection}>
        {subjectPerformance.length === 0 ? (
          <EmptyState message="No assessment data yet" icon={<Award />} />
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(280, subjectPerformance.length * 30)}>
            <BarChart data={subjectPerformance} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 12 }} />
              <YAxis dataKey="subject" type="category" tick={{ fontSize: 12 }} width={100} />
              <Tooltip formatter={(v: number) => `${v}%`} />
              <Bar dataKey="avg" fill="#0F2A47" radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ExpandableCard>
    </div>
  );
}

function ExpandableCard({ title, icon, sectionKey, expanded, setExpanded, children }: {
  title: string; icon: React.ReactNode; sectionKey: string;
  expanded: string | null; setExpanded: (s: string | null) => void;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between cursor-pointer" onClick={() => setExpanded(expanded === sectionKey ? null : sectionKey)}>
          <CardTitle className="flex items-center gap-2">{icon} {title}</CardTitle>
          {expanded === sectionKey ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function DrilldownList({ title, items, onClose }: { title: string; items: { id: string; name: string; detail: string }[]; onClose: () => void }) {
  return (
    <div className="mt-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-semibold text-gray-800">{title}</h4>
        <button onClick={onClose} className="text-xs text-gray-500 hover:text-gray-700">Close</button>
      </div>
      <div className="max-h-64 overflow-y-auto space-y-1">
        {items.length === 0 ? (
          <p className="text-xs text-gray-400 py-4 text-center">No records</p>
        ) : (
          items.map(item => (
            <div key={item.id} className="flex items-center justify-between p-2 bg-white rounded text-sm">
              <span className="font-medium text-gray-800">{item.name}</span>
              <span className="text-xs text-gray-500">{item.detail}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
