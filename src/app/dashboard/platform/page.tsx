"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { fmtDateTime, cn } from "@/lib/utils";
import { PageHeader, LoadingSpinner } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Plus, Building2, Package, Users, Settings } from "lucide-react";

export default function PlatformAdminPage() {
  const { isSuperAdmin, profile } = useAuth();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"orgs" | "modules">("orgs");

  // --- Organizations ---
  const [orgs, setOrgs] = useState<Record<string, unknown>[]>([]);
  const [modules, setModules] = useState<Record<string, unknown>[]>([]);
  const [subscriptions, setSubscriptions] = useState<Record<string, unknown>[]>([]);
  const [selectedOrg, setSelectedOrg] = useState<Record<string, unknown> | null>(null);
  const [showOrgModal, setShowOrgModal] = useState(false);
  const [orgForm, setOrgForm] = useState({ name: "", slug: "", email: "", plan: "starter", status: "active" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [orgRes, modRes, subRes] = await Promise.all([
      supabase.from("organizations").select("*").order("created_at", { ascending: false }),
      supabase.from("platform_modules").select("*").order("sort_order"),
      supabase.from("subscriptions").select("*"),
    ]);
    setOrgs(orgRes.data ?? []);
    setModules(modRes.data ?? []);
    setSubscriptions(subRes.data ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  if (!isSuperAdmin) {
    return <div className="p-6 text-gray-500">Platform admin access required.</div>;
  }

  async function saveOrg() {
    setSaving(true);
    if (selectedOrg) {
      await supabase.from("organizations").update({
        name: orgForm.name, slug: orgForm.slug, email: orgForm.email,
        plan: orgForm.plan, status: orgForm.status, updated_at: new Date().toISOString(),
      }).eq("id", selectedOrg.id);
    } else {
      const { data: newOrg } = await supabase.from("organizations").insert({
        name: orgForm.name, slug: orgForm.slug || orgForm.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        email: orgForm.email, plan: orgForm.plan, status: orgForm.status,
      }).select("id").single();

      // Enable core modules for the new org
      if (newOrg) {
        const coreModules = modules.filter(m => m.is_core === true);
        for (const mod of coreModules) {
          await supabase.from("subscriptions").insert({
            organization_id: newOrg.id, module_key: String(mod.key), status: "active",
          });
        }
        // Create school_settings row for the new org
        await supabase.from("school_settings").insert({
          school_name: orgForm.name, organization_id: newOrg.id,
        });
      }
    }
    await supabase.from("activity_log").insert({
      user_email: profile?.email, user_name: profile?.full_name,
      action: selectedOrg ? "Update Organization" : "Create Organization",
      details: orgForm.name,
    });
    setSaving(false);
    setShowOrgModal(false);
    setSelectedOrg(null);
    load();
  }

  function openOrgModal(org?: Record<string, unknown>) {
    if (org) {
      setSelectedOrg(org);
      setOrgForm({
        name: String(org.name || ""), slug: String(org.slug || ""),
        email: String(org.email || ""), plan: String(org.plan || "starter"),
        status: String(org.status || "active"),
      });
    } else {
      setSelectedOrg(null);
      setOrgForm({ name: "", slug: "", email: "", plan: "starter", status: "active" });
    }
    setShowOrgModal(true);
  }

  async function toggleModule(orgId: string, moduleKey: string, enabled: boolean) {
    if (enabled) {
      await supabase.from("subscriptions").insert({
        organization_id: orgId, module_key: moduleKey, status: "active",
      });
    } else {
      await supabase.from("subscriptions").delete()
        .eq("organization_id", orgId).eq("module_key", moduleKey);
    }
    load();
  }

  function getOrgModules(orgId: string): string[] {
    return subscriptions
      .filter(s => s.organization_id === orgId && s.status === "active")
      .map(s => String(s.module_key));
  }

  if (loading) return <div className="p-6"><LoadingSpinner /></div>;

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="Platform Administration" subtitle="Manage organizations, subscriptions, and platform modules" />

      {/* Sub-tabs */}
      <div className="flex gap-2">
        <button onClick={() => setTab("orgs")} className={cn("flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg", tab === "orgs" ? "bg-[#0F2A47] text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200")}>
          <Building2 size={14} /> Organizations
        </button>
        <button onClick={() => setTab("modules")} className={cn("flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg", tab === "modules" ? "bg-[#0F2A47] text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200")}>
          <Package size={14} /> Modules
        </button>
      </div>

      {tab === "orgs" && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Organizations ({orgs.length})</CardTitle>
              <Button size="sm" variant="gold" onClick={() => openOrgModal()}>
                <Plus size={14} /> New Organization
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b">
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Name</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Slug</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Plan</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Status</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Modules</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Created</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {orgs.map(org => {
                    const orgMods = getOrgModules(String(org.id));
                    return (
                      <tr key={String(org.id)} className="border-b hover:bg-gray-50">
                        <td className="px-3 py-2 font-medium">{String(org.name)}</td>
                        <td className="px-3 py-2 text-gray-500 font-mono text-xs">{String(org.slug)}</td>
                        <td className="px-3 py-2">
                          <span className="px-2 py-0.5 rounded text-xs font-bold bg-blue-100 text-blue-700">{String(org.plan)}</span>
                        </td>
                        <td className="px-3 py-2">
                          <span className={cn("px-2 py-0.5 rounded text-xs font-bold",
                            org.status === "active" ? "bg-green-100 text-green-700" :
                            org.status === "trial" ? "bg-amber-100 text-amber-700" :
                            "bg-red-100 text-red-700"
                          )}>{String(org.status)}</span>
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-500">{orgMods.length} enabled</td>
                        <td className="px-3 py-2 text-xs text-gray-400">{org.created_at ? fmtDateTime(String(org.created_at)) : ""}</td>
                        <td className="px-3 py-2 text-right">
                          <button onClick={() => openOrgModal(org)} className="text-xs text-[#0F2A47] hover:underline mr-2">Edit</button>
                          <button onClick={() => setSelectedOrg(org)} className="text-xs text-[#C9A227] hover:underline">Modules</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Module management for selected org */}
            {selectedOrg && !showOrgModal && (
              <div className="mt-6 p-4 bg-[#FBF6E8] border border-[#C9A227] rounded-xl">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-sm text-[#0F2A47]">
                    Modules for: {String(selectedOrg.name)}
                  </h3>
                  <button onClick={() => setSelectedOrg(null)} className="text-xs text-gray-500 hover:underline">Close</button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                  {modules.map(mod => {
                    const enabled = getOrgModules(String(selectedOrg.id)).includes(String(mod.key));
                    const isCore = mod.is_core === true;
                    return (
                      <label key={String(mod.id)} className={cn(
                        "flex items-center gap-2 p-2 rounded-lg border text-xs cursor-pointer",
                        enabled ? "bg-white border-green-200" : "bg-gray-50 border-gray-100",
                        isCore && "opacity-70 cursor-not-allowed"
                      )}>
                        <input
                          type="checkbox"
                          checked={enabled}
                          disabled={isCore}
                          onChange={e => toggleModule(String(selectedOrg.id), String(mod.key), e.target.checked)}
                          className="w-3.5 h-3.5 rounded border-gray-300 text-[#C9A227] focus:ring-[#C9A227]"
                        />
                        <span className="font-medium text-gray-700">{String(mod.name)}</span>
                        {isCore && <span className="text-[9px] text-gray-400">(core)</span>}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "modules" && (
        <Card>
          <CardHeader><CardTitle>Platform Modules</CardTitle></CardHeader>
          <CardContent>
            <p className="text-xs text-gray-500 mb-4">These are the available product modules. Core modules are always enabled for every organization.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b">
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Module</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Key</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Category</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Core</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Subscribed Orgs</th>
                  </tr>
                </thead>
                <tbody>
                  {modules.map(mod => {
                    const subCount = subscriptions.filter(s => s.module_key === mod.key && s.status === "active").length;
                    return (
                      <tr key={String(mod.id)} className="border-b hover:bg-gray-50">
                        <td className="px-3 py-2 font-medium">{String(mod.name)}</td>
                        <td className="px-3 py-2 text-gray-500 font-mono text-xs">{String(mod.key)}</td>
                        <td className="px-3 py-2 text-gray-500 text-xs">{String(mod.category || "—")}</td>
                        <td className="px-3 py-2">
                          {mod.is_core ? <span className="text-xs font-bold text-green-700 bg-green-50 px-2 py-0.5 rounded">Yes</span> : ""}
                        </td>
                        <td className="px-3 py-2 text-gray-500">{subCount}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Org Create/Edit Modal */}
      {showOrgModal && (
        <Modal open onClose={() => { setShowOrgModal(false); setSelectedOrg(null); }} title={selectedOrg ? "Edit Organization" : "New Organization"} size="lg">
          <div className="space-y-4">
            <Input label="Organization Name" value={orgForm.name} onChange={e => setOrgForm(f => ({ ...f, name: e.target.value }))} placeholder="Grant International School" />
            <Input label="Slug (URL identifier)" value={orgForm.slug} onChange={e => setOrgForm(f => ({ ...f, slug: e.target.value }))} placeholder="grant-school" helpText="Lowercase letters, numbers, and hyphens only." />
            <Input label="Email" value={orgForm.email} onChange={e => setOrgForm(f => ({ ...f, email: e.target.value }))} placeholder="admin@school.com" />
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Plan</label>
                <select value={orgForm.plan} onChange={e => setOrgForm(f => ({ ...f, plan: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227] bg-white">
                  <option value="starter">Starter</option>
                  <option value="standard">Standard</option>
                  <option value="premium">Premium</option>
                  <option value="full">Full (all modules)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                <select value={orgForm.status} onChange={e => setOrgForm(f => ({ ...f, status: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227] bg-white">
                  <option value="active">Active</option>
                  <option value="trial">Trial</option>
                  <option value="suspended">Suspended</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => { setShowOrgModal(false); setSelectedOrg(null); }}>Cancel</Button>
              <Button variant="gold" loading={saving} onClick={saveOrg} disabled={!orgForm.name.trim()}>
                {selectedOrg ? "Update" : "Create Organization"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
