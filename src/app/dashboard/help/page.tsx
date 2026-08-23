"use client";

/**
 * In-app Operations Manual — 10x edition.
 *
 * No duplicate sidebar. Instead:
 * - A sticky horizontal chapter strip at the top (scrollable, pill-style)
 * - Full-width content area using the whole main panel
 * - Big hero screenshot with a frosted overlay caption
 * - Sections as expandable cards with smooth transitions
 * - A floating "jump to chapter" FAB on mobile
 * - Print-optimized with @media print
 */

import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/lib/context/AuthContext";
import { cn } from "@/lib/utils";
import {
  BookOpen, LayoutDashboard, TrendingUp, TrendingDown, GraduationCap,
  ArrowLeftRight, Users, Clock, FileBarChart, Shield, Package,
  ChevronRight, ChevronDown, Search, Printer, BarChart3, X,
  ChevronLeft, List, Sparkles,
} from "lucide-react";

/* ------------------------------------------------------------------ */

interface Section {
  heading: string;
  body: string;
  tip?: string;
}

interface Chapter {
  id: string;
  title: string;
  icon: React.ReactNode;
  color: string;
  image?: string;
  imageAlt?: string;
  intro: string;
  sections: Section[];
}

const CHAPTERS: Chapter[] = [
  {
    id: "dashboard", title: "Your Dashboard", icon: <LayoutDashboard size={15} />, color: "#0E1A38",
    image: "/guide/preview.webp",
    imageAlt: "The main dashboard showing total income, expenses, net position, outstanding fees, cash flow chart, and fee balances",
    intro: "The Dashboard is the first screen you see after signing in. Every figure is pulled live from your ledgers — nothing is cached or estimated.",
    sections: [
      { heading: "KPI Cards", body: "The top row shows four key numbers: Total Income (all receipts), Total Expenses (all vouchers), Net Position (income minus expenses), and Outstanding Fees (what students still owe). These update in real time as transactions are recorded." },
      { heading: "Cash Flow Chart", body: "Shows income (green/gold) and expenses (red) over the last six months. The gap between the two lines is your surplus or deficit. Hover on any month for exact figures." },
      { heading: "Fee Balances", body: "The right panel lists students with the highest outstanding balances. Click 'All students' to see the full list. Click any student name to open their profile and record a payment.", tip: "Sort by balance to prioritize follow-ups with parents who owe the most." },
      { heading: "SMS Alerts Banner", body: "If your school receives payment notifications via SMS or email, unprocessed alerts appear in an amber banner. Click 'Review' to match them against students." },
    ],
  },
  {
    id: "income", title: "Income (Receipts)", icon: <TrendingUp size={15} />, color: "#166534",
    image: "/guide/preview_1.webp",
    imageAlt: "Income Ledger showing a table of payment receipts with receipt numbers, dates, students, categories, and amounts",
    intro: "Every payment the school receives is recorded here as a receipt. The system auto-generates receipt numbers (RCT-0001, RCT-0002, etc.) unique to your school.",
    sections: [
      { heading: "Recording a Payment", body: "Click '+ Record Payment' in the top right. Fill in the student, amount, category (School Fees, Transport, etc.), payment method, and any notes. The receipt number is generated automatically.", tip: "You can also record a payment from the student's profile page — it pre-fills their details." },
      { heading: "Viewing a Receipt", body: "Click the 'Receipt' button on any row to see the full payment receipt with your school name, amount, student, and a 'Download PDF' option you can print or email to parents." },
      { heading: "Searching and Filtering", body: "Use the search bar to find by receipt number, student name, or category. The dropdown filters let you narrow by category or reconciliation status." },
      { heading: "Reconciliation", body: "The circle in the 'Recon.' column shows whether a payment has been matched against a bank statement. Green tick = reconciled. Empty circle = pending." },
      { heading: "Export", body: "Click 'Export CSV' to download all visible records as a spreadsheet for auditors or accounting software." },
    ],
  },
  {
    id: "receipt", title: "Payment Receipts", icon: <FileBarChart size={15} />, color: "#AD7C25",
    image: "/guide/preview_2.webp",
    imageAlt: "A payment receipt modal showing school name, receipt number, date, student, category, amount paid, and download button",
    intro: "Every recorded payment generates a formal receipt. This is what you print or send to parents as proof of payment.",
    sections: [
      { heading: "What the Receipt Shows", body: "School name, receipt number, date, student name, payment category, description (e.g. SMS or bank alert reference), payment method, term, who recorded it, and the amount paid." },
      { heading: "Download PDF", body: "Click 'Download PDF' to generate a printable receipt. The PDF uses your school branding." },
      { heading: "Auto-Credit Receipts", body: "When the system automatically creates a receipt from an SMS or email alert, the 'Recorded By' field shows 'System (Auto-Credit)'. These still appear in the ledger normally.", tip: "Auto-credited receipts can be edited if the amount or student was matched incorrectly." },
    ],
  },
  {
    id: "expenses", title: "Expenses (Vouchers)", icon: <TrendingDown size={15} />, color: "#9C3A2A",
    image: "/guide/preview_3.webp",
    imageAlt: "Expense Ledger showing voucher numbers, dates, vendors, categories, descriptions, and amounts in red",
    intro: "Every naira going out of the school is recorded as an expense voucher. Voucher numbers (VCH-0001, etc.) are unique to your school.",
    sections: [
      { heading: "Recording an Expense", body: "Click '+ Record Expense'. Select or type a vendor name, choose a category (Utilities, Transport, Salaries, etc.), enter the amount, payment method, and optional approval details." },
      { heading: "Auto-Expense from Bank Alerts", body: "Debit alerts are automatically recorded as expenses with 'System (Auto-Expense)' in the Approved By column. Edit the vendor and category afterwards." },
      { heading: "Categories", body: "Expense categories are customizable under Setup. Common ones: Utilities, Salaries, Transport, Maintenance, Supplies, Other Expense." },
    ],
  },
  {
    id: "students", title: "Student Management", icon: <GraduationCap size={15} />, color: "#1D4ED8",
    image: "/guide/preview_4.webp",
    imageAlt: "Students page showing 101 registered students with payment status cards and a searchable table",
    intro: "Students are the anchor for everything else — fees, attendance, assessments, and promotion all connect to the student record.",
    sections: [
      { heading: "Adding a Student", body: "Click '+ Add Student'. Fill in name, grade, gender, guardian details. The student code is auto-generated. Use 'Import' to upload from CSV." },
      { heading: "Payment Status Cards", body: "Paid in Full (green), Part Paid (amber), Unpaid (red), and Total Outstanding. These update as payments come in." },
      { heading: "Student Profile", body: "Click 'View' on any student to see their full record: personal details, fee schedule, payment history, and academic history." },
      { heading: "Inline Editing", body: "Click any cell in the table to edit it directly. Changes save automatically.", tip: "Double-click the grade column to quickly re-assign a student's class." },
    ],
  },
  {
    id: "student-detail", title: "Student Profile & Fees", icon: <GraduationCap size={15} />, color: "#1D4ED8",
    image: "/guide/preview_5.webp",
    imageAlt: "Student detail showing total due, total paid, balance, fee schedule, and payment history",
    intro: "Everything about one student: what they owe, what they've paid, and their academic journey.",
    sections: [
      { heading: "Fee Summary", body: "Total Due (sum of fee schedules), Total Paid (sum of receipts), and Balance. A green 'Paid in full' badge appears when balance is zero." },
      { heading: "Applicable Fee Schedule", body: "Shows which fees apply based on grade and term. Example: Tuition (₦25,000) + Note Books (₦2,000) = ₦27,000 total." },
      { heading: "Payment History", body: "Every receipt linked to this student with receipt number, date, category, method, amount, and reconciliation status." },
      { heading: "Record Payment from Here", body: "Click 'Record Payment' to open the form with the student pre-selected.", tip: "Useful when a parent walks in — no need to search for the student first." },
    ],
  },
  {
    id: "promotion", title: "Promotion Center", icon: <ArrowLeftRight size={15} />, color: "#7C3AED",
    image: "/guide/preview_6.webp",
    imageAlt: "Promotion Center showing academic year transition with status counts and student destinations",
    intro: "End-of-year batch promotion. The system calculates where each student goes based on your class structure.",
    sections: [
      { heading: "How It Works", body: "Select 'From' year and 'To' year. The system shows every student with their current class and calculated destination. Students in the final class are marked 'NO NEXT CLASS'." },
      { heading: "Status Cards", body: "Total Students, Ready (have a destination), Already Promoted, Graduating, No Next Class, Inactive, No Enrollment." },
      { heading: "Batch Promotion", body: "Tick students (or use the header checkbox for all), then click 'Promote X Students'. They move to their destination class.", tip: "Promote in batches by class — select all JSS1, promote, then JSS2, etc." },
      { heading: "Repeat a Student", body: "Click 'repeat' in the Action column to keep a student in their current class for the new year." },
    ],
  },
  {
    id: "attendance", title: "Attendance", icon: <Clock size={15} />, color: "#0E7490",
    image: "/guide/preview_7.webp",
    imageAlt: "Attendance page showing student list with Present, Absent, Late, Excused, and Sick options",
    intro: "A daily register for every class. Select the class, date, and session, then mark each student.",
    sections: [
      { heading: "Taking Attendance", body: "Choose Class, Date, and Session (Full Day, Morning, Afternoon). The student list loads. Click the radio button for each student's status." },
      { heading: "Quick Buttons", body: "'All Present' marks everyone green — then just change the exceptions. Same for 'All Absent', 'All Late', 'All Excused', 'All Sick'.", tip: "Start with 'All Present' and only mark the 2-3 absent students. Much faster than clicking 30 radios." },
      { heading: "Summary Bar", body: "Shows count and percentage: '18 students · 18 present · 0 absent (100% attendance)'. Updates as you mark." },
      { heading: "Auto-Save", body: "Attendance saves automatically as you click each radio button. No separate Save button needed." },
    ],
  },
  {
    id: "assessments", title: "Assessments & Gradebook", icon: <FileBarChart size={15} />, color: "#B45309",
    image: "/guide/preview_9.webp",
    imageAlt: "Gradebook for Mathematics JSS1 with CA1, CA2, ASG, EXAM columns and auto-calculated grades",
    intro: "Enter CA scores, test marks, and exam results. Totals and grades calculate automatically.",
    sections: [
      { heading: "Selecting What to Grade", body: "Choose Class (JSS1), Subject (Mathematics), and Term (Term 1). The gradebook loads with all enrolled students." },
      { heading: "Columns", body: "CA1 (/10), CA2 (/10), ASG (/10), EXAM (/70). Total adds up out of 100. Grade applies your scale (A, B, C, D, F)." },
      { heading: "Entering Scores", body: "Click any cell and type. Tab to move to the next. Saves automatically. Total and grade recalculate instantly." },
      { heading: "Grading Scale", body: "Default: A (70-100), B (60-69), C (50-59), D (40-49), F (0-39). Customize in Setup.", tip: "Enter scores during the exam period — results are available to students and parents immediately via their portals." },
    ],
  },
  {
    id: "staff", title: "Staff Records", icon: <Users size={15} />, color: "#4338CA",
    image: "/guide/preview_10.webp",
    imageAlt: "Staff Directory with Add Staff modal showing code, name, email, phone, title, type, department",
    intro: "A directory of all staff — teaching and non-teaching. Separate from login accounts.",
    sections: [
      { heading: "Adding Staff", body: "Click '+ Add Staff'. Enter Staff Code (STF001), Full Name, Email, Phone, Job Title, Staff Type (Teaching/Non-Teaching), Department, Date Joined, Status." },
      { heading: "Staff vs Team", body: "Staff is an HR directory. Team controls who can log in. A person can be in Staff without a login, and vice versa." },
      { heading: "Filtering", body: "KPI cards show Total, Teaching, Non-Teaching, and Inactive counts. Search by name, code, email, or title." },
    ],
  },
  {
    id: "inventory", title: "Inventory", icon: <Package size={15} />, color: "#0F766E",
    image: "/guide/preview_11.webp",
    imageAlt: "Inventory page with Add Item modal for item name, code, category, unit, quantity, reorder level",
    intro: "Track what the school owns and what it's running low on.",
    sections: [
      { heading: "Adding an Item", body: "Click '+ Add Item'. Enter Item Name (Whiteboard Marker), Code (WBM001), Category (Stationery), Unit (Pieces), Quantity, Reorder Level, Unit Cost, Location." },
      { heading: "Low Stock Alerts", body: "When quantity drops to or below the Reorder Level, it appears in the 'Low Stock' count. Your prompt to reorder.", tip: "Set reorder levels at 20% of typical stock to give yourself lead time." },
      { heading: "Total Value", body: "Sum of (quantity × unit cost) across all items. Useful for insurance and year-end audits." },
    ],
  },
  {
    id: "analytics", title: "Analytics", icon: <BarChart3 size={15} />, color: "#0369A1",
    image: "/guide/preview_12.webp",
    imageAlt: "Analytics showing KPIs, monthly revenue bar, enrollment by class, and quick insights",
    intro: "High-level school performance pulling from every module. For admins, bursars, and owners.",
    sections: [
      { heading: "KPI Row", body: "Active Students, Total Revenue, Total Expenses, Net Balance, Fee Collection %, Outstanding, Attendance Rate, Exam Average. Colour-coded icons indicate health." },
      { heading: "Monthly Revenue", body: "Bar chart showing income per month. Spot seasonal patterns (term start vs mid-term)." },
      { heading: "Enrollment by Class", body: "Horizontal bars showing student count per class. Plan staffing and resources." },
      { heading: "Quick Insights", body: "Three observation cards: Revenue Health, Attendance, Academic Performance. Flags issues proactively.", tip: "Check this weekly to catch problems before they become crises." },
    ],
  },
];

/* ------------------------------------------------------------------ */

export default function HelpPage() {
  const { org } = useAuth();
  const [activeIdx, setActiveIdx] = useState(0);
  const [search, setSearch] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const stripRef = useRef<HTMLDivElement>(null);

  const current = CHAPTERS[activeIdx];

  // Scroll the active pill into view
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const pill = strip.children[activeIdx] as HTMLElement | undefined;
    if (pill) {
      pill.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }
  }, [activeIdx]);

  const toggle = (key: string) =>
    setExpanded(e => ({ ...e, [key]: !e[key] }));

  const searchResults = search.trim()
    ? CHAPTERS.map((ch, i) => ({
        ch, i,
        match: ch.title.toLowerCase().includes(search.toLowerCase()) ||
               ch.sections.some(s => s.heading.toLowerCase().includes(search.toLowerCase()) || s.body.toLowerCase().includes(search.toLowerCase())),
      })).filter(r => r.match)
    : [];

  return (
    <div className="min-h-full bg-gradient-to-b from-[#F7F5F0] to-[#EEF0EE]">
      {/* ========== Top bar ========== */}
      <div className="sticky top-0 z-20 bg-white/95 backdrop-blur-sm border-b border-gray-200 shadow-sm print:hidden">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#F1DFB4] to-[#AD7C25] grid place-items-center shadow">
              <BookOpen size={14} className="text-[#0E1A38]" />
            </div>
            <div className="hidden sm:block">
              <div className="text-sm font-bold text-[#0E1A38] leading-tight">{org?.name ?? "School"} Manual</div>
              <div className="text-[9px] uppercase tracking-wider text-gray-500">Operations Guide</div>
            </div>
          </div>

          {/* Chapter strip */}
          <div
            ref={stripRef}
            className="flex-1 flex items-center gap-1.5 overflow-x-auto scrollbar-none px-2"
            role="tablist"
            aria-label="Chapters"
          >
            {CHAPTERS.map((ch, i) => (
              <button
                key={ch.id}
                role="tab"
                aria-selected={i === activeIdx}
                onClick={() => { setActiveIdx(i); setSearch(""); setShowSearch(false); }}
                className={cn(
                  "shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap",
                  i === activeIdx
                    ? "bg-[#0E1A38] text-white shadow-md scale-105"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                )}
              >
                {ch.icon}
                <span className="hidden md:inline">{ch.title}</span>
                <span className="md:hidden">{String(i + 1).padStart(2, "0")}</span>
              </button>
            ))}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => setShowSearch(s => !s)}
              aria-label="Search"
              className="p-2 rounded-lg hover:bg-gray-100 text-gray-600"
            >
              {showSearch ? <X size={16} /> : <Search size={16} />}
            </button>
            <button
              onClick={() => window.print()}
              aria-label="Print"
              className="p-2 rounded-lg hover:bg-gray-100 text-gray-600 hidden sm:block"
            >
              <Printer size={16} />
            </button>
          </div>
        </div>

        {/* Search overlay */}
        {showSearch && (
          <div className="border-t border-gray-100 bg-white px-4 py-3">
            <div className="max-w-2xl mx-auto relative">
              <Search size={15} className="absolute left-3 top-2.5 text-gray-400" />
              <input
                autoFocus
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search all chapters…"
                aria-label="Search help topics"
                className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#AD7C25] focus:border-transparent"
              />
              {searchResults.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-gray-200 rounded-xl shadow-xl max-h-72 overflow-y-auto z-30">
                  {searchResults.map(({ ch, i }) => (
                    <button
                      key={ch.id}
                      onClick={() => { setActiveIdx(i); setSearch(""); setShowSearch(false); }}
                      className="w-full text-left px-4 py-3 hover:bg-gray-50 border-b border-gray-50 last:border-0 flex items-center gap-3"
                    >
                      <span className="shrink-0 w-6 h-6 rounded-full grid place-items-center text-white text-[10px] font-bold" style={{ background: ch.color }}>
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span>
                        <span className="block text-sm font-semibold text-gray-900">{ch.title}</span>
                        <span className="block text-xs text-gray-500 truncate">{ch.intro.slice(0, 80)}…</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ========== Content ========== */}
      <div className="max-w-5xl mx-auto px-4 py-8 sm:py-12 print:py-4">
        {/* Chapter number + title */}
        <div className="mb-6">
          <div
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider text-white mb-3"
            style={{ background: current.color }}
          >
            <Sparkles size={11} />
            Chapter {String(activeIdx + 1).padStart(2, "0")}
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-[#0E1A38] leading-tight">
            {current.title}
          </h1>
          <p className="mt-3 text-base sm:text-lg text-gray-600 leading-relaxed max-w-3xl">
            {current.intro}
          </p>
        </div>

        {/* Hero screenshot */}
        {current.image && (
          <figure className="mb-10 rounded-2xl overflow-hidden border border-gray-200 shadow-lg relative group">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={current.image}
              alt={current.imageAlt ?? `Screenshot of ${current.title}`}
              className="w-full"
              loading="lazy"
            />
            <figcaption className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent px-5 py-4 text-white text-xs leading-relaxed opacity-0 group-hover:opacity-100 transition-opacity duration-300 sm:opacity-100">
              {current.imageAlt}
            </figcaption>
          </figure>
        )}

        {/* Sections as expandable cards */}
        <div className="space-y-3">
          {current.sections.map((s, i) => {
            const key = `${current.id}-${i}`;
            const isOpen = expanded[key] !== false; // default open
            return (
              <div
                key={key}
                className={cn(
                  "bg-white rounded-xl border transition-all",
                  isOpen ? "border-gray-200 shadow-sm" : "border-gray-100"
                )}
              >
                <button
                  onClick={() => toggle(key)}
                  className="w-full text-left px-5 py-4 flex items-start gap-3"
                  aria-expanded={isOpen}
                >
                  <span
                    className="shrink-0 w-7 h-7 rounded-lg grid place-items-center text-white text-xs font-bold mt-0.5"
                    style={{ background: current.color }}
                  >
                    {i + 1}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm sm:text-base font-bold text-[#0E1A38]">
                      {s.heading}
                    </span>
                    {!isOpen && (
                      <span className="block text-xs text-gray-500 mt-0.5 truncate">
                        {s.body.slice(0, 90)}…
                      </span>
                    )}
                  </span>
                  <ChevronDown
                    size={16}
                    className={cn(
                      "shrink-0 text-gray-400 transition-transform mt-1",
                      isOpen && "rotate-180"
                    )}
                  />
                </button>
                {isOpen && (
                  <div className="px-5 pb-5 pl-[3.25rem]">
                    <p className="text-sm text-gray-600 leading-relaxed">{s.body}</p>
                    {s.tip && (
                      <div className="mt-3 flex items-start gap-2 bg-[#FBF3DE] border border-[#F1DFB4] rounded-lg px-3 py-2.5">
                        <Sparkles size={13} className="text-[#AD7C25] mt-0.5 shrink-0" />
                        <p className="text-xs text-[#8C6318] leading-relaxed">
                          <strong>Tip:</strong> {s.tip}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Navigation footer */}
        <div className="mt-12 flex items-center justify-between border-t border-gray-200 pt-6 print:hidden">
          {activeIdx > 0 ? (
            <button
              onClick={() => setActiveIdx(activeIdx - 1)}
              className="flex items-center gap-2 text-sm font-medium text-[#0E1A38] hover:underline"
            >
              <ChevronLeft size={15} />
              <span className="hidden sm:inline">{CHAPTERS[activeIdx - 1].title}</span>
              <span className="sm:hidden">Previous</span>
            </button>
          ) : <span />}

          <span className="text-xs text-gray-400">
            {activeIdx + 1} of {CHAPTERS.length}
          </span>

          {activeIdx < CHAPTERS.length - 1 ? (
            <button
              onClick={() => setActiveIdx(activeIdx + 1)}
              className="flex items-center gap-2 text-sm font-medium text-[#0E1A38] hover:underline"
            >
              <span className="hidden sm:inline">{CHAPTERS[activeIdx + 1].title}</span>
              <span className="sm:hidden">Next</span>
              <ChevronRight size={15} />
            </button>
          ) : <span />}
        </div>
      </div>

      {/* ========== Mobile FAB (chapter list) ========== */}
      <MobileChapterFab
        chapters={CHAPTERS}
        activeIdx={activeIdx}
        onSelect={setActiveIdx}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function MobileChapterFab({
  chapters, activeIdx, onSelect,
}: {
  chapters: Chapter[];
  activeIdx: number;
  onSelect: (i: number) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="lg:hidden print:hidden">
      {/* Floating button */}
      <button
        onClick={() => setOpen(true)}
        aria-label="Open chapter list"
        className="fixed bottom-6 right-6 z-30 w-12 h-12 rounded-full bg-[#0E1A38] text-white shadow-xl grid place-items-center active:scale-95 transition-transform"
      >
        <List size={20} />
      </button>

      {/* Bottom sheet */}
      {open && (
        <div className="fixed inset-0 z-40 flex items-end" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="relative w-full bg-white rounded-t-2xl max-h-[70vh] overflow-y-auto animate-slideUp"
            onClick={e => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-3 flex items-center justify-between">
              <span className="text-sm font-bold text-[#0E1A38]">Chapters</span>
              <button onClick={() => setOpen(false)} className="p-1 rounded hover:bg-gray-100">
                <X size={18} className="text-gray-500" />
              </button>
            </div>
            <ul className="p-3 space-y-1 list-none m-0">
              {chapters.map((ch, i) => (
                <li key={ch.id}>
                  <button
                    onClick={() => { onSelect(i); setOpen(false); }}
                    className={cn(
                      "w-full text-left flex items-center gap-3 px-4 py-3 rounded-xl transition-colors",
                      i === activeIdx ? "bg-[#0E1A38] text-white" : "hover:bg-gray-50"
                    )}
                  >
                    <span
                      className={cn(
                        "w-7 h-7 rounded-lg grid place-items-center text-[10px] font-bold shrink-0",
                        i === activeIdx ? "bg-[#AD7C25] text-white" : "bg-gray-100 text-gray-600"
                      )}
                    >
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className={cn(
                      "text-sm font-medium",
                      i === activeIdx ? "text-white" : "text-gray-800"
                    )}>
                      {ch.title}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <style jsx>{`
        @keyframes slideUp {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
        .animate-slideUp {
          animation: slideUp 0.25s ease-out;
        }
      `}</style>
    </div>
  );
}
