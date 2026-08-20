"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { fmtMoney } from "@/lib/utils";
import { PageHeader, LoadingSpinner } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/lib/utils";
import { Plus, Trash2, Save, Settings, DollarSign, Tags } from "lucide-react";
import type { FeeSchedule, SchoolSettings } from "@/lib/types";
import { INCOME_CATEGORIES, EXPENSE_CATEGORIES } from "@/lib/types";

type Tab = "school" | "fees" | "categories";

export default function SetupPage() {
  const [tab, setTab] = useState<Tab>("school");
  const { isAdmin } = useAuth();

  if (!isAdmin) {
    return <div className="p-6 text-gray-500">Admin access required to manage setup.</div>;
  }

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="Setup" subtitle="Configure your school's financial settings" />

      <div className="flex gap-2 border-b border-gray-200">
        {[
          { id: "school", label: "School Settings", icon: <Settings size={14} /> },
          { id: "fees", label: "Fee Schedule", icon: <DollarSign size={14} /> },
          { id: "categories", label: "Categories", icon: <Tags size={14} /> },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id as Tab)}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
              tab === t.id ? "border-[#0F2A47] text-[#0F2A47]" : "border-transparent text-gray-500 hover:text-gray-700"
            )}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === "school" && <SchoolSettingsTab />}
      {tab === "fees" && <FeeScheduleTab />}
      {tab === "categories" && <CategoriesTab />}
    </div>
  );
}

function SchoolSettingsTab() {
  const supabase = createClient();
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState({
    school_name: "", address: "", phone: "", email: "",
    currency_symbol: "₦", currency_code: "NGN",
    receipt_prefix: "RCT-", voucher_prefix: "VCH-",
    receipt_footer: "Thank you for your payment.", current_term: "Term 1", current_year: "2026",
  });

  useEffect(() => {
    supabase.from("school_settings").select("*").limit(1).single().then(({ data }) => {
      if (data) setForm({
        school_name: data.school_name, address: data.address || "", phone: data.phone || "",
        email: data.email || "", currency_symbol: data.currency_symbol, currency_code: data.currency_code,
        receipt_prefix: data.receipt_prefix, voucher_prefix: data.voucher_prefix,
        receipt_footer: data.receipt_footer || "", current_term: data.current_term || "",
        current_year: data.current_year || "",
      });
      setLoading(false);
    });
  }, [supabase]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [k]: e.target.value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const { data: existing } = await supabase.from("school_settings").select("id").limit(1).single();
    if (existing) {
      await supabase.from("school_settings").update({ ...form, updated_at: new Date().toISOString() }).eq("id", existing.id);
    } else {
      await supabase.from("school_settings").insert(form);
    }
    await supabase.from("activity_log").insert({ user_email: profile?.email, user_name: profile?.full_name, action: "Update School Settings", details: form.school_name });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  if (loading) return <LoadingSpinner />;

  return (
    <Card>
      <CardHeader><CardTitle>School Information</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={save} className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
          <div className="sm:col-span-2">
            <Input label="School Name" value={form.school_name} onChange={set("school_name")} required />
          </div>
          <div className="sm:col-span-2">
            <Input label="Address" value={form.address} onChange={set("address")} />
          </div>
          <Input label="Phone" value={form.phone} onChange={set("phone")} />
          <Input label="Email" type="email" value={form.email} onChange={set("email")} />
          <Input label="Currency Symbol" value={form.currency_symbol} onChange={set("currency_symbol")} helpText="e.g. ₦" />
          <Input label="Currency Code" value={form.currency_code} onChange={set("currency_code")} helpText="e.g. NGN" />
          <Input label="Receipt Prefix" value={form.receipt_prefix} onChange={set("receipt_prefix")} helpText="e.g. RCT-" />
          <Input label="Voucher Prefix" value={form.voucher_prefix} onChange={set("voucher_prefix")} helpText="e.g. VCH-" />
          <Input label="Current Term" value={form.current_term} onChange={set("current_term")} placeholder="e.g. Term 1" />
          <Input label="Current Year" value={form.current_year} onChange={set("current_year")} placeholder="e.g. 2025/2026" />
          <div className="sm:col-span-2">
            <Input label="Receipt Footer" value={form.receipt_footer} onChange={set("receipt_footer")} />
          </div>
          <div className="sm:col-span-2 flex items-center gap-3">
            <Button type="submit" variant="gold" loading={saving}>
              <Save size={14} /> Save Settings
            </Button>
            {saved && <span className="text-green-600 text-sm font-medium">✓ Saved successfully</span>}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function FeeScheduleTab() {
  const supabase = createClient();
  const { profile } = useAuth();
  const [fees, setFees] = useState<FeeSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from("fee_schedules").select("*").order("name");
    setFees(data ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  async function toggleActive(fee: FeeSchedule) {
    await supabase.from("fee_schedules").update({ active: !fee.active, updated_at: new Date().toISOString() }).eq("id", fee.id);
    setFees(prev => prev.map(f => f.id === fee.id ? { ...f, active: !f.active } : f));
  }

  async function deleteFee(id: string) {
    await supabase.from("fee_schedules").delete().eq("id", id);
    setFees(prev => prev.filter(f => f.id !== id));
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setShowAdd(true)}>
          <Plus size={14} /> Add Fee
        </Button>
      </div>
      {loading ? <LoadingSpinner /> : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#0F2A47] text-white">
                  <th className="text-left px-4 py-3 text-xs font-semibold">Fee Name</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold">Category</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold">Grade</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold">Term</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold">Year</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold">Amount</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold">Active</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {fees.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-8 text-gray-400">No fees defined. Add your first fee schedule.</td></tr>
                ) : (
                  fees.map(fee => (
                    <tr key={fee.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium">{fee.name}</td>
                      <td className="px-4 py-3 text-gray-600">{fee.category}</td>
                      <td className="px-4 py-3 text-gray-600">{fee.grade || "All grades"}</td>
                      <td className="px-4 py-3 text-gray-600">{fee.term || "—"}</td>
                      <td className="px-4 py-3 text-gray-600">{fee.academic_year || "—"}</td>
                      <td className="px-4 py-3 text-right font-bold">{fmtMoney(fee.amount)}</td>
                      <td className="px-4 py-3">
                        <button onClick={() => toggleActive(fee)}
                          className={cn("text-xs font-semibold px-2 py-0.5 rounded-full", fee.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500")}>
                          {fee.active ? "Active" : "Inactive"}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <button onClick={() => deleteFee(fee.id)} className="text-gray-300 hover:text-red-500 transition-colors">
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {showAdd && <AddFeeModal onClose={() => { setShowAdd(false); load(); }} />}
    </div>
  );
}

function AddFeeModal({ onClose }: { onClose: () => void }) {
  const supabase = createClient();
  const { profile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: "", category: INCOME_CATEGORIES[0] as string, amount: "",
    grade: "", term: "", academic_year: "", description: "",
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm(f => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.amount) { setError("Name and amount are required."); return; }
    setLoading(true);
    const { error } = await supabase.from("fee_schedules").insert({
      name: form.name, category: form.category, amount: parseFloat(form.amount),
      grade: form.grade || null, term: form.term || null, academic_year: form.academic_year || null,
      description: form.description || null, active: true,
    });
    if (error) { setError(error.message); setLoading(false); return; }
    await supabase.from("activity_log").insert({ user_email: profile?.email, user_name: profile?.full_name, action: "Add Fee Schedule", details: form.name });
    onClose();
  }

  return (
    <Modal open onClose={onClose} title="Add Fee to Schedule">
      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}
      <form onSubmit={submit} className="space-y-4">
        <Input label="Fee Name" value={form.name} onChange={set("name")} required placeholder="e.g. Term 1 Tuition" />
        <div className="grid grid-cols-2 gap-3">
          <Select label="Category" value={form.category} onChange={set("category")}
            options={INCOME_CATEGORIES.map(c => ({ value: c, label: c }))} />
          <Input label="Amount (₦)" type="number" value={form.amount} onChange={set("amount")} min="0" step="0.01" required />
          <Input label="Grade (optional)" value={form.grade} onChange={set("grade")} placeholder="e.g. Grade 5 or leave blank for all" />
          <Input label="Term (optional)" value={form.term} onChange={set("term")} placeholder="e.g. Term 1" />
          <div className="col-span-2">
            <Input label="Academic Year (optional)" value={form.academic_year} onChange={set("academic_year")} placeholder="e.g. 2025/2026" />
          </div>
        </div>
        <Input label="Description (optional)" value={form.description} onChange={set("description")} />
        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="gold" loading={loading}>Add Fee</Button>
        </div>
      </form>
    </Modal>
  );
}

function CategoriesTab() {
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <Card>
        <CardHeader><CardTitle>Income Categories</CardTitle></CardHeader>
        <CardContent className="pt-0 space-y-2">
          {INCOME_CATEGORIES.map(c => (
            <div key={c} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
              <span className="text-sm text-gray-700">{c}</span>
              <span className="text-xs text-gray-400 bg-green-50 px-2 py-0.5 rounded">Income</span>
            </div>
          ))}
          <p className="text-xs text-gray-400 pt-2">Categories are built-in. Contact your developer to add custom categories.</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Expense Categories</CardTitle></CardHeader>
        <CardContent className="pt-0 space-y-2">
          {EXPENSE_CATEGORIES.map(c => (
            <div key={c} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
              <span className="text-sm text-gray-700">{c}</span>
              <span className="text-xs text-gray-400 bg-red-50 px-2 py-0.5 rounded">Expense</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
