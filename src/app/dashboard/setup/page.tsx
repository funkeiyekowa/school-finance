"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { fmtMoney, fmtDateTime } from "@/lib/utils";
import { PageHeader, LoadingSpinner } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/lib/utils";
import { Plus, Trash2, Save, Settings, DollarSign, Tags, MessageSquare, Pencil, Mail, RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";
import type { FeeSchedule, SchoolSettings } from "@/lib/types";
import { INCOME_CATEGORIES, EXPENSE_CATEGORIES } from "@/lib/types";

type Tab = "school" | "fees" | "categories" | "sms" | "email";

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
          { id: "email", label: "Email Alerts", icon: <Mail size={14} /> },
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
      {tab === "email" && <EmailAlertsTab />}
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
    sms_auto_expense: false,
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
          sms_auto_expense: (data as any).sms_auto_expense || false,
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
      "sms_gateway_provider", "sms_allowed_senders", "sms_auto_expense",
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

      {/* Auto-expense toggle */}
      <Card>
        <CardHeader><CardTitle>Expense Auto-Post (Debits)</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-start gap-4 p-4 rounded-xl border border-gray-200 bg-gray-50">
            <label className="relative inline-flex items-center cursor-pointer mt-0.5">
              <input
                type="checkbox"
                checked={form.sms_auto_expense || false}
                onChange={async (e) => {
                  const checked = e.target.checked;
                  setForm(f => ({ ...f, sms_auto_expense: checked }));
                  await persist({ sms_auto_expense: checked } as any);
                }}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-300 peer-focus:ring-2 peer-focus:ring-[#C9A227] rounded-full peer peer-checked:after:translate-x-full peer-checked:bg-[#0F2A47] after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all"></div>
            </label>
            <div>
              <div className="font-semibold text-sm text-gray-900">
                {form.sms_auto_expense ? "Auto-Expense is ON" : "Auto-Expense is OFF (Manual Review)"}
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {form.sms_auto_expense
                  ? "When a debit (DR) bank alert is received, the expense is automatically recorded in the Expense Ledger with auto-detected category and payee."
                  : "Debit alerts appear in Payment Alerts for manual review. Staff must approve before the expense is posted to the ledger."
                }
              </p>
            </div>
          </div>
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



/**
 * Email Alerts — configuration for the Gmail → webhook pipeline.
 *
 * Every value here is read by the Apps Script at runtime via
 * /api/email-config, so the script itself never needs editing once it's
 * installed. That keeps all operational settings in the app.
 */
function EmailAlertsTab() {
  const supabase = createClient();
  const { profile } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [showScript, setShowScript] = useState(false);

  const [form, setForm] = useState({
    email_alerts_enabled: false,
    email_allowed_senders: "",
    email_subject_keywords: "",
    email_gmail_label: "BankAlerts",
    email_processed_label: "BankAlerts/Processed",
    email_webhook_secret: "",
    email_max_per_run: "25",
  });

  const [health, setHealth] = useState({
    lastReceivedAt: null as string | null,
    lastSyncAt: null as string | null,
    totalReceived: 0,
  });

  const load = useCallback(async () => {
    const { data } = await supabase.from("school_settings").select("*").limit(1).single();
    if (data) {
      const d = data as Record<string, any>;
      setSettingsId(d.id);
      setForm({
        email_alerts_enabled: d.email_alerts_enabled ?? false,
        email_allowed_senders: d.email_allowed_senders ?? "",
        email_subject_keywords: d.email_subject_keywords ?? "",
        email_gmail_label: d.email_gmail_label ?? "BankAlerts",
        email_processed_label: d.email_processed_label ?? "BankAlerts/Processed",
        email_webhook_secret: d.email_webhook_secret ?? "",
        email_max_per_run: String(d.email_max_per_run ?? 25),
      });
      setHealth({
        lastReceivedAt: d.email_last_received_at ?? null,
        lastSyncAt: d.email_last_sync_at ?? null,
        totalReceived: Number(d.email_total_received ?? 0),
      });
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const appOrigin = typeof window !== "undefined" ? window.location.origin : "";
  const webhookUrl = `${appOrigin}/api/email-webhook`;
  const configUrl = `${appOrigin}/api/email-config`;

  async function persist(extra: Record<string, unknown> = {}) {
    const payload: Record<string, unknown> = {
      ...form,
      ...extra,
      email_max_per_run: parseInt(String(extra.email_max_per_run ?? form.email_max_per_run), 10) || 25,
      updated_at: new Date().toISOString(),
    };
    if (settingsId) {
      await supabase.from("school_settings").update(payload).eq("id", settingsId);
    } else {
      const { data } = await supabase
        .from("school_settings")
        .insert({ ...payload, school_name: "My School" })
        .select("id")
        .single();
      if (data) setSettingsId(data.id);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await persist();
    await supabase.from("activity_log").insert({
      user_email: profile?.email,
      user_name: profile?.full_name,
      action: "Update Email Alert Settings",
      details: `Email alerts: ${form.email_alerts_enabled ? "ON" : "OFF"}`,
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  async function toggleEnabled(checked: boolean) {
    setForm(f => ({ ...f, email_alerts_enabled: checked }));
    await persist({ email_alerts_enabled: checked });
  }

  /** Rotate the shared secret. The Apps Script must be updated to match. */
  async function regenerateSecret() {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const secret = Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
    setForm(f => ({ ...f, email_webhook_secret: secret }));
    await persist({ email_webhook_secret: secret });
    setShowSecret(true);
    await supabase.from("activity_log").insert({
      user_email: profile?.email,
      user_name: profile?.full_name,
      action: "Rotate Email Webhook Secret",
      details: "A new secret was generated — the Apps Script must be updated.",
    });
  }

  function copy(label: string, value: string) {
    navigator.clipboard.writeText(value);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  }

  /** Send a sample bank email through the real webhook, end to end. */
  async function sendTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/email-webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-webhook-secret": form.email_webhook_secret },
        body: JSON.stringify({
          from: form.email_allowed_senders.split(",")[0]?.trim() || "alerts@bank.test",
          subject: "Transaction Alert",
          body: "Acct:**3387 CR:N1,500.00 Desc:S999 Email Pipeline Test DT:05/MAY/26 08:24AM Bal:N1,000,000.00CR",
          messageId: `setup-test-${Date.now()}`,
          receivedAt: new Date().toISOString(),
        }),
      });
      const data = await res.json();
      if (data.success && !data.skipped) {
        setTestResult({
          ok: true,
          msg: `Webhook is live. Parsed ₦${Number(data.parsed?.amount ?? 0).toLocaleString()} as ${data.type}, status "${data.parsed?.match_status}". Check Payment Alerts for the test entry.`,
        });
      } else if (data.skipped) {
        setTestResult({ ok: false, msg: `Skipped — ${data.reason}` });
      } else {
        setTestResult({ ok: false, msg: data.error || "Unknown error." });
      }
      load();
    } catch (err: unknown) {
      setTestResult({ ok: false, msg: err instanceof Error ? err.message : "Request failed." });
    } finally {
      setTesting(false);
    }
  }

  if (loading) return <LoadingSpinner />;

  const isConnected = !!health.lastSyncAt;
  const appsScript = buildAppsScript(configUrl, form.email_webhook_secret || "PASTE_YOUR_SECRET");

  return (
    <div className="space-y-6">
      {/* Status */}
      <div className={cn(
        "flex flex-wrap items-center gap-4 p-4 rounded-xl border",
        form.email_alerts_enabled && isConnected
          ? "bg-green-50 border-green-200"
          : form.email_alerts_enabled
          ? "bg-amber-50 border-amber-200"
          : "bg-gray-50 border-gray-200"
      )}>
        <span className={cn(
          "w-2.5 h-2.5 rounded-full shrink-0",
          form.email_alerts_enabled && isConnected ? "bg-green-500" : form.email_alerts_enabled ? "bg-amber-500" : "bg-gray-400"
        )} />
        <div className="flex-1 min-w-[240px]">
          <div className={cn(
            "text-sm font-semibold",
            form.email_alerts_enabled && isConnected ? "text-green-800" : form.email_alerts_enabled ? "text-amber-800" : "text-gray-600"
          )}>
            {!form.email_alerts_enabled
              ? "Email alerts are off"
              : isConnected
              ? "Connected — the Gmail script is checking in"
              : "Enabled, but the Gmail script hasn't checked in yet"}
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            {health.lastSyncAt
              ? `Script last checked in ${fmtDateTime(health.lastSyncAt)}`
              : "Install the Apps Script below to start the sync."}
            {health.lastReceivedAt && ` · Last email processed ${fmtDateTime(health.lastReceivedAt)}`}
            {` · ${health.totalReceived} email${health.totalReceived === 1 ? "" : "s"} processed in total`}
          </div>
        </div>
        <Button size="sm" variant="secondary" onClick={load}>
          <RefreshCw size={13} /> Refresh
        </Button>
      </div>

      {/* Master switch */}
      <Card>
        <CardHeader><CardTitle>Email Alert Processing</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-start gap-4 p-4 rounded-xl border border-gray-200 bg-gray-50">
            <label className="relative inline-flex items-center cursor-pointer mt-0.5">
              <input
                type="checkbox"
                checked={form.email_alerts_enabled}
                onChange={e => toggleEnabled(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-300 peer-focus:ring-2 peer-focus:ring-[#C9A227] rounded-full peer peer-checked:after:translate-x-full peer-checked:bg-[#0F2A47] after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all" />
            </label>
            <div>
              <div className="font-semibold text-sm text-gray-900">
                {form.email_alerts_enabled ? "Email alerts are ON" : "Email alerts are OFF"}
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {form.email_alerts_enabled
                  ? "Bank alert emails forwarded by the Gmail script are parsed and posted using the same rules as SMS. Auto-credit and auto-expense toggles on the SMS Gateway tab apply to both channels."
                  : "Forwarded emails will be rejected. Turn this on once the Apps Script is installed."}
              </p>
            </div>
          </div>
          <div className="mt-3 flex items-start gap-2 text-xs text-gray-500">
            <CheckCircle2 size={14} className="text-green-600 shrink-0 mt-0.5" />
            <p>
              Running SMS and email together is safe — if the same transaction arrives on both
              channels within 30 minutes, the second one is flagged as a duplicate and nothing is
              posted twice.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Filters */}
      <Card>
        <CardHeader><CardTitle>Which Emails to Process</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-gray-500 mb-4">
            The Gmail script reads these rules on every run, so you can change them here at any
            time without touching the script.
          </p>
          <form onSubmit={save} className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
            <div className="sm:col-span-2">
              <Input
                label="Allowed Sender Addresses"
                value={form.email_allowed_senders}
                onChange={set("email_allowed_senders")}
                placeholder="alerts@fidelitybank.com, no-reply@gtbank.com"
                helpText="Comma-separated. Partial matches count, so 'fidelity' matches any Fidelity address. Leave blank to accept every sender in the label."
              />
            </div>
            <div className="sm:col-span-2">
              <Input
                label="Subject Keywords"
                value={form.email_subject_keywords}
                onChange={set("email_subject_keywords")}
                placeholder="Transaction Alert, Credit Alert, Debit Alert"
                helpText="Comma-separated; an email passes if any keyword appears. Leave blank to accept any subject."
              />
            </div>
            <Input
              label="Gmail Label to Watch"
              value={form.email_gmail_label}
              onChange={set("email_gmail_label")}
              placeholder="BankAlerts"
              helpText="The label your Gmail filter applies to bank alerts."
            />
            <Input
              label="Processed Label"
              value={form.email_processed_label}
              onChange={set("email_processed_label")}
              placeholder="BankAlerts/Processed"
              helpText="Applied after forwarding so the same email is never sent twice."
            />
            <Input
              label="Max Emails Per Run"
              type="number"
              min="1"
              max="100"
              value={form.email_max_per_run}
              onChange={set("email_max_per_run")}
              helpText="Keeps each 5-minute run inside Apps Script's execution limit."
            />
            <div className="sm:col-span-2 flex items-center gap-3 pt-2">
              <Button type="submit" variant="gold" loading={saving}>
                <Save size={14} /> Save Filters
              </Button>
              {saved && <span className="text-green-600 text-sm font-medium">Saved</span>}
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Credentials */}
      <Card>
        <CardHeader><CardTitle>Connection Details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Config URL</label>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-gray-100 border border-gray-200 rounded-lg px-3 py-2.5 text-xs font-mono text-[#0F2A47] break-all">
                {configUrl}
              </code>
              <Button size="sm" variant="secondary" onClick={() => copy("config", configUrl)}>
                {copied === "config" ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Webhook URL</label>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-gray-100 border border-gray-200 rounded-lg px-3 py-2.5 text-xs font-mono text-[#0F2A47] break-all">
                {webhookUrl}
              </code>
              <Button size="sm" variant="secondary" onClick={() => copy("webhook", webhookUrl)}>
                {copied === "webhook" ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Shared Secret</label>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-gray-100 border border-gray-200 rounded-lg px-3 py-2.5 text-xs font-mono text-[#0F2A47] break-all">
                {form.email_webhook_secret
                  ? showSecret
                    ? form.email_webhook_secret
                    : "•".repeat(24)
                  : "Not generated yet"}
              </code>
              <Button size="sm" variant="secondary" onClick={() => setShowSecret(s => !s)}>
                {showSecret ? "Hide" : "Show"}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => copy("secret", form.email_webhook_secret)}
                disabled={!form.email_webhook_secret}
              >
                {copied === "secret" ? "Copied" : "Copy"}
              </Button>
            </div>
            <div className="flex items-start gap-2 mt-2">
              <Button size="sm" variant="ghost" onClick={regenerateSecret} className="text-red-600 hover:bg-red-50">
                {form.email_webhook_secret ? "Rotate secret" : "Generate secret"}
              </Button>
              <p className="text-xs text-gray-400 pt-1.5">
                Only requests carrying this secret are accepted. Rotating it means updating the
                Apps Script too.
              </p>
            </div>
          </div>

          <div className="pt-2 border-t border-gray-100 flex flex-wrap items-center gap-3">
            <Button
              variant="gold"
              size="sm"
              loading={testing}
              onClick={sendTest}
              disabled={!form.email_webhook_secret}
            >
              Send Test Email
            </Button>
            {testResult && (
              <span className={cn("text-sm font-medium", testResult.ok ? "text-green-700" : "text-red-700")}>
                {testResult.msg}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Apps Script */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Gmail Apps Script</CardTitle>
            <Button size="sm" variant="secondary" onClick={() => setShowScript(s => !s)}>
              {showScript ? "Hide script" : "Show script"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <ol className="space-y-3 text-sm text-gray-600">
            {[
              <>In Gmail, create a filter for your bank's alert address and apply the label <strong>{form.email_gmail_label || "BankAlerts"}</strong>. Tick &ldquo;Also apply to matching conversations&rdquo;.</>,
              <>Go to <a href="https://script.google.com" target="_blank" rel="noreferrer" className="text-[#0F2A47] underline font-medium">script.google.com</a> and create a new project.</>,
              <>Paste the script below. The secret is already filled in — nothing else to edit.</>,
              <>Click the clock icon (Triggers) → Add Trigger → function <code className="bg-gray-100 px-1 rounded">processBankEmails</code>, time-driven, minutes timer, every 5 minutes.</>,
              <>Run <code className="bg-gray-100 px-1 rounded">processBankEmails</code> once manually and approve the Gmail permission prompt.</>,
              <>Turn on the switch at the top of this page. Alerts will appear under <strong>Payment Alerts</strong>.</>,
            ].map((step, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="shrink-0 w-6 h-6 rounded-full bg-[#0F2A47] text-white flex items-center justify-center text-xs font-bold">
                  {i + 1}
                </span>
                <p>{step}</p>
              </li>
            ))}
          </ol>

          {!form.email_webhook_secret && (
            <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800">
                Generate a shared secret above before copying the script, otherwise it will be
                pasted with a placeholder.
              </p>
            </div>
          )}

          {showScript && (
            <div className="space-y-2">
              <div className="flex justify-end">
                <Button size="sm" variant="secondary" onClick={() => copy("script", appsScript)}>
                  {copied === "script" ? "Copied" : "Copy script"}
                </Button>
              </div>
              <pre className="bg-[#0F2A47] text-[#E8EEF5] rounded-xl p-4 text-xs overflow-x-auto leading-relaxed max-h-96 overflow-y-auto">
                {appsScript}
              </pre>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Build the Apps Script source with this school's config URL and secret
 * baked in, so the admin can paste it without editing anything.
 */
function buildAppsScript(configUrl: string, secret: string): string {
  return `/**
 * School Finance Suite — bank alert email forwarder.
 *
 * Reads bank alert emails from a Gmail label and forwards them to the app,
 * which parses them and posts income or expense entries.
 *
 * All filtering rules live in the app (Setup > Email Alerts) and are
 * fetched on every run, so this script should not need editing again.
 *
 * Setup: add a time-driven trigger for processBankEmails, every 5 minutes.
 */

var CONFIG_URL = ${JSON.stringify(configUrl)};
var SECRET = ${JSON.stringify(secret)};

function processBankEmails() {
  var config = fetchConfig_();
  if (!config) return;

  if (!config.enabled) {
    Logger.log('Email alerts are disabled in the app. Nothing to do.');
    return;
  }

  var sourceLabel = GmailApp.getUserLabelByName(config.gmailLabel);
  if (!sourceLabel) {
    Logger.log('Gmail label "' + config.gmailLabel + '" not found. Create it or update Setup.');
    return;
  }

  var processedLabel = getOrCreateLabel_(config.processedLabel);
  var threads = sourceLabel.getThreads(0, config.maxPerRun || 25);
  var sent = 0;
  var skipped = 0;

  for (var t = 0; t < threads.length; t++) {
    var thread = threads[t];
    if (hasLabel_(thread, config.processedLabel)) continue;

    var messages = thread.getMessages();
    for (var m = 0; m < messages.length; m++) {
      var message = messages[m];

      if (!senderAllowed_(message.getFrom(), config.allowedSenders)) { skipped++; continue; }
      if (!subjectAllowed_(message.getSubject(), config.subjectKeywords)) { skipped++; continue; }

      if (postMessage_(config.webhookUrl, message)) sent++;
      else skipped++;
    }

    // Label the thread so its messages are never forwarded again.
    thread.addLabel(processedLabel);
    thread.removeLabel(sourceLabel);
  }

  Logger.log('Forwarded ' + sent + ' email(s), skipped ' + skipped + '.');
}

/** Fetch filtering rules from the app. */
function fetchConfig_() {
  try {
    var response = UrlFetchApp.fetch(CONFIG_URL, {
      method: 'get',
      headers: { 'x-webhook-secret': SECRET },
      muteHttpExceptions: true
    });
    if (response.getResponseCode() !== 200) {
      Logger.log('Config fetch failed (' + response.getResponseCode() + '): ' + response.getContentText());
      return null;
    }
    return JSON.parse(response.getContentText());
  } catch (err) {
    Logger.log('Config fetch error: ' + err);
    return null;
  }
}

/** POST a single message to the app's webhook. */
function postMessage_(webhookUrl, message) {
  var payload = {
    from: message.getFrom(),
    subject: message.getSubject(),
    body: message.getPlainBody(),
    html: message.getBody(),
    messageId: message.getId(),
    receivedAt: message.getDate().toISOString()
  };

  try {
    var response = UrlFetchApp.fetch(webhookUrl, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-webhook-secret': SECRET },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    var code = response.getResponseCode();
    if (code >= 200 && code < 300) return true;

    Logger.log('Webhook rejected message ' + message.getId() + ' (' + code + '): ' + response.getContentText());
    return false;
  } catch (err) {
    Logger.log('Webhook error for message ' + message.getId() + ': ' + err);
    return false;
  }
}

/** Case-insensitive partial match against the allowed sender list. */
function senderAllowed_(from, allowedSenders) {
  if (!allowedSenders || allowedSenders.length === 0) return true;
  var haystack = String(from).toLowerCase();
  for (var i = 0; i < allowedSenders.length; i++) {
    if (haystack.indexOf(String(allowedSenders[i]).toLowerCase()) !== -1) return true;
  }
  return false;
}

/** An email passes if any configured keyword appears in the subject. */
function subjectAllowed_(subject, keywords) {
  if (!keywords || keywords.length === 0) return true;
  var haystack = String(subject).toLowerCase();
  for (var i = 0; i < keywords.length; i++) {
    if (haystack.indexOf(String(keywords[i]).toLowerCase()) !== -1) return true;
  }
  return false;
}

function getOrCreateLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

function hasLabel_(thread, name) {
  var labels = thread.getLabels();
  for (var i = 0; i < labels.length; i++) {
    if (labels[i].getName() === name) return true;
  }
  return false;
}

/** Run manually to confirm the app is reachable and the secret is correct. */
function testConnection() {
  var config = fetchConfig_();
  if (!config) {
    Logger.log('Could not reach the app. Check CONFIG_URL and SECRET.');
    return;
  }
  Logger.log('Connected. Enabled: ' + config.enabled + ', label: ' + config.gmailLabel);
}
`;
}
