"use client";

/**
 * Printable executive analytics summary.
 *
 * A single-page snapshot for the principal/board — enrolment, finance,
 * attendance, and academics, on the school letterhead. Focused on
 * numbers that lead a conversation, not raw tables.
 */

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { useBranding } from "@/lib/hooks/useBranding";
import { fmtMoney, fmtDate } from "@/lib/utils";
import { LoadingSpinner } from "@/components/ui/PageHeader";
import { PrintableLetterhead, PrintableFooter } from "@/components/print/PrintableLetterhead";
import { Printer } from "lucide-react";

export default function AnalyticsPrintPage() {
  const supabase = useMemo(() => createClient(), []);
  const { orgId } = useAuth();
  const branding = useBranding();

  const [loading, setLoading] = useState(true);
  const [enrol, setEnrol] = useState({ total: 0, boys: 0, girls: 0, byGrade: [] as { grade: string; count: number }[] });
  const [finance, setFinance] = useState({ income: 0, expense: 0, net: 0, monthly: [] as { month: string; income: number; expense: number }[] });
  const [attendance, setAttendance] = useState({ presentPct: 0, sample: 0 });
  const [academics, setAcademics] = useState({ meanPct: 0, distinctions: 0, atRisk: 0 });

  useEffect(() => {
    if (!orgId) return;
    (async () => {
      const yearAgo = new Date(); yearAgo.setFullYear(yearAgo.getFullYear() - 1);
      const dateStr = yearAgo.toISOString().slice(0, 10);
      const [st, inc, exp, at, sc, atypes] = await Promise.all([
        supabase.from("students").select("id, grade, status, gender").eq("status", "active"),
        supabase.from("income_entries").select("date, amount").gte("date", dateStr),
        supabase.from("expense_entries").select("date, amount").gte("date", dateStr),
        supabase.from("attendance_records").select("status_code").gte("date", dateStr),
        supabase.from("student_scores").select("score, assessment_type_id"),
        supabase.from("assessment_types").select("id, max_score"),
      ]);
      const students = (st.data ?? []) as { id: string; grade: string | null; gender: string | null }[];
      const boys = students.filter(s => (s.gender ?? "").toLowerCase() === "male").length;
      const girls = students.filter(s => (s.gender ?? "").toLowerCase() === "female").length;
      const byGradeMap = new Map<string, number>();
      students.forEach(s => byGradeMap.set(s.grade ?? "—", (byGradeMap.get(s.grade ?? "—") ?? 0) + 1));
      const byGrade = Array.from(byGradeMap.entries())
        .map(([grade, count]) => ({ grade, count }))
        .sort((a, b) => a.grade.localeCompare(b.grade));

      const incomes = (inc.data ?? []) as { date: string; amount: number }[];
      const expenses = (exp.data ?? []) as { date: string; amount: number }[];
      const income = incomes.reduce((s, x) => s + Number(x.amount), 0);
      const expense = expenses.reduce((s, x) => s + Number(x.amount), 0);
      const monthMap = new Map<string, { income: number; expense: number }>();
      for (const i of incomes) {
        const k = i.date.slice(0, 7);
        const c = monthMap.get(k) ?? { income: 0, expense: 0 };
        c.income += Number(i.amount);
        monthMap.set(k, c);
      }
      for (const e of expenses) {
        const k = e.date.slice(0, 7);
        const c = monthMap.get(k) ?? { income: 0, expense: 0 };
        c.expense += Number(e.amount);
        monthMap.set(k, c);
      }
      const monthly = Array.from(monthMap.entries())
        .map(([month, v]) => ({ month, ...v }))
        .sort((a, b) => a.month.localeCompare(b.month))
        .slice(-6);

      const attRows = (at.data ?? []) as { status_code: string }[];
      const present = attRows.filter(a => a.status_code === "P" || a.status_code === "present").length;

      const scores = (sc.data ?? []) as { score: number | null; assessment_type_id: string }[];
      const typeMap = new Map(((atypes.data ?? []) as { id: string; max_score: number }[]).map(t => [t.id, t.max_score]));
      const pcts: number[] = [];
      for (const s of scores) {
        if (s.score == null) continue;
        const max = typeMap.get(s.assessment_type_id) ?? 100;
        if (max > 0) pcts.push((s.score / max) * 100);
      }
      const meanPct = pcts.length > 0 ? pcts.reduce((a, b) => a + b, 0) / pcts.length : 0;
      const distinctions = pcts.filter(p => p >= 80).length;
      const atRisk = pcts.filter(p => p < 40).length;

      setEnrol({ total: students.length, boys, girls, byGrade });
      setFinance({ income, expense, net: income - expense, monthly });
      setAttendance({ presentPct: attRows.length > 0 ? Math.round((present / attRows.length) * 100) : 0, sample: attRows.length });
      setAcademics({ meanPct: Math.round(meanPct), distinctions, atRisk });
      setLoading(false);
    })();
  }, [supabase, orgId]);

  if (loading || !branding) return <div className="p-8"><LoadingSpinner /></div>;

  const collectionRate = finance.income + finance.expense > 0 && finance.income > 0
    ? Math.round((finance.income / (finance.income + Math.max(0, -finance.net))) * 100)
    : 0;
  const maxMonthly = Math.max(1, ...finance.monthly.map(m => Math.max(m.income, m.expense)));

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      <div className="no-print sticky top-0 z-10 text-white px-6 py-3 flex items-center justify-between shadow-md" style={{ background: branding.primaryColor }}>
        <div>
          <p className="text-xs uppercase tracking-wider font-bold" style={{ color: branding.accentColor }}>Executive Summary · {branding.schoolName}</p>
          <p className="text-sm font-medium">As at {fmtDate(new Date().toISOString().slice(0, 10))}</p>
        </div>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold hover:opacity-90"
          style={{ background: branding.accentColor, color: branding.primaryColor }}
        >
          <Printer size={14} /> Print / Save as PDF
        </button>
      </div>

      <div className="max-w-4xl mx-auto py-6 print:py-0 print:max-w-full">
        <div className="bg-white shadow-sm rounded-lg p-8 print:shadow-none print:rounded-none">
          <PrintableLetterhead
            branding={branding}
            eyebrow="Executive Summary"
            accent="navy"
            right={
              <div>
                <p className="text-[10px] text-gray-500 uppercase font-bold">Period</p>
                <p className="text-sm font-bold" style={{ color: branding.primaryColor }}>Last 12 months</p>
                <p className="text-[11px] text-gray-500 mt-0.5">Prepared {fmtDate(new Date().toISOString().slice(0, 10))}</p>
              </div>
            }
          />

          {/* KPI grid */}
          <div className="grid grid-cols-4 gap-2 mb-6">
            {[
              { label: "Students", value: enrol.total.toLocaleString(), sub: `${enrol.boys} M · ${enrol.girls} F` },
              { label: "Revenue", value: fmtMoney(finance.income), sub: "Last 12 months" },
              { label: "Net", value: fmtMoney(finance.net), sub: finance.net >= 0 ? "Surplus" : "Deficit" },
              { label: "Attendance", value: `${attendance.presentPct}%`, sub: `${attendance.sample.toLocaleString()} records` },
            ].map(k => (
              <div key={k.label} className="rounded-lg border border-gray-200 p-3 text-center">
                <p className="text-[10px] uppercase font-bold text-gray-500">{k.label}</p>
                <p className="text-lg font-bold mt-0.5" style={{ color: branding.primaryColor }}>{k.value}</p>
                <p className="text-[9px] text-gray-500 mt-0.5">{k.sub}</p>
              </div>
            ))}
          </div>

          {/* Enrolment by grade */}
          <section className="mb-5">
            <h3 className="text-xs uppercase font-bold tracking-wider mb-1" style={{ color: branding.accentColor }}>Enrolment by grade</h3>
            <div className="space-y-1">
              {enrol.byGrade.length === 0 ? (
                <p className="text-xs text-gray-400 italic">No students recorded.</p>
              ) : enrol.byGrade.map(g => {
                const max = Math.max(...enrol.byGrade.map(x => x.count));
                const pct = max > 0 ? (g.count / max) * 100 : 0;
                return (
                  <div key={g.grade} className="flex items-center gap-2 text-xs">
                    <span className="w-24 text-gray-700">{g.grade}</span>
                    <div className="flex-1 h-3 rounded" style={{ background: "#F3F4F6" }}>
                      <div className="h-3 rounded" style={{ width: `${pct}%`, background: branding.primaryColor }}></div>
                    </div>
                    <span className="w-10 text-right font-semibold">{g.count}</span>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Finance trend */}
          <section className="mb-5">
            <h3 className="text-xs uppercase font-bold tracking-wider mb-1" style={{ color: branding.accentColor }}>Finance — last 6 months</h3>
            {finance.monthly.length === 0 ? (
              <p className="text-xs text-gray-400 italic">No financial activity yet.</p>
            ) : (
              <div className="grid grid-cols-6 gap-2">
                {finance.monthly.map(m => (
                  <div key={m.month} className="rounded-lg border border-gray-100 p-2 text-center">
                    <p className="text-[9px] font-mono text-gray-500">{m.month}</p>
                    <div className="mt-1 space-y-0.5">
                      <div className="h-1 rounded" style={{ background: "#10B981", width: `${(m.income / maxMonthly) * 100}%` }}></div>
                      <div className="h-1 rounded" style={{ background: "#EF4444", width: `${(m.expense / maxMonthly) * 100}%` }}></div>
                    </div>
                    <p className="text-[9px] mt-1 font-semibold" style={{ color: (m.income - m.expense) >= 0 ? "#065F46" : "#991B1B" }}>
                      {fmtMoney(m.income - m.expense)}
                    </p>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[10px] text-gray-500 mt-1">
              <span className="inline-block w-2 h-2 rounded-sm mr-1" style={{ background: "#10B981" }}></span> Income
              <span className="inline-block w-2 h-2 rounded-sm mr-1 ml-3" style={{ background: "#EF4444" }}></span> Expense
              <span className="ml-4">Collection rate: <strong>{collectionRate}%</strong></span>
            </p>
          </section>

          {/* Academics + attendance */}
          <section className="grid grid-cols-2 gap-4">
            <div>
              <h3 className="text-xs uppercase font-bold tracking-wider mb-1" style={{ color: branding.accentColor }}>Academics</h3>
              <div className="rounded-lg border border-gray-200 p-3 text-xs space-y-1">
                <div className="flex justify-between"><span className="text-gray-600">Mean score</span><strong style={{ color: branding.primaryColor }}>{academics.meanPct}%</strong></div>
                <div className="flex justify-between"><span className="text-gray-600">Distinctions (≥80%)</span><strong className="text-emerald-700">{academics.distinctions.toLocaleString()}</strong></div>
                <div className="flex justify-between"><span className="text-gray-600">At-risk (&lt;40%)</span><strong className="text-red-700">{academics.atRisk.toLocaleString()}</strong></div>
              </div>
            </div>
            <div>
              <h3 className="text-xs uppercase font-bold tracking-wider mb-1" style={{ color: branding.accentColor }}>Attendance</h3>
              <div className="rounded-lg border border-gray-200 p-3 text-xs space-y-1">
                <div className="flex justify-between"><span className="text-gray-600">Presence rate</span><strong style={{ color: branding.primaryColor }}>{attendance.presentPct}%</strong></div>
                <div className="flex justify-between"><span className="text-gray-600">Records considered</span><strong>{attendance.sample.toLocaleString()}</strong></div>
              </div>
            </div>
          </section>

          <div className="mt-6 grid grid-cols-2 gap-6 text-[10px] text-gray-500">
            <div><p style={{ borderTop: `1px solid ${branding.primaryColor}` }}></p><p className="mt-1">Head of School</p></div>
            <div className="text-right"><p style={{ borderTop: `1px solid ${branding.primaryColor}` }}></p><p className="mt-1">Bursar / Finance</p></div>
          </div>

          <PrintableFooter branding={branding} />
        </div>
      </div>

      <style>{`
        @media print { @page { size: A4; margin: 15mm; } }
      `}</style>
    </div>
  );
}
