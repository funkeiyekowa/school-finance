"use client";

/**
 * Platform super-admin management (Platform Admin -> Super Admins tab).
 *
 * Lists every platform super administrator and lets a super admin add a
 * new one, edit a name, reset a password, deactivate/reactivate, or revoke
 * platform-admin status. Every mutation goes through is_platform_admin()-
 * gated SECURITY DEFINER RPCs (see supabase/platform_super_admins.sql):
 * list_platform_admins, create_platform_admin, update_platform_admin,
 * revoke_platform_admin. The panel itself only renders inside the
 * super-admin-gated Platform Admin page, so it is defence-in-depth.
 */

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { LoadingSpinner, EmptyState } from "@/components/ui/PageHeader";
import { cn, fmtDateTime } from "@/lib/utils";
import {
  ShieldPlus, Trash2, ShieldCheck, AlertTriangle, CheckCircle2, Pencil, KeyRound, Search,
} from "lucide-react";

interface PlatformAdminRow {
  user_id: string;
  email: string | null;
  full_name: string | null;
  profile_role: string | null;
  active: boolean;
  via_developer: boolean;
  via_membership: boolean;
  is_self: boolean;
  created_at: string | null;
  last_sign_in_at: string | null;
}

export function SuperAdminsPanel() {
  const supabase = createClient();
  const { isSuperAdmin } = useAuth();

  const [rows, setRows] = useState<PlatformAdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Add
  const [showAdd, setShowAdd] = useState(false);
  const [addEmail, setAddEmail] = useState("");
  const [addName, setAddName] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [createdCred, setCreatedCred] = useState<{ email: string; password: string } | null>(null);

  // Edit (name)
  const [editing, setEditing] = useState<PlatformAdminRow | null>(null);
  const [editName, setEditName] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  // Reset password
  const [pwTarget, setPwTarget] = useState<PlatformAdminRow | null>(null);
  const [pwValue, setPwValue] = useState("");
  const [savingPw, setSavingPw] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase.rpc("list_platform_admins");
    if (err) {
      setError(
        err.message.includes("does not exist")
          ? "The list_platform_admins function is missing. Run supabase/platform_super_admins.sql first."
          : err.message
      );
      setRows([]);
    } else {
      setRows((data ?? []) as PlatformAdminRow[]);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  function flash(msg: string) {
    setNotice(msg);
    setTimeout(() => setNotice(null), 4000);
  }

  async function handleAdd() {
    setAdding(true);
    setAddError(null);
    const { data, error: err } = await supabase.rpc("create_platform_admin", {
      p_email: addEmail.trim(),
      p_full_name: addName.trim() || null,
    });
    setAdding(false);
    if (err) { setAddError(err.message); return; }
    const result = data as { ok: boolean; email?: string; password?: string | null; existed?: boolean } | null;
    if (!result?.ok) { setAddError("Could not create that platform admin."); return; }

    setShowAdd(false);
    if (result.password) {
      setCreatedCred({ email: result.email ?? addEmail.trim(), password: result.password });
    }
    flash(result.existed
      ? `${result.email} promoted to platform admin.`
      : `${result.email} created as a platform admin.`);
    setAddEmail(""); setAddName("");
    await load();
  }

  async function saveName() {
    if (!editing) return;
    setSavingEdit(true);
    const { error: err } = await supabase.rpc("update_platform_admin", {
      p_user_id: editing.user_id,
      p_full_name: editName.trim() || null,
      p_password: null,
      p_active: null,
    });
    setSavingEdit(false);
    if (err) { setError(err.message); return; }
    setEditing(null);
    flash("Name updated.");
    await load();
  }

  async function savePassword() {
    if (!pwTarget) return;
    if (pwValue.trim().length < 8) { setError("Password must be at least 8 characters."); return; }
    setSavingPw(true);
    const { error: err } = await supabase.rpc("update_platform_admin", {
      p_user_id: pwTarget.user_id,
      p_full_name: null,
      p_password: pwValue.trim(),
      p_active: null,
    });
    setSavingPw(false);
    if (err) { setError(err.message); return; }
    const email = pwTarget.email ?? "";
    setPwTarget(null); setPwValue("");
    flash(`Password reset for ${email}. They must change it on next login.`);
  }

  async function toggleActive(m: PlatformAdminRow) {
    setBusyId(m.user_id);
    const { error: err } = await supabase.rpc("update_platform_admin", {
      p_user_id: m.user_id,
      p_full_name: null,
      p_password: null,
      p_active: !m.active,
    });
    setBusyId(null);
    if (err) { setError(err.message); return; }
    flash(m.active ? "Platform admin deactivated." : "Platform admin reactivated.");
    await load();
  }

  async function revoke(m: PlatformAdminRow) {
    const who = m.full_name || m.email || "this admin";
    if (!confirm(`Revoke platform-admin status from ${who}?\n\nTheir account and any school memberships remain, but they lose platform-wide access.`)) return;
    setBusyId(m.user_id);
    const { error: err } = await supabase.rpc("revoke_platform_admin", { p_user_id: m.user_id });
    setBusyId(null);
    if (err) { setError(err.message); return; }
    flash(`${who} is no longer a platform admin.`);
    await load();
  }

  if (!isSuperAdmin) return null;

  const filtered = rows.filter((r) => {
    const q = search.trim().toLowerCase();
    return !q || (r.full_name || "").toLowerCase().includes(q) || (r.email || "").toLowerCase().includes(q);
  });

  return (
    <div>
      {error && (
        <div className="mb-3 flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          <AlertTriangle size={15} className="mt-px shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-xs underline">dismiss</button>
        </div>
      )}
      {notice && (
        <div className="mb-3 flex items-start gap-2 p-3 rounded-lg bg-green-50 border border-green-200 text-sm text-green-800">
          <CheckCircle2 size={15} className="mt-px shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search admins"
            aria-label="Search platform admins"
            className="pl-8 pr-3 py-1.5 text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-[#C9A227]"
          />
        </div>
        <Button size="sm" variant="gold" onClick={() => { setShowAdd(true); setAddError(null); }}>
          <ShieldPlus size={14} /> Add Super Admin
        </Button>
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : filtered.length === 0 ? (
        <EmptyState message="No platform admins found." icon={<ShieldCheck size={32} />} />
      ) : (
        <div className="overflow-x-auto border border-gray-100 rounded-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#0F2A47] text-white text-left">
                <th className="px-3 py-2 font-semibold">Name</th>
                <th className="px-3 py-2 font-semibold">Email</th>
                <th className="px-3 py-2 font-semibold">Source</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">Last sign-in</th>
                <th className="px-3 py-2 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => (
                <tr key={m.user_id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-3 py-2">
                    <div className="font-medium text-gray-900">
                      {m.full_name || m.email || m.user_id.slice(0, 8)}
                      {m.is_self && <span className="ml-1.5 text-[10px] text-gray-400">(you)</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-gray-600">{m.email || "—"}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {m.via_developer && <Badge variant="purple">developer</Badge>}
                      {m.via_membership && <Badge variant="navy">super_admin</Badge>}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => toggleActive(m)}
                      disabled={busyId === m.user_id || m.is_self}
                      title={m.is_self ? "You cannot change your own status" : undefined}
                      className={cn(
                        "text-xs font-semibold px-2 py-0.5 rounded",
                        m.active ? "bg-green-100 text-green-700 hover:bg-green-200"
                                 : "bg-gray-100 text-gray-500 hover:bg-gray-200",
                        (busyId === m.user_id || m.is_self) && "opacity-50 cursor-not-allowed"
                      )}
                    >
                      {m.active ? "active" : "inactive"}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-400">
                    {m.last_sign_in_at ? fmtDateTime(m.last_sign_in_at) : "never"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="inline-flex items-center gap-1">
                      <button
                        onClick={() => { setEditing(m); setEditName(m.full_name || ""); }}
                        disabled={busyId === m.user_id}
                        aria-label={`Edit ${m.email ?? "admin"} name`}
                        title="Edit name"
                        className="text-gray-500 hover:text-[#0F2A47] p-1 rounded hover:bg-gray-100 disabled:opacity-40"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => { setPwTarget(m); setPwValue(""); }}
                        disabled={busyId === m.user_id}
                        aria-label={`Reset password for ${m.email ?? "admin"}`}
                        title="Reset password"
                        className="text-gray-500 hover:text-[#0F2A47] p-1 rounded hover:bg-gray-100 disabled:opacity-40"
                      >
                        <KeyRound size={14} />
                      </button>
                      <button
                        onClick={() => revoke(m)}
                        disabled={busyId === m.user_id || m.is_self}
                        aria-label={`Revoke ${m.email ?? "admin"}`}
                        title={m.is_self ? "You cannot revoke yourself" : "Revoke platform admin"}
                        className="text-red-500 hover:text-red-700 p-1 rounded hover:bg-red-50 disabled:opacity-40"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add */}
      {showAdd && (
        <Modal open onClose={() => setShowAdd(false)} title="Add Super Admin" size="md">
          <div className="space-y-3">
            <p className="text-xs text-gray-500">
              Grant platform-wide administrator access. If the email has no account yet, one is
              created with a temporary password you can share; they must change it on first login.
              If the account already exists, it is simply promoted.
            </p>
            <Input label="Email" type="email" value={addEmail} onChange={(e) => setAddEmail(e.target.value)} placeholder="admin@platform.com" autoComplete="off" />
            <Input label="Full name" value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="Jane Doe" autoComplete="off" />
            {addError && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                <AlertTriangle size={14} className="mt-px shrink-0" />
                <span>{addError}</span>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Button>
              <Button variant="gold" loading={adding} disabled={!addEmail.trim()} onClick={handleAdd}>
                Add Super Admin
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* New-account credentials */}
      {createdCred && (
        <Modal open onClose={() => setCreatedCred(null)} title="Platform admin created" size="md">
          <div className="space-y-3">
            <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-900">
              A new platform admin account was created. Share these temporary credentials — they
              will be asked to change the password on first login.
            </div>
            <div className="text-xs space-y-1 bg-gray-50 border border-gray-200 rounded-lg p-3">
              <div><span className="text-gray-500">Email:</span> <strong>{createdCred.email}</strong></div>
              <div><span className="text-gray-500">Password:</span> <strong>{createdCred.password}</strong></div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => navigator.clipboard?.writeText(`${createdCred.email} / ${createdCred.password}`)}>Copy</Button>
              <Button variant="gold" onClick={() => setCreatedCred(null)}>Done</Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Edit name */}
      {editing && (
        <Modal open onClose={() => setEditing(null)} title="Edit name" size="sm">
          <div className="space-y-3">
            <Input label="Full name" value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Jane Doe" autoComplete="off" />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
              <Button variant="gold" loading={savingEdit} onClick={saveName}>Save</Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Reset password */}
      {pwTarget && (
        <Modal open onClose={() => setPwTarget(null)} title="Reset password" size="sm">
          <div className="space-y-3">
            <p className="text-xs text-gray-500">
              Set a new password for <strong>{pwTarget.email}</strong>. They will be asked to change
              it on next login.
            </p>
            <Input label="New password" type="text" value={pwValue} onChange={(e) => setPwValue(e.target.value)} placeholder="At least 8 characters" autoComplete="off" />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setPwTarget(null)}>Cancel</Button>
              <Button variant="gold" loading={savingPw} disabled={pwValue.trim().length < 8} onClick={savePassword}>Reset password</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
