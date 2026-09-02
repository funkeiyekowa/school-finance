"use client";

/**
 * Print Center — a single-page directory of every branded printable
 * in the platform. Grouped by area, searchable, with a short blurb
 * per entry. Turns "what can I print?" from tribal knowledge into
 * a first-class product surface.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import {
  Printer, FileText, Receipt, IdCard, MessageCircle, HeartPulse,
  BookOpen, Award, GraduationCap, ClipboardCheck, CalendarClock,
  ShoppingCart, Boxes, Search, Wallet, ArrowRight, UserPlus,
} from "lucide-react";

interface Entry {
  title: string;
  blurb: string;
  href: string;
  group: string;
  icon: React.ReactNode;
  /** Optional: this printable needs a selection first (class, run, etc). */
  needs?: string;
}

const ENTRIES: Entry[] = [
  { group: "Finance & Payments",
    title: "Fee statements (batch)",
    blurb: "Per-student statement of charges, payments and balance for every filtered family.",
    href: "/dashboard/student-finance",
    needs: "Filter students first → Print statements",
    icon: <Wallet size={16} /> },
  { group: "Finance & Payments",
    title: "Receipts (single)",
    blurb: "Branded PDF receipt for every income entry — receipt no., amount, method.",
    href: "/dashboard/receipts",
    needs: "Pick a receipt → Download PDF",
    icon: <Receipt size={16} /> },
  { group: "Finance & Payments",
    title: "Purchase order (per PO)",
    blurb: "Formal PO on letterhead with vendor, line items, subtotal + gold total, signatures.",
    href: "/dashboard/procurement",
    needs: "Open an order → Print PO",
    icon: <ShoppingCart size={16} /> },
  { group: "Payroll",
    title: "Payslips (bulk per run)",
    blurb: "One page per employee — earnings, deductions, net pay, signature line.",
    href: "/dashboard/payroll",
    needs: "Open a run → Print all",
    icon: <Wallet size={16} /> },
  { group: "Academics",
    title: "Report cards (batch, filtered)",
    blurb: "Every filtered report card stacked — grades, position, comments, signatures.",
    href: "/dashboard/report-cards",
    needs: "Filter cards → Print batch",
    icon: <Award size={16} /> },
  { group: "Academics",
    title: "Class score sheet",
    blurb: "Blank scoresheet per class × subject × term to fill by hand before typing back.",
    href: "/dashboard/assessments",
    needs: "Pick class + subject → Print score sheet",
    icon: <GraduationCap size={16} /> },
  { group: "Academics",
    title: "Class timetable",
    blurb: "Full periods × days grid on letterhead — laminate and post.",
    href: "/dashboard/timetable",
    needs: "Select a class → Print timetable",
    icon: <CalendarClock size={16} /> },
  { group: "Academics",
    title: "Attendance register (blank or marked)",
    blurb: "Mon–Fri hand-mark sheet or today's recorded register, per class.",
    href: "/dashboard/attendance",
    needs: "Select class → Blank register / Marked",
    icon: <ClipboardCheck size={16} /> },
  { group: "Students & Parents",
    title: "Admission letter",
    blurb: "Formal offer of admission on letterhead, personalised per student.",
    href: "/dashboard/students",
    needs: "Open a student → Admission letter",
    icon: <UserPlus size={16} /> },
  { group: "Students & Parents",
    title: "Parent notification hub",
    blurb: "Compose one message, personalise + preview per parent, copy phones or download CSV.",
    href: "/dashboard/parents/notify",
    icon: <MessageCircle size={16} /> },
  { group: "Communications",
    title: "Announcement / notice to parents",
    blurb: "Full-page letter version of any announcement with priority-aware accent bar.",
    href: "/dashboard/announcements",
    needs: "Open an announcement → Print",
    icon: <FileText size={16} /> },
  { group: "Staff",
    title: "Staff ID cards",
    blurb: "2-up A4 grid of branded staff ID cards with department + phone + validity.",
    href: "/dashboard/staff/id-cards",
    icon: <IdCard size={16} /> },
  { group: "Library",
    title: "Overdue book notices",
    blurb: "One notice per overdue loan — borrower, book, days late, estimated fine.",
    href: "/dashboard/library",
    needs: "Overdue tab → Print notices",
    icon: <BookOpen size={16} /> },
  { group: "Clinic",
    title: "Clinic visit summary",
    blurb: "Formal medical summary for a single visit — vitals, dispensed meds, outcome.",
    href: "/dashboard/clinic",
    needs: "Expand a visit → Print summary",
    icon: <HeartPulse size={16} /> },
  { group: "Inventory",
    title: "Stock-take sheet",
    blurb: "Physical count sheet with book qty pre-filled + counted / variance / notes columns.",
    href: "/dashboard/inventory/stocktake",
    icon: <Boxes size={16} /> },
];

export default function PrintCenterPage() {
  const [q, setQ] = useState("");
  const grouped = useMemo(() => {
    const filtered = ENTRIES.filter(e =>
      !q.trim() ||
      e.title.toLowerCase().includes(q.toLowerCase()) ||
      e.blurb.toLowerCase().includes(q.toLowerCase()) ||
      e.group.toLowerCase().includes(q.toLowerCase())
    );
    const groups: Record<string, Entry[]> = {};
    for (const e of filtered) {
      (groups[e.group] ??= []).push(e);
    }
    return groups;
  }, [q]);

  return (
    <div className="p-6 space-y-5">
      <PageHeader
        icon={<Printer size={24} />}
        gradient="gold"
        title="Print Center"
        subtitle="Every branded, letterheaded document the platform can generate — in one place."
      />

      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search printables…"
          className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
        />
      </div>

      {Object.keys(grouped).length === 0 ? (
        <p className="py-12 text-center text-sm text-gray-500 italic">Nothing matches that search.</p>
      ) : (
        Object.entries(grouped).map(([group, items]) => (
          <div key={group} className="space-y-2">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[#C9A227]">{group}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {items.map(e => (
                <Link key={e.title} href={e.href}>
                  <Card className="hover:shadow-md hover:border-[#C9A227] transition-all cursor-pointer h-full">
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#C9A227] to-[#e6bf39] text-[#0F2A47] flex items-center justify-center shrink-0">
                          {e.icon}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <h3 className="font-semibold text-sm text-[#0F2A47] truncate">{e.title}</h3>
                            <ArrowRight size={12} className="text-gray-300 shrink-0" />
                          </div>
                          <p className="text-xs text-gray-600 mt-1 line-clamp-2">{e.blurb}</p>
                          {e.needs && (
                            <p className="text-[10px] text-gray-500 italic mt-1.5 flex items-center gap-1">
                              <span className="w-1 h-1 rounded-full bg-[#C9A227]"></span>
                              {e.needs}
                            </p>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        ))
      )}

      <p className="text-xs text-gray-400 italic mt-6">
        Every document above uses your school&apos;s logo, name, address, and brand colours — set them once under School Settings and they appear everywhere automatically.
      </p>
    </div>
  );
}
