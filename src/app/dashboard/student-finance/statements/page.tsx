"use client";

/**
 * Bulk-printable fee statements.
 *
 * Accepts a `?ids=<comma-list>` of student ids and produces a
 * page-break-per-student statement showing: student header, fee
 * schedule breakdown, all payments received, and a running
 * balance. Uses the school's branding (logo, name, colours, address).
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

interface Student {
  id: string; student_code: string; full_name: string;
  grade: string | null; guardian_name: string | null; guardian_phone: string | null;
}
interface FeeSchedule {
  id: string; name: string; amount: number; grade: string | null; term: string | null;
}
interface Payment {
  id: string; student_id: string; amount: number; date: string;
  fee_type: string | null; receipt_no: string | null; note: string | null;
}

export default function FeeStatementsBatchPage() {
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
  const ids = (params.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);

  const [students, setStudents] = useState<Student[]>([]);
  const [fees, setFees] = useState<FeeSchedule[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId || ids.length === 0) { setLoading(false); return; }
    (async () => {
      const [sRes, fRes, pRes] = await Promise.all([
        supabase.from("students").select("id, student_code, full_name, grade, guardian_name, guardian_phone").in("id", ids),
        supabase.from("fee_schedules").select("*").eq("active", true),
        supabase.from("income_entries").select("id, student_id, amount, date, fee_type, receipt_no, note").in("student_id", ids).order("date"),
      ]);
      setStudents((sRes.data as Student[]) ?? []);
      setFees((fRes.data as FeeSchedule[]) ?? []);
      setPayments((pRes.data as Payment[]) ?? []);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, orgId, params.get("ids")]);

  if (loading || !branding) return <div className="p-8"><LoadingSpinner /></div>;
  if (students.length === 0) return <div className="p-8 text-center text-gray-500">No students selected.</div>;

  const paymentsByStudent = new Map<string, Payment[]>();
  payments.forEach((p) => {
    const arr = paymentsByStudent.get(p.student_id) ?? [];
    arr.push(p);
    paymentsByStudent.set(p.student_id, arr);
  });

  const now = new Date();
  const stmtDate = fmtDate(now.toISOString().slice(0, 10));
  const stmtNo = `STMT-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      <div className="no-print sticky top-0 z-10 text-white px-6 py-3 flex items-center justify-between shadow-md" style={{ background: branding.primaryColor }}>
        <div>
          <p className="text-xs uppercase tracking-wider font-bold" style={{ color: branding.accentColor }}>Fee Statements · {branding.schoolName}</p>
          <p className="text-sm font-medium">{students.length} statement{students.length === 1 ? "" : "s"}</p>
        </div>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold hover:opacity-90 transition-opacity"
          style={{ background: branding.accentColor, color: branding.primaryColor }}
        >
          <Printer size={14} /> Print / Save as PDF
        </button>
      </div>

      <div className="max-w-3xl mx-auto py-6 print:py-0 print:max-w-full">
        {students.map((s) => {
          const applicableFees = fees.filter((f) => !f.grade || f.grade === s.grade);
          const totalDue = applicableFees.reduce((sum, f) => sum + f.amount, 0);
          const studentPayments = paymentsByStudent.get(s.id) ?? [];
          const totalPaid = studentPayments.reduce((sum, p) => sum + p.amount, 0);
          const balance = totalDue - totalPaid;

          return (
            <div key={s.id} className="bg-white shadow-sm rounded-lg p-8 mb-4 print:shadow-none print:mb-0 print:rounded-none stmt-page">
              <PrintableLetterhead
                branding={branding}
                eyebrow="Fee Statement"
                accent={balance > 0 ? "amber" : "emerald"}
                right={
                  <div>
                    <p className="text-[10px] text-gray-500 uppercase font-bold">Statement no.</p>
                    <p className="text-sm font-bold" style={{ color: branding.primaryColor }}>{stmtNo}-{s.student_code}</p>
                    <p className="text-[11px] text-gray-500 mt-0.5">Issued {stmtDate}</p>
                  </div>
                }
              />

              {/* Student block */}
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 mb-4 text-sm">
                <div>
                  <p className="text-[10px] text-gray-500 uppercase font-bold">Student</p>
                  <p className="font-semibold" style={{ color: branding.primaryColor }}>{s.full_name}</p>
                  <p className="text-xs text-gray-500">{s.student_code}{s.grade ? ` · Grade ${s.grade}` : ""}</p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-500 uppercase font-bold">Guardian</p>
                  <p className="font-medium">{s.guardian_name ?? "—"}</p>
                  {s.guardian_phone && <p className="text-xs text-gray-500">{s.guardian_phone}</p>}
                </div>
              </div>

              {/* Fees due */}
              <div className="mb-3">
                <p className="text-[10px] text-gray-500 uppercase font-bold mb-1">Fees due</p>
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ borderBottom: `2px solid ${branding.primaryColor}` }}>
                      <th className="text-left py-1">Item</th>
                      <th className="text-left py-1">Term</th>
                      <th className="text-right py-1">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {applicableFees.length === 0 ? (
                      <tr><td colSpan={3} className="py-2 text-center text-gray-400 italic">No fees on schedule</td></tr>
                    ) : applicableFees.map((f) => (
                      <tr key={f.id} className="border-b border-gray-100">
                        <td className="py-1">{f.name}</td>
                        <td className="py-1 text-gray-500">{f.term ?? "—"}</td>
                        <td className="py-1 text-right">{branding.currencySymbol}{fmtMoney(f.amount).replace(/^[^0-9]+/, "")}</td>
                      </tr>
                    ))}
                    <tr>
                      <td colSpan={2} className="py-2 font-bold" style={{ borderTop: `2px solid ${branding.primaryColor}` }}>Total due</td>
                      <td className="py-2 text-right font-bold" style={{ borderTop: `2px solid ${branding.primaryColor}` }}>{fmtMoney(totalDue)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Payments received */}
              <div className="mb-3">
                <p className="text-[10px] text-gray-500 uppercase font-bold mb-1">Payments received</p>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-1">Date</th>
                      <th className="text-left py-1">Receipt</th>
                      <th className="text-left py-1">Note</th>
                      <th className="text-right py-1">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {studentPayments.length === 0 ? (
                      <tr><td colSpan={4} className="py-2 text-center text-gray-400 italic">No payments yet</td></tr>
                    ) : studentPayments.map((p) => (
                      <tr key={p.id} className="border-b border-gray-100">
                        <td className="py-1">{fmtDate(p.date)}</td>
                        <td className="py-1 text-gray-500">{p.receipt_no ?? "—"}</td>
                        <td className="py-1 text-gray-500">{p.note ?? p.fee_type ?? ""}</td>
                        <td className="py-1 text-right text-emerald-700">{fmtMoney(p.amount)}</td>
                      </tr>
                    ))}
                    <tr>
                      <td colSpan={3} className="py-2 font-bold" style={{ borderTop: `2px solid ${branding.primaryColor}` }}>Total paid</td>
                      <td className="py-2 text-right font-bold text-emerald-700" style={{ borderTop: `2px solid ${branding.primaryColor}` }}>{fmtMoney(totalPaid)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Balance stripe */}
              <div
                className="rounded-lg p-3 flex items-center justify-between text-sm mb-4"
                style={{
                  background: balance > 0 ? "#FEF3C7" : "#D1FAE5",
                  border: `1px solid ${balance > 0 ? "#F59E0B" : "#10B981"}`,
                }}
              >
                <span className="font-bold" style={{ color: balance > 0 ? "#92400E" : "#065F46" }}>
                  {balance > 0 ? "Outstanding balance" : balance < 0 ? "Credit balance" : "Fully settled"}
                </span>
                <span className="font-bold text-lg" style={{ color: balance > 0 ? "#92400E" : "#065F46" }}>
                  {fmtMoney(Math.abs(balance))}
                </span>
              </div>

              {branding.receiptFooter && (
                <p className="text-[10px] text-gray-500 italic mb-2">{branding.receiptFooter}</p>
              )}

              <PrintableFooter branding={branding} />
            </div>
          );
        })}
      </div>

      <style>{`
        @media print {
          .stmt-page { page-break-after: always; }
          .stmt-page:last-child { page-break-after: auto; }
          @page { size: A4; margin: 15mm; }
        }
      `}</style>
    </div>
  );
}
