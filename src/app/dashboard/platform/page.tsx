"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { fmtDateTime, cn } from "@/lib/utils";
import { PageHeader, LoadingSpinner, KpiCard } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { OrgMembersPanel } from "@/components/platform/OrgMembersPanel";
import { SuperAdminsPanel } from "@/components/platform/SuperAdminsPanel";
import { SeedDataPanel } from "@/components/platform/SeedDataPanel";
import {
  Plus, Building2, Package, Users, ShieldCheck, LogIn, AlertTriangle,
  CheckCircle2, Globe, ExternalLink, Copy,
} from "lucide-react";

interface OrgRow {
  id: string;
  name: string;
  slug: string;
  email: string | null;
  plan: string;
  status: string;
  created_at: string;
  logo_url: string | null;
}

interface ModuleRow {
  id: string;
  key: string;
  name: string;
  category: string | null;
  is_core: boolean;
  sort_order: number;
}

interface SubRow {
  organization_id: string;
  module_key: string;
  status: string;
}

type Tab = "orgs" | "school" | "members" | "modules" | "superadmins";

export default function PlatformAdminPage() {
  const { isSuperAdmin, profile, orgId, switchOrg } = useAuth();
  const supabase = useMemo(() => createClient(), []);

  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("orgs");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [modules, setModules] = useState<ModuleRow[]>([]);
  const [subscriptions, setSubscriptions] = useState<SubRow[]>([]);
  const [memberCounts, setMemberCounts] = useState<Record<string, number>>({});

  /** The org whose detail (modules/members) is expanded. */
  const [focusOrgId, setFocusOrgId] = useState<string | null>(null);

  const [showOrgModal, setShowOrgModal] = useState(false);
  const [editingOrg, setEditingOrg] = useState<OrgRow | null>(null);
  const [orgForm, setOrgForm] = useState({
    name: "", slug: "", email: "", plan: "starter", status: "trial",
    owner_email: "", email_domain: "",
  });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [orgRes, modRes, subRes, memRes] = await Promise.all([
      supabase.from("organizations").select("*").order("created_at", { ascending: false }),
      supabase.from("platform_modules").select("*").order("sort_order"),
      supabase.from("subscriptions").select("organization_id, module_key, status"),
      supabase.from("org_memberships").select("organization_id"),
    ]);

    if (orgRes.error) setError(orgRes.error.message);

    setOrgs((orgRes.data ?? []) as OrgRow[]);
    setModules((modRes.data ?? []) as ModuleRow[]);
    setSubscriptions((subRes.data ?? []) as SubRow[]);

    const counts: Record<string, number> = {};
    for (const row of memRes.data ?? []) {
      const key = String((row as { organization_id: string }).organization_id);
      counts[key] = (counts[key] ?? 0) + 1;
    }
    setMemberCounts(counts);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const focusOrg = useMemo(
    () => orgs.find(o => o.id === focusOrgId) ?? null,
    [orgs, focusOrgId]
  );

  function flash(msg: string) {
    setNotice(msg);
    setTimeout(() => setNotice(null), 4000);
  }

  /**
   * Client-side preview only — mirrors the exact canonicalization
   * update_organization() (and provision_organization()) apply server-side:
   * lowercase, any run of non-alphanumerics -> a single hyphen, trim
   * leading/trailing hyphens. Shown so an admin sees what will actually be
   * saved before submitting; the RPC re-derives this itself and is the
   * real source of truth, so a mismatch here can never cause a bad save.
   */
  function previewSlug(raw: string, fallbackName: string): string {
    const base = raw.trim() || fallbackName;
    return base
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  if (!isSuperAdmin) {
    return (
      <div className="p-6">
        <div className="max-w-md mx-auto text-center py-16">
          <ShieldCheck size={40} className="mx-auto text-gray-300 mb-3" />
          <h2 className="font-bold text-gray-900 mb-1">Platform admin access required</h2>
          <p className="text-sm text-gray-500">
            This area manages every school on the platform. Ask a platform administrator
            for access.
          </p>
        </div>
      </div>
    );
  }

  function openCreate() {
    setEditingOrg(null);
    setOrgForm({
      name: "", slug: "", email: "", plan: "starter", status: "trial",
      owner_email: "", email_domain: "",
    });
    setFormError(null);
    setShowOrgModal(true);
  }

  function openEdit(org: OrgRow) {
    setEditingOrg(org);
    setOrgForm({
      name: org.name, slug: org.slug, email: org.email ?? "",
      plan: org.plan, status: org.status, owner_email: "", email_domain: "",
    });
    setFormError(null);
    setShowOrgModal(true);
  }

  async function saveOrg() {
    setSaving(true);
    setFormError(null);

    if (editingOrg) {
      // Routed through the update_organization SECURITY DEFINER RPC (not a
      // raw table .update()) so an edited slug goes through the SAME
      // canonicalization provision_organization already applies when
      // creating a school (lowercase, non-alphanumerics -> hyphens, trim
      // leading/trailing hyphens) plus a uniqueness check. Every login/
      // lookup path (resolve_school_brand_by_slug, resolve_site_by_slug,
      // resolve_login_context) only does slug = lower(trim(p_slug)) — it
      // does NOT re-slugify — so a slug saved raw (e.g. "Greenfield
      // Academy" instead of "greenfield-academy") could never resolve on
      // any login page. See supabase/fix_org_slug_edit.sql.
      const { data, error: err } = await supabase.rpc("update_organization", {
        p_org: editingOrg.id,
        p_name: orgForm.name.trim(),
        p_slug: orgForm.slug.trim(),
        p_email: orgForm.email.trim() || null,
        p_plan: orgForm.plan,
        p_status: orgForm.status,
      });

      setSaving(false);
      if (err) {
        if (err.code === "23505" || /already used by another school/i.test(err.message)) {
          setFormError(
            `That slug is already used by another school. Pick a different one — ` +
              `it's what the school's login and website URLs are built from.`,
          );
        } else if (err.message.includes("does not exist")) {
          setFormError("The update_organization RPC is missing. Run supabase/fix_org_slug_edit.sql first.");
        } else {
          setFormError(err.message);
        }
        return;
      }

      const result = data as { slug?: string } | null;
      flash(
        result?.slug && result.slug !== editingOrg.slug
          ? `${orgForm.name} updated. Slug saved as "${result.slug}".`
          : `${orgForm.name} updated.`,
      );
    } else {
      // One transactional call: creates the org, its roles, settings row and
      // core entitlements, and optionally assigns the owner. The old
      // multi-insert flow could leave a school half-created.
      const { data, error: err } = await supabase.rpc("provision_organization", {
        p_name: orgForm.name.trim(),
        p_slug: orgForm.slug.trim() || null,
        p_email: orgForm.email.trim() || null,
        p_plan: orgForm.plan,
        p_status: orgForm.status,
        p_owner_email: orgForm.owner_email.trim() || null,
        p_modules: null,
      });

      setSaving(false);
      if (err) {
        setFormError(
          err.message.includes("does not exist")
            ? "provision_organization is missing. Run supabase/saas_foundation.sql first."
            : err.message
        );
        return;
      }

      const result = data as { organization_id?: string; notice?: string | null } | null;

      if (orgForm.email_domain.trim() && result?.organization_id) {
        await supabase.from("organizations").update({
          settings: { email_domain: orgForm.email_domain.trim().replace(/^@/, "") },
        }).eq("id", result.organization_id);
      }

      flash(result?.notice ? result.notice : `${orgForm.name} created and provisioned.`);
      if (result?.organization_id) {
        setFocusOrgId(result.organization_id);
        setTab("members");
      }
    }

    await supabase.from("activity_log").insert({
      user_email: profile?.email,
      user_name: profile?.full_name,
      action: editingOrg ? "Update Organization" : "Provision Organization",
      details: orgForm.name,
    });

    setShowOrgModal(false);
    setEditingOrg(null);
    load();
  }

  async function toggleModule(org: string, moduleKey: string, enabled: boolean) {
    if (enabled) {
      const { error: err } = await supabase.from("subscriptions").insert({
        organization_id: org, module_key: moduleKey, status: "active",
      });
      if (err) { setError(err.message); return; }
    } else {
      const { error: err } = await supabase.from("subscriptions").delete()
        .eq("organization_id", org).eq("module_key", moduleKey);
      if (err) { setError(err.message); return; }
    }
    load();
  }

  function getOrgModules(org: string): string[] {
    return subscriptions
      .filter(s => s.organization_id === org && s.status === "active")
      .map(s => s.module_key);
  }

  async function enterOrg(org: OrgRow) {
    const res = await switchOrg(org.id);
    if (!res.ok) { setError(res.error ?? "Could not switch"); return; }
    flash(`Now operating as ${org.name}.`);
  }

  if (loading) return <div className="p-6"><LoadingSpinner /></div>;

  const trialCount = orgs.filter(o => o.status === "trial").length;
  const activeCount = orgs.filter(o => o.status === "active").length;
  const orphanOrgs = orgs.filter(o => (memberCounts[o.id] ?? 0) === 0);

  return (
    <div className="p-6 space-y-5">
      <PageHeader
        title="Platform Administration"
        subtitle="Provision schools, assign people to them, and control module entitlements"
      >
        <Link href="/dashboard/platform/verify">
          <Button size="sm" variant="secondary">
            <ShieldCheck size={14} /> Verify Isolation
          </Button>
        </Link>
        <Button size="sm" variant="gold" onClick={openCreate}>
          <Plus size={14} /> New School
        </Button>
      </PageHeader>

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          <AlertTriangle size={15} className="mt-px shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-xs underline">dismiss</button>
        </div>
      )}
      {notice && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-green-50 border border-green-200 text-sm text-green-800">
          <CheckCircle2 size={15} className="mt-px shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Schools" value={String(orgs.length)} icon={<Building2 size={16} />} />
        <KpiCard label="Active" value={String(activeCount)} icon={<CheckCircle2 size={16} />} colorClass="text-green-700" />
        <KpiCard label="On trial" value={String(trialCount)} icon={<Package size={16} />} colorClass="text-amber-600" />
        <KpiCard
          label="No members yet"
          value={String(orphanOrgs.length)}
          icon={<Users size={16} />}
          colorClass={orphanOrgs.length > 0 ? "text-red-600" : "text-[#0F2A47]"}
          sub={orphanOrgs.length > 0 ? "Nobody can sign into these" : "Every school is staffed"}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {([
          { id: "orgs", label: "Schools", icon: <Building2 size={14} /> },
          { id: "school", label: "School details", icon: <ExternalLink size={14} /> },
          { id: "members", label: "Members", icon: <Users size={14} /> },
          { id: "modules", label: "Module catalogue", icon: <Package size={14} /> },
          { id: "superadmins", label: "Super Admins", icon: <ShieldCheck size={14} /> },
        ] as const).map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors",
              tab === t.id ? "bg-[#0F2A47] text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            )}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === "orgs" && (
        <Card>
          <CardHeader><CardTitle>Schools ({orgs.length})</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b">
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Name</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Slug</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Plan</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Status</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Members</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Modules</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Created</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {orgs.map(org => {
                    const orgMods = getOrgModules(org.id);
                    const members = memberCounts[org.id] ?? 0;
                    const isCurrent = org.id === orgId;
                    return (
                      <tr key={org.id} className={cn("border-b last:border-0 hover:bg-gray-50", isCurrent && "bg-[#FBF6E8]")}>
                        <td className="px-3 py-2">
                          <div className="font-medium flex items-center gap-1.5">
                            {org.name}
                            {isCurrent && (
                              <span className="text-[9px] font-bold text-[#C9A227] bg-white border border-[#C9A227] px-1 rounded">
                                CURRENT
                              </span>
                            )}
                          </div>
                          {org.email && <div className="text-xs text-gray-500">{org.email}</div>}
                        </td>
                        <td className="px-3 py-2 text-gray-500 font-mono text-xs">{org.slug}</td>
                        <td className="px-3 py-2"><Badge variant="blue">{org.plan}</Badge></td>
                        <td className="px-3 py-2">
                          <Badge variant={
                            org.status === "active" ? "green" :
                            org.status === "trial" ? "amber" : "red"
                          }>{org.status}</Badge>
                        </td>
                        <td className="px-3 py-2">
                          {members === 0 ? (
                            <span className="text-xs font-semibold text-red-600">none</span>
                          ) : (
                            <span className="text-xs text-gray-600">{members}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-500">{orgMods.length}</td>
                        <td className="px-3 py-2 text-xs text-gray-400">
                          {org.created_at ? fmtDateTime(org.created_at) : ""}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                            <button onClick={() => openEdit(org)}
                              className="text-xs text-[#0F2A47] hover:underline">Edit</button>
                            <button onClick={() => { setFocusOrgId(org.id); setTab("school"); }}
                              className="text-xs text-[#0F2A47] hover:underline">URLs</button>
                            <button onClick={() => { setFocusOrgId(org.id); setTab("members"); }}
                              className="text-xs text-[#0F2A47] hover:underline">Members</button>
                            <button onClick={() => setFocusOrgId(focusOrgId === org.id ? null : org.id)}
                              className="text-xs text-[#C9A227] hover:underline">Modules</button>
                            {!isCurrent && (
                              <button onClick={() => enterOrg(org)}
                                title="Switch your session into this school"
                                className="inline-flex items-center gap-1 text-xs text-purple-700 hover:underline">
                                <LogIn size={11} /> Enter
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {focusOrg && tab === "orgs" && (
              <div className="mt-6 p-4 bg-[#FBF6E8] border border-[#C9A227] rounded-xl">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-sm text-[#0F2A47]">
                    Module entitlements — {focusOrg.name}
                  </h3>
                  <button onClick={() => setFocusOrgId(null)}
                    className="text-xs text-gray-500 hover:underline">Close</button>
                </div>
                <p className="text-xs text-gray-600 mb-3">
                  Turning a module off blocks it server-side, not just in the sidebar. Core
                  modules cannot be removed.
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                  {modules.map(mod => {
                    const enabled = getOrgModules(focusOrg.id).includes(mod.key);
                    return (
                      <label key={mod.id} className={cn(
                        "flex items-center gap-2 p-2 rounded-lg border text-xs",
                        enabled ? "bg-white border-green-200" : "bg-gray-50 border-gray-100",
                        mod.is_core ? "opacity-70 cursor-not-allowed" : "cursor-pointer"
                      )}>
                        <input
                          type="checkbox"
                          checked={enabled || mod.is_core}
                          disabled={mod.is_core}
                          onChange={e => toggleModule(focusOrg.id, mod.key, e.target.checked)}
                          className="w-3.5 h-3.5 rounded border-gray-300 text-[#C9A227] focus:ring-[#C9A227]"
                        />
                        <span className="font-medium text-gray-700 flex-1 truncate">{mod.name}</span>
                        {mod.is_core && <span className="text-[9px] text-gray-400">core</span>}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "school" && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle>School details & URLs</CardTitle>
              <select
                value={focusOrgId ?? ""}
                onChange={(e) => setFocusOrgId(e.target.value || null)}
                aria-label="Choose a school"
                className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white"
              >
                <option value="">Choose a school…</option>
                {orgs.map(o => (
                  <option key={o.id} value={o.id}>{o.name} ({o.slug})</option>
                ))}
              </select>
            </div>
          </CardHeader>
          <CardContent>
            {focusOrg ? (
              <SchoolUrlsPanel org={focusOrg} />
            ) : (
              <div className="py-12 text-center">
                <ExternalLink size={32} className="mx-auto text-gray-300 mb-3" />
                <p className="text-sm text-gray-500 mb-1">Pick a school to see its public URLs.</p>
                <p className="text-xs text-gray-400">
                  Each school has a public website, a staff portal, and a login for students &amp; parents.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "school" && focusOrg && (
        <SeedDataPanel focusOrgId={focusOrg.id} />
      )}

      {tab === "members" && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle>Membership</CardTitle>
              <select
                value={focusOrgId ?? ""}
                onChange={(e) => setFocusOrgId(e.target.value || null)}
                aria-label="Choose a school"
                className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white"
              >
                <option value="">Choose a school…</option>
                {orgs.map(o => (
                  <option key={o.id} value={o.id}>
                    {o.name} ({memberCounts[o.id] ?? 0})
                  </option>
                ))}
              </select>
            </div>
          </CardHeader>
          <CardContent>
            {focusOrg ? (
              <OrgMembersPanel
                orgId={focusOrg.id}
                orgName={focusOrg.name}
                onChanged={load}
              />
            ) : (
              <div className="py-12 text-center">
                <Users size={32} className="mx-auto text-gray-300 mb-3" />
                <p className="text-sm text-gray-500 mb-1">Pick a school to manage its people.</p>
                <p className="text-xs text-gray-400">
                  To test isolation: create a second school, assign a user to it, then sign in
                  as that user.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "modules" && (
        <Card>
          <CardHeader><CardTitle>Module catalogue</CardTitle></CardHeader>
          <CardContent>
            <p className="text-xs text-gray-500 mb-4">
              Products available on the platform. Core modules are always on. Entitlements are
              per school and enforced by row-level security, so a school cannot grant itself a
              paid module.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b">
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Module</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Key</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Category</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Core</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Schools subscribed</th>
                  </tr>
                </thead>
                <tbody>
                  {modules.map(mod => {
                    const subCount = subscriptions.filter(
                      s => s.module_key === mod.key && s.status === "active"
                    ).length;
                    return (
                      <tr key={mod.id} className="border-b last:border-0 hover:bg-gray-50">
                        <td className="px-3 py-2 font-medium flex items-center gap-1.5">
                          {mod.key === "website" && <Globe size={12} className="text-[#C9A227]" />}
                          {mod.name}
                        </td>
                        <td className="px-3 py-2 text-gray-500 font-mono text-xs">{mod.key}</td>
                        <td className="px-3 py-2 text-gray-500 text-xs">{mod.category || "—"}</td>
                        <td className="px-3 py-2">
                          {mod.is_core && <Badge variant="green">core</Badge>}
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

      {tab === "superadmins" && (
        <Card>
          <CardHeader>
            <CardTitle>Super Admins</CardTitle>
            <p className="text-xs text-gray-500 mt-1">
              Platform administrators can manage every school, entitlement, and other super
              admins. Manage names, credentials, and access here. Only super admins can see or
              use this.
            </p>
          </CardHeader>
          <CardContent>
            <SuperAdminsPanel />
          </CardContent>
        </Card>
      )}

      {showOrgModal && (
        <Modal
          open
          onClose={() => { setShowOrgModal(false); setEditingOrg(null); }}
          title={editingOrg ? `Edit ${editingOrg.name}` : "Provision a new school"}
          size="xl"
        >
          <div className="space-y-4">
            <Input
              label="School name"
              value={orgForm.name}
              onChange={e => setOrgForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Greenfield Academy"
            />
            <Input
              label="Slug"
              value={orgForm.slug}
              onChange={e => setOrgForm(f => ({ ...f, slug: e.target.value }))}
              placeholder="greenfield-academy"
              helpText={
                (() => {
                  const preview = previewSlug(orgForm.slug, orgForm.name);
                  const base = "Used for the school's site address. Left blank, it is derived from the name.";
                  return orgForm.slug.trim() && preview !== orgForm.slug.trim()
                    ? `${base} Will be saved as "${preview}".`
                    : base;
                })()
              }
            />
            <Input
              label="Contact email"
              type="email"
              value={orgForm.email}
              onChange={e => setOrgForm(f => ({ ...f, email: e.target.value }))}
              placeholder="admin@greenfield.edu"
            />

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="plan" className="block text-sm font-medium text-gray-700 mb-1">Plan</label>
                <select id="plan" value={orgForm.plan}
                  onChange={e => setOrgForm(f => ({ ...f, plan: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#C9A227]">
                  <option value="starter">Starter</option>
                  <option value="standard">Standard</option>
                  <option value="premium">Premium</option>
                  <option value="enterprise">Enterprise</option>
                </select>
              </div>
              <div>
                <label htmlFor="status" className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                <select id="status" value={orgForm.status}
                  onChange={e => setOrgForm(f => ({ ...f, status: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#C9A227]">
                  <option value="trial">Trial</option>
                  <option value="active">Active</option>
                  <option value="suspended">Suspended</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
            </div>

            {!editingOrg && (
              <>
                <Input
                  label="Owner email (optional)"
                  type="email"
                  value={orgForm.owner_email}
                  onChange={e => setOrgForm(f => ({ ...f, owner_email: e.target.value }))}
                  placeholder="principal@greenfield.edu"
                  helpText="Must already have an account. They become the school owner immediately."
                />
                <Input
                  label="Auto-join email domain (optional)"
                  value={orgForm.email_domain}
                  onChange={e => setOrgForm(f => ({ ...f, email_domain: e.target.value }))}
                  placeholder="greenfield.edu"
                  helpText="New signups with this email domain join this school automatically as staff."
                />
                <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-800">
                  Provisioning creates the school with its own roles, settings, and core
                  module entitlements in a single transaction.
                </div>
              </>
            )}

            {formError && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                <AlertTriangle size={14} className="mt-px shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" onClick={() => { setShowOrgModal(false); setEditingOrg(null); }}>
                Cancel
              </Button>
              <Button variant="gold" loading={saving} onClick={saveOrg} disabled={!orgForm.name.trim()}>
                {editingOrg ? "Save changes" : "Provision school"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}


/**
 * Per-school detail card: renders the four canonical URLs so a
 * super-admin can copy or open them for a specific school
 * without leaving the platform admin surface.
 *
 * URL sources:
 *   • Public website:     /s/<slug>            (route src/app/s/[slug]/[[...path]]/)
 *   • Staff login:        /s/<slug>/staff-portal
 *   • Student/parent login: /s/<slug>/login    (persona tab in the form)
 *   • Custom domain:      populated from website_domains where is_primary AND verified.
 *
 * The origin for absolute URLs is the current window origin, with
 * an override via NEXT_PUBLIC_PLATFORM_HOST if the school has a
 * subdomain-style deployment. The panel gracefully degrades to
 * relative paths if we're on the server (SSR) or window is
 * unavailable.
 */
function SchoolUrlsPanel({ org }: { org: OrgRow }) {
  const [primaryDomain, setPrimaryDomain] = useState<string | null>(null);
  const supabaseClient = useMemo(() => createClient(), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabaseClient
        .from("website_domains")
        .select("hostname")
        .eq("organization_id", org.id)
        .eq("is_primary", true)
        .eq("verified", true)
        .maybeSingle();
      if (!cancelled) {
        const row = data as { hostname?: string } | null;
        setPrimaryDomain(row?.hostname ?? null);
      }
    })();
    return () => { cancelled = true; };
  }, [supabaseClient, org.id]);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const platformHost = process.env.NEXT_PUBLIC_PLATFORM_HOST || "";
  const subdomainRoot = platformHost && origin
    ? `${origin.startsWith("https") ? "https" : "http"}://${org.slug}.${platformHost}`
    : "";

  const urls: Array<{ label: string; path: string; url: string; note?: string; kind: "site" | "staff" | "login" | "domain" }> = [
    {
      label: "Public website",
      path: `/s/${org.slug}`,
      url: `${origin}/s/${org.slug}`,
      kind: "site",
      note: "The school's public brochure. Editable in Website Studio.",
    },
    {
      label: "Staff / teacher portal",
      path: `/s/${org.slug}/staff-portal`,
      url: `${origin}/s/${org.slug}/staff-portal`,
      kind: "staff",
      note: "Staff sign-in — teachers, bursars, admins.",
    },
    {
      label: "Student & parent login",
      path: `/s/${org.slug}/login`,
      url: `${origin}/s/${org.slug}/login`,
      kind: "login",
      note: "One page with a Student / Parent persona tab.",
    },
  ];
  if (subdomainRoot) {
    urls.push({
      label: "Subdomain",
      path: `${org.slug}.${platformHost}`,
      url: subdomainRoot,
      kind: "domain",
      note: `Set NEXT_PUBLIC_PLATFORM_HOST to route ${org.slug} at this subdomain.`,
    });
  }
  if (primaryDomain) {
    urls.push({
      label: "Primary custom domain",
      path: primaryDomain,
      url: `https://${primaryDomain}`,
      kind: "domain",
      note: "Verified custom hostname configured in Website Studio → Domains.",
    });
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // clipboard blocked — best-effort only, users can select and Ctrl+C.
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm">
        <Building2 size={16} className="text-[#0F2A47] mt-0.5" />
        <div>
          <div className="font-semibold text-[#0F2A47]">{org.name}</div>
          <div className="text-xs text-gray-500 font-mono">{org.slug}</div>
        </div>
      </div>

      <div className="grid gap-3">
        {urls.map(u => (
          <div key={u.label} className="rounded-lg border border-gray-200 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
              <div className="font-medium text-sm text-[#0F2A47]">{u.label}</div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => copy(u.url)}
                  className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-[#0F2A47]"
                >
                  <Copy size={12} /> Copy
                </button>
                <a
                  href={u.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-[#C9A227] hover:underline"
                >
                  <ExternalLink size={12} /> Open
                </a>
              </div>
            </div>
            <div className="font-mono text-xs text-gray-500 break-all">{u.url}</div>
            {u.note && <div className="text-xs text-gray-400 mt-1">{u.note}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
