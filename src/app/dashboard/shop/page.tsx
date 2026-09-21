"use client";

/**
 * /dashboard/shop
 *
 * A school-shop point-of-sale, not a self-service storefront: front-desk
 * or bursar staff record a sale against a student on the spot, exactly
 * how every other payment in this app is already recorded (income,
 * receipts) -- a parent does not self-serve a payment anywhere else in
 * the app either, and Shop does not change that pattern.
 *
 * Reuses what already existed rather than inventing a commerce model:
 *   - inventory_items (Operations > Inventory) is the catalogue. Only
 *     items with a sale_price set show up here -- an item with no price
 *     was never meant to be sold through Shop, it's just stock.
 *   - The sale is ONE income_entries row (the same atomic per-org receipt
 *     numbering every other payment gets) under the existing "Uniform
 *     Sales" category, plus one stock_movements 'stock_out' row per line
 *     item (the same movement type any other stock reduction uses) --
 *     see record_shop_sale() in supabase/shop_module.sql, which does both
 *     in a single transaction so stock and the sale can never disagree.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { fmtMoney, fmtDateTime } from "@/lib/utils";
import { PageHeader, LoadingSpinner, EmptyState } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { useToast } from "@/lib/hooks/useToast";
import { ShoppingBag, Plus, Trash2, Receipt } from "lucide-react";

interface ShopItem {
  id: string;
  name: string;
  item_code: string | null;
  category: string | null;
  sale_price: number;
  quantity_on_hand: number;
}

interface StudentOption { id: string; full_name: string; student_code: string }

interface CartLine { item_id: string; name: string; sale_price: number; available: number; quantity: number }

const PAYMENT_METHODS = ["Cash", "Bank Transfer", "Cheque", "Mobile Money", "Card"];

export default function ShopPage() {
  const { profile, orgId, canEdit } = useAuth();
  const supabase = createClient();
  const { notify, ToastHost } = useToast();

  const [items, setItems] = useState<ShopItem[]>([]);
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [loading, setLoading] = useState(true);

  const [showSale, setShowSale] = useState(false);
  const [studentId, setStudentId] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [paymentMethod, setPaymentMethod] = useState(PAYMENT_METHODS[0]);
  const [saving, setSaving] = useState(false);
  const [receipt, setReceipt] = useState<{ receipt_no: string; amount: number } | null>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    const [{ data: itemRows }, { data: studentRows }] = await Promise.all([
      supabase.from("inventory_items")
        .select("id, name, item_code, category, sale_price, quantity_on_hand")
        .eq("organization_id", orgId).eq("active", true)
        .not("sale_price", "is", null)
        .order("name"),
      supabase.from("students")
        .select("id, full_name, student_code")
        .eq("organization_id", orgId).eq("status", "active")
        .order("full_name"),
    ]);
    setItems((itemRows ?? []) as ShopItem[]);
    setStudents((studentRows ?? []) as StudentOption[]);
    setLoading(false);
  }, [supabase, orgId]);

  useEffect(() => { load(); }, [load]);

  const studentOptions = useMemo(
    () => students.map((s) => ({ value: s.id, label: s.full_name, sublabel: s.student_code })),
    [students]
  );

  function openSale() {
    setStudentId("");
    setCart([]);
    setPaymentMethod(PAYMENT_METHODS[0]);
    setReceipt(null);
    setShowSale(true);
  }

  function addToCart(item: ShopItem) {
    setCart((prev) => {
      const existing = prev.find((l) => l.item_id === item.id);
      if (existing) {
        if (existing.quantity >= item.quantity_on_hand) return prev;
        return prev.map((l) => (l.item_id === item.id ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [...prev, { item_id: item.id, name: item.name, sale_price: item.sale_price, available: item.quantity_on_hand, quantity: 1 }];
    });
  }

  function setQty(itemId: string, qty: number) {
    setCart((prev) => prev.map((l) => (l.item_id === itemId ? { ...l, quantity: Math.max(1, Math.min(qty, l.available)) } : l)));
  }

  function removeLine(itemId: string) {
    setCart((prev) => prev.filter((l) => l.item_id !== itemId));
  }

  const cartTotal = cart.reduce((sum, l) => sum + l.sale_price * l.quantity, 0);

  async function checkout() {
    if (!orgId || !studentId || cart.length === 0) return;
    setSaving(true);
    const { data, error } = await supabase.rpc("record_shop_sale", {
      p_student_id: studentId,
      p_lines: cart.map((l) => ({ item_id: l.item_id, quantity: l.quantity })),
      p_payment_method: paymentMethod,
    });
    setSaving(false);
    if (error) { notify(`Could not complete sale: ${error.message}`, "error"); return; }

    const result = data as { ok?: boolean; receipt_no?: string; amount?: number } | null;
    if (!result?.ok) { notify("Sale was rejected.", "error"); return; }

    await supabase.from("activity_log").insert({
      user_email: profile?.email, user_name: profile?.full_name,
      action: "Shop Sale",
      details: `${result.receipt_no} — ${cart.map((l) => `${l.quantity}x ${l.name}`).join(", ")} — ${fmtMoney(result.amount ?? 0)}`,
      organization_id: orgId,
    });

    setReceipt({ receipt_no: result.receipt_no ?? "", amount: result.amount ?? 0 });
    notify(`Sale recorded — ${result.receipt_no}`);
    load();
  }

  if (loading) return <LoadingSpinner />;

  return (
    <div className="p-6">
      <PageHeader
        title="Shop"
        subtitle="School store — uniforms, textbooks and other items sold to students."
        icon={<ShoppingBag size={20} />}
      >
        {canEdit && (
          <Button variant="gold" onClick={openSale}>
            <Plus size={14} /> New sale
          </Button>
        )}
      </PageHeader>

      {items.length === 0 ? (
        <EmptyState
          icon={<ShoppingBag size={28} />}
          message="No items are set up for sale yet. Give an item in Inventory a sale price to make it available here."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <Card key={item.id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold text-[#0F2A47]">{item.name}</h3>
                  {item.category && <p className="text-xs text-gray-500">{item.category}</p>}
                </div>
                <span className={item.quantity_on_hand > 0 ? "text-xs text-gray-500" : "text-xs text-red-600 font-medium"}>
                  {item.quantity_on_hand > 0 ? `${item.quantity_on_hand} in stock` : "Out of stock"}
                </span>
              </div>
              <div className="mt-3 text-lg font-bold text-[#0F2A47]">{fmtMoney(item.sale_price)}</div>
            </Card>
          ))}
        </div>
      )}

      {showSale && (
        <Modal open onClose={() => setShowSale(false)} title={receipt ? "Sale complete" : "New sale"} size="lg">
          {receipt ? (
            <div className="space-y-4 text-center py-4">
              <Receipt size={40} className="mx-auto text-emerald-600" />
              <div>
                <div className="text-2xl font-bold text-[#0F2A47]">{fmtMoney(receipt.amount)}</div>
                <div className="text-sm text-gray-500 mt-1">Receipt {receipt.receipt_no}</div>
              </div>
              <Button variant="gold" onClick={() => setShowSale(false)}>Done</Button>
            </div>
          ) : (
            <div className="space-y-4">
              <SearchableSelect
                label="Student"
                options={studentOptions}
                value={studentId}
                onChange={setStudentId}
                placeholder="Search and select student…"
              />

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Add items</label>
                <div className="flex flex-wrap gap-2">
                  {items.filter((i) => i.quantity_on_hand > 0).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => addToCart(item)}
                      className="text-xs px-3 py-1.5 rounded-full border border-gray-300 hover:border-[#C9A227] hover:bg-[#FBF6E8] transition-colors"
                    >
                      {item.name} · {fmtMoney(item.sale_price)}
                    </button>
                  ))}
                </div>
              </div>

              {cart.length > 0 && (
                <div className="border border-gray-200 rounded-lg divide-y">
                  {cart.map((line) => (
                    <div key={line.item_id} className="flex items-center gap-2 p-2.5 text-sm">
                      <span className="flex-1 font-medium text-[#0F2A47]">{line.name}</span>
                      <input
                        type="number" min={1} max={line.available} value={line.quantity}
                        onChange={(e) => setQty(line.item_id, parseInt(e.target.value, 10) || 1)}
                        className="w-16 rounded border border-gray-300 px-2 py-1 text-center"
                      />
                      <span className="w-24 text-right text-gray-600">{fmtMoney(line.sale_price * line.quantity)}</span>
                      <button type="button" onClick={() => removeLine(line.item_id)} className="text-gray-400 hover:text-red-600">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                  <div className="flex items-center justify-between p-2.5 text-sm font-bold text-[#0F2A47]">
                    <span>Total</span>
                    <span>{fmtMoney(cartTotal)}</span>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Payment method</label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
                >
                  {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="secondary" onClick={() => setShowSale(false)}>Cancel</Button>
                <Button variant="gold" disabled={!studentId || cart.length === 0 || saving} onClick={checkout}>
                  {saving ? "Recording…" : `Record sale — ${fmtMoney(cartTotal)}`}
                </Button>
              </div>
            </div>
          )}
        </Modal>
      )}
      <ToastHost />
    </div>
  );
}
