import { ModuleGuard } from "@/lib/guards/module-guard";

export default function StudentPortalLayout({ children }: { children: React.ReactNode }) {
  return <ModuleGuard module="student_portal">{children}</ModuleGuard>;
}
