/**
 * Contrast utility tests.
 *
 * Self-contained test functions verifying WCAG contrast-ratio math.
 * Same pattern as theme-validator.test.ts.
 *
 * Run all: import { runAll } from './contrast.test'; runAll();
 */

import { contrastRatio, auditContrast, checkPair } from "./contrast";

interface TestResult {
  pass: boolean;
  name: string;
  detail?: string;
}

function test(name: string, fn: () => boolean | string): TestResult {
  try {
    const result = fn();
    if (result === true) return { pass: true, name };
    return { pass: false, name, detail: typeof result === "string" ? result : "Assertion failed" };
  } catch (e: unknown) {
    return { pass: false, name, detail: String(e) };
  }
}

function approxEqual(a: number, b: number, tolerance = 0.1): boolean {
  return Math.abs(a - b) <= tolerance;
}

export function testBlackOnWhite(): TestResult {
  return test("black on white gives 21:1", () => {
    const ratio = contrastRatio("#000000", "#FFFFFF");
    if (!approxEqual(ratio, 21, 0.01)) return `Expected ~21, got ${ratio}`;
    return true;
  });
}

export function testWhiteOnBlack(): TestResult {
  return test("white on black gives 21:1 (order independent)", () => {
    const ratio = contrastRatio("#FFFFFF", "#000000");
    if (!approxEqual(ratio, 21, 0.01)) return `Expected ~21, got ${ratio}`;
    return true;
  });
}

export function testSameColorGives1(): TestResult {
  return test("same color gives 1:1", () => {
    const ratio = contrastRatio("#FF0000", "#FF0000");
    if (!approxEqual(ratio, 1, 0.01)) return `Expected 1, got ${ratio}`;
    return true;
  });
}

export function testAABoundary(): TestResult {
  return test("WCAG AA boundary: 4.5:1 pass/fail", () => {
    // #767676 on white is the well-known AA boundary (~4.54:1)
    const ratio = contrastRatio("#767676", "#FFFFFF");
    if (ratio < 4.5) return `Expected >= 4.5, got ${ratio}`;
    // #777777 on white should be just below or at boundary
    const ratio2 = contrastRatio("#777777", "#FFFFFF");
    if (ratio2 > 4.6) return `Expected close to 4.5, got ${ratio2}`;
    return true;
  });
}

export function testAAABoundary(): TestResult {
  return test("WCAG AAA boundary: 7:1", () => {
    // #595959 on white is approximately 7:1
    const ratio = contrastRatio("#595959", "#FFFFFF");
    if (ratio < 6.9 || ratio > 7.2) return `Expected ~7:1, got ${ratio}`;
    return true;
  });
}

export function testShortHex(): TestResult {
  return test("handles 3-char hex notation", () => {
    const ratio = contrastRatio("#000", "#FFF");
    if (!approxEqual(ratio, 21, 0.01)) return `Expected ~21, got ${ratio}`;
    return true;
  });
}

export function testInvalidHexReturnsLowRatio(): TestResult {
  return test("invalid hex gracefully returns a ratio (no crash)", () => {
    const ratio = contrastRatio("notacolor", "#FFFFFF");
    if (typeof ratio !== "number") return "Expected a number";
    return true;
  });
}

export function testAuditReturnsAllPairings(): TestResult {
  return test("auditContrast returns expected pairings for a full color set", () => {
    const colors = {
      primary: "#1D4ED8", primaryDark: "#1E3A8A", secondary: "#0EA5E9",
      accent: "#F59E0B", background: "#FFFFFF", surface: "#F8FAFC",
      surfaceAlt: "#EFF6FF", text: "#0F172A", textMuted: "#64748B",
      border: "#E2E8F0", headerBg: "#FFFFFF", headerText: "#0F172A",
      footerBg: "#0F172A", footerText: "#CBD5E1",
    };
    const audit = auditContrast(colors);
    if (audit.pairings.length < 5) return `Expected >=5 pairings, got ${audit.pairings.length}`;
    if (audit.passCount + audit.failCount !== audit.pairings.length) return "Count mismatch";
    return true;
  });
}

export function testAuditIdentifiesFailures(): TestResult {
  return test("auditContrast correctly identifies low-contrast pairings", () => {
    const colors = {
      text: "#CCCCCC",       // light gray text
      background: "#FFFFFF", // on white — very low contrast
      textMuted: "#EEEEEE",
      surface: "#FAFAFA",
      surfaceAlt: "#F5F5F5",
      headerBg: "#FFFFFF",
      headerText: "#EEEEEE",
      footerBg: "#FFFFFF",
      footerText: "#DDDDDD",
      primary: "#EEEEEE",
      accent: "#EEEEEE",
    };
    const audit = auditContrast(colors);
    if (audit.allPassAA) return "Expected failures for low-contrast palette";
    if (audit.failCount === 0) return "Expected at least one failure";
    return true;
  });
}

export function testCheckPairSummary(): TestResult {
  return test("checkPair returns correct summary format", () => {
    const result = checkPair("#000000", "#FFFFFF");
    if (!result.aaa) return "Black on white should pass AAA";
    if (!result.summary.includes("AAA")) return `Expected AAA in summary, got: ${result.summary}`;
    return true;
  });
}

export function testCheckPairFailSummary(): TestResult {
  return test("checkPair reports failure correctly", () => {
    const result = checkPair("#FFFFFF", "#FEFEFE");
    if (result.aa) return "Nearly same colors should fail AA";
    if (!result.summary.includes("Fails")) return `Expected Fails in summary, got: ${result.summary}`;
    return true;
  });
}

export function runAll(): { results: TestResult[]; passed: number; failed: number } {
  const tests = [
    testBlackOnWhite,
    testWhiteOnBlack,
    testSameColorGives1,
    testAABoundary,
    testAAABoundary,
    testShortHex,
    testInvalidHexReturnsLowRatio,
    testAuditReturnsAllPairings,
    testAuditIdentifiesFailures,
    testCheckPairSummary,
    testCheckPairFailSummary,
  ];

  const results = tests.map(t => t());
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;

  return { results, passed, failed };
}
