import { requireDashboardAccess } from "@/lib/api/requireDashboardAccess";
import { ModuleGuard } from "@/lib/guards/module-guard";
import { RoleGuard, FINANCE_ROLES } from "@/lib/guards/role-guard";
export default async function IncomeLayout({ children }: { children: React.ReactNode }) { await requireDashboardAccess({ permissions: ["income"] }); return <ModuleGuard module="finance"><RoleGuard allowedRoles={FINANCE_ROLES} feature="income">{children}</RoleGuard></ModuleGuard>; }
