import { requireDashboardAccess } from "@/lib/api/requireDashboardAccess";
import { ModuleGuard } from "@/lib/guards/module-guard";
import { RoleGuard, FINANCE_ROLES } from "@/lib/guards/role-guard";

export default async function PayrollLayout({ children }: { children: React.ReactNode }) {
  await requireDashboardAccess({ roles: ["owner", "admin", "editor", "bursar", "accountant", "developer", "super_admin"], permissions: ["finance_overview", "payroll"] });
  return <ModuleGuard module="payroll"><RoleGuard allowedRoles={FINANCE_ROLES}>{children}</RoleGuard></ModuleGuard>;
}
