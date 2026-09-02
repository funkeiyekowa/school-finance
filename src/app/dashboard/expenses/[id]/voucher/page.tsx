"use client";

/**
 * Printable expense voucher.
 *
 * A formal payment voucher on the school letterhead — voucher no.,
 * date, vendor, category, description, amount in figures + words,
 * plus signature block for preparer, approver, and receiver.
 */

import { useEffect, useState, useMemo } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useBranding } from "@/lib/hooks/useBranding";
import { fmtDate, fmtMoney } from "@/lib/utils";
import { LoadingSpinner } from "@/components/ui/PageHeader";
import { PrintableLetterhead, PrintableFooter } from "@/components/print/PrintableLetterhead";
import { Printer } from "lucide-react";

interface Expense {
  id: string; voucher_no: string; date: string; vendor_name: string | null;
  category: string; description: string | null; amount: number;
  payment_method: string; approved_by: string | null; notes: string | null;
  reconciled: boolean;
}

function numToWords(n: number): string {
  if (n === 0) return "zero";
  const under = ["","one","two","three","four","five","six","seven","eight","nine","ten","eleven","twelve","thirteen","fourteen","fifteen","sixteen","seventeen","eighteen","nineteen"];
  const tens = ["","","twenty","thirty","forty","fifty","sixty","seventy","eighty","ninety"];
  const three = (m: number): string => {
    const parts: string[] = [];
    const h = Math.floor(m / 100);
    const r = m % 100;
    if (h) parts.push(under[h] + " hundred");
    if (r < 20 && r > 0) parts.push(under[r]);
    else if (r >= 20) {
      const t = Math.floor(r / 10), u = r % 10;
      parts.push(tens[t] + (u ? "-" + under[u] : ""));
    }
    return parts.join(" and ");
  };
  const scales = ["", " thousand", " million", " billion"];
  const parts: string[] = [];
  let i = 0;
  let n2 = Math.floor(n);
  while (n2 > 0) {
    const chunk = n2 % 1000;
    if (chunk) parts.unshift(three(chunk) + scales[i]);
    n2 = Math.floor(n2 / 1000);
    i++;
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

export default function ExpenseVoucherPage() {
  const params = useParams<{ id: string }>();
  const supabase = useMemo(() => createClient(), []);
  const branding = useBranding();
  const [expense, setExpense] = useState<Expense | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("expense_entries").select("*").eq("id", params.id).maybeSingle();
      setExpense((data as Expense) ?? null);
      setLoading(false);
    })();
  }, [supabase, params.id]);

  if (loading || !branding) return <div className="p-8"><LoadingSpinner /></div>;
  if (!expense) return <div className="p-8 text-center text-gray-500">Voucher not found.</div>;

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      <div className="no-print sticky top-0 z-10 text-white px-6 py-3 flex items-center justify-between shadow-md" style={{ background: branding.primaryColor }}>
        <div>
          <p className="text-xs uppercase tracking-wider font-bold" style={{ color: branding.accentColor }}>Payment Voucher · {branding.schoolName}</p>
          <p className="text-sm font-medium">{expense.voucher_no}</p>
        </div>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold hover:opacity-90"
          style={{ background: branding.accentColor, color: branding.primaryColor }}
        >
          <Printer size={14} /> Print / Save as PDF
        </button>
      </div>

      <div className="max-w-3xl mx-auto py-6 print:py-0 print:max-w-full">
        <div className="bg-white shadow-sm rounded-lg p-8 print:shadow-none print:rounded-none">
          <PrintableLetterhead
            branding={branding}
            eyebrow="Payment Voucher"
            accent="rose"
            right={
              <div>
                <p className="text-[10px] text-gray-500 uppercase font-bold">Voucher no.</p>
                <p className="text-lg font-bold" style={{ color: branding.primaryColor }}>{expense.voucher_no}</p>
                <p className="text-[11px] text-gray-500 mt-0.5">{fmtDate(expense.date)}</p>
              </div>
            }
          />

          <div className="grid grid-cols-2 gap-6 mb-4 text-sm">
            <div>
              <p className="text-[10px] uppercase font-bold" style={{ color: branding.accentColor }}>Paid to</p>
              <p className="font-semibold" style={{ color: branding.primaryColor }}>{expense.vendor_name ?? "—"}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase font-bold" style={{ color: branding.accentColor }}>Category</p>
              <p className="font-medium capitalize">{expense.category}</p>
              <p className="text-[10px] text-gray-500 uppercase font-bold mt-2">Payment method</p>
              <p className="text-xs capitalize">{expense.payment_method.replace(/_/g, " ")}</p>
            </div>
          </div>

          <div className="mb-4">
            <p className="text-[10px] text-gray-500 uppercase font-bold">Purpose / description</p>
            <p className="text-sm whitespace-pre-wrap">{expense.description ?? "—"}</p>
          </div>

          <div className="rounded-lg p-4 text-center mb-4" style={{ background: branding.accentColor, color: branding.primaryColor }}>
            <p className="text-[10px] uppercase font-bold tracking-widest">Amount paid</p>
            <p className="text-3xl font-bold mt-1">{fmtMoney(expense.amount)}</p>
            <p className="text-xs mt-1 italic">
              {branding.currencySymbol} {numToWords(expense.amount)} only
            </p>
          </div>

          {expense.notes && (
            <div className="mb-4">
              <p className="text-[10px] text-gray-500 uppercase font-bold">Notes</p>
              <p className="text-xs whitespace-pre-wrap">{expense.notes}</p>
            </div>
          )}

          {expense.reconciled && (
            <p className="text-emerald-700 text-xs font-semibold mb-2">✓ Reconciled</p>
          )}

          <div className="mt-10 grid grid-cols-3 gap-4 text-[10px] text-gray-500">
            <div>
              <p style={{ borderTop: `1px solid ${branding.primaryColor}` }}></p>
              <p className="mt-1 font-semibold">Prepared by</p>
              <p>Accountant</p>
            </div>
            <div>
              <p style={{ borderTop: `1px solid ${branding.primaryColor}` }}></p>
              <p className="mt-1 font-semibold">Approved by</p>
              <p>{expense.approved_by ?? "—"}</p>
            </div>
            <div>
              <p style={{ borderTop: `1px solid ${branding.primaryColor}` }}></p>
              <p className="mt-1 font-semibold">Received by</p>
              <p>{expense.vendor_name ?? "Payee"}</p>
            </div>
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
