import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

type NumberedInsertResult<K extends string> = {
  number: string | null;
  error: PostgrestError | null;
} & Record<K, string | null>;

export type IncomeEntryInput = {
  organization_id?: string;
  date: string;
  student_id?: string | null;
  student_name?: string | null;
  category: string;
  description?: string | null;
  amount: number;
  payment_method: string;
  term?: string | null;
  recorded_by?: string | null;
  reconciled?: boolean;
  payment_source?: string;
  sms_inbox_id?: string | null;
  notes?: string | null;
};

export type ExpenseEntryInput = {
  organization_id?: string;
  date: string;
  vendor_id?: string | null;
  vendor_name?: string | null;
  category: string;
  description?: string | null;
  amount: number;
  payment_method: string;
  approved_by?: string | null;
  reconciled?: boolean;
  notes?: string | null;
};

export async function insertIncomeWithReceipt(
  supabase: SupabaseClient,
  entry: IncomeEntryInput,
): Promise<NumberedInsertResult<"receiptNo">> {
  const { data, error } = await supabase
    .from("income_entries")
    .insert(entry)
    .select("receipt_no")
    .single();
  const receiptNo = data?.receipt_no ?? null;

  return { number: receiptNo, receiptNo, error };
}

export async function insertExpenseWithVoucher(
  supabase: SupabaseClient,
  entry: ExpenseEntryInput,
): Promise<NumberedInsertResult<"voucherNo">> {
  const { data, error } = await supabase
    .from("expense_entries")
    .insert(entry)
    .select("voucher_no")
    .single();
  const voucherNo = data?.voucher_no ?? null;

  return { number: voucherNo, voucherNo, error };
}
