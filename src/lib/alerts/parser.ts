/**
 * Bank alert parsing — shared by the SMS webhook and the email webhook.
 *
 * Both channels carry the same bank notification text, so they must parse
 * identically. Keeping this in one module means a parsing fix applies to
 * SMS and email at once, and the two can never drift apart.
 */

/**
 * Which way the money moved. "unknown" is a real, expected outcome for
 * bank formats we don't recognise, and it must never be collapsed into
 * "credit" — posting a debit as income corrupts the ledger silently.
 */
export type AlertDirection = "credit" | "debit" | "unknown";

export interface ParsedAlert {
  amount: number | null;
  studentNumber: string | null;
  studentName: string | null;
  reference: string | null;
  currency: string;
  direction: AlertDirection;
  /** Convenience mirror of `direction === "debit"`. */
  isDebit: boolean;
  payeeName: string | null;
  /** Free-text purpose of a debit, e.g. "LOGISTICS" from "IYEKOWA F **8514 LOGISTICS" */
  purpose: string | null;
  /** Raw value of the bank's DT: field, e.g. "05/MAY/26 08:24AM" */
  transactionDate: string | null;
  /** Which shape the parser recognised — surfaced in the UI for diagnosis. */
  format: "fidelity-labelled" | "subject-amount" | "labelled-fields" | "freeform";
}

/**
 * Extract the payment amount from free-form alert text.
 *
 * Scans for every numeric candidate (comma-grouped or plain), discards
 * numbers that are really part of a code (STU0003, REF: 893421, phone
 * numbers), then prefers whichever candidate sits next to a currency
 * symbol or keyword. Falls back to the largest plausible number.
 *
 * A previous implementation assumed amounts were always comma-grouped,
 * which silently truncated plain runs like 40003 -> 400. The candidate
 * scan below is what prevents that class of bug.
 */
export function extractAmount(text: string): number | null {
  const numberRegex =
    /(?<![A-Za-z0-9])([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]{2})?|[0-9]{2,}(?:\.[0-9]{2})?)(?![A-Za-z0-9])/g;

  // Hyphens/colons/slashes aren't alphanumeric, so the lookbehind above
  // won't catch "STU-0003" or "REF: 893421" on its own.
  //
  // The leading \b matters: without it these tokens match inside ordinary
  // words, and "ID" sits inside "Paid" — which threw away the amount in
  // "Paid 22500" entirely.
  const codePrefixRegex =
    /\b(STU|ST|ADM|REF|TXN|ACC|ACCT|ID|NO|ITEM|PIN|SIM|SUB)[\s\-\/:#]*$/i;

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

  const currencyKeywordRegex =
    /(NGN|N|₦|amount|payment|paid|received|credit(?:ed)?|debit(?:ed)?)/i;
  for (const c of candidates) {
    const before = text.slice(Math.max(0, c.index - 20), c.index);
    if (currencyKeywordRegex.test(before)) return c.value;
  }

  // Drop likely phone numbers (10+ digits) then take the largest.
  const filtered = candidates.filter(c => c.raw.replace(/[.,]/g, "").length < 10);
  const pool = filtered.length > 0 ? filtered : candidates;
  return pool.reduce((a, b) => (b.value > a.value ? b : a)).value;
}

/** Title-case a raw name from a bank description. */
function titleCase(raw: string): string {
  return raw
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/** Keywords that signal the start of a transaction purpose rather than a name. */
const PURPOSE_KEYWORDS =
  /\b(LOGISTICS|TRANSPORT|RENT|SALARY|SALARIES|WAGES|FOOD|SUPPLIES|MATERIALS|FUEL|DIESEL|PETROL|AIRTIME|DATA|ELECTRICITY|WATER|INSURANCE|MAINTENANCE|REPAIR|REPAIRS|STATIONERY|PRINTING|OFFICE|ADMIN|SCHOOL|FEES|PAYMENT|UPKEEP|ALLOWANCE|BONUS|LEVY)\b/i;

/**
 * Channel and transfer wording that precedes the actual counterparty.
 *
 * Banks stamp the originating channel onto the narration — Union Bank uses
 * "UIP Trf from ..." and "MOBILEUNION Transfer to ...", others "COB TRF
 * TO", "NIP", "USSD". None of it is part of the payee's name.
 */
const CHANNEL_TRANSFER_PREFIX =
  /^(?:(?:MOBILE\w*|USSD\w*|IBANK\w*|CIB|IB|WEB|POS|ATM|NIP|COB|UIP|MBANK\w*|APP)[\s\-]+)*(?:TRF|TRFR|TRANSFER|PAYMENT|PMT|PURCHASE)?[\s\-]*(?:TO|FROM)?[\s\-]+/i;

/**
 * A repeated "... - Transfer to/from NAME" or "... / Transfer to/from NAME"
 * tail some banks append when the first name they gave was truncated —
 * "UIP Trf from TAIWO SHAKIRAH OKEO - Transfer from TAIWO SHAKIRAH
 * OKEOWO". The second occurrence is the complete name, so it replaces
 * rather than appends to what came before it.
 */
const REPEATED_TRANSFER_TAIL =
  /^(.*?)\s*[-\/]\s*(?:Transfer|Trf|TRF)\s+(?:to|from)\s+(.+)$/i;

/**
 * Split on the point where UPPERCASE words give way to lower-case ones.
 *
 * Nigerian bank narrations are typed with the beneficiary in caps and the
 * reason in ordinary case — "OLUKOSI OYEDELE JIMOH burial gift". That case
 * change is the only separator available when there's no "**1234" account
 * reference to key off. Returns null unless there's at least one caps word
 * followed by at least one lower-case word, so it never fires on a
 * narration that is uniformly cased.
 */
function splitOnCaseTransition(desc: string): { payee: string; purpose: string } | null {
  const tokens = desc.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;

  const isUpper = (t: string) => /[A-Z]/.test(t) && !/[a-z]/.test(t);

  let i = 0;
  while (i < tokens.length && isUpper(tokens[i])) i++;

  if (i === 0 || i === tokens.length) return null;

  return {
    payee: tokens.slice(0, i).join(" "),
    purpose: tokens.slice(i).join(" "),
  };
}

/**
 * Split a debit description into payee name and purpose.
 *
 * Nigerian bank debit alerts follow "[PAYEE] **[acct digits] [PURPOSE]",
 * e.g. "IYEKOWA F  **8514 LOGISTICS". The account reference is the most
 * reliable separator; failing that we look for a case change, then for a
 * known purpose keyword. Without this split the purpose gets glued onto
 * the vendor name ("Iyekowa F Logistics"), creating a bogus vendor for
 * every transaction.
 */
function splitPayeeAndPurpose(desc: string): { payee: string; purpose: string } {
  let payee = desc;
  let purpose = "";

  const acctSplit = desc.match(/^(.+?)\s*\*{2,}\d+\s*(.*?)$/);
  const caseSplit = acctSplit ? null : splitOnCaseTransition(desc);

  if (acctSplit) {
    payee = acctSplit[1].trim();
    purpose = acctSplit[2].trim();
  } else if (caseSplit) {
    payee = caseSplit.payee;
    purpose = caseSplit.purpose;
  } else {
    const kwMatch = payee.match(PURPOSE_KEYWORDS);
    if (kwMatch && kwMatch.index !== undefined && kwMatch.index > 3) {
      purpose = payee.substring(kwMatch.index).trim();
      payee = payee.substring(0, kwMatch.index).trim();
    }
  }

  payee = payee
    .replace(/\*{2,}\d*/g, "")
    .replace(/[\/\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return { payee, purpose };
}

/**
 * Remove the headers Gmail adds when a message is forwarded.
 *
 * A forwarded alert carries "From:", "Date:" and "Subject:" lines from the
 * original. Left in place they feed junk into the amount and name
 * extractors — the forwarder's own name can easily be mistaken for the
 * payer's.
 */
function stripForwardPreamble(text: string): string {
  return text
    .replace(/^-{2,}\s*(Forwarded message|Original Message)\s*-{2,}\s*$/gim, "")
    .replace(/^\s*(From|Sent|To|Cc|Bcc|Date|Subject|Reply-To)\s*:.*$/gim, "")
    .replace(/^\s*>+\s?/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Blank out balance figures so they can't be mistaken for the transaction
 * amount. Nigerian alerts quote the running balance right next to the
 * amount ("Bal:N3,897,345.44CR"), and it is almost always the larger
 * number, so a "biggest number wins" heuristic would pick it every time.
 */
function maskBalances(text: string): string {
  return text
    .replace(
      /\b(?:available|ledger|closing|opening|current|book)?\s*bal(?:ance)?\s*[:\-]?\s*(?:NGN|N|₦)?\s*[0-9,]+(?:\.[0-9]{1,2})?\s*(?:CR|DR)?/gi,
      " "
    )
    .replace(/\b(?:CR|DR)\b(?=\s*$)/gim, " ");
}

/** Count how many times a global pattern matches. */
function countMatches(text: string, pattern: RegExp): number {
  const m = text.match(pattern);
  return m ? m.length : 0;
}

/**
 * Work out whether money came in or went out.
 *
 * Checked in order of how explicit the signal is. The balance suffix
 * ("Bal:N3,897,345.44CR") looks like a direction marker but isn't, so it's
 * masked out before any word counting happens.
 */
export function detectDirection(text: string, subject = ""): AlertDirection {
  // 1. Labelled amount token — unambiguous (Fidelity).
  const hasDR = /\bDR\s*:\s*N?\s*[0-9]/i.test(text);
  const hasCR = /\bCR\s*:\s*N?\s*[0-9]/i.test(text);
  if (hasDR && !hasCR) return "debit";
  if (hasCR && !hasDR) return "credit";

  // 2. Subject line — e.g. "Union Bank Transaction Alert (Credit 9,000.00 NGN)".
  const subjDebit = /\bdebit(?:ed)?\b/i.test(subject);
  const subjCredit = /\bcredit(?:ed)?\b/i.test(subject);
  if (subjDebit && !subjCredit) return "debit";
  if (subjCredit && !subjDebit) return "credit";

  // 3. Explicit transaction-type field, common in HTML bank emails.
  //    Union Bank writes the value as "DebitAlert!" with no separator, so
  //    this reads a prefix rather than expecting a clean word.
  const typeField = text.match(
    new RegExp(String.raw`\b(?:transaction|txn|trans)\s*type${FIELD_SEP}([A-Za-z]+)`, "i")
  );
  if (typeField) {
    const t = typeField[1].toLowerCase();
    if (t.startsWith("deb") || t.startsWith("dr")) return "debit";
    if (t.startsWith("cre") || t.startsWith("cr")) return "credit";
  }

  // 4. Fall back to weighing the wording of the body. No \b on the trailing
  //    side, again because of run-together values like "DebitAlert".
  const body = maskBalances(text);
  const debitHits = countMatches(
    body,
    /\b(debit(?:ed)?|withdraw(?:al|n)?|transfer\s+to|payment\s+to|outflow|purchase)/gi
  );
  const creditHits = countMatches(
    body,
    /\b(credit(?:ed)?|deposit(?:ed)?|transfer\s+from|received\s+from|inflow|lodg(?:ed|ement))/gi
  );
  if (debitHits > creditHits) return "debit";
  if (creditHits > debitHits) return "credit";

  return "unknown";
}

/**
 * What separates a field label from its value.
 *
 * Union Bank lays its alert out as a table, and Gmail's plain-text
 * rendering of that table pads columns to their own width — a long label
 * like "Transaction Description" can end up with a single space before
 * its value while "Balance" gets several. Requiring 2+ spaces missed the
 * single-space case entirely and let the label match fall through to a
 * broader one, which is exactly how "Transaction Type CreditAlert!" ended
 * up stored as a student's name. A tab, a colon, a newline, or *any* run
 * of spaces (including just one) now all count as the separator.
 */
const FIELD_SEP = String.raw`(?:[ \t]*[:\-][ \t]*|\t[ \t]*|[ \t]*\r?\n[ \t]*|[ ]+)`;

/** Build a case-insensitive "label then separator" matcher. */
function labelRegex(label: string): RegExp {
  return new RegExp(String.raw`\b(?:${label})${FIELD_SEP}`, "i");
}

/**
 * Narration labels in priority order, most specific first.
 *
 * Order matters because these labels nest. Union Bank's alert opens with a
 * "Transaction Details" section header whose value is empty, and the real
 * narration is further down under "Transaction Description". Matching the
 * first label that merely *appears* would find the header, read an empty
 * value, and give up — which is precisely what happened.
 */
const NARRATION_LABELS = [
  String.raw`Transaction\s+Description`,
  String.raw`Transaction\s+Narration`,
  String.raw`Transaction\s+Remarks?`,
  String.raw`Narration`,
  String.raw`Description`,
  String.raw`Desc`,
  String.raw`Remarks?`,
  String.raw`Particulars`,
  String.raw`Payment\s+Details`,
  String.raw`Transaction\s+Details`,
  String.raw`Details`,
];

/** Labels that mark the start of the *next* field, ending the narration. */
const NEXT_FIELD_LABEL = new RegExp(
  String.raw`\b(?:DT|Date|Time|Bal(?:ance)?|Amount|Acct|Account|Ref(?:erence)?|Transaction\s+(?:Type|Amount|Date|Location|Time)|Value\s+Date|Available)${FIELD_SEP}`,
  "i"
);

/**
 * Pull the narration out of a labelled bank email.
 *
 * Returns null rather than guessing, because the caller must not fall back
 * to scanning the whole body for a name — the salutation ("Dear IYEKOWA F
 * MRS") is the account holder, not the person who paid.
 */
function extractNarration(text: string): string | null {
  for (const label of NARRATION_LABELS) {
    const re = new RegExp(String.raw`\b(?:${label})${FIELD_SEP}`, "gi");
    let m: RegExpExecArray | null;

    // A label can occur more than once; take the first that yields a value.
    while ((m = re.exec(text)) !== null) {
      const after = text.slice(m.index + m[0].length);
      const lineEnd = after.search(/\r?\n/);
      const fieldEnd = after.search(NEXT_FIELD_LABEL);

      const ends = [lineEnd, fieldEnd].filter(i => i > 0);
      const end = ends.length > 0 ? Math.min(...ends) : after.length;

      const value = after.slice(0, end).trim();
      if (value.length >= 3) return value;
    }
  }
  return null;
}

/**
 * Find an amount that is explicitly labelled as the transaction value.
 * Tried before the generic scanner so a currency-tagged figure always
 * beats "largest number in the text".
 */
function extractLabelledAmount(text: string): number | null {
  const amountNumber = String.raw`([0-9,]+(?:\.[0-9]{1,2})?)`;
  const patterns = [
    /\b(?:CR|DR)\s*:\s*(?:NGN|N|₦)?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i,
    // "Transaction Amount\tNGN 30,000.00" — tab-separated, no colon.
    new RegExp(
      String.raw`\b(?:transaction\s+)?amount(?:\s*\((?:NGN|naira)\))?${FIELD_SEP}(?:NGN|N|₦)?[ ]*${amountNumber}`,
      "i"
    ),
    /\b(?:NGN|₦)\s*([0-9,]+(?:\.[0-9]{1,2})?)/i,
    /\b([0-9,]+(?:\.[0-9]{1,2})?)\s*(?:NGN|naira)\b/i,
  ];

  for (const pattern of patterns) {
    const m = text.match(pattern);
    if (m) {
      const value = parseFloat(m[1].replace(/,/g, ""));
      if (!isNaN(value) && value > 0) return value;
    }
  }
  return null;
}

/** Remove a leading salutation so it can't be read as a counterparty name. */
function stripSalutation(text: string): string {
  return text.replace(/^\s*(dear|hello|hi)\b[^,\n]{0,60}[,\n]/i, " ");
}

/**
 * Populate counterparty fields from a bank narration.
 *
 * Credits read as "S327 Aimien Samuel" (student code then name); debits as
 * "IYEKOWA F **8514 LOGISTICS" (payee, account ref, purpose). Shared by
 * every format so the two never diverge.
 */
function applyNarration(result: ParsedAlert, rawDesc: string): void {
  // A truncated name followed by a full repeat of the same transfer wording
  // — take the second, complete occurrence and discard the first.
  const tailMatch = rawDesc.match(REPEATED_TRANSFER_TAIL);
  const withoutRepeat = tailMatch ? tailMatch[2] : rawDesc;

  const desc = withoutRepeat
    .replace(CHANNEL_TRANSFER_PREFIX, "")
    .replace(/\s+NOTE\s+.*$/i, "")
    .trim();

  if (result.isDebit) {
    const { payee, purpose } = splitPayeeAndPurpose(desc);
    if (payee.length >= 2) result.payeeName = titleCase(payee);
    result.purpose = purpose || null;
    result.reference = purpose || desc;
    return;
  }

  const cleaned = desc.replace(/\*{2,}\d+/g, "").trim();
  const codeAtStart = cleaned.match(/^(S[0-9]{3,4})\s+(.+)/i);

  let nameRaw: string;
  if (codeAtStart) {
    result.studentNumber = codeAtStart[1].toUpperCase();
    nameRaw = codeAtStart[2];
  } else {
    // A code can appear mid-narration too; remove it before reading a name
    // so it doesn't end up glued to the front of the name.
    nameRaw = cleaned.replace(/\b(S[0-9]{3,4})\b/i, "").trim();
  }

  nameRaw = nameRaw.split(/[\/\\]/)[0].trim();

  // A payer often appends a reason — "LOVETH OMOS school fees". The same
  // upper-to-lower case change that separates payee from purpose on a debit
  // separates name from reason here, so the stored name stays clean.
  const nameSplit = splitOnCaseTransition(nameRaw);
  if (nameSplit) {
    nameRaw = nameSplit.payee;
    result.purpose = nameSplit.purpose;
  }

  if (nameRaw.length >= 2) result.studentName = titleCase(nameRaw);
  if (!result.reference) result.reference = desc;
}

/**
 * Parse a bank alert (from SMS or email) into structured payment data.
 *
 * Handles, in order of preference:
 *  1. Fidelity labelled  — "CR:N42,000.00 Desc:S327 Aimien Samuel DT:05/MAY/26"
 *  2. Subject-carried    — "Union Bank Transaction Alert (Credit 9,000.00 NGN)"
 *  3. Labelled fields    — HTML emails with "Narration:" / "Amount:" rows
 *  4. Free-form text     — "S019 4900" or "Payment 5000 for Student Adeji ST001"
 *
 * `subject` matters: several banks put the direction and the amount only in
 * the subject line, so parsing the body alone loses both.
 */
export function parseAlert(rawText: string, subject: string | null = ""): ParsedAlert {
  const text = stripForwardPreamble(rawText);
  const subj = (subject || "").trim();

  const direction = detectDirection(text, subj);

  const result: ParsedAlert = {
    amount: null,
    studentNumber: null,
    studentName: null,
    reference: null,
    currency: "NGN",
    direction,
    isDebit: direction === "debit",
    payeeName: null,
    purpose: null,
    transactionDate: null,
    format: "freeform",
  };

  // ---------- Bank alert format ----------
  const amtMatch = text.match(/\b(?:CR|DR)\s*:\s*N?([0-9,]+(?:\.[0-9]{2})?)/i);
  if (amtMatch) {
    result.format = "fidelity-labelled";
    const amt = parseFloat(amtMatch[1].replace(/,/g, ""));
    if (amt > 0) result.amount = amt;

    const descMatch = text.match(/Desc\s*:\s*(.+?)(?:\r?\n|DT\s*:|Bal\s*:|$)/i);
    if (descMatch) applyNarration(result, descMatch[1].trim());

    if (!result.studentNumber && !result.isDebit) {
      const codeInMsg = text.match(/\b(S[0-9]{3,4})\b/i);
      if (codeInMsg) result.studentNumber = codeInMsg[1].toUpperCase();
    }

    const dtMatch = text.match(/DT\s*:\s*([^\r\n]+?)(?:\s+Bal\s*:|\r?\n|$)/i);
    if (dtMatch) result.transactionDate = dtMatch[1].trim();

    return result;
  }

  // ---------- Subject-carried / labelled-field formats ----------
  // Union Bank and most HTML bank emails carry no CR:/DR: token. The
  // direction and often the amount appear only in the subject line
  // ("Union Bank Transaction Alert (Credit 9,000.00 NGN)"), with the
  // narration in a labelled row of the body.
  const cleanBody = maskBalances(stripSalutation(text));
  const narration = extractNarration(text);
  const subjectAmount = subj ? extractLabelledAmount(subj) : null;
  const bodyAmount = extractLabelledAmount(cleanBody);

  if (subjectAmount || bodyAmount || narration) {
    result.format = subjectAmount ? "subject-amount" : "labelled-fields";

    // The subject is the bank's own one-line summary of the transaction, so
    // it outranks anything scraped out of the body markup.
    result.amount = subjectAmount ?? bodyAmount ?? extractAmount(cleanBody);

    const dtMatch = text.match(
      new RegExp(
        String.raw`\b(?:DT|(?:Value\s+|Transaction\s+)?Date(?:[ ]*(?:&|and)[ ]*Time)?)${FIELD_SEP}([^\r\n\t]+)`,
        "i"
      )
    );
    if (dtMatch) result.transactionDate = dtMatch[1].trim();

    // A student code is distinctive enough to trust anywhere in the body.
    const codeInMsg = (narration || cleanBody).match(/\b(S[0-9]{3,4})\b/i);
    if (codeInMsg) result.studentNumber = codeInMsg[1].toUpperCase();

    // Names are only read from an identified narration field. Scanning the
    // whole body would pick up the salutation, which is the account holder
    // rather than the person who paid.
    if (narration) applyNarration(result, narration);

    return result;
  }

  // ---------- Simple format ----------
  result.amount = extractAmount(maskBalances(text));

  const studentNoPatterns = [
    /\b(S[0-9]{3,4})\b/i,
    /(?:STU|ST)[-\s]?([0-9]{3,6})/i,
    /(?:student\s*(?:no|number|id|code))[:\s]*([A-Z0-9\-\/]+)/i,
    /(?:admission\s*(?:no|number))[:\s]*([A-Z0-9\-\/]+)/i,
  ];
  for (const pattern of studentNoPatterns) {
    const match = text.match(pattern);
    if (match) {
      result.studentNumber = (match[1] || match[0]).toUpperCase();
      break;
    }
  }

  const namePatterns = [
    /(?:student|name|for)\s*[:\s]\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/,
    /(?:student|name|for)\s+([A-Za-z]+(?:\s+[A-Za-z]+){0,2})/i,
  ];
  for (const pattern of namePatterns) {
    const match = text.match(pattern);
    if (match) {
      const candidate = match[1].trim();
      if (!["student", "payment", "school", "fees", "the"].includes(candidate.toLowerCase())) {
        result.studentName = candidate;
        break;
      }
    }
  }

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

/** Reference for records the bank didn't give us one for: PAY + YYYYMMDD + NAME. */
export function generatePaymentRef(receivedAt: string, name: string | null): string {
  const d = new Date(receivedAt || Date.now());
  const dateStr =
    d.getFullYear().toString() +
    String(d.getMonth() + 1).padStart(2, "0") +
    String(d.getDate()).padStart(2, "0");
  const namePart =
    (name || "").split(" ")[0].toUpperCase().replace(/[^A-Z]/g, "") || "UNK";
  return `PAY${dateStr}${namePart}`;
}

/** How much of the expected data we managed to parse (0–1). */
export function calculateConfidence(parsed: ParsedAlert): number {
  let score = 0;
  if (parsed.amount) score += 0.4;
  if (parsed.studentNumber) score += 0.3;
  if (parsed.studentName) score += 0.2;
  if (parsed.reference) score += 0.1;
  return Math.min(score, 1.0);
}

/** Expense categories inferred from words in the debit description. */
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  Rent: ["rent", "landlord", "lease"],
  Utilities: [
    "electricity", "water", "nepa", "phcn", "dstv", "internet",
    "airtime", "data", "mtn", "glo", "airtel", "9mobile",
  ],
  "Salaries & Wages": ["salary", "salaries", "wages", "payroll", "staff", "allowance"],
  "Teaching Supplies & Materials": [
    "stationery", "supplies", "materials", "printing", "paper", "chalk", "marker",
  ],
  "Maintenance & Repairs": ["repair", "maintenance", "plumbing", "electrical", "fixing"],
  Transport: ["transport", "fuel", "diesel", "petrol", "uber", "bolt", "logistics"],
  "Textbook Purchases": ["textbook", "notebook", "note book", "books"],
  "Administrative & Office": ["office", "admin", "stamp", "certificate", "registration"],
  Insurance: ["insurance", "hmo", "health"],
};

/** Best-guess expense category from a debit's payee and purpose text. */
export function detectExpenseCategory(...texts: (string | null)[]): string {
  const haystack = texts.filter(Boolean).join(" ").toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some(kw => haystack.includes(kw))) return category;
  }
  return "Other Expense";
}

/**
 * Convert a bank's date field into an ISO date (YYYY-MM-DD).
 *
 * Covers Fidelity's "05/MAY/26 08:24AM" and Union Bank's "20-Aug-2026
 * 12:27" — same order, different separators and year width. Returns null
 * when the value can't be understood, so callers fall back to the time the
 * alert was received rather than inventing a date.
 */
export function parseBankDate(raw: string | null): string | null {
  if (!raw) return null;

  // Day, month name, year — the shape every Nigerian bank alert uses.
  const named = raw.match(/(\d{1,2})[\/\-. ]([A-Za-z]{3,})[\/\-. ](\d{2,4})/);
  if (named) {
    const [, day, monthName, yearRaw] = named;
    const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw;
    const parsed = new Date(`${monthName} ${day}, ${year}`);
    if (!isNaN(parsed.getTime())) return parsed.toISOString().substring(0, 10);
  }

  // All-numeric day/month/year, e.g. "20/08/2026". Day first, which is the
  // Nigerian convention — never month first.
  const numeric = raw.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/);
  if (numeric) {
    const day = parseInt(numeric[1], 10);
    const month = parseInt(numeric[2], 10);
    const yearRaw = numeric[3];
    const year = parseInt(yearRaw.length === 2 ? `20${yearRaw}` : yearRaw, 10);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      const parsed = new Date(Date.UTC(year, month - 1, day));
      if (!isNaN(parsed.getTime())) return parsed.toISOString().substring(0, 10);
    }
  }

  return null;
}

/**
 * Strip HTML down to readable text — bank emails are almost always HTML.
 *
 * Bank alerts lay their fields out in a table, so cell and row boundaries
 * are the only thing separating a label from its value. Collapsing them to
 * plain spaces turns the whole alert into one unparseable line, so cells
 * become tabs and rows become newlines. That lines the HTML output up with
 * what Gmail's plain-text version already looks like.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(td|th)\s*>/gi, "\t")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    // Collapse runs of spaces but keep tabs — they're the label/value
    // separator recovered from the table cells above.
    .replace(/ {2,}/g, " ")
    .replace(/\t[ \t]*/g, "\t")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
