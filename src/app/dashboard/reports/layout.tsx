"use client";
import { RoleGuard, FINANCE_ROLES } from "@/lib/guards/role-guard";
export default function Layout({ children }: { children: React.ReactNode }) {
  // Reports are finance/management output. Allow finance roles + editor/viewer
  // roles that carry the `reports` feature; admins pass automatically.
  return (
    <RoleGuard allowedRoles={[...FINANCE_ROLES, "editor", "viewer", "staff"]} feature="reports">
      {children}
    </RoleGuard>
  );
}
