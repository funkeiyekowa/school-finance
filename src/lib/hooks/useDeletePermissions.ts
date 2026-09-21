"use client";

/**
 * Delete-permissions hook.
 *
 * Two levels of destructive action across the app:
 *   - DELETE (single-row or bulk-selected): permitted for super_admin
 *     always, and for org admin/owner only when the super_admin has
 *     enabled that entity type on the Delete Permissions setup page.
 *   - PURGE (delete every row in the caller's org): super_admin only.
 *
 * Reads its per-org toggle map from public.admin_delete_permissions
 * (see supabase/admin_delete_permissions.sql).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";

export const DELETABLE_ENTITIES = [
  { key: "students",       label: "Students" },
  { key: "attendance",     label: "Attendance records" },
  { key: "exams",          label: "Exams" },
  { key: "questions",      label: "Question bank" },
  { key: "violation_log",  label: "CBT violation log" },
  { key: "income",         label: "Income entries" },
  { key: "expenses",       label: "Expense entries" },
  { key: "receipts",       label: "Receipts (income rows)" },
  { key: "sms_alerts",     label: "Payment SMS alerts" },
  { key: "payroll",        label: "Payroll runs" },
  { key: "salary",         label: "Salary components" },
  { key: "staff",          label: "Staff" },
  { key: "parents",        label: "Parents" },
  { key: "team",           label: "Team members" },
  { key: "vendors",        label: "Vendors" },
  { key: "inventory",      label: "Inventory items" },
  { key: "assets",         label: "Assets" },
  { key: "library",        label: "Library books" },
] as const;

export type DeletableEntityKey = (typeof DELETABLE_ENTITIES)[number]["key"];

export function useDeletePermissions() {
  const supabase = useMemo(() => createClient(), []);
  const { orgId, isSuperAdmin, isOrgAdmin } = useAuth();
  const [permissions, setPermissions] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!orgId) { setLoading(false); return; }
    const { data } = await supabase
      .from("admin_delete_permissions")
      .select("permissions")
      .eq("organization_id", orgId)
      .maybeSingle();
    setPermissions((data?.permissions as Record<string, boolean>) ?? {});
    setLoading(false);
  }, [orgId, supabase]);

  useEffect(() => { load(); }, [load]);

  const canDelete = useCallback(
    (key: DeletableEntityKey) => {
      if (isSuperAdmin) return true;
      if (isOrgAdmin) return permissions[key] === true;
      return false;
    },
    [isSuperAdmin, isOrgAdmin, permissions]
  );

  // Purge is a super-admin-only operation across every entity.
  const canPurge = useCallback(() => isSuperAdmin, [isSuperAdmin]);

  return { canDelete, canPurge, permissions, loading, refresh: load };
}
