"use client";

/**
 * Bulk-printable payslips page.
 *
 * A dedicated route that renders every payslip in a run as a stack of
 * clean, printer-optimized cards. Opens in a new tab so the browser's
 * print dialog can save the whole batch as one PDF without disturbing
 * the payroll run page behind it.
 */

import { useEffect, useState, useMemo } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { fmtMoney, fmtDateTime } from "@/lib/utils";
import { LoadingSpinner } from "@/components/ui/PageHeader";
import { Printer } from "lucide-react";

interface PayslipLine { name: string; code: string; type: string; amount: number; }
interface PayslipRow {
  id: string; staff_name: string; staff_code: string;
  basic_salary: number; total_allowances: number; total_deductions: number;
  gross_pay: number; net_pay: number; lines: PayslipLine[];
  payment_status: string; paid_at: string | null; payment_reference: string | null;
}
interface RunRow {
  id: string; period_month: number; period_year: number; label: string | null; status: string;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default function BulkPayslipsPrintPage() {
  const params = useParams<{ runId: string }>();
  const runId = params.runId;
  const supabase = useMemo(() => createClient(), []);
  const { org } = useAuth();

  const [run, setRun] = useState<RunRow | null>(null);
  const [payslips, setPayslips] = useState<PayslipRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [runRes, psRes] = await Promise.all([
        supabase.from("payroll_runs").select("*").eq("id", runId).maybeSingle(),
        supabase.from("payroll_payslips").select("*").eq("run_id", runId).order("staff_name"),
      ]);
      setRun((runRes.data as RunRow) ?? null);
      setPayslips((psRes.data as PayslipRow[]) ?? []);
      setLoading(false);
    })();
  }, [supabase, runId]);

  if (loading) return <div className="p-8"><LoadingSpinner /></div>;
  if (!run) return <div className="p-8 text-center text-gray-500">Run not found.</div>;

  const periodLabel = `${MONTHS[run.period_month - 1]} ${run.period_year}`;

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      {/* Toolbar — hidden on print */}
      <div className="no-print sticky top-0 z-10 bg-[#0F2A47] text-white px-6 py-3 flex items-center justify-between shadow-md">
        <div>
          <p className="text-xs uppercase tracking-wider text-[#C9A227] font-bold">Bulk Payslips</p>
          <p className="text-sm font-medium">{run.label || `${periodLabel} payroll`} — {payslips.length} payslip{payslips.length === 1 ? "" : "s"}</p>
        </div>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 bg-[#C9A227] text-[#0F2A47] px-4 py-2 rounded-lg text-sm font-bold hover:bg-[#e6bf39] transition-colors"
        >
          <Printer size={14} /> Print / Save as PDF
        </button>
      </div>

      <div className="max-w-3xl mx-auto py-6 print:py-0 print:max-w-full">
        {payslips.map((slip) => (
          <div key={slip.id} className="bg-white shadow-sm rounded-lg p-8 mb-6 print:shadow-none print:mb-0 print:rounded-none payslip-page">
            {/* Header */}
            <div className="flex items-start justify-between border-b-2 border-[#0F2A47] pb-3 mb-4">
              <div>
                <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest">Payslip</p>
                <h2 className="text-base font-bold text-[#0F2A47]">{org?.name ?? "School"}</h2>
                <p className="text-xs text-gray-600 mt-0.5">{run.label || `${periodLabel} payroll`}</p>
                <p className="text-[11px] text-gray-500">{periodLabel}</p>
              </div>
              <div className="text-right">
                <p className="text-base font-bold text-[#0F2A47]">{slip.staff_name}</p>
                <p className="text-xs text-gray-500">Staff ID: {slip.staff_code}</p>
              </div>
            </div>

            {/* Body */}
            <div className="space-y-1 text-sm">
              <div className="flex justify-between py-1 border-b border-gray-100">
                <span className="font-medium text-gray-700">Basic Salary</span>
                <span className="font-medium">{fmtMoney(slip.basic_salary)}</span>
              </div>

              {slip.lines.filter((l) => l.type === "allowance").length > 0 && (
                <>
                  <div className="text-[10px] font-bold text-emerald-700 uppercase mt-2">Allowances</div>
                  {slip.lines.filter((l) => l.type === "allowance").map((l, i) => (
                    <div key={i} className="flex justify-between py-0.5 text-xs">
                      <span className="text-gray-600 pl-3">{l.name}</span>
                      <span className="text-emerald-700">+{fmtMoney(l.amount)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between py-1 border-t border-gray-100 mt-1 text-xs font-semibold">
                    <span>Total Allowances</span>
                    <span className="text-emerald-700">+{fmtMoney(slip.total_allowances)}</span>
                  </div>
                </>
              )}

              <div className="flex justify-between py-2 border-t border-b-2 border-[#0F2A47] font-bold">
                <span>Gross Pay</span>
                <span>{fmtMoney(slip.gross_pay)}</span>
              </div>

              {slip.lines.filter((l) => l.type === "deduction").length > 0 && (
                <>
                  <div className="text-[10px] font-bold text-red-700 uppercase mt-2">Deductions</div>
                  {slip.lines.filter((l) => l.type === "deduction").map((l, i) => (
                    <div key={i} className="flex justify-between py-0.5 text-xs">
                      <span className="text-gray-600 pl-3">{l.name}</span>
                      <span className="text-red-700">-{fmtMoney(l.amount)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between py-1 border-t border-gray-100 mt-1 text-xs font-semibold">
                    <span>Total Deductions</span>
                    <span className="text-red-700">-{fmtMoney(slip.total_deductions)}</span>
                  </div>
                </>
              )}

              <div className="flex justify-between py-2 border-t-2 border-emerald-600 font-bold text-emerald-700 text-lg mt-2">
                <span>Net Pay</span>
                <span>{fmtMoney(slip.net_pay)}</span>
              </div>
            </div>

            {/* Footer */}
            <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between text-[10px] text-gray-500">
              <div>
                {slip.payment_status === "paid" ? (
                  <span className="text-emerald-700 font-semibold">
                    ✓ Paid{slip.paid_at ? ` on ${fmtDateTime(slip.paid_at)}` : ""}
                    {slip.payment_reference ? ` · ref ${slip.payment_reference}` : ""}
                  </span>
                ) : (
                  <span>Unpaid</span>
                )}
              </div>
              <div className="text-right">
                <p>_______________________________</p>
                <p>Authorized Signature</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <style>{`
        @media print {
          .payslip-page { page-break-after: always; }
          .payslip-page:last-child { page-break-after: auto; }
          @page { size: A4; margin: 15mm; }
        }
      `}</style>
    </div>
  );
}
