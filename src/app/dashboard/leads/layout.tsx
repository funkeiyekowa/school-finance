import { ModuleGuard } from "@/lib/guards/module-guard";

export default function LeadsLayout({ children }: { children: React.ReactNode }) {
  return <ModuleGuard module="crm">{children}</ModuleGuard>;
}
