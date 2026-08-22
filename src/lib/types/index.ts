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

export const APP_FEATURES = [
  { key: "income", label: "Income Ledger" },
  { key: "expenses", label: "Expense Ledger" },
  { key: "students", label: "Students" },
  { key: "vendors", label: "Vendors" },
  { key: "reconciliation", label: "Reconciliation" },
  { key: "reports", label: "Reports" },
  { key: "receipts", label: "Receipts" },
  { key: "setup", label: "Setup" },
  { key: "roles", label: "Roles" },
  { key: "team", label: "Team / Users" },
  { key: "activity", label: "Activity Log" },
  { key: "sms_alerts", label: "Payment Alerts (SMS)" },
] as const;

export type FeatureKey = (typeof APP_FEATURES)[number]["key"];

export const ROLE_RANK: Record<string, number> = {
  pending: 0,
  viewer: 1,
  staff: 2,
  editor: 2,
  admin: 3,
};
