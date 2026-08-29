"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { fmtDateTime, cn } from "@/lib/utils";
import { PageHeader, LoadingSpinner, EmptyState } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { StatusBadge } from "@/components/ui/Badge";
import {
  Users, CheckCircle, XCircle, UserPlus, Search, ArrowUpDown,
  Shield, GraduationCap, UserCircle2, Wrench, Sparkles, Download,
} from "lucide-react";
import type { Profile, Role } from "@/lib/types";

type SortKey = "name" | "email" | "role" | "status" | "joined";
type SortDir = "asc" | "desc";

interface TabDef {
  key: string;
  label: string;
  icon: React.ReactNode;
  matches: (p: Profile) => boolean;
}

/* Role tab definitions — grouping profiles by their effective role. */
const TABS: TabDef[] = [
  { key: "all",     label: "All",         icon: <Users size={14} />,        matches: () => true },
  { key: "admin",   label: "Admins",      icon: <Shield size={14} />,       matches: (p) => ["admin", "owner", "super_admin"].includes(p.role) },
  { key: "teacher", label: "Teachers",    icon: <GraduationCap size={14} />, matches: (p) => p.role === "teacher" },
  { key: "parent",  label: "Parents",     icon: <UserCircle2 size={14} />,   matches: (p) => p.role === "parent" },
  { key: "student", label: "Students",    icon: <Sparkles size={14} />,      matches: (p) => p.role === "student" },
  { key: "staff",   label: "Non-teaching", icon: <Wrench size={14} />,       matches: (p) => ["staff", "editor"].includes(p.role) },
  { key: "pending", label: "Pending",     icon: <XCircle size={14} />,       matches: (p) => !p.active || p.role === "pending" },
];

export default function TeamPage() {
  const { isAdmin, profile, orgId } = useAuth();
  const supabase = createClient();
  const [users, setUsers] = useState<Profile[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [joinCode, setJoinCode] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const load = useCallback(async () => {
    setLoading(true);
    let profileList: Profile[] = [];

    if (orgId) {
      const { data: members } = await supabase
        .from("org_memberships")
        .select("user_id, role, active")
        .eq("organization_id", orgId);
      if (members && members.length > 0) {
        const userIds = members.map((m: { user_id: string }) => m.user_id);
        const { data: profiles } = await supabase
          .from("profiles")
          .select("*")
          .in("id", userIds)
          .order("created_at");
        profileList = (profiles ?? []) as Profile[];
      }
    } else {
      const { data } = await supabase.from("profiles").select("*").order("created_at");
      profileList = (data ?? []) as Profile[];
    }
    setUsers(profileList);

    const { data: rolesData } = await supabase.from("roles").select("*").order("name");
    setRoles(rolesData ?? []);

    if (orgId) {
      const { data: orgRow } = await supabase
        .from("organizations")
        .select("join_code")
        .eq("id", orgId)
        .single();
      setJoinCode((orgRow as { join_code?: string } | null)?.join_code ?? null);
    }
    setLoading(false);
  }, [supabase, orgId]);

  useEffect(() => { load(); }, [load]);

  async function updateUser(id: string, updates: Partial<Profile>) {
    await supabase.from("profiles").update({ ...updates, updated_at: new Date().toISOString() }).eq("id", id);
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, ...updates } : u)));
    await supabase.from("activity_log").insert({
      user_email: profile?.email,
      user_name: profile?.full_name,
      action: "Update User",
      details: `${users.find((u) => u.id === id)?.email} → ${updates.role || ""}${updates.active !== undefined ? (updates.active ? " (activated)" : " (deactivated)") : ""}`,
    });
  }

  async function approveUser(id: string) {
    await updateUser(id, { active: true });
  }
  async function deactivateUser(id: string) {
    if (id === profile?.id) { alert("You cannot deactivate your own account."); return; }
    await updateUser(id, { active: false });
  }

  /* -------- filter + sort -------- */
  const tabCounts = useMemo(() => {
    const c: Record<string, number> = {};
    TABS.forEach((t) => { c[t.key] = users.filter(t.matches).length; });
    return c;
  }, [users]);

  const filtered = useMemo(() => {
    const tab = TABS.find((t) => t.key === activeTab) ?? TABS[0];
    const q = search.trim().toLowerCase();
    const list = users
      .filter(tab.matches)
      .filter((u) =>
        !q ||
        (u.full_name || "").toLowerCase().includes(q) ||
        (u.email || "").toLowerCase().includes(q) ||
        (u.role || "").toLowerCase().includes(q)
      );

    const cmp = (a: Profile, b: Profile) => {
      const dir = sortDir === "asc" ? 1 : -1;
      switch (sortKey) {
        case "name":   return ((a.full_name || a.email || "").localeCompare(b.full_name || b.email || "")) * dir;
        case "email":  return ((a.email || "").localeCompare(b.email || "")) * dir;
        case "role":   return (a.role || "").localeCompare(b.role || "") * dir;
        case "status": return (Number(!!a.active) - Number(!!b.active)) * dir;
        case "joined": return ((a.created_at || "").localeCompare(b.created_at || "")) * dir;
      }
    };
    return list.slice().sort(cmp);
  }, [users, activeTab, search, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  }

  function exportCsv() {
    const header = ["Name", "Email", "Role", "Status", "Joined"];
    const rows = filtered.map((u) => [
      u.full_name || u.email.split("@")[0],
      u.email,
      u.role,
      u.active ? "active" : "pending",
      u.created_at ? new Date(u.created_at).toISOString() : "",
    ]);
    const csv = [header, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `team-${activeTab}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!isAdmin) return <div className="p-6 text-gray-500">Admin access required.</div>;

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="Team" subtitle="Manage user access grouped by role — search, sort and export.">
        <Button variant="ghost" onClick={exportCsv}><Download size={14} /> Export CSV</Button>
        <Button onClick={() => setShowInvite(true)}><UserPlus size={14} /> Invite User</Button>
      </PageHeader>

      {/* Role Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-gray-200 pb-3">
        {TABS.map((t) => {
          const active = activeTab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all",
                active
                  ? "bg-[#0F2A47] text-white border-[#0F2A47] shadow-sm"
                  : "bg-white text-gray-700 border-gray-200 hover:border-[#C9A227]",
              )}
            >
              {t.icon}
              {t.label}
              <span className={cn(
                "ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold",
                active ? "bg-white/20 text-white" : "bg-gray-100 text-gray-600",
              )}>{tabCounts[t.key] ?? 0}</span>
            </button>
          );
        })}
      </div>

      {/* Search bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email, or role…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
          />
        </div>
        <div className="text-xs text-gray-500">
          Showing <strong className="text-[#0F2A47]">{filtered.length}</strong> of {users.length}
        </div>
      </div>

      {loading ? <LoadingSpinner /> : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#0F2A47] text-white">
                  <ThSort label="User"   sortKey="name"   currentKey={sortKey} currentDir={sortDir} onClick={toggleSort} />
                  <ThSort label="Email"  sortKey="email"  currentKey={sortKey} currentDir={sortDir} onClick={toggleSort} />
                  <ThSort label="Role"   sortKey="role"   currentKey={sortKey} currentDir={sortDir} onClick={toggleSort} />
                  <ThSort label="Status" sortKey="status" currentKey={sortKey} currentDir={sortDir} onClick={toggleSort} />
                  <ThSort label="Joined" sortKey="joined" currentKey={sortKey} currentDir={sortDir} onClick={toggleSort} />
                  <th className="px-4 py-3 text-xs font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={6}><EmptyState message={search ? "No matches for that search." : "No users in this group yet."} icon={<Users size={32} />} /></td></tr>
                ) : (
                  filtered.map((u) => (
                    <tr key={u.id} className={cn("border-b border-gray-50 hover:bg-gray-50", !u.active && "opacity-60")}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-[#0F2A47] flex items-center justify-center shrink-0">
                            <span className="text-[#C9A227] text-xs font-bold">
                              {(u.full_name || u.email || "?")[0].toUpperCase()}
                            </span>
                          </div>
                          <div>
                            <div className="font-medium">{u.full_name || u.email.split("@")[0]}</div>
                            {u.id === profile?.id && <div className="text-xs text-gray-400">(you)</div>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{u.email}</td>
                      <td className="px-4 py-3">
                        <select
                          value={u.role}
                          disabled={u.id === profile?.id}
                          onChange={(e) => updateUser(u.id, { role: e.target.value })}
                          className="px-2 py-1 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-[#C9A227] bg-white disabled:opacity-60"
                        >
                          {roles.length === 0 && <option value={u.role}>{u.role}</option>}
                          {roles.map((r) => <option key={r.id} value={r.name}>{r.name}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={u.active ? "active" : "pending"} />
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{fmtDateTime(u.created_at)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 justify-end">
                          {!u.active && (
                            <Button size="sm" variant="gold" onClick={() => approveUser(u.id)}>
                              <CheckCircle size={12} /> Approve
                            </Button>
                          )}
                          {u.active && u.id !== profile?.id && (
                            <Button size="sm" variant="ghost" onClick={() => deactivateUser(u.id)}>
                              <XCircle size={12} /> Deactivate
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {showInvite && (
        <InviteModal
          roles={roles}
          joinCode={joinCode}
          orgId={orgId}
          supabase={supabase}
          onClose={() => setShowInvite(false)}
          onRegenerated={(code) => setJoinCode(code)}
        />
      )}
    </div>
  );
}

/* -------- sortable header -------- */
function ThSort({
  label, sortKey, currentKey, currentDir, onClick,
}: {
  label: string;
  sortKey: SortKey;
  currentKey: SortKey;
  currentDir: SortDir;
  onClick: (k: SortKey) => void;
}) {
  const active = sortKey === currentKey;
  return (
    <th className="text-left px-4 py-3 text-xs font-semibold">
      <button
        type="button"
        onClick={() => onClick(sortKey)}
        className="inline-flex items-center gap-1 hover:text-[#C9A227] transition-colors"
      >
        {label}
        <ArrowUpDown size={11} className={cn("opacity-40", active && "opacity-100 text-[#C9A227]")} />
        {active && <span className="text-[10px]">{currentDir === "asc" ? "▲" : "▼"}</span>}
      </button>
    </th>
  );
}

/* -------- invite modal (unchanged behavior) -------- */
function InviteModal({ roles, joinCode, orgId, supabase, onClose, onRegenerated }: {
  roles: Role[];
  joinCode: string | null;
  orgId: string | null;
  supabase: ReturnType<typeof createClient>;
  onClose: () => void;
  onRegenerated: (code: string) => void;
}) {
  const [regenerating, setRegenerating] = useState(false);
  async function regenerate() {
    setRegenerating(true);
    const { data, error } = await supabase.rpc("regenerate_join_code", { p_org: orgId });
    setRegenerating(false);
    if (!error && data) {
      const result = data as { join_code?: string };
      if (result.join_code) onRegenerated(result.join_code);
    }
  }

  return (
    <Modal open onClose={onClose} title="Invite Team Members">
      <div className="space-y-4">
        {joinCode && (
          <div className="p-4 bg-[#FBF6E8] border border-[#C9A227] rounded-lg">
            <p className="text-xs font-bold uppercase tracking-wider text-[#0F2A47] mb-1">
              Your school code
            </p>
            <div className="flex items-center gap-3">
              <span className="text-2xl font-mono font-bold tracking-widest text-[#0F2A47] select-all">
                {joinCode}
              </span>
              <button onClick={() => navigator.clipboard?.writeText(joinCode)} className="text-xs text-[#0F2A47] hover:underline">Copy</button>
              <button onClick={regenerate} disabled={regenerating} className="text-xs text-gray-500 hover:underline ml-auto">
                {regenerating ? "…" : "Generate new code"}
              </button>
            </div>
            <p className="mt-2 text-xs text-gray-600">
              Share this code with staff who need to register. They will enter it during sign-up and appear here as &ldquo;Pending&rdquo; for your approval.
            </p>
          </div>
        )}
        <div className="p-4 bg-blue-50 border border-blue-100 rounded-lg text-sm text-blue-700 space-y-2">
          <p><strong>How it works:</strong></p>
          <ol className="list-decimal list-inside space-y-1 text-xs">
            <li>Share your school code and the app URL with the new team member.</li>
            <li>They click &ldquo;Register&rdquo;, fill in their details, and enter the code.</li>
            <li>They land on a waiting screen while you approve them here.</li>
            <li>Once approved, they can sign in and see this school&apos;s data only.</li>
          </ol>
        </div>
        {!joinCode && (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
            No school code yet. Run <code>supabase/fix_profile_isolation.sql</code> in the Supabase SQL editor to enable join codes.
          </div>
        )}
        <div className="text-sm text-gray-600">
          <strong>Available roles:</strong>
          <ul className="mt-2 space-y-1">
            {roles.map((r) => (
              <li key={r.id} className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#C9A227]" />
                <span className="font-medium capitalize">{r.name}</span>
                {r.description && <span className="text-gray-400"> — {r.description}</span>}
              </li>
            ))}
          </ul>
        </div>
        <Button variant="secondary" onClick={onClose} className="w-full">Close</Button>
      </div>
    </Modal>
  );
}
