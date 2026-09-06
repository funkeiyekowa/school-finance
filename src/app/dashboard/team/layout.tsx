import { requireDashboardAccess } from "@/lib/api/requireDashboardAccess";

export default async function TeamLayout({ children }: { children: React.ReactNode }) {
  await requireDashboardAccess({ adminOnly: true });
  return children;
}
