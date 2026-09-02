"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { fmtMoney, today } from "@/lib/utils";
import { BulkImportModal } from "@/components/import/BulkImportModal";
import { PageHeader, LoadingSpinner, EmptyState } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Plus, Search, ChevronRight, Building2, UploadCloud } from "lucide-react";
import Link from "next/link";
import type { Vendor } from "@/lib/types";
import { VENDOR_CATEGORIES } from "@/lib/types";

export default function VendorsPage() {
  const { canEdit, profile, orgId } = useAuth();
  const supabase = createClient();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorTotals, setVendorTotals] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [showBulk, setShowBulk] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [venRes, expRes] = await Promise.all([
      supabase.from("vendors").select("*").order("name"),
      supabase.from("expense_entries").select("vendor_id, amount"),
    ]);
    setVendors(venRes.data ?? []);
    const totals: Record<string, number> = {};
    (expRes.data ?? []).forEach(e => {
      if (e.vendor_id) totals[e.vendor_id] = (totals[e.vendor_id] || 0) + e.amount;
    });
    setVendorTotals(totals);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const filtered = vendors.filter(v => {
    const q = search.toLowerCase();
    return !q || v.name.toLowerCase().includes(q) || v.vendor_code.toLowerCase().includes(q) || (v.category || "").toLowerCase().includes(q);
  });

  return (
    <div className="p-6 space-y-5">
      <PageHeader
        icon={<Building2 size={24} />}
        gradient="navy" title="Vendors" subtitle={`${vendors.length} vendors registered`}>
        {canEdit && (
          <>
            <Button variant="secondary" onClick={() => setShowBulk(true)}>
              <UploadCloud size={16} /> Bulk import
            </Button>
            <Button onClick={() => setShowAdd(true)}>
              <Plus size={16} /> Add Vendor
            </Button>
          </>
        )}
      </PageHeader>

      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input type="text" placeholder="Search by name, code, or category…"
          value={search} onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]" />
      </div>

      {loading ? <LoadingSpinner /> : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#0F2A47] text-white">
                  <th className="text-left px-4 py-3 text-xs font-semibold">Vendor</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold">Category</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold">Contact Person</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold">Phone</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold">Total Paid YTD</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={6}><EmptyState message="No vendors found." icon={<Building2 size={32} />} /></td></tr>
                ) : (
                  filtered.map(v => (
                    <tr key={v.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{v.name}</div>
                        <div className="text-xs text-gray-400 font-mono">{v.vendor_code}</div>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{v.category || "—"}</td>
                      <td className="px-4 py-3 text-gray-600">{v.contact_person || "—"}</td>
                      <td className="px-4 py-3 text-gray-600">{v.phone || "—"}</td>
                      <td className="px-4 py-3 text-right font-semibold text-red-700">{fmtMoney(vendorTotals[v.id] || 0)}</td>
                      <td className="px-4 py-3">
                        <Link href={`/dashboard/vendors/${v.id}`}
                          className="flex items-center gap-1 text-xs text-[#0F2A47] hover:underline font-medium">
                          View <ChevronRight size={12} />
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {showAdd && <AddVendorModal onClose={() => { setShowAdd(false); load(); }} />}
      <BulkImportModal
        open={showBulk}
        onClose={() => setShowBulk(false)}
        title="Bulk import vendors"
        columns={[
          { key: "vendor_code", label: "Vendor code", required: true },
          { key: "name", label: "Vendor name", required: true },
          { key: "category", label: "Category" },
          { key: "contact_person", label: "Contact person" },
          { key: "phone", label: "Phone" },
          { key: "email", label: "Email" },
          { key: "address", label: "Address" },
        ]}
        example={{
          vendor_code: "VND001",
          name: "ABC Suppliers Ltd",
          category: "Stationery",
          contact_person: "John Smith",
          phone: "+2348012345678",
          email: "sales@abc.example",
          address: "12 Market Street, Lagos",
        }}
        onImport={async (rows) => {
          if (!orgId) return { ok: false, message: "No org context" };
          void profile;
          const payload = rows.map(r => ({
            organization_id: orgId,
            vendor_code: r.vendor_code,
            name: r.name,
            category: r.category || null,
            contact_person: r.contact_person || null,
            phone: r.phone || null,
            email: r.email || null,
            address: r.address || null,
            created_at: today(),
          }));
          const { error } = await supabase.from("vendors").insert(payload);
          if (error) return { ok: false, message: error.message };
          load();
          return { ok: true, message: `Imported ${payload.length} vendor(s).` };
        }}
      />
    </div>
  );
}

function AddVendorModal({ onClose }: { onClose: () => void }) {
  const supabase = createClient();
  const { profile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    vendor_code: "", name: "", category: VENDOR_CATEGORIES[0] as string,
    contact_person: "", phone: "", email: "", address: "", notes: "",
  });

  useEffect(() => {
    supabase.from("vendors").select("vendor_code").then(({ data }) => {
      const codes = (data ?? []).map(v => v.vendor_code);
      const max = codes.reduce((m, c) => { const n = parseInt(c.replace(/\D/g, ""), 10); return isNaN(n) ? m : Math.max(m, n); }, 0);
      setForm(f => ({ ...f, vendor_code: `VEN-${String(max + 1).padStart(4, "0")}` }));
    });
  }, [supabase]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm(f => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError("Vendor name is required."); return; }
    setLoading(true);
    const { error } = await supabase.from("vendors").insert(form);
    if (error) { setError(error.message); setLoading(false); return; }
    await supabase.from("activity_log").insert({
      user_email: profile?.email, user_name: profile?.full_name,
      action: "Add Vendor", details: `${form.vendor_code} — ${form.name}`,
    });
    onClose();
  }

  return (
    <Modal open onClose={onClose} title="Add New Vendor" size="lg">
      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}
      <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Input label="Vendor Code" value={form.vendor_code} onChange={set("vendor_code")} required />
        <Input label="Vendor / Payee Name" value={form.name} onChange={set("name")} required />
        <Select label="Category" value={form.category} onChange={set("category")}
          options={VENDOR_CATEGORIES.map(c => ({ value: c, label: c }))} />
        <Input label="Contact Person" value={form.contact_person} onChange={set("contact_person")} />
        <Input label="Phone" value={form.phone} onChange={set("phone")} placeholder="+234 800 000 0000" />
        <Input label="Email" type="email" value={form.email} onChange={set("email")} />
        <div className="sm:col-span-2"><Input label="Address" value={form.address} onChange={set("address")} /></div>
        <div className="sm:col-span-2"><Input label="Notes" value={form.notes} onChange={set("notes")} /></div>
        <div className="sm:col-span-2 flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="gold" loading={loading}>Add Vendor</Button>
        </div>
      </form>
    </Modal>
  );
}
