import { requireDashboardAccess } from "@/lib/api/requireDashboardAccess";
import { ModuleGuard } from "@/lib/guards/module-guard";
import { RoleGuard, STAFF_MANAGEMENT_ROLES } from "@/lib/guards/role-guard";

export default async function ProcurementLayout({ children }: { children: React.ReactNode }) {
  await requireDashboardAccess({ roles: ["owner", "admin", "editor", "staff", "bursar", "accountant", "developer", "super_admin"], permissions: ["inventory"] });
  return <ModuleGuard module="procurement"><RoleGuard allowedRoles={STAFF_MANAGEMENT_ROLES}>{children}</RoleGuard></ModuleGuard>;
}
