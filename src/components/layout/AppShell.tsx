"use client";

/**
 * Application shell — collapsible grouped sidebar navigation with active-org
 * role, permission, and module visibility checks.
 */

import { useState, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/context/AuthContext";
import { signOutToSchoolLogin } from "@/lib/auth/signOutToSchoolLogin";
import { OrgSwitcher, ActiveOrgBadge } from "@/components/layout/OrgSwitcher";
import { SchoolBrandBar } from "@/components/layout/SchoolBrandBar";
import ForcePasswordChange from "@/components/auth/ForcePasswordChange";
import { CommandPalette, useNavCommandItems } from "@/components/ui/CommandPalette";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, TrendingUp, TrendingDown, GraduationCap, Building2,
  ArrowLeftRight, FileBarChart, Receipt, Settings, Shield, Users,
  Activity, MessageSquare, Menu, X, LogOut, Clock, BookOpen,
  Globe, ShieldCheck, LifeBuoy, Inbox, HelpCircle, ChevronDown,
  Wallet, Package, Megaphone, BarChart3, Briefcase, UserCircle, Sparkles, KeyRound, Bus, Trophy, Library, BedDouble, ClipboardList, Boxes, Stethoscope,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/* Navigation configuration                                           */
/* ------------------------------------------------------------------ */

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  feature?: string;
  module?: string;
  adminOnly?: boolean;
  superAdminOnly?: boolean;
  /** If set, the item is only visible when the active organization role is in
   * this list: student, parent, teacher, staff, admin, owner, editor, viewer,
   * bursar, accountant, developer. */
  roles?: string[];
}

interface NavGroup {
  key: string;
  label: string;
  icon: React.ReactNode;
  items: NavItem[];
  /** If true, this group is always visible (no accordion header) */
  standalone?: boolean;
  /** Group-level allow-list. Applied on top of the per-item roles filter. */
  roles?: string[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    key: "overview",
    label: "",
    icon: <LayoutDashboard size={16} />,
    standalone: true,
    items: [
      { href: "/dashboard", label: "Dashboard", icon: <LayoutDashboard size={17} /> },
    ],
  },
  {
    /* Teacher-facing tools: what a teacher uses day-to-day.
       The overview page lives at /dashboard/teaching; attendance,
       assessments and CBT are the same pages other staff see, but
       surfaced under this group so teachers land on them by role
       rather than digging through the wider Students & Academics
       nav that admins use. Each item is gated on its own underlying
       module (attendance/assessments/cbt) rather than the teacher_portal
       module itself, so an item does not appear pointing at a page the
       school has not enabled. */
    key: "teacher_portal",
    roles: [...['teacher'], ...['owner','admin','editor','staff','bursar','accountant','developer']],
    label: "Teacher's Portal",
    icon: <BookOpen size={16} />,
    items: [
      { href: "/dashboard/teaching", label: "My Teaching", icon: <BookOpen size={17} />, module: "teacher_portal" },
      { href: "/dashboard/attendance", label: "Attendance", icon: <Clock size={17} />, module: "attendance" },
      { href: "/dashboard/assessments", label: "Assessments", icon: <FileBarChart size={17} />, module: "assessments" },
      { href: "/dashboard/cbt", label: "CBT / Exams", icon: <BookOpen size={17} />, module: "cbt" },
    ],
  },
  {
    /* Student-facing self-service. Split out of My Workspace so a
       student sees only their own things, not the teacher group. */
    key: "student_portal",
    roles: ['student'],
    label: "Student Portal",
    icon: <GraduationCap size={16} />,
    items: [
      { href: "/dashboard/student-portal", label: "Overview", icon: <LayoutDashboard size={17} />, module: "student_portal" },
      { href: "/dashboard/my-exams", label: "My Exams", icon: <BookOpen size={17} />, module: "student_portal" },
      { href: "/dashboard/my-results", label: "My Results", icon: <FileBarChart size={17} />, module: "student_portal" },
      { href: "/dashboard/my-courses", label: "My Courses", icon: <GraduationCap size={17} />, module: "lms" },
    ],
  },
  {
    /* Parent-facing self-service. */
    key: "parent_portal",
    roles: ['parent'],
    label: "Parent Portal",
    icon: <Users size={16} />,
    items: [
      { href: "/dashboard/parent-portal", label: "Overview", icon: <LayoutDashboard size={17} />, module: "parent_portal" },
      { href: "/dashboard/my-children", label: "My Children", icon: <Users size={17} />, module: "parent_portal" },
    ],
  },
  {
    key: "academics",
    roles: [...['teacher'], ...['owner','admin','editor','staff','bursar','accountant','developer']],
    label: "Students & Academics",
    icon: <GraduationCap size={16} />,
    items: [
      { href: "/dashboard/students/overview", label: "Overview", icon: <LayoutDashboard size={17} />, module: "academics" },
      { href: "/dashboard/students", label: "Students", icon: <GraduationCap size={17} />, feature: "students", module: "students" },
      { href: "/dashboard/attendance", label: "Attendance", icon: <Clock size={17} />, module: "attendance" },
      { href: "/dashboard/timetable", label: "Timetable", icon: <Clock size={17} />, module: "timetable" },
      { href: "/dashboard/assessments", label: "Assessments", icon: <FileBarChart size={17} />, module: "assessments" },
      { href: "/dashboard/cbt", label: "CBT / Exams", icon: <BookOpen size={17} />, module: "cbt" },
      { href: "/dashboard/report-cards", label: "Report Cards", icon: <FileBarChart size={17} />, module: "academics" },
      { href: "/dashboard/lms", label: "Learning Management", icon: <Trophy size={17} />, module: "lms" },
      { href: "/dashboard/students/promotion", label: "Promotion", icon: <ArrowLeftRight size={17} />, feature: "students", module: "academics", adminOnly: true },
    ],
  },
  {
    key: "finance",
    roles: ['owner','admin','editor','staff','bursar','accountant','developer'],
    label: "Finance",
    icon: <Wallet size={16} />,
    items: [
      { href: "/dashboard/finance", label: "Overview", icon: <LayoutDashboard size={17} />, module: "finance" },
      { href: "/dashboard/student-finance", label: "Student Finance", icon: <TrendingUp size={17} />, feature: "students", module: "finance" },
      { href: "/dashboard/income", label: "Income", icon: <TrendingUp size={17} />, feature: "income", module: "finance" },
      { href: "/dashboard/expenses", label: "Expenses", icon: <TrendingDown size={17} />, feature: "expenses", module: "finance" },
      { href: "/dashboard/receipts", label: "Receipts", icon: <Receipt size={17} />, feature: "receipts", module: "finance" },
      { href: "/dashboard/sms-alerts", label: "Payment Alerts", icon: <MessageSquare size={17} />, feature: "sms_alerts", module: "finance" },
      { href: "/dashboard/reconciliation", label: "Reconcile", icon: <ArrowLeftRight size={17} />, feature: "reconciliation", module: "finance" },
    ],
  },
  {
    key: "people",
    roles: ['owner','admin','editor','staff','bursar','accountant','developer'],
    label: "People",
    icon: <Briefcase size={16} />,
    items: [
      { href: "/dashboard/staff", label: "Staff", icon: <Users size={17} />, module: "hr" },
      { href: "/dashboard/payroll", label: "Payroll", icon: <Wallet size={17} />, module: "payroll" },
      { href: "/dashboard/parents", label: "Parents", icon: <Users size={17} />, adminOnly: true },
      { href: "/dashboard/team", label: "Team", icon: <Users size={17} />, feature: "team", adminOnly: true },
      { href: "/dashboard/roles", label: "Roles", icon: <Shield size={17} />, feature: "roles", adminOnly: true },
    ],
  },
  {
    key: "operations",
    roles: ['owner','admin','editor','staff','bursar','accountant','developer'],
    label: "Operations",
    icon: <Package size={16} />,
    items: [
      { href: "/dashboard/inventory", label: "Inventory", icon: <Package size={17} />, module: "inventory" },
      { href: "/dashboard/procurement", label: "Procurement", icon: <ClipboardList size={17} />, module: "procurement" },
      { href: "/dashboard/assets", label: "Assets", icon: <Boxes size={17} />, module: "assets" },
      { href: "/dashboard/clinic", label: "Health / Clinic", icon: <Stethoscope size={17} />, module: "clinic" },
      { href: "/dashboard/transport", label: "Transport", icon: <Bus size={17} />, module: "transport" },
      { href: "/dashboard/library", label: "Library", icon: <Library size={17} />, module: "library" },
      { href: "/dashboard/hostel", label: "Hostel / Boarding", icon: <BedDouble size={17} />, module: "hostel" },
      { href: "/dashboard/vendors", label: "Vendors", icon: <Building2 size={17} />, feature: "vendors", module: "finance" },
      { href: "/dashboard/automations", label: "Automations", icon: <Settings size={17} />, adminOnly: true },
      { href: "/dashboard/ai", label: "AI Studio", icon: <Sparkles size={17} /> },
      { href: "/dashboard/ai-provider", label: "AI Provider", icon: <KeyRound size={17} />, adminOnly: true },
    ],
  },
  {
    key: "communication",
    roles: ['owner','admin','editor','staff','bursar','accountant','developer'],
    label: "Communication",
    icon: <Megaphone size={16} />,
    items: [
      { href: "/dashboard/announcements", label: "Announcements", icon: <MessageSquare size={17} />, module: "communication" },
      { href: "/dashboard/leads", label: "Enquiries", icon: <Inbox size={17} />, module: "crm" },
      { href: "/dashboard/website", label: "Website Studio", icon: <Globe size={17} />, module: "website", feature: "website" },
    ],
  },
  {
    key: "admin",
    roles: ['owner','admin','editor','staff','bursar','accountant','developer'],
    label: "Reports & Admin",
    icon: <BarChart3 size={16} />,
    items: [
      { href: "/dashboard/reports", label: "Reports", icon: <FileBarChart size={17} />, feature: "reports" },
      { href: "/dashboard/analytics", label: "Analytics", icon: <BarChart3 size={17} />, adminOnly: true },
      { href: "/dashboard/activity", label: "Activity", icon: <Activity size={17} />, feature: "activity", adminOnly: true },
      { href: "/dashboard/setup", label: "Setup", icon: <Settings size={17} />, feature: "setup" },
    ],
  },
  {
    key: "help",
    label: "",
    icon: <HelpCircle size={16} />,
    standalone: true,
    items: [
      { href: "/dashboard/help", label: "Help & Manual", icon: <HelpCircle size={17} /> },
    ],
  },
  {
    key: "platform",
    label: "Platform",
    icon: <Shield size={16} />,
    items: [
      { href: "/dashboard/platform", label: "Platform Admin", icon: <Shield size={17} />, superAdminOnly: true },
      { href: "/dashboard/platform/landing", label: "Landing Page", icon: <Globe size={17} />, superAdminOnly: true },
      { href: "/dashboard/platform/verify", label: "Verify Isolation", icon: <ShieldCheck size={17} />, superAdminOnly: true },
      { href: "/dashboard/platform/ai-provider", label: "AI Provider", icon: <Sparkles size={17} />, superAdminOnly: true },
    ],
  },
];

/* ------------------------------------------------------------------ */
/* Component                                                          */
/* ------------------------------------------------------------------ */

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const {
    profile, signOut, hasFeature, hasModule, isAdmin, isSuperAdmin,
    org, availableOrgs, isSupportSession, membership,
  } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Determine which item is active (longest prefix match)
  const allItems = NAV_GROUPS.flatMap(g => g.items);
  const activeHref = allItems.reduce<string | null>((best, item) => {
    const matches =
      pathname === item.href ||
      (item.href !== "/dashboard" && pathname.startsWith(item.href + "/"));
    if (!matches) return best;
    if (!best || item.href.length > best.length) return item.href;
    return best;
  }, null);

  // Auto-expand the group containing the active item
  useEffect(() => {
    for (const group of NAV_GROUPS) {
      if (group.items.some(i => i.href === activeHref)) {
        setExpanded(e => ({ ...e, [group.key]: true }));
        break;
      }
    }
  }, [activeHref]);

  /** Resolve roles from the active organization only. Platform super-admin
   * remains global so support sessions can reach platform tooling. */
  const activeRoles = new Set<string>();
  if (membership?.role) activeRoles.add(membership.role);
  if (isSuperAdmin) activeRoles.add("super_admin");

  function isRoleAllowed(allowed?: string[]): boolean {
    if (!allowed || allowed.length === 0) return true;
    if (isSuperAdmin) return true;
    for (const r of allowed) if (activeRoles.has(r)) return true;
    return false;
  }

  function isGroupVisible(group: NavGroup): boolean {
    return isRoleAllowed(group.roles);
  }

  function isVisible(item: NavItem): boolean {
    if (item.superAdminOnly && !isSuperAdmin) return false;
    if (item.adminOnly && !isAdmin) return false;
    if (!isRoleAllowed(item.roles)) return false;
    if (item.feature && !hasFeature(item.feature)) return false;
    if (item.module && !hasModule(item.module)) return false;
    return true;
  }

  function toggleGroup(key: string) {
    setExpanded(e => ({ ...e, [key]: !e[key] }));
  }

  async function handleSignOut() {
    // Sign the Supabase session out first, then bounce to whichever
    // school this browser most recently used. `sf_last_school` cookie
    // is set on successful school-scoped sign-in.
    await signOut();
    signOutToSchoolLogin();
  }

  function Sidebar({ mobile = false }: { mobile?: boolean }) {
    return (
      <div className={cn("flex flex-col h-full", mobile ? "w-full" : "w-64")}
        style={{ backgroundColor: "#0F2A47" }}>

        {/* Org switcher */}
        <div className="px-2.5 py-3 border-b border-[#1B3E63]">
          {org || (availableOrgs && availableOrgs.length > 0) ? (
            <OrgSwitcher />
          ) : (
            <div className="flex items-center gap-3 px-2.5 py-2">
              <div className="w-7 h-7 rounded-md bg-[#C9A227] flex items-center justify-center shrink-0">
                <svg viewBox="0 0 24 24" className="w-4 h-4 text-[#0F2A47]" fill="currentColor">
                  <path d="M12 3L1 9l11 6 9-4.91V17h2V9L12 3zM5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82z"/>
                </svg>
              </div>
              <div>
                <div className="text-white font-bold text-sm leading-tight">School Suite</div>
                <div className="text-[#C9A227] text-xs">Premium console</div>
              </div>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-2 overflow-y-auto px-2" aria-label="Main navigation">
          {NAV_GROUPS.map(group => {
            if (!isGroupVisible(group)) return null;
            const visibleItems = group.items.filter(isVisible);
            if (visibleItems.length === 0) return null;

            const isOpen = group.standalone || expanded[group.key];
            const hasActiveChild = visibleItems.some(i => i.href === activeHref);

            // Standalone groups (Dashboard, Help) render without a header
            if (group.standalone) {
              return (
                <div key={group.key} className="mb-1">
                  {visibleItems.map(item => (
                    <NavLink key={item.href} item={item} active={item.href === activeHref}
                      onClick={() => setMobileOpen(false)} />
                  ))}
                </div>
              );
            }

            return (
              <div key={group.key} className="mb-0.5">
                <button
                  onClick={() => toggleGroup(group.key)}
                  className={cn(
                    "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-colors",
                    hasActiveChild
                      ? "text-[#C9A227]"
                      : "text-[#7A9EC0] hover:text-[#B8C8DC]"
                  )}
                  aria-expanded={isOpen}
                >
                  <span className="shrink-0 opacity-70">{group.icon}</span>
                  <span className="flex-1 text-left">{group.label}</span>
                  <ChevronDown size={12} className={cn(
                    "transition-transform opacity-50",
                    isOpen && "rotate-180"
                  )} />
                </button>

                {isOpen && (
                  <div className="ml-2 border-l border-[#1B3E63] pl-2 mb-2">
                    {visibleItems.map(item => (
                      <NavLink key={item.href} item={item} active={item.href === activeHref}
                        onClick={() => setMobileOpen(false)} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* User card */}
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
                {membership?.role?.replace("_", " ") || profile?.role}
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

  // Build command palette items from visible groups (respects roles/modules/features).
  const cmdGroups = NAV_GROUPS
    .filter(isGroupVisible)
    .map((g) => ({ label: g.label, items: g.items.filter(isVisible).map((i) => ({ href: i.href, label: i.label, icon: i.icon })) }))
    .filter((g) => g.items.length > 0);
  const commandItems = useNavCommandItems(cmdGroups);

  return (
    <>
    <ForcePasswordChange />
    <CommandPalette items={commandItems} />
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
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-[#C9A227] flex items-center justify-center shrink-0">
              <svg viewBox="0 0 24 24" className="w-4 h-4 text-[#0F2A47]" fill="currentColor">
                <path d="M12 3L1 9l11 6 9-4.91V17h2V9L12 3zM5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82z"/>
              </svg>
            </div>
            {org ? <ActiveOrgBadge /> : <span className="font-bold text-sm">School Suite</span>}
          </div>
          <button onClick={() => setMobileOpen(!mobileOpen)}
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            className="p-1.5 rounded-lg hover:bg-[#1B3E63]">
            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

        {/* Support-access warning */}
        {isSupportSession && org && (
          <div role="status" className="shrink-0 flex items-center gap-2 px-4 py-2 bg-amber-100 border-b border-amber-300 text-amber-900 text-xs font-medium">
            <LifeBuoy size={14} className="shrink-0" />
            <span>
              Support session — you are viewing <strong>{org.name}</strong> as a platform
              admin. Changes you make affect this school&apos;s live data.
            </span>
          </div>
        )}

        {/* Persistent school-brand header — makes the current school context obvious on every page. */}
        <SchoolBrandBar />

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
    </>
  );
}

/* ------------------------------------------------------------------ */

function NavLink({ item, active, onClick }: { item: NavItem; active: boolean; onClick: () => void }) {
  return (
    <Link
      href={item.href}
      onClick={onClick}
      className={cn(
        "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium mb-0.5 transition-all group",
        active
          ? "bg-[#C9A227] text-[#0F2A47]"
          : "text-[#B8C8DC] hover:bg-[#1B3E63] hover:text-white"
      )}
    >
      <span className={cn(
        "shrink-0",
        active ? "text-[#0F2A47]" : "text-[#7A9EC0] group-hover:text-white"
      )}>
        {item.icon}
      </span>
      {item.label}
    </Link>
  );
}
