/**
 * Auto-Credit Policy Engine
 *
 * Replaces the old single-slider confidence threshold with a rule-based,
 * explainable decision system. An administrator can understand and configure
 * what evidence the system requires before automatically crediting a payment.
 *
 * Architecture:
 *   HARD SAFETY GATES → EVIDENCE EVALUATION → RULE MATCHING → DECISION
 *
 * Key principles:
 *   - Hard gates ALWAYS block, regardless of confidence score.
 *   - Evidence rules define what identity proof is sufficient.
 *   - The numerical confidence score supports the explanation, never overrides safety.
 *   - Every decision returns a full explanation object.
 *   - Policy is centralized, configurable, and extensible.
 */

import type { MatchResult, MatchMethod } from "./matcher";
import type { DuplicateResult } from "./dedup";

// ============================================================
// POLICY MODEL
// ============================================================

export interface AutoCreditPolicy {
  /** Preset name for UI display. */
  preset: "conservative" | "balanced" | "flexible" | "custom";

  /** Minimum numerical confidence to proceed (after gates pass). */
  minimumConfidence: number;

  // --- Identity evidence rules (which match methods can auto-credit) ---
  allowExactCode: boolean;
  allowThreeExactNames: boolean;
  allowTwoExactNames: boolean;
  allowExactPlusPrefix: boolean;
  allowSingleName: boolean;
  allowFuzzyOnly: boolean;

  // --- Safety requirements (hard gates, always recommended ON) ---
  requireAmount: boolean;
  requireCreditDirection: boolean;
  requireUniqueCandidate: boolean;
  blockDuplicates: boolean;
  blockAmbiguous: boolean;
  blockConflicts: boolean;
}

// ============================================================
// PRESETS
// ============================================================

export const POLICY_PRESETS: Record<string, AutoCreditPolicy> = {
  conservative: {
    preset: "conservative",
    minimumConfidence: 85,
    allowExactCode: true,
    allowThreeExactNames: true,
    allowTwoExactNames: true,
    allowExactPlusPrefix: false,
    allowSingleName: false,
    allowFuzzyOnly: false,
    requireAmount: true,
    requireCreditDirection: true,
    requireUniqueCandidate: true,
    blockDuplicates: true,
    blockAmbiguous: true,
    blockConflicts: true,
  },
  balanced: {
    preset: "balanced",
    minimumConfidence: 75,
    allowExactCode: true,
    allowThreeExactNames: true,
    allowTwoExactNames: true,
    allowExactPlusPrefix: true,
    allowSingleName: false,
    allowFuzzyOnly: false,
    requireAmount: true,
    requireCreditDirection: true,
    requireUniqueCandidate: true,
    blockDuplicates: true,
    blockAmbiguous: true,
    blockConflicts: true,
  },
  flexible: {
    preset: "flexible",
    minimumConfidence: 60,
    allowExactCode: true,
    allowThreeExactNames: true,
    allowTwoExactNames: true,
    allowExactPlusPrefix: true,
    allowSingleName: true,
    allowFuzzyOnly: false,
    requireAmount: true,
    requireCreditDirection: true,
    requireUniqueCandidate: true,
    blockDuplicates: true,
    blockAmbiguous: true,
    blockConflicts: true,
  },
};

export const DEFAULT_POLICY: AutoCreditPolicy = POLICY_PRESETS.balanced;

// ============================================================
// EVIDENCE DESCRIPTORS (for UI)
// ============================================================

export interface EvidenceRule {
  key: keyof Pick<AutoCreditPolicy,
    "allowExactCode" | "allowThreeExactNames" | "allowTwoExactNames" |
    "allowExactPlusPrefix" | "allowSingleName" | "allowFuzzyOnly">;
  label: string;
  description: string;
  strength: "Very Strong" | "Strong" | "Medium" | "Low" | "Very Low";
  recommended: "recommended" | "caution" | "not_recommended";
  warning?: string;
  example?: string;
  counterexample?: string;
}

export const EVIDENCE_RULES: EvidenceRule[] = [
  {
    key: "allowExactCode",
    label: "Exact unique student/vendor code",
    description: "The alert contains a student code (e.g. S583) that uniquely identifies exactly one active student.",
    strength: "Very Strong",
    recommended: "recommended",
    example: "Alert says S583 → only one student has code S583 → match.",
    counterexample: "Alert says S583 but two active students have that code → review.",
  },
  {
    key: "allowThreeExactNames",
    label: "3 exact name components",
    description: "Three meaningful words in the alert exactly match the student's first name, last name, and middle name.",
    strength: "Very Strong",
    recommended: "recommended",
    example: "Alert: Olaleye Daniel Ayomide → registered: Olaleye Daniel Ayomide → match.",
  },
  {
    key: "allowTwoExactNames",
    label: "2 exact name components + unique candidate",
    description: "Two meaningful name parts (e.g. first + last) exactly match, and only one active student has that combination.",
    strength: "Strong",
    recommended: "recommended",
    example: "Alert: Ayoade Johnson → only one Ayoade Johnson enrolled → match.",
    counterexample: "Alert: Ayoade Johnson → two active students named Ayoade Johnson → review.",
  },
  {
    key: "allowExactPlusPrefix",
    label: "Exact + prefix name match",
    description: "One name part is exact and another is a prefix of the registered name (e.g. 'John' matches 'Johnson'), with a unique candidate.",
    strength: "Strong",
    recommended: "recommended",
    example: "Alert: Ayoade John → registered: Ayoade Johnson → match (John is a prefix of Johnson).",
    counterexample: "Alert: Ayoade Son → 'Son' is inside 'Johnson' but is not a prefix → review.",
  },
  {
    key: "allowSingleName",
    label: "Single exact name only",
    description: "Only one name component matches. This is risky because many students may share a first name or surname.",
    strength: "Low",
    recommended: "caution",
    warning: "A single name may match multiple students. Enabling this rule increases the risk of incorrect payment allocation.",
    example: "Alert: Ayoade → only one student has this name anywhere → match.",
    counterexample: "Alert: Ayoade → three students have Ayoade as first name → review.",
  },
  {
    key: "allowFuzzyOnly",
    label: "Fuzzy/substring match only",
    description: "The match is based only on fuzzy similarity or arbitrary substrings, without exact name components.",
    strength: "Very Low",
    recommended: "not_recommended",
    warning: "Fuzzy-only matching can result in incorrect allocation. Not recommended for automatic credit.",
  },
];

export interface SafetyGate {
  key: keyof Pick<AutoCreditPolicy,
    "requireAmount" | "requireCreditDirection" | "requireUniqueCandidate" |
    "blockDuplicates" | "blockAmbiguous" | "blockConflicts">;
  label: string;
  description: string;
  alwaysRecommended: boolean;
}

export const SAFETY_GATES: SafetyGate[] = [
  { key: "requireAmount", label: "Amount must be present", description: "The alert must contain a parseable payment amount.", alwaysRecommended: true },
  { key: "requireCreditDirection", label: "Credit direction must be confirmed", description: "The system must be able to confirm this is a credit (not a debit or unknown).", alwaysRecommended: true },
  { key: "requireUniqueCandidate", label: "Candidate must be unique", description: "Only one student/vendor should match the evidence. Ambiguous multi-candidate matches are blocked.", alwaysRecommended: true },
  { key: "blockDuplicates", label: "Confirmed duplicates cannot auto-credit", description: "Transactions flagged as platform duplicates are always blocked from auto-credit.", alwaysRecommended: true },
  { key: "blockAmbiguous", label: "Ambiguous matches cannot auto-credit", description: "When multiple students score similarly, the system cannot determine which one to credit.", alwaysRecommended: true },
  { key: "blockConflicts", label: "Conflicting evidence blocks auto-credit", description: "When the code points to one student but the name points to another, auto-credit is blocked.", alwaysRecommended: true },
];

// ============================================================
// DECISION ENGINE
// ============================================================

export type PolicyDecision = "AUTO_CREDIT" | "REVIEW_REQUIRED";

export interface PolicyBlocker {
  gate: string;
  reason: string;
}

export interface PolicyEvidenceItem {
  field: string;
  present: boolean;
  detail: string;
  strength?: string;
}

export interface PolicyWarning {
  code: string;
  message: string;
}

export interface PolicyDecisionResult {
  decision: PolicyDecision;
  confidence: number;
  eligible: boolean;
  rule: string | null;
  blockers: PolicyBlocker[];
  evidence: PolicyEvidenceItem[];
  warnings: PolicyWarning[];
  explanation: string;
}

/**
 * Map match methods from the matcher to which policy rule they satisfy.
 */
function matchMethodToRule(method: MatchMethod): keyof AutoCreditPolicy | null {
  switch (method) {
    case "EXACT_CODE": return "allowExactCode";
    case "EXACT_FULL_NAME": return "allowThreeExactNames"; // full name = 2+ components
    case "EXACT_FIRST_PLUS_EXACT_LAST": return "allowTwoExactNames";
    case "EXACT_FIRST_PLUS_PREFIX_LAST": return "allowExactPlusPrefix";
    case "EXACT_LAST_PLUS_PREFIX_FIRST": return "allowExactPlusPrefix";
    case "EXACT_NAME_PLUS_SUBSTRING": return "allowExactPlusPrefix";
    case "PREFIX_MATCH": return "allowExactPlusPrefix";
    case "FUZZY_CANDIDATE": return "allowFuzzyOnly";
    case "NONE": return null;
    default: return null;
  }
}

/** Human-readable name for a match method. */
function methodLabel(method: MatchMethod): string {
  switch (method) {
    case "EXACT_CODE": return "Exact unique student code";
    case "EXACT_FULL_NAME": return "Exact full name match";
    case "EXACT_FIRST_PLUS_EXACT_LAST": return "2 exact name components";
    case "EXACT_FIRST_PLUS_PREFIX_LAST": return "Exact first + prefix last name";
    case "EXACT_LAST_PLUS_PREFIX_FIRST": return "Exact last + prefix first name";
    case "EXACT_NAME_PLUS_SUBSTRING": return "Exact + substring name";
    case "PREFIX_MATCH": return "Prefix name match";
    case "FUZZY_CANDIDATE": return "Fuzzy/partial match only";
    case "NONE": return "No match";
    default: return method;
  }
}

/**
 * Evaluate whether a matched alert qualifies for auto-credit under the
 * given policy. Returns a full explanation regardless of outcome.
 */
export function evaluatePolicy(
  policy: AutoCreditPolicy,
  matchResult: MatchResult,
  dupResult: DuplicateResult | null,
  parsedAmount: number | null,
  directionConfirmed: boolean,
  parsedCode: string | null,
  parsedName: string | null
): PolicyDecisionResult {
  const blockers: PolicyBlocker[] = [];
  const evidence: PolicyEvidenceItem[] = [];
  const warnings: PolicyWarning[] = [];

  // ---- Gather evidence (informational) ----
  evidence.push({
    field: "Amount",
    present: parsedAmount != null && parsedAmount > 0,
    detail: parsedAmount ? `₦${parsedAmount.toLocaleString()}` : "Not found",
  });
  evidence.push({
    field: "Credit direction",
    present: directionConfirmed,
    detail: directionConfirmed ? "Confirmed" : "Unknown or debit",
  });
  evidence.push({
    field: "Student code",
    present: !!parsedCode,
    detail: parsedCode || "Not supplied",
    strength: parsedCode ? "Strong identifier" : undefined,
  });
  evidence.push({
    field: "Student name",
    present: !!parsedName,
    detail: parsedName || "Not found",
  });
  evidence.push({
    field: "Match result",
    present: matchResult.status === "AUTO_MATCHED",
    detail: `${matchResult.status} — ${matchResult.method}`,
    strength: matchResult.status === "AUTO_MATCHED" ? methodLabel(matchResult.method) : undefined,
  });
  evidence.push({
    field: "Candidate uniqueness",
    present: matchResult.candidateCount === 1 || (matchResult.status === "AUTO_MATCHED" && matchResult.candidateCount <= 3),
    detail: `${matchResult.candidateCount} candidate(s)`,
  });

  if (dupResult && dupResult.status !== "NOT_DUPLICATE") {
    evidence.push({
      field: "Duplicate status",
      present: false,
      detail: dupResult.status,
    });
  }

  // ---- Hard safety gates ----
  if (policy.requireAmount && (!parsedAmount || parsedAmount <= 0)) {
    blockers.push({ gate: "requireAmount", reason: "No valid amount was parsed from the alert." });
  }
  if (policy.requireCreditDirection && !directionConfirmed) {
    blockers.push({ gate: "requireCreditDirection", reason: "Transaction direction is not confirmed as credit." });
  }
  if (policy.requireUniqueCandidate && matchResult.status !== "AUTO_MATCHED") {
    if (matchResult.status === "AMBIGUOUS") {
      blockers.push({ gate: "requireUniqueCandidate", reason: `Multiple students match with similar scores (${matchResult.candidateCount} candidates). Cannot determine which one.` });
    } else if (matchResult.status === "NO_MATCH") {
      blockers.push({ gate: "requireUniqueCandidate", reason: "No matching student found." });
    } else if (matchResult.status === "MANUAL_REVIEW") {
      blockers.push({ gate: "requireUniqueCandidate", reason: `Match confidence too low for automatic identification (best score: ${matchResult.confidence}).` });
    }
  }
  if (policy.blockDuplicates && dupResult && dupResult.status === "POSSIBLE_DUPLICATE") {
    blockers.push({ gate: "blockDuplicates", reason: "Transaction flagged as a possible duplicate. Confirm it is a separate payment before crediting." });
  }
  if (policy.blockAmbiguous && matchResult.status === "AMBIGUOUS") {
    blockers.push({ gate: "blockAmbiguous", reason: `Ambiguous identity — ${matchResult.reason}` });
  }
  if (policy.blockConflicts && matchResult.status === "CONFLICT") {
    blockers.push({ gate: "blockConflicts", reason: `Conflicting evidence — ${matchResult.reason}` });
  }

  // If any hard gate fails, decision is REVIEW_REQUIRED regardless of score.
  if (blockers.length > 0) {
    const confidence = computeConfidence(matchResult, parsedAmount, parsedCode, parsedName);
    return {
      decision: "REVIEW_REQUIRED",
      confidence,
      eligible: false,
      rule: null,
      blockers,
      evidence,
      warnings,
      explanation: `Review required — ${blockers[0].reason}${blockers.length > 1 ? ` (+${blockers.length - 1} more)` : ""}`,
    };
  }

  // ---- Evidence rule matching ----
  // Check if the match method satisfies an enabled policy rule.
  const ruleKey = matchMethodToRule(matchResult.method);
  const ruleEnabled = ruleKey ? (policy[ruleKey] as boolean) : false;

  // Special case: EXACT_FULL_NAME can satisfy either allowThreeExactNames or allowTwoExactNames
  let satisfiedRule: string | null = null;
  if (ruleEnabled && ruleKey) {
    satisfiedRule = ruleKey;
  } else if (matchResult.method === "EXACT_FULL_NAME" && policy.allowTwoExactNames) {
    satisfiedRule = "allowTwoExactNames";
  }

  if (!satisfiedRule) {
    const confidence = computeConfidence(matchResult, parsedAmount, parsedCode, parsedName);
    const methodName = methodLabel(matchResult.method);
    return {
      decision: "REVIEW_REQUIRED",
      confidence,
      eligible: false,
      rule: null,
      blockers: [],
      evidence,
      warnings,
      explanation: `Review required — the match type "${methodName}" is not enabled in the current auto-credit policy.`,
    };
  }

  // ---- Minimum confidence check ----
  const confidence = computeConfidence(matchResult, parsedAmount, parsedCode, parsedName);
  if (confidence < policy.minimumConfidence) {
    return {
      decision: "REVIEW_REQUIRED",
      confidence,
      eligible: false,
      rule: satisfiedRule,
      blockers: [],
      evidence,
      warnings,
      explanation: `Review required — confidence ${confidence}% is below the minimum threshold of ${policy.minimumConfidence}%.`,
    };
  }

  // ---- Code discrepancy warning ----
  if (parsedCode && matchResult.matchedCode && parsedCode.toUpperCase() !== matchResult.matchedCode.toUpperCase()) {
    if (matchResult.method !== "EXACT_CODE") {
      warnings.push({
        code: "CODE_DISCREPANCY",
        message: `Supplied code "${parsedCode}" differs from registered code "${matchResult.matchedCode}". Name evidence independently identified the student.`,
      });
    }
  }

  // ---- All checks pass → AUTO_CREDIT ----
  const ruleDef = EVIDENCE_RULES.find(r => r.key === satisfiedRule);
  return {
    decision: "AUTO_CREDIT",
    confidence,
    eligible: true,
    rule: satisfiedRule,
    blockers: [],
    evidence,
    warnings,
    explanation: `Auto-credited — ${ruleDef?.label || satisfiedRule}. Confidence ${confidence}%. Student: "${matchResult.matchedName}" (${matchResult.matchedCode}).`,
  };
}

// ============================================================
// CONFIDENCE CALCULATION (updated, evidence-weighted)
// ============================================================

/**
 * Compute a numerical confidence score.
 *
 * The new model prioritizes validated identity evidence (the match engine's
 * score) over merely having parsed fields. Parsing evidence contributes a
 * smaller portion — it confirms data quality but doesn't prove identity.
 *
 * Weighting: 25% parsing quality, 75% match engine score.
 */
function computeConfidence(
  matchResult: MatchResult,
  amount: number | null,
  code: string | null,
  name: string | null
): number {
  // Parsing quality (0-100 internally, contributes 25%)
  let parseScore = 0;
  if (amount && amount > 0) parseScore += 40;
  if (code) parseScore += 35;
  if (name) parseScore += 25;

  // Match engine score (0-100, contributes 75%)
  const matchScore = matchResult.confidence;

  const raw = Math.round(parseScore * 0.25 + matchScore * 0.75);
  return Math.min(raw, 100);
}

// ============================================================
// POLICY LOADING / SERIALIZATION
// ============================================================

/**
 * Load the auto-credit policy from school_settings.
 * Falls back to the balanced preset if nothing is configured.
 */
export function loadPolicy(settings: Record<string, unknown>): AutoCreditPolicy {
  const stored = settings.auto_credit_policy as Record<string, unknown> | null;
  if (!stored) return DEFAULT_POLICY;

  return {
    preset: (stored.preset as AutoCreditPolicy["preset"]) || "custom",
    minimumConfidence: (stored.minimumConfidence as number) ?? DEFAULT_POLICY.minimumConfidence,
    allowExactCode: stored.allowExactCode !== false,
    allowThreeExactNames: stored.allowThreeExactNames !== false,
    allowTwoExactNames: stored.allowTwoExactNames !== false,
    allowExactPlusPrefix: stored.allowExactPlusPrefix !== false,
    allowSingleName: stored.allowSingleName === true,
    allowFuzzyOnly: stored.allowFuzzyOnly === true,
    requireAmount: stored.requireAmount !== false,
    requireCreditDirection: stored.requireCreditDirection !== false,
    requireUniqueCandidate: stored.requireUniqueCandidate !== false,
    blockDuplicates: stored.blockDuplicates !== false,
    blockAmbiguous: stored.blockAmbiguous !== false,
    blockConflicts: stored.blockConflicts !== false,
  };
}

/**
 * Serialize policy to a plain object for storage in jsonb.
 */
export function serializePolicy(policy: AutoCreditPolicy): Record<string, unknown> {
  return { ...policy };
}

// ============================================================
// CONFIDENCE BANDS (for UI display)
// ============================================================

export type ConfidenceBand = "very_strong" | "strong" | "moderate" | "weak";

export function getConfidenceBand(confidence: number): { band: ConfidenceBand; label: string; color: string } {
  if (confidence >= 95) return { band: "very_strong", label: "Very Strong", color: "green" };
  if (confidence >= 85) return { band: "strong", label: "Strong", color: "green" };
  if (confidence >= 70) return { band: "moderate", label: "Moderate", color: "amber" };
  return { band: "weak", label: "Weak", color: "red" };
}
