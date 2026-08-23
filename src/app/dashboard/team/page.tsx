"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { fmtDateTime } from "@/lib/utils";
import { PageHeader, LoadingSpinner, EmptyState } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input, Select } from "@/components/ui/Input";
import { StatusBadge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";
import { Users, CheckCircle, XCircle, UserPlus } from "lucide-react";
import type { Profile, Role } from "@/lib/types";

export default function TeamPage() {
  const { isAdmin, isOrgAdmin, profile, orgId } = useAuth();
  const supabase = createClient();
  const [users, setUsers] = useState<Profile[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [joinCode, setJoinCode] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [usersRes, rolesRes] = await Promise.all([
      // Read profiles through org_memberships so RLS scopes it to the active tenant.
      // This replaces the old global `profiles.select(*)`.
      supabase
        .from("profiles")
        .select("*")
        .order("created_at"),
      supabase.from("roles").select("*").order("name"),
    ]);
    setUsers(usersRes.data ?? []);
    setRoles(rolesRes.data ?? []);

    // Fetch the school's join code so we can display it.
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

  if (!isAdmin) return <div className="p-6 text-gray-500">Admin access required.</div>;

  async function updateUser(id: string, updates: Partial<Profile>) {
    await supabase.from("profiles").update({ ...updates, updated_at: new Date().toISOString() }).eq("id", id);
    setUsers(prev => prev.map(u => u.id === id ? { ...u, ...updates } : u));
    await supabase.from("activity_log").insert({
      user_email: profile?.email, user_name: profile?.full_name,
      action: "Update User",
      details: `${users.find(u => u.id === id)?.email} → ${updates.role || ""}${updates.active !== undefined ? (updates.active ? " (activated)" : " (deactivated)") : ""}`,
    });
  }

  async function approveUser(id: string) {
    await updateUser(id, { active: true });
  }

  async function deactivateUser(id: string) {
    if (id === profile?.id) { alert("You cannot deactivate your own account."); return; }
    await updateUser(id, { active: false });
  }

  const pending = users.filter(u => !u.active);
  const active = users.filter(u => u.active);

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="Team" subtitle="Manage user access and roles">
        <Button onClick={() => setShowInvite(true)}>
          <UserPlus size={14} /> Invite User
        </Button>
      </PageHeader>

      {/* Pending approvals */}
      {pending.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            <span className="text-sm font-semibold text-amber-800">{pending.length} account{pending.length > 1 ? "s" : ""} waiting for approval</span>
          </div>
          <div className="space-y-2">
            {pending.map(u => (
              <div key={u.id} className="flex items-center justify-between bg-white rounded-lg px-4 py-3 border border-amber-100">
                <div>
                  <div className="font-medium text-gray-900 text-sm">{u.full_name || u.email.split("@")[0]}</div>
                  <div className="text-xs text-gray-500">{u.email}</div>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    defaultValue={u.role}
                    onChange={e => updateUser(u.id, { role: e.target.value })}
                    className="px-2 py-1 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-[#C9A227] bg-white"
                  >
                    {roles.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
                  </select>
                  <Button size="sm" variant="gold" onClick={() => approveUser(u.id)}>
                    <CheckCircle size={12} /> Approve
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading ? <LoadingSpinner /> : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#0F2A47] text-white">
                  <th className="text-left px-4 py-3 text-xs font-semibold">User</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold">Email</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold">Role</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold">Joined</th>
                  <th className="px-4 py-3 text-xs font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 ? (
                  <tr><td colSpan={6}><EmptyState message="No users yet." icon={<Users size={32} />} /></td></tr>
                ) : (
                  users.map(u => (
                    <tr key={u.id} className={cn("border-b border-gray-50 hover:bg-gray-50", !u.active && "opacity-60")}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-[#0F2A47] flex items-center justify-center shrink-0">
                            <span className="text-[#C9A227] text-xs font-bold">
                              {(u.full_name || u.email)[0].toUpperCase()}
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
                          onChange={e => updateUser(u.id, { role: e.target.value })}
                          className="px-2 py-1 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-[#C9A227] bg-white disabled:opacity-60"
                        >
                          {roles.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={u.active ? "active" : "pending"} />
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{fmtDateTime(u.created_at)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          {!u.active && (
                            <Button size="sm" variant="gold" onClick={() => approveUser(u.id)}>
                              Approve
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

      {showInvite && <InviteModal roles={roles} joinCode={joinCode} orgId={orgId} supabase={supabase} onClose={() => setShowInvite(false)} onRegenerated={(code) => setJoinCode(code)} />}
    </div>
  );
}

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
              <button
                onClick={() => navigator.clipboard?.writeText(joinCode)}
                className="text-xs text-[#0F2A47] hover:underline"
              >
                Copy
              </button>
              <button
                onClick={regenerate}
                disabled={regenerating}
                className="text-xs text-gray-500 hover:underline ml-auto"
              >
                {regenerating ? "…" : "Generate new code"}
              </button>
            </div>
            <p className="mt-2 text-xs text-gray-600">
              Share this code with staff who need to register. They will enter it during
              sign-up and appear here as &ldquo;Pending&rdquo; for your approval.
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
            No school code yet. Run <code>supabase/fix_profile_isolation.sql</code> in the
            Supabase SQL editor to enable join codes.
          </div>
        )}

        <div className="text-sm text-gray-600">
          <strong>Available roles:</strong>
          <ul className="mt-2 space-y-1">
            {roles.map(r => (
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
