"use client";

/**
 * Payroll module — monthly runs, reusable pay components
 * (allowances/deductions), and per-staff component assignments.
 *
 * Three tabs:
 *   Runs        — list of monthly payroll runs. Create a new one for
 *                 a period, then click into it to generate payslips,
 *                 finalize the numbers, and mark the run paid. All
 *                 three transitions go through server-side RPCs so a
 *                 finalized/paid run can never be silently rewritten.
 *   Components  — reusable allowance/deduction definitions. A
 *                 component is either 'fixed' (an absolute amount) or
 *                 'percent_of_basic' (a percentage of the staff's
 *                 basic salary). Marking one applies_to_all=true means
 *                 it auto-applies to every staff member on the next
 *                 generate.
 *   Assignments — per-staff opt-ins to non-universal components, with
 *                 optional amount overrides ("Sarah's housing is 40k
 *                 not 30k").
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { useToast } from "@/lib/hooks/useToast";
import { extractErrorMessage } from "@/lib/errors/extractErrorMessage";
import { fmtMoney, fmtDate, cn } from "@/lib/utils";
import { PageHeader, LoadingSpinner, EmptyState, KpiCard } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import {
  Wallet, Plus, Calendar, ChevronRight, Users, Trash2, Pencil,
  ArrowUpCircle, ArrowDownCircle, DollarSign, ClipboardList,
} from "lucide-react";

interface RunRow {
  id: string; period_month: number; period_year: number; label: string | null; status: string;
  total_gross: number; total_deductions: number; total_net: number; staff_count: number;
  finalized_at: string | null; paid_at: string | null; notes: string | null; created_at: string;
}
interface ComponentRow {
  id: string; name: string; code: string; type: string; calculation_type: string;
  default_amount: number; is_taxable: boolean; applies_to_all: boolean; active: boolean;
}
interface AssignmentRow { id: string; staff_id: string; component_id: string; override_amount: number | null; active: boolean; }
interface StaffOption { id: string; full_name: string; staff_code: string; salary: number | null; status: string; }
interface Stats { total_staff_on_payroll: number; total_monthly_gross: number; active_components: number; draft_runs: number; unpaid_this_month: number; }

type Tab = "runs" | "components" | "assignments";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default function PayrollPage() {
  const { canEdit, orgId } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const { notify, ToastHost } = useToast();

  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("runs");

  const [runs, setRuns] = useState<RunRow[]>([]);
  const [components, setComponents] = useState<ComponentRow[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [stats, setStats] = useState<Stats>({ total_staff_on_payroll: 0, total_monthly_gross: 0, active_components: 0, draft_runs: 0, unpaid_this_month: 0 });

  const load = useCallback(async () => {
    setLoading(true);
    const [rRes, cRes, aRes, sRes, statsRes] = await Promise.all([
      supabase.from("payroll_runs").select("*").order("period_year", { ascending: false }).order("period_month", { ascending: false }),
      supabase.from("payroll_components").select("*").order("type").order("name"),
      supabase.from("payroll_staff_components").select("*"),
      supabase.from("staff_members").select("id, full_name, staff_code, salary, status").eq("status", "active").order("full_name"),
      supabase.rpc("payroll_stats"),
    ]);
    setRuns((rRes.data as RunRow[]) ?? []);
    setComponents((cRes.data as ComponentRow[]) ?? []);
    setAssignments((aRes.data as AssignmentRow[]) ?? []);
    setStaff((sRes.data as StaffOption[]) ?? []);
    if (statsRes.data && statsRes.data[0]) {
      const s = statsRes.data[0];
      setStats({
        total_staff_on_payroll: s.total_staff_on_payroll || 0,
        total_monthly_gross: s.total_monthly_gross || 0,
        active_components: s.active_components || 0,
        draft_runs: s.draft_runs || 0,
        unpaid_this_month: s.unpaid_this_month || 0,
      });
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const componentById = useMemo(() => new Map(components.map((c) => [c.id, c])), [components]);
  const staffById = useMemo(() => new Map(staff.map((s) => [s.id, s])), [staff]);
  const assignmentsByStaff = useMemo(() => {
    const map: Record<string, AssignmentRow[]> = {};
    for (const a of assignments) (map[a.staff_id] ||= []).push(a);
    return map;
  }, [assignments]);

  /* ---------------- New run ---------------- */
  const now = new Date();
  const [showRunForm, setShowRunForm] = useState(false);
  const emptyRunForm = { period_month: String(now.getMonth() + 1), period_year: String(now.getFullYear()), label: "", notes: "" };
  const [runForm, setRunForm] = useState(emptyRunForm);
  const [savingRun, setSavingRun] = useState(false);

  async function createRun() {
    const month = parseInt(runForm.period_month, 10);
    const year = parseInt(runForm.period_year, 10);
    if (isNaN(month) || month < 1 || month > 12) { notify("Month must be 1-12.", "error"); return; }
    if (isNaN(year) || year < 2000) { notify("Enter a valid year.", "error"); return; }
    setSavingRun(true);
    try {
      const { error } = await supabase.from("payroll_runs").insert({
        period_month: month,
        period_year: year,
        label: runForm.label.trim() || `${MONTHS[month - 1]} ${year} payroll`,
        notes: runForm.notes.trim() || null,
        organization_id: orgId,
      });
      if (error) throw error;
      notify("Run created.");
      setShowRunForm(false);
      setRunForm(emptyRunForm);
      load();
    } catch (err) {
      notify(extractErrorMessage(err, "Failed to create run."), "error");
    } finally {
      setSavingRun(false);
    }
  }

  /* ---------------- Components ---------------- */
  const [showCompForm, setShowCompForm] = useState(false);
  const [editingComp, setEditingComp] = useState<ComponentRow | null>(null);
  const emptyCompForm = { name: "", code: "", type: "allowance", calculation_type: "fixed", default_amount: "0", is_taxable: true, applies_to_all: false };
  const [compForm, setCompForm] = useState(emptyCompForm);
  const [savingComp, setSavingComp] = useState(false);

  function openCompForm(c?: ComponentRow) {
    if (c) {
      setEditingComp(c);
      setCompForm({ name: c.name, code: c.code, type: c.type, calculation_type: c.calculation_type, default_amount: String(c.default_amount), is_taxable: c.is_taxable, applies_to_all: c.applies_to_all });
    } else {
      setEditingComp(null);
      setCompForm(emptyCompForm);
    }
    setShowCompForm(true);
  }

  async function saveComp() {
    if (!compForm.name.trim() || !compForm.code.trim()) { notify("Name and code are required.", "error"); return; }
    const amt = parseFloat(compForm.default_amount);
    if (isNaN(amt)) { notify("Amount must be a number.", "error"); return; }
    setSavingComp(true);
    try {
      const payload = {
        name: compForm.name.trim(),
        code: compForm.code.trim().toUpperCase(),
        type: compForm.type,
        calculation_type: compForm.calculation_type,
        default_amount: amt,
        is_taxable: compForm.is_taxable,
        applies_to_all: compForm.applies_to_all,
      };
      if (editingComp) {
        const { error } = await supabase.from("payroll_components").update(payload).eq("id", editingComp.id);
        if (error) throw error;
        notify("Component updated.");
      } else {
        const { error } = await supabase.from("payroll_components").insert({ ...payload, organization_id: orgId });
        if (error) throw error;
        notify("Component added.");
      }
      setShowCompForm(false);
      load();
    } catch (err) {
      notify(extractErrorMessage(err, "Failed to save component."), "error");
    } finally {
      setSavingComp(false);
    }
  }

  async function toggleCompActive(c: ComponentRow) {
    const { error } = await supabase.from("payroll_components").update({ active: !c.active }).eq("id", c.id);
    if (error) { notify(extractErrorMessage(error, "Failed to toggle."), "error"); return; }
    load();
  }

  async function deleteComp(c: ComponentRow) {
    if (!confirm(`Delete "${c.name}"? All staff assignments and their references on existing payslips remain, but the component won't apply to future runs.`)) return;
    const { error } = await supabase.from("payroll_components").delete().eq("id", c.id);
    if (error) { notify(extractErrorMessage(error, "Failed to delete component."), "error"); return; }
    notify("Component deleted.");
    load();
  }

  /* ---------------- Staff assignments ---------------- */
  const [showAssignForm, setShowAssignForm] = useState<StaffOption | null>(null);
  const [assignComponent, setAssignComponent] = useState("");
  const [assignOverride, setAssignOverride] = useState("");
  const [savingAssign, setSavingAssign] = useState(false);
  const [staffSearch, setStaffSearch] = useState("");
  const [expandedStaff, setExpandedStaff] = useState<string | null>(null);

  const filteredStaff = useMemo(
    () => staff.filter((s) => s.full_name.toLowerCase().includes(staffSearch.toLowerCase()) || s.staff_code.toLowerCase().includes(staffSearch.toLowerCase())),
    [staff, staffSearch]
  );

  async function saveAssignment() {
    if (!showAssignForm || !assignComponent) { notify("Select a component.", "error"); return; }
    setSavingAssign(true);
    try {
      const payload: Record<string, unknown> = {
        staff_id: showAssignForm.id,
        component_id: assignComponent,
        override_amount: assignOverride.trim() ? parseFloat(assignOverride) : null,
        organization_id: orgId,
      };
      const { error } = await supabase.from("payroll_staff_components").upsert(payload, { onConflict: "staff_id,component_id" });
      if (error) throw error;
      notify("Assignment saved.");
      setShowAssignForm(null);
      setAssignComponent("");
      setAssignOverride("");
      load();
    } catch (err) {
      notify(extractErrorMessage(err, "Failed to save assignment."), "error");
    } finally {
      setSavingAssign(false);
    }
  }

  async function removeAssignment(a: AssignmentRow) {
    if (!confirm("Remove this component from this staff member?")) return;
    const { error } = await supabase.from("payroll_staff_components").delete().eq("id", a.id);
    if (error) { notify(extractErrorMessage(error, "Failed to remove."), "error"); return; }
    load();
  }

  const nonUniversalComponents = components.filter((c) => c.active && !c.applies_to_all);

  const TABS: { key: Tab; label: string; icon: React.ReactNode; count?: number }[] = [
    { key: "runs", label: "Runs", icon: <Calendar size={14} />, count: stats.draft_runs > 0 ? stats.draft_runs : undefined },
    { key: "components", label: "Components", icon: <ClipboardList size={14} />, count: stats.active_components },
    { key: "assignments", label: "Staff Assignments", icon: <Users size={14} /> },
  ];

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="Payroll" subtitle="Monthly runs, allowances, deductions, and payslips.">
        {canEdit && tab === "runs" && (
          <Button variant="gold" onClick={() => setShowRunForm(true)}><Plus size={16} /> New Run</Button>
        )}
        {canEdit && tab === "components" && (
          <Button variant="gold" onClick={() => openCompForm()}><Plus size={16} /> New Component</Button>
        )}
      </PageHeader>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <KpiCard label="Staff on Payroll" value={String(stats.total_staff_on_payroll)} icon={<Users size={18} />} />
        <KpiCard label="Monthly Gross" value={fmtMoney(stats.total_monthly_gross)} icon={<DollarSign size={18} />} />
        <KpiCard label="Components" value={String(stats.active_components)} icon={<ClipboardList size={18} />} />
        <KpiCard label="Draft Runs" value={String(stats.draft_runs)} icon={<Calendar size={18} />} colorClass={stats.draft_runs > 0 ? "text-amber-600" : "text-[#0F2A47]"} />
        <KpiCard label="Unpaid this Month" value={String(stats.unpaid_this_month)} icon={<Wallet size={18} />} colorClass={stats.unpaid_this_month > 0 ? "text-red-600" : "text-[#0F2A47]"} />
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
          {tab === "runs" && (
            runs.length === 0 ? (
              <EmptyState message="No payroll runs yet — create your first one." icon={<Calendar size={40} />} />
            ) : (
              <div className="space-y-2">
                {runs.map((r) => (
                  <Link key={r.id} href={`/dashboard/payroll/${r.id}`}>
                    <Card className="flex items-center justify-between hover:shadow-md transition-shadow cursor-pointer !p-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-[#0F2A47] text-white flex flex-col items-center justify-center shrink-0">
                          <span className="text-[9px] font-bold uppercase leading-none">{MONTHS[r.period_month - 1].slice(0, 3)}</span>
                          <span className="text-[11px] font-bold leading-none">{r.period_year}</span>
                        </div>
                        <div>
                          <p className="font-semibold text-[#0F2A47] text-sm">{r.label || `${MONTHS[r.period_month - 1]} ${r.period_year}`}</p>
                          <p className="text-xs text-gray-500">{r.staff_count} staff · Gross {fmtMoney(r.total_gross)} · Net {fmtMoney(r.total_net)}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={cn(
                          "text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full",
                          r.status === "paid" ? "bg-emerald-100 text-emerald-700" :
                          r.status === "finalized" ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"
                        )}>{r.status}</span>
                        <ChevronRight size={14} className="text-gray-300" />
                      </div>
                    </Card>
                  </Link>
                ))}
              </div>
            )
          )}

          {tab === "components" && (
            components.length === 0 ? (
              <EmptyState message="No pay components yet. PAYE and Pension are seeded by default when the SQL runs." icon={<ClipboardList size={40} />} />
            ) : (
              <div className="space-y-2">
                {components.map((c) => (
                  <Card key={c.id} className="flex items-center justify-between !p-3.5">
                    <div className="flex items-start gap-3">
                      {c.type === "allowance" ? <ArrowUpCircle size={18} className="text-emerald-500 shrink-0" /> : <ArrowDownCircle size={18} className="text-red-500 shrink-0" />}
                      <div>
                        <p className="text-sm font-medium text-gray-700">{c.name} <span className="text-xs text-gray-400">({c.code})</span></p>
                        <p className="text-xs text-gray-500">
                          {c.calculation_type === "percent_of_basic" ? `${c.default_amount}% of basic` : fmtMoney(c.default_amount)}
                          {c.applies_to_all ? " · applies to all staff" : " · opt-in per staff"}
                          {!c.active ? " · disabled" : ""}
                        </p>
                      </div>
                    </div>
                    {canEdit && (
                      <div className="flex items-center gap-1">
                        <button onClick={() => toggleCompActive(c)} className="text-[11px] text-[#0F2A47] hover:text-[#C9A227] px-2">
                          {c.active ? "Disable" : "Enable"}
                        </button>
                        <button onClick={() => openCompForm(c)} title="Edit" className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"><Pencil size={14} /></button>
                        <button onClick={() => deleteComp(c)} title="Delete" className="p-1.5 rounded-lg hover:bg-red-50 text-red-500"><Trash2 size={14} /></button>
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            )
          )}

          {tab === "assignments" && (
            <div className="space-y-3">
              <div className="relative max-w-sm">
                <input
                  value={staffSearch}
                  onChange={(e) => setStaffSearch(e.target.value)}
                  placeholder="Search staff by name or code…"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
                />
              </div>

              {filteredStaff.length === 0 ? (
                <EmptyState message="No active staff yet." icon={<Users size={40} />} />
              ) : (
                <div className="space-y-2">
                  {filteredStaff.map((s) => {
                    const staffAssignments = assignmentsByStaff[s.id] || [];
                    const expanded = expandedStaff === s.id;
                    return (
                      <Card key={s.id}>
                        <div className="flex items-center justify-between cursor-pointer" onClick={() => setExpandedStaff(expanded ? null : s.id)}>
                          <div>
                            <p className="text-sm font-medium text-gray-700">{s.full_name} <span className="text-xs text-gray-400">{s.staff_code}</span></p>
                            <p className="text-xs text-gray-500">Basic {fmtMoney(s.salary || 0)} · {staffAssignments.length} extra component{staffAssignments.length === 1 ? "" : "s"}</p>
                          </div>
                          {canEdit && (
                            <button onClick={(e) => { e.stopPropagation(); setShowAssignForm(s); }} className="text-xs text-[#0F2A47] hover:text-[#C9A227] flex items-center gap-1"><Plus size={12} /> Add component</button>
                          )}
                        </div>
                        {expanded && staffAssignments.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-gray-100 space-y-1">
                            {staffAssignments.map((a) => {
                              const c = componentById.get(a.component_id);
                              return (
                                <div key={a.id} className="flex items-center justify-between text-xs bg-gray-50 rounded-lg px-3 py-2">
                                  <span>
                                    {c?.type === "allowance" ? "+" : "-"} {c?.name || "Unknown"}
                                    {a.override_amount != null && (
                                      <span className="text-gray-500 ml-1">
                                        (override: {c?.calculation_type === "percent_of_basic" ? `${a.override_amount}%` : fmtMoney(a.override_amount)})
                                      </span>
                                    )}
                                  </span>
                                  {canEdit && (
                                    <button onClick={() => removeAssignment(a)} className="text-red-400 hover:text-red-600"><Trash2 size={12} /></button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* New run */}
      <Modal open={showRunForm} onClose={() => setShowRunForm(false)} title="New Payroll Run">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Month"
              value={runForm.period_month}
              onChange={(e) => setRunForm({ ...runForm, period_month: e.target.value })}
              options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))}
            />
            <Input label="Year" type="number" value={runForm.period_year} onChange={(e) => setRunForm({ ...runForm, period_year: e.target.value })} />
          </div>
          <Input label="Label (optional)" value={runForm.label} onChange={(e) => setRunForm({ ...runForm, label: e.target.value })} placeholder="Defaults to '{Month} {Year} payroll'" />
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Notes (optional)</label>
            <textarea
              value={runForm.notes}
              onChange={(e) => setRunForm({ ...runForm, notes: e.target.value })}
              rows={2}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowRunForm(false)}>Cancel</Button>
            <Button variant="gold" onClick={createRun} loading={savingRun}>Create Run</Button>
          </div>
        </div>
      </Modal>

      {/* Component form */}
      <Modal open={showCompForm} onClose={() => setShowCompForm(false)} title={editingComp ? "Edit Component" : "New Component"} size="lg">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Name" value={compForm.name} onChange={(e) => setCompForm({ ...compForm, name: e.target.value })} placeholder="e.g. Housing Allowance" />
            <Input label="Code" value={compForm.code} onChange={(e) => setCompForm({ ...compForm, code: e.target.value })} placeholder="e.g. HOUSING" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Type"
              value={compForm.type}
              onChange={(e) => setCompForm({ ...compForm, type: e.target.value })}
              options={[{ value: "allowance", label: "Allowance (+)" }, { value: "deduction", label: "Deduction (-)" }]}
            />
            <Select
              label="Calculation"
              value={compForm.calculation_type}
              onChange={(e) => setCompForm({ ...compForm, calculation_type: e.target.value })}
              options={[{ value: "fixed", label: "Fixed amount" }, { value: "percent_of_basic", label: "% of basic salary" }]}
            />
          </div>
          <Input
            label={compForm.calculation_type === "percent_of_basic" ? "Default percentage (e.g. 7.5)" : "Default amount"}
            type="number"
            value={compForm.default_amount}
            onChange={(e) => setCompForm({ ...compForm, default_amount: e.target.value })}
          />
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={compForm.applies_to_all} onChange={(e) => setCompForm({ ...compForm, applies_to_all: e.target.checked })} />
            Applies to all staff automatically
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={compForm.is_taxable} onChange={(e) => setCompForm({ ...compForm, is_taxable: e.target.checked })} />
            Taxable
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowCompForm(false)}>Cancel</Button>
            <Button variant="gold" onClick={saveComp} loading={savingComp}>{editingComp ? "Save Changes" : "Add Component"}</Button>
          </div>
        </div>
      </Modal>

      {/* Assignment form */}
      <Modal open={!!showAssignForm} onClose={() => setShowAssignForm(null)} title={`Assign Component — ${showAssignForm?.full_name ?? ""}`}>
        <div className="space-y-3">
          <Select
            label="Component"
            value={assignComponent}
            onChange={(e) => setAssignComponent(e.target.value)}
            options={nonUniversalComponents.map((c) => ({ value: c.id, label: `${c.name} (${c.type === "allowance" ? "+" : "-"})` }))}
            placeholder="Choose a component"
          />
          {assignComponent && (() => {
            const c = componentById.get(assignComponent);
            if (!c) return null;
            return (
              <div className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
                Default: {c.calculation_type === "percent_of_basic" ? `${c.default_amount}% of basic` : fmtMoney(c.default_amount)}
              </div>
            );
          })()}
          <Input
            label="Override amount (optional)"
            type="number"
            value={assignOverride}
            onChange={(e) => setAssignOverride(e.target.value)}
            placeholder="Leave blank to use the component's default"
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowAssignForm(null)}>Cancel</Button>
            <Button variant="gold" onClick={saveAssignment} loading={savingAssign}>Save</Button>
          </div>
        </div>
      </Modal>

      <ToastHost />
    </div>
  );
}
