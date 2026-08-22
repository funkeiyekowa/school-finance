import { NextResponse } from "next/server";
import {
  parseAlert,
  detectExpenseCategory,
  parseBankDate,
  generatePaymentRef,
  htmlToText,
} from "@/lib/alerts/parser";
import {
  matchStudent,
  matchVendor,
  calculateMatchConfidence,
} from "@/lib/alerts/matcher";
import { createServiceClient } from "@/lib/alerts/service";

/**
 * Dry-run the full parse + match pipeline on pasted SMS/email text.
 *
 * Returns everything the real pipeline would compute — direction, amount,
 * counterparty, matched student/vendor, confidence, match reason — but
 * never writes anything to the database.
 */
export async function POST(request: Request) {
  const supabase = createServiceClient();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const rawText = String(body.text ?? body.message ?? "").trim();
  const subject = String(body.subject ?? "").trim();
  const isHtml = body.isHtml === true;

  if (!rawText) {
    return NextResponse.json({ error: "Paste a message to test." }, { status: 400 });
  }

  const messageText = isHtml ? htmlToText(rawText) : rawText;
  const parsed = parseAlert(messageText, subject || null);

  // ---------- Settings ----------
  const { data: settingsRow } = await supabase
    .from("school_settings")
    .select("*")
    .limit(1)
    .single();
  const settings = (settingsRow ?? {}) as Record<string, unknown>;

  const autoCreditEnabled = settings.sms_auto_credit === true;
  const autoExpenseEnabled = settings.sms_auto_expense === true;
  const minConfidence = Math.round(((settings.sms_auto_credit_min_confidence as number) || 0.8) * 100);

  // ---------- Run the new matching engine (read-only) ----------
  const studentResult = await matchStudent(supabase, parsed.studentNumber, parsed.studentName);
  const vendorResult = await matchVendor(supabase, parsed.payeeName);

  const isDebit = parsed.direction === "debit";
  const isCredit = parsed.direction === "credit";

  const activeMatchResult = isDebit ? vendorResult : studentResult;
  const confidence = isDebit
    ? calculateMatchConfidence(parsed.amount, null, parsed.payeeName, vendorResult)
    : calculateMatchConfidence(parsed.amount, parsed.studentNumber, parsed.studentName, studentResult);

  const meetsThreshold = confidence >= minConfidence;
  const expenseCategory = detectExpenseCategory(parsed.payeeName, parsed.purpose, parsed.reference);
  const transactionDate = parseBankDate(parsed.transactionDate);
  const reference = parsed.reference || generatePaymentRef(new Date().toISOString(), studentResult.matchedName || parsed.payeeName);

  // ---------- Simulate outcome ----------
  let simulatedOutcome: string;
  let simulatedReason: string;

  if (isDebit) {
    if (autoExpenseEnabled && parsed.amount) {
      simulatedOutcome = "Would auto-post expense";
      simulatedReason = `Auto-post expense ✓ — ₦${parsed.amount?.toLocaleString() ?? "—"} to "${parsed.payeeName || "Unknown"}". Category: ${expenseCategory}. Vendor match: ${vendorResult.status} — ${vendorResult.reason}`;
    } else if (!autoExpenseEnabled) {
      simulatedOutcome = "Would need manual review (auto-expense OFF)";
      simulatedReason = `Review required. ${vendorResult.reason}`;
    } else {
      simulatedOutcome = "Would need manual review (no amount)";
      simulatedReason = `No amount parsed. ${vendorResult.reason}`;
    }
  } else if (isCredit) {
    const directionKnown = true;
    const wouldAutoCredit =
      autoCreditEnabled &&
      directionKnown &&
      studentResult.status === "AUTO_MATCHED" &&
      meetsThreshold &&
      !!parsed.amount;

    if (studentResult.status === "CONFLICT") {
      simulatedOutcome = "CONFLICT — would need manual review";
      simulatedReason = studentResult.reason;
    } else if (studentResult.status === "AMBIGUOUS") {
      simulatedOutcome = "AMBIGUOUS — would need manual review";
      simulatedReason = studentResult.reason;
    } else if (wouldAutoCredit) {
      simulatedOutcome = "Would auto-credit student";
      simulatedReason = `Auto-credit ✓ — ${studentResult.reason} Confidence ${confidence}% ≥ threshold ${minConfidence}%.`;
    } else if (studentResult.status === "AUTO_MATCHED" && parsed.amount) {
      if (!autoCreditEnabled) {
        simulatedOutcome = "Would need manual review (auto-credit OFF)";
      } else if (!meetsThreshold) {
        simulatedOutcome = `Would need manual review (confidence ${confidence}% < ${minConfidence}%)`;
      } else {
        simulatedOutcome = "Would need manual review";
      }
      simulatedReason = studentResult.reason;
    } else if (studentResult.status === "MANUAL_REVIEW") {
      simulatedOutcome = "Would need manual review (low confidence match)";
      simulatedReason = studentResult.reason;
    } else if (parsed.amount && (parsed.studentNumber || parsed.studentName)) {
      simulatedOutcome = "Would need manual review (no student match)";
      simulatedReason = studentResult.reason;
    } else if (parsed.amount) {
      simulatedOutcome = "Would be unmatched";
      simulatedReason = "No student name or number found in the alert.";
    } else {
      simulatedOutcome = "Would be unmatched (no amount)";
      simulatedReason = "Could not read an amount or student identifier.";
    }
  } else {
    simulatedOutcome = "Would need manual review (unknown direction)";
    simulatedReason = `Could not determine credit vs debit. Format: ${parsed.format}.`;
  }

  return NextResponse.json({
    // Parsing results
    direction: parsed.direction,
    format: parsed.format,
    amount: parsed.amount,
    currency: parsed.currency,
    transactionDate: parsed.transactionDate,
    transactionDateISO: transactionDate,
    reference,

    // Student matching (credit side)
    studentNumber: parsed.studentNumber,
    studentName: parsed.studentName,
    matchedStudent: studentResult.matchedId
      ? { id: studentResult.matchedId, name: studentResult.matchedName, code: studentResult.matchedCode, matchedBy: studentResult.method }
      : null,
    studentMatchStatus: studentResult.status,
    studentMatchMethod: studentResult.method,
    studentMatchReason: studentResult.reason,
    studentCandidates: studentResult.candidates.map(c => ({
      id: c.id,
      full_name: c.name,
      student_code: c.code,
      score: c.score,
      method: c.method,
      evidence: c.evidence,
    })),

    // Vendor matching (debit side)
    payeeName: parsed.payeeName,
    purpose: parsed.purpose,
    expenseCategory,
    matchedVendor: vendorResult.matchedId
      ? { id: vendorResult.matchedId, name: vendorResult.matchedName }
      : null,
    vendorMatchStatus: vendorResult.status,
    vendorMatchMethod: vendorResult.method,
    vendorMatchReason: vendorResult.reason,
    vendorCandidates: vendorResult.candidates.map(c => ({
      id: c.id,
      name: c.name,
      score: c.score,
      method: c.method,
      evidence: c.evidence,
    })),

    // Confidence and outcome
    confidence,
    confidencePercent: confidence,
    simulatedOutcome,
    simulatedReason,

    // Settings context
    settings: {
      autoCreditEnabled,
      autoExpenseEnabled,
      minConfidencePercent: minConfidence,
    },

    // Audit trail
    audit: activeMatchResult.audit,

    // Raw text used (after HTML strip if applicable)
    processedText: messageText.substring(0, 1000),
  });
}
