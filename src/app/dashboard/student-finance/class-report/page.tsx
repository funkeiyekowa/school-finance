"use client";

/**
 * Printable class-by-class fee collection report.
 *
 * For each grade: total due, total collected, outstanding, and
 * students owing. Filter by year/term via URL params.
 */

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { useBranding } from "@/lib/hooks/useBranding";
import { fmtMoney, fmtDate } from "@/lib/utils";
import { LoadingSpinner } from "@/components/ui/PageHeader";
import { PrintableLetterhead, PrintableFooter } from "@/components/print/PrintableLetterhead";
import { Printer } from "lucide-react";

interface Student { id: string; full_name: string; grade: string | null; }
interface FeeSchedule { amount: number; grade: string | null; }
interface Payment { student_id: string; amount: number; }

export default function ClassFinanceReportPage() {
  return (
    <Suspense fallback={<div className="p-8"><LoadingSpinner /></div>}>
      <Inner />
    </Suspense>
  );
}

function Inner() {
  const params = useSearchParams();
  const supabase = useMemo(() => createClient(), []);
  const { orgId } = useAuth();
  const branding = useBranding();
  const term = params.get("term") ?? "";

  const [students, setStudents] = useState<Student[]>([]);
  const [fees, setFees] = useState<FeeSchedule[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId) return;
    (async () => {
      const [s, f, p] = await Promise.all([
        supabase.from("students").select("id, full_name, grade").eq("status", "active"),
        supabase.from("fee_schedules").select("amount, grade").eq("active", true),
        supabase.from("income_entries").select("student_id, amount"),
      ]);
      setStudents((s.data as Student[]) ?? []);
      setFees((f.data as FeeSchedule[]) ?? []);
      setPayments((p.data as Payment[]) ?? []);
      setLoading(false);
    })();
  }, [supabase, orgId]);

  if (loading || !branding) return <div className="p-8"><LoadingSpinner /></div>;

  const paidBy: Record<string, number> = {};
  payments.forEach(p => { paidBy[p.student_id] = (paidBy[p.student_id] ?? 0) + Number(p.amount); });

  const byGrade = new Map<string, { total_due: number; total_paid: number; count: number; owing: number }>();
  for (const s of students) {
    const g = s.grade ?? "—";
    const due = fees.filter(f => !f.grade || f.grade === s.grade).reduce((sum, f) => sum + Number(f.amount), 0);
    const paid = paidBy[s.id] ?? 0;
    const cur = byGrade.get(g) ?? { total_due: 0, total_paid: 0, count: 0, owing: 0 };
    cur.total_due += due;
    cur.total_paid += paid;
    cur.count += 1;
    if (due - paid > 0) cur.owing += 1;
    byGrade.set(g, cur);
  }
  const rows = Array.from(byGrade.entries())
    .map(([grade, v]) => ({
      grade,
      ...v,
      outstanding: v.total_due - v.total_paid,
      collectionPct: v.total_due > 0 ? Math.round((v.total_paid / v.total_due) * 100) : 0,
    }))
    .sort((a, b) => a.grade.localeCompare(b.grade));

  const totals = rows.reduce((acc, r) => ({
    students: acc.students + r.count,
    due: acc.due + r.total_due,
    paid: acc.paid + r.total_paid,
    outstanding: acc.outstanding + r.outstanding,
    owing: acc.owing + r.owing,
  }), { students: 0, due: 0, paid: 0, outstanding: 0, owing: 0 });

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      <div className="no-print sticky top-0 z-10 text-white px-6 py-3 flex items-center justify-between shadow-md" style={{ background: branding.primaryColor }}>
        <div>
          <p className="text-xs uppercase tracking-wider font-bold" style={{ color: branding.accentColor }}>Fee Collection by Class · {branding.schoolName}</p>
          <p className="text-sm font-medium">{term || "All fees"} · {rows.length} class{rows.length === 1 ? "" : "es"}</p>
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
            eyebrow="Fee Collection by Class"
            accent="emerald"
            right={
              <div>
                <p className="text-[10px] text-gray-500 uppercase font-bold">Period</p>
                <p className="text-sm font-bold" style={{ color: branding.primaryColor }}>{term || "Current"}</p>
                <p className="text-[11px] text-gray-500 mt-0.5">Prepared {fmtDate(new Date().toISOString().slice(0, 10))}</p>
              </div>
            }
          />

          <table className="w-full text-xs border-collapse mb-3">
            <thead>
              <tr style={{ background: branding.primaryColor, color: "#fff" }}>
                <th className="text-left px-2 py-2 border">Class / Grade</th>
                <th className="text-right px-2 py-2 border">Students</th>
                <th className="text-right px-2 py-2 border">Total due</th>
                <th className="text-right px-2 py-2 border">Collected</th>
                <th className="text-right px-2 py-2 border">Outstanding</th>
                <th className="text-right px-2 py-2 border">Owing</th>
                <th className="text-right px-2 py-2 border">%</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={7} className="py-4 text-center text-gray-400 italic">No fee-eligible students yet.</td></tr>
              ) : rows.map(r => (
                <tr key={r.grade}>
                  <td className="border px-2 py-1.5 font-semibold">{r.grade}</td>
                  <td className="border px-2 py-1.5 text-right">{r.count}</td>
                  <td className="border px-2 py-1.5 text-right">{fmtMoney(r.total_due)}</td>
                  <td className="border px-2 py-1.5 text-right text-emerald-700">{fmtMoney(r.total_paid)}</td>
                  <td className="border px-2 py-1.5 text-right text-red-700">{fmtMoney(r.outstanding)}</td>
                  <td className="border px-2 py-1.5 text-right">{r.owing}</td>
                  <td className="border px-2 py-1.5 text-right font-semibold">{r.collectionPct}%</td>
                </tr>
              ))}
              <tr style={{ background: branding.accentColor, color: branding.primaryColor }}>
                <td className="border px-2 py-2 font-bold">TOTAL</td>
                <td className="border px-2 py-2 text-right font-bold">{totals.students}</td>
                <td className="border px-2 py-2 text-right font-bold">{fmtMoney(totals.due)}</td>
                <td className="border px-2 py-2 text-right font-bold">{fmtMoney(totals.paid)}</td>
                <td className="border px-2 py-2 text-right font-bold">{fmtMoney(totals.outstanding)}</td>
                <td className="border px-2 py-2 text-right font-bold">{totals.owing}</td>
                <td className="border px-2 py-2 text-right font-bold">{totals.due > 0 ? Math.round((totals.paid / totals.due) * 100) : 0}%</td>
              </tr>
            </tbody>
          </table>

          <div className="mt-6 grid grid-cols-2 gap-8 text-[10px] text-gray-500">
            <div><p style={{ borderTop: `1px solid ${branding.primaryColor}` }}></p><p className="mt-1">Bursar</p></div>
            <div className="text-right"><p style={{ borderTop: `1px solid ${branding.primaryColor}` }}></p><p className="mt-1">Head of School</p></div>
          </div>

          <PrintableFooter branding={branding} />
        </div>
      </div>

      <style>{`@media print { @page { size: A4; margin: 15mm; } }`}</style>
    </div>
  );
}
