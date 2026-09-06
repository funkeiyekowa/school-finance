import { requireDashboardAccess } from "@/lib/api/requireDashboardAccess";
import { ModuleGuard } from "@/lib/guards/module-guard";

export default async function LmsLayout({ children }: { children: React.ReactNode }) {
  await requireDashboardAccess({ roles: ["owner", "admin", "editor", "staff", "teacher", "developer", "super_admin"] });
  return <ModuleGuard module="lms">{children}</ModuleGuard>;
}
