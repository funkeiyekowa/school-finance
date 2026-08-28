"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { PageHeader, LoadingSpinner } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/lib/utils";
import { Plus, Save, Trash2, Sparkles, ShieldCheck } from "lucide-react";
import type { Role } from "@/lib/types";
import { APP_FEATURES, ROLE_PRESETS } from "@/lib/types";

/** Group features by their `group` field for display. */
function groupedFeatures() {
  const groups: Record<string, typeof APP_FEATURES[number][]> = {};
  for (const f of APP_FEATURES) {
    (groups[f.group] ??= []).push(f);
  }
  return groups;
}

const BUILT_IN = new Set(["admin", "editor", "viewer"]);
const CANONICAL = ["student", "parent", "teacher", "bursar"] as const;

export default function RolesPage() {
  const { isAdmin, profile, orgId } = useAuth();
  const supabase = createClient();
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [seeding, setSeeding] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from("roles").select("*").order("name");
    if (error) console.warn("roles load error:", error.message);
    setRoles(data ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  if (!isAdmin) return <div className="p-6 text-gray-500">Admin access required.</div>;

  const existingNames = useMemo(() => new Set(roles.map(r => r.name.toLowerCase())), [roles]);
  const missingCanonical = CANONICAL.filter(n => !existingNames.has(n));

  async function togglePermission(role: Role, featureKey: string, value: boolean) {
    const newPerms = { ...(role.permissions as Record<string, boolean>), [featureKey]: value };
    setRoles(prev => prev.map(r => r.id === role.id ? { ...r, permissions: newPerms } : r));
    const { error } = await supabase.from("roles")
      .update({ permissions: newPerms, updated_at: new Date().toISOString() })
      .eq("id", role.id);
    if (error) {
      setFeedback(`Save failed: ${error.message}`);
      // Roll back
      setRoles(prev => prev.map(r => r.id === role.id
        ? { ...r, permissions: role.permissions } : r));
    }
  }

  async function saveRole(role: Role) {
    setSaving(role.id);
    const { error } = await supabase.from("roles")
      .update({ permissions: role.permissions, updated_at: new Date().toISOString() })
      .eq("id", role.id);
    setSaving(null);
    if (error) { setFeedback(`Save failed: ${error.message}`); return; }
    await supabase.from("activity_log").insert({
      user_email: profile?.email, user_name: profile?.full_name,
      action: "Update Role Permissions", details: role.name,
      organization_id: orgId,
    });
    setFeedback(`Saved permissions for ${role.name}.`);
  }

  async function deleteRole(id: string, name: string) {
    if (BUILT_IN.has(name)) { alert("Cannot delete built-in roles."); return; }
    if (!confirm(`Delete the ${name} role?`)) return;
    const { error } = await supabase.from("roles").delete().eq("id", id);
    if (error) { setFeedback(`Delete failed: ${error.message}`); return; }
    setRoles(prev => prev.filter(r => r.id !== id));
  }

  async function toggleDefault(role: Role) {
    // Unset all others, set this one - scoped to this org via RLS.
    await supabase.from("roles").update({ is_default: false }).neq("id", role.id);
    await supabase.from("roles").update({ is_default: !role.is_default }).eq("id", role.id);
    setRoles(prev => prev.map(r => ({ ...r, is_default: r.id === role.id ? !role.is_default : false })));
  }

  async function seedRole(name: keyof typeof ROLE_PRESETS) {
    setSeeding(name);
    const preset = ROLE_PRESETS[name] ?? {};
    const { error } = await supabase.from("roles").insert({
      name,
      description: `Canonical ${name} permissions - edit to tailor.`,
      is_default: false,
      permissions: preset,
      organization_id: orgId,
    });
    setSeeding(null);
    if (error) { setFeedback(`Could not seed ${name}: ${error.message}`); return; }
    setFeedback(`Seeded ${name} role - review and save.`);
    await load();
  }

  const groups = groupedFeatures();

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="Roles & Permissions" subtitle="Configure what each role can access across every screen">
        <Button onClick={() => setShowAdd(true)}>
          <Plus size={14} /> Add Custom Role
        </Button>
      </PageHeader>

      {feedback && (
        <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-700 flex items-center justify-between">
          <span>{feedback}</span>
          <button onClick={() => setFeedback(null)} className="text-blue-500 hover:underline text-xs">Dismiss</button>
        </div>
      )}

      {/* Canonical role seeding */}
      {missingCanonical.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles size={16} className="text-[#C9A227]" /> Recommended roles
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-gray-600 mb-3">
              Every school benefits from these first-class personas. Click to seed
              a role with a sensible default permission set - you can then edit it.
            </p>
            <div className="flex flex-wrap gap-2">
              {missingCanonical.map(name => (
                <Button key={name} size="sm" variant="secondary" loading={seeding === name}
                  onClick={() => seedRole(name)}>
                  <ShieldCheck size={12} /> Seed {name}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? <LoadingSpinner /> : (
        <div className="space-y-4">
          {roles.map(role => {
            const perms = role.permissions as Record<string, boolean>;
            const isBuiltIn = BUILT_IN.has(role.name);
            const isAdminRole = role.name === "admin";
            return (
              <Card key={role.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-3">
                        <CardTitle className="capitalize">{role.name}</CardTitle>
                        {isBuiltIn && (
                          <span className="text-xs bg-[#0F2A47] text-white px-2 py-0.5 rounded-full">Built-in</span>
                        )}
                        {(CANONICAL as readonly string[]).includes(role.name) && (
                          <span className="text-xs bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">Canonical</span>
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
                      {!isBuiltIn && (
                        <button onClick={() => deleteRole(role.id, role.name)}
                          className="text-gray-300 hover:text-red-500 transition-colors p-1">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 space-y-4">
                  {Object.entries(groups).map(([groupName, features]) => (
                    <div key={groupName}>
                      <h4 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-2">
                        {groupName}
                      </h4>
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                        {features.map(feature => {
                          const enabled = isAdminRole ? true : (perms[feature.key] ?? false);
                          return (
                            <label key={feature.key}
                              className={cn(
                                "flex items-center gap-2 p-2.5 rounded-lg border text-sm transition-colors",
                                enabled ? "border-[#C9A227] bg-[#FBF6E8]" : "border-gray-100 bg-gray-50",
                                isAdminRole ? "opacity-70 cursor-not-allowed" : "cursor-pointer hover:border-[#C9A227]/60"
                              )}>
                              <input
                                type="checkbox"
                                checked={enabled}
                                disabled={isAdminRole}
                                onChange={e => togglePermission(role, feature.key, e.target.checked)}
                                className="accent-[#C9A227]"
                              />
                              <span className={cn("font-medium truncate", enabled ? "text-[#0F2A47]" : "text-gray-500")}>
                                {feature.label}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  {!isAdminRole && (
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

      {showAdd && <AddRoleModal orgId={orgId} onClose={() => { setShowAdd(false); load(); }} />}
    </div>
  );
}

function AddRoleModal({ orgId, onClose }: { orgId: string | null; onClose: () => void }) {
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
      organization_id: orgId,
    });
    if (error) { setError(error.message); setLoading(false); return; }
    await supabase.from("activity_log").insert({
      user_email: profile?.email, user_name: profile?.full_name,
      action: "Create Role", details: name, organization_id: orgId,
    });
    onClose();
  }

  const groups = groupedFeatures();

  return (
    <Modal open onClose={onClose} title="Create New Role" size="lg">
      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}
      <form onSubmit={submit} className="space-y-4">
        <Input label="Role Name" value={name} onChange={e => setName(e.target.value)} required placeholder="e.g. Bursar" />
        <Input label="Description (optional)" value={description} onChange={e => setDescription(e.target.value)} />
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Permissions</label>
          {Object.entries(groups).map(([groupName, features]) => (
            <div key={groupName} className="mb-3">
              <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">{groupName}</div>
              <div className="grid grid-cols-2 gap-1.5">
                {features.map(feature => (
                  <label key={feature.key} className={cn(
                    "flex items-center gap-2 p-2 rounded-lg border cursor-pointer text-xs transition-colors",
                    perms[feature.key] ? "border-[#C9A227] bg-[#FBF6E8]" : "border-gray-100 hover:border-gray-200"
                  )}>
                    <input type="checkbox" checked={perms[feature.key] ?? false}
                      onChange={e => setPerms(p => ({ ...p, [feature.key]: e.target.checked }))}
                      className="accent-[#C9A227]" />
                    <span className="font-medium text-gray-700 truncate">{feature.label}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="gold" loading={loading}>Create Role</Button>
        </div>
      </form>
    </Modal>
  );
}
