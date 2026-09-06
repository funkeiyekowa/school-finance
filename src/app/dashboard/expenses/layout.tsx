import { requireDashboardAccess } from "@/lib/api/requireDashboardAccess";
import { ModuleGuard } from "@/lib/guards/module-guard";
import { RoleGuard, FINANCE_ROLES } from "@/lib/guards/role-guard";
export default async function ExpensesLayout({ children }: { children: React.ReactNode }) { await requireDashboardAccess({ permissions: ["expenses"] }); return <ModuleGuard module="finance"><RoleGuard allowedRoles={FINANCE_ROLES} feature="expenses">{children}</RoleGuard></ModuleGuard>; }
