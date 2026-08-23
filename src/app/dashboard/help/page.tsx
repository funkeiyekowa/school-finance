"use client";

import { useState } from "react";
import { useAuth } from "@/lib/context/AuthContext";
import { cn } from "@/lib/utils";
import {
  BookOpen, LayoutDashboard, TrendingUp, TrendingDown, GraduationCap,
  ArrowLeftRight, Users, Clock, FileBarChart, Shield, Package, HelpCircle,
  ChevronRight, Search, Printer, BarChart3,
} from "lucide-react";

interface Chapter {
  id: string;
  title: string;
  icon: React.ReactNode;
  image?: string;
  imageAlt?: string;
  intro: string;
  sections: { heading: string; body: string }[];
}

const CHAPTERS: Chapter[] = [
  {
    id: "dashboard",
    title: "Your Dashboard",
    icon: <LayoutDashboard size={16} />,
    image: "/guide/preview.webp",
    imageAlt: "The main dashboard showing total income, expenses, net position, outstanding fees, cash flow chart, and fee balances",
    intro: "The Dashboard is the first screen you see after signing in. Every figure is pulled live from your ledgers — nothing is cached or estimated.",
    sections: [
      {
        heading: "KPI Cards",
        body: "The top row shows four key numbers: Total Income (all receipts), Total Expenses (all vouchers), Net Position (income minus expenses), and Outstanding Fees (what students still owe). These update in real time as transactions are recorded.",
      },
      {
        heading: "Cash Flow Chart",
        body: "Shows income (green/gold) and expenses (red) over the last six months. The gap between the two lines is your surplus or deficit. Hover on any month for exact figures.",
      },
      {
        heading: "Fee Balances",
        body: "The right panel lists students with the highest outstanding balances. Click 'All students' to see the full list. Click any student name to open their profile and record a payment.",
      },
      {
        heading: "SMS Alerts Banner",
        body: "If your school receives payment notifications via SMS or email, unprocessed alerts appear in an amber banner. Click 'Review' to match them against students.",
      },
    ],
  },
  {
    id: "income",
    title: "Income (Receipts)",
    icon: <TrendingUp size={16} />,
    image: "/guide/preview_1.webp",
    imageAlt: "Income Ledger showing a table of payment receipts with receipt numbers, dates, students, categories, and amounts",
    intro: "Every payment the school receives is recorded here as a receipt. The system auto-generates receipt numbers (RCT-0001, RCT-0002, etc.) that are unique to your school.",
    sections: [
      {
        heading: "Recording a Payment",
        body: "Click '+ Record Payment' in the top right. Fill in the student, amount, category (School Fees, Transport, etc.), payment method, and any notes. The receipt number is generated automatically.",
      },
      {
        heading: "Viewing a Receipt",
        body: "Click the 'Receipt' button on any row to see the full payment receipt with your school name, amount, student, and a 'Download PDF' option you can print or email to parents.",
      },
      {
        heading: "Searching and Filtering",
        body: "Use the search bar to find by receipt number, student name, or category. The dropdown filters let you narrow by category or reconciliation status.",
      },
      {
        heading: "Reconciliation",
        body: "The circle in the 'Recon.' column shows whether a payment has been matched against a bank statement. Green tick = reconciled. Empty circle = pending. Use the Reconciliation module to match in bulk.",
      },
      {
        heading: "Export",
        body: "Click 'Export CSV' to download all visible records as a spreadsheet. Useful for sharing with auditors or importing into accounting software.",
      },
    ],
  },
  {
    id: "receipt",
    title: "Payment Receipts",
    icon: <FileBarChart size={16} />,
    image: "/guide/preview_2.webp",
    imageAlt: "A payment receipt modal showing school name, receipt number, date, student, category, amount paid, and download button",
    intro: "Every recorded payment can be viewed as a formal receipt. This is what you print or send to parents as proof of payment.",
    sections: [
      {
        heading: "What the Receipt Shows",
        body: "School name, receipt number, date, student name, payment category, description (e.g. SMS or bank alert reference), payment method, term, who recorded it, and the amount paid. The footer shows your school's configured receipt message.",
      },
      {
        heading: "Download PDF",
        body: "Click 'Download PDF' to generate a printable receipt. The PDF uses your school branding (name, logo if configured in Setup).",
      },
      {
        heading: "Auto-Credit Receipts",
        body: "When the system automatically creates a receipt from an SMS or email alert, the 'Recorded By' field shows 'System (Auto-Credit)'. These still appear in the ledger and can be reconciled normally.",
      },
    ],
  },
  {
    id: "expenses",
    title: "Expenses (Vouchers)",
    icon: <TrendingDown size={16} />,
    image: "/guide/preview_3.webp",
    imageAlt: "Expense Ledger showing voucher numbers, dates, vendors, categories, descriptions, and amounts in red",
    intro: "Every naira going out of the school is recorded as an expense voucher. The system generates voucher numbers (VCH-0001, etc.) unique to your school.",
    sections: [
      {
        heading: "Recording an Expense",
        body: "Click '+ Record Expense'. Select or type a vendor name, choose a category (Utilities, Transport, Salaries, etc.), enter the amount, payment method, and optional approval details.",
      },
      {
        heading: "Auto-Expense from Bank Alerts",
        body: "If your school has the SMS/email alert system active, debit alerts are automatically recorded as expenses with 'System (Auto-Expense)' in the Approved By column. You can edit the vendor and category afterwards.",
      },
      {
        heading: "Categories",
        body: "Expense categories are customizable under Setup. Common ones: Utilities, Salaries, Transport, Maintenance, Supplies, Other Expense.",
      },
    ],
  },
  {
    id: "students",
    title: "Student Management",
    icon: <GraduationCap size={16} />,
    image: "/guide/preview_4.webp",
    imageAlt: "Students page showing 101 registered students with payment status cards and a searchable table with student IDs, names, grades, and balances",
    intro: "Students are the anchor for everything else — fees, attendance, assessments, and promotion all hang off the student record.",
    sections: [
      {
        heading: "Adding a Student",
        body: "Click '+ Add Student'. Fill in their name, grade, gender, guardian details, and admission date. The student code is auto-generated. You can also use 'Import' to upload students from a CSV spreadsheet.",
      },
      {
        heading: "Payment Status Cards",
        body: "The top shows: Paid in Full (green), Part Paid (amber), Unpaid (red), and Total Outstanding (the sum of all unpaid balances). These update as payments come in.",
      },
      {
        heading: "Student Profile",
        body: "Click 'View' on any student to see their full record: personal details, applicable fee schedule, payment history, and academic history (enrollments and promotions).",
      },
      {
        heading: "Fee Schedule",
        body: "Each student's profile shows which fees apply to them based on their grade and the current fee schedules you've set up. The 'Record Payment' button here pre-fills their details.",
      },
    ],
  },
  {
    id: "student-detail",
    title: "Student Profile & Fees",
    icon: <GraduationCap size={16} />,
    image: "/guide/preview_5.webp",
    imageAlt: "Student detail page for Abdullahi Aleem showing total due, total paid, balance, applicable fee schedule, and payment history",
    intro: "The student detail page shows everything about one student: what they owe, what they've paid, and their academic history.",
    sections: [
      {
        heading: "Fee Summary",
        body: "The top cards show Total Due (sum of all applicable fee schedules), Total Paid (sum of all receipts), and Balance (the difference). A green 'Paid in full' badge appears when balance is zero.",
      },
      {
        heading: "Applicable Fee Schedule",
        body: "Shows which fees apply to this student based on their grade and current term. Example: Tuition (₦25,000) + Note Books (₦2,000) = ₦27,000 total due.",
      },
      {
        heading: "Payment History",
        body: "Every receipt linked to this student appears here with the receipt number, date, category, method, amount, and reconciliation status.",
      },
      {
        heading: "Recording a Payment from Here",
        body: "Click 'Record Payment' to open the payment form with the student already selected. Useful when a parent comes in person.",
      },
    ],
  },
  {
    id: "promotion",
    title: "Promotion Center",
    icon: <ArrowLeftRight size={16} />,
    image: "/guide/preview_6.webp",
    imageAlt: "Promotion Center showing academic year transition from 2025/2026 to 2026/2027, with status counts and student list showing destinations",
    intro: "At the end of each academic year, promote students to their next class in bulk. The system figures out where each student goes based on the class structure.",
    sections: [
      {
        heading: "How It Works",
        body: "Select the 'From' year (the one ending) and 'To' year (the one starting). The system shows every student with their current class and calculated destination. Students in the final class (e.g. SSS2) are marked 'NO NEXT CLASS'.",
      },
      {
        heading: "Status Cards",
        body: "Total Students, Ready (have a destination), Already Promoted, Graduating, No Next Class (need attention), Inactive, No Enrollment.",
      },
      {
        heading: "Batch Promotion",
        body: "Tick the students you want to promote (or use the header checkbox for all), then click 'Promote X Students'. They move to their destination class in the new academic year.",
      },
      {
        heading: "Repeat a Student",
        body: "Click 'repeat' in the Action column to keep a student in their current class for the new year instead of promoting them.",
      },
    ],
  },
  {
    id: "attendance",
    title: "Attendance",
    icon: <Clock size={16} />,
    image: "/guide/preview_7.webp",
    imageAlt: "Attendance page for JSS1 showing student list with Present, Absent, Late, Excused, and Sick radio buttons",
    intro: "A daily register for every class. Select the class, date, and session, then mark each student. Quick buttons let you mark all present/absent in one click.",
    sections: [
      {
        heading: "Taking Attendance",
        body: "Choose the Class (e.g. JSS1), Date, and Session (Full Day, Morning, Afternoon). The student list loads automatically. Click the radio button for each student's status.",
      },
      {
        heading: "Quick Buttons",
        body: "'All Present' marks everyone green in one click — useful when only a few are absent. Then just change the exceptions. Same for 'All Absent', 'All Late', etc.",
      },
      {
        heading: "Summary Bar",
        body: "Shows the count and percentage: '18 students · 18 present · 0 absent (100% attendance)'. This updates as you mark.",
      },
      {
        heading: "Saving",
        body: "Attendance saves automatically as you click each radio button. There's no separate Save button needed.",
      },
    ],
  },
  {
    id: "assessments",
    title: "Assessments & Gradebook",
    icon: <FileBarChart size={16} />,
    image: "/guide/preview_9.webp",
    imageAlt: "Assessments page showing Mathematics for JSS1 with CA1, CA2, ASG, and EXAM columns and auto-calculated totals and grades",
    intro: "Enter continuous assessment scores, test marks, and exam results. The system calculates totals and grades automatically based on your grading scale.",
    sections: [
      {
        heading: "Selecting What to Grade",
        body: "Choose Class (JSS1), Subject (Mathematics), and Term (Term 1). The gradebook loads with all enrolled students and the assessment columns.",
      },
      {
        heading: "Columns",
        body: "CA1 (/10), CA2 (/10), ASG (/10), EXAM (/70). The 'Total' column adds them up out of 100. The 'Grade' column applies your grading scale (A, B, C, D, F).",
      },
      {
        heading: "Entering Scores",
        body: "Click any cell and type the score. Tab to move to the next. Scores save automatically. The total and grade recalculate instantly.",
      },
      {
        heading: "Grading Scale",
        body: "The default scale: A (70-100), B (60-69), C (50-59), D (40-49), F (0-39). Customize this in Setup if your school uses different boundaries.",
      },
    ],
  },
  {
    id: "staff",
    title: "Staff Records",
    icon: <Users size={16} />,
    image: "/guide/preview_10.webp",
    imageAlt: "Staff Directory with the Add Staff modal showing fields for code, name, email, phone, job title, type, department, and status",
    intro: "A directory of everyone who works at the school — teaching and non-teaching staff. Separate from login accounts (Team page).",
    sections: [
      {
        heading: "Adding Staff",
        body: "Click '+ Add Staff'. Enter their Staff Code (e.g. STF001), Full Name, Email, Phone, Job Title, Staff Type (Teaching/Non-Teaching), Department, Date Joined, and Status.",
      },
      {
        heading: "Staff vs Team",
        body: "The Staff page is an HR directory. The Team page controls who can log in. A person can be in Staff without having a login account, and vice versa.",
      },
      {
        heading: "KPI Cards",
        body: "Total Staff, Teaching staff count, Non-Teaching count, and Inactive count. Filter and search by name, code, email, or title.",
      },
    ],
  },
  {
    id: "inventory",
    title: "Inventory",
    icon: <Package size={16} />,
    image: "/guide/preview_11.webp",
    imageAlt: "Inventory page with Add Item modal showing fields for item name, code, category, unit, quantity, reorder level, cost, and location",
    intro: "Track what the school owns and what it's running low on — from furniture to exercise books to laboratory chemicals.",
    sections: [
      {
        heading: "Adding an Item",
        body: "Click '+ Add Item'. Enter the Item Name (Whiteboard Marker), Code (WBM001), Category (Stationery), Unit (Pieces), starting Quantity, Reorder Level (when to buy more), Unit Cost, and Location (Store Room A).",
      },
      {
        heading: "Low Stock Alerts",
        body: "When an item's quantity drops to or below its Reorder Level, it appears in the 'Low Stock' count on the KPI card. This is your prompt to reorder.",
      },
      {
        heading: "Tracking Value",
        body: "Total Value shows the sum of (quantity × unit cost) across all items. Useful for insurance and auditing purposes.",
      },
    ],
  },
  {
    id: "analytics",
    title: "Analytics",
    icon: <BarChart3 size={16} />,
    image: "/guide/preview_12.webp",
    imageAlt: "Analytics page showing KPIs for students, revenue, expenses, fee collection rate, outstanding balance, attendance rate, and exam average, with monthly revenue bar and enrollment by class chart",
    intro: "A high-level performance overview pulling data from every module. Available to admins, bursars, and owners.",
    sections: [
      {
        heading: "KPI Row",
        body: "Active Students, Total Revenue, Total Expenses, Net Balance, Fee Collection %, Outstanding balance, Attendance Rate, and Exam Average. Each has a colour-coded icon indicating health.",
      },
      {
        heading: "Monthly Revenue",
        body: "A bar chart showing income collected each month. Helps spot seasonal patterns (e.g. term start vs mid-term).",
      },
      {
        heading: "Enrollment by Class",
        body: "Horizontal bar chart showing how many students are in each class. Useful for staffing and resource planning.",
      },
      {
        heading: "Quick Insights",
        body: "Three cards with AI-style observations: Revenue Health (collection rate and outstanding), Attendance (below target warning), and Academic Performance (exam data summary).",
      },
    ],
  },
];

export default function HelpPage() {
  const { org } = useAuth();
  const [active, setActive] = useState<string>("dashboard");
  const [search, setSearch] = useState("");

  const filtered = search.trim()
    ? CHAPTERS.filter(ch =>
        ch.title.toLowerCase().includes(search.toLowerCase()) ||
        ch.intro.toLowerCase().includes(search.toLowerCase()) ||
        ch.sections.some(s =>
          s.heading.toLowerCase().includes(search.toLowerCase()) ||
          s.body.toLowerCase().includes(search.toLowerCase())
        )
      )
    : CHAPTERS;

  const current = CHAPTERS.find(ch => ch.id === active) ?? CHAPTERS[0];

  return (
    <div className="flex h-[calc(100vh-0px)] overflow-hidden">
      {/* Sidebar / TOC */}
      <aside className="w-72 shrink-0 bg-[#0E1A38] text-white overflow-y-auto border-r border-[#1B3269] hidden lg:block">
        <div className="p-5 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[#F1DFB4] to-[#AD7C25] flex items-center justify-center shadow-lg">
              <BookOpen size={16} className="text-[#0E1A38]" />
            </div>
            <div>
              <div className="font-semibold text-sm">{org?.name ?? "School"} Manual</div>
              <div className="text-[10px] uppercase tracking-wider text-[#9FB0D6]">Operations Guide</div>
            </div>
          </div>
        </div>

        <div className="p-3">
          <div className="relative mb-3">
            <Search size={14} className="absolute left-3 top-2.5 text-[#7C88A8]" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Find a topic…"
              aria-label="Search help topics"
              className="w-full bg-white/5 border border-white/10 rounded-lg pl-8 pr-3 py-2 text-xs text-white placeholder:text-[#7C88A8] outline-none focus:border-[#AD7C25]"
            />
          </div>

          <nav aria-label="Help chapters">
            <ul className="space-y-0.5 list-none p-0 m-0">
              {filtered.map((ch, i) => (
                <li key={ch.id}>
                  <button
                    onClick={() => setActive(ch.id)}
                    className={cn(
                      "w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] transition-colors",
                      active === ch.id
                        ? "bg-[#AD7C25]/20 text-[#F5DFA0]"
                        : "text-[#C4CFE8] hover:bg-white/5 hover:text-white"
                    )}
                  >
                    <span className="text-[10px] font-mono text-[#5E6C90] w-4 shrink-0">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="shrink-0">{ch.icon}</span>
                    <span className="truncate">{ch.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <div className="p-3 border-t border-white/10 mt-2">
          <button
            onClick={() => window.print()}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-[#E7ECF7] text-xs hover:bg-white/10 transition-colors"
          >
            <Printer size={13} /> Print this page
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto bg-[#EEF0EE]">
        {/* Mobile chapter selector */}
        <div className="lg:hidden sticky top-0 z-10 bg-[#0E1A38] px-4 py-3 flex items-center gap-3">
          <BookOpen size={16} className="text-[#AD7C25] shrink-0" />
          <select
            value={active}
            onChange={e => setActive(e.target.value)}
            aria-label="Select chapter"
            className="flex-1 bg-white/10 border border-white/10 text-white text-sm rounded-lg px-3 py-1.5"
          >
            {CHAPTERS.map((ch, i) => (
              <option key={ch.id} value={ch.id}>
                {String(i + 1).padStart(2, "0")}. {ch.title}
              </option>
            ))}
          </select>
        </div>

        <div className="max-w-4xl mx-auto px-5 py-10">
          {/* Chapter header */}
          <div className="mb-8">
            <div className="text-xs font-mono uppercase tracking-wider text-[#AD7C25] mb-2">
              Chapter {String(CHAPTERS.indexOf(current) + 1).padStart(2, "0")}
            </div>
            <h1 className="text-3xl font-bold text-[#0E1A38] mb-3" style={{ fontFamily: "'Georgia', serif" }}>
              {current.title}
            </h1>
            <p className="text-base text-[#4C5468] leading-relaxed max-w-2xl">
              {current.intro}
            </p>
          </div>

          {/* Screenshot */}
          {current.image && (
            <figure className="mb-10 border border-[#D9D4C5] rounded-xl overflow-hidden shadow-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={current.image}
                alt={current.imageAlt ?? `Screenshot of ${current.title}`}
                className="w-full"
                loading="lazy"
              />
              <figcaption className="px-5 py-3 text-xs text-[#7B8296] border-t border-[#D9D4C5] bg-[#FBFBF9]">
                {current.imageAlt}
              </figcaption>
            </figure>
          )}

          {/* Sections */}
          <div className="space-y-8">
            {current.sections.map((s, i) => (
              <section key={i} className="bg-white border border-[#E5E1D4] rounded-xl p-6 shadow-sm">
                <h2 className="text-lg font-bold text-[#0E1A38] mb-3 flex items-center gap-2">
                  <ChevronRight size={16} className="text-[#AD7C25]" />
                  {s.heading}
                </h2>
                <p className="text-sm text-[#4C5468] leading-relaxed">{s.body}</p>
              </section>
            ))}
          </div>

          {/* Navigation */}
          <div className="mt-12 flex items-center justify-between border-t border-[#D9D4C5] pt-6">
            {CHAPTERS.indexOf(current) > 0 ? (
              <button
                onClick={() => setActive(CHAPTERS[CHAPTERS.indexOf(current) - 1].id)}
                className="text-sm text-[#0E1A38] hover:underline flex items-center gap-1"
              >
                <ChevronRight size={14} className="rotate-180" />
                {CHAPTERS[CHAPTERS.indexOf(current) - 1].title}
              </button>
            ) : <span />}
            {CHAPTERS.indexOf(current) < CHAPTERS.length - 1 ? (
              <button
                onClick={() => setActive(CHAPTERS[CHAPTERS.indexOf(current) + 1].id)}
                className="text-sm text-[#0E1A38] hover:underline flex items-center gap-1"
              >
                {CHAPTERS[CHAPTERS.indexOf(current) + 1].title}
                <ChevronRight size={14} />
              </button>
            ) : <span />}
          </div>
        </div>
      </main>
    </div>
  );
}
