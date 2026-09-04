"use client";

/**
 * Role / Feature Access Guard
 *
 * Complements ModuleGuard (which checks whether the ORGANIZATION has a
 * module enabled). RoleGuard checks whether the CURRENT USER's role — or a
 * feature permission granted to that role — is allowed to view a page.
 *
 * This is the client-side enforcement layer that blocks direct-URL access
 * to a page whose sidebar link is hidden for the user's role. It is NOT a
 * substitute for server-side RLS/API authorization (which remains the
 * authoritative backstop); it prevents the page shell, headers, tables and
 * action buttons from ever rendering for a role that shouldn't see them —
 * closing the gap where RLS merely returned empty data behind a fully
 * rendered finance/admin screen.
 *
 * Precedence (a user passes if ANY of these is true):
 *   1. Platform super admin — always allowed (administers every school).
 *   2. Org admin/owner (isAdmin) — allowed unless `adminBlocksThrough` is
 *      false (used only for super-admin-only pages).
 *   3. The user's active-org role is in `allowedRoles`.
 *   4. `feature` is set and the user's permissions grant that feature.
 *
 * Usage (preferred: in a folder layout.tsx so it also blocks direct URLs):
 *   export default function Layout({ children }) {
 *     return <RoleGuard allowedRoles={FINANCE_ROLES}>{children}</RoleGuard>;
 *   }
 */

import { useAuth } from "@/lib/context/AuthContext";
import { useRouter } from "next/navigation";
import { ShieldAlert } from "lucide-react";

/** The roles that may operate finance screens (income, expenses, etc.). */
export const FINANCE_ROLES = ["owner", "admin", "bursar", "accountant", "developer"];

/** Roles that may see school-wide academic/operational management screens. */
export const STAFF_MANAGEMENT_ROLES = ["owner", "admin", "editor", "staff", "bursar", "accountant", "teacher", "developer"];

interface RoleGuardProps {
  children: React.ReactNode;
  /** Active-org roles allowed to view. Empty/undefined = any signed-in user. */
  allowedRoles?: string[];
  /** If set, a user whose permissions grant this feature is also allowed. */
  feature?: string;
  /** Require platform super admin specifically (ignores allowedRoles). */
  superAdminOnly?: boolean;
  /** When false, org admins/owners do NOT automatically pass (default true). */
  adminBlocksThrough?: boolean;
  /** Where to send a denied user (default: /dashboard). */
  redirectTo?: string;
}

export function RoleGuard({
  children,
  allowedRoles,
  feature,
  superAdminOnly = false,
  adminBlocksThrough = true,
  redirectTo = "/dashboard",
}: RoleGuardProps) {
  const { loading, membership, isSuperAdmin, isAdmin, hasFeature } = useAuth();
  const router = useRouter();

  if (loading) return null;

  const role = membership?.role ?? "";

  const allowed = (() => {
    if (isSuperAdmin) return true;              // platform admin sees everything
    if (superAdminOnly) return false;           // page is super-admin only
    if (adminBlocksThrough && isAdmin) return true;
    if (allowedRoles && allowedRoles.includes(role)) return true;
    if (feature && hasFeature(feature)) return true;
    if (!allowedRoles && !feature) return true; // no constraint given
    return false;
  })();

  if (!allowed) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[60vh]">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-50 flex items-center justify-center">
            <ShieldAlert className="w-8 h-8 text-red-500" />
          </div>
          <h2 className="text-lg font-bold text-gray-900 mb-2">Access Restricted</h2>
          <p className="text-sm text-gray-600 mb-4">
            You don&apos;t have permission to view this page. If you believe this is a
            mistake, contact your school administrator.
          </p>
          <button
            onClick={() => router.push(redirectTo)}
            className="px-4 py-2 bg-[#0F2A47] text-white rounded-lg text-sm font-medium hover:bg-[#1B3E63] transition-colors"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
