import type { Database } from "./database";

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type Student = Database["public"]["Tables"]["students"]["Row"];
export type Vendor = Database["public"]["Tables"]["vendors"]["Row"];
export type IncomeEntry = Database["public"]["Tables"]["income_entries"]["Row"];
export type ExpenseEntry = Database["public"]["Tables"]["expense_entries"]["Row"];
export type FeeSchedule = Database["public"]["Tables"]["fee_schedules"]["Row"];
export type BankTransaction = Database["public"]["Tables"]["bank_transactions"]["Row"];
export type SmsInbox = Database["public"]["Tables"]["sms_inbox"]["Row"];
export type ActivityLog = Database["public"]["Tables"]["activity_log"]["Row"];
export type SchoolSettings = Database["public"]["Tables"]["school_settings"]["Row"];
export type Role = Database["public"]["Tables"]["roles"]["Row"];
export type SchoolClass = Database["public"]["Tables"]["classes"]["Row"];
export type AcademicYear = Database["public"]["Tables"]["academic_years"]["Row"];
export type StudentEnrollment = Database["public"]["Tables"]["student_enrollments"]["Row"];
export type PromotionBatch = Database["public"]["Tables"]["promotion_batches"]["Row"];
export type PromotionEvent = Database["public"]["Tables"]["promotion_events"]["Row"];
export type Organization = Database["public"]["Tables"]["organizations"]["Row"];
export type PlatformModule = Database["public"]["Tables"]["platform_modules"]["Row"];
export type Subscription = Database["public"]["Tables"]["subscriptions"]["Row"];
export type OrgMembership = Database["public"]["Tables"]["org_memberships"]["Row"];
export type Subject = Database["public"]["Tables"]["subjects"]["Row"];
export type AttendanceStatus = Database["public"]["Tables"]["attendance_statuses"]["Row"];
export type AttendanceRecord = Database["public"]["Tables"]["attendance_records"]["Row"];
export type Period = Database["public"]["Tables"]["periods"]["Row"];
export type TimetableEntry = Database["public"]["Tables"]["timetable_entries"]["Row"];
export type AssessmentType = Database["public"]["Tables"]["assessment_types"]["Row"];
export type GradingScale = Database["public"]["Tables"]["grading_scales"]["Row"];
export type StudentScore = Database["public"]["Tables"]["student_scores"]["Row"];
export type Question = Database["public"]["Tables"]["questions"]["Row"];
export type Exam = Database["public"]["Tables"]["exams"]["Row"];
export type ExamQuestion = Database["public"]["Tables"]["exam_questions"]["Row"];
export type ExamAttempt = Database["public"]["Tables"]["exam_attempts"]["Row"];
export type ExamAnswer = Database["public"]["Tables"]["exam_answers"]["Row"];

export type PaymentStatus = "paid" | "partial" | "unpaid";

export interface StudentWithBalance extends Student {
  total_due: number;
  total_paid: number;
  balance: number;
  payment_status: PaymentStatus;
}

export interface DashboardData {
  totalIncome: number;
  totalExpenses: number;
  netBalance: number;
  outstandingFees: number;
  unreconciledIncome: number;
  unreconciledExpenses: number;
  incomeByCategory: { name: string; value: number }[];
  expenseByCategory: { name: string; value: number }[];
  monthlyCashFlow: { month: string; income: number; expenses: number }[];
  studentBalances: StudentWithBalance[];
  recentIncome: IncomeEntry[];
  smsAlertsNeedReview: number;
}

export const INCOME_CATEGORIES = [
  "School Fees",
  "Textbook Sales",
  "Uniform Sales",
  "Transport Fees",
  "Registration Fees",
  "Donations & Grants",
  "Other Income",
] as const;

export const EXPENSE_CATEGORIES = [
  "Rent",
  "Utilities",
  "Salaries & Wages",
  "Teaching Supplies & Materials",
  "Maintenance & Repairs",
  "Transport",
  "Textbook Purchases",
  "Administrative & Office",
  "Insurance",
  "Other Expense",
] as const;

export const PAYMENT_METHODS = [
  "Cash",
  "Bank Transfer",
  "Cheque",
  "Mobile Money",
  "Card",
] as const;

export const VENDOR_CATEGORIES = [
  "Landlord",
  "Utility Provider",
  "Supplier",
  "Contractor",
  "Staff/Payroll",
  "Government/Tax",
  "Insurance Provider",
  "Other",
] as const;

/**
 * Full permission matrix. Each entry is one screen or write action the
 * app checks against the current user's `permissions` map. Grouped so
 * the Roles UI can render them by area.
 */
export const APP_FEATURES = [
  // ---- Finance ----
  { key: "income", label: "Income Ledger", group: "Finance" },
  { key: "expenses", label: "Expense Ledger", group: "Finance" },
  { key: "receipts", label: "Receipts", group: "Finance" },
  { key: "reconciliation", label: "Reconciliation", group: "Finance" },
  { key: "sms_alerts", label: "Payment Alerts (SMS)", group: "Finance" },
  { key: "student_finance", label: "Student Finance", group: "Finance" },
  { key: "vendors", label: "Vendors", group: "Finance" },
  { key: "finance_overview", label: "Finance Overview", group: "Finance" },
  // ---- Students & Academics ----
  { key: "students", label: "Students", group: "Academics" },
  { key: "attendance", label: "Attendance", group: "Academics" },
  { key: "timetable", label: "Timetable", group: "Academics" },
  { key: "assessments", label: "Assessments", group: "Academics" },
  { key: "cbt", label: "CBT / Exams", group: "Academics" },
  { key: "report_cards", label: "Report Cards", group: "Academics" },
  { key: "promotion", label: "Promotion", group: "Academics" },
  // ---- Portals (self-service) ----
  { key: "student_portal", label: "Student Portal", group: "Portals" },
  { key: "parent_portal", label: "Parent Portal", group: "Portals" },
  { key: "teacher_portal", label: "Teacher Portal", group: "Portals" },
  { key: "my_exams", label: "My Exams", group: "Portals" },
  { key: "my_results", label: "My Results", group: "Portals" },
  { key: "my_children", label: "My Children", group: "Portals" },
  // ---- People / HR ----
  { key: "staff", label: "Staff Directory", group: "People" },
  { key: "team", label: "Team / Users", group: "People" },
  { key: "roles", label: "Roles & Permissions", group: "People" },
  // ---- Communication ----
  { key: "announcements", label: "Announcements", group: "Communication" },
  { key: "leads", label: "Enquiries (Leads)", group: "Communication" },
  { key: "website", label: "Website Studio", group: "Communication" },
  // ---- Operations ----
  { key: "inventory", label: "Inventory", group: "Operations" },
  { key: "automations", label: "Automations", group: "Operations" },
  // ---- Reporting / Admin ----
  { key: "reports", label: "Reports", group: "Admin" },
  { key: "analytics", label: "Analytics", group: "Admin" },
  { key: "activity", label: "Activity Log", group: "Admin" },
  { key: "setup", label: "Setup / Settings", group: "Admin" },
  { key: "platform", label: "Platform (Super Admin)", group: "Admin" },
] as const;

export type FeatureKey = (typeof APP_FEATURES)[number]["key"];

/**
 * Canonical permission presets for the built-in personas. The Roles
 * page seeds a new role for each of these when the button is used; the
 * `roles` table row is the persisted source of truth thereafter.
 */
export const ROLE_PRESETS: Record<string, Partial<Record<FeatureKey, boolean>>> = {
  student: {
    student_portal: true,
    my_exams: true,
    my_results: true,
    cbt: true,          // needed to sit an exam
    report_cards: true,
    attendance: true,   // read-only self attendance
    announcements: true,
  },
  parent: {
    parent_portal: true,
    my_children: true,
    report_cards: true,
    attendance: true,
    announcements: true,
  },
  teacher: {
    teacher_portal: true,
    attendance: true,
    assessments: true,
    cbt: true,
    students: true,     // scoped to their classes by teacher_assignments
    timetable: true,
    report_cards: true,
    announcements: true,
  },
  bursar: {
    finance_overview: true, income: true, expenses: true, receipts: true,
    reconciliation: true, sms_alerts: true, student_finance: true, vendors: true,
    reports: true, students: true,
  },
  editor: {
    students: true, attendance: true, assessments: true, cbt: true,
    report_cards: true, announcements: true, leads: true,
    income: true, expenses: true, receipts: true, reports: true,
  },
  viewer: {
    reports: true, analytics: true, students: true, attendance: true,
    report_cards: true, announcements: true,
  },
};

export const ROLE_RANK: Record<string, number> = {
  pending: 0,
  viewer: 1,
  staff: 2,
  editor: 2,
  admin: 3,
};
