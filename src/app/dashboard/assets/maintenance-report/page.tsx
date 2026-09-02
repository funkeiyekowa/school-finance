"use client";

/**
 * Printable asset maintenance history + upcoming.
 * Every maintenance record grouped by asset, plus next-due
 * highlights.
 */

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { useBranding } from "@/lib/hooks/useBranding";
import { fmtDate, fmtMoney } from "@/lib/utils";
import { LoadingSpinner } from "@/components/ui/PageHeader";
import { PrintableLetterhead, PrintableFooter } from "@/components/print/PrintableLetterhead";
import { Printer } from "lucide-react";

interface Asset { id: string; asset_code: string; name: string; category: string | null; }
interface Maintenance {
  id: string; asset_id: string; maintenance_date: string; category: string;
  description: string | null; cost: number | null; next_due_date: string | null;
  performed_by: string | null;
}

export default function AssetMaintenanceReportPage() {
  const supabase = useMemo(() => createClient(), []);
  const { orgId } = useAuth();
  const branding = useBranding();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [maint, setMaint] = useState<Maintenance[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId) return;
    (async () => {
      const [a, m] = await Promise.all([
        supabase.from("assets").select("id, asset_code, name, category").neq("status", "disposed"),
        supabase.from("asset_maintenance").select("*").order("maintenance_date", { ascending: false }),
      ]);
      setAssets((a.data as Asset[]) ?? []);
      setMaint((m.data as Maintenance[]) ?? []);
      setLoading(false);
    })();
  }, [supabase, orgId]);

  if (loading || !branding) return <div className="p-8"><LoadingSpinner /></div>;

  const assetById = new Map(assets.map(a => [a.id, a]));
  const totalSpend = maint.reduce((s, m) => s + Number(m.cost ?? 0), 0);
  const today = new Date().toISOString().slice(0, 10);
  const dueSoon = maint.filter(m => m.next_due_date && m.next_due_date >= today).sort((a, b) => (a.next_due_date ?? "").localeCompare(b.next_due_date ?? "")).slice(0, 15);

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      <div className="no-print sticky top-0 z-10 text-white px-6 py-3 flex items-center justify-between shadow-md" style={{ background: branding.primaryColor }}>
        <div>
          <p className="text-xs uppercase tracking-wider font-bold" style={{ color: branding.accentColor }}>Maintenance Report · {branding.schoolName}</p>
          <p className="text-sm font-medium">{maint.length} record{maint.length === 1 ? "" : "s"} · Total spend {fmtMoney(totalSpend)}</p>
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
            eyebrow="Asset Maintenance Report"
            accent="rose"
            right={
              <div>
                <p className="text-[10px] text-gray-500 uppercase font-bold">Printed</p>
                <p className="text-sm font-bold" style={{ color: branding.primaryColor }}>{fmtDate(today)}</p>
                <p className="text-[11px] text-gray-500 mt-0.5">Total spend: <strong>{fmtMoney(totalSpend)}</strong></p>
              </div>
            }
          />

          {dueSoon.length > 0 && (
            <section className="mb-4">
              <h3 className="text-xs uppercase font-bold tracking-widest mb-1" style={{ color: branding.accentColor }}>Upcoming maintenance</h3>
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr style={{ background: branding.primaryColor, color: "#fff" }}>
                    <th className="text-left px-2 py-1.5 border w-24">Due date</th>
                    <th className="text-left px-2 py-1.5 border">Asset</th>
                    <th className="text-left px-2 py-1.5 border">Category</th>
                    <th className="text-left px-2 py-1.5 border">Last service</th>
                  </tr>
                </thead>
                <tbody>
                  {dueSoon.map(m => {
                    const a = assetById.get(m.asset_id);
                    return (
                      <tr key={m.id}>
                        <td className="border px-2 py-1 font-bold text-amber-700">{fmtDate(m.next_due_date!)}</td>
                        <td className="border px-2 py-1">{a ? `${a.asset_code} — ${a.name}` : "—"}</td>
                        <td className="border px-2 py-1 capitalize">{m.category}</td>
                        <td className="border px-2 py-1 text-gray-500">{fmtDate(m.maintenance_date)} ({m.performed_by ?? "—"})</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          )}

          <section>
            <h3 className="text-xs uppercase font-bold tracking-widest mb-1" style={{ color: branding.accentColor }}>History</h3>
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr style={{ background: branding.primaryColor, color: "#fff" }}>
                  <th className="text-left px-2 py-1.5 border w-24">Date</th>
                  <th className="text-left px-2 py-1.5 border">Asset</th>
                  <th className="text-left px-2 py-1.5 border">Description</th>
                  <th className="text-right px-2 py-1.5 border w-24">Cost</th>
                </tr>
              </thead>
              <tbody>
                {maint.length === 0 ? (
                  <tr><td colSpan={4} className="py-4 text-center text-gray-400 italic">No maintenance recorded.</td></tr>
                ) : maint.map(m => {
                  const a = assetById.get(m.asset_id);
                  return (
                    <tr key={m.id}>
                      <td className="border px-2 py-1">{fmtDate(m.maintenance_date)}</td>
                      <td className="border px-2 py-1">{a ? `${a.asset_code} — ${a.name}` : "—"}</td>
                      <td className="border px-2 py-1">{m.description ?? m.category}</td>
                      <td className="border px-2 py-1 text-right">{m.cost != null ? fmtMoney(m.cost) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          <div className="mt-6 grid grid-cols-2 gap-8 text-[10px] text-gray-500">
            <div><p style={{ borderTop: `1px solid ${branding.primaryColor}` }}></p><p className="mt-1">Store Keeper</p></div>
            <div className="text-right"><p style={{ borderTop: `1px solid ${branding.primaryColor}` }}></p><p className="mt-1">Bursar</p></div>
          </div>

          <PrintableFooter branding={branding} />
        </div>
      </div>

      <style>{`@media print { @page { size: A4; margin: 15mm; } }`}</style>
    </div>
  );
}
