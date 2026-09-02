"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { useToast } from "@/lib/hooks/useToast";
import { fmtMoney, cn } from "@/lib/utils";
import { BulkImportModal } from "@/components/import/BulkImportModal";
import { PageHeader, LoadingSpinner, EmptyState } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Plus, Save, Package, Search, TrendingUp, TrendingDown, Printer, UploadCloud } from "lucide-react";

interface ItemRow { id: string; name: string; item_code: string | null; category: string | null; unit: string; quantity_on_hand: number; reorder_level: number; unit_cost: number | null; location: string | null; }

export default function InventoryPage() {
  const { canEdit, profile, orgId } = useAuth();
  const supabase = createClient();
  const { notify, ToastHost } = useToast();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [search, setSearch] = useState("");

  // Item form
  const [showItemForm, setShowItemForm] = useState(false);
  const [savingItem, setSavingItem] = useState(false);
  const [editingItem, setEditingItem] = useState<ItemRow | null>(null);
  const [itemForm, setItemForm] = useState({ name: "", item_code: "", category: "", unit: "pcs", quantity_on_hand: "0", reorder_level: "0", unit_cost: "", location: "" });

  // Stock movement form
  const [showMoveForm, setShowMoveForm] = useState(false);
  const [savingMove, setSavingMove] = useState(false);
  const [moveItem, setMoveItem] = useState<ItemRow | null>(null);
  const [moveForm, setMoveForm] = useState({ movement_type: "stock_in", quantity: "", reference: "", reason: "" });
  const [showBulk, setShowBulk] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from("inventory_items").select("*").eq("active", true).order("name");
    setItems(data as ItemRow[] ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  function openItemForm(item?: ItemRow) {
    if (item) {
      setEditingItem(item);
      setItemForm({ name: item.name, item_code: item.item_code || "", category: item.category || "", unit: item.unit, quantity_on_hand: String(item.quantity_on_hand), reorder_level: String(item.reorder_level), unit_cost: item.unit_cost ? String(item.unit_cost) : "", location: item.location || "" });
    } else {
      setEditingItem(null);
      setItemForm({ name: "", item_code: "", category: "", unit: "pcs", quantity_on_hand: "0", reorder_level: "0", unit_cost: "", location: "" });
    }
    setShowItemForm(true);
  }

  async function saveItem() {
    if (!itemForm.name.trim()) { notify("Item name is required.", "error"); return; }
    setSavingItem(true);
    const payload = { name: itemForm.name.trim(), item_code: itemForm.item_code.trim() || null, category: itemForm.category.trim() || null, unit: itemForm.unit, quantity_on_hand: parseFloat(itemForm.quantity_on_hand) || 0, reorder_level: parseFloat(itemForm.reorder_level) || 0, unit_cost: itemForm.unit_cost ? parseFloat(itemForm.unit_cost) : null, location: itemForm.location.trim() || null, organization_id: orgId, updated_at: new Date().toISOString() };
    const { error } = editingItem
      ? await supabase.from("inventory_items").update(payload).eq("id", editingItem.id)
      : await supabase.from("inventory_items").insert(payload);
    setSavingItem(false);
    if (error) { notify(`Could not save item: ${error.message}`, "error"); return; }
    setShowItemForm(false); setEditingItem(null);
    notify(editingItem ? "Item updated" : "Item added");
    load();
  }

  function openMoveForm(item: ItemRow, type: string) {
    setMoveItem(item);
    setMoveForm({ movement_type: type, quantity: "", reference: "", reason: "" });
    setShowMoveForm(true);
  }

  async function saveMovement() {
    if (!moveItem) return;
    const qty = parseFloat(moveForm.quantity) || 0;
    if (qty <= 0) { notify("Enter a quantity greater than zero.", "error"); return; }
    setSavingMove(true);
    const actualQty = moveForm.movement_type === "stock_out" ? -qty : qty;

    const { error: moveErr } = await supabase.from("stock_movements").insert({
      item_id: moveItem.id, movement_type: moveForm.movement_type,
      quantity: actualQty, reference: moveForm.reference.trim() || null,
      reason: moveForm.reason.trim() || null,
      recorded_by: profile?.full_name || profile?.email,
      organization_id: orgId,
    });
    if (moveErr) { setSavingMove(false); notify(`Could not record movement: ${moveErr.message}`, "error"); return; }

    // Update quantity on hand
    const newQty = moveItem.quantity_on_hand + actualQty;
    const { error: qtyErr } = await supabase.from("inventory_items").update({ quantity_on_hand: Math.max(0, newQty), updated_at: new Date().toISOString() }).eq("id", moveItem.id);
    setSavingMove(false);
    if (qtyErr) { notify(`Movement saved but stock level did not update: ${qtyErr.message}`, "error"); load(); return; }
    setShowMoveForm(false); setMoveItem(null);
    notify(moveForm.movement_type === "stock_out" ? "Stock removed" : "Stock added");
    load();
  }

  const filtered = items.filter(i => {
    const q = search.toLowerCase();
    return !q || i.name.toLowerCase().includes(q) || (i.item_code || "").toLowerCase().includes(q) || (i.category || "").toLowerCase().includes(q);
  });

  const lowStock = items.filter(i => i.quantity_on_hand <= i.reorder_level && i.reorder_level > 0);

  if (loading) return <div className="p-6"><LoadingSpinner /></div>;

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="Inventory" subtitle="Track stock items, quantities, and movements">
        <Button
          variant="secondary"
          onClick={() => window.open("/dashboard/inventory/stocktake", "_blank")}
          title="Open a printable stock-take sheet with observed count + variance columns"
        >
          <Printer size={14} /> Stock-take sheet
        </Button>
        {canEdit && <Button variant="secondary" onClick={() => setShowBulk(true)}><UploadCloud size={14} /> Bulk import</Button>}
        {canEdit && <Button variant="gold" onClick={() => openItemForm()}><Plus size={14} /> Add Item</Button>}
      </PageHeader>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border p-4 text-center">
          <div className="text-xl font-bold text-[#0F2A47]">{items.length}</div>
          <div className="text-xs text-gray-500">Total Items</div>
        </div>
        <div className="bg-white rounded-xl border p-4 text-center">
          <div className="text-xl font-bold text-red-700">{lowStock.length}</div>
          <div className="text-xs text-gray-500">Low Stock</div>
        </div>
        <div className="bg-white rounded-xl border p-4 text-center">
          <div className="text-xl font-bold text-[#0F2A47]">{new Set(items.map(i => i.category).filter(Boolean)).size}</div>
          <div className="text-xs text-gray-500">Categories</div>
        </div>
        <div className="bg-white rounded-xl border p-4 text-center">
          <div className="text-xl font-bold text-[#0F2A47]">{fmtMoney(items.reduce((s, i) => s + (i.quantity_on_hand * (i.unit_cost || 0)), 0))}</div>
          <div className="text-xs text-gray-500">Total Value</div>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input type="text" placeholder="Search items..." value={search} onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]" />
      </div>

      {/* Table */}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="bg-[#0F2A47] text-white">
              <th className="text-left px-4 py-3 text-xs font-semibold">Item</th>
              <th className="text-left px-4 py-3 text-xs font-semibold">Code</th>
              <th className="text-left px-4 py-3 text-xs font-semibold">Category</th>
              <th className="text-right px-4 py-3 text-xs font-semibold">Qty</th>
              <th className="text-right px-4 py-3 text-xs font-semibold">Reorder</th>
              <th className="text-left px-4 py-3 text-xs font-semibold">Unit</th>
              <th className="text-right px-4 py-3 text-xs font-semibold">Cost</th>
              <th className="px-4 py-3" />
            </tr></thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={8}><EmptyState message="No items found." icon={<Package size={32} />} /></td></tr>
              ) : filtered.map(item => {
                const isLow = item.quantity_on_hand <= item.reorder_level && item.reorder_level > 0;
                return (
                  <tr key={item.id} className={cn("border-b hover:bg-gray-50", isLow && "bg-red-50")}>
                    <td className="px-4 py-2.5 font-medium">{item.name}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-gray-500">{item.item_code || "—"}</td>
                    <td className="px-4 py-2.5 text-gray-600">{item.category || "—"}</td>
                    <td className={cn("px-4 py-2.5 text-right font-bold", isLow ? "text-red-700" : "text-[#0F2A47]")}>{item.quantity_on_hand}</td>
                    <td className="px-4 py-2.5 text-right text-gray-400">{item.reorder_level}</td>
                    <td className="px-4 py-2.5 text-gray-500">{item.unit}</td>
                    <td className="px-4 py-2.5 text-right text-gray-600">{item.unit_cost ? fmtMoney(item.unit_cost) : "—"}</td>
                    <td className="px-4 py-2.5 text-right space-x-1">
                      {canEdit && <>
                        <button onClick={() => openMoveForm(item, "stock_in")} className="text-xs text-green-700 hover:underline">+In</button>
                        <button onClick={() => openMoveForm(item, "stock_out")} className="text-xs text-red-700 hover:underline">-Out</button>
                        <button onClick={() => openItemForm(item)} className="text-xs text-[#0F2A47] hover:underline">Edit</button>
                      </>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Item Modal */}
      {showItemForm && (
        <Modal open onClose={() => { setShowItemForm(false); setEditingItem(null); }} title={editingItem ? "Edit Item" : "Add Item"} size="lg">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Input label="Item Name" value={itemForm.name} onChange={e => setItemForm(f => ({ ...f, name: e.target.value }))} placeholder="Whiteboard Marker" />
              <Input label="Item Code" value={itemForm.item_code} onChange={e => setItemForm(f => ({ ...f, item_code: e.target.value }))} placeholder="WBM001" />
              <Input label="Category" value={itemForm.category} onChange={e => setItemForm(f => ({ ...f, category: e.target.value }))} placeholder="Stationery" />
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Unit</label>
                <select value={itemForm.unit} onChange={e => setItemForm(f => ({ ...f, unit: e.target.value }))} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227] bg-white">
                  <option value="pcs">Pieces</option><option value="boxes">Boxes</option><option value="reams">Reams</option><option value="kg">Kilograms</option><option value="liters">Liters</option><option value="packs">Packs</option>
                </select>
              </div>
              <Input label="Quantity" type="number" value={itemForm.quantity_on_hand} onChange={e => setItemForm(f => ({ ...f, quantity_on_hand: e.target.value }))} />
              <Input label="Reorder Level" type="number" value={itemForm.reorder_level} onChange={e => setItemForm(f => ({ ...f, reorder_level: e.target.value }))} />
              <Input label="Unit Cost (₦)" type="number" value={itemForm.unit_cost} onChange={e => setItemForm(f => ({ ...f, unit_cost: e.target.value }))} />
              <Input label="Location" value={itemForm.location} onChange={e => setItemForm(f => ({ ...f, location: e.target.value }))} placeholder="Store Room A" />
            </div>
            <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setShowItemForm(false)}>Cancel</Button><Button variant="gold" loading={savingItem} onClick={saveItem} disabled={!itemForm.name.trim()}><Save size={14} /> {editingItem ? "Update" : "Add"}</Button></div>
          </div>
        </Modal>
      )}

      {/* Stock Movement Modal */}
      {showMoveForm && moveItem && (
        <Modal open onClose={() => setShowMoveForm(false)} title={`${moveForm.movement_type === "stock_in" ? "Stock In" : "Stock Out"}: ${moveItem.name}`} size="md">
          <div className="space-y-4">
            <p className="text-sm text-gray-600">Current quantity: <strong>{moveItem.quantity_on_hand} {moveItem.unit}</strong></p>
            <Input label="Quantity" type="number" min="0" value={moveForm.quantity} onChange={e => setMoveForm(f => ({ ...f, quantity: e.target.value }))} placeholder="10" />
            <Input label="Reference (optional)" value={moveForm.reference} onChange={e => setMoveForm(f => ({ ...f, reference: e.target.value }))} placeholder="PO-2026-001" />
            <Input label="Reason (optional)" value={moveForm.reason} onChange={e => setMoveForm(f => ({ ...f, reason: e.target.value }))} placeholder="Monthly supply" />
            <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setShowMoveForm(false)}>Cancel</Button><Button variant="gold" loading={savingMove} onClick={saveMovement} disabled={!moveForm.quantity}><Save size={14} /> Record</Button></div>
          </div>
        </Modal>
      )}
      <ToastHost />
    
      <BulkImportModal
        open={showBulk}
        onClose={() => setShowBulk(false)}
        title="Bulk import inventory items"
        columns={[
          { key: "name", label: "Item name", required: true },
          { key: "item_code", label: "Item code" },
          { key: "category", label: "Category" },
          { key: "unit", label: "Unit", hint: "pcs / box / kg / …" },
          { key: "quantity_on_hand", label: "Opening qty", transform: (raw) => Number(raw) || 0 },
          { key: "reorder_level", label: "Reorder level", transform: (raw) => Number(raw) || 0 },
          { key: "unit_cost", label: "Unit cost", transform: (raw) => raw === "" ? null : Number(raw) },
          { key: "location", label: "Location" },
        ]}
        example={{
          name: "A4 Paper",
          item_code: "STA-001",
          category: "Stationery",
          unit: "ream",
          quantity_on_hand: "20",
          reorder_level: "5",
          unit_cost: "2500",
          location: "Store 1",
        }}
        onImport={async (rows) => {
          if (!orgId) return { ok: false, message: "No org context" };
          const payload = rows.map(r => ({
            organization_id: orgId,
            name: r.name,
            item_code: r.item_code || null,
            category: r.category || null,
            unit: r.unit || "pcs",
            quantity_on_hand: r.quantity_on_hand ?? 0,
            reorder_level: r.reorder_level ?? 0,
            unit_cost: r.unit_cost,
            location: r.location || null,
            active: true,
          }));
          const { error } = await supabase.from("inventory_items").insert(payload);
          if (error) return { ok: false, message: error.message };
          load();
          return { ok: true, message: `Imported ${payload.length} item(s).` };
        }}
      />
    </div>
  );
}
