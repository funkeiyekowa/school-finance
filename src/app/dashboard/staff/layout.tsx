import { requireDashboardAccess } from "@/lib/api/requireDashboardAccess";
import { ModuleGuard } from "@/lib/guards/module-guard";
import { RoleGuard, STAFF_MANAGEMENT_ROLES } from "@/lib/guards/role-guard";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  await requireDashboardAccess({ roles: ["owner", "admin", "editor", "bursar", "accountant", "developer", "super_admin"], adminOnly: true });
  return <ModuleGuard module="hr"><RoleGuard allowedRoles={STAFF_MANAGEMENT_ROLES}>{children}</RoleGuard></ModuleGuard>;
}
