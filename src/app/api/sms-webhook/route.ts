import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Use service role to bypass RLS for webhook inserts
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// Extract the payment amount from free-form SMS text.
//
// Root cause of the old truncation bug: the previous fallback regex
// `[0-9]{1,3}(?:,[0-9]{3})*` assumes amounts are always comma-grouped
// (e.g. "40,003"). For plain digit runs with NO thousands separator
// (e.g. "40003"), that pattern only ever consumed the first 1-3 digits
// then gave up looking for a comma — silently truncating 40003 -> 400
// and 22500 -> 225. This rewrite scans for ALL numeric candidates in
// the message (comma-grouped OR plain), excludes numbers that are part
// of an alphanumeric code (STU0003, TXN123456, phone numbers, etc.),
// and prefers the one sitting next to a currency symbol or keyword.
function extractAmount(text: string): number | null {
  // Matches either:
  //   - proper comma-grouped numbers: 1-3 digits, then 1+ groups of ",XXX", optional 2-decimal
  //   - plain digit runs (2+ digits, no comma), optional 2-decimal
  // Lookbehind/lookahead exclude digits directly touching a letter or another digit-adjacent
  // character, so we don't slice numbers out of codes like "STU0003" or "TXN123456".
  const numberRegex = /(?<![A-Za-z0-9])([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]{2})?|[0-9]{2,}(?:\.[0-9]{2})?)(?![A-Za-z0-9])/g;

  // Excludes numbers that are actually the tail of a code like "STU-0003",
  // "REF: 893421", "ACC/22500" — hyphens/colons/slashes aren't alphanumeric
  // so the main regex's lookbehind alone won't catch these.
  const codePrefixRegex = /(STU|ST|ADM|REF|TXN|ACC|ACCT|ID|NO|ITEM|PIN|SIM|SUB)[\s\-\/:#]*$/i;

  const candidates: { value: number; raw: string; index: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = numberRegex.exec(text)) !== null) {
    const raw = m[1];
    const value = parseFloat(raw.replace(/,/g, ""));
    const before = text.slice(Math.max(0, m.index - 8), m.index);
    if (!isNaN(value) && value > 0 && !codePrefixRegex.test(before)) {
      candidates.push({ value, raw, index: m.index });
    }
  }

  if (candidates.length === 0) return null;

  // Prefer a candidate that has a currency symbol/keyword shortly before it
  const currencyKeywordRegex = /(NGN|N|₦|amount|payment|paid|received|credit(?:ed)?)/i;
  for (const c of candidates) {
    const windowStart = Math.max(0, c.index - 20);
    const before = text.slice(windowStart, c.index);
    if (currencyKeywordRegex.test(before)) {
      return c.value;
    }
  }

  // No currency-adjacent match — exclude likely phone numbers (10+ digit runs)
  // and pick the candidate with the largest value (fees are usually the
  // biggest plain number in a payment SMS).
  const filtered = candidates.filter(c => c.raw.replace(/[.,]/g, "").length < 10);
  const pool = filtered.length > 0 ? filtered : candidates;
  return pool.reduce((a, b) => (b.value > a.value ? b : a)).value;
}

// Parse SMS text to extract payment details
function parseSMS(text: string): {
  amount: number | null;
  studentNumber: string | null;
  studentName: string | null;
  reference: string | null;
  currency: string;
} {
  const result = {
    amount: null as number | null,
    studentNumber: null as string | null,
    studentName: null as string | null,
    reference: null as string | null,
    currency: "NGN",
  };

  result.amount = extractAmount(text);

  // Extract student number — patterns like "STU-0001", "ST001", "Student No: 2026001"
  const studentNoPatterns = [
    /(?:STU|ST)[-\s]?([0-9]{3,6})/i,
    /(?:student\s*(?:no|number|id|code))[:\s]*([A-Z0-9\-\/]+)/i,
    /(?:admission\s*(?:no|number))[:\s]*([A-Z0-9\-\/]+)/i,
  ];

  for (const pattern of studentNoPatterns) {
    const match = text.match(pattern);
    if (match) {
      result.studentNumber = match[0].match(/[A-Z0-9\-\/]+$/i)?.[0] || match[1];
      break;
    }
  }

  // Extract student name — patterns like "Student: Ada Okafor", "for Adeji"
  const namePatterns = [
    /(?:student|name|for)\s*[:\s]\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/,
    /(?:student|name|for)\s+([A-Za-z]+(?:\s+[A-Za-z]+){0,2})/i,
  ];

  for (const pattern of namePatterns) {
    const match = text.match(pattern);
    if (match) {
      // Filter out common words that aren't names
      const candidate = match[1].trim();
      if (!["student", "payment", "school", "fees", "the"].includes(candidate.toLowerCase())) {
        result.studentName = candidate;
        break;
      }
    }
  }

  // Extract reference — patterns like "Ref: TXN893421", "TXN123456"
  const refPatterns = [
    /(?:ref|reference|txn|transaction)[:\s#]*([A-Z0-9\-]+)/i,
    /\b([A-Z]{2,4}[0-9]{5,})\b/,
  ];

  for (const pattern of refPatterns) {
    const match = text.match(pattern);
    if (match) {
      result.reference = match[1];
      break;
    }
  }

  return result;
}

// Calculate confidence score based on what was parsed
function calculateConfidence(parsed: ReturnType<typeof parseSMS>): number {
  let score = 0;
  if (parsed.amount) score += 0.4;
  if (parsed.studentNumber) score += 0.3;
  if (parsed.studentName) score += 0.2;
  if (parsed.reference) score += 0.1;
  return Math.min(score, 1.0);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Support multiple SMS gateway formats:
    // Format 1: SMS Gate (sms-gate.app) — nested payload structure
    // Format 2: Direct/simple { "sender": "+234...", "message": "..." }
    // Format 3: SMS Forwarder { "from": "+234...", "text": "..." }

    let sender: string | null = null;
    let messageText = "";
    let receivedAt = new Date().toISOString();
    let deviceId: string | null = null;
    let simNumber: number | null = null;
    let eventId = `sms-${Date.now()}`;
    let messageId = `msg-${Date.now()}`;

    // SMS Gate format: { event: "sms:received", deviceId: "...", payload: { message, sender, ... } }
    if (body.event && body.payload && typeof body.payload === "object") {
      const p = body.payload;
      sender = p.sender || null;
      messageText = p.message || p.text || "";
      receivedAt = p.receivedAt || new Date().toISOString();
      deviceId = body.deviceId || null;
      simNumber = p.simNumber || null;
      eventId = body.id || eventId;
      messageId = p.messageId || messageId;
    } else if (body.payload && typeof body.payload === "string") {
      // Some gateways send payload as a JSON string
      try {
        const p = JSON.parse(body.payload);
        sender = p.sender || null;
        messageText = p.message || p.text || "";
        receivedAt = p.receivedAt || new Date().toISOString();
        deviceId = body.deviceId || null;
        simNumber = p.simNumber || null;
        eventId = body.id || eventId;
        messageId = p.messageId || messageId;
      } catch {
        messageText = body.payload;
      }
    } else {
      // Simple format
      sender = body.sender || body.from || body.phone || body.sender_number || null;
      messageText = body.message || body.text || body.body || body.smsBody || "";
      receivedAt = body.timestamp || body.sentStamp || body.received_at || body.receivedAt || new Date().toISOString();
      deviceId = body.device_id || body.deviceId || body.device || null;
      simNumber = body.sim || body.simNumber || body.sim_number || null;
      eventId = body.event_id || body.eventId || body.id || eventId;
      messageId = body.message_id || body.messageId || body.msgId || messageId;
    }

    if (!messageText) {
      return NextResponse.json({ 
        error: "No message text provided",
        debug: {
          hasEvent: !!body.event,
          hasPayload: !!body.payload,
          payloadType: typeof body.payload,
          bodyKeys: Object.keys(body),
        }
      }, { status: 400 });
    }

    // Parse the SMS
    const parsed = parseSMS(messageText);
    const confidence = calculateConfidence(parsed);

    // Determine match status and generate explanatory reason
    let matchStatus = "unmatched";
    let matchReason = "";
    let matchedStudentId: string | null = null;
    let matchedStudentName: string | null = null;

    // Try to match student by code first (highest confidence)
    if (parsed.studentNumber) {
      const { data: student } = await supabase
        .from("students")
        .select("id, full_name, student_code")
        .or(`student_code.ilike.%${parsed.studentNumber}%,full_name.ilike.%${parsed.studentNumber}%`)
        .limit(1)
        .maybeSingle();
      if (student) {
        matchedStudentId = student.id;
        matchedStudentName = student.full_name;
      }
    }

    // Also try matching by name if code didn't match
    if (!matchedStudentId && parsed.studentName) {
      const { data: student } = await supabase
        .from("students")
        .select("id, full_name, student_code")
        .ilike("full_name", `%${parsed.studentName}%`)
        .limit(1)
        .maybeSingle();
      if (student) {
        matchedStudentId = student.id;
        matchedStudentName = student.full_name;
      }
    }

    // Build the match reason explanation
    if (parsed.amount && matchedStudentId && parsed.studentNumber && parsed.studentName) {
      matchStatus = "needs_review";
      matchReason = `Matched — name "${matchedStudentName}" and student no "${parsed.studentNumber}" both match. Amount: ₦${parsed.amount.toLocaleString()}.`;
    } else if (parsed.amount && matchedStudentId && parsed.studentNumber) {
      matchStatus = "needs_review";
      matchReason = `Matched — student no "${parsed.studentNumber}" matches "${matchedStudentName}". Amount: ₦${parsed.amount.toLocaleString()}.`;
    } else if (parsed.amount && matchedStudentId && parsed.studentName) {
      matchStatus = "needs_review";
      matchReason = `Matched — name "${parsed.studentName}" matches student "${matchedStudentName}". Amount: ₦${parsed.amount.toLocaleString()}.`;
    } else if (parsed.amount && !matchedStudentId && parsed.studentNumber) {
      matchStatus = "needs_review";
      matchReason = `Amount ₦${parsed.amount.toLocaleString()} parsed with student no "${parsed.studentNumber}", but no matching student found in database. Manual assignment needed.`;
    } else if (parsed.amount && !matchedStudentId && parsed.studentName) {
      matchStatus = "needs_review";
      matchReason = `Amount ₦${parsed.amount.toLocaleString()} parsed with name "${parsed.studentName}", but no matching student found in database. Manual assignment needed.`;
    } else if (parsed.amount && !parsed.studentNumber && !parsed.studentName) {
      matchStatus = "unmatched";
      matchReason = `Amount ₦${parsed.amount.toLocaleString()} parsed but no student identifier found in the message. Cannot auto-match.`;
    } else {
      matchStatus = "unmatched";
      matchReason = `Could not parse a valid amount or student identifier from this message.`;
    }

    // Check for duplicate (same sender + same amount within 5 minutes)
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: existingMsgs } = await supabase
      .from("sms_inbox")
      .select("id")
      .eq("sender", sender)
      .gte("created_at", fiveMinAgo)
      .limit(1);

    if (existingMsgs && existingMsgs.length > 0 && parsed.amount) {
      const { data: dupeCheck } = await supabase
        .from("sms_inbox")
        .select("id, parsed_amount, parsed_student_name")
        .eq("sender", sender)
        .eq("parsed_amount", parsed.amount)
        .gte("created_at", fiveMinAgo)
        .limit(1);

      if (dupeCheck && dupeCheck.length > 0) {
        matchStatus = "duplicate";
        matchReason = `Duplicate — same sender and same amount (₦${parsed.amount.toLocaleString()}) received within 5 minutes of a previous message${matchedStudentName ? ` for "${matchedStudentName}"` : ""}. Likely a repeated notification.`;
      }
    }

    // Insert into sms_inbox
    const { data: inserted, error } = await supabase.from("sms_inbox").insert({
      event_id: eventId,
      message_id: messageId,
      device_id: deviceId,
      sender: sender,
      sim_number: simNumber || null,
      message_text: messageText,
      received_at: receivedAt,
      parsed_student_number: parsed.studentNumber,
      parsed_student_name: parsed.studentName,
      parsed_amount: parsed.amount,
      parsed_currency: parsed.currency,
      parsed_reference: parsed.reference,
      parser_version: "v2",
      processing_status: "received",
      match_status: matchStatus,
      match_reason: matchReason,
      matched_student_id: matchedStudentId,
      confidence_score: confidence,
      raw_payload: body,
    }).select("id").single();

    if (error) {
      console.error("SMS insert error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Check if auto-credit is enabled
    let autoCredit = false;
    if (matchedStudentId && parsed.amount && matchStatus === "needs_review") {
      const { data: settings } = await supabase
        .from("school_settings")
        .select("sms_auto_credit, sms_auto_credit_min_confidence")
        .limit(1)
        .single();

      if (settings?.sms_auto_credit && confidence >= (settings.sms_auto_credit_min_confidence || 0.80)) {
        // Auto-credit: create income entry and mark SMS as matched
        const { data: receiptNos } = await supabase.from("income_entries").select("receipt_no");
        const existingNos = (receiptNos ?? []).map((r: any) => r.receipt_no);
        let maxNum = 0;
        existingNos.forEach((rn: string) => {
          const n = parseInt(rn.replace("RCT-", ""), 10);
          if (!isNaN(n) && n > maxNum) maxNum = n;
        });
        const receiptNo = `RCT-${String(maxNum + 1).padStart(4, "0")}`;

        // Get student name
        const { data: student } = await supabase
          .from("students")
          .select("full_name")
          .eq("id", matchedStudentId)
          .single();

        await supabase.from("income_entries").insert({
          receipt_no: receiptNo,
          date: new Date(receivedAt).toISOString().substring(0, 10),
          student_id: matchedStudentId,
          student_name: student?.full_name || parsed.studentName,
          category: "School Fees",
          description: `SMS Payment — ${parsed.reference || sender || "auto-credited"}`,
          amount: parsed.amount,
          payment_method: "Bank Transfer",
          recorded_by: "System (Auto-Credit)",
          reconciled: false,
          payment_source: "smsgate_auto",
          sms_inbox_id: inserted?.id,
        });

        // Update SMS record to matched
        await supabase.from("sms_inbox").update({
          match_status: "matched",
          processing_status: "confirmed",
          match_reason: "auto_credit",
        }).eq("id", inserted?.id);

        // Log it
        await supabase.from("activity_log").insert({
          action: "Auto-Credit SMS Payment",
          details: `${receiptNo} — ${student?.full_name || parsed.studentName} — ₦${parsed.amount} (confidence: ${Math.round(confidence * 100)}%)`,
        });

        autoCredit = true;
      }
    }

    return NextResponse.json({
      success: true,
      id: inserted?.id,
      auto_credited: autoCredit,
      parsed: {
        amount: parsed.amount,
        student_number: parsed.studentNumber,
        student_name: parsed.studentName,
        reference: parsed.reference,
        confidence,
        match_status: autoCredit ? "matched" : matchStatus,
        matched_student_id: matchedStudentId,
      },
    });
  } catch (err: any) {
    console.error("SMS webhook error:", err);
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}

// Also support GET for health check / testing
export async function GET() {
  return NextResponse.json({
    status: "ok",
    endpoint: "SMS Payment Webhook",
    usage: "POST a JSON body with { sender, message } to process an SMS payment alert.",
    example: {
      sender: "+2348012345678",
      message: "Payment 5000 for Student Adeji ST001",
    },
  });
}
