import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  DollarSign,
  GraduationCap,
  Globe,
  Settings,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";

const readinessItems = [
  {
    href: "/dashboard/setup",
    title: "Complete the school profile",
    description: "Review school details, the current term and year, and receipt settings in School Settings.",
    action: "Open school setup",
    icon: Settings,
  },
  {
    href: "/dashboard/roles",
    title: "Review roles and access",
    description: "Confirm role presets and feature permissions before inviting more staff to the workspace.",
    action: "Review permissions",
    icon: ShieldCheck,
  },
  {
    href: "/dashboard/students",
    title: "Build the student roster",
    description: "Add students individually or use the existing bulk import workflow to prepare the roster.",
    action: "Open student records",
    icon: GraduationCap,
  },
  {
    href: "/dashboard/setup",
    title: "Set the academic structure",
    description: "Use Academic Setup to review terms, classes, subjects, and the structure used across the school.",
    action: "Open academic setup",
    icon: BookOpen,
  },
  {
    href: "/dashboard/website",
    title: "Prepare the school website",
    description: "Use Website Studio to complete branding, pages, news, events, and public school information.",
    action: "Open Website Studio",
    icon: Globe,
  },
  {
    href: "/dashboard/setup",
    title: "Configure fee schedules",
    description: "Use the existing Fee Schedule setup to define the charges that apply to students and classes.",
    action: "Open fee setup",
    icon: DollarSign,
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
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#8A6D1A]">Admin onboarding</p>
              <h2 className="mt-0.5 font-semibold text-[#0F2A47]">Recommended next steps</h2>
              <p className="mt-0.5 text-xs text-gray-500">
                Work through the existing setup areas that prepare your school for staff, students, and families.
              </p>
            </div>
          </div>
          <span className="rounded-full border border-[#C9A227]/30 bg-white px-3 py-1 text-xs font-medium text-gray-500">
            Guidance only — nothing changes automatically
          </span>
        </div>

        <div className="grid gap-px bg-gray-100 sm:grid-cols-2 xl:grid-cols-3">
          {readinessItems.map(({ href, title, description, action, icon: Icon }, index) => (
            <Link
              key={title}
              href={href}
              className="group flex min-h-40 flex-col bg-white px-5 py-4 transition-colors hover:bg-[#FBF6E8]"
            >
              <span className="flex items-center justify-between">
                <span className="rounded-lg bg-[#C9A227]/10 p-2 text-[#8A6D1A] transition-colors group-hover:bg-[#C9A227]/20">
                  <Icon size={17} />
                </span>
                <span className="text-[11px] font-bold tracking-[0.12em] text-gray-300">
                  {String(index + 1).padStart(2, "0")}
                </span>
              </span>
              <span className="mt-3 text-sm font-semibold text-[#0F2A47]">{title}</span>
              <span className="mt-1 block flex-1 text-xs leading-5 text-gray-500">{description}</span>
              <span className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-[#8A6D1A]">
                {action}
                <ArrowRight size={13} className="transition-transform group-hover:translate-x-0.5" />
              </span>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
