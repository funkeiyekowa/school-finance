"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/context/AuthContext";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, TrendingUp, TrendingDown, GraduationCap, Building2,
  ArrowLeftRight, FileBarChart, Receipt, Settings, Shield, Users,
  Activity, MessageSquare, Menu, X, LogOut, ChevronRight, Clock,
} from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  feature?: string;
  module?: string;       // Required module subscription
  adminOnly?: boolean;
  superAdminOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: <LayoutDashboard size={18} /> },
  { href: "/dashboard/income", label: "Income", icon: <TrendingUp size={18} />, feature: "income", module: "finance" },
  { href: "/dashboard/expenses", label: "Expenses", icon: <TrendingDown size={18} />, feature: "expenses", module: "finance" },
  { href: "/dashboard/students", label: "Students", icon: <GraduationCap size={18} />, feature: "students", module: "students" },
  { href: "/dashboard/students/promotion", label: "Promotion", icon: <ArrowLeftRight size={18} />, feature: "students", module: "academics", adminOnly: true },
  { href: "/dashboard/attendance", label: "Attendance", icon: <Users size={18} />, module: "attendance" },
  { href: "/dashboard/timetable", label: "Timetable", icon: <Clock size={18} />, module: "timetable" },
  { href: "/dashboard/vendors", label: "Vendors", icon: <Building2 size={18} />, feature: "vendors", module: "finance" },
  { href: "/dashboard/reconciliation", label: "Reconcile", icon: <ArrowLeftRight size={18} />, feature: "reconciliation", module: "finance" },
  { href: "/dashboard/reports", label: "Reports", icon: <FileBarChart size={18} />, feature: "reports" },
  { href: "/dashboard/receipts", label: "Receipts", icon: <Receipt size={18} />, feature: "receipts", module: "finance" },
  { href: "/dashboard/sms-alerts", label: "Payment Alerts", icon: <MessageSquare size={18} />, feature: "sms_alerts", module: "finance" },
  { href: "/dashboard/setup", label: "Setup", icon: <Settings size={18} />, feature: "setup" },
  { href: "/dashboard/roles", label: "Roles", icon: <Shield size={18} />, feature: "roles", adminOnly: true },
  { href: "/dashboard/team", label: "Team", icon: <Users size={18} />, feature: "team", adminOnly: true },
  { href: "/dashboard/activity", label: "Activity", icon: <Activity size={18} />, feature: "activity", adminOnly: true },
  { href: "/dashboard/platform", label: "Platform Admin", icon: <Shield size={18} />, superAdminOnly: true },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { profile, signOut, hasFeature, hasModule, isAdmin, isSuperAdmin, org } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const visibleItems = NAV_ITEMS.filter(item => {
    if (item.superAdminOnly && !isSuperAdmin) return false;
    if (item.adminOnly && !isAdmin) return false;
    if (item.feature && !isAdmin && !hasFeature(item.feature)) return false;
    if (item.module && !hasModule(item.module)) return false;
    return true;
  });

  async function handleSignOut() {
    await signOut();
    router.push("/auth/login");
  }

  const isActive = (href: string) =>
    href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(href);

  function Sidebar({ mobile = false }: { mobile?: boolean }) {
    return (
      <div className={cn(
        "flex flex-col h-full",
        mobile ? "w-full" : "w-64"
      )} style={{ backgroundColor: "#0F2A47" }}>
        {/* Brand */}
        <div className="flex items-center gap-3 px-5 py-5 border-b border-[#1B3E63]">
          <div className="w-8 h-8 rounded-lg bg-[#C9A227] flex items-center justify-center shrink-0">
            <svg viewBox="0 0 24 24" className="w-4 h-4 text-[#0F2A47]" fill="currentColor">
              <path d="M12 3L1 9l11 6 9-4.91V17h2V9L12 3zM5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82z"/>
            </svg>
          </div>
          <div>
            <div className="text-white font-bold text-sm leading-tight">{org?.name || "School Finance"}</div>
            <div className="text-[#C9A227] text-xs">{org ? org.plan : "Premium bursary console"}</div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-3 overflow-y-auto px-2">
          {visibleItems.map(item => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium mb-0.5 transition-all group",
                isActive(item.href)
                  ? "bg-[#C9A227] text-[#0F2A47]"
                  : "text-[#B8C8DC] hover:bg-[#1B3E63] hover:text-white"
              )}
            >
              <span className={cn(
                "shrink-0",
                isActive(item.href) ? "text-[#0F2A47]" : "text-[#7A9EC0] group-hover:text-white"
              )}>
                {item.icon}
              </span>
              {item.label}
            </Link>
          ))}
        </nav>

        {/* User */}
        <div className="border-t border-[#1B3E63] p-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-[#1B3E63] flex items-center justify-center shrink-0">
              <span className="text-[#C9A227] text-sm font-bold">
                {(profile?.full_name || profile?.email || "?")[0].toUpperCase()}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-white text-sm font-medium truncate">
                {profile?.full_name || profile?.email?.split("@")[0]}
              </div>
              <div className="text-[#C9A227] text-xs uppercase tracking-wide font-semibold">
                {profile?.role}
              </div>
            </div>
            <button onClick={handleSignOut} title="Sign out"
              className="text-[#7A9EC0] hover:text-white transition-colors p-1 rounded">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[#F7F5F0]">
      {/* Desktop sidebar */}
      <div className="hidden lg:flex shrink-0">
        <Sidebar />
      </div>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="w-72 shadow-2xl">
            <Sidebar mobile />
          </div>
          <div className="flex-1 bg-black/50" onClick={() => setMobileOpen(false)} />
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile topbar */}
        <div className="lg:hidden flex items-center justify-between px-4 py-3 bg-[#0F2A47] text-white shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[#C9A227] flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-4 h-4 text-[#0F2A47]" fill="currentColor">
                <path d="M12 3L1 9l11 6 9-4.91V17h2V9L12 3zM5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82z"/>
              </svg>
            </div>
            <span className="font-bold text-sm">School Finance</span>
          </div>
          <button onClick={() => setMobileOpen(!mobileOpen)} className="p-1.5 rounded-lg hover:bg-[#1B3E63]">
            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
