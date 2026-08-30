"use client";

/**
 * Per-organization member management.
 *
 * This is the piece that makes multi-tenancy operable: without it there is no
 * way to put a user inside School B, so cross-tenant isolation cannot be
 * exercised at all.
 *
 * All mutations go through SECURITY DEFINER RPCs (add_org_member,
 * update_org_member, remove_org_member) because:
 *   - auth.users is not reachable through PostgREST, so resolving a user by
 *     email has to happen server-side;
 *   - the default-org pointer that RLS reads must move atomically.
 */

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { LoadingSpinner, EmptyState } from "@/components/ui/PageHeader";
import { cn, fmtDateTime } from "@/lib/utils";
import {
  UserPlus, Trash2, Star, Users, AlertTriangle, CheckCircle2, Search, Pencil,
} from "lucide-react";

export interface OrgMemberRow {
  membership_id: string;
  user_id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  profile_role: string | null;
  profile_active: boolean | null;
  membership_role: string;
  is_default: boolean;
  active: boolean;
  joined_at: string | null;
  last_active_at: string | null;
}

interface AssignableUser {
  user_id: string;
  email: string;
  full_name: string | null;
  profile_role: string | null;
  profile_active: boolean | null;
  org_count: number;
}

/** Roles a school can hold. super_admin is platform-only. */
const ORG_ROLES = [
  { value: "owner", label: "Owner — full control of this school" },
  { value: "admin", label: "Admin — manage everything except billing" },
  { value: "bursar", label: "Bursar — finance operations" },
  { value: "accountant", label: "Accountant — finance, read-heavy" },
  { value: "editor", label: "Editor — record and edit transactions" },
  { value: "staff", label: "Staff — general access" },
  { value: "teacher", label: "Teacher — teaching and assessments" },
  { value: "parent", label: "Parent — parent portal only" },
  { value: "student", label: "Student — student portal only" },
  { value: "viewer", label: "Viewer — read only" },
];

const ROLE_BADGE: Record<string, "navy" | "blue" | "green" | "amber" | "purple" | "gray"> = {
  super_admin: "purple",
  owner: "navy",
  admin: "navy",
  bursar: "green",
  accountant: "green",
  editor: "blue",
  staff: "blue",
  teacher: "amber",
  parent: "gray",
  student: "gray",
  viewer: "gray",
};

export function OrgMembersPanel({
  orgId, orgName, onChanged,
}: {
  orgId: string;
  orgName: string;
  onChanged?: () => void;
}) {
  const supabase = createClient();
  const { isSuperAdmin, user } = useAuth();

  const [members, setMembers] = useState<OrgMemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Item 1: role tabs, search, sort
  const [tabRole, setTabRole] = useState<string>("all");
  const [memberSearch, setMemberSearch] = useState("");
  const [memberSort, setMemberSort] = useState<{ key: "name" | "role" | "status" | "joined"; dir: "asc" | "desc" }>({ key: "name", dir: "asc" });

  const [showAdd, setShowAdd] = useState(false);
  const [addEmail, setAddEmail] = useState("");
  const [addRole, setAddRole] = useState("staff");
  const [addDefault, setAddDefault] = useState(true);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [directory, setDirectory] = useState<AssignableUser[]>([]);
  const [dirSearch, setDirSearch] = useState("");
  const [dirLoading, setDirLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase.rpc("list_org_members", { p_org: orgId });
    if (err) {
      setError(
        err.message.includes("does not exist")
          ? "The list_org_members function is missing. Run supabase/saas_foundation.sql first."
          : err.message
      );
      setMembers([]);
    } else {
      setMembers((data ?? []) as OrgMemberRow[]);
    }
    setLoading(false);
  }, [supabase, orgId]);

  useEffect(() => { load(); }, [load]);

  const loadDirectory = useCallback(async (search: string) => {
    if (!isSuperAdmin) return;
    setDirLoading(true);
    const { data } = await supabase.rpc("list_assignable_users", { p_search: search || null });
    setDirectory((data ?? []) as AssignableUser[]);
    setDirLoading(false);
  }, [supabase, isSuperAdmin]);

  useEffect(() => {
    if (!showAdd) return;
    const t = setTimeout(() => loadDirectory(dirSearch), 250);
    return () => clearTimeout(t);
  }, [showAdd, dirSearch, loadDirectory]);

  function flash(msg: string) {
    setNotice(msg);
    setTimeout(() => setNotice(null), 4000);
  }

  async function handleAdd() {
    setAdding(true);
    setAddError(null);
    const { data, error: err } = await supabase.rpc("add_org_member", {
      p_org: orgId,
      p_email: addEmail.trim(),
      p_role: addRole,
      p_make_default: addDefault,
    });
    setAdding(false);

    if (err) {
      setAddError(err.message);
      return;
    }
    const result = data as { ok: boolean; message?: string } | null;
    if (result && result.ok === false) {
      setAddError(result.message ?? "Could not add that member.");
      return;
    }

    setShowAdd(false);
    setAddEmail("");
    setAddRole("staff");
    flash(`${addEmail.trim()} added to ${orgName}.`);
    await load();
    onChanged?.();
  }

  async function changeRole(m: OrgMemberRow, role: string) {
    setBusyId(m.membership_id);
    const { error: err } = await supabase.rpc("update_org_member", {
      p_membership_id: m.membership_id,
      p_role: role,
      p_active: null,
      p_make_default: null,
    });
    setBusyId(null);
    if (err) { setError(err.message); return; }
    flash(`Role updated to ${role}.`);
    await load();
    onChanged?.();
  }

  async function toggleActive(m: OrgMemberRow) {
    setBusyId(m.membership_id);
    const { error: err } = await supabase.rpc("update_org_member", {
      p_membership_id: m.membership_id,
      p_role: null,
      p_active: !m.active,
      p_make_default: null,
    });
    setBusyId(null);
    if (err) { setError(err.message); return; }
    flash(m.active ? "Member suspended." : "Member reactivated.");
    await load();
    onChanged?.();
  }

  async function makeDefault(m: OrgMemberRow) {
    setBusyId(m.membership_id);
    const { error: err } = await supabase.rpc("update_org_member", {
      p_membership_id: m.membership_id,
      p_role: null,
      p_active: null,
      p_make_default: true,
    });
    setBusyId(null);
    if (err) { setError(err.message); return; }
    flash(`${orgName} is now this user's landing school.`);
    await load();
    onChanged?.();
  }

  async function remove(m: OrgMemberRow) {
    const who = m.full_name || m.email || "this member";
    if (!confirm(`Remove ${who} from ${orgName}? They keep their account but lose access to this school's data.`)) return;
    setBusyId(m.membership_id);
    const { error: err } = await supabase.rpc("remove_org_member", { p_membership_id: m.membership_id });
    setBusyId(null);
    if (err) { setError(err.message); return; }
    flash(`${who} removed from ${orgName}.`);
    await load();
    onChanged?.();
  }

  // Inline profile editing (full_name / phone / active on profiles).
  // Routed through the update_member_profile SECURITY DEFINER RPC which
  // enforces is_org_admin on the target membership's org, so this works
  // even against the profiles-lockdown RLS.
  const [editTarget, setEditTarget] = useState<OrgMemberRow | null>(null);
  const [editFullName, setEditFullName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editActive, setEditActive] = useState(true);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  function openEdit(m: OrgMemberRow) {
    setEditTarget(m);
    setEditFullName(m.full_name ?? "");
    setEditPhone(m.phone ?? "");
    setEditActive(m.profile_active ?? true);
    setEditError(null);
  }

  async function saveEditProfile() {
    if (!editTarget) return;
    setEditSaving(true);
    setEditError(null);
    const { error: err } = await supabase.rpc("update_member_profile", {
      p_membership_id: editTarget.membership_id,
      p_full_name: editFullName.trim() || null,
      p_phone: editPhone.trim() || null,
      p_active: editActive,
      p_touch_full_name: true,
      p_touch_phone: true,
      p_touch_active: true,
    });
    setEditSaving(false);
    if (err) {
      setEditError(
        err.message.includes("does not exist")
          ? "The update_member_profile RPC is missing. Run supabase/upgrades_2026_08.sql first."
          : err.message,
      );
      return;
    }
    flash("Profile updated.");
    setEditTarget(null);
    await load();
    onChanged?.();
  }

  if (loading) return <LoadingSpinner />;

  const filteredMembers = (() => {
    let list = members.slice();
    if (tabRole !== "all") {
      list = list.filter((m) => (m.membership_role || m.profile_role || "").toLowerCase() === tabRole);
    }
    const q = memberSearch.trim().toLowerCase();
    if (q) {
      list = list.filter((m) =>
        (m.full_name || "").toLowerCase().includes(q) ||
        (m.email || "").toLowerCase().includes(q) ||
        (m.membership_role || "").toLowerCase().includes(q)
      );
    }
    const dir = memberSort.dir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      switch (memberSort.key) {
        case "role":   return ((a.membership_role || "").localeCompare(b.membership_role || "")) * dir;
        case "status": return (Number(!!a.active) - Number(!!b.active)) * dir;
        case "joined": return ((a.joined_at || "").localeCompare(b.joined_at || "")) * dir;
        case "name":
        default:       return ((a.full_name || a.email || "").localeCompare(b.full_name || b.email || "")) * dir;
      }
    });
    return list;
  })();

  const toggleMemberSort = (key: "name" | "role" | "status" | "joined") => {
    setMemberSort((cur) => cur.key === key ? { key, dir: cur.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-[#0F2A47] flex items-center gap-2">
            <Users size={15} /> Members of {orgName}
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {members.length} assigned · {members.filter(m => m.active).length} active
          </p>
        </div>
        <Button size="sm" variant="gold" onClick={() => { setShowAdd(true); setAddError(null); }}>
          <UserPlus size={14} /> Add Member
        </Button>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
          <AlertTriangle size={14} className="mt-px shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-green-50 border border-green-200 text-xs text-green-800">
          <CheckCircle2 size={14} className="mt-px shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {/* Role tabs + search + sort */}
      {members.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {(() => {
              const counts = members.reduce<Record<string, number>>((acc, m) => {
                const k = (m.membership_role || m.profile_role || "unknown").toLowerCase();
                acc[k] = (acc[k] ?? 0) + 1;
                return acc;
              }, {});
              const tabs: { key: string; label: string }[] = [
                { key: "all", label: "All" },
                ...Object.keys(counts).sort().map((k) => ({ key: k, label: k.charAt(0).toUpperCase() + k.slice(1) })),
              ];
              return tabs.map((t) => {
                const active = tabRole === t.key;
                const c = t.key === "all" ? members.length : (counts[t.key] ?? 0);
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setTabRole(t.key)}
                    className={cn(
                      "inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border",
                      active ? "bg-[#0F2A47] text-white border-[#0F2A47]" : "bg-white text-gray-700 border-gray-200 hover:border-[#C9A227]"
                    )}
                  >
                    {t.label}
                    <span className={cn("ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold", active ? "bg-white/20" : "bg-gray-100 text-gray-600")}>{c}</span>
                  </button>
                );
              });
            })()}
          </div>
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="search"
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
                placeholder="Search member…"
                className="w-full pl-7 pr-2 py-1.5 text-xs border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
              />
            </div>
          </div>
        </div>
      )}

      {members.length === 0 ? (
        <EmptyState
          icon={<Users size={32} />}
          message="No one is assigned to this school yet. Add a member so it can be signed into."
        />
      ) : (
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b">
                <th className="text-left px-3 py-2 font-semibold text-gray-600"><button onClick={() => toggleMemberSort("name")} className="hover:text-[#C9A227] inline-flex items-center gap-1">User {memberSort.key === "name" && (memberSort.dir === "asc" ? "▲" : "▼")}</button></th>
                <th className="text-left px-3 py-2 font-semibold text-gray-600"><button onClick={() => toggleMemberSort("role")} className="hover:text-[#C9A227] inline-flex items-center gap-1">Role in school {memberSort.key === "role" && (memberSort.dir === "asc" ? "▲" : "▼")}</button></th>
                <th className="text-left px-3 py-2 font-semibold text-gray-600">Lands here</th>
                <th className="text-left px-3 py-2 font-semibold text-gray-600"><button onClick={() => toggleMemberSort("status")} className="hover:text-[#C9A227] inline-flex items-center gap-1">Status {memberSort.key === "status" && (memberSort.dir === "asc" ? "▲" : "▼")}</button></th>
                <th className="text-left px-3 py-2 font-semibold text-gray-600"><button onClick={() => toggleMemberSort("joined")} className="hover:text-[#C9A227] inline-flex items-center gap-1">Joined {memberSort.key === "joined" && (memberSort.dir === "asc" ? "▲" : "▼")}</button></th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {filteredMembers.map((m) => {
                const busy = busyId === m.membership_id;
                const isSelf = m.user_id === user?.id;
                return (
                  <tr key={m.membership_id} className={cn("border-b last:border-0 hover:bg-gray-50", busy && "opacity-50")}>
                    <td className="px-3 py-2">
                      <div className="font-medium text-gray-900">
                        {m.full_name || m.email || m.user_id.slice(0, 8)}
                        {isSelf && <span className="ml-1.5 text-[10px] text-gray-400">(you)</span>}
                      </div>
                      <div className="text-xs text-gray-500">{m.email}</div>
                      {m.phone && <div className="text-xs text-gray-400 font-mono">{m.phone}</div>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Badge variant={ROLE_BADGE[m.membership_role] ?? "gray"}>
                          {m.membership_role.replace("_", " ")}
                        </Badge>
                        <select
                          aria-label={`Change role for ${m.email ?? "member"}`}
                          value={ORG_ROLES.some(r => r.value === m.membership_role) ? m.membership_role : ""}
                          disabled={busy}
                          onChange={(e) => e.target.value && changeRole(m, e.target.value)}
                          className="text-xs border border-gray-200 rounded px-1.5 py-1 bg-white max-w-[7rem]"
                        >
                          <option value="">change…</option>
                          {ORG_ROLES.map(r => (
                            <option key={r.value} value={r.value}>{r.value}</option>
                          ))}
                          {isSuperAdmin && <option value="super_admin">super_admin</option>}
                        </select>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {m.is_default ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#C9A227]">
                          <Star size={12} fill="currentColor" /> default
                        </span>
                      ) : (
                        <button
                          onClick={() => makeDefault(m)}
                          disabled={busy || !m.active}
                          className="text-xs text-gray-400 hover:text-[#C9A227] hover:underline disabled:opacity-40"
                        >
                          set default
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => toggleActive(m)}
                        disabled={busy}
                        className={cn(
                          "text-xs font-semibold px-2 py-0.5 rounded",
                          m.active ? "bg-green-100 text-green-700 hover:bg-green-200"
                                   : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                        )}
                      >
                        {m.active ? "active" : "suspended"}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-400">
                      {m.joined_at ? fmtDateTime(m.joined_at) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          onClick={() => openEdit(m)}
                          disabled={busy}
                          aria-label={`Edit ${m.email ?? "member"} profile`}
                          className="text-gray-500 hover:text-[#0F2A47] p-1 rounded hover:bg-gray-100 disabled:opacity-40"
                          title="Edit name, phone, active"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => remove(m)}
                          disabled={busy}
                          aria-label={`Remove ${m.email ?? "member"}`}
                          className="text-red-500 hover:text-red-700 p-1 rounded hover:bg-red-50 disabled:opacity-40"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-gray-500 leading-relaxed">
        <strong>Lands here</strong> marks the school a user opens on login. It is also what
        row-level security reads, so a user with two schools sees exactly one of them at a
        time and switches with the org picker in the sidebar.
      </p>

      {editTarget && (
        <Modal open onClose={() => setEditTarget(null)} title={`Edit ${editTarget.email || "member"}`} size="md">
          <div className="space-y-4">
            <p className="text-xs text-gray-500">
              Editing the underlying profile of this member. Changes apply to every school
              this user belongs to. Membership role and default-school are controlled from
              the row itself, not here.
            </p>
            <Input
              label="Full name"
              value={editFullName}
              onChange={(e) => setEditFullName(e.target.value)}
              placeholder="Jane Doe"
              autoComplete="off"
            />
            <Input
              label="Phone"
              value={editPhone}
              onChange={(e) => setEditPhone(e.target.value)}
              placeholder="+234…"
              autoComplete="off"
            />
            <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={editActive}
                onChange={(e) => setEditActive(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-gray-300 text-[#C9A227] focus:ring-[#C9A227]"
              />
              <span>
                Profile active
                <span className="block text-xs text-gray-500">
                  Uncheck to disable this user across every school. Suspending a single
                  membership without disabling the profile is done from the row.
                </span>
              </span>
            </label>

            {editError && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                <AlertTriangle size={14} className="mt-px shrink-0" />
                <span>{editError}</span>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" onClick={() => setEditTarget(null)}>Cancel</Button>
              <Button variant="gold" loading={editSaving} onClick={saveEditProfile}>Save</Button>
            </div>
          </div>
        </Modal>
      )}

      {showAdd && (
        <Modal open onClose={() => setShowAdd(false)} title={`Add a member to ${orgName}`} size="lg">
          <div className="space-y-4">
            <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-800">
              The person needs an account already. If they have not signed up, send them to
              the login page to register first, then assign them here.
            </div>

            <Input
              label="Email address"
              type="email"
              value={addEmail}
              onChange={(e) => setAddEmail(e.target.value)}
              placeholder="bursar@schoolb.com"
              autoComplete="off"
            />

            <Select
              label="Role in this school"
              value={addRole}
              onChange={(e) => setAddRole(e.target.value)}
              options={
                isSuperAdmin
                  ? [...ORG_ROLES, { value: "super_admin", label: "Super admin — platform-wide" }]
                  : ORG_ROLES
              }
            />

            <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={addDefault}
                onChange={(e) => setAddDefault(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-gray-300 text-[#C9A227] focus:ring-[#C9A227]"
              />
              <span>
                Make this their landing school
                <span className="block text-xs text-gray-500">
                  Uncheck when adding an existing user of another school as a secondary
                  membership — their current context stays put.
                </span>
              </span>
            </label>

            {isSuperAdmin && (
              <div className="border-t border-gray-100 pt-3">
                <div className="flex items-center gap-2 mb-2">
                  <Search size={13} className="text-gray-400" />
                  <input
                    value={dirSearch}
                    onChange={(e) => setDirSearch(e.target.value)}
                    placeholder="Search existing accounts"
                    aria-label="Search existing accounts"
                    className="flex-1 text-xs border border-gray-200 rounded px-2 py-1.5 outline-none focus:ring-2 focus:ring-[#C9A227]"
                  />
                </div>
                <div className="max-h-40 overflow-y-auto border border-gray-100 rounded-lg divide-y divide-gray-50">
                  {dirLoading && <div className="p-3 text-xs text-gray-400">Loading accounts…</div>}
                  {!dirLoading && directory.length === 0 && (
                    <div className="p-3 text-xs text-gray-400">No accounts found.</div>
                  )}
                  {directory.map((u) => (
                    <button
                      key={u.user_id}
                      type="button"
                      onClick={() => setAddEmail(u.email)}
                      className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center justify-between gap-2"
                    >
                      <span className="min-w-0">
                        <span className="block text-xs font-medium text-gray-800 truncate">
                          {u.full_name || u.email}
                        </span>
                        <span className="block text-[10px] text-gray-500 truncate">{u.email}</span>
                      </span>
                      <span className="text-[10px] text-gray-400 shrink-0">
                        {u.org_count} school{u.org_count === 1 ? "" : "s"}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {addError && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                <AlertTriangle size={14} className="mt-px shrink-0" />
                <span>{addError}</span>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Button>
              <Button variant="gold" loading={adding} disabled={!addEmail.trim()} onClick={handleAdd}>
                Add Member
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
