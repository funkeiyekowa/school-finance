"use client";

/**
 * Procurement module — purchase requests with approval, converted
 * into purchase orders placed with a vendor.
 *
 * Two tabs:
 *   Requests — staff submit a request with line items; an approver
 *              (canEdit) approves or rejects via a server-side RPC
 *              (procurement_review_request), then converts an
 *              approved request into a purchase order
 *              (procurement_convert_request_to_order), which copies
 *              every line item across and marks the request 'ordered'
 *              so it can't be converted twice.
 *   Orders   — list of purchase orders; click into one at
 *              /dashboard/procurement/orders/[orderId] to receive
 *              against its line items (server-side, credits matching
 *              inventory_items.quantity_on_hand).
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { useToast } from "@/lib/hooks/useToast";
import { extractErrorMessage } from "@/lib/errors/extractErrorMessage";
import { fmtMoney, fmtDate, cn, generateCode } from "@/lib/utils";
import { PageHeader, LoadingSpinner, EmptyState, KpiCard } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import {
  ClipboardList, Plus, ShoppingCart, CheckCircle2, XCircle, ChevronRight,
  Trash2, DollarSign, Package, ArrowRight,
} from "lucide-react";

interface RequestRow {
  id: string; request_code: string; requested_by_staff_id: string | null; department_id: string | null;
  justification: string | null; status: string; review_notes: string | null; reviewed_at: string | null; created_at: string;
}
interface RequestItemRow {
  id: string; request_id: string; inventory_item_id: string | null; item_name: string;
  quantity: number; estimated_unit_cost: number | null; notes: string | null;
}
interface OrderRow {
  id: string; order_code: string; request_id: string | null; vendor_id: string | null; status: string;
  expected_date: string | null; total_amount: number; notes: string | null; created_at: string;
}
interface StaffOption { id: string; full_name: string; }
interface DeptOption { id: string; name: string; }
interface VendorOption { id: string; name: string; vendor_code: string; }
interface InventoryOption { id: string; name: string; }
interface Stats { pending_requests: number; open_orders: number; total_open_order_value: number; received_this_month: number; }

type Tab = "requests" | "orders";

export default function ProcurementPage() {
  const { canEdit, orgId } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const { notify, ToastHost } = useToast();

  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("requests");

  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [requestItems, setRequestItems] = useState<RequestItemRow[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [departments, setDepartments] = useState<DeptOption[]>([]);
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryOption[]>([]);
  const [stats, setStats] = useState<Stats>({ pending_requests: 0, open_orders: 0, total_open_order_value: 0, received_this_month: 0 });

  const load = useCallback(async () => {
    setLoading(true);
    const [rRes, riRes, oRes, sRes, dRes, vRes, invRes, statsRes] = await Promise.all([
      supabase.from("procurement_requests").select("*").order("created_at", { ascending: false }),
      supabase.from("procurement_request_items").select("*"),
      supabase.from("procurement_orders").select("*").order("created_at", { ascending: false }),
      supabase.from("staff_members").select("id, full_name").eq("status", "active").order("full_name"),
      supabase.from("departments").select("id, name").order("name"),
      supabase.from("vendors").select("id, name, vendor_code").order("name"),
      supabase.from("inventory_items").select("id, name").eq("active", true).order("name"),
      supabase.rpc("procurement_stats"),
    ]);
    setRequests((rRes.data as RequestRow[]) ?? []);
    setRequestItems((riRes.data as RequestItemRow[]) ?? []);
    setOrders((oRes.data as OrderRow[]) ?? []);
    setStaff((sRes.data as StaffOption[]) ?? []);
    setDepartments((dRes.data as DeptOption[]) ?? []);
    setVendors((vRes.data as VendorOption[]) ?? []);
    setInventoryItems((invRes.data as InventoryOption[]) ?? []);
    if (statsRes.data && statsRes.data[0]) {
      const s = statsRes.data[0];
      setStats({
        pending_requests: s.pending_requests || 0,
        open_orders: s.open_orders || 0,
        total_open_order_value: s.total_open_order_value || 0,
        received_this_month: s.received_this_month || 0,
      });
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const staffById = useMemo(() => new Map(staff.map((s) => [s.id, s])), [staff]);
  const deptById = useMemo(() => new Map(departments.map((d) => [d.id, d])), [departments]);
  const vendorById = useMemo(() => new Map(vendors.map((v) => [v.id, v])), [vendors]);
  const itemsByRequest = useMemo(() => {
    const map: Record<string, RequestItemRow[]> = {};
    for (const item of requestItems) (map[item.request_id] ||= []).push(item);
    return map;
  }, [requestItems]);

  /* ---------------- New request ---------------- */
  const [showRequestForm, setShowRequestForm] = useState(false);
  const emptyLine = { inventory_item_id: "", item_name: "", quantity: "1", estimated_unit_cost: "" };
  const [requestForm, setRequestForm] = useState({ requested_by_staff_id: "", department_id: "", justification: "" });
  const [lines, setLines] = useState([{ ...emptyLine }]);
  const [savingRequest, setSavingRequest] = useState(false);

  function updateLine(idx: number, patch: Partial<typeof emptyLine>) {
    setLines((prev) => prev.map((l, i) => i === idx ? { ...l, ...patch } : l));
  }
  function addLine() { setLines((prev) => [...prev, { ...emptyLine }]); }
  function removeLine(idx: number) { setLines((prev) => prev.filter((_, i) => i !== idx)); }

  async function submitRequest() {
    const validLines = lines.filter((l) => l.item_name.trim());
    if (validLines.length === 0) { notify("Add at least one item.", "error"); return; }
    setSavingRequest(true);
    try {
      const code = generateCode("PR-", requests.map((r) => r.request_code));
      const { data: reqData, error: reqError } = await supabase.from("procurement_requests").insert({
        request_code: code,
        requested_by_staff_id: requestForm.requested_by_staff_id || null,
        department_id: requestForm.department_id || null,
        justification: requestForm.justification.trim() || null,
        organization_id: orgId,
      }).select().single();
      if (reqError) throw reqError;
      const newRequest = reqData as RequestRow;

      const itemRows = validLines.map((l) => ({
        request_id: newRequest.id,
        inventory_item_id: l.inventory_item_id || null,
        item_name: l.item_name.trim(),
        quantity: parseFloat(l.quantity) || 1,
        estimated_unit_cost: l.estimated_unit_cost.trim() ? parseFloat(l.estimated_unit_cost) : null,
        organization_id: orgId,
      }));
      const { error: itemsError } = await supabase.from("procurement_request_items").insert(itemRows);
      if (itemsError) throw itemsError;

      notify(`Request ${code} submitted.`);
      setShowRequestForm(false);
      setRequestForm({ requested_by_staff_id: "", department_id: "", justification: "" });
      setLines([{ ...emptyLine }]);
      load();
    } catch (err) {
      notify(extractErrorMessage(err, "Failed to submit request."), "error");
    } finally {
      setSavingRequest(false);
    }
  }

  /* ---------------- Review ---------------- */
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [reviewTarget, setReviewTarget] = useState<{ request: RequestRow; approve: boolean } | null>(null);

  async function submitReview() {
    if (!reviewTarget) return;
    setReviewing(reviewTarget.request.id);
    try {
      const { error } = await supabase.rpc("procurement_review_request", {
        p_request_id: reviewTarget.request.id,
        p_approve: reviewTarget.approve,
        p_notes: reviewNotes.trim() || null,
      });
      if (error) throw error;
      notify(reviewTarget.approve ? "Request approved." : "Request rejected.");
      setReviewTarget(null);
      setReviewNotes("");
      load();
    } catch (err) {
      notify(extractErrorMessage(err, "Review failed."), "error");
    } finally {
      setReviewing(null);
    }
  }

  /* ---------------- Convert to order ---------------- */
  const [convertingRequest, setConvertingRequest] = useState<RequestRow | null>(null);
  const [convertVendor, setConvertVendor] = useState("");
  const [convertExpectedDate, setConvertExpectedDate] = useState("");
  const [converting, setConverting] = useState(false);

  async function confirmConvert() {
    if (!convertingRequest) return;
    setConverting(true);
    try {
      const { data, error } = await supabase.rpc("procurement_convert_request_to_order", {
        p_request_id: convertingRequest.id,
        p_vendor_id: convertVendor || null,
        p_expected_date: convertExpectedDate || null,
      });
      if (error) throw error;
      notify("Purchase order created.");
      setConvertingRequest(null);
      setConvertVendor("");
      setConvertExpectedDate("");
      load();
    } catch (err) {
      notify(extractErrorMessage(err, "Conversion failed."), "error");
    } finally {
      setConverting(false);
    }
  }

  const [expandedRequest, setExpandedRequest] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const filteredRequests = requests.filter((r) => statusFilter === "all" || r.status === statusFilter);

  const TABS: { key: Tab; label: string; icon: React.ReactNode; count?: number }[] = [
    { key: "requests", label: "Requests", icon: <ClipboardList size={14} />, count: stats.pending_requests },
    { key: "orders", label: "Orders", icon: <ShoppingCart size={14} />, count: stats.open_orders },
  ];

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="Procurement" subtitle="Purchase requests, approvals, and vendor orders.">
        {canEdit && tab === "requests" && (
          <Button variant="gold" onClick={() => setShowRequestForm(true)}><Plus size={16} /> New Request</Button>
        )}
      </PageHeader>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Pending Requests" value={String(stats.pending_requests)} icon={<ClipboardList size={18} />} colorClass={stats.pending_requests > 0 ? "text-amber-600" : "text-[#0F2A47]"} />
        <KpiCard label="Open Orders" value={String(stats.open_orders)} icon={<ShoppingCart size={18} />} />
        <KpiCard label="Open Order Value" value={fmtMoney(stats.total_open_order_value)} icon={<DollarSign size={18} />} />
        <KpiCard label="Received this Month" value={String(stats.received_this_month)} icon={<Package size={18} />} />
      </div>

      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap",
              tab === t.key ? "border-[#C9A227] text-[#0F2A47]" : "border-transparent text-gray-500 hover:text-gray-700"
            )}
          >
            {t.icon} {t.label}
            {typeof t.count === "number" && t.count > 0 && (
              <span className="text-[10px] font-bold bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full">{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {loading ? <LoadingSpinner /> : (
        <>
          {tab === "requests" && (
            <div className="space-y-4">
              <div className="flex gap-1.5 flex-wrap">
                {["all", "pending", "approved", "rejected", "ordered"].map((s) => (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={cn(
                      "text-xs font-medium px-3 py-1.5 rounded-full border capitalize",
                      statusFilter === s ? "bg-[#0F2A47] text-white border-[#0F2A47]" : "bg-white border-gray-200 text-gray-600"
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>

              {filteredRequests.length === 0 ? (
                <EmptyState message="No purchase requests." icon={<ClipboardList size={40} />} />
              ) : (
                <div className="space-y-2">
                  {filteredRequests.map((r) => {
                    const items = itemsByRequest[r.id] || [];
                    const estTotal = items.reduce((sum, i) => sum + (i.quantity * (i.estimated_unit_cost || 0)), 0);
                    const expanded = expandedRequest === r.id;
                    return (
                      <Card key={r.id}>
                        <div className="flex items-start justify-between gap-3 cursor-pointer" onClick={() => setExpandedRequest(expanded ? null : r.id)}>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-[#0F2A47]">{r.request_code}</span>
                              <span className={cn(
                                "text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full",
                                r.status === "approved" ? "bg-emerald-100 text-emerald-700" :
                                r.status === "rejected" ? "bg-red-100 text-red-700" :
                                r.status === "ordered" ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"
                              )}>{r.status}</span>
                            </div>
                            <p className="text-xs text-gray-500 mt-0.5">
                              {r.requested_by_staff_id ? staffById.get(r.requested_by_staff_id)?.full_name || "Unknown staff" : "No requester"}
                              {r.department_id ? ` · ${deptById.get(r.department_id)?.name || ""}` : ""}
                              {" · "}{items.length} item{items.length === 1 ? "" : "s"}
                              {estTotal > 0 ? ` · est. ${fmtMoney(estTotal)}` : ""}
                            </p>
                          </div>
                          {canEdit && r.status === "pending" && (
                            <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                              <Button variant="secondary" size="sm" onClick={() => setReviewTarget({ request: r, approve: true })}><CheckCircle2 size={12} /> Approve</Button>
                              <Button variant="secondary" size="sm" onClick={() => setReviewTarget({ request: r, approve: false })}><XCircle size={12} /> Reject</Button>
                            </div>
                          )}
                          {canEdit && r.status === "approved" && (
                            <Button variant="gold" size="sm" onClick={(e) => { e.stopPropagation(); setConvertingRequest(r); }}><ArrowRight size={12} /> Convert to Order</Button>
                          )}
                        </div>

                        {expanded && (
                          <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
                            {r.justification && <p className="text-xs text-gray-500 italic">&ldquo;{r.justification}&rdquo;</p>}
                            {items.map((i) => (
                              <div key={i.id} className="flex items-center justify-between text-xs bg-gray-50 rounded-lg px-3 py-2">
                                <span className="text-gray-700">{i.item_name} × {i.quantity}</span>
                                {i.estimated_unit_cost != null && <span className="text-gray-500">{fmtMoney(i.estimated_unit_cost)} each</span>}
                              </div>
                            ))}
                            {r.review_notes && (
                              <p className="text-xs text-gray-500 italic">Review note: {r.review_notes}</p>
                            )}
                          </div>
                        )}
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {tab === "orders" && (
            orders.length === 0 ? (
              <EmptyState message="No purchase orders yet — approve a request and convert it to get started." icon={<ShoppingCart size={40} />} />
            ) : (
              <div className="space-y-2">
                {orders.map((o) => (
                  <Link key={o.id} href={`/dashboard/procurement/orders/${o.id}`}>
                    <Card className="flex items-center justify-between hover:shadow-md transition-shadow cursor-pointer !p-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-[#0F2A47]">{o.order_code}</span>
                          <span className={cn(
                            "text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full",
                            o.status === "received" ? "bg-emerald-100 text-emerald-700" :
                            o.status === "partially_received" ? "bg-blue-100 text-blue-700" :
                            o.status === "cancelled" ? "bg-gray-200 text-gray-500" : "bg-amber-100 text-amber-700"
                          )}>{o.status.replace("_", " ")}</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {o.vendor_id ? vendorById.get(o.vendor_id)?.name || "Unknown vendor" : "No vendor set"}
                          {o.expected_date ? ` · expected ${fmtDate(o.expected_date)}` : ""} · {fmtMoney(o.total_amount)}
                        </p>
                      </div>
                      <ChevronRight size={14} className="text-gray-300" />
                    </Card>
                  </Link>
                ))}
              </div>
            )
          )}
        </>
      )}

      {/* New request form */}
      <Modal open={showRequestForm} onClose={() => setShowRequestForm(false)} title="New Purchase Request" size="xl">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Requested by"
              value={requestForm.requested_by_staff_id}
              onChange={(e) => setRequestForm({ ...requestForm, requested_by_staff_id: e.target.value })}
              options={staff.map((s) => ({ value: s.id, label: s.full_name }))}
              placeholder="Select staff"
            />
            <Select
              label="Department (optional)"
              value={requestForm.department_id}
              onChange={(e) => setRequestForm({ ...requestForm, department_id: e.target.value })}
              options={departments.map((d) => ({ value: d.id, label: d.name }))}
              placeholder="No department"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Justification (optional)</label>
            <textarea
              value={requestForm.justification}
              onChange={(e) => setRequestForm({ ...requestForm, justification: e.target.value })}
              rows={2}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-gray-700">Items</label>
              <button onClick={addLine} className="text-xs text-[#0F2A47] hover:text-[#C9A227] flex items-center gap-1"><Plus size={12} /> Add line</button>
            </div>
            {lines.map((line, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-start">
                <div className="col-span-5">
                  <input
                    value={line.item_name}
                    onChange={(e) => updateLine(idx, { item_name: e.target.value })}
                    placeholder="Item name"
                    className="w-full px-2.5 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
                <div className="col-span-3">
                  <select
                    value={line.inventory_item_id}
                    onChange={(e) => updateLine(idx, { inventory_item_id: e.target.value })}
                    className="w-full px-2.5 py-2 border border-gray-300 rounded-lg text-xs bg-white"
                  >
                    <option value="">Link to inventory (optional)</option>
                    {inventoryItems.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                  </select>
                </div>
                <div className="col-span-2">
                  <input
                    type="number"
                    value={line.quantity}
                    onChange={(e) => updateLine(idx, { quantity: e.target.value })}
                    placeholder="Qty"
                    className="w-full px-2.5 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
                <div className="col-span-1">
                  <input
                    type="number"
                    value={line.estimated_unit_cost}
                    onChange={(e) => updateLine(idx, { estimated_unit_cost: e.target.value })}
                    placeholder="Cost"
                    className="w-full px-2.5 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
                <div className="col-span-1 flex justify-center pt-2">
                  {lines.length > 1 && (
                    <button onClick={() => removeLine(idx)} className="text-red-400 hover:text-red-600"><Trash2 size={14} /></button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowRequestForm(false)}>Cancel</Button>
            <Button variant="gold" onClick={submitRequest} loading={savingRequest}>Submit Request</Button>
          </div>
        </div>
      </Modal>

      {/* Review modal */}
      <Modal open={!!reviewTarget} onClose={() => setReviewTarget(null)} title={reviewTarget?.approve ? "Approve Request" : "Reject Request"}>
        <div className="space-y-3">
          <p className="text-sm text-gray-600">{reviewTarget?.request.request_code}</p>
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Notes (optional)</label>
            <textarea
              value={reviewNotes}
              onChange={(e) => setReviewNotes(e.target.value)}
              rows={2}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setReviewTarget(null)}>Cancel</Button>
            <Button variant={reviewTarget?.approve ? "gold" : "danger"} onClick={submitReview} loading={!!reviewing}>
              {reviewTarget?.approve ? "Approve" : "Reject"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Convert to order */}
      <Modal open={!!convertingRequest} onClose={() => setConvertingRequest(null)} title={`Convert ${convertingRequest?.request_code ?? ""} to Order`}>
        <div className="space-y-3">
          <Select
            label="Vendor (optional)"
            value={convertVendor}
            onChange={(e) => setConvertVendor(e.target.value)}
            options={vendors.map((v) => ({ value: v.id, label: v.name }))}
            placeholder="Choose later"
          />
          <Input label="Expected date (optional)" type="date" value={convertExpectedDate} onChange={(e) => setConvertExpectedDate(e.target.value)} />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setConvertingRequest(null)}>Cancel</Button>
            <Button variant="gold" onClick={confirmConvert} loading={converting}>Create Order</Button>
          </div>
        </div>
      </Modal>

      <ToastHost />
    </div>
  );
}
