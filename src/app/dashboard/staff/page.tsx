"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { cn } from "@/lib/utils";
import { BulkImportModal } from "@/components/import/BulkImportModal";
import { PageHeader, LoadingSpinner, EmptyState } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { usePaginatedData } from "@/lib/hooks/usePaginatedData";
import { Plus, Save, Users, Search, Trash2, IdCard, UploadCloud, Printer } from "lucide-react";

interface StaffRow {
  id: string;
  staff_code: string;
  full_name: string;
  email: string;
  phone: string | null;
  job_title: string | null;
  staff_type: string;
  department_id: string | null;
  date_joined: string | null;
  status: string;
  /** "Also a Teacher" -- grants this person the Teacher's Portal nav
   * (My Teaching, Attendance, Assessments, CBT) in addition to whatever
   * their normal staff/admin access already is. See AppShell.tsx. */
  dual_role: boolean;
}

interface DeptRow { id: string; name: string; }

interface StaffRowWithTotal extends StaffRow {
  total_count?: number;
}

interface StaffStats {
  total: number;
  teaching: number;
  non_teaching: number;
  inactive: number;
}

export default function StaffPage() {
  const { canEdit, profile, orgId } = useAuth();
  const [showBulkImport, setShowBulkImport] = useState(false);
  const supabase = useMemo(() => createClient(), []);
  const [departments, setDepartments] = useState<DeptRow[]>([]);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<StaffRow | null>(null);
  const [form, setForm] = useState({ staff_code: "", full_name: "", email: "", phone: "", job_title: "", staff_type: "teaching", department_id: "", date_joined: "", status: "active", dual_role: false });
  const [credNotice, setCredNotice] = useState<{ email: string; name: string } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [stats, setStats] = useState<StaffStats>({
    total: 0,
    teaching: 0,
    non_teaching: 0,
    inactive: 0,
  });

  // Server-side pagination via RPC
  // Memoize rpcParams so its reference only changes when `search` actually
  // changes -- otherwise a new object literal every render would cause
  // usePaginatedData's internal load() to regenerate every render, which
  // retriggers its effect continuously (this was the cause of the
  // flickering/reloading bug on this page).
  const staffRpcParams = useMemo(() => ({ p_search: search }), [search]);

  const {
    data: staff,
    loading,
    error: staffError,
    pagination,
    refetch,
    nextPage,
    prevPage,
    reset: resetPagination,
  } = usePaginatedData<StaffRowWithTotal>(
    staffRpcParams,
    {
      rpcName: "staff_paginated",
      supabase,
      limit: 50,
    }
  );

  // Load departments
  const loadDepartments = useCallback(async () => {
    const { data } = await supabase
      .from("departments")
      .select("id, name")
      .eq("active", true)
      .order("name");
    setDepartments((data as DeptRow[]) ?? []);
  }, [supabase]);

  // Load stats
  const loadStats = useCallback(async () => {
    try {
      const { data } = await supabase.rpc("staff_stats");
      if (data && data[0]) {
        const s = data[0];
        setStats({
          total: s.total || 0,
          teaching: s.teaching || 0,
          non_teaching: s.non_teaching || 0,
          inactive: s.inactive || 0,
        });
      }
    } catch (error) {
      console.error("Failed to load stats:", error);
    }
  }, [supabase]);

  // Load departments and stats on mount
  useEffect(() => {
    loadDepartments();
    loadStats();
  }, [loadDepartments, loadStats]);

  // Reset pagination when search changes
  useEffect(() => {
    resetPagination();
  }, [search, resetPagination]);

  async function openForm(s?: StaffRow) {
    if (s) {
      setEditing(s);
      // Populate the form from the row being edited -- previously this
      // was missing entirely, so "Edit" silently opened a blank/default
      // form and saving would overwrite the person's real data.
      setForm({
        staff_code: s.staff_code,
        full_name: s.full_name,
        email: s.email,
        phone: s.phone ?? "",
        job_title: s.job_title ?? "",
        staff_type: s.staff_type || "teaching",
        department_id: s.department_id ?? "",
        date_joined: s.date_joined ?? "",
        status: s.status,
        dual_role: Boolean(s.dual_role),
      });
    } else {
      setEditing(null);
      // Auto-generate the next staff code
      let nextCode = "";
      try {
        if (orgId) {
          const { data } = await supabase.rpc("next_staff_code", { p_org: orgId });
          if (typeof data === "string") nextCode = data;
        }
      } catch { /* fall back to blank */ }
      setForm({ staff_code: nextCode, full_name: "", email: "", phone: "", job_title: "", staff_type: "teaching", department_id: "", date_joined: "", status: "active", dual_role: false });
    }
    setSaveError(null);
    setShowForm(true);
  }

  async function deleteStaff(s: StaffRow) {
    const label = `${s.full_name} (${s.staff_code}${s.email ? " / " + s.email : ""})`;
    if (!confirm(`Delete ${label}?\n\nThis removes the staff row and, if this user has no other org memberships, their login is deleted too.`)) return;
    const { data, error } = await supabase.rpc("admin_delete_staff", { p_staff_id: s.id });
    if (error) { alert("Delete failed: " + error.message); return; }
    if (data !== "ok") { alert("Delete: " + data); return; }
    await refetch();
    await loadStats();
  }

  async function saveStaff() {
    setSaveError(null);
    // Email mandatory (staff needs a login).
    const email = form.email.trim().toLowerCase();
    const code = form.staff_code.trim();
    if (!email) return setSaveError("Email is required — it is the staff member's login.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setSaveError("Enter a valid email address.");
    if (!code) return setSaveError("Staff code is required.");
    if (!form.full_name.trim()) return setSaveError("Full name is required.");

    // Uniqueness check on staff_code and email within this org.
    const conflictQ = supabase
      .from("staff_members")
      .select("id, staff_code, email")
      .eq("organization_id", orgId)
      .or(`staff_code.eq.${code},email.eq.${email}`);
    const { data: dup } = await conflictQ;
    const dups = (dup ?? []) as { id: string; staff_code: string; email: string | null }[];
    const conflict = dups.find(d => d.id !== editing?.id);
    if (conflict) {
      if (conflict.staff_code === code) return setSaveError(`Staff code ${code} is already used.`);
      if ((conflict.email || "").toLowerCase() === email) return setSaveError(`Email ${email} is already used.`);
    }

    setSaving(true);
    const payload = {
      staff_code: code,
      full_name: form.full_name.trim(),
      email,
      phone: form.phone.trim() || null,
      job_title: form.job_title.trim() || null,
      staff_type: form.staff_type,
      department_id: form.department_id || null,
      date_joined: form.date_joined || null,
      status: form.status,
      dual_role: form.dual_role,
      organization_id: orgId,
      updated_at: new Date().toISOString(),
    };
    if (editing) {
      const { error: upErr } = await supabase.from("staff_members").update(payload).eq("id", editing.id);
      if (upErr) { setSaveError(upErr.message); setSaving(false); return; }
    } else {
      const { error: insErr } = await supabase.from("staff_members").insert(payload);
      if (insErr) { setSaveError(insErr.message); setSaving(false); return; }
      setCredNotice({ email, name: payload.full_name });
    }
    setSaving(false);
    setShowForm(false);
    setEditing(null);
    await refetch();
    await loadStats();
  }

  if (loading) return <div className="p-6"><LoadingSpinner /></div>;

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="Staff Directory" subtitle="Manage teaching and non-teaching staff">
        <Button
          variant="secondary"
          onClick={() => window.open("/dashboard/staff/directory", "_blank")}
          title="Printable staff directory grouped by department"
        >
          <Printer size={14} /> Directory
        </Button>
        <Button
          variant="secondary"
          onClick={() => window.open("/dashboard/staff/id-cards", "_blank")}
          title="Open a printable page of staff ID cards for all active staff"
        >
          <IdCard size={14} /> Print ID cards
        </Button>
        {canEdit && (
          <Button variant="secondary" onClick={() => setShowBulkImport(true)}>
            <UploadCloud size={14} /> Bulk import
          </Button>
        )}
        {canEdit && <Button variant="gold" onClick={() => openForm()}><Plus size={14} /> Add Staff</Button>}
      </PageHeader>

      {staffError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <strong className="font-semibold">Failed to load staff:</strong> {staffError}
        </div>
      )}

      {credNotice && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0 font-bold">✓</div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-emerald-900">
              {credNotice.name} — login created
            </div>
            <div className="text-sm text-emerald-800 mt-1">
              Share these credentials with them. They will be prompted to change the password on first login.
            </div>
            <div className="mt-2 rounded-md bg-white border border-emerald-200 p-2 text-xs font-mono flex flex-wrap gap-x-6 gap-y-1">
              <span><span className="text-gray-500">Email:</span> <strong>{credNotice.email}</strong></span>
              <span><span className="text-gray-500">Password:</span> <strong>ChangeMe123!</strong></span>
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(`${credNotice.email} / ChangeMe123!`)}
                className="ml-auto text-emerald-700 hover:underline"
              >Copy</button>
            </div>
          </div>
          <button onClick={() => setCredNotice(null)} className="text-emerald-700 hover:text-emerald-900 p-1">✕</button>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border p-4 text-center">
          <div className="text-xl font-bold text-[#0F2A47]">{stats.total}</div>
          <div className="text-xs text-gray-500">Total Staff</div>
        </div>
        <div className="bg-white rounded-xl border p-4 text-center">
          <div className="text-xl font-bold text-green-700">{stats.teaching}</div>
          <div className="text-xs text-gray-500">Teaching</div>
        </div>
        <div className="bg-white rounded-xl border p-4 text-center">
          <div className="text-xl font-bold text-blue-700">{stats.non_teaching}</div>
          <div className="text-xs text-gray-500">Non-Teaching</div>
        </div>
        <div className="bg-white rounded-xl border p-4 text-center">
          <div className="text-xl font-bold text-gray-500">{stats.inactive}</div>
          <div className="text-xs text-gray-500">Inactive</div>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input type="text" placeholder="Search by name, code, email, title..." value={search} onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]" />
      </div>

      {/* Table */}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="bg-[#0F2A47] text-white">
              <th className="text-left px-4 py-3 text-xs font-semibold">Code</th>
              <th className="text-left px-4 py-3 text-xs font-semibold">Name</th>
              <th className="text-left px-4 py-3 text-xs font-semibold">Title</th>
              <th className="text-left px-4 py-3 text-xs font-semibold">Department</th>
              <th className="text-left px-4 py-3 text-xs font-semibold">Type</th>
              <th className="text-left px-4 py-3 text-xs font-semibold">Phone</th>
              <th className="text-left px-4 py-3 text-xs font-semibold">Status</th>
              <th className="px-4 py-3" />
            </tr></thead>
            <tbody>
              {staff.length === 0 ? (
                <tr><td colSpan={8}><EmptyState message="No staff found." icon={<Users size={32} />} /></td></tr>
              ) : staff.map(s => (
                <tr key={s.id} className="border-b hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-mono text-xs text-gray-500">{s.staff_code}</td>
                  <td className="px-4 py-2.5 font-medium">{s.full_name}</td>
                  <td className="px-4 py-2.5 text-gray-600">{s.job_title || "—"}</td>
                  <td className="px-4 py-2.5 text-gray-600">{departments.find(d => d.id === s.department_id)?.name || "—"}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className={cn("px-2 py-0.5 rounded text-[10px] font-bold uppercase", s.staff_type === "teaching" ? "bg-green-100 text-green-700" : s.staff_type === "admin" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700")}>{s.staff_type.replace("_", " ")}</span>
                      {s.dual_role && (
                        <span
                          title="Also has access to the Teacher's Portal"
                          className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-100 text-amber-700"
                        >
                          +Teacher
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-gray-500">{s.phone || "—"}</td>
                  <td className="px-4 py-2.5"><span className={cn("px-2 py-0.5 rounded text-[10px] font-bold", s.status === "active" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500")}>{s.status}</span></td>
                  <td className="px-4 py-2.5 text-right">
                    {canEdit && (
                      <div className="inline-flex items-center gap-2">
                        <button onClick={() => openForm(s)} className="text-xs text-[#0F2A47] hover:underline">Edit</button>
                        <button
                          onClick={() => deleteStaff(s)}
                          className="text-xs text-red-600 hover:text-red-800 hover:underline inline-flex items-center gap-1"
                          title="Delete staff (removes auth login if unused elsewhere)"
                        >
                          <Trash2 size={11} /> Delete
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Pagination Footer */}
        <Pagination
          currentPage={pagination.currentPage}
          pageCount={pagination.pageCount}
          hasNext={pagination.hasNext}
          hasPrev={pagination.hasPrev}
          total={pagination.total}
          showing={staff.length}
          limit={pagination.limit}
          onNextPage={nextPage}
          onPrevPage={prevPage}
        />
      </Card>

      {/* Add/Edit Modal */}
      {showForm && (
        <Modal open onClose={() => { setShowForm(false); setEditing(null); }} title={editing ? "Edit Staff" : "Add Staff"} size="lg">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Input label="Staff Code *" required value={form.staff_code} onChange={e => setForm(f => ({ ...f, staff_code: e.target.value }))} placeholder="STF001" />
              <Input label="Full Name *" required value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} placeholder="Adewale Johnson" />
              <Input label="Email *" required type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="email@school.com" />
              <Input label="Phone" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="0801..." />
              <Input label="Job Title" value={form.job_title} onChange={e => setForm(f => ({ ...f, job_title: e.target.value }))} placeholder="Mathematics Teacher" />
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Staff Type</label>
                <select value={form.staff_type} onChange={e => setForm(f => ({ ...f, staff_type: e.target.value }))} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227] bg-white">
                  <option value="teaching">Teaching</option>
                  <option value="non_teaching">Non-Teaching</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Department</label>
                <select value={form.department_id} onChange={e => setForm(f => ({ ...f, department_id: e.target.value }))} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227] bg-white">
                  <option value="">None</option>
                  {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <Input label="Date Joined" type="date" value={form.date_joined} onChange={e => setForm(f => ({ ...f, date_joined: e.target.value }))} />
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227] bg-white">
                  <option value="active">Active</option>
                  <option value="on_leave">On Leave</option>
                  <option value="resigned">Resigned</option>
                  <option value="terminated">Terminated</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="flex items-start gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={form.dual_role}
                    onChange={e => setForm(f => ({ ...f, dual_role: e.target.checked }))}
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#C9A227] focus:ring-[#C9A227]"
                  />
                  <span className="text-sm text-gray-700">
                    <span className="font-medium">Also a Teacher</span>
                    <span className="block text-xs text-gray-500 mt-0.5">
                      Gives this person the Teacher&apos;s Portal (My Teaching, Attendance,
                      Assessments, CBT/Exams) in addition to their staff access, so an
                      admin who also teaches can use both without a separate login.
                    </span>
                  </span>
                </label>
              </div>
            </div>
            {saveError && (
              <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {saveError}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => { setShowForm(false); setEditing(null); }}>Cancel</Button>
              <Button variant="gold" loading={saving} onClick={saveStaff} disabled={!form.full_name.trim() || !form.staff_code.trim() || !form.email.trim()}>
                <Save size={14} /> {editing ? "Update" : "Add Staff"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    
      <BulkImportModal
        open={showBulkImport}
        onClose={() => setShowBulkImport(false)}
        title="Bulk import staff"
        columns={[
          { key: "staff_code", label: "Staff code", required: true },
          { key: "full_name", label: "Full name", required: true },
          { key: "email", label: "Email" },
          { key: "phone", label: "Phone" },
          { key: "job_title", label: "Job title" },
          { key: "staff_type", label: "Staff type", hint: "teaching or non_teaching" },
          { key: "date_joined", label: "Date joined", hint: "YYYY-MM-DD" },
          { key: "status", label: "Status", hint: "active/inactive" },
        ]}
        example={{
          staff_code: "STF001",
          full_name: "Jane Doe",
          email: "jane.doe@example.com",
          phone: "+2348012345678",
          job_title: "Class Teacher",
          staff_type: "teaching",
          date_joined: "2025-01-15",
          status: "active",
        }}
        onImport={async (rows) => {
          if (!orgId) return { ok: false, message: "No org context" };
          const payload = rows.map(r => ({
            organization_id: orgId,
            staff_code: r.staff_code,
            full_name: r.full_name,
            email: r.email || null,
            phone: r.phone || null,
            job_title: r.job_title || null,
            staff_type: r.staff_type || "teaching",
            date_joined: r.date_joined || null,
            status: r.status || "active",
          }));
          const { error } = await supabase.from("staff_members").insert(payload);
          if (error) return { ok: false, message: error.message };
          refetch();
          return { ok: true, message: `Imported ${payload.length} staff member(s).` };
        }}
      />
    </div>
  );
}
