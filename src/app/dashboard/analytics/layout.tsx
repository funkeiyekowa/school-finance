"use client";
import { RoleGuard } from "@/lib/guards/role-guard";
export default function Layout({ children }: { children: React.ReactNode }) {
  // Analytics is admin-only in the nav (school-wide aggregates). Only org
  // admins/owners and platform super admins may view it.
  return <RoleGuard allowedRoles={[]} adminBlocksThrough={true}>{children}</RoleGuard>;
}
