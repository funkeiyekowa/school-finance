/**
 * Student / Vendor Matching Engine
 *
 * Architecture:
 *   EXTRACT → NORMALIZE → IDENTIFY CODES → GENERATE CANDIDATES →
 *   SCORE EVIDENCE → CHECK UNIQUENESS → CHECK CONFLICTS → DECIDE
 *
 * Design principles:
 *   - Never auto-match on a single common name fragment.
 *   - Evaluate ALL candidates before deciding — never "first hit wins."
 *   - Prefix matching ranks higher than arbitrary substring.
 *   - Candidate uniqueness is mandatory for AUTO_MATCHED.
 *   - Conflicting code/name evidence produces CONFLICT.
 *   - Every match records why it matched (audit trail).
 *   - Name/culture agnostic — treats all names as string tokens.
 *   - It is safer to leave a payment unmatched than to allocate it wrong.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================
// TYPES
// ============================================================

export type MatchStatus =
  | "AUTO_MATCHED"
  | "AMBIGUOUS"
  | "NO_MATCH"
  | "CONFLICT"
  | "MANUAL_REVIEW";

export type MatchMethod =
  | "EXACT_CODE"
  | "EXACT_FULL_NAME"
  | "EXACT_FIRST_PLUS_EXACT_LAST"
  | "EXACT_FIRST_PLUS_PREFIX_LAST"
  | "EXACT_LAST_PLUS_PREFIX_FIRST"
  | "EXACT_NAME_PLUS_SUBSTRING"
  | "PREFIX_MATCH"
  | "FUZZY_CANDIDATE"
  | "NONE";

export interface MatchCandidate {
  id: string;
  name: string;
  code: string;
  firstName: string | null;
  lastName: string | null;
  score: number;
  method: MatchMethod;
  evidence: string;
}

export interface MatchResult {
  status: MatchStatus;
  matchedId: string | null;
  matchedName: string | null;
  matchedCode: string | null;
  method: MatchMethod;
  confidence: number;
  candidateCount: number;
  candidates: MatchCandidate[];
  reason: string;
  /** Structured audit data for the match_reason field. */
  audit: Record<string, unknown>;
}

export interface VendorCandidate {
  id: string;
  name: string;
  code: string;
  score: number;
  method: MatchMethod;
  evidence: string;
}

export interface VendorMatchResult {
  status: MatchStatus;
  matchedId: string | null;
  matchedName: string | null;
  method: MatchMethod;
  confidence: number;
  candidateCount: number;
  candidates: VendorCandidate[];
  reason: string;
  audit: Record<string, unknown>;
}

// ============================================================
// CONFIGURATION (tunable thresholds)
// ============================================================

/** Minimum token length to participate in matching at all. */
const MIN_TOKEN_LENGTH = 3;

/** Minimum token length for stronger partial (prefix) matching. */
const MIN_PREFIX_LENGTH = 4;

/** Score thresholds — a candidate must score at or above this to auto-match. */
const AUTO_MATCH_THRESHOLD = 80;

/** The gap between 1st and 2nd candidate must be at least this for uniqueness. */
const UNIQUENESS_GAP = 20;

// ============================================================
// NORMALIZATION
// ============================================================

/**
 * Normalize a name/narration string for comparison.
 * - lowercase, trim, collapse whitespace
 * - remove punctuation except hyphens within words
 * - normalize accented characters
 * - tokenize consistently
 */
export function normalize(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .toLowerCase()
    .replace(/[''`]/g, "")          // remove apostrophes
    .replace(/[,./\\()[\]{}:;"!?@#$%^&*+=~<>|]/g, " ") // punctuation → space
    .replace(/\s+/g, " ")
    .trim();
}

/** Split a normalized string into meaningful tokens. */
export function tokenize(normalized: string): string[] {
  return normalized.split(/\s+/).filter(t => t.length >= MIN_TOKEN_LENGTH);
}

// ============================================================
// CODE EXTRACTION
// ============================================================

/**
 * Extract a student code from narration using a strict pattern.
 * Must be a standalone token: S + 3-4 digits, NOT embedded in a longer string.
 * "S583" matches. "XS5839" does NOT.
 */
export function extractStudentCode(text: string): string | null {
  // Word boundary ensures the code is standalone, not part of a longer token.
  const match = text.match(/(?:^|[\s\-\/,;(])([Ss]\d{3,4})(?:[\s\-\/,;)]|$)/);
  return match ? match[1].toUpperCase() : null;
}

// ============================================================
// SCORING FUNCTIONS
// ============================================================

/** Check if `token` is an exact match for `target`. */
function isExact(token: string, target: string): boolean {
  return token === target;
}

/** Check if `token` is a prefix of `target` (and at least MIN_PREFIX_LENGTH). */
function isPrefix(token: string, target: string): boolean {
  return (
    token.length >= MIN_PREFIX_LENGTH &&
    token.length < target.length &&
    target.startsWith(token)
  );
}

/** Check if `token` is a strong substring of `target` (not a prefix, at least 4 chars). */
function isStrongSubstring(token: string, target: string): boolean {
  return (
    token.length >= MIN_PREFIX_LENGTH &&
    token.length < target.length &&
    !target.startsWith(token) &&
    target.includes(token)
  );
}

/**
 * Score a single narration token against a single registered name token.
 * Returns 0 if no relationship.
 */
function tokenScore(narrationToken: string, registeredToken: string): number {
  if (isExact(narrationToken, registeredToken)) return 100;
  if (isPrefix(narrationToken, registeredToken)) return 75;
  if (isPrefix(registeredToken, narrationToken)) return 70; // registered is prefix of narration
  if (isStrongSubstring(narrationToken, registeredToken)) return 40;
  return 0;
}

/**
 * Score a candidate against the narration tokens.
 *
 * Two-token narration scored against first_name + last_name:
 * - Both exact = 100
 * - One exact + one prefix = 87
 * - One exact + one strong substring = 70
 * - Only one name component matches (first OR last only) = too low to auto-match
 */
function scoreCandidate(
  narrationTokens: string[],
  candidateFirstName: string,
  candidateLastName: string,
  candidateFullName: string
): { score: number; method: MatchMethod; evidence: string } {
  const cfn = normalize(candidateFirstName);
  const cln = normalize(candidateLastName);
  const cfull = normalize(candidateFullName);
  const cfnTokens = tokenize(cfn);
  const clnTokens = tokenize(cln);
  const cfullTokens = tokenize(cfull);

  // --- Exact full name match (in either order) ---
  const narrationJoined = narrationTokens.join(" ");
  if (narrationJoined === cfull) {
    return { score: 100, method: "EXACT_FULL_NAME", evidence: `exact full name "${cfull}"` };
  }
  // Reversed order: "johnson ayoade" vs registered "ayoade johnson"
  const narrationReversed = [...narrationTokens].reverse().join(" ");
  if (narrationReversed === cfull) {
    return { score: 100, method: "EXACT_FULL_NAME", evidence: `exact full name reversed "${cfull}"` };
  }

  // --- Token-level scoring ---
  // Try all combinations of narration tokens against first/last name tokens.
  // We want to find the best assignment of narration tokens to name components.

  let bestScore = 0;
  let bestMethod: MatchMethod = "NONE";
  let bestEvidence = "";

  // For each narration token, find best match against first name tokens and last name tokens
  const firstScores: { token: string; score: number }[] = [];
  const lastScores: { token: string; score: number }[] = [];

  for (const nt of narrationTokens) {
    let bestFirst = 0;
    for (const ft of cfnTokens) {
      bestFirst = Math.max(bestFirst, tokenScore(nt, ft));
    }
    firstScores.push({ token: nt, score: bestFirst });

    let bestLast = 0;
    for (const lt of clnTokens) {
      bestLast = Math.max(bestLast, tokenScore(nt, lt));
    }
    lastScores.push({ token: nt, score: bestLast });
  }

  // Try assigning different narration tokens to first vs last
  for (let i = 0; i < narrationTokens.length; i++) {
    for (let j = 0; j < narrationTokens.length; j++) {
      if (i === j && narrationTokens.length > 1) continue;

      const fs = firstScores[i].score;
      const ls = i === j ? firstScores[i].score : lastScores[j].score;

      if (i === j) {
        // Single token — can only match one component
        // This alone should never auto-match
        continue;
      }

      if (fs === 0 || ls === 0) continue;

      // Combined score: average of both matches, penalized if either is weak
      const combined = Math.round((fs + ls) / 2);

      if (combined > bestScore) {
        bestScore = combined;
        const fToken = narrationTokens[i];
        const lToken = narrationTokens[j];

        if (fs === 100 && ls === 100) {
          bestMethod = "EXACT_FIRST_PLUS_EXACT_LAST";
          bestEvidence = `exact first "${fToken}"="${cfn}" + exact last "${lToken}"="${cln}"`;
        } else if (fs === 100 && ls >= 70) {
          bestMethod = "EXACT_FIRST_PLUS_PREFIX_LAST";
          bestEvidence = `exact first "${fToken}"="${cfn}" + prefix last "${lToken}"→"${cln}"`;
        } else if (ls === 100 && fs >= 70) {
          bestMethod = "EXACT_LAST_PLUS_PREFIX_FIRST";
          bestEvidence = `exact last "${lToken}"="${cln}" + prefix first "${fToken}"→"${cfn}"`;
        } else if ((fs === 100 || ls === 100) && Math.min(fs, ls) >= 40) {
          bestMethod = "EXACT_NAME_PLUS_SUBSTRING";
          bestEvidence = `one exact + substring: first="${fToken}" (${fs}), last="${lToken}" (${ls})`;
        } else if (fs >= 70 && ls >= 70) {
          bestMethod = "PREFIX_MATCH";
          bestEvidence = `prefix both: first="${fToken}" (${fs}), last="${lToken}" (${ls})`;
        } else {
          bestMethod = "FUZZY_CANDIDATE";
          bestEvidence = `partial: first="${fToken}" (${fs}), last="${lToken}" (${ls})`;
        }
      }
    }
  }

  // If we only have a single narration token, check against full name tokens
  if (narrationTokens.length === 1) {
    const nt = narrationTokens[0];
    // Single token can match the full name if that name IS a single token
    if (cfullTokens.length === 1 && isExact(nt, cfullTokens[0])) {
      return { score: 95, method: "EXACT_FULL_NAME", evidence: `single-token exact "${nt}"="${cfull}"` };
    }
    // Otherwise a single token by itself is never enough to auto-match
    // It can generate a candidate but never confirm identity
    let singleBest = 0;
    for (const ft of cfullTokens) {
      singleBest = Math.max(singleBest, tokenScore(nt, ft));
    }
    if (singleBest > 0 && singleBest > bestScore) {
      // Cap single-token match at 35 — too weak to auto-match
      bestScore = Math.min(singleBest, 35);
      bestMethod = "FUZZY_CANDIDATE";
      bestEvidence = `single token "${nt}" partially matches a name component (score capped at 35)`;
    }
  }

  return { score: bestScore, method: bestMethod, evidence: bestEvidence };
}

// ============================================================
// MAIN STUDENT MATCHING
// ============================================================

export async function matchStudent(
  supabase: SupabaseClient,
  parsedCode: string | null,
  parsedName: string | null
): Promise<MatchResult> {
  const noMatch: MatchResult = {
    status: "NO_MATCH",
    matchedId: null,
    matchedName: null,
    matchedCode: null,
    method: "NONE",
    confidence: 0,
    candidateCount: 0,
    candidates: [],
    reason: "No student code or name found in the alert.",
    audit: { parsedCode, parsedName },
  };

  if (!parsedCode && !parsedName) return noMatch;

  // Load all active students — for a school this is typically < 500 rows.
  // Doing it in one query avoids N+1 and lets us evaluate ALL candidates.
  const { data: allStudents } = await supabase
    .from("students")
    .select("id, student_code, full_name, first_name, last_name, status")
    .eq("status", "active");

  if (!allStudents || allStudents.length === 0) {
    return { ...noMatch, reason: "No active students in the database." };
  }

  const candidates: MatchCandidate[] = [];
  let codeMatchCandidate: MatchCandidate | null = null;

  // ---------- STEP 1: Code matching ----------
  if (parsedCode) {
    const normalizedCode = parsedCode.toUpperCase().trim();

    const codeMatches = allStudents.filter(
      s => s.student_code?.toUpperCase().trim() === normalizedCode
    );

    if (codeMatches.length === 1) {
      codeMatchCandidate = {
        id: codeMatches[0].id,
        name: codeMatches[0].full_name,
        code: codeMatches[0].student_code,
        firstName: codeMatches[0].first_name,
        lastName: codeMatches[0].last_name,
        score: 100,
        method: "EXACT_CODE",
        evidence: `exact code match "${normalizedCode}"`,
      };
      candidates.push(codeMatchCandidate);
    } else if (codeMatches.length > 1) {
      // Multiple students with the same code — CONFLICT
      for (const s of codeMatches) {
        candidates.push({
          id: s.id,
          name: s.full_name,
          code: s.student_code,
          firstName: s.first_name,
          lastName: s.last_name,
          score: 100,
          method: "EXACT_CODE",
          evidence: `code "${normalizedCode}" matches multiple records`,
        });
      }
      return {
        status: "CONFLICT",
        matchedId: null,
        matchedName: null,
        matchedCode: normalizedCode,
        method: "EXACT_CODE",
        confidence: 0,
        candidateCount: codeMatches.length,
        candidates,
        reason: `Student code "${normalizedCode}" matches ${codeMatches.length} active students. Cannot determine which one. Manual review required.`,
        audit: { parsedCode, parsedName, conflictType: "DUPLICATE_CODE", candidateCount: codeMatches.length },
      };
    }
    // If no code match, continue to name matching
  }

  // ---------- STEP 2: Name matching ----------
  if (parsedName) {
    const normalizedName = normalize(parsedName);
    const narrationTokens = tokenize(normalizedName);

    if (narrationTokens.length > 0) {
      for (const student of allStudents) {
        // Skip if already added as code match
        if (codeMatchCandidate && student.id === codeMatchCandidate.id) continue;

        const { score, method, evidence } = scoreCandidate(
          narrationTokens,
          student.first_name || "",
          student.last_name || "",
          student.full_name || ""
        );

        if (score > 0) {
          candidates.push({
            id: student.id,
            name: student.full_name,
            code: student.student_code,
            firstName: student.first_name,
            lastName: student.last_name,
            score,
            method,
            evidence,
          });
        }
      }
    }
  }

  if (candidates.length === 0) {
    return {
      ...noMatch,
      reason: parsedCode
        ? `Student code "${parsedCode}" not found among active students.`
        : `Name "${parsedName}" did not match any active student.`,
      audit: { parsedCode, parsedName, candidatesEvaluated: allStudents.length },
    };
  }

  // ---------- STEP 3: Rank candidates ----------
  candidates.sort((a, b) => b.score - a.score);
  const top = candidates[0];
  const runnerUp = candidates.length > 1 ? candidates[1] : null;

  // ---------- STEP 4: Code/name reconciliation ----------
  if (codeMatchCandidate && parsedName) {
    // Code matched one student. Does the name evidence support it or conflict?
    const codeStudentNameScore = candidates.find(c => c.id === codeMatchCandidate!.id && c.method !== "EXACT_CODE");
    const nameTopCandidate = candidates.find(c => c.id !== codeMatchCandidate!.id && c.score >= AUTO_MATCH_THRESHOLD);

    if (nameTopCandidate && (!codeStudentNameScore || codeStudentNameScore.score < 50)) {
      // The name strongly points to a DIFFERENT student than the code.
      // Per amendment: if the name evidence is strong AND unique, follow
      // the name and record CODE_NAME_DISCREPANCY as a warning, not a blocker.
      const nameRunnerUp = candidates.find(
        c => c.id !== nameTopCandidate.id && c.id !== codeMatchCandidate!.id && c.score >= AUTO_MATCH_THRESHOLD
      );
      const nameIsUnique = !nameRunnerUp || (nameTopCandidate.score - nameRunnerUp.score) >= UNIQUENESS_GAP;

      if (nameIsUnique && nameTopCandidate.score >= AUTO_MATCH_THRESHOLD) {
        // Strong unique name independently identifies the student.
        // Auto-match to the name-matched student with a discrepancy warning.
        return {
          status: "AUTO_MATCHED",
          matchedId: nameTopCandidate.id,
          matchedName: nameTopCandidate.name,
          matchedCode: nameTopCandidate.code,
          method: nameTopCandidate.method,
          confidence: nameTopCandidate.score,
          candidateCount: candidates.length,
          candidates: candidates.slice(0, 10),
          reason: `Name match: "${parsedName}" → "${nameTopCandidate.name}" (${nameTopCandidate.evidence}). Score ${nameTopCandidate.score}, unique. ⚠ CODE_DISCREPANCY: supplied code "${parsedCode}" belongs to "${codeMatchCandidate.name}" — name evidence independently identified a different student.`,
          audit: {
            parsedCode, parsedName,
            matchMethod: nameTopCandidate.method,
            warning: "CODE_NAME_DISCREPANCY",
            suppliedCode: parsedCode,
            codeOwner: codeMatchCandidate.name,
            matchedByName: nameTopCandidate.name,
            nameScore: nameTopCandidate.score,
            candidateCount: candidates.length,
            confidence: nameTopCandidate.score,
          },
        };
      }

      // Name evidence is not strong enough or not unique → CONFLICT
      return {
        status: "CONFLICT",
        matchedId: null,
        matchedName: null,
        matchedCode: codeMatchCandidate.code,
        method: "EXACT_CODE",
        confidence: 0,
        candidateCount: candidates.length,
        candidates: candidates.slice(0, 10),
        reason: `Code "${codeMatchCandidate.code}" belongs to "${codeMatchCandidate.name}" but the name "${parsedName}" points to "${nameTopCandidate.name}" (score ${nameTopCandidate.score}). ${!nameIsUnique ? "Name evidence is ambiguous." : "Name evidence is not strong enough to override."} Manual review required.`,
        audit: {
          parsedCode, parsedName,
          conflictType: "CODE_MATCH_CONFLICTS_WITH_NAME",
          codeMatchStudent: codeMatchCandidate.name,
          nameMatchStudent: nameTopCandidate.name,
          nameMatchScore: nameTopCandidate.score,
          nameIsUnique,
        },
      };
    }

    // If name was parsed but provides ZERO support for the code-matched student,
    // and the name generates candidates pointing elsewhere (even weakly), the
    // code and name are contradictory → review. A valid code alone is not enough
    // when the accompanying name clearly doesn't belong to that student.
    if (!codeStudentNameScore || codeStudentNameScore.score === 0) {
      const anyNameCandidate = candidates.find(c => c.id !== codeMatchCandidate!.id && c.score > 0 && c.method !== "EXACT_CODE");
      if (anyNameCandidate) {
        return {
          status: "MANUAL_REVIEW",
          matchedId: null,
          matchedName: null,
          matchedCode: codeMatchCandidate.code,
          method: "EXACT_CODE",
          confidence: 0,
          candidateCount: candidates.length,
          candidates: candidates.slice(0, 10),
          reason: `Code "${codeMatchCandidate.code}" matches "${codeMatchCandidate.name}", but the supplied name "${parsedName}" does not support this match and points elsewhere. Manual review required.`,
          audit: {
            parsedCode, parsedName,
            conflictType: "CODE_NAME_MISMATCH_WEAK",
            codeMatchStudent: codeMatchCandidate.name,
            namePointsTo: anyNameCandidate.name,
            nameScore: anyNameCandidate.score,
          },
        };
      }
    }

    // Code matched and name either supports it or has no candidates elsewhere
    return {
      status: "AUTO_MATCHED",
      matchedId: codeMatchCandidate.id,
      matchedName: codeMatchCandidate.name,
      matchedCode: codeMatchCandidate.code,
      method: "EXACT_CODE",
      confidence: 100,
      candidateCount: candidates.length,
      candidates: candidates.slice(0, 10),
      reason: `Exact code match "${codeMatchCandidate.code}" → "${codeMatchCandidate.name}".${parsedName ? ` Name "${parsedName}" does not conflict.` : ""}`,
      audit: {
        parsedCode, parsedName,
        matchMethod: "EXACT_CODE",
        extractedCode: codeMatchCandidate.code,
        candidateCount: candidates.length,
        confidence: 100,
      },
    };
  }

  // Code match without a parsed name — direct auto-match
  if (codeMatchCandidate && !parsedName) {
    return {
      status: "AUTO_MATCHED",
      matchedId: codeMatchCandidate.id,
      matchedName: codeMatchCandidate.name,
      matchedCode: codeMatchCandidate.code,
      method: "EXACT_CODE",
      confidence: 100,
      candidateCount: 1,
      candidates: [codeMatchCandidate],
      reason: `Exact code match "${codeMatchCandidate.code}" → "${codeMatchCandidate.name}".`,
      audit: {
        parsedCode,
        matchMethod: "EXACT_CODE",
        extractedCode: codeMatchCandidate.code,
        candidateCount: 1,
        confidence: 100,
      },
    };
  }

  // ---------- STEP 5: Name-only decision ----------
  if (top.score >= AUTO_MATCH_THRESHOLD) {
    // Check uniqueness — is the top candidate sufficiently stronger than the runner-up?
    if (runnerUp && (top.score - runnerUp.score) < UNIQUENESS_GAP) {
      return {
        status: "AMBIGUOUS",
        matchedId: null,
        matchedName: null,
        matchedCode: null,
        method: top.method,
        confidence: top.score,
        candidateCount: candidates.length,
        candidates: candidates.slice(0, 10),
        reason: `Multiple students match "${parsedName}" with similar scores: "${top.name}" (${top.score}) vs "${runnerUp.name}" (${runnerUp.score}). Cannot determine which one. Manual review required.`,
        audit: {
          parsedName,
          topCandidate: top.name,
          topScore: top.score,
          runnerUpCandidate: runnerUp.name,
          runnerUpScore: runnerUp.score,
          gap: top.score - runnerUp.score,
          requiredGap: UNIQUENESS_GAP,
          candidateCount: candidates.length,
        },
      };
    }

    // Unique top candidate with sufficient score
    return {
      status: "AUTO_MATCHED",
      matchedId: top.id,
      matchedName: top.name,
      matchedCode: top.code,
      method: top.method,
      confidence: top.score,
      candidateCount: candidates.length,
      candidates: candidates.slice(0, 10),
      reason: `Name match: "${parsedName}" → "${top.name}" (${top.evidence}). Score ${top.score}, unique.${parsedCode && !codeMatchCandidate ? ` ⚠ CODE_DISCREPANCY: supplied code "${parsedCode}" not found — matched by name only.` : ""}`,
      audit: {
        parsedCode, parsedName,
        matchMethod: top.method,
        matchedFirstName: normalize(top.firstName),
        matchedLastName: normalize(top.lastName),
        confidence: top.score,
        candidateCount: candidates.length,
        runnerUpScore: runnerUp?.score ?? 0,
        ...(parsedCode && !codeMatchCandidate ? { warning: "CODE_DISCREPANCY", suppliedCode: parsedCode } : {}),
      },
    };
  }

  // Score too low for auto-match but candidates exist → manual review
  if (top.score > 0) {
    return {
      status: "MANUAL_REVIEW",
      matchedId: null,
      matchedName: null,
      matchedCode: null,
      method: top.method,
      confidence: top.score,
      candidateCount: candidates.length,
      candidates: candidates.slice(0, 10),
      reason: `Best candidate "${top.name}" scored ${top.score} (threshold ${AUTO_MATCH_THRESHOLD}). Insufficient confidence for automatic match. ${candidates.length > 1 ? `${candidates.length} candidates found.` : ""} Manual review required.`,
      audit: {
        parsedName,
        topCandidate: top.name,
        topScore: top.score,
        threshold: AUTO_MATCH_THRESHOLD,
        candidateCount: candidates.length,
      },
    };
  }

  return noMatch;
}

// ============================================================
// VENDOR MATCHING
// ============================================================

export async function matchVendor(
  supabase: SupabaseClient,
  parsedPayeeName: string | null
): Promise<VendorMatchResult> {
  const noMatch: VendorMatchResult = {
    status: "NO_MATCH",
    matchedId: null,
    matchedName: null,
    method: "NONE",
    confidence: 0,
    candidateCount: 0,
    candidates: [],
    reason: "No payee name found in the alert.",
    audit: { parsedPayeeName },
  };

  if (!parsedPayeeName) return noMatch;

  const { data: allVendors } = await supabase
    .from("vendors")
    .select("id, vendor_code, name");

  if (!allVendors || allVendors.length === 0) {
    return { ...noMatch, reason: "No vendors in the database." };
  }

  const normalizedPayee = normalize(parsedPayeeName);
  const payeeTokens = tokenize(normalizedPayee);

  if (payeeTokens.length === 0) return noMatch;

  const candidates: VendorCandidate[] = [];

  for (const vendor of allVendors) {
    const normalizedVendor = normalize(vendor.name);
    const vendorTokens = tokenize(normalizedVendor);

    // Exact full name
    if (normalizedPayee === normalizedVendor) {
      candidates.push({
        id: vendor.id,
        name: vendor.name,
        code: vendor.vendor_code,
        score: 100,
        method: "EXACT_FULL_NAME",
        evidence: `exact name "${normalizedVendor}"`,
      });
      continue;
    }

    // Token-level matching: how many payee tokens match vendor tokens?
    let matchedTokens = 0;
    let totalScore = 0;
    const evidenceParts: string[] = [];

    for (const pt of payeeTokens) {
      let bestForToken = 0;
      let bestVt = "";
      for (const vt of vendorTokens) {
        const s = tokenScore(pt, vt);
        if (s > bestForToken) {
          bestForToken = s;
          bestVt = vt;
        }
      }
      if (bestForToken > 0) {
        matchedTokens++;
        totalScore += bestForToken;
        evidenceParts.push(`"${pt}"→"${bestVt}" (${bestForToken})`);
      }
    }

    if (matchedTokens === 0) continue;

    // Require at least 2 matching tokens, or 1 if there's only 1 token in both
    const minRequired = Math.min(payeeTokens.length, vendorTokens.length) === 1 ? 1 : 2;
    if (matchedTokens < minRequired && payeeTokens.length > 1) continue;

    const avgScore = Math.round(totalScore / Math.max(payeeTokens.length, 1));
    // Boost if most tokens matched
    const coverage = matchedTokens / Math.max(payeeTokens.length, 1);
    const finalScore = Math.round(avgScore * (0.5 + 0.5 * coverage));

    let method: MatchMethod = "FUZZY_CANDIDATE";
    if (finalScore >= 90) method = "EXACT_FULL_NAME";
    else if (finalScore >= 70) method = "PREFIX_MATCH";
    else if (finalScore >= 50) method = "EXACT_NAME_PLUS_SUBSTRING";

    candidates.push({
      id: vendor.id,
      name: vendor.name,
      code: vendor.vendor_code,
      score: finalScore,
      method,
      evidence: evidenceParts.join(", "),
    });
  }

  if (candidates.length === 0) {
    return {
      ...noMatch,
      reason: `Payee "${parsedPayeeName}" did not match any registered vendor.`,
      audit: { parsedPayeeName, vendorsChecked: allVendors.length },
    };
  }

  candidates.sort((a, b) => b.score - a.score);
  const top = candidates[0];
  const runnerUp = candidates.length > 1 ? candidates[1] : null;

  if (top.score >= AUTO_MATCH_THRESHOLD) {
    if (runnerUp && (top.score - runnerUp.score) < UNIQUENESS_GAP) {
      return {
        status: "AMBIGUOUS",
        matchedId: null,
        matchedName: null,
        method: top.method,
        confidence: top.score,
        candidateCount: candidates.length,
        candidates: candidates.slice(0, 10),
        reason: `Multiple vendors match "${parsedPayeeName}": "${top.name}" (${top.score}) vs "${runnerUp.name}" (${runnerUp.score}). Manual review required.`,
        audit: { parsedPayeeName, topVendor: top.name, topScore: top.score, runnerUp: runnerUp.name, runnerUpScore: runnerUp.score },
      };
    }

    return {
      status: "AUTO_MATCHED",
      matchedId: top.id,
      matchedName: top.name,
      method: top.method,
      confidence: top.score,
      candidateCount: candidates.length,
      candidates: candidates.slice(0, 10),
      reason: `Vendor match: "${parsedPayeeName}" → "${top.name}" (${top.evidence}). Score ${top.score}, unique.`,
      audit: { parsedPayeeName, matchMethod: top.method, confidence: top.score, candidateCount: candidates.length },
    };
  }

  // Candidates exist but below threshold
  return {
    status: "MANUAL_REVIEW",
    matchedId: null,
    matchedName: null,
    method: top.method,
    confidence: top.score,
    candidateCount: candidates.length,
    candidates: candidates.slice(0, 10),
    reason: `Best vendor candidate "${top.name}" scored ${top.score} (threshold ${AUTO_MATCH_THRESHOLD}). Manual review required.`,
    audit: { parsedPayeeName, topVendor: top.name, topScore: top.score, threshold: AUTO_MATCH_THRESHOLD },
  };
}

// ============================================================
// CONFIDENCE CALCULATION (updated)
// ============================================================

/**
 * Calculate overall confidence for a parsed alert.
 * This is the "parsing confidence" — how much structured data we extracted.
 * It combines with the matching score to determine whether to auto-post.
 */
export function calculateMatchConfidence(
  amount: number | null,
  studentCode: string | null,
  studentName: string | null,
  matchResult: MatchResult | VendorMatchResult
): number {
  let parseScore = 0;
  if (amount) parseScore += 40;
  if (studentCode) parseScore += 30;
  if (studentName) parseScore += 20;
  // The match engine's own score (0-100) contributes the rest
  const matchScore = matchResult.confidence;
  // Weighted: 40% parsing quality, 60% match quality
  return Math.round(parseScore * 0.4 + matchScore * 0.6);
}
