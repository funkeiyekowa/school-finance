"use client";

/**
 * Printable asset depreciation report.
 *
 * Every active (non-disposed) asset with cost, accumulated
 * depreciation, book value, and category totals. Uses the
 * database's asset_book_value RPC when available; otherwise
 * computes straight-line depreciation client-side from
 * purchase_cost / salvage_value / useful_life_years / purchase_date.
 */

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { useBranding } from "@/lib/hooks/useBranding";
import { fmtDate, fmtMoney } from "@/lib/utils";
import { LoadingSpinner } from "@/components/ui/PageHeader";
import { PrintableLetterhead, PrintableFooter } from "@/components/print/PrintableLetterhead";
import { Printer } from "lucide-react";

interface Asset {
  id: string; asset_code: string; name: string; category: string | null;
  purchase_date: string | null; purchase_cost: number;
  salvage_value: number; useful_life_years: number;
  depreciation_method: string; status: string;
}

function ageYears(from: string): number {
  const diff = Date.now() - new Date(from).getTime();
  return diff / (365.25 * 24 * 3600 * 1000);
}

function bookValue(a: Asset): { accum: number; book: number } {
  if (!a.purchase_date) return { accum: 0, book: a.purchase_cost };
  const years = Math.max(0, Math.min(a.useful_life_years, ageYears(a.purchase_date)));
  const depreciable = Math.max(0, a.purchase_cost - a.salvage_value);
  const annual = a.useful_life_years > 0 ? depreciable / a.useful_life_years : 0;
  const accum = Math.min(depreciable, annual * years);
  return { accum, book: a.purchase_cost - accum };
}

export default function AssetDepreciationPage() {
  const supabase = useMemo(() => createClient(), []);
  const { orgId } = useAuth();
  const branding = useBranding();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId) return;
    (async () => {
      const { data } = await supabase.from("assets")
        .select("id, asset_code, name, category, purchase_date, purchase_cost, salvage_value, useful_life_years, depreciation_method, status")
        .neq("status", "disposed")
        .order("category").order("asset_code");
      setAssets((data as Asset[]) ?? []);
      setLoading(false);
    })();
  }, [supabase, orgId]);

  if (loading || !branding) return <div className="p-8"><LoadingSpinner /></div>;

  // Group by category
  const byCategory = new Map<string, Asset[]>();
  for (const a of assets) {
    const c = a.category ?? "Uncategorised";
    (byCategory.get(c) ?? byCategory.set(c, []).get(c)!).push(a);
  }

  const totals = assets.reduce((acc, a) => {
    const { accum, book } = bookValue(a);
    return { cost: acc.cost + a.purchase_cost, accum: acc.accum + accum, book: acc.book + book };
  }, { cost: 0, accum: 0, book: 0 });

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      <div className="no-print sticky top-0 z-10 text-white px-6 py-3 flex items-center justify-between shadow-md" style={{ background: branding.primaryColor }}>
        <div>
          <p className="text-xs uppercase tracking-wider font-bold" style={{ color: branding.accentColor }}>Depreciation Report · {branding.schoolName}</p>
          <p className="text-sm font-medium">{assets.length} active asset{assets.length === 1 ? "" : "s"} · Book value {fmtMoney(totals.book)}</p>
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
            eyebrow="Fixed Asset Register — Depreciation"
            accent="navy"
            right={
              <div>
                <p className="text-[10px] text-gray-500 uppercase font-bold">As at</p>
                <p className="text-sm font-bold" style={{ color: branding.primaryColor }}>{fmtDate(new Date().toISOString().slice(0, 10))}</p>
                <p className="text-[11px] text-gray-500 mt-0.5">Straight-line method</p>
              </div>
            }
          />

          {Array.from(byCategory.entries()).map(([category, list]) => {
            const catTotals = list.reduce((acc, a) => {
              const { accum, book } = bookValue(a);
              return { cost: acc.cost + a.purchase_cost, accum: acc.accum + accum, book: acc.book + book };
            }, { cost: 0, accum: 0, book: 0 });
            return (
              <section key={category} className="mb-5">
                <h3 className="text-xs uppercase font-bold tracking-wider mb-1" style={{ color: branding.accentColor }}>{category}</h3>
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr style={{ background: branding.primaryColor, color: "#fff" }}>
                      <th className="text-left px-2 py-1.5 border w-20">Code</th>
                      <th className="text-left px-2 py-1.5 border">Asset</th>
                      <th className="text-left px-2 py-1.5 border w-20">Purchased</th>
                      <th className="text-right px-2 py-1.5 border w-24">Cost</th>
                      <th className="text-right px-2 py-1.5 border w-14">Life</th>
                      <th className="text-right px-2 py-1.5 border w-24">Accum. depr.</th>
                      <th className="text-right px-2 py-1.5 border w-24">Book value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map(a => {
                      const { accum, book } = bookValue(a);
                      return (
                        <tr key={a.id}>
                          <td className="border px-2 py-1 font-mono text-gray-500">{a.asset_code}</td>
                          <td className="border px-2 py-1">{a.name}</td>
                          <td className="border px-2 py-1 text-gray-500">{a.purchase_date ? fmtDate(a.purchase_date) : "—"}</td>
                          <td className="border px-2 py-1 text-right">{fmtMoney(a.purchase_cost)}</td>
                          <td className="border px-2 py-1 text-right">{a.useful_life_years}y</td>
                          <td className="border px-2 py-1 text-right text-red-700">{fmtMoney(accum)}</td>
                          <td className="border px-2 py-1 text-right font-semibold">{fmtMoney(book)}</td>
                        </tr>
                      );
                    })}
                    <tr className="font-bold" style={{ background: "#F9F5EB" }}>
                      <td colSpan={3} className="border px-2 py-1.5">{category} subtotal</td>
                      <td className="border px-2 py-1.5 text-right">{fmtMoney(catTotals.cost)}</td>
                      <td className="border px-2 py-1.5"></td>
                      <td className="border px-2 py-1.5 text-right text-red-700">{fmtMoney(catTotals.accum)}</td>
                      <td className="border px-2 py-1.5 text-right">{fmtMoney(catTotals.book)}</td>
                    </tr>
                  </tbody>
                </table>
              </section>
            );
          })}

          <table className="w-full text-xs border-collapse mb-4">
            <tbody>
              <tr style={{ background: branding.accentColor, color: branding.primaryColor }}>
                <td className="px-2 py-2 font-bold">GRAND TOTAL</td>
                <td className="px-2 py-2 text-right font-bold">{fmtMoney(totals.cost)}</td>
                <td className="px-2 py-2 text-right font-bold">{fmtMoney(totals.accum)}</td>
                <td className="px-2 py-2 text-right font-bold">{fmtMoney(totals.book)}</td>
              </tr>
            </tbody>
          </table>

          <div className="mt-6 grid grid-cols-2 gap-8 text-[10px] text-gray-500">
            <div><p style={{ borderTop: `1px solid ${branding.primaryColor}` }}></p><p className="mt-1">Bursar</p></div>
            <div className="text-right"><p style={{ borderTop: `1px solid ${branding.primaryColor}` }}></p><p className="mt-1">Auditor</p></div>
          </div>

          <PrintableFooter branding={branding} />
        </div>
      </div>

      <style>{`@media print { @page { size: A4; margin: 15mm; } }`}</style>
    </div>
  );
}
