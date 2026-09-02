"use client";

/**
 * Asset Management module — a fixed-asset register (equipment,
 * furniture, vehicles, buildings) distinct from inventory_items
 * (consumable stock). Straight-line depreciation is computed
 * server-side (assets_with_book_value RPC) and never reimplemented
 * here.
 *
 * Three tabs:
 *   Register    — the asset list with book value, filters, and a
 *                  detail modal (assignment history, maintenance
 *                  history, assign / edit / dispose actions).
 *   Maintenance — repair/service/inspection log across all assets.
 *   Disposals   — write-off / sale history.
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { useToast } from "@/lib/hooks/useToast";
import { extractErrorMessage } from "@/lib/errors/extractErrorMessage";
import { fmtMoney, fmtDate, cn, generateCode, today } from "@/lib/utils";
import { PageHeader, LoadingSpinner, EmptyState, KpiCard } from "@/components/ui/PageHeader";
import { Tabs, TabDef } from "@/components/ui/Tabs";
import { SetupHero } from "@/components/ui/SetupHero";
import { exportRowsAsCsv } from "@/lib/export/csv";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Boxes, Plus, Wrench, Archive, UserCircle, MapPin, TrendingDown, ChevronRight, History, Pencil, LogOut as DisposeIcon, Download, Upload } from "lucide-react";

interface AssetRow {
  id: string; asset_code: string; name: string; category: string | null; serial_number: string | null;
  vendor_id: string | null; purchase_date: string | null; purchase_cost: number; salvage_value: number;
  useful_life_years: number; depreciation_method: string; status: string; current_location: string | null;
  assigned_staff_id: string | null; notes: string | null; created_at: string;
}
interface BookValueRow {
  id: string; book_value: number; accumulated_depreciation: number;
}
interface AssignmentRow {
  id: string; asset_id: string; staff_id: string | null; location: string | null;
  assigned_at: string; returned_at: string | null; notes: string | null;
}
interface MaintenanceRow {
  id: string; asset_id: string; maintenance_type: string; description: string; cost: number;
  performed_by: string | null; status: string; scheduled_date: string | null; completed_date: string | null; created_at: string;
}
interface DisposalRow {
  id: string; asset_id: string; disposal_type: string; disposal_date: string; proceeds: number;
  reason: string | null; approved_by_staff_id: string | null; created_at: string;
}
interface StaffOption { id: string; full_name: string; }
interface VendorOption { id: string; name: string; }
interface Stats {
  total_assets: number; in_use_assets: number; under_repair_assets: number; disposed_assets: number;
  total_purchase_cost: number; total_book_value: number; open_maintenance: number;
}

type Tab = "register" | "maintenance" | "disposals";

const CATEGORY_SUGGESTIONS = ["IT Equipment", "Furniture", "Vehicle", "Building", "Lab Equipment", "Sports Equipment", "Other"];

const emptyAssetForm = {
  asset_code: "", name: "", category: "", serial_number: "", vendor_id: "",
  purchase_date: "", purchase_cost: "", salvage_value: "0", useful_life_years: "5",
  depreciation_method: "straight_line", current_location: "", notes: "",
};

export default function AssetsPage() {
  const { canEdit, orgId } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const { notify, ToastHost } = useToast();

  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("register");

  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [bookValues, setBookValues] = useState<BookValueRow[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [maintenance, setMaintenance] = useState<MaintenanceRow[]>([]);
  const [disposals, setDisposals] = useState<DisposalRow[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [stats, setStats] = useState<Stats>({
    total_assets: 0, in_use_assets: 0, under_repair_assets: 0, disposed_assets: 0,
    total_purchase_cost: 0, total_book_value: 0, open_maintenance: 0,
  });

  const load = useCallback(async () => {
    setLoading(true);
    const [aRes, bvRes, asgRes, mRes, dRes, sRes, vRes, statsRes] = await Promise.all([
      supabase.from("assets").select("*").order("asset_code"),
      supabase.rpc("assets_with_book_value"),
      supabase.from("asset_assignments").select("*").order("assigned_at", { ascending: false }),
      supabase.from("asset_maintenance").select("*").order("created_at", { ascending: false }),
      supabase.from("asset_disposals").select("*").order("disposal_date", { ascending: false }),
      supabase.from("staff_members").select("id, full_name").eq("status", "active").order("full_name"),
      supabase.from("vendors").select("id, name").order("name"),
      supabase.rpc("assets_stats"),
    ]);
    setAssets((aRes.data as AssetRow[]) ?? []);
    setBookValues((bvRes.data as BookValueRow[]) ?? []);
    setAssignments((asgRes.data as AssignmentRow[]) ?? []);
    setMaintenance((mRes.data as MaintenanceRow[]) ?? []);
    setDisposals((dRes.data as DisposalRow[]) ?? []);
    setStaff((sRes.data as StaffOption[]) ?? []);
    setVendors((vRes.data as VendorOption[]) ?? []);
    if (statsRes.data && statsRes.data[0]) {
      const s = statsRes.data[0];
      setStats({
        total_assets: s.total_assets || 0,
        in_use_assets: s.in_use_assets || 0,
        under_repair_assets: s.under_repair_assets || 0,
        disposed_assets: s.disposed_assets || 0,
        total_purchase_cost: s.total_purchase_cost || 0,
        total_book_value: s.total_book_value || 0,
        open_maintenance: s.open_maintenance || 0,
      });
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const staffById = useMemo(() => new Map(staff.map((s) => [s.id, s])), [staff]);
  const vendorById = useMemo(() => new Map(vendors.map((v) => [v.id, v])), [vendors]);
  const bookValueById = useMemo(() => new Map(bookValues.map((b) => [b.id, b])), [bookValues]);
  const assignmentsByAsset = useMemo(() => {
    const map: Record<string, AssignmentRow[]> = {};
    for (const a of assignments) (map[a.asset_id] ||= []).push(a);
    return map;
  }, [assignments]);
  const maintenanceByAsset = useMemo(() => {
    const map: Record<string, MaintenanceRow[]> = {};
    for (const m of maintenance) (map[m.asset_id] ||= []).push(m);
    return map;
  }, [maintenance]);
  const disposalByAsset = useMemo(() => new Map(disposals.map((d) => [d.asset_id, d])), [disposals]);
  const assetById = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);

  /* ---------------- Filters ---------------- */
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const filteredAssets = assets.filter((a) => {
    if (statusFilter !== "all" && a.status !== statusFilter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      if (!a.asset_code.toLowerCase().includes(q) && !a.name.toLowerCase().includes(q) && !(a.category || "").toLowerCase().includes(q)) return false;
    }
    return true;
  });

  /* ---------------- New / Edit asset ---------------- */
  const [showAssetForm, setShowAssetForm] = useState(false);
  const [editingAsset, setEditingAsset] = useState<AssetRow | null>(null);
  const [assetForm, setAssetForm] = useState({ ...emptyAssetForm });
  const [savingAsset, setSavingAsset] = useState(false);

  function openNewAsset() {
    setEditingAsset(null);
    setAssetForm({ ...emptyAssetForm, asset_code: generateCode("AST-", assets.map((a) => a.asset_code)) });
    setShowAssetForm(true);
  }
  function openEditAsset(a: AssetRow) {
    setEditingAsset(a);
    setAssetForm({
      asset_code: a.asset_code, name: a.name, category: a.category || "", serial_number: a.serial_number || "",
      vendor_id: a.vendor_id || "", purchase_date: a.purchase_date || "", purchase_cost: String(a.purchase_cost),
      salvage_value: String(a.salvage_value), useful_life_years: String(a.useful_life_years),
      depreciation_method: a.depreciation_method, current_location: a.current_location || "", notes: a.notes || "",
    });
    setShowAssetForm(true);
  }

  async function saveAsset() {
    if (!assetForm.asset_code.trim() || !assetForm.name.trim()) {
      notify("Asset code and name are required.", "error");
      return;
    }
    setSavingAsset(true);
    try {
      const payload = {
        asset_code: assetForm.asset_code.trim(),
        name: assetForm.name.trim(),
        category: assetForm.category.trim() || null,
        serial_number: assetForm.serial_number.trim() || null,
        vendor_id: assetForm.vendor_id || null,
        purchase_date: assetForm.purchase_date || null,
        purchase_cost: parseFloat(assetForm.purchase_cost) || 0,
        salvage_value: parseFloat(assetForm.salvage_value) || 0,
        useful_life_years: parseFloat(assetForm.useful_life_years) || 5,
        depreciation_method: assetForm.depreciation_method,
        current_location: assetForm.current_location.trim() || null,
        notes: assetForm.notes.trim() || null,
        organization_id: orgId,
      };
      if (editingAsset) {
        const { error } = await supabase.from("assets").update(payload).eq("id", editingAsset.id);
        if (error) throw error;
        notify(`${payload.asset_code} updated.`);
      } else {
        const { error } = await supabase.from("assets").insert(payload);
        if (error) throw error;
        notify(`${payload.asset_code} added to the register.`);
      }
      setShowAssetForm(false);
      load();
      if (detailAsset && editingAsset && detailAsset.id === editingAsset.id) setDetailAsset(null);
    } catch (err) {
      notify(extractErrorMessage(err, "Failed to save asset."), "error");
    } finally {
      setSavingAsset(false);
    }
  }

  /* ---------------- Detail modal ---------------- */
  const [detailAsset, setDetailAsset] = useState<AssetRow | null>(null);

  /* ---------------- Bulk CSV import ---------------- */
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importErrors, setImportErrors] = useState<string[]>([]);

  function parseCsvLine(line: string): string[] {
    const out: string[] = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === "\"") {
        if (quoted && line[i + 1] === "\"") { cur += "\""; i++; }
        else quoted = !quoted;
      } else if (ch === "," && !quoted) { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  }

  async function runBulkImport() {
    if (!orgId) return;
    setImportErrors([]);
    const lines = importText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) {
      setImportErrors(["Paste at least a header row and one asset row."]);
      return;
    }
    const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z0-9]+/g, "_"));
    const required = ["asset_code", "name"];
    const missing = required.filter((r) => !header.includes(r));
    if (missing.length) {
      setImportErrors([`Missing required column(s): ${missing.join(", ")}`]);
      return;
    }
    const rows: Record<string, unknown>[] = [];
    const errs: string[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i]);
      const obj: Record<string, string> = {};
      header.forEach((h, idx) => { obj[h] = cols[idx] ?? ""; });
      if (!obj.asset_code || !obj.name) {
        errs.push(`Line ${i + 1}: asset_code and name required`);
        continue;
      }
      rows.push({
        organization_id: orgId,
        asset_code: obj.asset_code,
        name: obj.name,
        category: obj.category || null,
        serial_number: obj.serial_number || null,
        purchase_date: obj.purchase_date || null,
        purchase_cost: parseFloat(obj.purchase_cost) || 0,
        salvage_value: parseFloat(obj.salvage_value) || 0,
        useful_life_years: parseFloat(obj.useful_life_years) || 5,
        depreciation_method: obj.depreciation_method || "straight_line",
        current_location: obj.current_location || null,
        notes: obj.notes || null,
      });
    }
    if (errs.length) { setImportErrors(errs.slice(0, 20)); return; }
    if (rows.length === 0) { setImportErrors(["No valid rows to import."]); return; }
    setImporting(true);
    const { error } = await supabase.from("assets").insert(rows);
    setImporting(false);
    if (error) {
      setImportErrors([error.message]);
      return;
    }
    notify(`Imported ${rows.length} asset${rows.length === 1 ? "" : "s"}.`);
    setShowImport(false);
    setImportText("");
    load();
  }

  function downloadImportTemplate() {
    const csv = [
      "asset_code,name,category,serial_number,purchase_date,purchase_cost,salvage_value,useful_life_years,depreciation_method,current_location,notes",
      "AST-0001,Sample laptop,IT Equipment,SN123,2025-01-15,850000,50000,4,straight_line,Staff room,Sample row - delete before import",
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "assets-import-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  /* ---------------- Assign ---------------- */
  const [assignTarget, setAssignTarget] = useState<AssetRow | null>(null);
  const [assignForm, setAssignForm] = useState({ staff_id: "", location: "", notes: "" });
  const [assigning, setAssigning] = useState(false);

  function openAssign(a: AssetRow) {
    setAssignForm({ staff_id: a.assigned_staff_id || "", location: a.current_location || "", notes: "" });
    setAssignTarget(a);
  }

  async function submitAssign() {
    if (!assignTarget) return;
    setAssigning(true);
    try {
      const { error } = await supabase.rpc("asset_assign", {
        p_asset_id: assignTarget.id,
        p_staff_id: assignForm.staff_id || null,
        p_location: assignForm.location.trim() || null,
        p_notes: assignForm.notes.trim() || null,
      });
      if (error) throw error;
      notify(`${assignTarget.asset_code} assigned.`);
      setAssignTarget(null);
      load();
    } catch (err) {
      notify(extractErrorMessage(err, "Assignment failed."), "error");
    } finally {
      setAssigning(false);
    }
  }

  /* ---------------- Maintenance ---------------- */
  const [showMaintenanceForm, setShowMaintenanceForm] = useState(false);
  const emptyMaintForm = { asset_id: "", maintenance_type: "repair", description: "", cost: "", performed_by: "", status: "completed", scheduled_date: "", completed_date: today() };
  const [maintForm, setMaintForm] = useState({ ...emptyMaintForm });
  const [savingMaint, setSavingMaint] = useState(false);

  function openMaintenanceForm(assetId?: string) {
    setMaintForm({ ...emptyMaintForm, asset_id: assetId || "" });
    setShowMaintenanceForm(true);
  }

  async function saveMaintenance() {
    if (!maintForm.asset_id) { notify("Choose an asset.", "error"); return; }
    if (!maintForm.description.trim()) { notify("Add a description.", "error"); return; }
    setSavingMaint(true);
    try {
      const { error } = await supabase.from("asset_maintenance").insert({
        asset_id: maintForm.asset_id,
        maintenance_type: maintForm.maintenance_type,
        description: maintForm.description.trim(),
        cost: parseFloat(maintForm.cost) || 0,
        performed_by: maintForm.performed_by.trim() || null,
        status: maintForm.status,
        scheduled_date: maintForm.scheduled_date || null,
        completed_date: maintForm.status === "completed" ? (maintForm.completed_date || today()) : null,
        organization_id: orgId,
      });
      if (error) throw error;
      notify("Maintenance record logged.");
      setShowMaintenanceForm(false);
      load();
    } catch (err) {
      notify(extractErrorMessage(err, "Failed to log maintenance."), "error");
    } finally {
      setSavingMaint(false);
    }
  }

  async function markMaintenanceComplete(m: MaintenanceRow) {
    try {
      const { error } = await supabase.from("asset_maintenance")
        .update({ status: "completed", completed_date: today() })
        .eq("id", m.id);
      if (error) throw error;
      notify("Marked completed.");
      load();
    } catch (err) {
      notify(extractErrorMessage(err, "Update failed."), "error");
    }
  }

  /* ---------------- Dispose ---------------- */
  const [disposeTarget, setDisposeTarget] = useState<AssetRow | null>(null);
  const [disposeForm, setDisposeForm] = useState({ disposal_type: "written_off", proceeds: "0", reason: "", approved_by_staff_id: "" });
  const [disposing, setDisposing] = useState(false);

  function openDispose(a: AssetRow) {
    setDisposeForm({ disposal_type: "written_off", proceeds: "0", reason: "", approved_by_staff_id: "" });
    setDisposeTarget(a);
  }

  async function submitDispose() {
    if (!disposeTarget) return;
    setDisposing(true);
    try {
      const { error } = await supabase.rpc("asset_dispose", {
        p_asset_id: disposeTarget.id,
        p_disposal_type: disposeForm.disposal_type,
        p_proceeds: parseFloat(disposeForm.proceeds) || 0,
        p_reason: disposeForm.reason.trim() || null,
        p_approved_by_staff_id: disposeForm.approved_by_staff_id || null,
      });
      if (error) throw error;
      notify(`${disposeTarget.asset_code} disposed.`);
      setDisposeTarget(null);
      setDetailAsset(null);
      load();
    } catch (err) {
      notify(extractErrorMessage(err, "Disposal failed."), "error");
    } finally {
      setDisposing(false);
    }
  }

  function statusBadgeClass(status: string) {
    return cn(
      "text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full",
      status === "in_use" ? "bg-emerald-100 text-emerald-700" :
      status === "under_repair" ? "bg-amber-100 text-amber-700" :
      status === "disposed" ? "bg-gray-200 text-gray-500" : "bg-blue-100 text-blue-700"
    );
  }

  const TABS: TabDef<Tab>[] = [
    { key: "register", label: "Register", icon: <Boxes size={14} />, count: stats.total_assets },
    { key: "maintenance", label: "Maintenance", icon: <Wrench size={14} />, count: stats.open_maintenance },
    { key: "disposals", label: "Disposals", icon: <Archive size={14} />, count: stats.disposed_assets },
  ];

  return (
    <div className="p-6 space-y-5">
      <PageHeader
        title="Asset Management"
        subtitle="Fixed-asset register, assignments, maintenance, and disposals."
        eyebrow="Operations"
        icon={<Boxes size={22} />}
        gradient="emerald"
        breadcrumb={[{ label: "Operations" }, { label: "Assets" }]}
      >
        {tab === "register" && assets.length > 0 && (
          <Button variant="secondary" onClick={() => exportRowsAsCsv(`assets-${new Date().toISOString().slice(0,10)}.csv`, assets, [
            { key: "asset_code", label: "Code" },
            { key: "name", label: "Name" },
            { key: "category", label: "Category" },
            { key: "status", label: "Status" },
            { key: "purchase_date", label: "Purchase date" },
            { key: "purchase_cost", label: "Cost" },
            { key: "current_location", label: "Location" },
          ])}><Download size={14} /> Export</Button>
        )}
        {canEdit && tab === "register" && (
          <>
            <Button variant="secondary" onClick={() => setShowImport(true)}><Upload size={16} /> Bulk Import</Button>
            <Button variant="gold" onClick={openNewAsset}><Plus size={16} /> New Asset</Button>
          </>
        )}
        {canEdit && tab === "maintenance" && (
          <Button variant="gold" onClick={() => openMaintenanceForm()}><Plus size={16} /> Log Maintenance</Button>
        )}
      </PageHeader>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Active Assets" value={String(stats.total_assets)} icon={<Boxes size={18} />} />
        <KpiCard label="In Use" value={String(stats.in_use_assets)} icon={<UserCircle size={18} />} colorClass="text-emerald-600" />
        <KpiCard label="Under Repair" value={String(stats.under_repair_assets)} icon={<Wrench size={18} />} colorClass={stats.under_repair_assets > 0 ? "text-amber-600" : "text-[#0F2A47]"} />
        <KpiCard label="Total Book Value" value={fmtMoney(stats.total_book_value)} icon={<TrendingDown size={18} />} />
      </div>

      <Tabs<Tab> tabs={TABS} value={tab} onChange={setTab} />

      {loading ? <LoadingSpinner /> : (
        <>
          {tab === "register" && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex gap-1.5 flex-wrap">
                  {["all", "in_use", "in_storage", "under_repair", "disposed"].map((s) => (
                    <button
                      key={s}
                      onClick={() => setStatusFilter(s)}
                      className={cn(
                        "text-xs font-medium px-3 py-1.5 rounded-full border capitalize",
                        statusFilter === s ? "bg-[#0F2A47] text-white border-[#0F2A47]" : "bg-white border-gray-200 text-gray-600"
                      )}
                    >
                      {s.replace("_", " ")}
                    </button>
                  ))}
                </div>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search code, name, category…"
                  className="ml-auto px-3 py-1.5 border border-gray-300 rounded-lg text-xs w-56"
                />
              </div>

              {filteredAssets.length === 0 ? (
                <SetupHero
                  icon={<Boxes size={40} />}
                  title="Start your fixed-asset register"
                  description="Track individually-identified property — laptops, buses, buildings — with live straight-line depreciation, custody history, maintenance logs, and disposal records. Distinct from consumable inventory."
                  bullets={[
                    "Book value computed live, never stale",
                    "Full custody + location history per asset",
                    "Maintenance log with cost tracking",
                    "One-transaction disposal with proceeds",
                  ]}
                  tone="emerald"
                  primaryCta={canEdit ? { label: "Add your first asset", onClick: openNewAsset } : { label: "Editors only", onClick: () => {}, disabled: true }}
                />
              ) : (
                <div className="space-y-2">
                  {filteredAssets.map((a) => {
                    const bv = bookValueById.get(a.id);
                    return (
                      <Card key={a.id} className="hover:shadow-md transition-shadow cursor-pointer !p-4" onClick={() => setDetailAsset(a)}>
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-[#0F2A47]">{a.asset_code}</span>
                              <span className={statusBadgeClass(a.status)}>{a.status.replace("_", " ")}</span>
                            </div>
                            <p className="text-xs text-gray-500 mt-0.5">
                              {a.name}{a.category ? ` · ${a.category}` : ""}
                              {a.assigned_staff_id ? ` · ${staffById.get(a.assigned_staff_id)?.full_name || "Unknown staff"}` : ""}
                              {a.current_location ? ` · ${a.current_location}` : ""}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-sm font-semibold text-[#0F2A47]">{fmtMoney(bv?.book_value ?? a.purchase_cost)}</p>
                            <p className="text-[10px] text-gray-400">book value</p>
                          </div>
                          <ChevronRight size={14} className="text-gray-300" />
                        </div>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {tab === "maintenance" && (
            maintenance.length === 0 ? (
              <EmptyState message="No maintenance records yet." icon={<Wrench size={40} />} />
            ) : (
              <div className="space-y-2">
                {maintenance.map((m) => {
                  const asset = assetById.get(m.asset_id);
                  return (
                    <Card key={m.id} className="!p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-[#0F2A47]">{asset ? `${asset.asset_code} · ${asset.name}` : "Unknown asset"}</span>
                            <span className={cn(
                              "text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full capitalize",
                              m.status === "completed" ? "bg-emerald-100 text-emerald-700" :
                              m.status === "in_progress" ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"
                            )}>{m.status.replace("_", " ")}</span>
                            <span className="text-[10px] text-gray-400 capitalize">{m.maintenance_type}</span>
                          </div>
                          <p className="text-xs text-gray-600 mt-0.5">{m.description}</p>
                          <p className="text-[11px] text-gray-400 mt-0.5">
                            {m.performed_by ? `${m.performed_by} · ` : ""}
                            {m.cost > 0 ? `${fmtMoney(m.cost)} · ` : ""}
                            {m.completed_date ? `completed ${fmtDate(m.completed_date)}` : m.scheduled_date ? `scheduled ${fmtDate(m.scheduled_date)}` : fmtDate(m.created_at)}
                          </p>
                        </div>
                        {canEdit && m.status !== "completed" && (
                          <Button variant="secondary" size="sm" onClick={() => markMaintenanceComplete(m)}>Mark Complete</Button>
                        )}
                      </div>
                    </Card>
                  );
                })}
              </div>
            )
          )}

          {tab === "disposals" && (
            disposals.length === 0 ? (
              <EmptyState message="No disposals recorded." icon={<Archive size={40} />} />
            ) : (
              <div className="space-y-2">
                {disposals.map((d) => {
                  const asset = assetById.get(d.asset_id);
                  return (
                    <Card key={d.id} className="!p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-[#0F2A47]">{asset ? `${asset.asset_code} · ${asset.name}` : "Unknown asset"}</span>
                            <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-gray-200 text-gray-600 capitalize">{d.disposal_type.replace("_", " ")}</span>
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {fmtDate(d.disposal_date)}
                            {d.proceeds > 0 ? ` · proceeds ${fmtMoney(d.proceeds)}` : ""}
                            {d.approved_by_staff_id ? ` · approved by ${staffById.get(d.approved_by_staff_id)?.full_name || "—"}` : ""}
                          </p>
                          {d.reason && <p className="text-xs text-gray-400 italic mt-0.5">&ldquo;{d.reason}&rdquo;</p>}
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )
          )}
        </>
      )}

      {/* New / edit asset */}
      <Modal open={showAssetForm} onClose={() => setShowAssetForm(false)} title={editingAsset ? `Edit ${editingAsset.asset_code}` : "New Asset"} size="lg">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Asset code" value={assetForm.asset_code} onChange={(e) => setAssetForm({ ...assetForm, asset_code: e.target.value })} />
            <Input label="Name" value={assetForm.name} onChange={(e) => setAssetForm({ ...assetForm, name: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">Category</label>
              <input
                list="asset-category-suggestions"
                value={assetForm.category}
                onChange={(e) => setAssetForm({ ...assetForm, category: e.target.value })}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm"
              />
              <datalist id="asset-category-suggestions">
                {CATEGORY_SUGGESTIONS.map((c) => <option key={c} value={c} />)}
              </datalist>
            </div>
            <Input label="Serial number" value={assetForm.serial_number} onChange={(e) => setAssetForm({ ...assetForm, serial_number: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Vendor (optional)"
              value={assetForm.vendor_id}
              onChange={(e) => setAssetForm({ ...assetForm, vendor_id: e.target.value })}
              options={vendors.map((v) => ({ value: v.id, label: v.name }))}
              placeholder="No vendor"
            />
            <Input label="Purchase date" type="date" value={assetForm.purchase_date} onChange={(e) => setAssetForm({ ...assetForm, purchase_date: e.target.value })} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Input label="Purchase cost" type="number" value={assetForm.purchase_cost} onChange={(e) => setAssetForm({ ...assetForm, purchase_cost: e.target.value })} />
            <Input label="Salvage value" type="number" value={assetForm.salvage_value} onChange={(e) => setAssetForm({ ...assetForm, salvage_value: e.target.value })} />
            <Input label="Useful life (years)" type="number" value={assetForm.useful_life_years} onChange={(e) => setAssetForm({ ...assetForm, useful_life_years: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Depreciation method"
              value={assetForm.depreciation_method}
              onChange={(e) => setAssetForm({ ...assetForm, depreciation_method: e.target.value })}
              options={[{ value: "straight_line", label: "Straight line" }, { value: "none", label: "None (e.g. land)" }]}
            />
            <Input label="Current location" value={assetForm.current_location} onChange={(e) => setAssetForm({ ...assetForm, current_location: e.target.value })} />
          </div>
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Notes (optional)</label>
            <textarea
              value={assetForm.notes}
              onChange={(e) => setAssetForm({ ...assetForm, notes: e.target.value })}
              rows={2}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowAssetForm(false)}>Cancel</Button>
            <Button variant="gold" onClick={saveAsset} loading={savingAsset}>{editingAsset ? "Save Changes" : "Add Asset"}</Button>
          </div>
        </div>
      </Modal>

      {/* Detail modal */}
      <Modal open={!!detailAsset} onClose={() => setDetailAsset(null)} title={detailAsset ? `${detailAsset.asset_code} · ${detailAsset.name}` : ""} size="lg">
        {detailAsset && (() => {
          const bv = bookValueById.get(detailAsset.id);
          const history = assignmentsByAsset[detailAsset.id] || [];
          const maintHistory = maintenanceByAsset[detailAsset.id] || [];
          const disposal = disposalByAsset.get(detailAsset.id);
          return (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-gray-400 text-xs">Status</span><p><span className={statusBadgeClass(detailAsset.status)}>{detailAsset.status.replace("_", " ")}</span></p></div>
                <div><span className="text-gray-400 text-xs">Category</span><p className="text-gray-700">{detailAsset.category || "—"}</p></div>
                <div><span className="text-gray-400 text-xs">Serial number</span><p className="text-gray-700">{detailAsset.serial_number || "—"}</p></div>
                <div><span className="text-gray-400 text-xs">Vendor</span><p className="text-gray-700">{detailAsset.vendor_id ? vendorById.get(detailAsset.vendor_id)?.name || "—" : "—"}</p></div>
                <div><span className="text-gray-400 text-xs">Purchase date</span><p className="text-gray-700">{fmtDate(detailAsset.purchase_date)}</p></div>
                <div><span className="text-gray-400 text-xs">Purchase cost</span><p className="text-gray-700">{fmtMoney(detailAsset.purchase_cost)}</p></div>
                <div><span className="text-gray-400 text-xs">Book value</span><p className="text-gray-700 font-semibold">{fmtMoney(bv?.book_value ?? detailAsset.purchase_cost)}</p></div>
                <div><span className="text-gray-400 text-xs">Accumulated depreciation</span><p className="text-gray-700">{fmtMoney(bv?.accumulated_depreciation ?? 0)}</p></div>
                <div><span className="text-gray-400 text-xs">Assigned to</span><p className="text-gray-700">{detailAsset.assigned_staff_id ? staffById.get(detailAsset.assigned_staff_id)?.full_name || "—" : "Unassigned"}</p></div>
                <div><span className="text-gray-400 text-xs">Location</span><p className="text-gray-700">{detailAsset.current_location || "—"}</p></div>
              </div>
              {detailAsset.notes && <p className="text-xs text-gray-500 italic">&ldquo;{detailAsset.notes}&rdquo;</p>}

              {canEdit && detailAsset.status !== "disposed" && (
                <div className="flex flex-wrap gap-2 pt-1 border-t border-gray-100">
                  <Button variant="secondary" size="sm" onClick={() => openEditAsset(detailAsset)}><Pencil size={12} /> Edit</Button>
                  <Button variant="secondary" size="sm" onClick={() => openAssign(detailAsset)}><UserCircle size={12} /> Assign / Move</Button>
                  <Button variant="secondary" size="sm" onClick={() => { setDetailAsset(null); openMaintenanceForm(detailAsset.id); }}><Wrench size={12} /> Log Maintenance</Button>
                  <Button variant="danger" size="sm" onClick={() => openDispose(detailAsset)}><DisposeIcon size={12} /> Dispose</Button>
                </div>
              )}

              {disposal && (
                <div className="text-xs text-gray-500 bg-gray-50 rounded-lg p-3">
                  Disposed {fmtDate(disposal.disposal_date)} ({disposal.disposal_type.replace("_", " ")})
                  {disposal.proceeds > 0 ? ` · proceeds ${fmtMoney(disposal.proceeds)}` : ""}
                  {disposal.reason ? ` · ${disposal.reason}` : ""}
                </div>
              )}

              <div>
                <p className="text-xs font-semibold text-gray-500 flex items-center gap-1 mb-1.5"><History size={12} /> Assignment history</p>
                {history.length === 0 ? (
                  <p className="text-xs text-gray-400">No assignment history.</p>
                ) : (
                  <div className="space-y-1">
                    {history.map((h) => (
                      <div key={h.id} className="text-xs bg-gray-50 rounded-lg px-3 py-1.5 flex items-center justify-between">
                        <span className="text-gray-600 flex items-center gap-1">
                          {h.staff_id ? staffById.get(h.staff_id)?.full_name || "Unknown staff" : "No custodian"}
                          {h.location ? <><MapPin size={10} className="ml-1" /> {h.location}</> : null}
                        </span>
                        <span className="text-gray-400">{fmtDate(h.assigned_at)}{h.returned_at ? ` → ${fmtDate(h.returned_at)}` : " (current)"}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <p className="text-xs font-semibold text-gray-500 flex items-center gap-1 mb-1.5"><Wrench size={12} /> Maintenance history</p>
                {maintHistory.length === 0 ? (
                  <p className="text-xs text-gray-400">No maintenance records.</p>
                ) : (
                  <div className="space-y-1">
                    {maintHistory.map((m) => (
                      <div key={m.id} className="text-xs bg-gray-50 rounded-lg px-3 py-1.5 flex items-center justify-between">
                        <span className="text-gray-600">{m.description}</span>
                        <span className="text-gray-400 capitalize">{m.status.replace("_", " ")}{m.cost > 0 ? ` · ${fmtMoney(m.cost)}` : ""}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* Assign */}
      <Modal open={!!assignTarget} onClose={() => setAssignTarget(null)} title={`Assign ${assignTarget?.asset_code ?? ""}`}>
        <div className="space-y-3">
          <Select
            label="Staff (optional)"
            value={assignForm.staff_id}
            onChange={(e) => setAssignForm({ ...assignForm, staff_id: e.target.value })}
            options={staff.map((s) => ({ value: s.id, label: s.full_name }))}
            placeholder="No custodian"
          />
          <Input label="Location (optional)" value={assignForm.location} onChange={(e) => setAssignForm({ ...assignForm, location: e.target.value })} />
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Notes (optional)</label>
            <textarea
              value={assignForm.notes}
              onChange={(e) => setAssignForm({ ...assignForm, notes: e.target.value })}
              rows={2}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setAssignTarget(null)}>Cancel</Button>
            <Button variant="gold" onClick={submitAssign} loading={assigning}>Save Assignment</Button>
          </div>
        </div>
      </Modal>

      {/* Log maintenance */}
      <Modal open={showMaintenanceForm} onClose={() => setShowMaintenanceForm(false)} title="Log Maintenance">
        <div className="space-y-3">
          <Select
            label="Asset"
            value={maintForm.asset_id}
            onChange={(e) => setMaintForm({ ...maintForm, asset_id: e.target.value })}
            options={assets.filter((a) => a.status !== "disposed").map((a) => ({ value: a.id, label: `${a.asset_code} · ${a.name}` }))}
            placeholder="Choose an asset"
          />
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Type"
              value={maintForm.maintenance_type}
              onChange={(e) => setMaintForm({ ...maintForm, maintenance_type: e.target.value })}
              options={[{ value: "repair", label: "Repair" }, { value: "service", label: "Service" }, { value: "inspection", label: "Inspection" }]}
            />
            <Select
              label="Status"
              value={maintForm.status}
              onChange={(e) => setMaintForm({ ...maintForm, status: e.target.value })}
              options={[{ value: "scheduled", label: "Scheduled" }, { value: "in_progress", label: "In progress" }, { value: "completed", label: "Completed" }]}
            />
          </div>
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Description</label>
            <textarea
              value={maintForm.description}
              onChange={(e) => setMaintForm({ ...maintForm, description: e.target.value })}
              rows={2}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Cost" type="number" value={maintForm.cost} onChange={(e) => setMaintForm({ ...maintForm, cost: e.target.value })} />
            <Input label="Performed by (optional)" value={maintForm.performed_by} onChange={(e) => setMaintForm({ ...maintForm, performed_by: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Scheduled date (optional)" type="date" value={maintForm.scheduled_date} onChange={(e) => setMaintForm({ ...maintForm, scheduled_date: e.target.value })} />
            {maintForm.status === "completed" && (
              <Input label="Completed date" type="date" value={maintForm.completed_date} onChange={(e) => setMaintForm({ ...maintForm, completed_date: e.target.value })} />
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowMaintenanceForm(false)}>Cancel</Button>
            <Button variant="gold" onClick={saveMaintenance} loading={savingMaint}>Save Record</Button>
          </div>
        </div>
      </Modal>

      {/* Dispose */}
      <Modal open={!!disposeTarget} onClose={() => setDisposeTarget(null)} title={`Dispose ${disposeTarget?.asset_code ?? ""}`}>
        <div className="space-y-3">
          <Select
            label="Disposal type"
            value={disposeForm.disposal_type}
            onChange={(e) => setDisposeForm({ ...disposeForm, disposal_type: e.target.value })}
            options={[
              { value: "sold", label: "Sold" },
              { value: "written_off", label: "Written off" },
              { value: "donated", label: "Donated" },
              { value: "scrapped", label: "Scrapped" },
            ]}
          />
          <Input label="Proceeds" type="number" value={disposeForm.proceeds} onChange={(e) => setDisposeForm({ ...disposeForm, proceeds: e.target.value })} />
          <Select
            label="Approved by (optional)"
            value={disposeForm.approved_by_staff_id}
            onChange={(e) => setDisposeForm({ ...disposeForm, approved_by_staff_id: e.target.value })}
            options={staff.map((s) => ({ value: s.id, label: s.full_name }))}
            placeholder="Not recorded"
          />
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Reason (optional)</label>
            <textarea
              value={disposeForm.reason}
              onChange={(e) => setDisposeForm({ ...disposeForm, reason: e.target.value })}
              rows={2}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setDisposeTarget(null)}>Cancel</Button>
            <Button variant="danger" onClick={submitDispose} loading={disposing}>Confirm Disposal</Button>
          </div>
        </div>
      </Modal>

      <ToastHost />
    
      {/* Bulk CSV import */}
      <Modal open={showImport} onClose={() => { setShowImport(false); setImportErrors([]); }} title="Bulk import assets from CSV" size="lg">
        <div className="space-y-3">
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
            <p className="font-semibold mb-1">Expected columns (header row required):</p>
            <p className="font-mono text-[11px] break-all">asset_code, name, category, serial_number, purchase_date, purchase_cost, salvage_value, useful_life_years, depreciation_method, current_location, notes</p>
            <p className="mt-1"><code>asset_code</code> and <code>name</code> are required. Dates as YYYY-MM-DD. depreciation_method: straight_line or reducing_balance.</p>
            <button onClick={downloadImportTemplate} className="mt-2 text-blue-700 hover:text-blue-900 underline text-xs">Download template</button>
          </div>
          <textarea
            className="w-full h-56 p-3 border border-gray-300 rounded-lg font-mono text-xs"
            placeholder="Paste CSV content here (including header row)…"
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
          />
          <input
            type="file"
            accept=".csv,text/csv"
            className="text-xs"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const reader = new FileReader();
              reader.onload = () => setImportText(String(reader.result ?? ""));
              reader.readAsText(f);
            }}
          />
          {importErrors.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800 max-h-40 overflow-y-auto">
              <p className="font-semibold mb-1">Import failed:</p>
              <ul className="list-disc pl-5 space-y-0.5">
                {importErrors.map((e, i) => (<li key={i}>{e}</li>))}
              </ul>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { setShowImport(false); setImportErrors([]); }}>Cancel</Button>
            <Button variant="gold" onClick={runBulkImport} loading={importing} disabled={!importText.trim()}>
              Import
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
