"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, BookOpenCheck, ClipboardCheck, LibraryBig } from "lucide-react";
import { ModuleGuard } from "@/lib/guards/module-guard";
import { cn } from "@/lib/utils";

const links = [
  { href: "/dashboard/teaching", label: "My Teaching", icon: BookOpen },
  { href: "/dashboard/teaching/grading", label: "Grading Queue", icon: ClipboardCheck },
  { href: "/dashboard/teaching/rubrics", label: "Rubric Studio", icon: BookOpenCheck },
  { href: "/dashboard/lms", label: "Courses", icon: LibraryBig },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <ModuleGuard module="teacher_portal">
      <div className="border-b border-slate-200 bg-white px-6 pt-3">
        <nav className="flex gap-1 overflow-x-auto" aria-label="Teaching workspace">
          {links.map(({ href, label, icon: Icon }) => {
            const active = href === "/dashboard/teaching" ? pathname === href : pathname.startsWith(href);
            return <Link key={href} href={href} className={cn("inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-xs font-semibold", active ? "border-[#C9A227] text-[#0F2A47]" : "border-transparent text-slate-500 hover:text-[#0F2A47]")}><Icon size={13} />{label}</Link>;
          })}
        </nav>
      </div>
      {children}
    </ModuleGuard>
  );
}
