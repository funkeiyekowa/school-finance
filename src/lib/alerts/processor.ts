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
import {
  detectDuplicate,
  extractDedupSettings,
  type DuplicateResult,
  type IncomingAlert as DedupInput,
} from "./dedup";
import {
  evaluatePolicy,
  loadPolicy,
  type PolicyDecisionResult,
} from "./policy";

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

/** Legacy constant kept for the old findRecentDuplicate (now unused by main pipeline). */

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

  // ---------- DUPLICATE DETECTION (runs BEFORE matching) ----------
  // If this alert represents a transaction we've already received (e.g. SMS
  // followed by email), archive it immediately and skip matching/posting.
  const dedupSettings = extractDedupSettings(settings);
  const dedupInput: DedupInput = {
    transactionRef: parsed.reference,
    amount: parsed.amount,
    isDebit: parsed.isDebit,
    studentCode: parsed.studentNumber,
    counterpartyName: parsed.isDebit ? parsed.payeeName : parsed.studentName,
    narration: messageText.substring(0, 500),
    channel,
    receivedAt,
  };

  const dupResult: DuplicateResult = await detectDuplicate(supabase, dedupInput, dedupSettings);

  if (dupResult.status === "PLATFORM_DUPLICATE") {
    // Confirmed duplicate — insert the record as archived, skip matching/posting.
    const { data: inserted } = await supabase
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
        parsed_student_name: parsed.isDebit ? parsed.payeeName : parsed.studentName,
        parsed_amount: parsed.amount,
        parsed_currency: parsed.currency,
        parsed_reference: parsed.reference,
        parser_version: parsed.isDebit ? "v4-expense" : "v4",
        processing_status: "archived",
        match_status: "duplicate",
        match_reason: dupResult.reason,
        matched_student_id: null,
        confidence_score: dupResult.confidence / 100,
        source_channel: channel,
        email_subject: input.subject ?? null,
        raw_payload: input.rawPayload,
        archive_status: "PLATFORM_DUPLICATE",
        primary_alert_id: dupResult.primaryAlertId,
        archived_at: new Date().toISOString(),
        archive_reason: dupResult.reason,
        duplicate_confidence: dupResult.confidence,
        duplicate_evidence: dupResult.evidence,
      })
      .select("id")
      .single();

    return {
      success: true,
      skipped: true,
      id: inserted?.id,
      reason: dupResult.reason,
      parsed: {
        channel,
        amount: parsed.amount,
        duplicate_status: "PLATFORM_DUPLICATE",
        primary_alert_id: dupResult.primaryAlertId,
        confidence: dupResult.confidence,
      },
    };
  }

  // Pass the duplicate result into the credit/debit processors so they can
  // flag POSSIBLE_DUPLICATE records without auto-posting.
  return parsed.direction === "debit"
    ? processDebit(supabase, input, parsed, settings, dupResult)
    : processCredit(supabase, input, parsed, settings, dupResult);
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
  settings: Record<string, unknown>,
  dupResult: DuplicateResult
): Promise<AlertResult> {
  const { channel, sender, messageText, receivedAt, externalId, messageId } = input;

  const expenseCategory = detectExpenseCategory(parsed.payeeName, parsed.purpose, parsed.reference);
  const autoExpenseEnabled = settings.sms_auto_expense === true;

  // --- New matching engine: evaluate ALL vendor candidates, score, decide ---
  const vendorResult: VendorMatchResult = await matchVendor(supabase, parsed.payeeName);
  const matchedVendorId = vendorResult.matchedId;
  const matchedVendorName = vendorResult.matchedName;

  // Duplicate status from the new dedup service (already ran before matching).
  const isPossibleDuplicate = dupResult.status === "POSSIBLE_DUPLICATE";

  const willAutoPost = autoExpenseEnabled && !isPossibleDuplicate && !!parsed.amount;
  const channelLabel = channel === "email" ? "Email" : "SMS";
  const amountLabel = parsed.amount?.toLocaleString() ?? "—";

  let matchStatus: string;
  let matchReason: string;
  let archiveStatus = "ACTIVE";

  if (isPossibleDuplicate) {
    matchStatus = "needs_review";
    matchReason = `POSSIBLE DUPLICATE — ${dupResult.reason} Expense NOT auto-posted. Confirm whether this is a separate payment or a duplicate.`;
    archiveStatus = "POSSIBLE_DUPLICATE";
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
      archive_status: archiveStatus,
      primary_alert_id: dupResult.primaryAlertId,
      duplicate_confidence: isPossibleDuplicate ? dupResult.confidence : null,
      duplicate_evidence: isPossibleDuplicate ? dupResult.evidence : null,
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
  settings: Record<string, unknown>,
  dupResult: DuplicateResult
): Promise<AlertResult> {
  const { channel, sender, messageText, receivedAt, externalId, messageId } = input;

  // --- New matching engine: evaluate ALL student candidates, score, decide ---
  const studentResult: MatchResult = await matchStudent(supabase, parsed.studentNumber, parsed.studentName);

  const matchedStudentId = studentResult.matchedId;
  const matchedStudentName = studentResult.matchedName;

  // --- Auto-Credit Policy Engine ---
  // Replaces the old single-slider confidence threshold with a full
  // rule-based decision system. Hard gates → evidence rules → confidence.
  const autoCreditEnabled = settings.sms_auto_credit === true;
  const policy = loadPolicy(settings);
  const directionKnown = parsed.direction === "credit";

  const policyResult: PolicyDecisionResult = evaluatePolicy(
    policy,
    studentResult,
    dupResult,
    parsed.amount,
    directionKnown,
    parsed.studentNumber,
    parsed.studentName
  );

  // The policy engine decides. Auto-credit also requires the master toggle.
  const willAutoCredit = autoCreditEnabled && policyResult.decision === "AUTO_CREDIT";

  const confidence = policyResult.confidence;
  const channelLabel = channel === "email" ? "Email" : "SMS";
  const amountLabel = parsed.amount?.toLocaleString() ?? "—";

  let matchStatus: string;
  let matchReason: string;
  let archiveStatus = "ACTIVE";

  if (dupResult.status === "POSSIBLE_DUPLICATE") {
    matchStatus = "needs_review";
    matchReason = `POSSIBLE DUPLICATE — ${dupResult.reason} Payment NOT auto-credited.`;
    archiveStatus = "POSSIBLE_DUPLICATE";
  } else if (willAutoCredit) {
    matchStatus = "matched";
    matchReason = `Auto-credited ✓ — ${policyResult.explanation} Source: ${channelLabel}.`;
  } else if (!autoCreditEnabled && policyResult.decision === "AUTO_CREDIT") {
    matchStatus = "needs_review";
    matchReason = `Review required — policy would allow auto-credit but the master toggle is OFF. ${policyResult.explanation} Source: ${channelLabel}.`;
  } else {
    // Policy said REVIEW_REQUIRED — use its explanation directly.
    matchStatus = policyResult.blockers.length > 0 || studentResult.status === "NO_MATCH" ? (parsed.amount ? "needs_review" : "unmatched") : "needs_review";
    if (!parsed.amount && !parsed.studentNumber && !parsed.studentName) {
      matchStatus = "unmatched";
      matchReason = `Unmatched — could not read a valid amount or student identifier. Source: ${channelLabel}.`;
    } else {
      matchReason = `${policyResult.explanation} Amount: ₦${amountLabel}. Source: ${channelLabel}.`;
    }
  }

  // Append warnings to the reason
  if (policyResult.warnings.length > 0) {
    matchReason += " ⚠ " + policyResult.warnings.map(w => w.message).join(" ⚠ ");
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
      archive_status: archiveStatus,
      primary_alert_id: dupResult.primaryAlertId,
      duplicate_confidence: dupResult.status === "POSSIBLE_DUPLICATE" ? dupResult.confidence : null,
      duplicate_evidence: dupResult.status === "POSSIBLE_DUPLICATE" ? dupResult.evidence : null,
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
      details: `${receiptNo} — ${matchedStudentName} — ₦${parsed.amount.toLocaleString()} (confidence ${confidence}%, rule: ${policyResult.rule || studentResult.method})`,
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
      policy_decision: policyResult.decision,
      policy_rule: policyResult.rule,
      policy_eligible: policyResult.eligible,
    },
  };
}
