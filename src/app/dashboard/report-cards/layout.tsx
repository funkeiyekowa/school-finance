import { ModuleGuard } from "@/lib/guards/module-guard";

export default function ReportCardsLayout({ children }: { children: React.ReactNode }) {
  return <ModuleGuard module="academics">{children}</ModuleGuard>;
}
