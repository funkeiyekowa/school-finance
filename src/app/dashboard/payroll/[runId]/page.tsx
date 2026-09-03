"use client";

/**
 * Payroll run detail — the actual pay approval flow.
 *
 * Lifecycle: draft -> finalized -> paid. Each transition goes through
 * a server-side RPC (payroll_generate_run, payroll_finalize_run,
 * payroll_mark_run_paid) that enforces the state machine. A finalized
 * or paid run can never be silently regenerated -- the RPC refuses.
 *
 * Payslip rows are a HISTORICAL SNAPSHOT: staff_name/staff_code and
 * the line items are stored on the row, so renaming a staff member or
 * editing a component later doesn't rewrite what was already paid.
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { useToast } from "@/lib/hooks/useToast";
import { useBranding } from "@/lib/hooks/useBranding";
import { extractErrorMessage } from "@/lib/errors/extractErrorMessage";
import { fmtMoney, fmtDateTime, cn } from "@/lib/utils";
import { PageHeader, LoadingSpinner, EmptyState } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { PrintableLetterhead, PrintableFooter } from "@/components/print/PrintableLetterhead";
import {
  ArrowLeft, Sparkles, CheckCircle2, Wallet, FileText,
  Loader2, Users, DollarSign, ArrowUpCircle, ArrowDownCircle, Printer,
} from "lucide-react";

interface RunRow {
  id: string; period_month: number; period_year: number; label: string | null; status: string;
  total_gross: number; total_deductions: number; total_net: number; staff_count: number;
  finalized_at: string | null; paid_at: string | null; notes: string | null; created_at: string;
}
interface PayslipLine { name: string; code: string; type: string; amount: number; }
interface PayslipRow {
  id: string; run_id: string; staff_id: string; staff_name: string; staff_code: string;
  basic_salary: number; total_allowances: number; total_deductions: number; gross_pay: number; net_pay: number;
  lines: PayslipLine[]; payment_status: string; paid_at: string | null; payment_reference: string | null;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default function PayrollRunPage() {
  const params = useParams<{ runId: string }>();
  const runId = params.runId;
  const { canEdit } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const { notify, ToastHost } = useToast();
  const branding = useBranding();

  const [loading, setLoading] = useState(true);
  const [run, setRun] = useState<RunRow | null>(null);
  const [payslips, setPayslips] = useState<PayslipRow[]>([]);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [rRes, pRes] = await Promise.all([
      supabase.from("payroll_runs").select("*").eq("id", runId).maybeSingle(),
      supabase.from("payroll_payslips").select("*").eq("run_id", runId).order("staff_name"),
    ]);
    setRun(rRes.data as RunRow | null);
    setPayslips((pRes.data as PayslipRow[]) ?? []);
    setLoading(false);
  }, [supabase, runId]);

  useEffect(() => { load(); }, [load]);

  /* ---------------- Actions ---------------- */
  const [generating, setGenerating] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [markingPaid, setMarkingPaid] = useState(false);

  async function generateRun() {
    if (!run) return;
    if (payslips.length > 0 && !confirm("This will delete the existing payslips and regenerate them from current staff salaries and components. Continue?")) return;
    setGenerating(true);
    try {
      const { data, error } = await supabase.rpc("payroll_generate_run", { p_run_id: runId }).maybeSingle();
      if (error) throw error;
      const result = data as { payslip_count: number; gross_total: number; net_total: number };
      notify(`Generated ${result.payslip_count} payslip${result.payslip_count === 1 ? "" : "s"} — net total ${fmtMoney(result.net_total)}.`);
      load();
    } catch (err) {
      notify(extractErrorMessage(err, "Generation failed."), "error");
    } finally {
      setGenerating(false);
    }
  }

  async function finalizeRun() {
    if (!confirm("Finalize this run? After finalization, payslips are locked and cannot be regenerated.")) return;
    setFinalizing(true);
    try {
      const { error } = await supabase.rpc("payroll_finalize_run", { p_run_id: runId });
      if (error) throw error;
      notify("Run finalized.");
      load();
    } catch (err) {
      notify(extractErrorMessage(err, "Finalization failed."), "error");
    } finally {
      setFinalizing(false);
    }
  }

  async function markPaid() {
    if (!confirm("Mark this entire run as paid? All unpaid payslips will be marked paid.")) return;
    setMarkingPaid(true);
    try {
      const { error } = await supabase.rpc("payroll_mark_run_paid", { p_run_id: runId });
      if (error) throw error;
      notify("Run marked as paid.");
      load();
    } catch (err) {
      notify(extractErrorMessage(err, "Failed to mark paid."), "error");
    } finally {
      setMarkingPaid(false);
    }
  }

  async function markPayslipPaid(slip: PayslipRow, reference?: string) {
    const payload: Record<string, unknown> = {
      payment_status: "paid",
      paid_at: new Date().toISOString(),
    };
    if (reference) payload.payment_reference = reference;
    const { error } = await supabase.from("payroll_payslips").update(payload).eq("id", slip.id);
    if (error) { notify(extractErrorMessage(error, "Failed to mark paid."), "error"); return; }
    notify("Payslip marked paid.");
    load();
  }

  /* ---------------- Payslip viewer ---------------- */
  const [viewingSlip, setViewingSlip] = useState<PayslipRow | null>(null);
  const [payReference, setPayReference] = useState("");

  const filteredSlips = payslips.filter((p) =>
    p.staff_name.toLowerCase().includes(search.toLowerCase()) ||
    p.staff_code.toLowerCase().includes(search.toLowerCase())
  );

  const unpaidCount = payslips.filter((p) => p.payment_status === "unpaid").length;
  const paidCount = payslips.filter((p) => p.payment_status === "paid").length;

  if (loading) return <div className="p-6"><LoadingSpinner /></div>;
  if (!run) return <div className="p-6"><EmptyState message="Run not found." /></div>;

  const periodLabel = `${MONTHS[run.period_month - 1]} ${run.period_year}`;

  return (
    <div className="p-6 space-y-5">
      <Link href="/dashboard/payroll" className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-[#0F2A47]">
        <ArrowLeft size={14} /> Back to Payroll
      </Link>

      <PageHeader title={run.label || `${periodLabel} payroll`} subtitle={periodLabel}>
        <span className={cn(
          "text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full",
          run.status === "paid" ? "bg-emerald-100 text-emerald-700" :
          run.status === "finalized" ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"
        )}>{run.status}</span>
      </PageHeader>

      {/* Action bar */}
      {canEdit && (
        <Card className="!p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-gray-500">
              {run.status === "draft" && (payslips.length === 0
                ? "Generate payslips from staff salaries + components, then finalize when ready."
                : "Review payslips below. Regenerate to pick up changes, or finalize to lock the numbers.")}
              {run.status === "finalized" && "Numbers are locked. Mark the run paid once the bank transfer is done."}
              {run.status === "paid" && `Paid ${run.paid_at ? fmtDateTime(run.paid_at) : ""}.`}
            </div>
            <div className="flex items-center gap-2">
              {run.status === "draft" && (
                <>
                  <Button variant="secondary" size="sm" onClick={generateRun} loading={generating}>
                    <Sparkles size={14} /> {payslips.length > 0 ? "Regenerate" : "Generate"}
                  </Button>
                  {payslips.length > 0 && (
                    <Button variant="gold" size="sm" onClick={finalizeRun} loading={finalizing}>
                      <CheckCircle2 size={14} /> Finalize
                    </Button>
                  )}
                </>
              )}
              {run.status === "finalized" && (
                <Button variant="gold" size="sm" onClick={markPaid} loading={markingPaid}>
                  <Wallet size={14} /> Mark Paid
                </Button>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Totals */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className="!p-4">
          <div className="flex items-center gap-2 text-xs text-gray-500 mb-1"><Users size={12} /> Staff</div>
          <p className="text-xl font-bold text-[#0F2A47]">{run.staff_count}</p>
        </Card>
        <Card className="!p-4">
          <div className="flex items-center gap-2 text-xs text-gray-500 mb-1"><DollarSign size={12} /> Gross</div>
          <p className="text-xl font-bold text-[#0F2A47]">{fmtMoney(run.total_gross)}</p>
        </Card>
        <Card className="!p-4">
          <div className="flex items-center gap-2 text-xs text-gray-500 mb-1"><ArrowDownCircle size={12} /> Deductions</div>
          <p className="text-xl font-bold text-red-600">{fmtMoney(run.total_deductions)}</p>
        </Card>
        <Card className="!p-4">
          <div className="flex items-center gap-2 text-xs text-gray-500 mb-1"><Wallet size={12} /> Net</div>
          <p className="text-xl font-bold text-emerald-600">{fmtMoney(run.total_net)}</p>
        </Card>
        <Card className="!p-4">
          <div className="flex items-center gap-2 text-xs text-gray-500 mb-1"><CheckCircle2 size={12} /> Paid</div>
          <p className="text-xl font-bold text-[#0F2A47]">{paidCount} / {payslips.length}</p>
        </Card>
      </div>

      {/* Payslips list */}
      {payslips.length === 0 ? (
        <EmptyState message="No payslips yet — click Generate to build them from current staff data." icon={<FileText size={40} />} />
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-[#0F2A47]">Payslips ({payslips.length})</h3>
            <div className="flex items-center gap-2">
              <Input
                placeholder="Search…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="max-w-xs"
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={() => window.open(`/dashboard/payroll/${runId}/payslips-print`, "_blank")}
                title="Open all payslips in a printable page — Print / Save as PDF from your browser"
              >
                <Printer size={14} /> Print all
              </Button>
            </div>
          </div>
          <div className="space-y-1.5">
            {filteredSlips.map((p) => (
              <Card key={p.id} className="flex items-center justify-between !p-3">
                <button onClick={() => setViewingSlip(p)} className="flex-1 text-left flex items-center gap-3">
                  <div className={cn("w-8 h-8 rounded-full flex items-center justify-center text-white shrink-0 text-xs font-bold", p.payment_status === "paid" ? "bg-emerald-500" : "bg-gray-300")}>
                    {p.staff_name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-700">{p.staff_name} <span className="text-xs text-gray-400">{p.staff_code}</span></p>
                    <p className="text-xs text-gray-500">Basic {fmtMoney(p.basic_salary)} · +{fmtMoney(p.total_allowances)} · -{fmtMoney(p.total_deductions)}</p>
                  </div>
                </button>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-bold text-emerald-600">{fmtMoney(p.net_pay)}</span>
                  <span className={cn("text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full", p.payment_status === "paid" ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500")}>
                    {p.payment_status}
                  </span>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Payslip viewer */}
      <Modal open={!!viewingSlip} onClose={() => { setViewingSlip(null); setPayReference(""); }} title="Payslip" size="lg">
        {viewingSlip && (
          <div className="space-y-4">
            {/* Printable header */}
            <div className="relative border border-gray-200 rounded-lg p-4 space-y-3 bg-white overflow-hidden" id="payslip-body">
              {branding && (
                <div
                  aria-hidden
                  className="pointer-events-none select-none absolute inset-0 flex items-center justify-center overflow-hidden"
                  style={{ zIndex: 0 }}
                >
                  <span
                    className="whitespace-nowrap font-bold uppercase tracking-widest"
                    style={{ fontSize: "2.75rem", color: branding.primaryColor, opacity: 0.05, transform: "rotate(-24deg)" }}
                  >
                    {branding.schoolName}
                  </span>
                </div>
              )}
              <div className="relative" style={{ zIndex: 1 }}>
              {branding ? (
                <PrintableLetterhead
                  branding={branding}
                  eyebrow="Payslip"
                  accent="navy"
                  right={
                    <div>
                      <p className="text-sm font-bold" style={{ color: branding.primaryColor }}>{viewingSlip.staff_name}</p>
                      <p className="text-[11px] text-gray-500">Staff ID: {viewingSlip.staff_code}</p>
                      <p className="text-[11px] text-gray-500 mt-0.5">{run.label || `${periodLabel} payroll`}</p>
                      <p className="text-[11px] text-gray-500">{periodLabel}</p>
                    </div>
                  }
                />
              ) : (
                <div className="flex items-start justify-between border-b border-gray-100 pb-2">
                  <div>
                    <p className="text-xs text-gray-500 uppercase font-bold tracking-wide">Payslip</p>
                    <p className="text-sm font-bold text-[#0F2A47]">{run.label || `${periodLabel} payroll`}</p>
                    <p className="text-xs text-gray-500">{periodLabel}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-[#0F2A47]">{viewingSlip.staff_name}</p>
                    <p className="text-xs text-gray-500">{viewingSlip.staff_code}</p>
                  </div>
                </div>
              )}

              <div className="space-y-1 text-sm">
                <div className="flex justify-between py-1 border-b border-gray-100">
                  <span className="font-medium text-gray-700">Basic Salary</span>
                  <span className="font-medium">{fmtMoney(viewingSlip.basic_salary)}</span>
                </div>

                {viewingSlip.lines.filter((l) => l.type === "allowance").length > 0 && (
                  <>
                    <div className="text-[11px] font-bold text-emerald-700 uppercase mt-2 flex items-center gap-1"><ArrowUpCircle size={11} /> Allowances</div>
                    {viewingSlip.lines.filter((l) => l.type === "allowance").map((l, i) => (
                      <div key={i} className="flex justify-between py-0.5 text-xs">
                        <span className="text-gray-600">{l.name}</span>
                        <span className="text-emerald-600">+{fmtMoney(l.amount)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between py-1 border-t border-gray-100 mt-1 text-xs font-semibold">
                      <span>Total Allowances</span>
                      <span className="text-emerald-600">+{fmtMoney(viewingSlip.total_allowances)}</span>
                    </div>
                  </>
                )}

                <div className="flex justify-between py-2 border-t border-b-2 border-[#0F2A47] font-bold">
                  <span>Gross Pay</span>
                  <span>{fmtMoney(viewingSlip.gross_pay)}</span>
                </div>

                {viewingSlip.lines.filter((l) => l.type === "deduction").length > 0 && (
                  <>
                    <div className="text-[11px] font-bold text-red-700 uppercase mt-2 flex items-center gap-1"><ArrowDownCircle size={11} /> Deductions</div>
                    {viewingSlip.lines.filter((l) => l.type === "deduction").map((l, i) => (
                      <div key={i} className="flex justify-between py-0.5 text-xs">
                        <span className="text-gray-600">{l.name}</span>
                        <span className="text-red-600">-{fmtMoney(l.amount)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between py-1 border-t border-gray-100 mt-1 text-xs font-semibold">
                      <span>Total Deductions</span>
                      <span className="text-red-600">-{fmtMoney(viewingSlip.total_deductions)}</span>
                    </div>
                  </>
                )}

                <div className="flex justify-between py-2 border-t-2 border-emerald-600 font-bold text-emerald-700 text-base mt-2">
                  <span>Net Pay</span>
                  <span>{fmtMoney(viewingSlip.net_pay)}</span>
                </div>
              </div>

              {viewingSlip.payment_status === "paid" && (
                <p className="text-xs text-emerald-700 italic">
                  Paid {viewingSlip.paid_at ? fmtDateTime(viewingSlip.paid_at) : ""}
                  {viewingSlip.payment_reference ? ` · ref ${viewingSlip.payment_reference}` : ""}
                </p>
              )}
              {branding && <PrintableFooter branding={branding} />}
              </div>
            </div>

            <div className="flex items-center justify-between gap-2">
              <button
                onClick={() => window.print()}
                className="text-xs text-[#0F2A47] hover:text-[#C9A227] flex items-center gap-1"
              >
                <Printer size={12} /> Print
              </button>

              {canEdit && viewingSlip.payment_status === "unpaid" && run.status !== "draft" && (
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="Payment ref (optional)"
                    value={payReference}
                    onChange={(e) => setPayReference(e.target.value)}
                    className="!py-1.5 text-xs w-40"
                  />
                  <Button variant="gold" size="sm" onClick={() => markPayslipPaid(viewingSlip, payReference)}>
                    Mark Paid
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      <ToastHost />
    </div>
  );
}
