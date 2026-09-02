"use client";

/**
 * Printable purchase order.
 *
 * Formal PO on the school letterhead with vendor block, itemised line
 * items, running totals, and signature space for buyer + vendor. Ready
 * to email or hand over.
 */

import { useEffect, useState, useMemo } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { useBranding } from "@/lib/hooks/useBranding";
import { fmtDate, fmtMoney } from "@/lib/utils";
import { LoadingSpinner } from "@/components/ui/PageHeader";
import { PrintableLetterhead, PrintableFooter } from "@/components/print/PrintableLetterhead";
import { Printer } from "lucide-react";

interface OrderRow {
  id: string; order_code: string; vendor_id: string | null; status: string;
  expected_date: string | null; total_amount: number; notes: string | null; created_at: string;
}
interface OrderItemRow {
  id: string; item_name: string; quantity_ordered: number; quantity_received: number; unit_cost: number;
}
interface Vendor {
  id: string; name: string; vendor_code: string;
  contact_person: string | null; phone: string | null; email: string | null; address: string | null;
}

export default function PurchaseOrderPrintPage() {
  const params = useParams<{ orderId: string }>();
  const supabase = useMemo(() => createClient(), []);
  const { profile } = useAuth();
  const branding = useBranding();

  const [order, setOrder] = useState<OrderRow | null>(null);
  const [items, setItems] = useState<OrderItemRow[]>([]);
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [oRes, iRes] = await Promise.all([
        supabase.from("procurement_orders").select("*").eq("id", params.orderId).maybeSingle(),
        supabase.from("procurement_order_items").select("id, item_name, quantity_ordered, quantity_received, unit_cost").eq("order_id", params.orderId),
      ]);
      const o = oRes.data as OrderRow | null;
      setOrder(o);
      setItems((iRes.data as OrderItemRow[]) ?? []);
      if (o?.vendor_id) {
        const { data: v } = await supabase.from("vendors").select("*").eq("id", o.vendor_id).maybeSingle();
        setVendor(v as Vendor ?? null);
      }
      setLoading(false);
    })();
  }, [supabase, params.orderId]);

  if (loading || !branding) return <div className="p-8"><LoadingSpinner /></div>;
  if (!order) return <div className="p-8 text-center text-gray-500">Purchase order not found.</div>;

  const subtotal = items.reduce((sum, it) => sum + (it.quantity_ordered * it.unit_cost), 0);

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      <div className="no-print sticky top-0 z-10 text-white px-6 py-3 flex items-center justify-between shadow-md" style={{ background: branding.primaryColor }}>
        <div>
          <p className="text-xs uppercase tracking-wider font-bold" style={{ color: branding.accentColor }}>Purchase Order · {branding.schoolName}</p>
          <p className="text-sm font-medium">{order.order_code} · {vendor?.name ?? "No vendor"}</p>
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
        <div className="bg-white shadow-sm rounded-lg p-10 print:shadow-none print:rounded-none">
          <PrintableLetterhead
            branding={branding}
            eyebrow="Purchase Order"
            accent="navy"
            right={
              <div>
                <p className="text-[10px] text-gray-500 uppercase font-bold">PO number</p>
                <p className="text-lg font-bold" style={{ color: branding.primaryColor }}>{order.order_code}</p>
                <p className="text-[11px] text-gray-500 mt-0.5">Issued {fmtDate(order.created_at.slice(0, 10))}</p>
                {order.expected_date && (
                  <p className="text-[11px] text-gray-500">Expected {fmtDate(order.expected_date)}</p>
                )}
              </div>
            }
          />

          {/* Vendor block */}
          <div className="grid grid-cols-2 gap-6 mb-6 text-sm">
            <div>
              <p className="text-[10px] uppercase font-bold" style={{ color: branding.accentColor }}>Vendor</p>
              <p className="font-semibold text-base" style={{ color: branding.primaryColor }}>{vendor?.name ?? "—"}</p>
              {vendor?.vendor_code && <p className="text-xs text-gray-500">Code: {vendor.vendor_code}</p>}
              {vendor?.contact_person && <p className="text-xs text-gray-500 mt-1">Attn: {vendor.contact_person}</p>}
              {vendor?.address && <p className="text-xs text-gray-500 mt-1">{vendor.address}</p>}
              {(vendor?.phone || vendor?.email) && (
                <p className="text-xs text-gray-500">
                  {[vendor.phone, vendor.email].filter(Boolean).join(" · ")}
                </p>
              )}
            </div>
            <div>
              <p className="text-[10px] uppercase font-bold" style={{ color: branding.accentColor }}>Deliver to</p>
              <p className="font-semibold text-base" style={{ color: branding.primaryColor }}>{branding.schoolName}</p>
              {branding.address && <p className="text-xs text-gray-500">{branding.address}</p>}
              {(branding.phone || branding.email) && (
                <p className="text-xs text-gray-500">
                  {[branding.phone, branding.email].filter(Boolean).join(" · ")}
                </p>
              )}
              <p className="text-[10px] text-gray-500 uppercase font-bold mt-3">Status</p>
              <p className="text-xs capitalize font-medium">{order.status}</p>
            </div>
          </div>

          {/* Line items */}
          <table className="w-full text-xs mb-4">
            <thead>
              <tr style={{ background: branding.primaryColor, color: "#fff" }}>
                <th className="text-left px-2 py-2">Item</th>
                <th className="text-right px-2 py-2 w-16">Qty</th>
                <th className="text-right px-2 py-2 w-24">Unit cost</th>
                <th className="text-right px-2 py-2 w-24">Line total</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr><td colSpan={4} className="py-4 text-center text-gray-400 italic">No line items.</td></tr>
              ) : items.map((it) => (
                <tr key={it.id} className="border-b border-gray-100">
                  <td className="px-2 py-1.5">{it.item_name}</td>
                  <td className="px-2 py-1.5 text-right">{it.quantity_ordered}</td>
                  <td className="px-2 py-1.5 text-right">{fmtMoney(it.unit_cost)}</td>
                  <td className="px-2 py-1.5 text-right font-semibold">{fmtMoney(it.quantity_ordered * it.unit_cost)}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={3} className="px-2 py-2 text-right font-bold" style={{ borderTop: `2px solid ${branding.primaryColor}` }}>Subtotal</td>
                <td className="px-2 py-2 text-right font-bold" style={{ borderTop: `2px solid ${branding.primaryColor}` }}>{fmtMoney(subtotal)}</td>
              </tr>
              <tr>
                <td colSpan={3} className="px-2 py-2 text-right font-bold text-base" style={{ background: branding.accentColor, color: branding.primaryColor }}>TOTAL</td>
                <td className="px-2 py-2 text-right font-bold text-base" style={{ background: branding.accentColor, color: branding.primaryColor }}>{fmtMoney(order.total_amount || subtotal)}</td>
              </tr>
            </tbody>
          </table>

          {order.notes && (
            <div className="mb-4">
              <p className="text-[10px] text-gray-500 uppercase font-bold">Notes</p>
              <p className="text-xs whitespace-pre-wrap">{order.notes}</p>
            </div>
          )}

          {/* Signatures */}
          <div className="mt-10 grid grid-cols-2 gap-8 text-[10px] text-gray-500">
            <div>
              <p style={{ borderTop: `1px solid ${branding.primaryColor}` }}></p>
              <p className="mt-1">Authorised by</p>
              <p className="font-semibold text-xs" style={{ color: branding.primaryColor }}>{profile?.full_name ?? "The Bursar"}</p>
              <p>{branding.schoolName}</p>
            </div>
            <div>
              <p style={{ borderTop: `1px solid ${branding.primaryColor}` }}></p>
              <p className="mt-1">Vendor acknowledgement</p>
              <p className="font-semibold text-xs" style={{ color: branding.primaryColor }}>{vendor?.contact_person ?? "Vendor Rep."}</p>
              <p>{vendor?.name ?? ""}</p>
            </div>
          </div>

          <PrintableFooter branding={branding} />
        </div>
      </div>

      <style>{`
        @media print {
          @page { size: A4; margin: 15mm; }
        }
      `}</style>
    </div>
  );
}
