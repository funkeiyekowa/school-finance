"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { fmtMoney, fmtDate, today, generateCode, exportCSV } from "@/lib/utils";
import { PageHeader, LoadingSpinner, EmptyState } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { Modal } from "@/components/ui/Modal";
import { BulkDeleteBar, RowCheckbox } from "@/components/ui/BulkDeleteBar";
import { useBulkSelect } from "@/lib/hooks/useBulkSelect";
import { Plus, Search, Download, CheckCircle, Circle } from "lucide-react";
import type { ExpenseEntry, Vendor } from "@/lib/types";
import { EXPENSE_CATEGORIES, PAYMENT_METHODS } from "@/lib/types";

export default function ExpensesPage() {
  const { canEdit, profile, isDeveloper } = useAuth();
  const supabase = createClient();
  const [entries, setEntries] = useState<ExpenseEntry[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterRecon, setFilterRecon] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [entRes, venRes] = await Promise.all([
      supabase.from("expense_entries").select("*").order("date", { ascending: false }).order("created_at", { ascending: false }),
      supabase.from("vendors").select("*").order("name"),
    ]);
    setEntries(entRes.data ?? []);
    setVendors(venRes.data ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const filtered = entries.filter(e => {
    const q = search.toLowerCase();
    const matchQ = !q || e.voucher_no.toLowerCase().includes(q) || (e.vendor_name || "").toLowerCase().includes(q) || e.category.toLowerCase().includes(q);
    const matchCat = !filterCategory || e.category === filterCategory;
    const matchRecon = !filterRecon || (filterRecon === "yes" ? e.reconciled : !e.reconciled);
    return matchQ && matchCat && matchRecon;
  });

  const totalShown = filtered.reduce((s, e) => s + e.amount, 0);

  // Bulk delete (developer only)
  const { selectedIds, toggle: toggleSelect, selectAll, clearSelection } = useBulkSelect(filtered.map(e => e.id));

  async function bulkDeleteSelected(ids: string[]) {
    if (ids.length > 0) await supabase.from("expense_entries").delete().in("id", ids);
    await supabase.from("activity_log").insert({ user_email: profile?.email, user_name: profile?.full_name, action: "Bulk Delete Expenses", details: `${ids.length} entries deleted` });
    load();
  }
  async function bulkDeleteAll() {
    await supabase.from("expense_entries").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await supabase.from("activity_log").insert({ user_email: profile?.email, user_name: profile?.full_name, action: "Purge All Expenses", details: "All expense entries deleted" });
    load();
  }

  async function toggleReconcile(entry: ExpenseEntry) {
    await supabase.from("expense_entries").update({ reconciled: !entry.reconciled, updated_at: new Date().toISOString() }).eq("id", entry.id);
    setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, reconciled: !e.reconciled } : e));
  }

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="Expense Ledger" subtitle="All vendor payments and operating expenses">
        <Button variant="secondary" size="sm" onClick={() => exportCSV(filtered.map(e => ({
          Voucher: e.voucher_no, Date: fmtDate(e.date), Vendor: e.vendor_name || "",
          Category: e.category, Description: e.description || "", Amount: e.amount,
          Method: e.payment_method, ApprovedBy: e.approved_by || "",
          Reconciled: e.reconciled ? "Yes" : "No",
        })), "expense-ledger")}>
          <Download size={14} /> Export CSV
        </Button>
        {canEdit && (
          <Button onClick={() => setShowAdd(true)}>
            <Plus size={16} /> Record Expense
          </Button>
        )}
      </PageHeader>

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border p-4">
          <div className="text-xs text-gray-500 mb-1">Total Shown</div>
          <div className="text-xl font-bold text-red-700">{fmtMoney(totalShown)}</div>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <div className="text-xs text-gray-500 mb-1">Vouchers</div>
          <div className="text-xl font-bold text-[#0F2A47]">{filtered.length}</div>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <div className="text-xs text-gray-500 mb-1">Reconciled</div>
          <div className="text-xl font-bold text-[#C9A227]">{filtered.filter(e => e.reconciled).length}</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" placeholder="Search voucher, vendor, category…"
            value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]" />
        </div>
        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}
          className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227] bg-white">
          <option value="">All categories</option>
          {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filterRecon} onChange={e => setFilterRecon(e.target.value)}
          className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227] bg-white">
          <option value="">All reconciliation</option>
          <option value="yes">Reconciled</option>
          <option value="no">Unreconciled</option>
        </select>
      </div>

      {loading ? <LoadingSpinner /> : (
        <>
          <BulkDeleteBar selectedIds={selectedIds} totalCount={filtered.length} itemLabel="expense entries"
            onDeleteSelected={bulkDeleteSelected} onDeleteAll={bulkDeleteAll}
            onSelectAll={selectAll} onClearSelection={clearSelection} isDeveloper={isDeveloper} />
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#0F2A47] text-white">
                  {isDeveloper && <th className="w-8 px-2 py-3" />}
                  <th className="text-left px-4 py-3 text-xs font-semibold">Voucher</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold">Date</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold">Vendor</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold">Category</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold">Description</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold">Method</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold">Approved By</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold">Amount</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold">Recon.</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={isDeveloper ? 10 : 9}><EmptyState message="No expense records found." /></td></tr>
                ) : (
                  filtered.map(entry => (
                    <tr key={entry.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <RowCheckbox id={entry.id} selectedIds={selectedIds} onToggle={toggleSelect} isDeveloper={isDeveloper} />
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-[#0F2A47]">{entry.voucher_no}</td>
                      <td className="px-4 py-3 text-gray-600">{fmtDate(entry.date)}</td>
                      <td className="px-4 py-3 font-medium">{entry.vendor_name || "—"}</td>
                      <td className="px-4 py-3 text-gray-600">{entry.category}</td>
                      <td className="px-4 py-3 text-gray-500 max-w-[150px] truncate">{entry.description || "—"}</td>
                      <td className="px-4 py-3 text-gray-600">{entry.payment_method}</td>
                      <td className="px-4 py-3 text-gray-600">{entry.approved_by || "—"}</td>
                      <td className="px-4 py-3 text-right font-bold text-red-700">{fmtMoney(entry.amount)}</td>
                      <td className="px-4 py-3">
                        <button onClick={() => toggleReconcile(entry)}
                          className="text-gray-400 hover:text-[#0F2A47] transition-colors">
                          {entry.reconciled ? <CheckCircle size={16} className="text-green-600" /> : <Circle size={16} />}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
        </>
      )}

      {showAdd && <AddExpenseModal vendors={vendors} onClose={() => { setShowAdd(false); load(); }} />}
    </div>
  );
}

function AddExpenseModal({ vendors, onClose }: { vendors: Vendor[]; onClose: () => void }) {
  const supabase = createClient();
  const { profile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedVendorId, setSelectedVendorId] = useState("");
  const [form, setForm] = useState({
    category: EXPENSE_CATEGORIES[0] as string,
    description: "",
    amount: "",
    payment_method: PAYMENT_METHODS[0] as string,
    date: today(),
    approved_by: "",
    notes: "",
  });

  const vendorOptions = vendors.map(v => ({
    value: v.id, label: v.name,
    sublabel: `${v.vendor_code}${v.category ? ` · ${v.category}` : ""}`,
  }));

  const selectedVendor = vendors.find(v => v.id === selectedVendorId);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.amount || isNaN(parseFloat(form.amount))) { setError("Enter a valid amount."); return; }
    setLoading(true);
    setError("");
    const { data: existing } = await supabase.from("expense_entries").select("voucher_no");
    const voucherNo = generateCode("VCH-", (existing ?? []).map(e => e.voucher_no));
    const { error: insertError } = await supabase.from("expense_entries").insert({
      voucher_no: voucherNo,
      date: form.date,
      vendor_id: selectedVendorId || null,
      vendor_name: selectedVendor?.name || null,
      category: form.category,
      description: form.description || null,
      amount: parseFloat(form.amount),
      payment_method: form.payment_method,
      approved_by: form.approved_by || profile?.full_name || null,
      reconciled: false,
      notes: form.notes || null,
    });
    if (insertError) { setError(insertError.message); setLoading(false); return; }
    await supabase.from("activity_log").insert({
      user_email: profile?.email, user_name: profile?.full_name,
      action: "Record Expense", details: `${voucherNo} — ${selectedVendor?.name || "No vendor"} — ${fmtMoney(parseFloat(form.amount))}`,
    });
    onClose();
  }

  return (
    <Modal open onClose={onClose} title="Record Expense Payment" size="lg">
      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}
      <form onSubmit={submit} className="space-y-4">
        <SearchableSelect label="Vendor / Payee" options={vendorOptions} value={selectedVendorId}
          onChange={setSelectedVendorId} placeholder="Search and select vendor…" />
        <div className="grid grid-cols-2 gap-3">
          <Select label="Category" value={form.category} onChange={set("category")}
            options={EXPENSE_CATEGORIES.map(c => ({ value: c, label: c }))} />
          <Input label="Description" value={form.description} onChange={set("description")} placeholder="e.g. January rent" />
          <Input label="Amount (₦)" type="number" value={form.amount} onChange={set("amount")} min="0" step="0.01" required />
          <Select label="Payment Method" value={form.payment_method} onChange={set("payment_method")}
            options={PAYMENT_METHODS.map(m => ({ value: m, label: m }))} />
          <Input label="Date" type="date" value={form.date} onChange={set("date")} required />
          <Input label="Approved By" value={form.approved_by} onChange={set("approved_by")} placeholder="e.g. Principal" />
        </div>
        <Input label="Notes (optional)" value={form.notes} onChange={set("notes")} />
        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="gold" loading={loading}>Record Expense</Button>
        </div>
      </form>
    </Modal>
  );
}
