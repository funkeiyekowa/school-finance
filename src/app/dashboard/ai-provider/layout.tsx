import { requireDashboardAccess } from "@/lib/api/requireDashboardAccess";

export default async function AiProviderLayout({ children }: { children: React.ReactNode }) {
  await requireDashboardAccess({ adminOnly: true });
  return children;
}
