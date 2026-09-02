"use client";

/**
 * Bulk printable receipts.
 *
 * ?ids=<comma-list> — print every referenced receipt in one PDF
 * (each on its own page). Uses the same layout as the receipt
 * modal, on the school's letterhead.
 */

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { useBranding } from "@/lib/hooks/useBranding";
import { fmtDate, fmtMoney } from "@/lib/utils";
import { LoadingSpinner } from "@/components/ui/PageHeader";
import { PrintableLetterhead, PrintableFooter } from "@/components/print/PrintableLetterhead";
import { Printer } from "lucide-react";

interface Receipt {
  id: string; receipt_no: string; date: string;
  student_name: string | null; category: string;
  description: string | null; amount: number;
  payment_method: string; term: string | null; recorded_by: string | null;
}

export default function BulkReceiptsPage() {
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
  const ids = (params.get("ids") ?? "").split(",").map(s => s.trim()).filter(Boolean);
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";

  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId) return;
    (async () => {
      let q = supabase.from("income_entries")
        .select("id, receipt_no, date, student_name, category, description, amount, payment_method, term, recorded_by");
      if (ids.length > 0) q = q.in("id", ids);
      else if (from && to) q = q.gte("date", from).lte("date", to);
      const { data } = await q.order("date");
      setReceipts((data as Receipt[]) ?? []);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, orgId, params.get("ids"), from, to]);

  if (loading || !branding) return <div className="p-8"><LoadingSpinner /></div>;

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      <div className="no-print sticky top-0 z-10 text-white px-6 py-3 flex items-center justify-between shadow-md" style={{ background: branding.primaryColor }}>
        <div>
          <p className="text-xs uppercase tracking-wider font-bold" style={{ color: branding.accentColor }}>Batch Receipts · {branding.schoolName}</p>
          <p className="text-sm font-medium">{receipts.length} receipt{receipts.length === 1 ? "" : "s"}</p>
        </div>
        <button
          onClick={() => window.print()}
          disabled={receipts.length === 0}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold hover:opacity-90 disabled:opacity-40"
          style={{ background: branding.accentColor, color: branding.primaryColor }}
        >
          <Printer size={14} /> Print / Save as PDF
        </button>
      </div>

      <div className="max-w-3xl mx-auto py-6 print:py-0 print:max-w-full">
        {receipts.map(r => (
          <div key={r.id} className="bg-white shadow-sm rounded-lg p-8 mb-4 print:shadow-none print:mb-0 print:rounded-none rc-page">
            <PrintableLetterhead
              branding={branding}
              eyebrow="Payment Receipt"
              accent="gold"
              right={
                <div>
                  <p className="text-[10px] text-gray-500 uppercase font-bold">Receipt no.</p>
                  <p className="text-lg font-bold" style={{ color: branding.primaryColor }}>{r.receipt_no}</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">{fmtDate(r.date)}</p>
                </div>
              }
            />

            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm mb-4">
              <div>
                <p className="text-[10px] uppercase font-bold" style={{ color: branding.accentColor }}>Paid by</p>
                <p className="font-semibold" style={{ color: branding.primaryColor }}>{r.student_name ?? "—"}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase font-bold" style={{ color: branding.accentColor }}>Payment method</p>
                <p className="capitalize">{r.payment_method.replace(/_/g, " ")}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase font-bold" style={{ color: branding.accentColor }}>Category</p>
                <p className="capitalize">{r.category}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase font-bold" style={{ color: branding.accentColor }}>Term</p>
                <p>{r.term ?? "—"}</p>
              </div>
              {r.description && (
                <div className="col-span-2">
                  <p className="text-[10px] uppercase font-bold" style={{ color: branding.accentColor }}>Description</p>
                  <p className="text-sm">{r.description}</p>
                </div>
              )}
            </div>

            <div className="rounded-lg p-4 text-center mb-4" style={{ background: branding.primaryColor, color: "#fff" }}>
              <p className="text-[10px] uppercase font-bold tracking-widest" style={{ color: branding.accentColor }}>Amount received</p>
              <p className="text-3xl font-bold mt-1">{fmtMoney(r.amount)}</p>
            </div>

            {branding.receiptFooter && (
              <p className="text-[10px] text-gray-500 italic mb-2 text-center">{branding.receiptFooter}</p>
            )}

            <div className="mt-8 grid grid-cols-2 gap-8 text-[10px] text-gray-500">
              <div><p style={{ borderTop: `1px solid ${branding.primaryColor}` }}></p><p className="mt-1">Received by</p><p>{r.recorded_by ?? ""}</p></div>
              <div className="text-right"><p style={{ borderTop: `1px solid ${branding.primaryColor}` }}></p><p className="mt-1">Payer&apos;s Signature</p></div>
            </div>

            <PrintableFooter branding={branding} />
          </div>
        ))}
      </div>

      <style>{`
        @media print {
          .rc-page { page-break-after: always; }
          .rc-page:last-child { page-break-after: auto; }
          @page { size: A4; margin: 15mm; }
        }
      `}</style>
    </div>
  );
}
