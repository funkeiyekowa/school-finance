import Link from "next/link";
import {
  ArrowUpRight,
  GraduationCap,
  Settings,
  ShieldCheck,
  Sparkles,
  Globe,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";

const readinessLinks = [
  {
    href: "/dashboard/setup",
    label: "School setup",
    description: "Terms, classes, subjects, and core settings",
    icon: Settings,
  },
  {
    href: "/dashboard/roles",
    label: "Roles and access",
    description: "Review role presets and feature permissions",
    icon: ShieldCheck,
  },
  {
    href: "/dashboard/students",
    label: "Student import",
    description: "Open the existing roster and import workflow",
    icon: GraduationCap,
  },
  {
    href: "/dashboard/website",
    label: "Website Studio",
    description: "Complete branding, pages, news, and events",
    icon: Globe,
  },
] as const;

export function AdminReadinessCard() {
  return (
    <Card className="overflow-hidden border-[#C9A227]/30 bg-gradient-to-br from-[#FFFCF3] to-white">
      <CardContent className="p-0">
        <div className="flex flex-col gap-3 border-b border-[#C9A227]/20 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-lg bg-[#C9A227]/15 p-2 text-[#8A6D1A]">
              <Sparkles size={18} />
            </div>
            <div>
              <h2 className="font-semibold text-[#0F2A47]">School readiness</h2>
              <p className="mt-0.5 text-xs text-gray-500">
                Review the existing setup areas that prepare your school for staff, students, and families.
              </p>
            </div>
          </div>
          <span className="text-xs font-medium text-gray-400">Shortcuts only — nothing changes automatically</span>
        </div>

        <div className="grid gap-px bg-gray-100 sm:grid-cols-2 xl:grid-cols-4">
          {readinessLinks.map(({ href, label, description, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="group flex min-h-28 items-start gap-3 bg-white px-5 py-4 transition-colors hover:bg-[#FBF6E8]"
            >
              <Icon size={17} className="mt-0.5 shrink-0 text-[#C9A227]" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-[#0F2A47]">
                  {label}
                  <ArrowUpRight size={13} className="opacity-40 transition-opacity group-hover:opacity-100" />
                </span>
                <span className="mt-1 block text-xs leading-5 text-gray-500">{description}</span>
              </span>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
