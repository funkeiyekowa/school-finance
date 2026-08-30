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
} from "@/lib/alerts/matcher";
import { createServiceClient } from "@/lib/alerts/service";
import { evaluatePolicy, loadPolicy, getConfidenceBand } from "@/lib/alerts/policy";
import { requireStaffSession } from "@/lib/api/requireStaff";

/**
 * Dry-run the full parse + match pipeline on pasted SMS/email text.
 *
 * Returns everything the real pipeline would compute — direction, amount,
 * counterparty, matched student/vendor, confidence, match reason — but
 * never writes anything to the database. Staff-only so an anonymous
 * caller can't fish the student directory by pasting text.
 */
export async function POST(request: Request) {
  const guard = await requireStaffSession({ permission: "sms_alerts" });
  if (guard) return guard;
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
  const policy = loadPolicy(settings);

  // ---------- Run the new matching engine (read-only) ----------
  const studentResult = await matchStudent(supabase, parsed.studentNumber, parsed.studentName);
  const vendorResult = await matchVendor(supabase, parsed.payeeName);

  const isDebit = parsed.direction === "debit";
  const isCredit = parsed.direction === "credit";
  const directionKnown = isCredit;

  const expenseCategory = detectExpenseCategory(parsed.payeeName, parsed.purpose, parsed.reference);
  const transactionDate = parseBankDate(parsed.transactionDate);
  const reference = parsed.reference || generatePaymentRef(new Date().toISOString(), studentResult.matchedName || parsed.payeeName);

  // --- Policy evaluation for credits ---
  const policyResult = evaluatePolicy(
    policy, studentResult, null, parsed.amount, directionKnown, parsed.studentNumber, parsed.studentName
  );
  const confidence = policyResult.confidence;
  const band = getConfidenceBand(confidence);

  // ---------- Simulate outcome ----------
  let simulatedOutcome: string;
  let simulatedReason: string;

  if (isDebit) {
    if (autoExpenseEnabled && parsed.amount) {
      simulatedOutcome = "Would auto-post expense";
      simulatedReason = `Auto-post expense — ₦${parsed.amount?.toLocaleString() ?? "—"} to "${parsed.payeeName || "Unknown"}". Category: ${expenseCategory}. Vendor: ${vendorResult.status} — ${vendorResult.reason}`;
    } else if (!autoExpenseEnabled) {
      simulatedOutcome = "Would need manual review (auto-expense OFF)";
      simulatedReason = vendorResult.reason;
    } else {
      simulatedOutcome = "Would need manual review (no amount)";
      simulatedReason = vendorResult.reason;
    }
  } else if (isCredit) {
    if (autoCreditEnabled && policyResult.decision === "AUTO_CREDIT") {
      simulatedOutcome = "Would auto-credit student";
      simulatedReason = policyResult.explanation;
    } else if (policyResult.decision === "AUTO_CREDIT" && !autoCreditEnabled) {
      simulatedOutcome = "Would need review (auto-credit toggle OFF, but policy would allow)";
      simulatedReason = policyResult.explanation;
    } else {
      simulatedOutcome = "Would need manual review";
      simulatedReason = policyResult.explanation;
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
    confidenceBand: band,
    simulatedOutcome,
    simulatedReason,

    // Policy decision (full explanation)
    policyDecision: policyResult.decision,
    policyRule: policyResult.rule,
    policyEligible: policyResult.eligible,
    policyBlockers: policyResult.blockers,
    policyEvidence: policyResult.evidence,
    policyWarnings: policyResult.warnings,

    // Settings context
    settings: {
      autoCreditEnabled,
      autoExpenseEnabled,
      policyPreset: policy.preset,
      minimumConfidence: policy.minimumConfidence,
    },

    // Audit trail
    audit: (isDebit ? vendorResult : studentResult).audit,

    // Raw text used (after HTML strip if applicable)
    processedText: messageText.substring(0, 1000),
  });
}
