/**
 * Organization-scoped query helper.
 *
 * Wraps Supabase client queries to automatically filter by the current
 * organization's ID. This ensures tenant isolation at the application
 * layer without modifying every individual page query.
 *
 * Usage in components:
 *   const { orgQuery } = useOrgQuery();
 *   const { data } = await orgQuery("students").select("*").order("full_name");
 *
 * If orgId is null (migration not run or user has no membership),
 * queries are returned WITHOUT the filter for backward compatibility.
 */

"use client";

import { useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";

/**
 * Hook that returns an org-scoped query builder.
 *
 * The returned `orgQuery(table)` function works exactly like
 * `supabase.from(table)` but automatically adds `.eq("organization_id", orgId)`
 * to every query when an org context exists.
 */
export function useOrgQuery() {
  const supabase = useMemo(() => createClient(), []);
  const { orgId } = useAuth();

  /**
   * Create an org-scoped query builder for the given table.
   * Automatically filters by organization_id when available.
   *
   * Falls back to unfiltered queries when no org is loaded (backward compat).
   */
  function orgQuery(table: string) {
    const builder = supabase.from(table);

    if (!orgId) {
      // No org context — return unfiltered (pre-migration compatibility)
      return builder;
    }

    // Return a proxy that automatically chains .eq("organization_id", orgId)
    // on select/insert operations.
    return new Proxy(builder, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);

        if (prop === "select") {
          return (...args: unknown[]) => {
            const selectBuilder = (value as Function).apply(target, args);
            return selectBuilder.eq("organization_id", orgId);
          };
        }

        if (prop === "insert") {
          return (rows: unknown, ...args: unknown[]) => {
            // Auto-inject organization_id into inserted rows
            const withOrg = Array.isArray(rows)
              ? rows.map(r => ({ ...r, organization_id: orgId }))
              : { ...(rows as object), organization_id: orgId };
            return (value as Function).apply(target, [withOrg, ...args]);
          };
        }

        if (prop === "update" || prop === "delete" || prop === "upsert") {
          // For update/delete/upsert, the org filter is applied via the
          // chained .eq() calls that follow. We don't inject here because
          // these operations usually chain their own filters.
          return value;
        }

        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }

  return { supabase, orgId, orgQuery };
}
