"use client";
import { ModuleGuard } from "@/lib/guards/module-guard";
import { RoleGuard, FINANCE_ROLES } from "@/lib/guards/role-guard";
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <ModuleGuard module="finance">
      <RoleGuard allowedRoles={FINANCE_ROLES} feature="student_finance">{children}</RoleGuard>
    </ModuleGuard>
  );
}
