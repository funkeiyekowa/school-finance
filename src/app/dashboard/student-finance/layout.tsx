import { requireDashboardAccess } from "@/lib/api/requireDashboardAccess";
import { ModuleGuard } from "@/lib/guards/module-guard";
import { RoleGuard, FINANCE_ROLES } from "@/lib/guards/role-guard";
export default async function StudentFinanceLayout({ children }: { children: React.ReactNode }) { await requireDashboardAccess({ roles: ["owner", "admin", "editor", "bursar", "accountant", "developer", "super_admin"], permissions: ["student_finance"] }); return <ModuleGuard module="finance"><RoleGuard allowedRoles={FINANCE_ROLES} feature="student_finance">{children}</RoleGuard></ModuleGuard>; }
