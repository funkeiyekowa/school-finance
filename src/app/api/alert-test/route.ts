import { NextResponse } from "next/server";
import {
  parseAlert,
  calculateConfidence,
  generatePaymentRef,
  detectExpenseCategory,
  parseBankDate,
  htmlToText,
  type ParsedAlert,
} from "@/lib/alerts/parser";
import { createServiceClient } from "@/lib/alerts/service";

/**
 * Dry-run the full parse + match pipeline on pasted SMS/email text.
 *
 * Returns everything the real pipeline would compute — direction, amount,
 * counterparty, matched student/vendor, confidence, match reason — but
 * never writes anything to the database.
 *
 * Used by Setup → Matching Tester so the admin can verify rules before
 * relying on them with live alerts.
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
  const confidence = calculateConfidence(parsed);

  // ---------- Settings ----------
  const { data: settingsRow } = await supabase
    .from("school_settings")
    .select("*")
    .limit(1)
    .single();
  const settings = (settingsRow ?? {}) as Record<string, unknown>;

  const autoCreditEnabled = settings.sms_auto_credit === true;
  const autoExpenseEnabled = settings.sms_auto_expense === true;
  const minConfidence = (settings.sms_auto_credit_min_confidence as number) || 0.8;

  // ---------- Student matching (read-only) ----------
  let matchedStudentId: string | null = null;
  let matchedStudentName: string | null = null;
  let matchedStudentCode: string | null = null;
  let matchedBy = "";
  const studentCandidates: { id: string; full_name: string; student_code: string; matchedBy: string }[] = [];

  if (parsed.studentNumber) {
    const { data: students } = await supabase
      .from("students")
      .select("id, full_name, student_code")
      .or(`student_code.ilike.%${parsed.studentNumber}%,full_name.ilike.%${parsed.studentNumber}%`)
      .limit(5);
    if (students && students.length > 0) {
      matchedStudentId = students[0].id;
      matchedStudentName = students[0].full_name;
      matchedStudentCode = students[0].student_code;
      matchedBy = "code";
      students.forEach(s => studentCandidates.push({ ...s, matchedBy: "code" }));
    }
  }

  if (!matchedStudentId && parsed.studentName) {
    const { data: students } = await supabase
      .from("students")
      .select("id, full_name, student_code")
      .ilike("full_name", `%${parsed.studentName}%`)
      .limit(5);
    if (students && students.length > 0) {
      matchedStudentId = students[0].id;
      matchedStudentName = students[0].full_name;
      matchedStudentCode = students[0].student_code;
      matchedBy = "name-full";
      students.forEach(s => studentCandidates.push({ ...s, matchedBy: "name-full" }));
    }

    if (!matchedStudentId) {
      const words = parsed.studentName.split(/\s+/).filter(w => w.length >= 3);
      for (const word of words) {
        const { data: s } = await supabase
          .from("students")
          .select("id, full_name, student_code")
          .or(`full_name.ilike.%${word}%,last_name.ilike.%${word}%,first_name.ilike.%${word}%`)
          .limit(5);
        if (s && s.length > 0) {
          matchedStudentId = s[0].id;
          matchedStudentName = s[0].full_name;
          matchedStudentCode = s[0].student_code;
          matchedBy = `word "${word}"`;
          s.forEach(st => studentCandidates.push({ ...st, matchedBy: `word "${word}"` }));
          break;
        }
      }
    }
  }

  if (matchedBy === "code" && parsed.studentName) matchedBy = "code+name";

  // ---------- Vendor matching (read-only) ----------
  let matchedVendorId: string | null = null;
  let matchedVendorName: string | null = null;
  const vendorCandidates: { id: string; name: string; matchedBy: string }[] = [];

  if (parsed.payeeName) {
    const words = parsed.payeeName.split(/\s+/).filter(w => w.length >= 3);
    for (const word of words) {
      const { data: vendor } = await supabase
        .from("vendors")
        .select("id, name")
        .ilike("name", `%${word}%`)
        .limit(5);
      if (vendor && vendor.length > 0) {
        matchedVendorId = vendor[0].id;
        matchedVendorName = vendor[0].name;
        vendor.forEach(v => vendorCandidates.push({ ...v, matchedBy: `word "${word}"` }));
        break;
      }
    }
  }

  // ---------- Simulate match reason ----------
  const channelLabel = "Test";
  const amountLabel = parsed.amount?.toLocaleString() ?? "—";
  const meetsThreshold = confidence >= minConfidence;
  const expenseCategory = detectExpenseCategory(parsed.payeeName, parsed.purpose, parsed.reference);
  const transactionDate = parseBankDate(parsed.transactionDate);
  const reference = parsed.reference || generatePaymentRef(new Date().toISOString(), matchedStudentName || parsed.payeeName);

  let simulatedOutcome: string;
  let simulatedReason: string;

  if (parsed.direction === "debit" || parsed.isDebit) {
    // Expense simulation
    if (autoExpenseEnabled && parsed.amount) {
      simulatedOutcome = "Would auto-post expense";
      simulatedReason = `Auto-posted expense ✓ — ₦${amountLabel} debited to "${parsed.payeeName || "Unknown"}". Category: ${expenseCategory}.${matchedVendorName ? ` Matched vendor "${matchedVendorName}".` : " No matching vendor on file — would record under the payee name."}${parsed.purpose ? ` Purpose: ${parsed.purpose}.` : ""} Source: ${channelLabel}.`;
    } else if (!autoExpenseEnabled) {
      simulatedOutcome = "Would need manual review (auto-expense OFF)";
      simulatedReason = `Review required (expense) — ₦${amountLabel} debited to "${parsed.payeeName || "Unknown"}". Auto-expense posting is disabled, so nothing would be recorded automatically.${matchedVendorName ? ` Suggested vendor: "${matchedVendorName}".` : ""}${parsed.purpose ? ` Purpose: ${parsed.purpose}.` : ""} Source: ${channelLabel}.`;
    } else {
      simulatedOutcome = "Would need manual review (no amount parsed)";
      simulatedReason = `Review required — could not read a valid amount from this alert. Source: ${channelLabel}.`;
    }
  } else if (parsed.direction === "credit") {
    // Income simulation
    const directionKnown = true;
    const wouldAutoCredit = autoCreditEnabled && meetsThreshold && directionKnown && !!matchedStudentId && !!parsed.amount;

    const howMatched =
      matchedBy === "code+name"
        ? `name "${matchedStudentName}" and student no "${parsed.studentNumber}" both match`
        : matchedBy === "code"
        ? `student no "${parsed.studentNumber}" matches "${matchedStudentName}"`
        : matchedBy.startsWith("name") || matchedBy.startsWith("word")
        ? `name "${parsed.studentName}" matches student "${matchedStudentName}" (via ${matchedBy})`
        : "no match";

    if (wouldAutoCredit) {
      simulatedOutcome = "Would auto-credit student";
      simulatedReason = `Auto-credited ✓ — ${howMatched}. ₦${amountLabel} would post to ${matchedStudentName}'s account automatically (confidence ${Math.round(confidence * 100)}% ≥ threshold ${Math.round(minConfidence * 100)}%). Source: ${channelLabel}.`;
    } else if (matchedStudentId && parsed.amount) {
      simulatedOutcome = "Would need manual review";
      if (!autoCreditEnabled) {
        simulatedReason = `Review required — ${howMatched}. Amount: ₦${amountLabel}. Auto-credit is DISABLED in settings, so nothing would be posted. Source: ${channelLabel}.`;
      } else if (!meetsThreshold) {
        simulatedReason = `Review required — ${howMatched}. Amount: ₦${amountLabel}. Confidence (${Math.round(confidence * 100)}%) is below the auto-credit threshold (${Math.round(minConfidence * 100)}%). Source: ${channelLabel}.`;
      } else {
        simulatedReason = `Review required — ${howMatched}. Amount: ₦${amountLabel}. Source: ${channelLabel}.`;
      }
    } else if (parsed.amount && (parsed.studentNumber || parsed.studentName)) {
      simulatedOutcome = "Would need manual review (no student match)";
      simulatedReason = `Review required — ₦${amountLabel} received with identifier "${parsed.studentNumber || parsed.studentName}", but NO matching student found in the database. Source: ${channelLabel}.`;
    } else if (parsed.amount) {
      simulatedOutcome = "Would be unmatched";
      simulatedReason = `Unmatched — ₦${amountLabel} received but no student name or number found in the alert. Cannot determine who to credit. Source: ${channelLabel}.`;
    } else {
      simulatedOutcome = "Would be unmatched (no amount)";
      simulatedReason = `Unmatched — could not read a valid amount or student identifier from this alert. Source: ${channelLabel}.`;
    }
  } else {
    simulatedOutcome = "Would need manual review (unknown direction)";
    simulatedReason = `Review required — could not tell whether this is a credit or a debit, so nothing would be posted. Amount read: ₦${amountLabel}${parsed.studentName || parsed.studentNumber ? `, identifier "${parsed.studentNumber || parsed.studentName}"` : ""}. Format: ${parsed.format}.`;
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

    // Counterparty — credit side
    studentNumber: parsed.studentNumber,
    studentName: parsed.studentName,
    matchedStudent: matchedStudentId
      ? { id: matchedStudentId, name: matchedStudentName, code: matchedStudentCode, matchedBy }
      : null,
    studentCandidates,

    // Counterparty — debit side
    payeeName: parsed.payeeName,
    purpose: parsed.purpose,
    expenseCategory,
    matchedVendor: matchedVendorId
      ? { id: matchedVendorId, name: matchedVendorName }
      : null,
    vendorCandidates,

    // Confidence and outcome
    confidence,
    confidencePercent: Math.round(confidence * 100),
    simulatedOutcome,
    simulatedReason,

    // Settings context
    settings: {
      autoCreditEnabled,
      autoExpenseEnabled,
      minConfidencePercent: Math.round(minConfidence * 100),
    },

    // Raw text used (after HTML strip if applicable)
    processedText: messageText.substring(0, 1000),
  });
}
