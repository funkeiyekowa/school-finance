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
// Supports two formats:
// 1. Bank alert: "CR:N42,000.00\nDesc:LOVETH OMOS RE/FAVOR VICTOR\nDT:05/MAY/26..."
// 2. Simple: "S019 4900" or "Payment 5000 for Student Adeji ST001"
function parseSMS(text: string): {
  amount: number | null;
  studentNumber: string | null;
  studentName: string | null;
  reference: string | null;
  currency: string;
  isDebit: boolean;
} {
  const result = {
    amount: null as number | null,
    studentNumber: null as string | null,
    studentName: null as string | null,
    reference: null as string | null,
    currency: "NGN",
    isDebit: false,
    payeeName: null as string | null,
    transactionDate: null as string | null,
  };

  // ---------- DETECT DEBIT vs CREDIT ----------
  const isDR = /\bDR\s*[:]\s*N/i.test(text);
  const isCR = /\bCR\s*[:]\s*N/i.test(text);
  result.isDebit = isDR && !isCR; // if both somehow present, treat as credit

  // ---------- BANK ALERT FORMAT (works for both CR and DR) ----------
  // Parse amount from "CR:N42,000.00" or "DR:N200,000.00"
  const amtMatch = text.match(/(?:CR|DR)\s*[:]\s*N([0-9,]+(?:\.[0-9]{2})?)/i);
  if (amtMatch) {
    const amt = parseFloat(amtMatch[1].replace(/,/g, ""));
    if (amt > 0) result.amount = amt;

    // Extract description/payee from "Desc:" line
    const descMatch = text.match(/Desc\s*[:]\s*(.+?)(?:\n|DT:|$)/i);
    if (descMatch) {
      let desc = descMatch[1].trim();

      // Remove common bank transfer prefixes
      desc = desc.replace(/^(COB\s+TRF\s+(TO|FROM)|NIP\s*(CR|DR)?|TRF\s+(FROM|TO)|TRANSFER\s+(FROM|TO))\s*/i, "");
      desc = desc.replace(/\*{2,}\d+/g, "").trim(); // remove **3387 style account refs
      desc = desc.replace(/\s+NOTE\s+.*$/i, "").trim(); // remove trailing notes

      if (result.isDebit) {
        // ---------- DEBIT: extract payee name ----------
        const nameParts = desc.split(/[\/\\]/);
        const payeeRaw = nameParts[0].trim();
        if (payeeRaw.length >= 2) {
          result.payeeName = payeeRaw
            .split(/\s+/)
            .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
            .join(" ");
        }
        // Store full desc as reference for the expense
        result.reference = desc;
      } else {
        // ---------- CREDIT: extract student code + name ----------
        const codeAtStart = desc.match(/^(S[0-9]{3,4})\s+(.+)/i);
        if (codeAtStart) {
          result.studentNumber = codeAtStart[1].toUpperCase();
          const nameRaw = codeAtStart[2].split(/[\/\\]/)[0].trim();
          if (nameRaw.length >= 2) {
            result.studentName = nameRaw
              .split(/\s+/)
              .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
              .join(" ");
          }
        } else {
          // No student code — treat the whole Desc as a name
          const nameParts = desc.split(/[\/\\]/);
          const nameCandidate = nameParts[0].trim();
          if (nameCandidate.length >= 3) {
            result.studentName = nameCandidate
              .split(/\s+/)
              .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
              .join(" ");
          }
        }
      }
    }

    // Also check for student code elsewhere in the message (if not found in Desc)
    if (!result.studentNumber && !result.isDebit) {
      const codeInMsg = text.match(/\b(S[0-9]{3,4})\b/i);
      if (codeInMsg) result.studentNumber = codeInMsg[1].toUpperCase();
    }

    // Extract transaction date from "DT:" field
    const dtMatch = text.match(/DT\s*[:]\s*([^\n]+)/i);
    if (dtMatch) result.transactionDate = dtMatch[1].trim();

    return result;
  }

  // ---------- SIMPLE FORMAT ----------
  // Fallback: use the generic amount extractor
  result.amount = extractAmount(text);

  // Extract student number — patterns like "S019", "S327", "STU-0001", "ST001"
  const studentNoPatterns = [
    /\b(S[0-9]{3,4})\b/i,
    /(?:STU|ST)[-\s]?([0-9]{3,6})/i,
    /(?:student\s*(?:no|number|id|code))[:\s]*([A-Z0-9\-\/]+)/i,
    /(?:admission\s*(?:no|number))[:\s]*([A-Z0-9\-\/]+)/i,
  ];

  for (const pattern of studentNoPatterns) {
    const match = text.match(pattern);
    if (match) {
      result.studentNumber = match[1] || match[0];
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
// Generate a payment reference: PAY + YYYYMMDD + LASTNAME (uppercase)
function generatePaymentRef(receivedAt: string, studentName: string | null): string {
  const d = new Date(receivedAt || Date.now());
  const dateStr = d.getFullYear().toString() +
    String(d.getMonth() + 1).padStart(2, "0") +
    String(d.getDate()).padStart(2, "0");
  const lastName = (studentName || "").split(" ")[0].toUpperCase().replace(/[^A-Z]/g, "") || "UNK";
  return `PAY${dateStr}${lastName}`;
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

    // ---------- SENDER WHITELIST CHECK ----------
    // If the school configured allowed senders, only process messages from those.
    // Matching is case-insensitive and partial (e.g. "gtbank" matches sender "GTBank").
    const { data: whitelistSettings } = await supabase
      .from("school_settings")
      .select("sms_allowed_senders")
      .limit(1)
      .single();

    const allowedSendersRaw = (whitelistSettings as any)?.sms_allowed_senders || "";
    if (allowedSendersRaw.trim()) {
      const allowedList = allowedSendersRaw
        .split(",")
        .map((s: string) => s.trim().toLowerCase())
        .filter((s: string) => s.length > 0);

      const senderLower = (sender || "").toLowerCase();
      const isAllowed = allowedList.some((allowed: string) =>
        senderLower.includes(allowed) || allowed.includes(senderLower)
      );

      if (!isAllowed) {
        return NextResponse.json({
          success: false,
          skipped: true,
          reason: `Sender "${sender}" is not in the allowed senders list. Message ignored.`,
        });
      }
    }

    // Parse the SMS
    const parsed = parseSMS(messageText);

    // ============================================================
    // DEBIT (DR) → EXPENSE ALERT PROCESSING
    // ============================================================
    if (parsed.isDebit) {
      // Detect expense category from description keywords
      const descLower = (parsed.payeeName || parsed.reference || "").toLowerCase();
      let expenseCategory = "Other Expense";
      const categoryKeywords: Record<string, string[]> = {
        "Rent": ["rent", "landlord", "lease"],
        "Utilities": ["electricity", "water", "nepa", "phcn", "dstv", "internet", "airtime", "mtn", "glo", "airtel", "9mobile"],
        "Salaries & Wages": ["salary", "wages", "payroll", "staff"],
        "Teaching Supplies & Materials": ["books", "textbook", "stationery", "supplies", "materials", "printing", "paper"],
        "Maintenance & Repairs": ["repair", "maintenance", "plumbing", "electrical", "fixing"],
        "Transport": ["transport", "fuel", "diesel", "petrol", "uber", "bolt", "logistics"],
        "Textbook Purchases": ["textbook", "notebook", "note book"],
        "Administrative & Office": ["office", "admin", "stamp", "certificate", "registration"],
        "Insurance": ["insurance", "hmo", "health"],
      };
      for (const [cat, keywords] of Object.entries(categoryKeywords)) {
        if (keywords.some(kw => descLower.includes(kw))) {
          expenseCategory = cat;
          break;
        }
      }

      // Check auto-expense setting
      const { data: expSettings } = await supabase
        .from("school_settings")
        .select("sms_auto_expense")
        .limit(1)
        .single();
      const autoExpenseEnabled = (expSettings as any)?.sms_auto_expense === true;

      // Try to match vendor by name
      let matchedVendorId: string | null = null;
      let matchedVendorName: string | null = null;
      if (parsed.payeeName) {
        const words = parsed.payeeName.split(/\s+/).filter(w => w.length >= 3);
        for (const word of words) {
          const { data: vendor } = await supabase
            .from("vendors")
            .select("id, name")
            .ilike("name", `%${word}%`)
            .limit(1)
            .maybeSingle();
          if (vendor) {
            matchedVendorId = vendor.id;
            matchedVendorName = vendor.name;
            break;
          }
        }
      }

      const expMatchStatus = autoExpenseEnabled ? "matched" : "needs_review";
      const expMatchReason = autoExpenseEnabled
        ? `Auto-posted expense ✓ — ₦${parsed.amount?.toLocaleString()} debited. Payee: "${parsed.payeeName || "Unknown"}". Category: ${expenseCategory}.${matchedVendorName ? ` Matched vendor: "${matchedVendorName}".` : ""}`
        : `Review required (expense) — ₦${parsed.amount?.toLocaleString()} debited to "${parsed.payeeName || "Unknown"}". Auto-expense posting is disabled. Approve to record as expense.${matchedVendorName ? ` Suggested vendor: "${matchedVendorName}".` : ""}`;

      const expRef = generatePaymentRef(receivedAt, parsed.payeeName);

      // Insert into sms_inbox as an expense alert
      const { data: expInserted, error: expError } = await supabase.from("sms_inbox").insert({
        event_id: eventId,
        message_id: messageId,
        device_id: deviceId,
        sender: sender,
        sim_number: simNumber || null,
        message_text: messageText,
        received_at: receivedAt,
        parsed_student_number: null,
        parsed_student_name: parsed.payeeName, // reuse field for payee name
        parsed_amount: parsed.amount,
        parsed_currency: parsed.currency,
        parsed_reference: expRef,
        parser_version: "v3-expense",
        processing_status: autoExpenseEnabled ? "confirmed" : "received",
        match_status: expMatchStatus,
        match_reason: expMatchReason,
        matched_student_id: null,
        confidence_score: matchedVendorId ? 0.8 : 0.5,
        raw_payload: body,
      }).select("id").single();

      if (expError) {
        return NextResponse.json({ error: expError.message }, { status: 500 });
      }

      // Auto-post expense if enabled
      let autoExpensePosted = false;
      if (autoExpenseEnabled && parsed.amount && expInserted?.id) {
        // Generate voucher number
        const { data: voucherNos } = await supabase.from("expense_entries").select("voucher_no");
        const existingVNos = (voucherNos ?? []).map((r: any) => r.voucher_no);
        let maxVNum = 0;
        existingVNos.forEach((vn: string) => {
          const n = parseInt(vn.replace("VCH-", ""), 10);
          if (!isNaN(n) && n > maxVNum) maxVNum = n;
        });
        const voucherNo = `VCH-${String(maxVNum + 1).padStart(4, "0")}`;

        // Parse date from DT field or use received time
        let expenseDate = new Date(receivedAt).toISOString().substring(0, 10);
        if (parsed.transactionDate) {
          // Try to parse "05/MAY/26 08:24AM" format
          const dtParsed = new Date(parsed.transactionDate.replace(/(\d{2})\/([A-Z]+)\/(\d{2})/, "$2 $1, 20$3"));
          if (!isNaN(dtParsed.getTime())) expenseDate = dtParsed.toISOString().substring(0, 10);
        }

        await supabase.from("expense_entries").insert({
          voucher_no: voucherNo,
          date: expenseDate,
          vendor_id: matchedVendorId,
          vendor_name: matchedVendorName || parsed.payeeName,
          category: expenseCategory,
          description: `Bank DR Alert — ${parsed.reference || parsed.payeeName || "auto-posted"}`,
          amount: parsed.amount,
          payment_method: "Bank Transfer",
          approved_by: "System (Auto-Expense)",
          reconciled: false,
          notes: `SMS Alert: ${messageText.substring(0, 200)}`,
        });

        // Update sms_inbox
        await supabase.from("sms_inbox").update({
          processing_status: "confirmed",
          match_reason: expMatchReason,
          parsed_reference: `${expRef} / ${voucherNo}`,
        }).eq("id", expInserted.id);

        // Log it
        await supabase.from("activity_log").insert({
          action: "Auto-Post Expense (DR Alert)",
          details: `${voucherNo} — ${parsed.payeeName || "Unknown"} — ₦${parsed.amount.toLocaleString()} — ${expenseCategory}`,
        });

        autoExpensePosted = true;
      }

      return NextResponse.json({
        success: true,
        id: expInserted?.id,
        type: "expense",
        auto_posted: autoExpensePosted,
        parsed: {
          amount: parsed.amount,
          payee: parsed.payeeName,
          category: expenseCategory,
          reference: expRef,
          vendor_matched: matchedVendorName,
          match_status: expMatchStatus,
        },
      });
    }

    // ============================================================
    // CREDIT (CR) → INCOME / STUDENT PAYMENT PROCESSING
    // ============================================================

    const confidence = calculateConfidence(parsed);

    // ---------- STUDENT MATCHING ----------
    let matchedStudentId: string | null = null;
    let matchedStudentName: string | null = null;
    let matchedBy = ""; // how we matched: "code+name", "code", "name", or ""

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
        matchedBy = "code";
      }
    }

    // Also try matching by name if code didn't match
    if (!matchedStudentId && parsed.studentName) {
      // Try full name first
      const { data: student } = await supabase
        .from("students")
        .select("id, full_name, student_code")
        .ilike("full_name", `%${parsed.studentName}%`)
        .limit(1)
        .maybeSingle();
      if (student) {
        matchedStudentId = student.id;
        matchedStudentName = student.full_name;
        matchedBy = "name";
      }

      // If no match, try each word of the name separately (handles partial/imperfect names)
      if (!matchedStudentId) {
        const words = parsed.studentName.split(/\s+/).filter(w => w.length >= 3);
        for (const word of words) {
          const { data: s } = await supabase
            .from("students")
            .select("id, full_name, student_code")
            .or(`full_name.ilike.%${word}%,last_name.ilike.%${word}%,first_name.ilike.%${word}%`)
            .limit(1)
            .maybeSingle();
          if (s) {
            matchedStudentId = s.id;
            matchedStudentName = s.full_name;
            matchedBy = "name";
            break;
          }
        }
      }
    }

    // If matched by code AND the name was also parsed, note it
    if (matchedBy === "code" && parsed.studentName) {
      matchedBy = "code+name";
    }

    // ---------- CHECK AUTO-CREDIT SETTING EARLY ----------
    // We need to know this BEFORE generating the reason, so the comment
    // can honestly tell the reviewer whether the payment was auto-posted or not.
    const { data: settings } = await supabase
      .from("school_settings")
      .select("sms_auto_credit, sms_auto_credit_min_confidence")
      .limit(1)
      .single();

    const autoCreditEnabled = settings?.sms_auto_credit === true;
    const minConfidence = settings?.sms_auto_credit_min_confidence || 0.80;
    const meetsThreshold = confidence >= minConfidence;
    const willAutoCredit = autoCreditEnabled && meetsThreshold && !!matchedStudentId && !!parsed.amount;

    // ---------- DUPLICATE CHECK ----------
    // Use student number + amount (NOT sender number, since all bank
    // alerts come from the same sender). A duplicate is: same student
    // code + same amount within 5 minutes.
    let isDuplicate = false;
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    if (parsed.amount && (parsed.studentNumber || matchedStudentId)) {
      let query = supabase
        .from("sms_inbox")
        .select("id")
        .eq("parsed_amount", parsed.amount)
        .gte("created_at", fiveMinAgo);

      if (parsed.studentNumber) {
        query = query.eq("parsed_student_number", parsed.studentNumber);
      } else if (matchedStudentId) {
        query = query.eq("matched_student_id", matchedStudentId);
      }

      const { data: dupeCheck } = await query.limit(1);
      if (dupeCheck && dupeCheck.length > 0) {
        isDuplicate = true;
      }
    }

    // ---------- DETERMINE STATUS + REASON ----------
    let matchStatus: string;
    let matchReason: string;

    if (isDuplicate) {
      matchStatus = "duplicate";
      matchReason = `Duplicate — same student (${parsed.studentNumber || matchedStudentName}) and same amount (₦${parsed.amount?.toLocaleString()}) received within 5 minutes of a previous message. Payment NOT posted. Likely a repeated bank notification.`;

    } else if (willAutoCredit) {
      // Will be auto-posted — status set to "matched" after insert
      matchStatus = "matched";
      const howMatched = matchedBy === "code+name"
        ? `name "${matchedStudentName}" and student no "${parsed.studentNumber}" both match`
        : matchedBy === "code"
        ? `student no "${parsed.studentNumber}" matches "${matchedStudentName}"`
        : `name "${parsed.studentName}" matches student "${matchedStudentName}"`;
      matchReason = `Auto-credited ✓ — ${howMatched}. ₦${parsed.amount!.toLocaleString()} posted to ${matchedStudentName}'s account automatically (confidence ${Math.round(confidence * 100)}% ≥ threshold ${Math.round(minConfidence * 100)}%).`;

    } else if (matchedStudentId && parsed.amount) {
      // Found a match but NOT auto-crediting — explain why
      matchStatus = "needs_review";
      const howMatched = matchedBy === "code+name"
        ? `name "${matchedStudentName}" and student no "${parsed.studentNumber}" both match`
        : matchedBy === "code"
        ? `student no "${parsed.studentNumber}" matches "${matchedStudentName}"`
        : `name "${parsed.studentName}" matches student "${matchedStudentName}"`;

      if (!autoCreditEnabled) {
        matchReason = `Review required — ${howMatched}. Amount: ₦${parsed.amount.toLocaleString()}. Auto-credit is DISABLED in settings. An admin must manually approve to post this payment to the student's account.`;
      } else if (!meetsThreshold) {
        matchReason = `Review required — ${howMatched}. Amount: ₦${parsed.amount.toLocaleString()}. Confidence (${Math.round(confidence * 100)}%) is below the auto-credit threshold (${Math.round(minConfidence * 100)}%). Manual approval needed.`;
      } else {
        matchReason = `Review required — ${howMatched}. Amount: ₦${parsed.amount.toLocaleString()}. Approve to post payment.`;
      }

    } else if (parsed.amount && !matchedStudentId && (parsed.studentNumber || parsed.studentName)) {
      matchStatus = "needs_review";
      const identifier = parsed.studentNumber || parsed.studentName;
      matchReason = `Review required — amount ₦${parsed.amount.toLocaleString()} parsed with identifier "${identifier}", but NO matching student found in the database. Assign a student manually before approving.`;

    } else if (parsed.amount && !parsed.studentNumber && !parsed.studentName) {
      matchStatus = "unmatched";
      matchReason = `Unmatched — amount ₦${parsed.amount.toLocaleString()} parsed but no student name or number found in the message. Cannot determine which student to credit.`;

    } else {
      matchStatus = "unmatched";
      matchReason = `Unmatched — could not parse a valid payment amount or student identifier from this message.`;
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
      parsed_student_name: matchedStudentName || parsed.studentName,
      parsed_amount: parsed.amount,
      parsed_currency: parsed.currency,
      parsed_reference: parsed.reference || generatePaymentRef(receivedAt, matchedStudentName),
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

    // Execute auto-credit if determined above
    let autoCredit = false;
    if (willAutoCredit && inserted?.id) {
      // Generate receipt number
      const { data: receiptNos } = await supabase.from("income_entries").select("receipt_no");
      const existingNos = (receiptNos ?? []).map((r: any) => r.receipt_no);
      let maxNum = 0;
      existingNos.forEach((rn: string) => {
        const n = parseInt(rn.replace("RCT-", ""), 10);
        if (!isNaN(n) && n > maxNum) maxNum = n;
      });
      const receiptNo = `RCT-${String(maxNum + 1).padStart(4, "0")}`;

      // Create income entry
      await supabase.from("income_entries").insert({
        receipt_no: receiptNo,
        date: new Date(receivedAt).toISOString().substring(0, 10),
        student_id: matchedStudentId,
        student_name: matchedStudentName || parsed.studentName,
        category: "School Fees",
        description: `SMS Payment — ${parsed.reference || sender || "auto-credited"}`,
        amount: parsed.amount!,
        payment_method: "Bank Transfer",
        recorded_by: "System (Auto-Credit)",
        reconciled: false,
        payment_source: "smsgate_auto",
        sms_inbox_id: inserted.id,
      });

      // Update SMS record — already set to "matched" in insert, update with student details
      await supabase.from("sms_inbox").update({
        processing_status: "confirmed",
        match_reason: matchReason,
        parsed_student_name: matchedStudentName,
      }).eq("id", inserted.id);

      // Log it
      await supabase.from("activity_log").insert({
        action: "Auto-Credit SMS Payment",
        details: `${receiptNo} — ${matchedStudentName || parsed.studentName} — ₦${parsed.amount!.toLocaleString()} (confidence: ${Math.round(confidence * 100)}%)`,
      });

      autoCredit = true;
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
