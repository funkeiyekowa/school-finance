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
import { Plus, Trash2, Save, Settings, DollarSign, Tags, MessageSquare, Pencil } from "lucide-react";
import type { FeeSchedule, SchoolSettings } from "@/lib/types";
import { INCOME_CATEGORIES, EXPENSE_CATEGORIES } from "@/lib/types";

type Tab = "school" | "fees" | "categories" | "sms";

export default function SetupPage() {
  const [tab, setTab] = useState<Tab>("school");
  const { isAdmin } = useAuth();

  if (!isAdmin) {
    return <div className="p-6 text-gray-500">Admin access required to manage setup.</div>;
  }

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="Setup" subtitle="Configure your school's financial settings" />

      <div className="flex gap-2 border-b border-gray-200 overflow-x-auto">
        {[
          { id: "school", label: "School Settings", icon: <Settings size={14} /> },
          { id: "fees", label: "Fee Schedule", icon: <DollarSign size={14} /> },
          { id: "categories", label: "Categories", icon: <Tags size={14} /> },
          { id: "sms", label: "SMS Gateway", icon: <MessageSquare size={14} /> },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id as Tab)}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap",
              tab === t.id ? "border-[#0F2A47] text-[#0F2A47]" : "border-transparent text-gray-500 hover:text-gray-700"
            )}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === "school" && <SchoolSettingsTab />}
      {tab === "fees" && <FeeScheduleTab />}
      {tab === "categories" && <CategoriesTab />}
      {tab === "sms" && <SmsGatewayTab />}
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
  const supabase = createClient();
  const { profile } = useAuth();
  const [categories, setCategories] = useState<{ id: string; name: string; type: string; active: boolean }[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<"income" | "expense">("income");
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from("categories").select("*").order("type").order("sort_order");
    setCategories(data ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  async function addCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    await supabase.from("categories").insert({ name: newName.trim(), type: newType, active: true, sort_order: 50 });
    await supabase.from("activity_log").insert({ user_email: profile?.email, user_name: profile?.full_name, action: "Add Category", details: `${newType}: ${newName}` });
    setNewName("");
    load();
  }

  async function deleteCategory(id: string, name: string) {
    await supabase.from("categories").delete().eq("id", id);
    await supabase.from("activity_log").insert({ user_email: profile?.email, user_name: profile?.full_name, action: "Delete Category", details: name });
    setCategories(prev => prev.filter(c => c.id !== id));
  }

  async function saveEdit(id: string) {
    if (!editName.trim()) { setEditId(null); return; }
    await supabase.from("categories").update({ name: editName.trim() }).eq("id", id);
    setCategories(prev => prev.map(c => c.id === id ? { ...c, name: editName.trim() } : c));
    setEditId(null);
    setEditName("");
  }

  async function toggleActive(id: string, active: boolean) {
    await supabase.from("categories").update({ active: !active }).eq("id", id);
    setCategories(prev => prev.map(c => c.id === id ? { ...c, active: !active } : c));
  }

  const incomeCategories = categories.filter(c => c.type === "income");
  const expenseCategories = categories.filter(c => c.type === "expense");

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      {/* Add new category */}
      <Card>
        <CardHeader><CardTitle>Add Category</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={addCategory} className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <Input label="Category Name" value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Bus Fees" required />
            </div>
            <div>
              <Select label="Type" value={newType} onChange={e => setNewType(e.target.value as "income" | "expense")}
                options={[{ value: "income", label: "Income" }, { value: "expense", label: "Expense" }]} />
            </div>
            <Button type="submit" variant="gold" size="md">
              <Plus size={14} /> Add
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle>Income Categories ({incomeCategories.length})</CardTitle></CardHeader>
          <CardContent className="pt-0 space-y-1">
            {incomeCategories.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">No income categories. Add one above.</p>
            ) : (
              incomeCategories.map(c => (
                <div key={c.id} className="flex items-center justify-between py-2 px-2 border-b border-gray-50 last:border-0 rounded hover:bg-gray-50 group">
                  {editId === c.id ? (
                    <div className="flex items-center gap-2 flex-1">
                      <input value={editName} onChange={e => setEditName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") saveEdit(c.id); if (e.key === "Escape") setEditId(null); }}
                        autoFocus className="flex-1 px-2 py-1 text-sm border border-[#C9A227] rounded focus:outline-none" />
                      <button onClick={() => saveEdit(c.id)} className="text-green-600 text-xs font-medium">Save</button>
                      <button onClick={() => setEditId(null)} className="text-gray-400 text-xs">Cancel</button>
                    </div>
                  ) : (
                    <>
                      <span className={cn("text-sm", !c.active && "text-gray-400 line-through")}>{c.name}</span>
                      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => toggleActive(c.id, c.active)} className={cn("text-xs px-2 py-0.5 rounded", c.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500")}>
                          {c.active ? "Active" : "Inactive"}
                        </button>
                        <button onClick={() => { setEditId(c.id); setEditName(c.name); }} className="text-gray-400 hover:text-[#0F2A47]"><Pencil size={12} /></button>
                        <button onClick={() => deleteCategory(c.id, c.name)} className="text-gray-300 hover:text-red-500"><Trash2 size={12} /></button>
                      </div>
                    </>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Expense Categories ({expenseCategories.length})</CardTitle></CardHeader>
          <CardContent className="pt-0 space-y-1">
            {expenseCategories.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">No expense categories. Add one above.</p>
            ) : (
              expenseCategories.map(c => (
                <div key={c.id} className="flex items-center justify-between py-2 px-2 border-b border-gray-50 last:border-0 rounded hover:bg-gray-50 group">
                  {editId === c.id ? (
                    <div className="flex items-center gap-2 flex-1">
                      <input value={editName} onChange={e => setEditName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") saveEdit(c.id); if (e.key === "Escape") setEditId(null); }}
                        autoFocus className="flex-1 px-2 py-1 text-sm border border-[#C9A227] rounded focus:outline-none" />
                      <button onClick={() => saveEdit(c.id)} className="text-green-600 text-xs font-medium">Save</button>
                      <button onClick={() => setEditId(null)} className="text-gray-400 text-xs">Cancel</button>
                    </div>
                  ) : (
                    <>
                      <span className={cn("text-sm", !c.active && "text-gray-400 line-through")}>{c.name}</span>
                      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => toggleActive(c.id, c.active)} className={cn("text-xs px-2 py-0.5 rounded", c.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500")}>
                          {c.active ? "Active" : "Inactive"}
                        </button>
                        <button onClick={() => { setEditId(c.id); setEditName(c.name); }} className="text-gray-400 hover:text-[#0F2A47]"><Pencil size={12} /></button>
                        <button onClick={() => deleteCategory(c.id, c.name)} className="text-gray-300 hover:text-red-500"><Trash2 size={12} /></button>
                      </div>
                    </>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SmsGatewayTab() {
  const supabase = createClient();
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [connTestResult, setConnTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [connTesting, setConnTesting] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [unregistering, setUnregistering] = useState(false);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [form, setForm] = useState({
    sms_gateway_provider: "sms-gate.app",
    sms_gateway_url: "api.sms-gate.app:443",
    sms_gateway_username: "",
    sms_gateway_password: "",
    sms_gateway_device_id: "",
    sms_auto_credit: false,
    sms_auto_credit_min_confidence: "0.80",
    sms_webhook_secret: "",
    sms_webhook_id: "",
    sms_webhook_registered_at: "",
    sms_allowed_senders: "",
  });

  const load = useCallback(() => {
    supabase.from("school_settings").select("*").limit(1).single().then(({ data }) => {
      if (data) {
        setSettingsId(data.id);
        setForm({
          sms_gateway_provider: (data as any).sms_gateway_provider || "sms-gate.app",
          sms_gateway_url: data.sms_gateway_url || "api.sms-gate.app:443",
          sms_gateway_username: data.sms_gateway_username || "",
          sms_gateway_password: data.sms_gateway_password || "",
          sms_gateway_device_id: data.sms_gateway_device_id || "",
          sms_auto_credit: data.sms_auto_credit || false,
          sms_auto_credit_min_confidence: String(data.sms_auto_credit_min_confidence || "0.80"),
          sms_webhook_secret: data.sms_webhook_secret || "",
          sms_webhook_id: (data as any).sms_webhook_id || "",
          sms_webhook_registered_at: (data as any).sms_webhook_registered_at || "",
          sms_allowed_senders: (data as any).sms_allowed_senders || "",
        });
      }
      setLoading(false);
    });
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const webhookUrl = typeof window !== "undefined"
    ? `${window.location.origin}/api/sms-webhook`
    : "/api/sms-webhook";

  async function persist(extra: Record<string, unknown> = {}) {
    // Only save fields that the DB actually has (avoids errors from missing columns)
    const dbFields = [
      "sms_gateway_url", "sms_gateway_username", "sms_gateway_password",
      "sms_gateway_device_id", "sms_auto_credit", "sms_auto_credit_min_confidence",
      "sms_webhook_secret", "sms_webhook_id", "sms_webhook_registered_at",
      "sms_gateway_provider", "sms_allowed_senders",
    ];
    const merged = { ...form, ...extra };
    const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
    dbFields.forEach(k => {
      if (k in merged) {
        let val = (merged as any)[k];
        if (k === "sms_auto_credit_min_confidence") val = parseFloat(String(val)) || 0.80;
        payload[k] = val;
      }
    });
    if (settingsId) {
      await supabase.from("school_settings").update(payload).eq("id", settingsId);
    } else {
      const { data } = await supabase.from("school_settings").insert({ ...payload, school_name: "My School" }).select("id").single();
      if (data) setSettingsId(data.id);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await persist();
    await supabase.from("activity_log").insert({
      user_email: profile?.email, user_name: profile?.full_name,
      action: "Update SMS Gateway Settings", details: `Auto-credit: ${form.sms_auto_credit ? "ON" : "OFF"}`,
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  async function testConnection() {
    setConnTesting(true);
    setConnTestResult(null);
    try {
      const res = await fetch("/api/sms-gateway/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serverAddress: form.sms_gateway_url,
          username: form.sms_gateway_username,
          password: form.sms_gateway_password,
        }),
      });
      const data = await res.json();
      setConnTestResult({
        ok: data.ok,
        msg: data.ok
          ? `✓ Connected. ${data.existingWebhooks ?? 0} webhook(s) currently registered on this account.`
          : `✗ ${data.error}`,
      });
    } catch (err: unknown) {
      setConnTestResult({ ok: false, msg: `✗ ${err instanceof Error ? err.message : "Connection failed"}` });
    } finally {
      setConnTesting(false);
    }
  }

  async function registerWebhook() {
    setRegistering(true);
    setConnTestResult(null);
    try {
      const res = await fetch("/api/sms-gateway/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serverAddress: form.sms_gateway_url,
          username: form.sms_gateway_username,
          password: form.sms_gateway_password,
          deviceId: form.sms_gateway_device_id || undefined,
          webhookUrl,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        const registeredAt = new Date().toISOString();
        setForm(f => ({ ...f, sms_webhook_id: data.webhookId, sms_webhook_registered_at: registeredAt }));
        await persist({ sms_webhook_id: data.webhookId, sms_webhook_registered_at: registeredAt });
        await supabase.from("activity_log").insert({
          user_email: profile?.email, user_name: profile?.full_name,
          action: "Register SMS Webhook", details: `Webhook ID: ${data.webhookId}`,
        });
        setConnTestResult({ ok: true, msg: "✓ Webhook registered! Your gateway will now forward every incoming SMS to this app." });
      } else {
        setConnTestResult({ ok: false, msg: `✗ ${data.error}` });
      }
    } catch (err: unknown) {
      setConnTestResult({ ok: false, msg: `✗ ${err instanceof Error ? err.message : "Registration failed"}` });
    } finally {
      setRegistering(false);
    }
  }

  async function unregisterWebhook() {
    if (!form.sms_webhook_id) return;
    setUnregistering(true);
    setConnTestResult(null);
    try {
      const res = await fetch("/api/sms-gateway/unregister", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serverAddress: form.sms_gateway_url,
          username: form.sms_gateway_username,
          password: form.sms_gateway_password,
          webhookId: form.sms_webhook_id,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setForm(f => ({ ...f, sms_webhook_id: "", sms_webhook_registered_at: "" }));
        await persist({ sms_webhook_id: "", sms_webhook_registered_at: "" });
        await supabase.from("activity_log").insert({
          user_email: profile?.email, user_name: profile?.full_name,
          action: "Unregister SMS Webhook", details: "Webhook removed",
        });
        setConnTestResult({ ok: true, msg: "Webhook removed. SMS will no longer be forwarded to this app." });
      } else {
        setConnTestResult({ ok: false, msg: `✗ ${data.error}` });
      }
    } catch (err: unknown) {
      setConnTestResult({ ok: false, msg: `✗ ${err instanceof Error ? err.message : "Removal failed"}` });
    } finally {
      setUnregistering(false);
    }
  }

  async function testWebhook() {
    setTestResult(null);
    try {
      const res = await fetch("/api/sms-webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: "+2340000000000",
          message: "Test payment 40003 for Student Test STU-TEST",
        }),
      });
      const data = await res.json();
      if (data.success) {
        setTestResult({ ok: true, msg: `✓ Webhook working! Parsed: ₦${data.parsed.amount?.toLocaleString()}, Student: ${data.parsed.student_number || data.parsed.student_name || "unknown"}` });
      } else {
        setTestResult({ ok: false, msg: `✗ Error: ${data.error}` });
      }
    } catch (err: unknown) {
      setTestResult({ ok: false, msg: `✗ Connection failed: ${err instanceof Error ? err.message : ""}` });
    }
  }

  if (loading) return <LoadingSpinner />;

  const isConnected = !!form.sms_webhook_id;

  return (
    <div className="space-y-6">
      {/* Connection status banner */}
      <div className={cn(
        "flex items-center gap-3 p-4 rounded-xl border",
        isConnected ? "bg-green-50 border-green-200" : "bg-gray-50 border-gray-200"
      )}>
        <span className={cn("w-2.5 h-2.5 rounded-full shrink-0", isConnected ? "bg-green-500" : "bg-gray-400")} />
        <div className="flex-1">
          <div className={cn("text-sm font-semibold", isConnected ? "text-green-800" : "text-gray-600")}>
            {isConnected ? "Connected — SMS Gate is forwarding messages to this app" : "Not connected"}
          </div>
          {isConnected && form.sms_webhook_registered_at && (
            <div className="text-xs text-green-600 mt-0.5">
              Registered {new Date(form.sms_webhook_registered_at).toLocaleString("en-NG")} · Webhook ID: <span className="font-mono">{form.sms_webhook_id}</span>
            </div>
          )}
        </div>
      </div>

      {/* Gateway connection form — fully self-service, nothing hardcoded */}
      <Card>
        <CardHeader><CardTitle>Connect Your SMS Gateway</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-gray-500 mb-4">
            Enter the credentials shown in your SMS Gateway Android app (Home tab → Cloud server section), then test the
            connection and register the webhook. Every school uses their own account — nothing here is shared or hardcoded.
          </p>
          <form onSubmit={save} className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
            <div className="sm:col-span-2">
              <Select
                label="Provider"
                value={form.sms_gateway_provider}
                onChange={(e) => setForm(f => ({ ...f, sms_gateway_provider: e.target.value }))}
                options={[{ value: "sms-gate.app", label: "SMS Gate (sms-gate.app)" }, { value: "custom", label: "Other / Custom gateway" }]}
              />
            </div>
            <div className="sm:col-span-2">
              <Input
                label="Server Address"
                value={form.sms_gateway_url}
                onChange={set("sms_gateway_url")}
                placeholder="e.g. api.sms-gate.app:443"
                helpText="From the app's Cloud server or Local server section."
              />
            </div>
            <Input
              label="Username"
              value={form.sms_gateway_username}
              onChange={set("sms_gateway_username")}
              placeholder="Gateway username"
            />
            <Input
              label="Password"
              type="password"
              value={form.sms_gateway_password}
              onChange={set("sms_gateway_password")}
              placeholder="Gateway password"
            />
            <Input
              label="Device ID (optional)"
              value={form.sms_gateway_device_id}
              onChange={set("sms_gateway_device_id")}
              placeholder="Leave blank to apply to all devices on the account"
            />
            <Input
              label="Webhook Secret (optional)"
              value={form.sms_webhook_secret}
              onChange={set("sms_webhook_secret")}
              placeholder="Shared secret to validate incoming webhooks"
            />

            <div className="sm:col-span-2">
              <Input
                label="Allowed Senders (whitelist)"
                value={form.sms_allowed_senders}
                onChange={set("sms_allowed_senders")}
                placeholder="e.g. GTBank, Zenith, 1234, 5678"
                helpText="Comma-separated list of sender names or numbers. Only SMS from these senders will be processed. Leave blank to accept all."
              />
            </div>

            <div className="sm:col-span-2 flex flex-wrap items-center gap-3 pt-2">
              <Button type="submit" variant="secondary" loading={saving}>
                <Save size={14} /> Save Credentials
              </Button>
              <Button type="button" variant="secondary" loading={connTesting} onClick={testConnection}
                disabled={!form.sms_gateway_url || !form.sms_gateway_username || !form.sms_gateway_password}>
                Test Connection
              </Button>
              {!isConnected ? (
                <Button type="button" variant="gold" loading={registering} onClick={registerWebhook}
                  disabled={!form.sms_gateway_url || !form.sms_gateway_username || !form.sms_gateway_password}>
                  Register Webhook
                </Button>
              ) : (
                <Button type="button" variant="danger" loading={unregistering} onClick={unregisterWebhook}>
                  Unregister Webhook
                </Button>
              )}
              {saved && <span className="text-green-600 text-sm font-medium">✓ Saved</span>}
            </div>
          </form>

          {connTestResult && (
            <div className={cn(
              "mt-3 text-sm font-medium px-3 py-2 rounded-lg",
              connTestResult.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
            )}>
              {connTestResult.msg}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Webhook URL display */}
      <Card>
        <CardHeader><CardTitle>Your Webhook URL</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-gray-600 mb-3">
            This is the URL registered above. If you manage another gateway manually, point it here directly:
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-gray-100 border border-gray-200 rounded-lg px-4 py-2.5 text-sm font-mono text-[#0F2A47] select-all">
              {webhookUrl}
            </code>
            <Button size="sm" variant="secondary" onClick={() => navigator.clipboard.writeText(webhookUrl)}>
              Copy
            </Button>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <Button size="sm" variant="gold" onClick={testWebhook}>Send Test SMS</Button>
            {testResult && (
              <span className={cn("text-sm font-medium", testResult.ok ? "text-green-700" : "text-red-700")}>
                {testResult.msg}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Auto-credit toggle */}
      <Card>
        <CardHeader><CardTitle>Payment Auto-Credit</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-start gap-4 p-4 rounded-xl border border-gray-200 bg-gray-50">
            <label className="relative inline-flex items-center cursor-pointer mt-0.5">
              <input
                type="checkbox"
                checked={form.sms_auto_credit}
                onChange={async (e) => {
                  const checked = e.target.checked;
                  setForm(f => ({ ...f, sms_auto_credit: checked }));
                  await persist({ sms_auto_credit: checked } as any);
                }}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-300 peer-focus:ring-2 peer-focus:ring-[#C9A227] rounded-full peer peer-checked:after:translate-x-full peer-checked:bg-[#0F2A47] after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all"></div>
            </label>
            <div>
              <div className="font-semibold text-sm text-gray-900">
                {form.sms_auto_credit ? "Auto-Credit is ON" : "Auto-Credit is OFF (Manual Review)"}
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {form.sms_auto_credit
                  ? "When an SMS payment is received with high enough confidence, it will automatically credit the matched student's account. No manual approval needed."
                  : "All SMS payments will appear in the Payment Alerts queue for manual review and approval by staff before crediting students."
                }
              </p>
            </div>
          </div>

          {form.sms_auto_credit && (
            <div className="mt-4 p-4 rounded-xl border border-amber-200 bg-amber-50">
              <label className="block text-sm font-medium text-amber-900 mb-2">
                Minimum confidence to auto-credit
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min="0.50"
                  max="1.00"
                  step="0.05"
                  value={form.sms_auto_credit_min_confidence}
                  onChange={async (e) => {
                    const v = e.target.value;
                    setForm(f => ({ ...f, sms_auto_credit_min_confidence: v }));
                    await persist({ sms_auto_credit_min_confidence: v } as any);
                  }}
                  className="flex-1 accent-[#C9A227]"
                />
                <span className="text-sm font-bold text-amber-900 w-12 text-right">
                  {Math.round(parseFloat(form.sms_auto_credit_min_confidence) * 100)}%
                </span>
              </div>
              <p className="text-xs text-amber-700 mt-2">
                SMS alerts below this confidence will still require manual review. Higher = safer but more manual work.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Setup instructions */}
      <Card>
        <CardHeader><CardTitle>How It Works</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm text-gray-600">
          <div className="flex items-start gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-[#0F2A47] text-white flex items-center justify-center text-xs font-bold">1</span>
            <p>Open the SMS Gateway app on your school's Android phone and copy the Cloud server (or Local server) credentials into the form above.</p>
          </div>
          <div className="flex items-start gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-[#0F2A47] text-white flex items-center justify-center text-xs font-bold">2</span>
            <p>Click <strong>Test Connection</strong> to confirm the credentials work, then <strong>Register Webhook</strong>.</p>
          </div>
          <div className="flex items-start gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-[#0F2A47] text-white flex items-center justify-center text-xs font-bold">3</span>
            <p>From then on, every SMS the phone receives is forwarded here automatically — no manual re-entry needed.</p>
          </div>
          <div className="flex items-start gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-[#0F2A47] text-white flex items-center justify-center text-xs font-bold">4</span>
            <p>Payments appear in <strong>Payment Alerts</strong> for review{form.sms_auto_credit ? ", or auto-credit immediately if confidence is high enough" : ""}.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
