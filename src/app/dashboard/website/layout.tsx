import { ModuleGuard } from "@/lib/guards/module-guard";

export default function WebsiteLayout({ children }: { children: React.ReactNode }) {
  return <ModuleGuard module="website">{children}</ModuleGuard>;
}
