import { requireDashboardAccess } from "@/lib/api/requireDashboardAccess";
import { ModuleGuard } from "@/lib/guards/module-guard";
import { RoleGuard, FINANCE_ROLES } from "@/lib/guards/role-guard";
export default async function ReceiptsLayout({ children }: { children: React.ReactNode }) { await requireDashboardAccess({ permissions: ["receipts"] }); return <ModuleGuard module="finance"><RoleGuard allowedRoles={FINANCE_ROLES} feature="receipts">{children}</RoleGuard></ModuleGuard>; }
