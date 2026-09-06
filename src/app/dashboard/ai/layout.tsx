import { requireDashboardAccess } from "@/lib/api/requireDashboardAccess";

export default async function AiLayout({ children }: { children: React.ReactNode }) {
  await requireDashboardAccess({ roles: ["owner", "admin", "editor", "staff", "bursar", "accountant", "teacher", "developer", "super_admin"] });
  return children;
}
