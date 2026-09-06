import { requireDashboardAccess } from "@/lib/api/requireDashboardAccess";

export default async function MyCoursesLayout({ children }: { children: React.ReactNode }) {
  await requireDashboardAccess({ roles: ["student"] });
  return children;
}
