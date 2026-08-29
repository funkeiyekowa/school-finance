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
import { Plus, Trash2, Save, Settings, DollarSign, Tags, MessageSquare, Pencil, Mail, RefreshCw, CheckCircle2, AlertTriangle, FlaskConical, GraduationCap } from "lucide-react";
import type { FeeSchedule, SchoolSettings } from "@/lib/types";
import { INCOME_CATEGORIES, EXPENSE_CATEGORIES } from "@/lib/types";

type Tab = "school" | "fees" | "categories" | "sms" | "email" | "policy" | "academic" | "tester";

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
          { id: "policy", label: "Auto-Credit Policy", icon: <CheckCircle2 size={14} /> },
          { id: "academic", label: "Academic Setup", icon: <GraduationCap size={14} /> },
          { id: "tester", label: "Matching Tester", icon: <FlaskConical size={14} /> },
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
      {tab === "policy" && <AutoCreditPolicyTab />}
      {tab === "academic" && <AcademicSetupTab />}
      {tab === "tester" && <MatchingTesterTab />}
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

  const [saveError, setSaveError] = useState<string | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    const { data: existing } = await supabase.from("school_settings").select("id").limit(1).single();
    const { error } = existing
      ? await supabase.from("school_settings").update({ ...form, updated_at: new Date().toISOString() }).eq("id", existing.id)
      : await supabase.from("school_settings").insert(form);
    if (error) {
      setSaveError(error.message);
      setSaving(false);
      return;
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
            {saveError && <span className="text-red-600 text-sm font-medium">Save failed: {saveError}</span>}
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
    const next = !fee.active;
    // Optimistic; roll back on error so the UI never lies about state.
    setFees(prev => prev.map(f => f.id === fee.id ? { ...f, active: next } : f));
    const { error } = await supabase.from("fee_schedules").update({ active: next, updated_at: new Date().toISOString() }).eq("id", fee.id);
    if (error) {
      setFees(prev => prev.map(f => f.id === fee.id ? { ...f, active: fee.active } : f));
      alert(`Could not toggle fee: ${error.message}`);
    }
  }

  async function deleteFee(id: string) {
    const { error } = await supabase.from("fee_schedules").delete().eq("id", id);
    if (error) { alert(`Could not delete fee: ${error.message}`); return; }
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
  const { profile, orgId } = useAuth();
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
      organization_id: orgId,
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
  const { profile, orgId } = useAuth();
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
    const { error } = await supabase.from("categories").insert({ name: newName.trim(), type: newType, active: true, sort_order: 50, organization_id: orgId });
    if (error) { alert(`Could not add category: ${error.message}`); return; }
    await supabase.from("activity_log").insert({ user_email: profile?.email, user_name: profile?.full_name, action: "Add Category", details: `${newType}: ${newName}` });
    setNewName("");
    load();
  }

  async function deleteCategory(id: string, name: string) {
    const { error } = await supabase.from("categories").delete().eq("id", id);
    if (error) { alert(`Could not delete category: ${error.message}`); return; }
    await supabase.from("activity_log").insert({ user_email: profile?.email, user_name: profile?.full_name, action: "Delete Category", details: name });
    setCategories(prev => prev.filter(c => c.id !== id));
  }

  async function saveEdit(id: string) {
    if (!editName.trim()) { setEditId(null); return; }
    const { error } = await supabase.from("categories").update({ name: editName.trim() }).eq("id", id);
    if (error) { alert(`Could not rename category: ${error.message}`); return; }
    setCategories(prev => prev.map(c => c.id === id ? { ...c, name: editName.trim() } : c));
    setEditId(null);
    setEditName("");
  }

  async function toggleActive(id: string, active: boolean) {
    const next = !active;
    setCategories(prev => prev.map(c => c.id === id ? { ...c, active: next } : c));
    const { error } = await supabase.from("categories").update({ active: next }).eq("id", id);
    if (error) {
      setCategories(prev => prev.map(c => c.id === id ? { ...c, active } : c));
      alert(`Could not toggle category: ${error.message}`);
    }
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
  const [saveError, setSaveError] = useState<string | null>(null);

  const [form, setForm] = useState({
    email_alerts_enabled: false,
    email_allowed_senders: "",
    email_subject_keywords: "",
    email_gmail_label: "BankAlerts",
    email_processed_label: "BankAlerts/Processed",
    email_webhook_secret: "",
    email_max_per_run: "25",
    email_start_date: "",
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
        email_start_date: d.email_start_date ?? "",
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

  /** Returns null on success, or the database error message on failure. */
  async function persist(extra: Record<string, unknown> = {}): Promise<string | null> {
    const startDate = String(extra.email_start_date ?? form.email_start_date).trim();
    const payload: Record<string, unknown> = {
      ...form,
      ...extra,
      email_max_per_run: parseInt(String(extra.email_max_per_run ?? form.email_max_per_run), 10) || 25,
      // A date column rejects "", so an empty field must go in as null.
      email_start_date: startDate || null,
      updated_at: new Date().toISOString(),
    };

    // Previously unchecked: if a column referenced here doesn't exist yet
    // (e.g. the fix migration hasn't run), Supabase's update fails and the
    // form silently keeps showing the old value after every refresh, with
    // no indication anything went wrong. Returning the error (rather than
    // relying on state, which wouldn't be visible to the caller in the same
    // tick) is what lets the caller decide whether to log activity or show
    // the failure.
    if (settingsId) {
      const { error } = await supabase.from("school_settings").update(payload).eq("id", settingsId);
      if (error) return error.message;
    } else {
      const { data, error } = await supabase
        .from("school_settings")
        .insert({ ...payload, school_name: "My School" })
        .select("id")
        .single();
      if (error) return error.message;
      if (data) setSettingsId(data.id);
    }

    // Confirm what was actually written, rather than trusting the payload
    // we sent � this is what makes the "resets after refresh" symptom
    // visible immediately instead of only on the next page load.
    await load();
    return null;
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    const err = await persist();
    if (err) {
      setSaveError(err);
    } else {
      await supabase.from("activity_log").insert({
        user_email: profile?.email,
        user_name: profile?.full_name,
        action: "Update Email Alert Settings",
        details: `Email alerts: ${form.email_alerts_enabled ? "ON" : "OFF"}, start date: ${form.email_start_date || "none"}`,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    }
    setSaving(false);
  }

  async function toggleEnabled(checked: boolean) {
    // Turning the channel on without a cutoff would let the script walk
    // back through every old alert in the label, so default to today.
    const needsCutoff = checked && !form.email_start_date;
    const today = new Date().toISOString().substring(0, 10);
    const extra: Record<string, unknown> = { email_alerts_enabled: checked };
    if (needsCutoff) extra.email_start_date = today;

    setForm(f => ({
      ...f,
      email_alerts_enabled: checked,
      email_start_date: needsCutoff ? today : f.email_start_date,
    }));
    const err = await persist(extra);
    setSaveError(err);
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
            <Input
              label="Only Process Alerts From"
              type="date"
              value={form.email_start_date}
              onChange={set("email_start_date")}
              helpText="Emails older than this date are ignored. Bank labels often hold years of alerts — this stops them being posted as new transactions."
            />
            <div className="sm:col-span-2 flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <AlertTriangle size={16} className="text-blue-600 shrink-0 mt-0.5" />
              <p className="text-xs text-blue-800">
                Your <strong>{form.email_gmail_label || "BankAlerts"}</strong> label currently holds
                thousands of past alerts. Keep the start date at today unless you genuinely want
                older transactions posted to the ledger, and if you do, raise it a few days at a
                time so you can check the results.
              </p>
            </div>
            <div className="sm:col-span-2 flex items-start gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
              <CheckCircle2 size={16} className="text-green-600 shrink-0 mt-0.5" />
              <p className="text-xs text-green-800">
                Ask parents and guardians to put the student&apos;s code (e.g. <strong>S234</strong>) at
                the start of the transfer description or narration. A code is matched with
                certainty; a name alone can still be misread if it&apos;s abbreviated, misspelled, or
                the transfer states someone else&apos;s name (a relative paying on the student&apos;s
                behalf). A code always wins when both are present.
              </p>
            </div>
            <div className="sm:col-span-2 flex items-center gap-3 pt-2">
              <Button type="submit" variant="gold" loading={saving}>
                <Save size={14} /> Save Filters
              </Button>
              {saved && <span className="text-green-600 text-sm font-medium">Saved</span>}
            </div>
            {saveError && (
              <div className="sm:col-span-2 flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                <AlertTriangle size={16} className="text-red-600 shrink-0 mt-0.5" />
                <p className="text-xs text-red-800">
                  Save failed � {saveError}. If this mentions a missing column, the fix migration
                  (<code className="bg-red-100 px-1 rounded">email_alerts_fix_migration.sql</code>)
                  hasn't been run yet in Supabase.
                </p>
              </div>
            )}
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
 * School Finance Suite � bank alert email forwarder.
 *
 * Reads bank alert emails from a Gmail label and forwards them to the app,
 * which parses them and posts income or expense entries.
 *
 * All filtering rules live in the app (Setup > Email Alerts) and are
 * fetched on every run, so this script should not need editing again.
 *
 * Setup: add a time-driven trigger for processBankEmails, every 5 minutes.
 *
 * Two things this script is deliberately careful about:
 *
 *  1. It tracks individual MESSAGE ids, not thread labels. Gmail groups
 *     messages with the same subject into one thread, and bank alerts all
 *     share a subject, so a thread-level "done" flag would silently drop
 *     every alert that Gmail collapsed into an already-processed thread.
 *
 *  2. A message is only recorded as forwarded after the app confirms it
 *     with a 2xx. Anything that fails is retried on the next run instead
 *     of being lost.
 */

var CONFIG_URL = ${JSON.stringify(configUrl)};
var SECRET = ${JSON.stringify(secret)};

/** Property key holding the ids of messages already forwarded. */
var SEEN_KEY = 'sfs_forwarded_message_ids';

/** How many message ids to remember. Comfortably above daily alert volume. */
var SEEN_LIMIT = 600;

function processBankEmails() {
  var config = fetchConfig_();
  if (!config) return;

  if (!config.enabled) {
    Logger.log('Email alerts are disabled in the app. Nothing to do.');
    return;
  }

  var seen = loadSeen_();
  var cutoff = config.startDate ? new Date(config.startDate + 'T00:00:00') : null;

  // Let Gmail do the date filtering; it is far cheaper than fetching
  // thousands of old threads and discarding them here.
  var query = 'label:' + quoteLabel_(config.gmailLabel);
  if (config.startDate) {
    query += ' after:' + config.startDate.replace(/-/g, '/');
  }

  var threads = GmailApp.search(query, 0, config.maxPerRun || 25);
  if (threads.length === 0) {
    Logger.log('No threads matched: ' + query);
    return;
  }

  var processedLabel = getOrCreateLabel_(config.processedLabel);
  var sent = 0, failed = 0, skippedOld = 0, skippedFilter = 0, skippedSeen = 0;

  for (var t = 0; t < threads.length; t++) {
    var thread = threads[t];
    var messages = thread.getMessages();
    var anySent = false;

    for (var m = 0; m < messages.length; m++) {
      var message = messages[m];
      var id = message.getId();

      // Message-level memory. This is what makes a new alert inside an
      // old thread still get forwarded.
      if (seen[id]) { skippedSeen++; continue; }

      if (cutoff && message.getDate() < cutoff) { skippedOld++; continue; }
      if (!senderAllowed_(message.getFrom(), config.allowedSenders)) { skippedFilter++; continue; }
      if (!subjectAllowed_(message.getSubject(), config.subjectKeywords)) { skippedFilter++; continue; }

      if (postMessage_(config.webhookUrl, message)) {
        seen[id] = 1;
        sent++;
        anySent = true;
      } else {
        // Left out of "seen" on purpose so the next run retries it.
        failed++;
      }
    }

    // Informational only � the label is a progress marker for you, never
    // a skip condition for the script.
    if (anySent) thread.addLabel(processedLabel);
  }

  saveSeen_(seen);

  Logger.log(
    'Forwarded ' + sent + ', failed ' + failed +
    ', already-sent ' + skippedSeen +
    ', too old ' + skippedOld +
    ', filtered out ' + skippedFilter + '.'
  );
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

/** POST a single message to the app's webhook. Returns true only on 2xx. */
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
    var text = response.getContentText();

    if (code >= 200 && code < 300) {
      // The app answers 200 with skipped:true for duplicates and for mail
      // older than the start date. Those are settled outcomes, so treat
      // them as done rather than retrying them forever.
      Logger.log('Sent ' + message.getId() + ': ' + text.substring(0, 180));
      return true;
    }

    Logger.log('Webhook rejected ' + message.getId() + ' (' + code + '): ' + text.substring(0, 300));
    return false;
  } catch (err) {
    Logger.log('Webhook error for ' + message.getId() + ': ' + err);
    return false;
  }
}

/** Load the set of already-forwarded message ids. */
function loadSeen_() {
  var raw = PropertiesService.getScriptProperties().getProperty(SEEN_KEY);
  if (!raw) return {};
  try {
    var ids = JSON.parse(raw);
    var set = {};
    for (var i = 0; i < ids.length; i++) set[ids[i]] = 1;
    return set;
  } catch (err) {
    Logger.log('Could not read forwarded-id memory, starting fresh: ' + err);
    return {};
  }
}

/**
 * Persist the set, keeping only the newest ids. Script properties cap out
 * around 9KB per value, so this stays bounded. The app also rejects
 * duplicates by message id, so trimming can never cause a double post.
 */
function saveSeen_(set) {
  var ids = Object.keys(set);
  if (ids.length > SEEN_LIMIT) ids = ids.slice(ids.length - SEEN_LIMIT);
  PropertiesService.getScriptProperties().setProperty(SEEN_KEY, JSON.stringify(ids));
}

/** Labels containing spaces or slashes need quoting in a Gmail query. */
function quoteLabel_(name) {
  return /[\\s]/.test(name) ? '"' + name + '"' : name;
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

/** Run manually to confirm the app is reachable and the secret is correct. */
function testConnection() {
  var config = fetchConfig_();
  if (!config) {
    Logger.log('Could not reach the app. Check CONFIG_URL and SECRET.');
    return;
  }
  Logger.log(
    'Connected.\\n' +
    '  enabled:    ' + config.enabled + '\\n' +
    '  label:      ' + config.gmailLabel + '\\n' +
    '  startDate:  ' + config.startDate + '\\n' +
    '  senders:    ' + JSON.stringify(config.allowedSenders) + '\\n' +
    '  keywords:   ' + JSON.stringify(config.subjectKeywords) + '\\n' +
    '  maxPerRun:  ' + config.maxPerRun
  );

  var query = 'label:' + quoteLabel_(config.gmailLabel);
  if (config.startDate) query += ' after:' + config.startDate.replace(/-/g, '/');
  var threads = GmailApp.search(query, 0, config.maxPerRun || 25);
  Logger.log('Query "' + query + '" matches ' + threads.length + ' thread(s) in this batch.');
}

/**
 * Troubleshooting helper: forget which messages were forwarded so the next
 * run re-sends everything in range. Safe � the app rejects duplicates by
 * message id, so nothing is posted twice.
 */
function resetForwardedMemory() {
  PropertiesService.getScriptProperties().deleteProperty(SEEN_KEY);
  Logger.log('Forwarded-message memory cleared. The next run will re-check the current window.');
}
`;
}

/**
 * Academic Setup � Class/Grade Structure and Academic Years configuration.
 */
function AcademicSetupTab() {
  const supabase = createClient();
  const { profile, orgId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [subTab, setSubTab] = useState<"classes" | "years" | "subjects" | "periods" | "assessments" | "grades">("classes");

  // --- Classes state ---
  const [classes, setClasses] = useState<Record<string, unknown>[]>([]);
  const [editingClass, setEditingClass] = useState<Record<string, unknown> | null>(null);
  const [classForm, setClassForm] = useState({ name: "", short_code: "", sequence: "0", stage: "", is_terminal: false, next_class_id: "" });
  const [savingClass, setSavingClass] = useState(false);
  const [showClassForm, setShowClassForm] = useState(false);

  // --- Academic Years state ---
  const [years, setYears] = useState<Record<string, unknown>[]>([]);
  const [editingYear, setEditingYear] = useState<Record<string, unknown> | null>(null);
  const [yearForm, setYearForm] = useState({ name: "", term: "", start_date: "", end_date: "", status: "upcoming" });
  const [savingYear, setSavingYear] = useState(false);
  const [showYearForm, setShowYearForm] = useState(false);

  // --- Subjects state ---
  const [subjects, setSubjects] = useState<Record<string, unknown>[]>([]);
  const [showSubjectForm, setShowSubjectForm] = useState(false);
  const [editingSubject, setEditingSubject] = useState<Record<string, unknown> | null>(null);
  const [subjectForm, setSubjectForm] = useState({ name: "", short_code: "", department: "", class_id: "", is_elective: false });
  const [savingSubject, setSavingSubject] = useState(false);

  // --- Periods state ---
  const [periods, setPeriods] = useState<Record<string, unknown>[]>([]);
  const [showPeriodForm, setShowPeriodForm] = useState(false);
  const [editingPeriod, setEditingPeriod] = useState<Record<string, unknown> | null>(null);
  const [periodForm, setPeriodForm] = useState({ name: "", short_code: "", start_time: "08:00", end_time: "08:45", is_break: false, sort_order: "0" });
  const [savingPeriod, setSavingPeriod] = useState(false);

  // --- Assessment Types state ---
  const [assessmentTypes, setAssessmentTypes] = useState<Record<string, unknown>[]>([]);
  const [showAtForm, setShowAtForm] = useState(false);
  const [editingAt, setEditingAt] = useState<Record<string, unknown> | null>(null);
  const [atForm, setAtForm] = useState({ name: "", short_code: "", weight: "10", max_score: "10", sort_order: "0" });
  const [savingAt, setSavingAt] = useState(false);

  // --- Grading Scale state ---
  const [gradingScales, setGradingScales] = useState<Record<string, unknown>[]>([]);
  const [showGsForm, setShowGsForm] = useState(false);
  const [editingGs, setEditingGs] = useState<Record<string, unknown> | null>(null);
  const [gsForm, setGsForm] = useState({ grade: "", label: "", min_score: "0", max_score: "100", grade_point: "0", sort_order: "0" });
  const [savingGs, setSavingGs] = useState(false);

  const load = useCallback(async () => {
    const [classRes, yearRes, subRes, perRes, atRes, gsRes] = await Promise.all([
      supabase.from("classes").select("*").order("sequence"),
      supabase.from("academic_years").select("*").order("name", { ascending: false }),
      supabase.from("subjects").select("*").eq("active", true).order("name"),
      supabase.from("periods").select("*").eq("active", true).order("sort_order"),
      supabase.from("assessment_types").select("*").eq("active", true).order("sort_order"),
      supabase.from("grading_scales").select("*").order("sort_order"),
    ]);
    setClasses(classRes.data ?? []);
    setYears(yearRes.data ?? []);
    setSubjects(subRes.data ?? []);
    setPeriods(perRes.data ?? []);
    setAssessmentTypes(atRes.data ?? []);
    setGradingScales(gsRes.data ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  // --- Class CRUD ---
  function openClassForm(cls?: Record<string, unknown>) {
    if (cls) {
      setEditingClass(cls);
      setClassForm({
        name: String(cls.name || ""),
        short_code: String(cls.short_code || ""),
        sequence: String(cls.sequence ?? 0),
        stage: String(cls.stage || ""),
        is_terminal: cls.is_terminal === true,
        next_class_id: String(cls.next_class_id || ""),
      });
    } else {
      setEditingClass(null);
      const maxSeq = classes.reduce((m, c) => Math.max(m, Number(c.sequence ?? 0)), 0);
      setClassForm({ name: "", short_code: "", sequence: String(maxSeq + 1), stage: "", is_terminal: false, next_class_id: "" });
    }
    setShowClassForm(true);
  }

  async function saveClass() {
    setSavingClass(true);
    const payload: Record<string, unknown> = {
      name: classForm.name.trim(),
      short_code: classForm.short_code.trim() || classForm.name.trim(),
      sequence: parseInt(classForm.sequence) || 0,
      stage: classForm.stage.trim() || null,
      is_terminal: classForm.is_terminal,
      next_class_id: classForm.next_class_id || null,
      updated_at: new Date().toISOString(),
    };
    const { error } = editingClass
      ? await supabase.from("classes").update(payload).eq("id", editingClass.id)
      : await (async () => { payload.organization_id = orgId; return supabase.from("classes").insert(payload); })();
    if (error) { setSavingClass(false); alert(`Could not save class: ${error.message}`); return; }
    await supabase.from("activity_log").insert({
      user_email: profile?.email, user_name: profile?.full_name,
      action: editingClass ? "Update Class" : "Create Class",
      details: payload.name as string,
    });
    setEditingClass(null);
    setShowClassForm(false);
    setSavingClass(false);
    load();
  }

  async function deleteClass(id: string) {
    if (!confirm("Deactivate this class? It will no longer appear in promotion options.")) return;
    const { error } = await supabase.from("classes").update({ active: false, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) { alert(`Could not deactivate class: ${error.message}`); return; }
    load();
  }

  // --- Year CRUD ---
  function openYearForm(yr?: Record<string, unknown>) {
    if (yr) {
      setEditingYear(yr);
      setYearForm({
        name: String(yr.name || ""),
        term: String((yr as Record<string, unknown>).term || ""),
        start_date: String(yr.start_date || ""),
        end_date: String(yr.end_date || ""),
        status: String(yr.status || "upcoming"),
      });
    } else {
      setEditingYear(null);
      setYearForm({ name: "", term: "", start_date: "", end_date: "", status: "upcoming" });
    }
    setShowYearForm(true);
  }

  async function saveYear() {
    setSavingYear(true);
    const payload: Record<string, unknown> = {
      name: yearForm.name.trim(),
      term: yearForm.term.trim() || null,
      start_date: yearForm.start_date || null,
      end_date: yearForm.end_date || null,
      status: yearForm.status,
      updated_at: new Date().toISOString(),
    };
    const { error } = editingYear
      ? await supabase.from("academic_years").update(payload).eq("id", editingYear.id)
      : await (async () => { payload.organization_id = orgId; return supabase.from("academic_years").insert(payload); })();
    if (error) { setSavingYear(false); alert(`Could not save academic year: ${error.message}`); return; }
    await supabase.from("activity_log").insert({
      user_email: profile?.email, user_name: profile?.full_name,
      action: editingYear ? "Update Academic Year" : "Create Academic Year",
      details: `${payload.name} (${payload.status})`,
    });
    setEditingYear(null);
    setShowYearForm(false);
    setSavingYear(false);
    load();
  }

  async function deleteYear(id: string) {
    if (!confirm("Delete this academic year? This cannot be undone if enrollments reference it.")) return;
    const { error } = await supabase.from("academic_years").delete().eq("id", id);
    if (error) alert("Cannot delete: " + error.message);
    else load();
  }

  // --- Subject CRUD ---
  function openSubjectForm(sub?: Record<string, unknown>) {
    if (sub) {
      setEditingSubject(sub);
      setSubjectForm({ name: String(sub.name || ""), short_code: String(sub.short_code || ""), department: String(sub.department || ""), class_id: String(sub.class_id || ""), is_elective: sub.is_elective === true });
    } else {
      setEditingSubject(null);
      setSubjectForm({ name: "", short_code: "", department: "", class_id: "", is_elective: false });
    }
    setShowSubjectForm(true);
  }
  async function saveSubject() {
    setSavingSubject(true);
    const payload = { name: subjectForm.name.trim(), short_code: subjectForm.short_code.trim() || subjectForm.name.trim().substring(0, 4).toUpperCase(), department: subjectForm.department.trim() || null, class_id: subjectForm.class_id || null, is_elective: subjectForm.is_elective, updated_at: new Date().toISOString(), organization_id: orgId };
    const { error } = editingSubject
      ? await supabase.from("subjects").update(payload).eq("id", editingSubject.id)
      : await supabase.from("subjects").insert(payload);
    if (error) { setSavingSubject(false); alert(`Could not save subject: ${error.message}`); return; }
    setEditingSubject(null); setShowSubjectForm(false); setSavingSubject(false); load();
  }

  // --- Period CRUD ---
  function openPeriodForm(per?: Record<string, unknown>) {
    if (per) {
      setEditingPeriod(per);
      setPeriodForm({ name: String(per.name || ""), short_code: String(per.short_code || ""), start_time: String(per.start_time || "08:00"), end_time: String(per.end_time || "08:45"), is_break: per.is_break === true, sort_order: String(per.sort_order ?? 0) });
    } else {
      setEditingPeriod(null);
      const maxOrd = periods.reduce((m, p) => Math.max(m, Number(p.sort_order ?? 0)), 0);
      setPeriodForm({ name: "", short_code: "", start_time: "08:00", end_time: "08:45", is_break: false, sort_order: String(maxOrd + 1) });
    }
    setShowPeriodForm(true);
  }
  async function savePeriod() {
    setSavingPeriod(true);
    const payload = { name: periodForm.name.trim(), short_code: periodForm.short_code.trim() || periodForm.name.trim().substring(0, 3).toUpperCase(), start_time: periodForm.start_time, end_time: periodForm.end_time, is_break: periodForm.is_break, sort_order: parseInt(periodForm.sort_order) || 0, updated_at: new Date().toISOString(), organization_id: orgId };
    const { error } = editingPeriod
      ? await supabase.from("periods").update(payload).eq("id", editingPeriod.id)
      : await supabase.from("periods").insert(payload);
    if (error) { setSavingPeriod(false); alert(`Could not save period: ${error.message}`); return; }
    setEditingPeriod(null); setShowPeriodForm(false); setSavingPeriod(false); load();
  }

  // --- Assessment Type CRUD ---
  function openAtForm(at?: Record<string, unknown>) {
    if (at) {
      setEditingAt(at);
      setAtForm({ name: String(at.name || ""), short_code: String(at.short_code || ""), weight: String(at.weight ?? 10), max_score: String(at.max_score ?? 10), sort_order: String(at.sort_order ?? 0) });
    } else {
      setEditingAt(null);
      const maxOrd = assessmentTypes.reduce((m, a) => Math.max(m, Number(a.sort_order ?? 0)), 0);
      setAtForm({ name: "", short_code: "", weight: "10", max_score: "10", sort_order: String(maxOrd + 1) });
    }
    setShowAtForm(true);
  }
  async function saveAt() {
    setSavingAt(true);
    const payload = { name: atForm.name.trim(), short_code: atForm.short_code.trim() || atForm.name.trim().substring(0, 4).toUpperCase(), weight: parseFloat(atForm.weight) || 0, max_score: parseFloat(atForm.max_score) || 10, sort_order: parseInt(atForm.sort_order) || 0, updated_at: new Date().toISOString(), organization_id: orgId };
    const { error } = editingAt
      ? await supabase.from("assessment_types").update(payload).eq("id", editingAt.id)
      : await supabase.from("assessment_types").insert(payload);
    if (error) { setSavingAt(false); alert(`Could not save assessment type: ${error.message}`); return; }
    setEditingAt(null); setShowAtForm(false); setSavingAt(false); load();
  }
  async function deleteAt(id: string) {
    if (!confirm("Deactivate this assessment type?")) return;
    const { error } = await supabase.from("assessment_types").update({ active: false }).eq("id", id);
    if (error) { alert(`Could not deactivate: ${error.message}`); return; }
    load();
  }

  // --- Grading Scale CRUD ---
  function openGsForm(gs?: Record<string, unknown>) {
    if (gs) {
      setEditingGs(gs);
      setGsForm({ grade: String(gs.grade || ""), label: String(gs.label || ""), min_score: String(gs.min_score ?? 0), max_score: String(gs.max_score ?? 100), grade_point: String(gs.grade_point ?? 0), sort_order: String(gs.sort_order ?? 0) });
    } else {
      setEditingGs(null);
      const maxOrd = gradingScales.reduce((m, g) => Math.max(m, Number(g.sort_order ?? 0)), 0);
      setGsForm({ grade: "", label: "", min_score: "0", max_score: "100", grade_point: "0", sort_order: String(maxOrd + 1) });
    }
    setShowGsForm(true);
  }
  async function saveGs() {
    setSavingGs(true);
    const payload = { grade: gsForm.grade.trim(), label: gsForm.label.trim(), min_score: parseFloat(gsForm.min_score) || 0, max_score: parseFloat(gsForm.max_score) || 100, grade_point: parseFloat(gsForm.grade_point) || 0, sort_order: parseInt(gsForm.sort_order) || 0, organization_id: orgId };
    const { error } = editingGs
      ? await supabase.from("grading_scales").update(payload).eq("id", editingGs.id)
      : await supabase.from("grading_scales").insert(payload);
    if (error) { setSavingGs(false); alert(`Could not save grade band: ${error.message}`); return; }
    setEditingGs(null); setShowGsForm(false); setSavingGs(false); load();
  }
  async function deleteGs(id: string) {
    if (!confirm("Delete this grade?")) return;
    const { error } = await supabase.from("grading_scales").delete().eq("id", id);
    if (error) { alert(`Could not delete grade: ${error.message}`); return; }
    load();
  }

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-5">
      {/* Sub-tabs */}
      <div className="flex gap-2 flex-wrap">
        <button onClick={() => setSubTab("classes")} className={cn("px-4 py-2 text-sm font-medium rounded-lg", subTab === "classes" ? "bg-[#0F2A47] text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200")}>
          Class / Grade Structure
        </button>
        <button onClick={() => setSubTab("years")} className={cn("px-4 py-2 text-sm font-medium rounded-lg", subTab === "years" ? "bg-[#0F2A47] text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200")}>
          Academic Years
        </button>
        <button onClick={() => setSubTab("subjects")} className={cn("px-4 py-2 text-sm font-medium rounded-lg", subTab === "subjects" ? "bg-[#0F2A47] text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200")}>
          Subjects
        </button>
        <button onClick={() => setSubTab("periods")} className={cn("px-4 py-2 text-sm font-medium rounded-lg", subTab === "periods" ? "bg-[#0F2A47] text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200")}>
          Periods
        </button>
        <button onClick={() => setSubTab("assessments")} className={cn("px-4 py-2 text-sm font-medium rounded-lg", subTab === "assessments" ? "bg-[#0F2A47] text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200")}>
          Assessment Types
        </button>
        <button onClick={() => setSubTab("grades")} className={cn("px-4 py-2 text-sm font-medium rounded-lg", subTab === "grades" ? "bg-[#0F2A47] text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200")}>
          Grading Scale
        </button>
      </div>

      {subTab === "classes" && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Class / Grade Structure</CardTitle>
              <Button size="sm" variant="gold" onClick={() => openClassForm()}>
                <Plus size={14} /> Add Class
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-gray-500 mb-4">
              Define your school&apos;s class progression. The sequence determines promotion order.
              Set &ldquo;Next Class&rdquo; to define explicit promotion paths, or leave blank to use sequence order.
            </p>

            {/* Class form */}
            {showClassForm && (
              <div className="mb-4 p-4 border border-[#C9A227] bg-[#FBF6E8] rounded-xl space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <Input label="Class Name" value={classForm.name} onChange={e => setClassForm(f => ({ ...f, name: e.target.value }))} placeholder="JSS1" />
                  <Input label="Short Code" value={classForm.short_code} onChange={e => setClassForm(f => ({ ...f, short_code: e.target.value }))} placeholder="JSS1" />
                  <Input label="Sequence" type="number" value={classForm.sequence} onChange={e => setClassForm(f => ({ ...f, sequence: e.target.value }))} />
                  <Input label="Stage (optional)" value={classForm.stage} onChange={e => setClassForm(f => ({ ...f, stage: e.target.value }))} placeholder="Junior Secondary" />
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Next Class</label>
                    <select value={classForm.next_class_id} onChange={e => setClassForm(f => ({ ...f, next_class_id: e.target.value }))}
                      className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227] bg-white">
                      <option value="">� Auto (by sequence) �</option>
                      {classes.filter(c => c.id !== editingClass?.id && c.active !== false).map(c => (
                        <option key={String(c.id)} value={String(c.id)}>{String(c.name)}</option>
                      ))}
                      <option value="__terminal__">� Terminal / Graduation �</option>
                    </select>
                  </div>
                  <div className="flex items-end pb-1">
                    <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                      <input type="checkbox" checked={classForm.is_terminal || classForm.next_class_id === "__terminal__"}
                        onChange={e => setClassForm(f => ({ ...f, is_terminal: e.target.checked, next_class_id: e.target.checked ? "" : f.next_class_id }))}
                        className="w-4 h-4 rounded border-gray-300 text-[#C9A227] focus:ring-[#C9A227]" />
                      Terminal (graduation)
                    </label>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="gold" loading={savingClass} onClick={saveClass} disabled={!classForm.name.trim()}>
                    <Save size={14} /> {editingClass ? "Update" : "Add"}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => { setEditingClass(null); setShowClassForm(false); setClassForm({ name: "", short_code: "", sequence: "0", stage: "", is_terminal: false, next_class_id: "" }); }}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {/* Class table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b">
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Seq</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Class Name</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Code</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Stage</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Next</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Terminal</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {classes.filter(c => c.active !== false).map(c => {
                    const nextCls = classes.find(x => x.id === c.next_class_id);
                    return (
                      <tr key={String(c.id)} className="border-b hover:bg-gray-50">
                        <td className="px-3 py-2 text-gray-500">{String(c.sequence)}</td>
                        <td className="px-3 py-2 font-medium">{String(c.name)}</td>
                        <td className="px-3 py-2 text-gray-500 font-mono text-xs">{String(c.short_code)}</td>
                        <td className="px-3 py-2 text-gray-500">{String(c.stage || "�")}</td>
                        <td className="px-3 py-2 text-gray-500">{nextCls ? String(nextCls.name) : c.is_terminal ? "Graduation" : "�"}</td>
                        <td className="px-3 py-2">{c.is_terminal ? <span className="text-xs font-bold text-green-700 bg-green-50 px-2 py-0.5 rounded">Yes</span> : ""}</td>
                        <td className="px-3 py-2 text-right">
                          <button onClick={() => openClassForm(c)} className="text-xs text-[#0F2A47] hover:underline mr-2">Edit</button>
                          <button onClick={() => deleteClass(String(c.id))} className="text-xs text-red-500 hover:underline">Deactivate</button>
                        </td>
                      </tr>
                    );
                  })}
                  {classes.filter(c => c.active !== false).length === 0 && (
                    <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-400">No classes configured. Click &ldquo;Add Class&rdquo; to define your school&apos;s grade structure.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {subTab === "years" && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Academic Years</CardTitle>
              <Button size="sm" variant="gold" onClick={() => openYearForm()}>
                <Plus size={14} /> Add Year
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-gray-500 mb-4">
              Define academic years. Only one year can be &ldquo;Current&rdquo; at a time.
              Promotion moves students from the current year to the upcoming year.
            </p>

            {/* Year form */}
            {showYearForm && (
              <div className="mb-4 p-4 border border-[#C9A227] bg-[#FBF6E8] rounded-xl space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  <Input label="Year Name" value={yearForm.name} onChange={e => setYearForm(f => ({ ...f, name: e.target.value }))} placeholder="2025/2026" />
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Term</label>
                    <select value={yearForm.term} onChange={e => setYearForm(f => ({ ...f, term: e.target.value }))} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227] bg-white">
                      <option value="">Full Year</option>
                      <option value="Term 1">Term 1</option>
                      <option value="Term 2">Term 2</option>
                      <option value="Term 3">Term 3</option>
                    </select>
                  </div>
                  <Input label="Start Date" type="date" value={yearForm.start_date} onChange={e => setYearForm(f => ({ ...f, start_date: e.target.value }))} />
                  <Input label="End Date" type="date" value={yearForm.end_date} onChange={e => setYearForm(f => ({ ...f, end_date: e.target.value }))} />
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                    <select value={yearForm.status} onChange={e => setYearForm(f => ({ ...f, status: e.target.value }))}
                      className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227] bg-white">
                      <option value="upcoming">Upcoming</option>
                      <option value="current">Current</option>
                      <option value="closed">Closed</option>
                    </select>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="gold" loading={savingYear} onClick={saveYear} disabled={!yearForm.name.trim()}>
                    <Save size={14} /> {editingYear ? "Update" : "Add"}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => { setEditingYear(null); setShowYearForm(false); setYearForm({ name: "", term: "", start_date: "", end_date: "", status: "upcoming" }); }}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {/* Year table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b">
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Year</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Term</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Start</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">End</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Status</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {years.map(y => (
                    <tr key={String(y.id)} className="border-b hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium">{String(y.name)}</td>
                      <td className="px-3 py-2">
                        {y.term ? (
                          <span className="px-2 py-0.5 rounded text-xs font-semibold bg-[#FBF6E8] text-[#8a6d1a]">{String(y.term)}</span>
                        ) : (
                          <span className="text-gray-400 text-xs">Full year</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-gray-500">{y.start_date ? String(y.start_date) : "—"}</td>
                      <td className="px-3 py-2 text-gray-500">{y.end_date ? String(y.end_date) : "—"}</td>
                      <td className="px-3 py-2">
                        <span className={cn("px-2 py-0.5 rounded text-xs font-bold",
                          y.status === "current" ? "bg-green-100 text-green-700" :
                          y.status === "closed" ? "bg-gray-100 text-gray-600" :
                          "bg-blue-100 text-blue-700"
                        )}>{String(y.status)}</span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button onClick={() => openYearForm(y)} className="text-xs text-[#0F2A47] hover:underline mr-2">Edit</button>
                        <button onClick={() => deleteYear(String(y.id))} className="text-xs text-red-500 hover:underline">Delete</button>
                      </td>
                    </tr>
                  ))}
                  {years.length === 0 && (
                    <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-400">No academic years configured. Click &ldquo;Add Year&rdquo; to create one.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {subTab === "subjects" && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Subjects ({subjects.length})</CardTitle>
              <Button size="sm" variant="gold" onClick={() => openSubjectForm()}>
                <Plus size={14} /> Add Subject
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {showSubjectForm && (
              <div className="mb-4 p-4 border border-[#C9A227] bg-[#FBF6E8] rounded-xl space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <Input label="Subject Name" value={subjectForm.name} onChange={e => setSubjectForm(f => ({ ...f, name: e.target.value }))} placeholder="Mathematics" />
                  <Input label="Short Code" value={subjectForm.short_code} onChange={e => setSubjectForm(f => ({ ...f, short_code: e.target.value }))} placeholder="MATH" />
                  <Input label="Department" value={subjectForm.department} onChange={e => setSubjectForm(f => ({ ...f, department: e.target.value }))} placeholder="Sciences" />
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Class (optional)</label>
                    <select value={subjectForm.class_id} onChange={e => setSubjectForm(f => ({ ...f, class_id: e.target.value }))}
                      className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227] bg-white">
                      <option value="">All classes</option>
                      {classes.filter(c => c.active !== false).map(c => <option key={String(c.id)} value={String(c.id)}>{String(c.name)}</option>)}
                    </select>
                  </div>
                  <div className="flex items-end pb-1">
                    <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                      <input type="checkbox" checked={subjectForm.is_elective} onChange={e => setSubjectForm(f => ({ ...f, is_elective: e.target.checked }))} className="w-4 h-4 rounded border-gray-300 text-[#C9A227] focus:ring-[#C9A227]" />
                      Elective
                    </label>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="gold" loading={savingSubject} onClick={saveSubject} disabled={!subjectForm.name.trim()}><Save size={14} /> {editingSubject ? "Update" : "Add"}</Button>
                  <Button size="sm" variant="secondary" onClick={() => { setShowSubjectForm(false); setEditingSubject(null); }}>Cancel</Button>
                </div>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="bg-gray-50 border-b">
                  <th className="text-left px-3 py-2 font-semibold text-gray-600">Subject</th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-600">Code</th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-600">Department</th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-600">Class</th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-600">Elective</th>
                  <th className="px-3 py-2" />
                </tr></thead>
                <tbody>
                  {subjects.map(s => (
                    <tr key={String(s.id)} className="border-b hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium">{String(s.name)}</td>
                      <td className="px-3 py-2 text-gray-500 font-mono text-xs">{String(s.short_code)}</td>
                      <td className="px-3 py-2 text-gray-500">{String(s.department || "�")}</td>
                      <td className="px-3 py-2 text-gray-500">{s.class_id ? String(classes.find(c => c.id === s.class_id)?.name || "�") : "All"}</td>
                      <td className="px-3 py-2">{s.is_elective ? <span className="text-xs font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded">Yes</span> : ""}</td>
                      <td className="px-3 py-2 text-right"><button onClick={() => openSubjectForm(s)} className="text-xs text-[#0F2A47] hover:underline">Edit</button></td>
                    </tr>
                  ))}
                  {subjects.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-400">No subjects configured.</td></tr>}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {subTab === "periods" && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Periods / Time Slots ({periods.length})</CardTitle>
              <Button size="sm" variant="gold" onClick={() => openPeriodForm()}>
                <Plus size={14} /> Add Period
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {showPeriodForm && (
              <div className="mb-4 p-4 border border-[#C9A227] bg-[#FBF6E8] rounded-xl space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <Input label="Period Name" value={periodForm.name} onChange={e => setPeriodForm(f => ({ ...f, name: e.target.value }))} placeholder="Period 1" />
                  <Input label="Short Code" value={periodForm.short_code} onChange={e => setPeriodForm(f => ({ ...f, short_code: e.target.value }))} placeholder="P1" />
                  <Input label="Start Time" type="time" value={periodForm.start_time} onChange={e => setPeriodForm(f => ({ ...f, start_time: e.target.value }))} />
                  <Input label="End Time" type="time" value={periodForm.end_time} onChange={e => setPeriodForm(f => ({ ...f, end_time: e.target.value }))} />
                  <Input label="Order" type="number" value={periodForm.sort_order} onChange={e => setPeriodForm(f => ({ ...f, sort_order: e.target.value }))} />
                  <div className="flex items-end pb-1">
                    <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                      <input type="checkbox" checked={periodForm.is_break} onChange={e => setPeriodForm(f => ({ ...f, is_break: e.target.checked }))} className="w-4 h-4 rounded border-gray-300 text-[#C9A227] focus:ring-[#C9A227]" />
                      Break / Non-teaching
                    </label>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="gold" loading={savingPeriod} onClick={savePeriod} disabled={!periodForm.name.trim()}><Save size={14} /> {editingPeriod ? "Update" : "Add"}</Button>
                  <Button size="sm" variant="secondary" onClick={() => { setShowPeriodForm(false); setEditingPeriod(null); }}>Cancel</Button>
                </div>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="bg-gray-50 border-b">
                  <th className="text-left px-3 py-2 font-semibold text-gray-600">Order</th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-600">Period</th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-600">Code</th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-600">Start</th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-600">End</th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-600">Type</th>
                  <th className="px-3 py-2" />
                </tr></thead>
                <tbody>
                  {periods.map(p => (
                    <tr key={String(p.id)} className={cn("border-b hover:bg-gray-50", p.is_break && "bg-amber-50")}>
                      <td className="px-3 py-2 text-gray-400">{String(p.sort_order)}</td>
                      <td className="px-3 py-2 font-medium">{String(p.name)}</td>
                      <td className="px-3 py-2 text-gray-500 font-mono text-xs">{String(p.short_code)}</td>
                      <td className="px-3 py-2 text-gray-600">{String(p.start_time || "").substring(0, 5)}</td>
                      <td className="px-3 py-2 text-gray-600">{String(p.end_time || "").substring(0, 5)}</td>
                      <td className="px-3 py-2">{p.is_break ? <span className="text-xs font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded">Break</span> : <span className="text-xs text-gray-500">Teaching</span>}</td>
                      <td className="px-3 py-2 text-right"><button onClick={() => openPeriodForm(p)} className="text-xs text-[#0F2A47] hover:underline">Edit</button></td>
                    </tr>
                  ))}
                  {periods.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-400">No periods configured.</td></tr>}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {subTab === "assessments" && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Assessment Types</CardTitle>
              <Button size="sm" variant="gold" onClick={() => openAtForm()}><Plus size={14} /> Add Type</Button>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-gray-500 mb-3">Define the assessment components (CA, Exam, Test, etc.) and their weights. The total weight determines the overall maximum score.</p>
            {showAtForm && (
              <div className="mb-4 p-4 border border-[#C9A227] bg-[#FBF6E8] rounded-xl space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  <Input label="Name" value={atForm.name} onChange={e => setAtForm(f => ({ ...f, name: e.target.value }))} placeholder="First CA" />
                  <Input label="Code" value={atForm.short_code} onChange={e => setAtForm(f => ({ ...f, short_code: e.target.value }))} placeholder="CA1" />
                  <Input label="Weight (%)" type="number" value={atForm.weight} onChange={e => setAtForm(f => ({ ...f, weight: e.target.value }))} />
                  <Input label="Max Score" type="number" value={atForm.max_score} onChange={e => setAtForm(f => ({ ...f, max_score: e.target.value }))} />
                  <Input label="Order" type="number" value={atForm.sort_order} onChange={e => setAtForm(f => ({ ...f, sort_order: e.target.value }))} />
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="gold" loading={savingAt} onClick={saveAt} disabled={!atForm.name.trim()}><Save size={14} /> {editingAt ? "Update" : "Add"}</Button>
                  <Button size="sm" variant="secondary" onClick={() => { setShowAtForm(false); setEditingAt(null); }}>Cancel</Button>
                </div>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="bg-gray-50 border-b">
                  <th className="text-left px-3 py-2 font-semibold text-gray-600">Order</th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-600">Name</th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-600">Code</th>
                  <th className="text-right px-3 py-2 font-semibold text-gray-600">Weight (%)</th>
                  <th className="text-right px-3 py-2 font-semibold text-gray-600">Max Score</th>
                  <th className="px-3 py-2" />
                </tr></thead>
                <tbody>
                  {assessmentTypes.map(at => (
                    <tr key={String(at.id)} className="border-b hover:bg-gray-50">
                      <td className="px-3 py-2 text-gray-400">{String(at.sort_order)}</td>
                      <td className="px-3 py-2 font-medium">{String(at.name)}</td>
                      <td className="px-3 py-2 text-gray-500 font-mono text-xs">{String(at.short_code)}</td>
                      <td className="px-3 py-2 text-right">{String(at.weight)}%</td>
                      <td className="px-3 py-2 text-right">{String(at.max_score)}</td>
                      <td className="px-3 py-2 text-right">
                        <button onClick={() => openAtForm(at)} className="text-xs text-[#0F2A47] hover:underline mr-2">Edit</button>
                        <button onClick={() => deleteAt(String(at.id))} className="text-xs text-red-500 hover:underline">Remove</button>
                      </td>
                    </tr>
                  ))}
                  {assessmentTypes.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-400">No assessment types configured.</td></tr>}
                </tbody>
                <tfoot><tr className="bg-gray-50 border-t font-semibold">
                  <td colSpan={3} className="px-3 py-2 text-gray-600">Total</td>
                  <td className="px-3 py-2 text-right text-gray-600">{assessmentTypes.reduce((s, a) => s + Number(a.weight ?? 0), 0)}%</td>
                  <td className="px-3 py-2 text-right text-gray-600">{assessmentTypes.reduce((s, a) => s + Number(a.max_score ?? 0), 0)}</td>
                  <td />
                </tr></tfoot>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {subTab === "grades" && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Grading Scale</CardTitle>
              <Button size="sm" variant="gold" onClick={() => openGsForm()}><Plus size={14} /> Add Grade</Button>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-gray-500 mb-3">Define letter grades and their score boundaries. The Assessments page uses this to convert totals into grades automatically.</p>
            {showGsForm && (
              <div className="mb-4 p-4 border border-[#C9A227] bg-[#FBF6E8] rounded-xl space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
                  <Input label="Grade" value={gsForm.grade} onChange={e => setGsForm(f => ({ ...f, grade: e.target.value }))} placeholder="A" />
                  <Input label="Label" value={gsForm.label} onChange={e => setGsForm(f => ({ ...f, label: e.target.value }))} placeholder="Excellent" />
                  <Input label="Min %" type="number" value={gsForm.min_score} onChange={e => setGsForm(f => ({ ...f, min_score: e.target.value }))} />
                  <Input label="Max %" type="number" value={gsForm.max_score} onChange={e => setGsForm(f => ({ ...f, max_score: e.target.value }))} />
                  <Input label="GPA Point" type="number" step="0.1" value={gsForm.grade_point} onChange={e => setGsForm(f => ({ ...f, grade_point: e.target.value }))} />
                  <Input label="Order" type="number" value={gsForm.sort_order} onChange={e => setGsForm(f => ({ ...f, sort_order: e.target.value }))} />
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="gold" loading={savingGs} onClick={saveGs} disabled={!gsForm.grade.trim()}><Save size={14} /> {editingGs ? "Update" : "Add"}</Button>
                  <Button size="sm" variant="secondary" onClick={() => { setShowGsForm(false); setEditingGs(null); }}>Cancel</Button>
                </div>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="bg-gray-50 border-b">
                  <th className="text-left px-3 py-2 font-semibold text-gray-600">Grade</th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-600">Label</th>
                  <th className="text-right px-3 py-2 font-semibold text-gray-600">Min %</th>
                  <th className="text-right px-3 py-2 font-semibold text-gray-600">Max %</th>
                  <th className="text-right px-3 py-2 font-semibold text-gray-600">GPA</th>
                  <th className="px-3 py-2" />
                </tr></thead>
                <tbody>
                  {gradingScales.map(gs => (
                    <tr key={String(gs.id)} className="border-b hover:bg-gray-50">
                      <td className="px-3 py-2 font-bold text-[#0F2A47]">{String(gs.grade)}</td>
                      <td className="px-3 py-2 text-gray-600">{String(gs.label)}</td>
                      <td className="px-3 py-2 text-right">{String(gs.min_score)}</td>
                      <td className="px-3 py-2 text-right">{String(gs.max_score)}</td>
                      <td className="px-3 py-2 text-right">{String(gs.grade_point)}</td>
                      <td className="px-3 py-2 text-right">
                        <button onClick={() => openGsForm(gs)} className="text-xs text-[#0F2A47] hover:underline mr-2">Edit</button>
                        <button onClick={() => deleteGs(String(gs.id))} className="text-xs text-red-500 hover:underline">Delete</button>
                      </td>
                    </tr>
                  ))}
                  {gradingScales.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-400">No grading scale configured.</td></tr>}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/**
 * Auto-Credit Policy � configurable rule-based auto-credit decision system.
 */
function AutoCreditPolicyTab() {
  const supabase = createClient();
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [auditLog, setAuditLog] = useState<Record<string, unknown>[]>([]);

  const [policy, setPolicy] = useState({
    preset: "balanced" as string,
    minimumConfidence: 75,
    allowExactCode: true,
    allowThreeExactNames: true,
    allowTwoExactNames: true,
    allowExactPlusPrefix: true,
    allowSingleName: false,
    allowFuzzyOnly: false,
    requireAmount: true,
    requireCreditDirection: true,
    requireUniqueCandidate: true,
    blockDuplicates: true,
    blockAmbiguous: true,
    blockConflicts: true,
  });

  const load = useCallback(async () => {
    const { data } = await supabase.from("school_settings").select("auto_credit_policy").limit(1).single();
    if (data && (data as Record<string, unknown>).auto_credit_policy) {
      const p = (data as Record<string, unknown>).auto_credit_policy as Record<string, unknown>;
      setPolicy(prev => ({ ...prev, ...p } as typeof prev));
    }
    const { data: logs } = await supabase.from("policy_audit_log").select("*").order("changed_at", { ascending: false }).limit(10);
    setAuditLog(logs ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  async function savePolicy() {
    setSaving(true);
    const { data: current } = await supabase.from("school_settings").select("auto_credit_policy").limit(1).single();
    const previousPolicy = current ? (current as Record<string, unknown>).auto_credit_policy : null;

    await supabase.from("school_settings").update({ auto_credit_policy: policy }).neq("id", "");

    await supabase.from("policy_audit_log").insert({
      changed_by_email: profile?.email,
      changed_by_name: profile?.full_name,
      previous_policy: previousPolicy,
      new_policy: policy,
      preset_name: policy.preset,
      changes_summary: `Policy updated to ${policy.preset} preset, min confidence ${policy.minimumConfidence}%`,
    });

    await supabase.from("activity_log").insert({
      user_email: profile?.email,
      user_name: profile?.full_name,
      action: "Update Auto-Credit Policy",
      details: `Preset: ${policy.preset}, min confidence: ${policy.minimumConfidence}%`,
    });

    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
    load();
  }

  function applyPreset(name: string) {
    const presets: Record<string, typeof policy> = {
      conservative: { preset: "conservative", minimumConfidence: 85, allowExactCode: true, allowThreeExactNames: true, allowTwoExactNames: true, allowExactPlusPrefix: false, allowSingleName: false, allowFuzzyOnly: false, requireAmount: true, requireCreditDirection: true, requireUniqueCandidate: true, blockDuplicates: true, blockAmbiguous: true, blockConflicts: true },
      balanced: { preset: "balanced", minimumConfidence: 75, allowExactCode: true, allowThreeExactNames: true, allowTwoExactNames: true, allowExactPlusPrefix: true, allowSingleName: false, allowFuzzyOnly: false, requireAmount: true, requireCreditDirection: true, requireUniqueCandidate: true, blockDuplicates: true, blockAmbiguous: true, blockConflicts: true },
      flexible: { preset: "flexible", minimumConfidence: 60, allowExactCode: true, allowThreeExactNames: true, allowTwoExactNames: true, allowExactPlusPrefix: true, allowSingleName: true, allowFuzzyOnly: false, requireAmount: true, requireCreditDirection: true, requireUniqueCandidate: true, blockDuplicates: true, blockAmbiguous: true, blockConflicts: true },
    };
    if (presets[name]) setPolicy({ ...presets[name], preset: name });
  }

  const evidenceRules = [
    { key: "allowExactCode" as const, label: "Exact unique student/vendor code", strength: "Very Strong", rec: "recommended" as const, warn: "" },
    { key: "allowThreeExactNames" as const, label: "3 exact name components", strength: "Very Strong", rec: "recommended" as const, warn: "" },
    { key: "allowTwoExactNames" as const, label: "2 exact name components + unique candidate", strength: "Strong", rec: "recommended" as const, warn: "" },
    { key: "allowExactPlusPrefix" as const, label: "Exact + prefix name match", strength: "Strong", rec: "recommended" as const, warn: "" },
    { key: "allowSingleName" as const, label: "Single exact name only", strength: "Low", rec: "caution" as const, warn: "A single name may match multiple students. Increases risk of incorrect allocation." },
    { key: "allowFuzzyOnly" as const, label: "Fuzzy/substring match only", strength: "Very Low", rec: "not_recommended" as const, warn: "Fuzzy-only matching can result in incorrect allocation. Not recommended." },
  ];

  const safetyGates = [
    { key: "requireAmount" as const, label: "Amount must be present" },
    { key: "requireCreditDirection" as const, label: "Credit direction must be confirmed" },
    { key: "requireUniqueCandidate" as const, label: "Candidate must be unique" },
    { key: "blockDuplicates" as const, label: "Confirmed duplicates cannot auto-credit" },
    { key: "blockAmbiguous" as const, label: "Ambiguous matches cannot auto-credit" },
    { key: "blockConflicts" as const, label: "Conflicting evidence blocks auto-credit" },
  ];

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      {/* Header with preset selector */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Auto-Credit Policy</CardTitle>
            <div className="flex items-center gap-2">
              <select
                value={policy.preset}
                onChange={e => applyPreset(e.target.value)}
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
              >
                <option value="conservative">Conservative</option>
                <option value="balanced">Balanced (Recommended)</option>
                <option value="flexible">Flexible</option>
                <option value="custom">Custom</option>
              </select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-600">
            Automatically credit a payment <strong>only</strong> when the required safety conditions are satisfied.
            The system evaluates identity evidence, checks safety gates, then applies the confidence threshold.
          </p>
          <p className="text-xs text-gray-400 mt-2">
            A high confidence score alone is <strong>never</strong> enough � hard safety gates always block regardless of score.
          </p>
        </CardContent>
      </Card>

      {/* Identity Evidence Rules */}
      <Card>
        <CardHeader><CardTitle>Identity Evidence</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-gray-500 mb-3">
            Which types of identity evidence are sufficient for automatic credit? Each enabled rule can independently qualify a payment.
          </p>
          {evidenceRules.map(rule => (
            <div key={rule.key} className={cn(
              "flex items-start gap-3 p-3 rounded-lg border",
              policy[rule.key] ? "bg-white border-gray-200" : "bg-gray-50 border-gray-100"
            )}>
              <label className="relative inline-flex items-center cursor-pointer mt-0.5">
                <input
                  type="checkbox"
                  checked={policy[rule.key]}
                  onChange={e => setPolicy(p => ({ ...p, [rule.key]: e.target.checked, preset: "custom" }))}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-gray-300 peer-focus:ring-2 peer-focus:ring-[#C9A227] rounded-full peer peer-checked:after:translate-x-full peer-checked:bg-[#0F2A47] after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all" />
              </label>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-900">{rule.label}</span>
                  <span className={cn(
                    "px-2 py-0.5 rounded text-[10px] font-bold uppercase",
                    rule.strength === "Very Strong" ? "bg-green-100 text-green-700" :
                    rule.strength === "Strong" ? "bg-blue-100 text-blue-700" :
                    rule.strength === "Low" ? "bg-amber-100 text-amber-700" :
                    "bg-red-100 text-red-700"
                  )}>{rule.strength}</span>
                  <span className={cn(
                    "text-[10px] font-semibold",
                    rule.rec === "recommended" ? "text-green-600" :
                    rule.rec === "caution" ? "text-amber-600" : "text-red-600"
                  )}>
                    {rule.rec === "recommended" ? "? Recommended" : rule.rec === "caution" ? "? Use with caution" : "? Not recommended"}
                  </span>
                </div>
                {rule.warn && policy[rule.key] && (
                  <p className="text-xs text-amber-700 mt-1 flex items-start gap-1">
                    <AlertTriangle size={11} className="shrink-0 mt-0.5" /> {rule.warn}
                  </p>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Safety Requirements */}
      <Card>
        <CardHeader><CardTitle>Safety Requirements (Hard Gates)</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-gray-500 mb-3">
            These must ALL be true before auto-credit is even considered. A confidence score of 99% cannot override a failed safety gate.
          </p>
          {safetyGates.map(gate => (
            <div key={gate.key} className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 bg-white">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={policy[gate.key]}
                  onChange={e => setPolicy(p => ({ ...p, [gate.key]: e.target.checked, preset: "custom" }))}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-gray-300 peer-focus:ring-2 peer-focus:ring-[#C9A227] rounded-full peer peer-checked:after:translate-x-full peer-checked:bg-[#0F2A47] after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all" />
              </label>
              <span className="text-sm font-medium text-gray-900">{gate.label}</span>
              {!policy[gate.key] && (
                <span className="text-[10px] font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded">DISABLED � HIGH RISK</span>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Minimum Confidence */}
      <Card>
        <CardHeader><CardTitle>Minimum Confidence Threshold</CardTitle></CardHeader>
        <CardContent>
          <p className="text-xs text-gray-500 mb-3">
            After safety gates pass and an evidence rule is satisfied, the numerical confidence score must also meet this threshold.
            The score reflects how strongly the evidence identifies the specific student.
          </p>
          <div className="flex items-center gap-4">
            <input
              type="range"
              min="50"
              max="100"
              step="5"
              value={policy.minimumConfidence}
              onChange={e => setPolicy(p => ({ ...p, minimumConfidence: parseInt(e.target.value), preset: "custom" }))}
              className="flex-1 accent-[#C9A227]"
            />
            <span className="text-lg font-bold text-[#0F2A47] w-14 text-right">{policy.minimumConfidence}%</span>
          </div>
          <div className="flex justify-between text-[10px] text-gray-400 mt-1 px-1">
            <span>More auto-credits</span>
            <span>Safer (more reviews)</span>
          </div>
        </CardContent>
      </Card>

      {/* Save */}
      <div className="flex items-center gap-3">
        <Button variant="gold" loading={saving} onClick={savePolicy}>
          <Save size={14} /> Save Policy
        </Button>
        {saved && <span className="text-green-600 text-sm font-medium">Policy saved</span>}
      </div>

      {/* Audit Trail */}
      {auditLog.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Policy Change History</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {auditLog.map((log, i) => (
                <div key={i} className="flex items-start gap-3 p-2 border-b border-gray-100 last:border-0 text-xs">
                  <div className="shrink-0 w-2 h-2 rounded-full bg-[#C9A227] mt-1.5" />
                  <div>
                    <span className="font-medium text-gray-900">{String(log.changed_by_name || log.changed_by_email || "System")}</span>
                    <span className="text-gray-400 ml-2">{log.changed_at ? fmtDateTime(String(log.changed_at)) : ""}</span>
                    <p className="text-gray-600 mt-0.5">{String(log.changes_summary || `Preset: ${log.preset_name}`)}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/**
 * Matching Tester � dry-run the parse + match pipeline on pasted text.
 *
 * Calls POST /api/alert-test which reads but never writes. Shows every
 * field the real pipeline would compute so you can verify rules before
 * relying on them with live alerts.
 */
function MatchingTesterTab() {
  const [text, setText] = useState("");
  const [subject, setSubject] = useState("");
  const [isHtml, setIsHtml] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runTest() {
    if (!text.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/alert-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, subject, isHtml }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `Error ${res.status}`);
      } else {
        setResult(data);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setLoading(false);
    }
  }

  const r = result as Record<string, unknown> | null;
  const direction = r?.direction as string | undefined;
  const isDebit = direction === "debit";
  const isCredit = direction === "credit";
  const matchedStudent = r?.matchedStudent as { id: string; name: string; code: string; matchedBy: string } | null;
  const matchedVendor = r?.matchedVendor as { id: string; name: string } | null;
  const studentCandidates = (r?.studentCandidates ?? []) as { id: string; full_name: string; student_code: string; matchedBy: string }[];
  const vendorCandidates = (r?.vendorCandidates ?? []) as { id: string; name: string; matchedBy: string }[];
  const settings = r?.settings as { autoCreditEnabled: boolean; autoExpenseEnabled: boolean; minConfidencePercent: number } | null;

  return (
    <div className="space-y-6">
      {/* Instructions */}
      <Card>
        <CardHeader><CardTitle>Matching Tester</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-gray-600 mb-1">
            Paste an SMS or email alert below. This runs the <strong>exact same pipeline</strong> as
            the live webhooks but <strong>never posts anything</strong> to the ledger. Use it to
            verify how a transaction would be parsed, which student or vendor it would match, what
            the confidence score is, and whether it would auto-post or need review.
          </p>
          <p className="text-xs text-gray-400">
            Tip: for email alerts, paste the plain-text body. If you only have the HTML source, tick
            the HTML checkbox and it will be converted first.
          </p>
        </CardContent>
      </Card>

      {/* Input */}
      <Card>
        <CardHeader><CardTitle>Alert Message</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Message Body</label>
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              rows={8}
              placeholder={"Acct:**3387\nCR:N22,000.00\nDesc:S327 Aimien Samuel\nDT:05/MAY/26 08:24AM\nBal:N2,100,752.94CR"}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#C9A227] resize-y"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Email Subject (optional)"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="Union Bank Transaction Alert (Credit 9,000.00 NGN)"
              helpText="Leave blank for SMS. For email, paste the subject line � it often carries the direction and amount."
            />
            <div className="flex items-end gap-4 pb-1">
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isHtml}
                  onChange={e => setIsHtml(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-[#C9A227] focus:ring-[#C9A227]"
                />
                Body is HTML (will be converted to text first)
              </label>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="gold" onClick={runTest} loading={loading} disabled={!text.trim()}>
              <FlaskConical size={14} /> Run Test
            </Button>
            {error && <span className="text-sm text-red-600 font-medium">{error}</span>}
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {r && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Test Results</CardTitle>
              <span className={cn(
                "px-3 py-1 rounded-full text-xs font-bold",
                isDebit ? "bg-red-100 text-red-700" : isCredit ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"
              )}>
                {isDebit ? "EXPENSE (Debit)" : isCredit ? "INCOME (Credit)" : "UNKNOWN DIRECTION"}
              </span>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Simulated outcome */}
            <div className={cn(
              "rounded-xl p-4 border text-sm",
              String(r.simulatedOutcome ?? "").includes("auto-post") || String(r.simulatedOutcome ?? "").includes("auto-credit")
                ? "bg-green-50 border-green-200 text-green-800"
                : String(r.simulatedOutcome ?? "").includes("unmatched")
                ? "bg-gray-50 border-gray-200 text-gray-700"
                : "bg-amber-50 border-amber-200 text-amber-800"
            )}>
              <div className="text-xs font-semibold uppercase tracking-wide opacity-70 mb-1">Simulated Outcome</div>
              <p className="font-bold text-base mb-2">{String(r.simulatedOutcome)}</p>
              <p className="font-medium">{String(r.simulatedReason)}</p>
            </div>

            {/* Confidence */}
            <div className="flex items-center gap-3 bg-white border border-gray-100 rounded-lg p-3">
              <span className="text-xs text-gray-500 font-medium w-20">Confidence:</span>
              <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={cn("h-full rounded-full transition-all", Number(r.confidencePercent) >= (settings?.minConfidencePercent ?? 80) ? "bg-green-500" : "bg-amber-500")}
                  style={{ width: `${r.confidencePercent}%` }}
                />
              </div>
              <span className="text-sm font-bold text-[#0F2A47] w-12 text-right">{String(r.confidencePercent)}%</span>
              <span className="text-xs text-gray-400">(threshold: {settings?.minConfidencePercent ?? 80}%)</span>
            </div>

            {/* Parsed fields grid */}
            <div>
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Parsed Fields</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                <ResultField label="Format" value={String(r.format ?? "�")} />
                <ResultField label="Direction" value={String(r.direction ?? "�")} />
                <ResultField label="Amount" value={r.amount != null ? `?${Number(r.amount).toLocaleString()}` : "�"} />
                <ResultField label="Currency" value={String(r.currency ?? "NGN")} />
                <ResultField label="Transaction Date" value={String(r.transactionDate ?? "�")} />
                <ResultField label="Date (ISO)" value={String(r.transactionDateISO ?? "�")} />
                <ResultField label="Reference" value={String(r.reference ?? "�")} />
                {isCredit && (
                  <>
                    <ResultField label="Student Number" value={String(r.studentNumber ?? "�")} highlight={!!r.studentNumber} />
                    <ResultField label="Student Name (parsed)" value={String(r.studentName ?? "�")} highlight={!!r.studentName} />
                  </>
                )}
                {isDebit && (
                  <>
                    <ResultField label="Payee Name" value={String(r.payeeName ?? "�")} highlight={!!r.payeeName} />
                    <ResultField label="Purpose" value={String(r.purpose ?? "�")} />
                    <ResultField label="Expense Category" value={String(r.expenseCategory ?? "�")} />
                  </>
                )}
              </div>
            </div>

            {/* Student match details */}
            {isCredit && (
              <div>
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Student Match</div>
                {matchedStudent ? (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <CheckCircle2 size={14} className="text-green-600" />
                      <span className="text-sm font-bold text-green-800">Matched: {matchedStudent.name} ({matchedStudent.code})</span>
                    </div>
                    <p className="text-xs text-green-700">Matched by: {matchedStudent.matchedBy}</p>
                  </div>
                ) : (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                    <div className="flex items-center gap-2">
                      <AlertTriangle size={14} className="text-amber-600" />
                      <span className="text-sm font-bold text-amber-800">No student matched</span>
                    </div>
                    <p className="text-xs text-amber-700 mt-1">
                      {r.studentNumber || r.studentName
                        ? `Searched for "${r.studentNumber || r.studentName}" but found no matching student.`
                        : "No student code or name was found in the alert text."}
                    </p>
                  </div>
                )}
                {studentCandidates.length > 1 && (
                  <div className="mt-2">
                    <div className="text-xs text-gray-500 mb-1">All candidates found ({studentCandidates.length}):</div>
                    <div className="space-y-1">
                      {studentCandidates.map((c, i) => (
                        <div key={i} className="text-xs bg-white border border-gray-100 rounded px-2 py-1 flex items-center gap-3">
                          <span className="font-mono text-gray-500">{c.student_code}</span>
                          <span className="font-medium text-gray-800">{c.full_name}</span>
                          <span className="text-gray-400 ml-auto">via {c.matchedBy}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Vendor match details */}
            {isDebit && (
              <div>
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Vendor Match</div>
                {matchedVendor ? (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 size={14} className="text-green-600" />
                      <span className="text-sm font-bold text-green-800">Matched: {matchedVendor.name}</span>
                    </div>
                  </div>
                ) : (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                    <div className="flex items-center gap-2">
                      <AlertTriangle size={14} className="text-amber-600" />
                      <span className="text-sm font-bold text-amber-800">No vendor matched</span>
                    </div>
                    <p className="text-xs text-amber-700 mt-1">
                      {r.payeeName
                        ? `Searched for "${r.payeeName}" but found no matching vendor. Would record under this payee name.`
                        : "No payee name was found in the alert text."}
                    </p>
                  </div>
                )}
                {vendorCandidates.length > 1 && (
                  <div className="mt-2">
                    <div className="text-xs text-gray-500 mb-1">All candidates found ({vendorCandidates.length}):</div>
                    <div className="space-y-1">
                      {vendorCandidates.map((c, i) => (
                        <div key={i} className="text-xs bg-white border border-gray-100 rounded px-2 py-1 flex items-center gap-3">
                          <span className="font-medium text-gray-800">{c.name}</span>
                          <span className="text-gray-400 ml-auto">via {c.matchedBy}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Settings context */}
            {settings && (
              <div>
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Active Settings</div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <ResultField label="Auto-Credit" value={settings.autoCreditEnabled ? "ON" : "OFF"} highlight={settings.autoCreditEnabled} />
                  <ResultField label="Auto-Expense" value={settings.autoExpenseEnabled ? "ON" : "OFF"} highlight={settings.autoExpenseEnabled} />
                  <ResultField label="Min Confidence" value={`${settings.minConfidencePercent}%`} />
                </div>
              </div>
            )}

            {/* Processed text preview */}
            <details className="text-xs text-gray-500">
              <summary className="cursor-pointer font-medium text-gray-600 hover:text-gray-800">
                Show processed text (after HTML strip / forward removal)
              </summary>
              <pre className="mt-2 bg-gray-50 border border-gray-100 rounded-lg p-3 whitespace-pre-wrap font-mono text-xs text-gray-700 max-h-48 overflow-y-auto">
                {String(r.processedText)}
              </pre>
            </details>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ResultField({ label, value, highlight }: { label: string; value: string | number | null | undefined; highlight?: boolean }) {
  return (
    <div className="bg-white border border-gray-100 rounded-lg p-2.5">
      <div className="text-[10px] text-gray-400 uppercase tracking-wider mb-0.5">{label}</div>
      <div className={cn("text-sm font-semibold truncate", highlight ? "text-[#0F2A47]" : "text-gray-700")}>
        {String(value ?? "�")}
      </div>
    </div>
  );
}
