import { requireDashboardAccess } from "@/lib/api/requireDashboardAccess";

export default async function AiAssistantSettingsLayout({ children }: { children: React.ReactNode }) {
  await requireDashboardAccess({ adminOnly: true });
  return children;
}
