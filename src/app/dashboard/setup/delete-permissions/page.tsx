"use client";

/**
 * Delete Permissions setup — super-admin only.
 *
 * Controls which entity types the ordinary org admins may bulk-delete.
 * Purge (delete all rows) is always super-admin-only; this page only
 * toggles what admins can do in the "Delete N selected" flow.
 *
 * Reads/writes public.admin_delete_permissions (row per org, JSONB map).
 * RLS on that table restricts writes to super_admin/platform_admin.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { useToast } from "@/lib/hooks/useToast";
import { DELETABLE_ENTITIES, type DeletableEntityKey } from "@/lib/hooks/useDeletePermissions";
import { PageHeader, LoadingSpinner } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ShieldCheck, Trash2, Save, CheckSquare, Square } from "lucide-react";

export default function DeletePermissionsPage() {
  const supabase = useMemo(() => createClient(), []);
  const { orgId, isSuperAdmin, profile } = useAuth();
  const { notify, ToastHost } = useToast();

  const [permissions, setPermissions] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) return;
    const { data } = await supabase
      .from("admin_delete_permissions")
      .select("permissions, updated_at")
      .eq("organization_id", orgId)
      .maybeSingle();
    setPermissions((data?.permissions as Record<string, boolean>) ?? {});
    setLoading(false);
  }, [orgId, supabase]);

  useEffect(() => { load(); }, [load]);

  if (!isSuperAdmin) {
    return (
      <div className="p-6">
        <Card>
          <div className="p-6 text-sm text-gray-500">
            Only super-admins can configure delete permissions for this school.
          </div>
        </Card>
      </div>
    );
  }

  function toggle(key: DeletableEntityKey) {
    setPermissions((p) => ({ ...p, [key]: !p[key] }));
    setDirty(true);
  }

  function setAll(value: boolean) {
    const next: Record<string, boolean> = {};
    for (const e of DELETABLE_ENTITIES) next[e.key] = value;
    setPermissions(next);
    setDirty(true);
  }

  async function save() {
    if (!orgId) return;
    setSaving(true);
    const { error } = await supabase
      .from("admin_delete_permissions")
      .upsert({
        organization_id: orgId,
        permissions,
        updated_at: new Date().toISOString(),
        updated_by: profile?.id ?? null,
      }, { onConflict: "organization_id" });
    setSaving(false);
    if (error) {
      notify(`Save failed: ${error.message}`, "error");
      return;
    }
    setDirty(false);
    notify("Delete permissions saved.");
  }

  const enabledCount = DELETABLE_ENTITIES.filter((e) => permissions[e.key]).length;

  return (
    <div className="p-6 space-y-5">
      <ToastHost />
      <PageHeader
        icon={<ShieldCheck size={24} />}
        gradient="rose"
        title="Delete Permissions"
        subtitle="Choose which record types your admins can bulk-delete. Purging (deleting every row) always stays super-admin only."
      >
        <Button size="sm" variant="secondary" onClick={() => setAll(true)}>
          <CheckSquare size={14} /> Enable all
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setAll(false)}>
          <Square size={14} /> Disable all
        </Button>
        <Button size="sm" onClick={save} loading={saving} disabled={!dirty}>
          <Save size={14} /> Save changes
        </Button>
      </PageHeader>

      {loading ? <LoadingSpinner /> : (
        <>
          <Card>
            <div className="p-4 border-b border-gray-100 flex items-center justify-between text-sm">
              <div>
                <span className="font-semibold text-[#0F2A47]">{enabledCount}</span>
                <span className="text-gray-500"> of {DELETABLE_ENTITIES.length} record types enabled for admin delete</span>
              </div>
              <div className="text-xs text-gray-500 flex items-center gap-1.5">
                <Trash2 size={13} className="text-red-600" />
                Purge (all rows) is always super-admin only
              </div>
            </div>

            <div className="divide-y divide-gray-100">
              {DELETABLE_ENTITIES.map((entity) => {
                const enabled = !!permissions[entity.key];
                return (
                  <label
                    key={entity.key}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={() => toggle(entity.key)}
                      className="accent-[#0F2A47] w-4 h-4"
                    />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-[#0F2A47]">{entity.label}</div>
                      <div className="text-xs text-gray-500 font-mono">{entity.key}</div>
                    </div>
                    <span className={enabled
                      ? "text-xs font-semibold text-green-700 bg-green-50 px-2 py-0.5 rounded"
                      : "text-xs font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded"}>
                      {enabled ? "Admins may delete" : "Super-admin only"}
                    </span>
                  </label>
                );
              })}
            </div>
          </Card>

          <Card>
            <div className="p-4 text-xs text-gray-500 space-y-2">
              <p>
                <strong className="text-gray-700">How this works.</strong> The list pages
                (Students, Income, Expenses, SMS Alerts, Staff, Vendors, etc.) render row
                checkboxes and a &quot;Delete N selected&quot; control only when the
                caller is a super-admin, or an org admin/owner AND the matching record
                type above is enabled. Purge (&quot;delete every row in this org&quot;)
                stays super-admin only regardless of the toggles.
              </p>
              <p>
                Row-level Postgres policies remain in place — this is a UI gate on top of
                the database&apos;s existing authorization. Individual rows still fail to
                delete if the caller lacks the underlying role permission
                (<code className="font-mono">phase1_hr_access</code>,
                <code className="font-mono"> phase1_finance_access</code>, etc.).
              </p>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
