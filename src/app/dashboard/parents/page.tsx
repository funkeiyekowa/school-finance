"use client";

/**
 * Parents sub-module (item 7 from Aug 2026 batch).
 *
 * Full CRUD for parent_profiles with extended contact + emergency info,
 * child linkage via parent_student_links, and a "Reset password" action
 * (item 8) that calls admin_reset_parent_password RPC.
 *
 * Each parent gets ONE auth login (via the create_auth_user helper the
 * SQL migrations already provision) — the primary email is the login.
 * Secondary contact is stored but not used for authentication.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { cn } from "@/lib/utils";
import { BulkImportModal } from "@/components/import/BulkImportModal";
import { PageHeader, LoadingSpinner, EmptyState } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Plus, Save, Users, Search, KeyRound, Mail, Phone, AlertTriangle, ArrowUpDown, Download, X, User, Trash2, MessageCircle, UploadCloud } from "lucide-react";

interface ParentRow {
  id: string;
  profile_id: string | null;
  organization_id: string | null;
  full_name: string;
  email: string;
  phone: string | null;
  relationship: string | null;
  secondary_email: string | null;
  secondary_phone: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  address: string | null;
  occupation: string | null;
  notes: string | null;
  created_at: string | null;
}

interface StudentLite { id: string; full_name: string; student_code: string; grade: string | null; }

interface LinkRow { id: string; parent_id: string; student_id: string; }

type SortKey = "name" | "email" | "phone" | "children" | "created";
type SortDir = "asc" | "desc";

const EMPTY: Omit<ParentRow, "id" | "profile_id" | "organization_id" | "created_at"> = {
  full_name: "",
  email: "",
  phone: "",
  relationship: "Parent",
  secondary_email: "",
  secondary_phone: "",
  emergency_contact_name: "",
  emergency_contact_phone: "",
  address: "",
  occupation: "",
  notes: "",
};

export default function ParentsPage() {
  const { orgId, canEdit } = useAuth();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [parents, setParents] = useState<ParentRow[]>([]);
  const [students, setStudents] = useState<StudentLite[]>([]);
  const [links, setLinks] = useState<LinkRow[]>([]);

  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const [showForm, setShowForm] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<ParentRow | null>(null);
  const [form, setForm] = useState<typeof EMPTY>(EMPTY);
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [credNotice, setCredNotice] = useState<{ email: string; name: string; kind: "created" | "reset" } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [pRes, sRes, lRes] = await Promise.all([
      supabase.from("parent_profiles").select("*").order("full_name"),
      supabase.from("students").select("id, full_name, student_code, grade").order("full_name"),
      supabase.from("parent_student_links").select("id, parent_id, student_id"),
    ]);
    setParents((pRes.data ?? []) as ParentRow[]);
    setStudents((sRes.data ?? []) as StudentLite[]);
    setLinks((lRes.data ?? []) as LinkRow[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  /* -------- derived -------- */
  const childrenByParent = useMemo(() => {
    const m: Record<string, StudentLite[]> = {};
    for (const link of links) {
      const stu = students.find((s) => s.id === link.student_id);
      if (!stu) continue;
      (m[link.parent_id] ||= []).push(stu);
    }
    return m;
  }, [links, students]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = parents.filter((p) =>
      !q ||
      p.full_name.toLowerCase().includes(q) ||
      (p.email || "").toLowerCase().includes(q) ||
      (p.phone || "").toLowerCase().includes(q) ||
      (childrenByParent[p.id] || []).some((s) => s.full_name.toLowerCase().includes(q) || s.student_code.toLowerCase().includes(q))
    );
    const dir = sortDir === "asc" ? 1 : -1;
    list = list.slice().sort((a, b) => {
      switch (sortKey) {
        case "email":    return ((a.email || "").localeCompare(b.email || "")) * dir;
        case "phone":    return ((a.phone || "").localeCompare(b.phone || "")) * dir;
        case "children": return ((childrenByParent[a.id]?.length || 0) - (childrenByParent[b.id]?.length || 0)) * dir;
        case "created":  return ((a.created_at || "").localeCompare(b.created_at || "")) * dir;
        case "name":
        default:         return a.full_name.localeCompare(b.full_name) * dir;
      }
    });
    return list;
  }, [parents, search, sortKey, sortDir, childrenByParent]);

  function toggleSort(k: SortKey) {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("asc"); }
  }

  function openNew() {
    setEditing(null);
    setForm(EMPTY);
    setSelectedStudentIds([]);
    setSaveError(null);
    setShowForm(true);
  }

  function openEdit(p: ParentRow) {
    setEditing(p);
    setForm({
      full_name: p.full_name,
      email: p.email,
      phone: p.phone ?? "",
      relationship: p.relationship ?? "Parent",
      secondary_email: p.secondary_email ?? "",
      secondary_phone: p.secondary_phone ?? "",
      emergency_contact_name: p.emergency_contact_name ?? "",
      emergency_contact_phone: p.emergency_contact_phone ?? "",
      address: p.address ?? "",
      occupation: p.occupation ?? "",
      notes: p.notes ?? "",
    });
    setSelectedStudentIds((childrenByParent[p.id] || []).map((s) => s.id));
    setSaveError(null);
    setShowForm(true);
  }

  async function save() {
    setSaveError(null);
    const email = form.email.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setSaveError("Enter a valid primary email (this is the parent's login).");
    if (!form.full_name.trim()) return setSaveError("Full name is required.");
    // A parent must be linked to at least one student — a parent record
    // with no child has no meaning in this system and breaks the parent
    // portal (nothing to show). Enforced on both create and edit.
    if (selectedStudentIds.length === 0) return setSaveError("Assign at least one student before saving. A parent must be linked to a child.");

    // Uniqueness check on primary email within org (auth is global, but a duplicate parent_profiles row is confusing).
    const { data: dup } = await supabase
      .from("parent_profiles")
      .select("id")
      .eq("organization_id", orgId)
      .ilike("email", email)
      .limit(2);
    const dupRows = (dup ?? []) as { id: string }[];
    if (dupRows.find((d) => d.id !== editing?.id)) {
      return setSaveError(`A parent with email ${email} already exists.`);
    }

    setSaving(true);
    const payload = {
      organization_id: orgId,
      full_name: form.full_name.trim(),
      email,
      phone: form.phone.trim() || null,
      relationship: form.relationship.trim() || null,
      secondary_email: form.secondary_email.trim() || null,
      secondary_phone: form.secondary_phone.trim() || null,
      emergency_contact_name: form.emergency_contact_name.trim() || null,
      emergency_contact_phone: form.emergency_contact_phone.trim() || null,
      address: form.address.trim() || null,
      occupation: form.occupation.trim() || null,
      notes: form.notes.trim() || null,
    };

    let parentId: string | null = editing?.id ?? null;
    if (editing) {
      const { error: upErr } = await supabase.from("parent_profiles").update(payload).eq("id", editing.id);
      if (upErr) { setSaveError(upErr.message); setSaving(false); return; }
    } else {
      // Insert. If auth user for email exists, provision uses it; otherwise create_auth_user is called
      // via the existing auto_provision path? For parent_profiles we insert directly and rely on the
      // signup flow to link the profile_id. We ALSO create the auth user via RPC so login works now.
      // Use rpc to keep the SECURITY DEFINER guarantees.
      const { data: uid, error: authErr } = await supabase.rpc("admin_create_parent_user", {
        p_email: email,
      });
      if (authErr) { setSaveError(`Auth create failed: ${authErr.message}`); setSaving(false); return; }
      const payloadWithLink = { ...payload, profile_id: uid as string };
      const { data: inserted, error: insErr } = await supabase.from("parent_profiles").insert(payloadWithLink).select("id").single();
      if (insErr) { setSaveError(insErr.message); setSaving(false); return; }
      parentId = (inserted as { id: string }).id;
      setCredNotice({ email, name: payload.full_name, kind: "created" });
    }

    // Sync child links (parent_student_links)
    if (parentId) {
      const existing = links.filter((l) => l.parent_id === parentId).map((l) => l.student_id);
      const toAdd = selectedStudentIds.filter((sid) => !existing.includes(sid));
      const toRemove = existing.filter((sid) => !selectedStudentIds.includes(sid));

      if (toAdd.length) {
        await supabase.from("parent_student_links").insert(
          toAdd.map((student_id) => ({ organization_id: orgId, parent_id: parentId, student_id }))
        );
      }
      if (toRemove.length) {
        await supabase
          .from("parent_student_links")
          .delete()
          .eq("parent_id", parentId)
          .in("student_id", toRemove);
      }
    }

    setSaving(false);
    setShowForm(false);
    setEditing(null);
    load();
  }

  async function deleteParent(p: ParentRow) {
    if (!confirm(`Delete ${p.full_name}?\n\nRemoves the parent row, all child links, and (if unused elsewhere) their auth login.`)) return;
    const { data, error } = await supabase.rpc("admin_delete_parent", { p_parent_id: p.id });
    if (error) { alert("Delete failed: " + error.message); return; }
    if (data !== "ok") { alert("Delete: " + data); return; }
    load();
  }

  async function resetPassword(p: ParentRow) {
    if (!confirm(`Reset ${p.full_name}'s password to the default? They will have to change it on next sign-in.`)) return;
    const { data, error } = await supabase.rpc("admin_reset_parent_password", { p_parent_profile_id: p.id });
    if (error) { alert(error.message); return; }
    if (data === "ok") setCredNotice({ email: p.email, name: p.full_name, kind: "reset" });
    else alert(`Reset failed: ${data}`);
  }

  function exportCsv() {
    const header = ["Name", "Email", "Phone", "Relationship", "Children", "Secondary Email", "Secondary Phone", "Emergency Contact", "Emergency Phone", "Address", "Occupation"];
    const rows = filtered.map((p) => [
      p.full_name,
      p.email,
      p.phone ?? "",
      p.relationship ?? "",
      (childrenByParent[p.id] || []).map((s) => `${s.full_name} (${s.student_code})`).join("; "),
      p.secondary_email ?? "",
      p.secondary_phone ?? "",
      p.emergency_contact_name ?? "",
      p.emergency_contact_phone ?? "",
      p.address ?? "",
      p.occupation ?? "",
    ]);
    const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `parents-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) return <div className="p-6"><LoadingSpinner /></div>;

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="Parents" subtitle="Contact details, emergency info and child linkage.">
        <Button
          variant="secondary"
          onClick={() => window.open("/dashboard/parents/notify", "_blank")}
          title="Compose one message, personalise it per parent, and reach every relevant family at once"
        >
          <MessageCircle size={14} /> Notify parents
        </Button>
        <Button variant="ghost" onClick={exportCsv}><Download size={14} /> Export CSV</Button>
        {canEdit && <Button variant="secondary" onClick={() => setShowBulk(true)}><UploadCloud size={14} /> Bulk import</Button>}
        {canEdit && <Button variant="gold" onClick={openNew}><Plus size={14} /> Add Parent</Button>}
      </PageHeader>

      {credNotice && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0 font-bold">✓</div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-emerald-900">
              {credNotice.name} — {credNotice.kind === "created" ? "login created" : "password reset"}
            </div>
            <div className="text-sm text-emerald-800 mt-1">
              Share these credentials. They will be prompted to change the password on next sign-in.
            </div>
            <div className="mt-2 rounded-md bg-white border border-emerald-200 p-2 text-xs font-mono flex flex-wrap gap-x-6 gap-y-1">
              <span><span className="text-gray-500">Email:</span> <strong>{credNotice.email}</strong></span>
              <span><span className="text-gray-500">Password:</span> <strong>ChangeMe123!</strong></span>
              <button type="button" onClick={() => navigator.clipboard?.writeText(`${credNotice.email} / ChangeMe123!`)} className="ml-auto text-emerald-700 hover:underline">Copy</button>
            </div>
          </div>
          <button onClick={() => setCredNotice(null)} className="text-emerald-700 hover:text-emerald-900 p-1"><X size={16} /></button>
        </div>
      )}

      {/* stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatBox label="Total parents" value={parents.length} />
        <StatBox label="Linked to a child" value={parents.filter((p) => (childrenByParent[p.id] || []).length > 0).length} />
        <StatBox label="Unlinked" value={parents.filter((p) => !(childrenByParent[p.id] || []).length).length} accent="amber" />
        <StatBox label="Total children linked" value={links.length} />
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search parent, email, phone, or child…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
          />
        </div>
        <div className="text-xs text-gray-500">
          Showing <strong className="text-[#0F2A47]">{filtered.length}</strong> of {parents.length}
        </div>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#0F2A47] text-white">
                <ThSort label="Parent"     k="name"     current={sortKey} dir={sortDir} onClick={toggleSort} />
                <ThSort label="Email"      k="email"    current={sortKey} dir={sortDir} onClick={toggleSort} />
                <ThSort label="Phone"      k="phone"    current={sortKey} dir={sortDir} onClick={toggleSort} />
                <ThSort label="Children"   k="children" current={sortKey} dir={sortDir} onClick={toggleSort} />
                <th className="px-4 py-3 text-xs font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={5}><EmptyState message={search ? "No matches." : "No parents yet. Add one to give a family portal access."} icon={<Users size={32} />} /></td></tr>
              ) : (
                filtered.map((p) => (
                  <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-[#0F2A47] flex items-center justify-center shrink-0">
                          <span className="text-[#C9A227] text-xs font-bold">{p.full_name[0]?.toUpperCase() ?? "?"}</span>
                        </div>
                        <div>
                          <div className="font-medium">{p.full_name}</div>
                          {p.relationship && <div className="text-xs text-gray-400">{p.relationship}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600"><Mail size={12} className="inline mr-1 text-gray-400" />{p.email}</td>
                    <td className="px-4 py-3 text-gray-600">{p.phone ? <><Phone size={12} className="inline mr-1 text-gray-400" />{p.phone}</> : <span className="text-gray-300">—</span>}</td>
                    <td className="px-4 py-3">
                      {(childrenByParent[p.id] || []).length === 0 ? (
                        <span className="text-xs text-amber-600 inline-flex items-center gap-1"><AlertTriangle size={11} /> No child linked</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {(childrenByParent[p.id] || []).map((s) => (
                            <span key={s.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#C9A227]/10 text-[#8a6d1a] text-xs font-medium">
                              {s.full_name} <span className="text-[10px] text-[#8a6d1a]/60 font-mono">{s.student_code}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(p)}><User size={12} /> Edit</Button>
                        <Button size="sm" variant="ghost" onClick={() => resetPassword(p)}><KeyRound size={12} /> Reset PW</Button>
                        <button
                          onClick={() => deleteParent(p)}
                          className="text-xs text-red-600 hover:text-red-800 hover:underline inline-flex items-center gap-1 px-2 py-1"
                          title="Delete parent (removes auth login if unused elsewhere)"
                        >
                          <Trash2 size={11} /> Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Form modal */}
              <BulkImportModal
          open={showBulk}
          onClose={() => setShowBulk(false)}
          title="Bulk import parents"
          columns={[
            { key: "full_name", label: "Full name", required: true },
            { key: "email", label: "Email" },
            { key: "phone", label: "Phone" },
            { key: "relationship", label: "Relationship", hint: "father / mother / guardian" },
            { key: "address", label: "Address" },
            { key: "occupation", label: "Occupation" },
          ]}
          example={{
            full_name: "Mrs. Amara Okafor",
            email: "amara.okafor@example.com",
            phone: "+2348012345678",
            relationship: "mother",
            address: "12 Palm Grove, Ikeja",
            occupation: "Pharmacist",
          }}
          onImport={async (rows) => {
            if (!orgId) return { ok: false, message: "No org context" };
            const payload = rows.map(r => ({
              organization_id: orgId,
              full_name: r.full_name,
              email: r.email || null,
              phone: r.phone || null,
              relationship: r.relationship || null,
              address: r.address || null,
              occupation: r.occupation || null,
            }));
            const { error } = await supabase.from("parent_profiles").insert(payload);
            if (error) return { ok: false, message: error.message };
            load();
            return { ok: true, message: `Imported ${payload.length} parent(s).` };
          }}
        />

      {showForm && (
        <Modal open onClose={() => { setShowForm(false); setEditing(null); }} title={editing ? `Edit — ${editing.full_name}` : "Add Parent"} size="lg">
          <div className="space-y-5">
            <SectionTitle>Primary contact</SectionTitle>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Full Name *" required value={form.full_name} onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))} placeholder="Mrs. Amaka Nwosu" />
              <Input label="Relationship" value={form.relationship} onChange={(e) => setForm((f) => ({ ...f, relationship: e.target.value }))} placeholder="Mother / Father / Guardian" />
              <Input label="Primary Email * (login)" required type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="parent@example.com" />
              <Input label="Primary Phone" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="0801…" />
              <Input label="Occupation" value={form.occupation} onChange={(e) => setForm((f) => ({ ...f, occupation: e.target.value }))} />
              <Input label="Address" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
            </div>

            <SectionTitle>Secondary contact</SectionTitle>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Secondary Email" type="email" value={form.secondary_email} onChange={(e) => setForm((f) => ({ ...f, secondary_email: e.target.value }))} />
              <Input label="Secondary Phone" value={form.secondary_phone} onChange={(e) => setForm((f) => ({ ...f, secondary_phone: e.target.value }))} />
            </div>

            <SectionTitle>Emergency contact</SectionTitle>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Emergency Contact Name" value={form.emergency_contact_name} onChange={(e) => setForm((f) => ({ ...f, emergency_contact_name: e.target.value }))} placeholder="Sister, Uncle, Neighbour…" />
              <Input label="Emergency Contact Phone" value={form.emergency_contact_phone} onChange={(e) => setForm((f) => ({ ...f, emergency_contact_phone: e.target.value }))} />
            </div>

            <SectionTitle>Linked children</SectionTitle>
            <ChildPicker
              students={students}
              selected={selectedStudentIds}
              onChange={setSelectedStudentIds}
            />

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
              />
            </div>

            {saveError && (
              <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {saveError}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => { setShowForm(false); setEditing(null); }}>Cancel</Button>
              <Button variant="gold" loading={saving} onClick={save} disabled={!form.full_name.trim() || !form.email.trim()}>
                <Save size={14} /> {editing ? "Update" : "Add Parent"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* -------- helpers -------- */
function ThSort({ label, k, current, dir, onClick }: {
  label: string; k: SortKey; current: SortKey; dir: SortDir; onClick: (k: SortKey) => void;
}) {
  const active = k === current;
  return (
    <th className="text-left px-4 py-3 text-xs font-semibold">
      <button type="button" onClick={() => onClick(k)} className="inline-flex items-center gap-1 hover:text-[#C9A227]">
        {label}
        <ArrowUpDown size={11} className={cn("opacity-40", active && "opacity-100 text-[#C9A227]")} />
        {active && <span className="text-[10px]">{dir === "asc" ? "▲" : "▼"}</span>}
      </button>
    </th>
  );
}

function StatBox({ label, value, accent }: { label: string; value: number; accent?: "amber" | "navy" }) {
  return (
    <div className="bg-white rounded-xl border p-4 text-center">
      <div className={cn("text-xl font-bold", accent === "amber" ? "text-amber-600" : "text-[#0F2A47]")}>{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-xs font-bold uppercase tracking-wider text-gray-500 border-b border-gray-100 pb-1">{children}</div>;
}

function ChildPicker({ students, selected, onChange }: {
  students: StudentLite[]; selected: string[]; onChange: (v: string[]) => void;
}) {
  const [q, setQ] = useState("");
  const filtered = students.filter((s) =>
    !q || s.full_name.toLowerCase().includes(q.toLowerCase()) || s.student_code.toLowerCase().includes(q.toLowerCase())
  );

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }

  return (
    <div>
      <div className="relative mb-2">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search students by name or code…"
          className="w-full pl-7 pr-2 py-1.5 text-xs border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
        />
      </div>
      <div className="max-h-56 overflow-y-auto border border-gray-200 rounded-lg divide-y">
        {filtered.length === 0 ? (
          <div className="p-3 text-xs text-gray-400 text-center">No students match.</div>
        ) : (
          filtered.map((s) => {
            const on = selected.includes(s.id);
            return (
              <label key={s.id} className={cn("flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-gray-50", on && "bg-[#C9A227]/5")}>
                <input type="checkbox" checked={on} onChange={() => toggle(s.id)} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{s.full_name}</div>
                  <div className="text-xs text-gray-500 flex items-center gap-2">
                    <span className="font-mono">{s.student_code}</span>
                    {s.grade && <span>· {s.grade}</span>}
                  </div>
                </div>
              </label>
            );
          })
        )}
      </div>
      {selected.length > 0 && (
        <div className="mt-2 text-xs text-gray-500">
          <strong className="text-[#0F2A47]">{selected.length}</strong> child{selected.length === 1 ? "" : "ren"} linked
        </div>
      )}
    </div>
  );
}
