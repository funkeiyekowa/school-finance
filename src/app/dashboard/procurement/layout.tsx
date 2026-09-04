"use client";
import { ModuleGuard } from "@/lib/guards/module-guard";
import { RoleGuard, STAFF_MANAGEMENT_ROLES } from "@/lib/guards/role-guard";
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <ModuleGuard module="procurement">
      <RoleGuard allowedRoles={STAFF_MANAGEMENT_ROLES}>{children}</RoleGuard>
    </ModuleGuard>
  );
}
