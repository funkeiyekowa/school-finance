"use client";
import { ModuleGuard } from "@/lib/guards/module-guard";
export default function Layout({ children }: { children: React.ReactNode }) {
  return <ModuleGuard module="communication">{children}</ModuleGuard>;
}
