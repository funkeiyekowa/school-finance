import { requireDashboardAccess } from "@/lib/api/requireDashboardAccess";
import { ModuleGuard } from "@/lib/guards/module-guard";
import { RoleGuard, FINANCE_ROLES } from "@/lib/guards/role-guard";
export default async function SmsAlertsLayout({ children }: { children: React.ReactNode }) { await requireDashboardAccess({ permissions: ["sms_alerts"] }); return <ModuleGuard module="finance"><RoleGuard allowedRoles={FINANCE_ROLES} feature="sms_alerts">{children}</RoleGuard></ModuleGuard>; }
