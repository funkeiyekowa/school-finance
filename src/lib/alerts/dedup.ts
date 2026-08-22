/**
 * Duplicate Detection Service
 *
 * Determines whether an incoming bank alert represents the same underlying
 * financial transaction as one already stored, or whether it is a
 * legitimately separate payment.
 *
 * Design principles:
 *   - Exact transaction/reference ID is the strongest signal.
 *   - Amount + name + time alone are NOT sufficient for auto-archive.
 *   - False duplicate detection is more dangerous than allowing a possible
 *     duplicate to remain visible for review.
 *   - When uncertain: KEEP ACTIVE.
 *   - Every decision is scored, evidenced, and auditable.
 *
 * Scoring hierarchy (starting values):
 *   Exact transaction reference match   +100
 *   Same student/vendor code            +30
 *   Same matched student/vendor entity  +20
 *   Same transaction type (CR/DR)       +20
 *   Same normalized amount              +20
 *   Same normalized narration           +20
 *   Very close timestamp (within window)+15
 *   Different source medium             +10
 *
 * Decision thresholds (configurable in school_settings):
 *   ≥ auto_archive_threshold (default 150) → PLATFORM_DUPLICATE (auto-archive)
 *   ≥ possible_threshold (default 80)      → POSSIBLE_DUPLICATE (flag for review)
 *   < possible_threshold                   → NOT_DUPLICATE (treat as separate)
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalize } from "./matcher";

// ============================================================
// TYPES
// ============================================================

export type DuplicateStatus =
  | "NOT_DUPLICATE"
  | "PLATFORM_DUPLICATE"
  | "POSSIBLE_DUPLICATE";

export interface DuplicateEvidence {
  field: string;
  points: number;
  detail: string;
}

export interface DuplicateResult {
  status: DuplicateStatus;
  confidence: number;
  primaryAlertId: string | null;
  primaryAlertChannel: string | null;
  evidence: DuplicateEvidence[];
  reason: string;
}

export interface DedupSettings {
  windowMinutes: number;
  autoArchiveThreshold: number;
  possibleThreshold: number;
}

export interface IncomingAlert {
  /** Bank-provided transaction/reference ID, if available. */
  transactionRef: string | null;
  /** Normalized amount. */
  amount: number | null;
  /** Transaction direction. */
  isDebit: boolean;
  /** Extracted student code (e.g. S583). */
  studentCode: string | null;
  /** Extracted student/vendor name. */
  counterpartyName: string | null;
  /** Normalized narration/description text. */
  narration: string | null;
  /** Source channel: "sms" or "email". */
  channel: string;
  /** When the alert was received (ISO string). */
  receivedAt: string;
}

interface CandidateRow {
  id: string;
  event_id: string | null;
  parsed_reference: string | null;
  parsed_amount: number | null;
  parsed_student_number: string | null;
  parsed_student_name: string | null;
  matched_student_id: string | null;
  parser_version: string | null;
  source_channel: string | null;
  message_text: string;
  received_at: string | null;
  created_at: string;
  archive_status: string | null;
}

// ============================================================
// SCORING FUNCTIONS
// ============================================================

/**
 * Normalize a bank transaction reference for comparison.
 * Strips whitespace, dashes, slashes, and lowercases.
 * Returns null if the reference is empty or purely synthetic (PAY-prefix).
 */
function normalizeRef(ref: string | null): string | null {
  if (!ref) return null;
  // Our system generates synthetic refs starting with "PAY" — those are
  // not bank-provided identifiers and must not be used for dedup.
  if (/^PAY\d{8}/i.test(ref.trim())) return null;
  const cleaned = ref.replace(/[\s\-\/\\#:]+/g, "").toLowerCase().trim();
  return cleaned.length >= 4 ? cleaned : null;
}

/** Check whether two amounts are identical (exact penny match). */
function amountsMatch(a: number | null, b: number | null): boolean {
  if (a == null || b == null) return false;
  return Math.abs(a - b) < 0.005; // float tolerance
}

/** Check whether two narrations are effectively the same. */
function narrationsMatch(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  // Exact normalized match
  if (na === nb) return true;
  // One contains the other (bank may truncate in SMS vs full in email)
  if (na.length > 10 && nb.length > 10) {
    if (na.includes(nb) || nb.includes(na)) return true;
  }
  return false;
}

/** Minutes between two timestamps. */
function minutesBetween(a: string, b: string): number {
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  if (isNaN(ta) || isNaN(tb)) return Infinity;
  return Math.abs(ta - tb) / 60000;
}

// ============================================================
// MAIN DEDUP FUNCTION
// ============================================================

/**
 * Check an incoming alert against recent records in sms_inbox.
 *
 * This runs BEFORE student/vendor matching so that confirmed duplicates
 * skip the matching and posting pipeline entirely.
 *
 * Returns NOT_DUPLICATE if no match is found, allowing the pipeline to
 * continue normally.
 */
export async function detectDuplicate(
  supabase: SupabaseClient,
  incoming: IncomingAlert,
  settings: DedupSettings
): Promise<DuplicateResult> {
  const noMatch: DuplicateResult = {
    status: "NOT_DUPLICATE",
    confidence: 0,
    primaryAlertId: null,
    primaryAlertChannel: null,
    evidence: [],
    reason: "No matching transaction found in the duplicate detection window.",
  };

  // We need at least an amount to find candidates.
  if (incoming.amount == null) return noMatch;

  const windowStart = new Date(
    Date.now() - settings.windowMinutes * 60 * 1000
  ).toISOString();

  // ---------- Step 1: Find candidates ----------
  // Query recent records that could be the same transaction.
  // Candidates must: same amount, created within the window, and ACTIVE.
  const { data: candidates } = await supabase
    .from("sms_inbox")
    .select(
      "id, event_id, parsed_reference, parsed_amount, parsed_student_number, " +
      "parsed_student_name, matched_student_id, parser_version, source_channel, " +
      "message_text, received_at, created_at, archive_status"
    )
    .eq("parsed_amount", incoming.amount)
    .gte("created_at", windowStart)
    .or("archive_status.eq.ACTIVE,archive_status.is.null")
    .order("created_at", { ascending: false })
    .limit(20);

  if (!candidates || candidates.length === 0) return noMatch;

  // ---------- Step 2: Score each candidate ----------
  let bestScore = 0;
  let bestCandidate: CandidateRow | null = null;
  let bestEvidence: DuplicateEvidence[] = [];

  for (const candidate of (candidates as unknown as CandidateRow[])) {
    const evidence: DuplicateEvidence[] = [];
    let score = 0;

    // --- Level 1: Transaction reference ---
    const incomingRef = normalizeRef(incoming.transactionRef);
    const candidateRef = normalizeRef(candidate.parsed_reference);
    if (incomingRef && candidateRef && incomingRef === candidateRef) {
      score += 100;
      evidence.push({ field: "transaction_reference", points: 100, detail: `Exact reference match: "${incoming.transactionRef}"` });
    }

    // --- Same transaction type (credit vs debit) ---
    const candidateIsDebit = candidate.parser_version?.includes("expense") ?? false;
    if (incoming.isDebit === candidateIsDebit) {
      score += 20;
      evidence.push({ field: "transaction_type", points: 20, detail: `Same type: ${incoming.isDebit ? "debit" : "credit"}` });
    } else {
      // Different type = definitely not the same transaction
      continue;
    }

    // --- Same amount (already filtered by query, but confirm) ---
    if (amountsMatch(incoming.amount, candidate.parsed_amount)) {
      score += 20;
      evidence.push({ field: "amount", points: 20, detail: `Same amount: ${incoming.amount}` });
    }

    // --- Same student/vendor code ---
    if (incoming.studentCode && candidate.parsed_student_number) {
      if (incoming.studentCode.toUpperCase() === candidate.parsed_student_number.toUpperCase()) {
        score += 30;
        evidence.push({ field: "student_code", points: 30, detail: `Same code: ${incoming.studentCode}` });
      }
    }

    // --- Same counterparty name (normalized) ---
    if (incoming.counterpartyName && candidate.parsed_student_name) {
      const nIncoming = normalize(incoming.counterpartyName);
      const nCandidate = normalize(candidate.parsed_student_name);
      if (nIncoming && nCandidate && nIncoming === nCandidate) {
        score += 20;
        evidence.push({ field: "counterparty_name", points: 20, detail: `Same name: "${incoming.counterpartyName}"` });
      }
    }

    // --- Same narration ---
    if (narrationsMatch(incoming.narration, candidate.message_text)) {
      score += 20;
      evidence.push({ field: "narration", points: 20, detail: "Same/similar narration text" });
    }

    // --- Close timestamp ---
    const candidateTime = candidate.received_at || candidate.created_at;
    const gap = minutesBetween(incoming.receivedAt, candidateTime);
    if (gap <= settings.windowMinutes) {
      score += 15;
      evidence.push({ field: "timestamp", points: 15, detail: `${Math.round(gap)} min apart (within ${settings.windowMinutes} min window)` });
    }

    // --- Different source medium (SMS vs email) ---
    if (incoming.channel !== (candidate.source_channel || "sms")) {
      score += 10;
      evidence.push({ field: "different_medium", points: 10, detail: `Cross-channel: incoming=${incoming.channel}, existing=${candidate.source_channel || "sms"}` });
    }

    if (score > bestScore) {
      bestScore = score;
      bestCandidate = candidate;
      bestEvidence = evidence;
    }
  }

  if (!bestCandidate || bestScore === 0) return noMatch;

  // ---------- Step 3: Decide ----------
  if (bestScore >= settings.autoArchiveThreshold) {
    return {
      status: "PLATFORM_DUPLICATE",
      confidence: Math.min(bestScore, 100), // cap display at 100%
      primaryAlertId: bestCandidate.id,
      primaryAlertChannel: bestCandidate.source_channel || "sms",
      evidence: bestEvidence,
      reason: buildReason("PLATFORM_DUPLICATE", bestEvidence, bestCandidate, incoming, bestScore),
    };
  }

  if (bestScore >= settings.possibleThreshold) {
    return {
      status: "POSSIBLE_DUPLICATE",
      confidence: Math.min(Math.round((bestScore / settings.autoArchiveThreshold) * 100), 99),
      primaryAlertId: bestCandidate.id,
      primaryAlertChannel: bestCandidate.source_channel || "sms",
      evidence: bestEvidence,
      reason: buildReason("POSSIBLE_DUPLICATE", bestEvidence, bestCandidate, incoming, bestScore),
    };
  }

  // Below threshold — not a duplicate
  return noMatch;
}

// ============================================================
// HELPERS
// ============================================================

function buildReason(
  status: DuplicateStatus,
  evidence: DuplicateEvidence[],
  primary: CandidateRow,
  incoming: IncomingAlert,
  score: number
): string {
  const fields = evidence.map(e => e.field).join(", ");
  const primaryTime = primary.received_at || primary.created_at;
  const primaryChannel = primary.source_channel || "sms";

  if (status === "PLATFORM_DUPLICATE") {
    return (
      `Platform duplicate (score ${score}) — same transaction received via ${primaryChannel} ` +
      `at ${new Date(primaryTime).toLocaleString()} and now via ${incoming.channel}. ` +
      `Evidence: ${fields}. Auto-archived; the primary transaction remains active.`
    );
  }

  return (
    `Possible duplicate (score ${score}) — similar to a ${primaryChannel} alert from ` +
    `${new Date(primaryTime).toLocaleString()}. Evidence: ${fields}. ` +
    `Flagged for review — confirm whether this is the same transaction or a legitimate second payment.`
  );
}

/**
 * Load dedup settings from school_settings. Falls back to safe defaults
 * if the migration hasn't been run yet.
 */
export function extractDedupSettings(settings: Record<string, unknown>): DedupSettings {
  return {
    windowMinutes: (settings.duplicate_window_minutes as number) || 10,
    autoArchiveThreshold: (settings.duplicate_auto_archive_threshold as number) || 150,
    possibleThreshold: (settings.duplicate_possible_threshold as number) || 80,
  };
}
