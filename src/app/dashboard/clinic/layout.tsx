import { requireDashboardAccess } from "@/lib/api/requireDashboardAccess";
import { ModuleGuard } from "@/lib/guards/module-guard";

export default async function ClinicLayout({ children }: { children: React.ReactNode }) {
  await requireDashboardAccess({ roles: ["owner", "admin", "editor", "staff", "developer", "super_admin"] });
  return <ModuleGuard module="clinic">{children}</ModuleGuard>;
}
