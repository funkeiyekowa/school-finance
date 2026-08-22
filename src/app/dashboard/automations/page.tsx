"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { fmtDateTime, cn } from "@/lib/utils";
import { PageHeader, LoadingSpinner, EmptyState } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Plus, Save, Zap, Play, History, Trash2 } from "lucide-react";

interface RuleRow { id: string; name: string; description: string | null; trigger_event: string; conditions: unknown[]; actions: unknown[]; enabled: boolean; execution_count: number; last_executed_at: string | null; last_status: string | null; created_at: string; }
interface LogRow { id: string; rule_name: string | null; trigger_event: string | null; status: string; error_message: string | null; created_at: string; }

const TRIGGERS = [
  { value: "payment_received", label: "Payment Received" },
  { value: "fee_overdue", label: "Fee Overdue" },
  { value: "student_absent", label: "Student Absent" },
  { value: "student_promoted", label: "Student Promoted" },
  { value: "exam_submitted", label: "Exam Submitted" },
  { value: "attendance_recorded", label: "Attendance Recorded" },
  { value: "new_student_enrolled", label: "New Student Enrolled" },
  { value: "balance_threshold", label: "Balance Exceeds Threshold" },
  { value: "scheduled_daily", label: "Scheduled (Daily)" },
];

const OPERATORS = [
  { value: "eq", label: "equals" },
  { value: "neq", label: "not equals" },
  { value: "gt", label: "greater than" },
  { value: "gte", label: "greater or equal" },
  { value: "lt", label: "less than" },
  { value: "lte", label: "less or equal" },
  { value: "contains", label: "contains" },
];

const ACTION_TYPES = [
  { value: "send_sms", label: "Send SMS" },
  { value: "send_email", label: "Send Email" },
  { value: "create_notification", label: "Create Notification" },
  { value: "log_activity", label: "Log Activity" },
  { value: "send_announcement", label: "Send Announcement" },
];

export default function AutomationsPage() {
  const { isAdmin, profile, orgId } = useAuth();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [tab, setTab] = useState<"rules" | "history">("rules");

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<RuleRow | null>(null);
  const [form, setForm] = useState({
    name: "", description: "", trigger_event: "payment_received",
    conditions: [{ field: "", operator: "gte", value: "" }] as { field: string; operator: string; value: string }[],
    actions: [{ type: "create_notification", message: "", to: "parent" }] as { type: string; message: string; to: string }[],
  });

  const load = useCallback(async () => {
    const [rRes, lRes] = await Promise.all([
      supabase.from("automation_rules").select("*").order("priority", { ascending: false }).order("created_at", { ascending: false }),
      supabase.from("automation_logs").select("*").order("created_at", { ascending: false }).limit(50),
    ]);
    setRules(rRes.data as RuleRow[] ?? []);
    setLogs(lRes.data as LogRow[] ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  function openForm(rule?: RuleRow) {
    if (rule) {
      setEditing(rule);
      const conds = (rule.conditions as { field: string; operator: string; value: string }[]) || [];
      const acts = (rule.actions as { type: string; message: string; to: string }[]) || [];
      setForm({
        name: rule.name, description: rule.description || "", trigger_event: rule.trigger_event,
        conditions: conds.length > 0 ? conds : [{ field: "", operator: "gte", value: "" }],
        actions: acts.length > 0 ? acts : [{ type: "create_notification", message: "", to: "parent" }],
      });
    } else {
      setEditing(null);
      setForm({ name: "", description: "", trigger_event: "payment_received", conditions: [{ field: "", operator: "gte", value: "" }], actions: [{ type: "create_notification", message: "", to: "parent" }] });
    }
    setShowForm(true);
  }

  async function saveRule() {
    setSaving(true);
    const payload = {
      name: form.name.trim(), description: form.description.trim() || null,
      trigger_event: form.trigger_event,
      conditions: form.conditions.filter(c => c.field.trim()),
      actions: form.actions.filter(a => a.message.trim()),
      organization_id: orgId, updated_at: new Date().toISOString(),
    };
    if (editing) { await supabase.from("automation_rules").update(payload).eq("id", editing.id); }
    else { await supabase.from("automation_rules").insert({ ...payload, created_by: profile?.full_name, enabled: true }); }
    setSaving(false); setShowForm(false); setEditing(null); load();
  }

  async function toggleRule(id: string, enabled: boolean) {
    await supabase.from("automation_rules").update({ enabled, updated_at: new Date().toISOString() }).eq("id", id);
    load();
  }

  async function deleteRule(id: string) {
    if (!confirm("Delete this automation rule?")) return;
    await supabase.from("automation_rules").delete().eq("id", id);
    load();
  }

  if (!isAdmin) return <div className="p-6 text-gray-500">Admin access required.</div>;
  if (loading) return <div className="p-6"><LoadingSpinner /></div>;

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="Automations" subtitle="Configure trigger-based rules that run automatically when events occur">
        <Button variant="gold" onClick={() => openForm()}><Plus size={14} /> New Rule</Button>
      </PageHeader>

      <div className="flex gap-2">
        <button onClick={() => setTab("rules")} className={cn("flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg", tab === "rules" ? "bg-[#0F2A47] text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200")}><Zap size={14} /> Rules ({rules.length})</button>
        <button onClick={() => setTab("history")} className={cn("flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg", tab === "history" ? "bg-[#0F2A47] text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200")}><History size={14} /> History ({logs.length})</button>
      </div>

      {/* RULES TAB */}
      {tab === "rules" && (
        <div className="space-y-3">
          {rules.length === 0 ? (
            <Card><CardContent><EmptyState message="No automation rules configured." icon={<Zap size={32} />} /></CardContent></Card>
          ) : rules.map(rule => (
            <Card key={rule.id}>
              <CardContent className="py-4">
                <div className="flex items-start gap-4">
                  {/* Toggle */}
                  <label className="relative inline-flex items-center cursor-pointer mt-1">
                    <input type="checkbox" checked={rule.enabled} onChange={e => toggleRule(rule.id, e.target.checked)} className="sr-only peer" />
                    <div className="w-9 h-5 bg-gray-300 peer-focus:ring-2 peer-focus:ring-[#C9A227] rounded-full peer peer-checked:after:translate-x-full peer-checked:bg-green-600 after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all" />
                  </label>
                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-sm text-[#0F2A47]">{rule.name}</h3>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 uppercase">{TRIGGERS.find(t => t.value === rule.trigger_event)?.label || rule.trigger_event}</span>
                      {!rule.enabled && <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-gray-100 text-gray-500">DISABLED</span>}
                    </div>
                    {rule.description && <p className="text-xs text-gray-500 mb-2">{rule.description}</p>}
                    <div className="flex items-center gap-4 text-[10px] text-gray-400">
                      <span>{(rule.conditions as unknown[]).length} condition(s)</span>
                      <span>{(rule.actions as unknown[]).length} action(s)</span>
                      <span>Ran {rule.execution_count}x</span>
                      {rule.last_executed_at && <span>Last: {fmtDateTime(rule.last_executed_at)}</span>}
                      {rule.last_status && <span className={cn("font-bold", rule.last_status === "success" ? "text-green-600" : "text-red-500")}>{rule.last_status}</span>}
                    </div>
                  </div>
                  {/* Actions */}
                  <div className="flex items-center gap-1">
                    <button onClick={() => openForm(rule)} className="text-xs text-[#0F2A47] hover:underline">Edit</button>
                    <button onClick={() => deleteRule(rule.id)} className="text-xs text-red-500 hover:underline ml-2">Delete</button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* HISTORY TAB */}
      {tab === "history" && (
        <Card>
          <CardContent>
            {logs.length === 0 ? <EmptyState message="No execution history yet." icon={<History size={32} />} /> : (
              <div className="space-y-2 max-h-[500px] overflow-y-auto">
                {logs.map(log => (
                  <div key={log.id} className="flex items-center justify-between p-3 border rounded-lg">
                    <div>
                      <div className="text-sm font-medium">{log.rule_name || "Rule"}</div>
                      <div className="text-xs text-gray-400">{log.trigger_event} · {fmtDateTime(log.created_at)}</div>
                      {log.error_message && <div className="text-xs text-red-600 mt-0.5">{log.error_message}</div>}
                    </div>
                    <span className={cn("px-2 py-0.5 rounded text-[10px] font-bold",
                      log.status === "success" ? "bg-green-100 text-green-700" :
                      log.status === "skipped" ? "bg-gray-100 text-gray-500" :
                      "bg-red-100 text-red-700"
                    )}>{log.status}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* CREATE/EDIT RULE MODAL */}
      {showForm && (
        <Modal open onClose={() => { setShowForm(false); setEditing(null); }} title={editing ? "Edit Automation Rule" : "New Automation Rule"} size="lg">
          <div className="space-y-4">
            <Input label="Rule Name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Payment Receipt Notification" />
            <Input label="Description (optional)" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="What this rule does..." />

            {/* Trigger */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">When (Trigger Event)</label>
              <select value={form.trigger_event} onChange={e => setForm(f => ({ ...f, trigger_event: e.target.value }))}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227] bg-white">
                {TRIGGERS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>

            {/* Conditions */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">If (Conditions) — all must be true</label>
              <div className="space-y-2">
                {form.conditions.map((cond, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input type="text" value={cond.field} placeholder="Field (e.g. amount)" onChange={e => { const c = [...form.conditions]; c[i] = { ...c[i], field: e.target.value }; setForm(f => ({ ...f, conditions: c })); }}
                      className="flex-1 px-3 py-1.5 border border-gray-300 rounded text-sm" />
                    <select value={cond.operator} onChange={e => { const c = [...form.conditions]; c[i] = { ...c[i], operator: e.target.value }; setForm(f => ({ ...f, conditions: c })); }}
                      className="px-2 py-1.5 border border-gray-300 rounded text-sm bg-white">
                      {OPERATORS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    <input type="text" value={cond.value} placeholder="Value" onChange={e => { const c = [...form.conditions]; c[i] = { ...c[i], value: e.target.value }; setForm(f => ({ ...f, conditions: c })); }}
                      className="w-24 px-3 py-1.5 border border-gray-300 rounded text-sm" />
                    <button onClick={() => setForm(f => ({ ...f, conditions: f.conditions.filter((_, j) => j !== i) }))} className="text-red-400 hover:text-red-600"><Trash2 size={14} /></button>
                  </div>
                ))}
                <button onClick={() => setForm(f => ({ ...f, conditions: [...f.conditions, { field: "", operator: "gte", value: "" }] }))} className="text-xs text-[#C9A227] hover:underline">+ Add condition</button>
              </div>
            </div>

            {/* Actions */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Then (Actions)</label>
              <div className="space-y-2">
                {form.actions.map((act, i) => (
                  <div key={i} className="space-y-1 p-3 border rounded-lg bg-gray-50">
                    <div className="flex items-center gap-2">
                      <select value={act.type} onChange={e => { const a = [...form.actions]; a[i] = { ...a[i], type: e.target.value }; setForm(f => ({ ...f, actions: a })); }}
                        className="px-2 py-1.5 border border-gray-300 rounded text-sm bg-white">
                        {ACTION_TYPES.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                      </select>
                      <select value={act.to} onChange={e => { const a = [...form.actions]; a[i] = { ...a[i], to: e.target.value }; setForm(f => ({ ...f, actions: a })); }}
                        className="px-2 py-1.5 border border-gray-300 rounded text-sm bg-white">
                        <option value="parent">Parent</option>
                        <option value="student">Student</option>
                        <option value="staff">Staff</option>
                        <option value="admin">Admin</option>
                        <option value="all">Everyone</option>
                      </select>
                      <button onClick={() => setForm(f => ({ ...f, actions: f.actions.filter((_, j) => j !== i) }))} className="text-red-400 hover:text-red-600 ml-auto"><Trash2 size={14} /></button>
                    </div>
                    <input type="text" value={act.message} placeholder="Message template (use {{variable}})" onChange={e => { const a = [...form.actions]; a[i] = { ...a[i], message: e.target.value }; setForm(f => ({ ...f, actions: a })); }}
                      className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm" />
                  </div>
                ))}
                <button onClick={() => setForm(f => ({ ...f, actions: [...f.actions, { type: "create_notification", message: "", to: "parent" }] }))} className="text-xs text-[#C9A227] hover:underline">+ Add action</button>
              </div>
            </div>

            <p className="text-[10px] text-gray-400">Template variables: {"{{student_name}}, {{amount}}, {{balance}}, {{date}}, {{class_name}}, {{subject}}"}</p>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => { setShowForm(false); setEditing(null); }}>Cancel</Button>
              <Button variant="gold" loading={saving} onClick={saveRule} disabled={!form.name.trim()}>
                <Save size={14} /> {editing ? "Update" : "Create Rule"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
