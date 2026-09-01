"use client";

/**
 * Purchase order detail — line items and receiving.
 *
 * Receiving goes through procurement_receive_item (server-side): it
 * refuses to over-receive past quantity_ordered, logs an append-only
 * receipt row (so partial deliveries over time have an audit trail),
 * credits inventory_items.quantity_on_hand when the line is linked to
 * an inventory item, and recomputes the parent order's status
 * (sent / partially_received / received) from the line totals.
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { useToast } from "@/lib/hooks/useToast";
import { extractErrorMessage } from "@/lib/errors/extractErrorMessage";
import { fmtMoney, fmtDate, fmtDateTime, cn } from "@/lib/utils";
import { PageHeader, LoadingSpinner, EmptyState } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { ArrowLeft, Package, CheckCircle2, Truck, Building2 } from "lucide-react";

interface OrderRow {
  id: string; order_code: string; request_id: string | null; vendor_id: string | null; status: string;
  expected_date: string | null; total_amount: number; notes: string | null; created_at: string;
}
interface OrderItemRow {
  id: string; order_id: string; inventory_item_id: string | null; item_name: string;
  quantity_ordered: number; quantity_received: number; unit_cost: number;
}
interface ReceiptRow {
  id: string; order_item_id: string; quantity_received: number; received_by_staff_id: string | null;
  received_at: string; notes: string | null;
}
interface VendorOption { id: string; name: string; vendor_code: string; contact_person: string | null; phone: string | null; email: string | null; }
interface StaffOption { id: string; full_name: string; }

export default function PurchaseOrderPage() {
  const params = useParams<{ orderId: string }>();
  const orderId = params.orderId;
  const { canEdit } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const { notify, ToastHost } = useToast();

  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState<OrderRow | null>(null);
  const [items, setItems] = useState<OrderItemRow[]>([]);
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [vendor, setVendor] = useState<VendorOption | null>(null);
  const [staff, setStaff] = useState<StaffOption[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const [oRes, iRes, sRes] = await Promise.all([
      supabase.from("procurement_orders").select("*").eq("id", orderId).maybeSingle(),
      supabase.from("procurement_order_items").select("*").eq("order_id", orderId),
      supabase.from("staff_members").select("id, full_name").eq("status", "active").order("full_name"),
    ]);
    const o = oRes.data as OrderRow | null;
    setOrder(o);
    setItems((iRes.data as OrderItemRow[]) ?? []);
    setStaff((sRes.data as StaffOption[]) ?? []);

    if (o?.vendor_id) {
      const { data: vData } = await supabase.from("vendors").select("id, name, vendor_code, contact_person, phone, email").eq("id", o.vendor_id).maybeSingle();
      setVendor(vData as VendorOption | null);
    } else {
      setVendor(null);
    }

    const itemIds = ((iRes.data as OrderItemRow[]) ?? []).map((i) => i.id);
    if (itemIds.length > 0) {
      const { data: rData } = await supabase.from("procurement_receipts").select("*").in("order_item_id", itemIds).order("received_at", { ascending: false });
      setReceipts((rData as ReceiptRow[]) ?? []);
    } else {
      setReceipts([]);
    }

    setLoading(false);
  }, [supabase, orderId]);

  useEffect(() => { load(); }, [load]);

  const staffById = useMemo(() => new Map(staff.map((s) => [s.id, s])), [staff]);
  const receiptsByItem = useMemo(() => {
    const map: Record<string, ReceiptRow[]> = {};
    for (const r of receipts) (map[r.order_item_id] ||= []).push(r);
    return map;
  }, [receipts]);

  /* ---------------- Send / cancel ---------------- */
  const [updatingStatus, setUpdatingStatus] = useState(false);

  async function sendOrder() {
    setUpdatingStatus(true);
    const { error } = await supabase.from("procurement_orders").update({ status: "sent" }).eq("id", orderId);
    setUpdatingStatus(false);
    if (error) { notify(extractErrorMessage(error, "Failed to send order."), "error"); return; }
    notify("Order marked as sent to vendor.");
    load();
  }

  async function cancelOrder() {
    if (!confirm("Cancel this order? This cannot be undone.")) return;
    setUpdatingStatus(true);
    const { error } = await supabase.from("procurement_orders").update({ status: "cancelled" }).eq("id", orderId);
    setUpdatingStatus(false);
    if (error) { notify(extractErrorMessage(error, "Failed to cancel order."), "error"); return; }
    notify("Order cancelled.");
    load();
  }

  /* ---------------- Receiving ---------------- */
  const [receivingItem, setReceivingItem] = useState<OrderItemRow | null>(null);
  const [receiveQty, setReceiveQty] = useState("");
  const [receivedBy, setReceivedBy] = useState("");
  const [receiveNotes, setReceiveNotes] = useState("");
  const [receiving, setReceiving] = useState(false);

  function openReceive(item: OrderItemRow) {
    setReceivingItem(item);
    setReceiveQty(String(item.quantity_ordered - item.quantity_received));
    setReceivedBy("");
    setReceiveNotes("");
  }

  async function confirmReceive() {
    if (!receivingItem) return;
    const qty = parseFloat(receiveQty);
    if (isNaN(qty) || qty <= 0) { notify("Enter a valid quantity.", "error"); return; }
    setReceiving(true);
    try {
      const { error } = await supabase.rpc("procurement_receive_item", {
        p_order_item_id: receivingItem.id,
        p_quantity: qty,
        p_received_by_staff_id: receivedBy || null,
        p_notes: receiveNotes.trim() || null,
      });
      if (error) throw error;
      notify(`Received ${qty} × ${receivingItem.item_name}.`);
      setReceivingItem(null);
      load();
    } catch (err) {
      notify(extractErrorMessage(err, "Receiving failed."), "error");
    } finally {
      setReceiving(false);
    }
  }

  if (loading) return <div className="p-6"><LoadingSpinner /></div>;
  if (!order) return <div className="p-6"><EmptyState message="Order not found." /></div>;

  const fullyReceived = items.length > 0 && items.every((i) => i.quantity_received >= i.quantity_ordered);

  return (
    <div className="p-6 space-y-5">
      <Link href="/dashboard/procurement" className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-[#0F2A47]">
        <ArrowLeft size={14} /> Back to Procurement
      </Link>

      <PageHeader title={order.order_code} subtitle={order.expected_date ? `Expected ${fmtDate(order.expected_date)}` : undefined}>
        <span className={cn(
          "text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full",
          order.status === "received" ? "bg-emerald-100 text-emerald-700" :
          order.status === "partially_received" ? "bg-blue-100 text-blue-700" :
          order.status === "cancelled" ? "bg-gray-200 text-gray-500" : "bg-amber-100 text-amber-700"
        )}>{order.status.replace("_", " ")}</span>
        {canEdit && order.status === "draft" && (
          <Button variant="gold" size="sm" onClick={sendOrder} loading={updatingStatus}><Truck size={14} /> Mark Sent</Button>
        )}
        {canEdit && (order.status === "draft" || order.status === "sent") && (
          <Button variant="danger" size="sm" onClick={cancelOrder} loading={updatingStatus}>Cancel Order</Button>
        )}
      </PageHeader>

      {vendor && (
        <Card className="!p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#0F2A47] text-white flex items-center justify-center shrink-0"><Building2 size={18} /></div>
          <div>
            <p className="text-sm font-semibold text-[#0F2A47]">{vendor.name} <span className="text-xs text-gray-400">{vendor.vendor_code}</span></p>
            <p className="text-xs text-gray-500">{vendor.contact_person || "No contact set"}{vendor.phone ? ` · ${vendor.phone}` : ""}{vendor.email ? ` · ${vendor.email}` : ""}</p>
          </div>
        </Card>
      )}

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-[#0F2A47]">Order Items ({items.length})</h3>
          <span className="text-sm font-bold text-[#0F2A47]">Total {fmtMoney(order.total_amount)}</span>
        </div>

        {items.length === 0 ? (
          <EmptyState message="No line items on this order." icon={<Package size={40} />} />
        ) : (
          <div className="space-y-2">
            {items.map((item) => {
              const outstanding = item.quantity_ordered - item.quantity_received;
              const itemReceipts = receiptsByItem[item.id] || [];
              return (
                <Card key={item.id} className="!p-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-gray-700">{item.item_name}</p>
                      <p className="text-xs text-gray-500">
                        {item.quantity_received} / {item.quantity_ordered} received · {fmtMoney(item.unit_cost)} each · line total {fmtMoney(item.quantity_ordered * item.unit_cost)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {outstanding <= 0 ? (
                        <span className="text-xs font-medium text-emerald-600 flex items-center gap-1"><CheckCircle2 size={12} /> Complete</span>
                      ) : (
                        canEdit && order.status !== "cancelled" && order.status !== "draft" && (
                          <Button variant="secondary" size="sm" onClick={() => openReceive(item)}>Receive</Button>
                        )
                      )}
                    </div>
                  </div>
                  {itemReceipts.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-gray-100 space-y-1">
                      {itemReceipts.map((r) => (
                        <p key={r.id} className="text-[11px] text-gray-400">
                          +{r.quantity_received} received {fmtDateTime(r.received_at)}
                          {r.received_by_staff_id ? ` by ${staffById.get(r.received_by_staff_id)?.full_name || "staff"}` : ""}
                          {r.notes ? ` — ${r.notes}` : ""}
                        </p>
                      ))}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Receive modal */}
      <Modal open={!!receivingItem} onClose={() => setReceivingItem(null)} title={`Receive — ${receivingItem?.item_name ?? ""}`}>
        <div className="space-y-3">
          <p className="text-xs text-gray-500">
            Outstanding: {receivingItem ? receivingItem.quantity_ordered - receivingItem.quantity_received : 0} of {receivingItem?.quantity_ordered ?? 0}
          </p>
          <Input label="Quantity received" type="number" value={receiveQty} onChange={(e) => setReceiveQty(e.target.value)} />
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Received by (optional)</label>
            <select value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white">
              <option value="">Not specified</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </select>
          </div>
          <Input label="Notes (optional)" value={receiveNotes} onChange={(e) => setReceiveNotes(e.target.value)} />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setReceivingItem(null)}>Cancel</Button>
            <Button variant="gold" onClick={confirmReceive} loading={receiving}>Confirm Receipt</Button>
          </div>
        </div>
      </Modal>

      <ToastHost />
    </div>
  );
}
