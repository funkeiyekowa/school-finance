import { ModuleGuard } from "@/lib/guards/module-guard";

export default function ParentPortalLayout({ children }: { children: React.ReactNode }) {
  return <ModuleGuard module="parent_portal">{children}</ModuleGuard>;
}
