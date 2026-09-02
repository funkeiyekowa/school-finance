"use client";

/**
 * Printable inventory stock-take sheet.
 *
 * Lists every active inventory item with its book quantity so a
 * staff member can count physically and write the observed count
 * (plus variance) beside it. Optional filter by category or
 * location keeps the sheet manageable for large inventories.
 */

import { Suspense, useEffect, useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { useBranding } from "@/lib/hooks/useBranding";
import { fmtDate } from "@/lib/utils";
import { LoadingSpinner } from "@/components/ui/PageHeader";
import { PrintableLetterhead, PrintableFooter } from "@/components/print/PrintableLetterhead";
import { Printer } from "lucide-react";

interface Item {
  id: string; name: string; item_code: string | null; category: string | null;
  unit: string; quantity_on_hand: number; location: string | null;
}

export default function StocktakePrintPage() {
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

  const filterCategory = params.get("category") ?? "";
  const filterLocation = params.get("location") ?? "";

  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId) return;
    (async () => {
      let q = supabase.from("inventory_items")
        .select("id, name, item_code, category, unit, quantity_on_hand, location")
        .eq("active", true);
      if (filterCategory) q = q.eq("category", filterCategory);
      if (filterLocation) q = q.eq("location", filterLocation);
      const { data } = await q.order("name");
      setItems((data as Item[]) ?? []);
      setLoading(false);
    })();
  }, [supabase, orgId, filterCategory, filterLocation]);

  if (loading || !branding) return <div className="p-8"><LoadingSpinner /></div>;

  const today = fmtDate(new Date().toISOString().slice(0, 10));

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      <div className="no-print sticky top-0 z-10 text-white px-6 py-3 flex items-center justify-between shadow-md" style={{ background: branding.primaryColor }}>
        <div>
          <p className="text-xs uppercase tracking-wider font-bold" style={{ color: branding.accentColor }}>Stock-take Sheet · {branding.schoolName}</p>
          <p className="text-sm font-medium">
            {items.length} item{items.length === 1 ? "" : "s"}
            {filterCategory ? ` · Category: ${filterCategory}` : ""}
            {filterLocation ? ` · Location: ${filterLocation}` : ""}
          </p>
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
            eyebrow="Physical Stock-take Sheet"
            accent="amber"
            right={
              <div>
                <p className="text-[10px] text-gray-500 uppercase font-bold">Date</p>
                <p className="text-sm font-bold" style={{ color: branding.primaryColor }}>{today}</p>
                {filterCategory && <p className="text-[11px] text-gray-500 mt-0.5">Category: {filterCategory}</p>}
                {filterLocation && <p className="text-[11px] text-gray-500">Location: {filterLocation}</p>}
              </div>
            }
          />

          {items.length === 0 ? (
            <p className="py-6 text-center text-gray-400 italic">No items match this filter.</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr style={{ background: branding.primaryColor, color: "#fff" }}>
                  <th className="text-left px-2 py-2 w-10">#</th>
                  <th className="text-left px-2 py-2">Item</th>
                  <th className="text-left px-2 py-2 w-24">Code</th>
                  <th className="text-left px-2 py-2 w-24">Location</th>
                  <th className="text-left px-2 py-2 w-16">Unit</th>
                  <th className="text-right px-2 py-2 w-20">Book qty</th>
                  <th className="text-right px-2 py-2 w-20">Counted</th>
                  <th className="text-right px-2 py-2 w-20">Variance</th>
                  <th className="text-left px-2 py-2 w-40">Notes</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={it.id} className="border-b border-gray-100">
                    <td className="px-2 py-2 text-gray-500">{i + 1}</td>
                    <td className="px-2 py-2 font-medium">{it.name}</td>
                    <td className="px-2 py-2 text-gray-500 font-mono">{it.item_code ?? "—"}</td>
                    <td className="px-2 py-2 text-gray-500">{it.location ?? "—"}</td>
                    <td className="px-2 py-2 text-gray-500">{it.unit}</td>
                    <td className="px-2 py-2 text-right font-semibold">{it.quantity_on_hand}</td>
                    <td className="px-2 py-2 border-l border-r h-8"></td>
                    <td className="px-2 py-2 border-r h-8"></td>
                    <td className="px-2 py-2 h-8"></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="mt-8 grid grid-cols-2 gap-8 text-[10px] text-gray-500">
            <div>
              <p style={{ borderTop: `1px solid ${branding.primaryColor}` }}></p>
              <p className="mt-1">Counted by</p>
              <p className="font-semibold text-xs" style={{ color: branding.primaryColor }}>Name & signature</p>
            </div>
            <div>
              <p style={{ borderTop: `1px solid ${branding.primaryColor}` }}></p>
              <p className="mt-1">Verified by</p>
              <p className="font-semibold text-xs" style={{ color: branding.primaryColor }}>Store keeper</p>
            </div>
          </div>

          <PrintableFooter branding={branding} />
        </div>
      </div>

      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 12mm; }
        }
      `}</style>
    </div>
  );
}
