import { requireDashboardAccess } from "@/lib/api/requireDashboardAccess";
import { ModuleGuard } from "@/lib/guards/module-guard";

export default async function AssetsLayout({ children }: { children: React.ReactNode }) {
  await requireDashboardAccess({ roles: ["owner", "admin", "editor", "staff", "bursar", "accountant", "developer", "super_admin"], permissions: ["inventory"] });
  return <ModuleGuard module="assets">{children}</ModuleGuard>;
}
