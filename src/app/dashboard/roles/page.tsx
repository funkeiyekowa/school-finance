"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { PageHeader, LoadingSpinner } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/lib/utils";
import { Plus, Save, Trash2 } from "lucide-react";
import type { Role } from "@/lib/types";
import { APP_FEATURES } from "@/lib/types";

export default function RolesPage() {
  const { isAdmin, profile } = useAuth();
  const supabase = createClient();
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from("roles").select("*").order("name");
    setRoles(data ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  if (!isAdmin) return <div className="p-6 text-gray-500">Admin access required.</div>;

  async function togglePermission(role: Role, featureKey: string, value: boolean) {
    const newPerms = { ...(role.permissions as Record<string, boolean>), [featureKey]: value };
    await supabase.from("roles").update({ permissions: newPerms, updated_at: new Date().toISOString() }).eq("id", role.id);
    setRoles(prev => prev.map(r => r.id === role.id ? { ...r, permissions: newPerms } : r));
  }

  async function saveRole(role: Role) {
    setSaving(role.id);
    await supabase.from("roles").update({ permissions: role.permissions, updated_at: new Date().toISOString() }).eq("id", role.id);
    await supabase.from("activity_log").insert({
      user_email: profile?.email, user_name: profile?.full_name,
      action: "Update Role Permissions", details: role.name,
    });
    setSaving(null);
  }

  async function deleteRole(id: string, name: string) {
    if (["admin", "editor", "viewer"].includes(name)) {
      alert("Cannot delete built-in roles.");
      return;
    }
    await supabase.from("roles").delete().eq("id", id);
    setRoles(prev => prev.filter(r => r.id !== id));
  }

  async function toggleDefault(role: Role) {
    // Unset all others, set this one
    await supabase.from("roles").update({ is_default: false }).neq("id", role.id);
    await supabase.from("roles").update({ is_default: !role.is_default }).eq("id", role.id);
    setRoles(prev => prev.map(r => ({ ...r, is_default: r.id === role.id ? !role.is_default : false })));
  }

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="Roles & Permissions" subtitle="Configure what each role can access">
        <Button onClick={() => setShowAdd(true)}>
          <Plus size={14} /> Add Role
        </Button>
      </PageHeader>

      {loading ? <LoadingSpinner /> : (
        <div className="space-y-4">
          {roles.map(role => {
            const perms = role.permissions as Record<string, boolean>;
            return (
              <Card key={role.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-3">
                        <CardTitle className="capitalize">{role.name}</CardTitle>
                        {["admin", "editor", "viewer"].includes(role.name) && (
                          <span className="text-xs bg-[#0F2A47] text-white px-2 py-0.5 rounded-full">Built-in</span>
                        )}
                        {role.is_default && (
                          <span className="text-xs bg-[#C9A227] text-[#0F2A47] px-2 py-0.5 rounded-full font-semibold">Default for new users</span>
                        )}
                      </div>
                      {role.description && <p className="text-xs text-gray-500 mt-0.5">{role.description}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => toggleDefault(role)}
                        className="text-xs text-gray-500 hover:text-[#0F2A47] underline">
                        {role.is_default ? "Unset default" : "Set as default"}
                      </button>
                      {!["admin", "editor", "viewer"].includes(role.name) && (
                        <button onClick={() => deleteRole(role.id, role.name)}
                          className="text-gray-300 hover:text-red-500 transition-colors p-1">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-4">
                    {APP_FEATURES.map(feature => {
                      const enabled = role.name === "admin" ? true : (perms[feature.key] ?? false);
                      const isAdminRole = role.name === "admin";
                      return (
                        <label key={feature.key}
                          className={cn(
                            "flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-colors text-sm",
                            enabled ? "border-[#C9A227] bg-[#FBF6E8]" : "border-gray-100 bg-gray-50",
                            isAdminRole && "opacity-70 cursor-not-allowed"
                          )}>
                          <input
                            type="checkbox"
                            checked={enabled}
                            disabled={isAdminRole}
                            onChange={e => togglePermission(role, feature.key, e.target.checked)}
                            className="accent-[#C9A227]"
                          />
                          <span className={cn("font-medium", enabled ? "text-[#0F2A47]" : "text-gray-500")}>
                            {feature.label}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  {role.name !== "admin" && (
                    <Button size="sm" variant="gold" loading={saving === role.id} onClick={() => saveRole(role)}>
                      <Save size={13} /> Save Permissions
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {showAdd && <AddRoleModal onClose={() => { setShowAdd(false); load(); }} />}
    </div>
  );
}

function AddRoleModal({ onClose }: { onClose: () => void }) {
  const supabase = createClient();
  const { profile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [perms, setPerms] = useState<Record<string, boolean>>(
    Object.fromEntries(APP_FEATURES.map(f => [f.key, false]))
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("Role name is required."); return; }
    setLoading(true);
    const { error } = await supabase.from("roles").insert({
      name: name.toLowerCase().replace(/\s+/g, "_"),
      description: description || null,
      is_default: false,
      permissions: perms,
    });
    if (error) { setError(error.message); setLoading(false); return; }
    await supabase.from("activity_log").insert({ user_email: profile?.email, user_name: profile?.full_name, action: "Create Role", details: name });
    onClose();
  }

  return (
    <Modal open onClose={onClose} title="Create New Role" size="lg">
      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}
      <form onSubmit={submit} className="space-y-4">
        <Input label="Role Name" value={name} onChange={e => setName(e.target.value)} required placeholder="e.g. Bursar" />
        <Input label="Description (optional)" value={description} onChange={e => setDescription(e.target.value)} />
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Permissions</label>
          <div className="grid grid-cols-2 gap-2">
            {APP_FEATURES.map(feature => (
              <label key={feature.key} className={cn(
                "flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer text-sm transition-colors",
                perms[feature.key] ? "border-[#C9A227] bg-[#FBF6E8]" : "border-gray-100 hover:border-gray-200"
              )}>
                <input type="checkbox" checked={perms[feature.key] ?? false}
                  onChange={e => setPerms(p => ({ ...p, [feature.key]: e.target.checked }))}
                  className="accent-[#C9A227]" />
                <span className="font-medium text-gray-700">{feature.label}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="gold" loading={loading}>Create Role</Button>
        </div>
      </form>
    </Modal>
  );
}
