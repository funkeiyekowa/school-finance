import { supabase } from "@/lib/supabase";

/**
 * Student / parent fees & payments view — read-only.
 *
 * Reuses fetchLinkedStudents() from my-attendance-service.ts, so the student
 * set is resolved through my_linked_student_ids() exactly once, the same way
 * for both features.
 *
 * Security boundary (already in the database, not reimplemented here):
 *
 *   fee_schedules  — phase1_fees_member_read: any authenticated org member may
 *     SELECT (it is the published price list, not payment data — the same
 *     policy that lets a parent see "what is owed" without being finance
 *     staff). Only INSERT/UPDATE/DELETE are finance-gated.
 *
 *   income_entries — TWO SELECT policies apply, and Postgres OR's them:
 *     phase1_income_finance_all   (finance/staff role, same-org)
 *     phase1_income_self_read     (student_id IN my_linked_student_ids(),
 *                                   same-org)
 *     A parent/student account only ever satisfies the second policy, so a
 *     payment row for another family is unreachable server-side no matter
 *     what student_id this client asks for. The .in("student_id", ids) filter
 *     below is for query shape and pagination only — it is not the security
 *     boundary, exactly as on the web my-children page this mirrors.
 */

export interface FeeItem {
  id: string;
  name: string;
  amount: number;
  grade: string | null;
}

export interface PaymentRow {
  id: string;
  receiptNo: string;
  date: string;
  amount: number;
  category: string;
  studentId: string;
}

export interface ChildFeeSummary {
  student: { id: string; fullName: string; grade: string | null };
  fees: FeeItem[];
  totalDue: number;
  payments: PaymentRow[];
  totalPaid: number;
  balance: number;
}

/**
 * All active fee schedule lines. Org-wide reference data — fetched once and
 * filtered per-child by grade on the client, same as the web page.
 */
export async function fetchActiveFees(): Promise<FeeItem[]> {
  const { data, error } = await supabase
    .from("fee_schedules")
    .select("id, name, amount, grade")
    .eq("active", true);
  if (error) throw new Error("Could not load the fee schedule.");
  return ((data as { id: string; name: string; amount: number; grade: string | null }[]) ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    amount: Number(r.amount) || 0,
    grade: r.grade,
  }));
}

/**
 * Payments for the given students, most recent first. Capped client-side per
 * student to keep the "recent payments" list short, matching the web page.
 */
export async function fetchPayments(studentIds: string[]): Promise<PaymentRow[]> {
  if (studentIds.length === 0) return [];
  const { data, error } = await supabase
    .from("income_entries")
    .select("id, receipt_no, date, amount, category, student_id")
    .in("student_id", studentIds)
    .order("date", { ascending: false });
  if (error) throw new Error("Could not load payment history.");
  return (
    (data as { id: string; receipt_no: string; date: string; amount: number; category: string; student_id: string }[]) ?? []
  ).map((r) => ({
    id: r.id,
    receiptNo: r.receipt_no,
    date: r.date,
    amount: Number(r.amount) || 0,
    category: r.category,
    studentId: r.student_id,
  }));
}

const MAX_RECENT_PAYMENTS = 10;

/** Builds a per-child fees/payments summary from already-fetched fees and payments. */
export function summariseChild(
  student: { id: string; fullName: string; grade: string | null },
  fees: FeeItem[],
  payments: PaymentRow[],
): ChildFeeSummary {
  const childFees = fees.filter((f) => !f.grade || f.grade === student.grade);
  const totalDue = childFees.reduce((s, f) => s + f.amount, 0);
  const childPayments = payments.filter((p) => p.studentId === student.id).slice(0, MAX_RECENT_PAYMENTS);
  const totalPaid = childPayments.reduce((s, p) => s + p.amount, 0);
  return {
    student,
    fees: childFees,
    totalDue,
    payments: childPayments,
    totalPaid,
    balance: totalDue - totalPaid,
  };
}

/** Nigerian Naira formatting, matching the web app's fmtMoney(). */
export function fmtMoney(amount: number | null | undefined): string {
  const n = Number(amount) || 0;
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString("en-NG", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return `${n < 0 ? "-" : ""}₦${formatted}`;
}

export function prettyDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
