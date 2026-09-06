import { requireDashboardAccess } from "@/lib/api/requireDashboardAccess";

export default async function RolesLayout({ children }: { children: React.ReactNode }) {
  await requireDashboardAccess({ adminOnly: true });
  return children;
}
