/**
 * Bank alert processing pipeline — shared by the SMS and email webhooks.
 *
 * Each webhook is responsible only for normalising its own transport
 * format into `AlertInput`; everything after that (whitelist, parsing,
 * matching, dedupe, ledger posting) happens here so both channels behave
 * identically and stay in sync.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parseAlert,
  calculateConfidence,
  generatePaymentRef,
  detectExpenseCategory,
  parseBankDate,
  type ParsedAlert,
} from "./parser";
import {
  matchStudent,
  matchVendor,
  calculateMatchConfidence,
  type MatchResult,
  type VendorMatchResult,
} from "./matcher";

export type AlertChannel = "sms" | "email";

export interface AlertInput {
  channel: AlertChannel;
  /** Phone number for SMS, from-address for email. */
  sender: string | null;
  /** Plain-text alert body (email HTML must already be stripped). */
  messageText: string;
  /** ISO timestamp the alert was received. */
  receivedAt: string;
  /** Stable id from the transport, used for idempotency. */
  externalId: string;
  /** Second id where the transport provides one (SMS message id, email message id). */
  messageId: string;
  /** Email subject line, if applicable. */
  subject?: string | null;
  deviceId?: string | null;
  simNumber?: number | null;
  /** Original request body, stored for debugging. */
  rawPayload: unknown;
}

export interface AlertResult {
  success: boolean;
  skipped?: boolean;
  reason?: string;
  id?: string;
  type?: "income" | "expense";
  autoPosted?: boolean;
  parsed?: Record<string, unknown>;
  error?: string;
}

/** Window in which an identical transaction is treated as a repeat notification. */
const DEDUPE_WINDOW_MINUTES = 30;

/**
 * Run an incoming bank alert through the full pipeline.
 * `supabase` must be a service-role client — this runs unauthenticated.
 */
export async function processAlert(
  supabase: SupabaseClient,
  input: AlertInput
): Promise<AlertResult> {
  const { channel, sender, messageText, receivedAt, externalId, messageId } = input;

  if (!messageText?.trim()) {
    return { success: false, error: "No message text provided" };
  }

  // Load every setting we need in one round trip.
  const { data: settingsRow } = await supabase
    .from("school_settings")
    .select("*")
    .limit(1)
    .single();
  const settings = (settingsRow ?? {}) as Record<string, unknown>;

  // ---------- Idempotency ----------
  // Apps Script retries and SMS gateway retries can both redeliver the same
  // alert. An exact external-id match means we've already stored this one.
  const { data: alreadySeen } = await supabase
    .from("sms_inbox")
    .select("id")
    .or(`event_id.eq.${externalId},message_id.eq.${messageId}`)
    .limit(1);
  if (alreadySeen && alreadySeen.length > 0) {
    return {
      success: true,
      skipped: true,
      reason: "Already processed — this alert was delivered previously.",
      id: alreadySeen[0].id,
    };
  }

  // ---------- Sender whitelist ----------
  const allowedRaw =
    channel === "email"
      ? (settings.email_allowed_senders as string) || ""
      : (settings.sms_allowed_senders as string) || "";

  if (allowedRaw.trim()) {
    const allowedList = allowedRaw
      .split(",")
      .map(s => s.trim().toLowerCase())
      .filter(Boolean);
    const senderLower = (sender || "").toLowerCase();
    const isAllowed = allowedList.some(
      allowed => senderLower.includes(allowed) || allowed.includes(senderLower)
    );
    if (!isAllowed) {
      return {
        success: false,
        skipped: true,
        reason: `Sender "${sender}" is not in the allowed senders list for ${channel}. Alert ignored.`,
      };
    }
  }

  // The subject carries the direction and often the amount for banks that
  // don't use CR:/DR: tokens, so it has to reach the parser.
  const parsed = parseAlert(messageText, input.subject ?? "");

  return parsed.direction === "debit"
    ? processDebit(supabase, input, parsed, settings)
    : processCredit(supabase, input, parsed, settings);
}

/**
 * Detect a repeat of the same transaction, regardless of which channel
 * delivered it. When SMS and email are both enabled the same payment
 * arrives twice, so matching on amount + counterparty within a short
 * window is what stops the ledger being double-posted.
 */
async function findRecentDuplicate(
  supabase: SupabaseClient,
  opts: {
    amount: number | null;
    studentNumber?: string | null;
    matchedStudentId?: string | null;
    payeeName?: string | null;
    isDebit: boolean;
  }
): Promise<boolean> {
  if (!opts.amount) return false;

  const since = new Date(Date.now() - DEDUPE_WINDOW_MINUTES * 60 * 1000).toISOString();
  let query = supabase
    .from("sms_inbox")
    .select("id")
    .eq("parsed_amount", opts.amount)
    .gte("created_at", since);

  if (opts.isDebit) {
    query = query.eq("parser_version", "v3-expense");
    if (opts.payeeName) query = query.eq("parsed_student_name", opts.payeeName);
  } else {
    query = query.neq("parser_version", "v3-expense");
    if (opts.studentNumber) query = query.eq("parsed_student_number", opts.studentNumber);
    else if (opts.matchedStudentId) query = query.eq("matched_student_id", opts.matchedStudentId);
    else return false; // no counterparty to compare — don't guess
  }

  const { data } = await query.limit(1);
  return !!(data && data.length > 0);
}

/** Next sequence number for a prefixed document series (RCT-0007, VCH-0012). */
async function nextDocumentNumber(
  supabase: SupabaseClient,
  table: "income_entries" | "expense_entries",
  column: "receipt_no" | "voucher_no",
  prefix: string
): Promise<string> {
  const { data } = await supabase.from(table).select(column);
  const max = (data ?? []).reduce((acc: number, row: Record<string, unknown>) => {
    const n = parseInt(String(row[column] ?? "").replace(prefix, ""), 10);
    return !isNaN(n) && n > acc ? n : acc;
  }, 0);
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

// ============================================================
// DEBIT (DR) → EXPENSE
// ============================================================
async function processDebit(
  supabase: SupabaseClient,
  input: AlertInput,
  parsed: ParsedAlert,
  settings: Record<string, unknown>
): Promise<AlertResult> {
  const { channel, sender, messageText, receivedAt, externalId, messageId } = input;

  const expenseCategory = detectExpenseCategory(parsed.payeeName, parsed.purpose, parsed.reference);
  const autoExpenseEnabled = settings.sms_auto_expense === true;

  // --- New matching engine: evaluate ALL vendor candidates, score, decide ---
  const vendorResult: VendorMatchResult = await matchVendor(supabase, parsed.payeeName);
  const matchedVendorId = vendorResult.matchedId;
  const matchedVendorName = vendorResult.matchedName;

  const isDuplicate = await findRecentDuplicate(supabase, {
    amount: parsed.amount,
    payeeName: parsed.payeeName,
    isDebit: true,
  });

  const willAutoPost = autoExpenseEnabled && !isDuplicate && !!parsed.amount;
  const channelLabel = channel === "email" ? "Email" : "SMS";
  const amountLabel = parsed.amount?.toLocaleString() ?? "—";

  let matchStatus: string;
  let matchReason: string;

  if (isDuplicate) {
    matchStatus = "duplicate";
    matchReason = `Duplicate — a debit of ₦${amountLabel} to "${parsed.payeeName || "Unknown"}" was already recorded in the last ${DEDUPE_WINDOW_MINUTES} minutes. Expense NOT posted.`;
  } else if (willAutoPost) {
    matchStatus = "matched";
    matchReason = `Auto-posted expense ✓ — ₦${amountLabel} debited to "${parsed.payeeName || "Unknown"}". Category: ${expenseCategory}. Vendor: ${vendorResult.status === "AUTO_MATCHED" ? `"${matchedVendorName}" (${vendorResult.method}, confidence ${vendorResult.confidence})` : vendorResult.status === "AMBIGUOUS" ? `AMBIGUOUS — ${vendorResult.reason}` : "No matching vendor on file — recorded under the payee name."} ${parsed.purpose ? `Purpose: ${parsed.purpose}.` : ""} Source: ${channelLabel}.`;
  } else {
    matchStatus = "needs_review";
    matchReason = `Review required (expense) — ₦${amountLabel} debited to "${parsed.payeeName || "Unknown"}". Auto-expense posting is disabled.${vendorResult.status === "AUTO_MATCHED" ? ` Suggested vendor: "${matchedVendorName}".` : vendorResult.candidateCount > 0 ? ` ${vendorResult.candidateCount} vendor candidate(s) found — ${vendorResult.reason}` : ""}${parsed.purpose ? ` Purpose: ${parsed.purpose}.` : ""} Source: ${channelLabel}.`;
  }

  const confidence = calculateMatchConfidence(parsed.amount, null, parsed.payeeName, vendorResult);
  const expRef = generatePaymentRef(receivedAt, parsed.payeeName);

  const { data: inserted, error: insertError } = await supabase
    .from("sms_inbox")
    .insert({
      event_id: externalId,
      message_id: messageId,
      device_id: input.deviceId ?? null,
      sender,
      sim_number: input.simNumber ?? null,
      message_text: messageText,
      received_at: receivedAt,
      parsed_student_number: null,
      parsed_student_name: parsed.payeeName,
      parsed_amount: parsed.amount,
      parsed_currency: parsed.currency,
      parsed_reference: expRef,
      parser_version: "v4-expense",
      processing_status: willAutoPost ? "confirmed" : "received",
      match_status: matchStatus,
      match_reason: matchReason,
      matched_student_id: null,
      confidence_score: confidence / 100,
      source_channel: channel,
      email_subject: input.subject ?? null,
      raw_payload: input.rawPayload,
    })
    .select("id")
    .single();

  if (insertError) return { success: false, error: insertError.message };

  let autoPosted = false;
  if (willAutoPost && inserted?.id && parsed.amount) {
    const voucherNo = await nextDocumentNumber(
      supabase, "expense_entries", "voucher_no", "VCH-"
    );
    const expenseDate =
      parseBankDate(parsed.transactionDate) ??
      new Date(receivedAt).toISOString().substring(0, 10);

    await supabase.from("expense_entries").insert({
      voucher_no: voucherNo,
      date: expenseDate,
      vendor_id: matchedVendorId,
      vendor_name: matchedVendorName || parsed.payeeName,
      category: expenseCategory,
      description: `Bank DR Alert (${channelLabel}) — ${parsed.purpose || parsed.payeeName || "auto-posted"}`,
      amount: parsed.amount,
      payment_method: "Bank Transfer",
      approved_by: `System (Auto-Expense · ${channelLabel})`,
      reconciled: false,
      notes: messageText.substring(0, 500),
    });

    await supabase
      .from("sms_inbox")
      .update({ parsed_reference: `${expRef} / ${voucherNo}` })
      .eq("id", inserted.id);

    await supabase.from("activity_log").insert({
      action: `Auto-Post Expense (${channelLabel} DR Alert)`,
      details: `${voucherNo} — ${parsed.payeeName || "Unknown"} — ₦${parsed.amount.toLocaleString()} — ${expenseCategory} [${vendorResult.method}]`,
    });

    autoPosted = true;
  }

  return {
    success: true,
    id: inserted?.id,
    type: "expense",
    autoPosted,
    parsed: {
      channel,
      amount: parsed.amount,
      payee: parsed.payeeName,
      purpose: parsed.purpose,
      category: expenseCategory,
      reference: expRef,
      vendor_matched: matchedVendorName,
      vendor_match_status: vendorResult.status,
      vendor_match_method: vendorResult.method,
      match_status: matchStatus,
    },
  };
}

// ============================================================
// CREDIT (CR) → INCOME / STUDENT PAYMENT
// ============================================================
async function processCredit(
  supabase: SupabaseClient,
  input: AlertInput,
  parsed: ParsedAlert,
  settings: Record<string, unknown>
): Promise<AlertResult> {
  const { channel, sender, messageText, receivedAt, externalId, messageId } = input;

  // --- New matching engine: evaluate ALL student candidates, score, decide ---
  const studentResult: MatchResult = await matchStudent(supabase, parsed.studentNumber, parsed.studentName);

  const matchedStudentId = studentResult.matchedId;
  const matchedStudentName = studentResult.matchedName;
  const confidence = calculateMatchConfidence(parsed.amount, parsed.studentNumber, parsed.studentName, studentResult);

  const autoCreditEnabled = settings.sms_auto_credit === true;
  const minConfidence = Math.round(((settings.sms_auto_credit_min_confidence as number) || 0.8) * 100);
  const meetsThreshold = confidence >= minConfidence;

  const isDuplicate = await findRecentDuplicate(supabase, {
    amount: parsed.amount,
    studentNumber: parsed.studentNumber,
    matchedStudentId,
    isDebit: false,
  });

  // An alert whose direction we couldn't establish must never post itself.
  const directionKnown = parsed.direction === "credit";

  // Auto-credit requires: toggle ON, direction known, match engine returned
  // AUTO_MATCHED, confidence meets threshold, not duplicate, has amount.
  const willAutoCredit =
    autoCreditEnabled &&
    directionKnown &&
    studentResult.status === "AUTO_MATCHED" &&
    meetsThreshold &&
    !isDuplicate &&
    !!parsed.amount;

  const channelLabel = channel === "email" ? "Email" : "SMS";
  const amountLabel = parsed.amount?.toLocaleString() ?? "—";

  let matchStatus: string;
  let matchReason: string;

  if (isDuplicate) {
    matchStatus = "duplicate";
    matchReason = `Duplicate — ₦${amountLabel} for ${parsed.studentNumber || matchedStudentName || "unknown"} was already recorded in the last ${DEDUPE_WINDOW_MINUTES} minutes. Payment NOT posted.`;
  } else if (!directionKnown) {
    matchStatus = "needs_review";
    matchReason = `Review required — could not determine if this is a credit or debit. Amount: ₦${amountLabel}. Source: ${channelLabel} (format: ${parsed.format}).`;
  } else if (studentResult.status === "CONFLICT") {
    matchStatus = "needs_review";
    matchReason = `CONFLICT — ${studentResult.reason} Source: ${channelLabel}.`;
  } else if (studentResult.status === "AMBIGUOUS") {
    matchStatus = "needs_review";
    matchReason = `AMBIGUOUS — ${studentResult.reason} Source: ${channelLabel}.`;
  } else if (willAutoCredit) {
    matchStatus = "matched";
    matchReason = `Auto-credited ✓ — ${studentResult.reason} ₦${amountLabel} posted (confidence ${confidence}% ≥ threshold ${minConfidence}%). Source: ${channelLabel}.`;
  } else if (studentResult.status === "AUTO_MATCHED" && parsed.amount) {
    matchStatus = "needs_review";
    if (!autoCreditEnabled) {
      matchReason = `Review required — ${studentResult.reason} Amount: ₦${amountLabel}. Auto-credit is DISABLED. Source: ${channelLabel}.`;
    } else if (!meetsThreshold) {
      matchReason = `Review required — ${studentResult.reason} Amount: ₦${amountLabel}. Confidence (${confidence}%) below threshold (${minConfidence}%). Source: ${channelLabel}.`;
    } else {
      matchReason = `Review required — ${studentResult.reason} Amount: ₦${amountLabel}. Source: ${channelLabel}.`;
    }
  } else if (studentResult.status === "MANUAL_REVIEW") {
    matchStatus = "needs_review";
    matchReason = `Review required — ${studentResult.reason} Amount: ₦${amountLabel}. Source: ${channelLabel}.`;
  } else if (parsed.amount && (parsed.studentNumber || parsed.studentName)) {
    matchStatus = "needs_review";
    matchReason = `Review required — ₦${amountLabel} received with identifier "${parsed.studentNumber || parsed.studentName}", but NO matching student found. ${studentResult.reason} Source: ${channelLabel}.`;
  } else if (parsed.amount) {
    matchStatus = "unmatched";
    matchReason = `Unmatched — ₦${amountLabel} received but no student name or number found in the alert. Source: ${channelLabel}.`;
  } else {
    matchStatus = "unmatched";
    matchReason = `Unmatched — could not read a valid amount or student identifier. Source: ${channelLabel}.`;
  }

  const { data: inserted, error: insertError } = await supabase
    .from("sms_inbox")
    .insert({
      event_id: externalId,
      message_id: messageId,
      device_id: input.deviceId ?? null,
      sender,
      sim_number: input.simNumber ?? null,
      message_text: messageText,
      received_at: receivedAt,
      parsed_student_number: parsed.studentNumber,
      parsed_student_name: matchedStudentName || parsed.studentName,
      parsed_amount: parsed.amount,
      parsed_currency: parsed.currency,
      parsed_reference: parsed.reference || generatePaymentRef(receivedAt, matchedStudentName),
      parser_version: "v4",
      processing_status: willAutoCredit ? "confirmed" : "received",
      match_status: matchStatus,
      match_reason: matchReason,
      matched_student_id: matchedStudentId,
      confidence_score: confidence / 100,
      source_channel: channel,
      email_subject: input.subject ?? null,
      raw_payload: input.rawPayload,
    })
    .select("id")
    .single();

  if (insertError) return { success: false, error: insertError.message };

  let autoPosted = false;
  if (willAutoCredit && inserted?.id && parsed.amount) {
    const receiptNo = await nextDocumentNumber(
      supabase, "income_entries", "receipt_no", "RCT-"
    );
    const paymentDate =
      parseBankDate(parsed.transactionDate) ??
      new Date(receivedAt).toISOString().substring(0, 10);

    await supabase.from("income_entries").insert({
      receipt_no: receiptNo,
      date: paymentDate,
      student_id: matchedStudentId,
      student_name: matchedStudentName || parsed.studentName,
      category: "School Fees",
      description: `Bank CR Alert (${channelLabel}) — ${parsed.reference || "auto-credited"} [${studentResult.method}]`,
      amount: parsed.amount,
      payment_method: "Bank Transfer",
      recorded_by: `System (Auto-Credit · ${channelLabel})`,
      reconciled: false,
      payment_source: channel === "email" ? "email_auto" : "smsgate_auto",
      sms_inbox_id: inserted.id,
    });

    await supabase.from("activity_log").insert({
      action: `Auto-Credit Payment (${channelLabel} CR Alert)`,
      details: `${receiptNo} — ${matchedStudentName} — ₦${parsed.amount.toLocaleString()} (confidence ${confidence}%, method ${studentResult.method})`,
    });

    autoPosted = true;
  }

  return {
    success: true,
    id: inserted?.id,
    type: "income",
    autoPosted,
    parsed: {
      channel,
      amount: parsed.amount,
      student_number: parsed.studentNumber,
      student_name: matchedStudentName || parsed.studentName,
      reference: parsed.reference,
      confidence,
      match_status: matchStatus,
      match_method: studentResult.method,
      student_match_result: studentResult.status,
      matched_student_id: matchedStudentId,
      candidate_count: studentResult.candidateCount,
    },
  };
}
