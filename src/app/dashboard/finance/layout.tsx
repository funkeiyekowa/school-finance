import { requireDashboardAccess } from "@/lib/api/requireDashboardAccess";
import { ModuleGuard } from "@/lib/guards/module-guard";
import { RoleGuard, FINANCE_ROLES } from "@/lib/guards/role-guard";

export default async function FinanceLayout({ children }: { children: React.ReactNode }) {
  await requireDashboardAccess({ roles: ["owner", "admin", "editor", "bursar", "accountant", "developer", "super_admin"], permissions: ["finance_overview"] });
  return <ModuleGuard module="finance"><RoleGuard allowedRoles={FINANCE_ROLES} feature="finance_overview">{children}</RoleGuard></ModuleGuard>;
}
