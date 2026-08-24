/**
 * Theme validator tests.
 *
 * These are self-contained test functions that can be called from a REPL,
 * a future test runner, or a browser console. Each returns { pass, name, detail? }.
 * This follows the existing pattern in src/lib/tests/tenant-isolation.test.ts.
 *
 * Run all: import { runAll } from './theme-validator.test'; runAll();
 */

import { validateThemeTokens } from "./theme-validator";

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

export function testValidFullTheme(): TestResult {
  return test("valid full theme passes", () => {
    const result = validateThemeTokens({
      colors: { primary: "#1D4ED8", background: "#FFFFFF", text: "#0F172A" },
      fonts: { heading: "Poppins", body: "Inter" },
      scale: { h1: "3rem", body: "1rem" },
      radius: { md: "0.75rem", pill: "9999px" },
      spacing: { section: "5rem", gap: "1.5rem" },
      button: { radius: "0.75rem", weight: "600", transform: "none" },
      shadow: { card: "0 1px 3px rgba(15,23,42,.08)" },
      headerStyle: "dark",
      heroStyle: "centered",
    });
    if (!result.valid) return `Expected valid, got errors: ${result.errors.join(", ")}`;
    return true;
  });
}

export function testValidMinimalTheme(): TestResult {
  return test("valid minimal theme (colors only) passes", () => {
    const result = validateThemeTokens({ colors: { primary: "#FF0000" } });
    if (!result.valid) return `Expected valid, got errors: ${result.errors.join(", ")}`;
    return true;
  });
}

export function testEmptyObjectPasses(): TestResult {
  return test("empty object passes (all fields optional)", () => {
    const result = validateThemeTokens({});
    if (!result.valid) return `Expected valid, got errors: ${result.errors.join(", ")}`;
    return true;
  });
}

export function testRejectsUrlInColor(): TestResult {
  return test("rejects url() in color values", () => {
    const result = validateThemeTokens({
      colors: { primary: "url(https://evil.com/track.gif)" },
    });
    if (result.valid) return "Expected invalid, but passed";
    if (!result.errors.some(e => e.includes("primary"))) return "Expected error mentioning 'primary'";
    return true;
  });
}

export function testRejectsJavascriptProtocol(): TestResult {
  return test("rejects javascript: in values", () => {
    const result = validateThemeTokens({
      shadow: { card: "javascript:alert(1)" },
    });
    if (result.valid) return "Expected invalid, but passed";
    return true;
  });
}

export function testRejectsScriptTag(): TestResult {
  return test("rejects <script in values", () => {
    const result = validateThemeTokens({
      shadow: { card: '<script>alert("xss")</script>' },
    });
    if (result.valid) return "Expected invalid, but passed";
    return true;
  });
}

export function testRejectsExpressionInColor(): TestResult {
  return test("rejects expression() in color values", () => {
    const result = validateThemeTokens({
      colors: { primary: "expression(document.cookie)" },
    });
    if (result.valid) return "Expected invalid, but passed";
    return true;
  });
}

export function testRejectsDataUri(): TestResult {
  return test("rejects data: URI in values", () => {
    const result = validateThemeTokens({
      shadow: { card: "data:text/html,<h1>hi</h1>" },
    });
    if (result.valid) return "Expected invalid, but passed";
    return true;
  });
}

export function testRejectsUnknownTopLevelKeys(): TestResult {
  return test("rejects unknown top-level keys", () => {
    const result = validateThemeTokens({
      colors: { primary: "#000" },
      malicious: { inject: "value" },
    } as unknown);
    if (result.valid) return "Expected invalid, but passed";
    if (!result.errors.some(e => e.includes("malicious"))) return "Expected error mentioning 'malicious'";
    return true;
  });
}

export function testRejectsUnknownColorKeys(): TestResult {
  return test("rejects unknown color keys", () => {
    const result = validateThemeTokens({
      colors: { primary: "#000", backdoor: "#FFF" },
    });
    if (result.valid) return "Expected invalid, but passed";
    if (!result.errors.some(e => e.includes("backdoor"))) return "Expected error mentioning 'backdoor'";
    return true;
  });
}

export function testRejectsOversizedInput(): TestResult {
  return test("rejects tokens exceeding 10KB", () => {
    const huge = { colors: { primary: "#" + "A".repeat(11000) } };
    const result = validateThemeTokens(huge);
    if (result.valid) return "Expected invalid for oversized input";
    if (!result.errors.some(e => e.includes("size") || e.includes("maximum"))) return "Expected size error";
    return true;
  });
}

export function testRejectsInvalidCssUnits(): TestResult {
  return test("rejects invalid CSS units in scale", () => {
    const result = validateThemeTokens({
      scale: { h1: "3vw", body: "calc(1rem + 2px)" },
    });
    if (result.valid) return "Expected invalid for non-standard units";
    return true;
  });
}

export function testRejectsFontNameWithSpecialChars(): TestResult {
  return test("rejects font names with special characters", () => {
    const result = validateThemeTokens({
      fonts: { heading: "Poppins; font-size:100px" },
    });
    if (result.valid) return "Expected invalid for injection in font name";
    return true;
  });
}

export function testRejectsInvalidHeaderStyle(): TestResult {
  return test("rejects invalid headerStyle", () => {
    const result = validateThemeTokens({ headerStyle: "evil" });
    if (result.valid) return "Expected invalid for bad headerStyle";
    return true;
  });
}

export function testRejectsInvalidHeroStyle(): TestResult {
  return test("rejects invalid heroStyle", () => {
    const result = validateThemeTokens({ heroStyle: "malicious" });
    if (result.valid) return "Expected invalid for bad heroStyle";
    return true;
  });
}

export function testRejectsNonObjectInput(): TestResult {
  return test("rejects non-object input", () => {
    const r1 = validateThemeTokens("string");
    const r2 = validateThemeTokens(null);
    const r3 = validateThemeTokens([1, 2, 3]);
    if (r1.valid || r2.valid || r3.valid) return "Expected all non-objects to fail";
    return true;
  });
}

export function testAcceptsRgbColors(): TestResult {
  return test("accepts rgb/rgba color format", () => {
    const result = validateThemeTokens({
      colors: {
        primary: "rgb(29, 78, 216)",
        background: "rgba(255, 255, 255, 0.9)",
      },
    });
    if (!result.valid) return `Expected valid, got: ${result.errors.join(", ")}`;
    return true;
  });
}

export function testAcceptsHslColors(): TestResult {
  return test("accepts hsl/hsla color format", () => {
    const result = validateThemeTokens({
      colors: { primary: "hsl(225, 76%, 48%)" },
    });
    if (!result.valid) return `Expected valid, got: ${result.errors.join(", ")}`;
    return true;
  });
}

// ============================================================
// HARDENING TESTS (Increment 1.1)
// ============================================================

/**
 * Verify theme-source exclusivity logic at the client level.
 * The RPC and CHECK constraint enforce this server-side; this test
 * validates that the client-side draftDiffersFromPublished helper
 * correctly detects divergence with the published state.
 */
export function testDraftDiffDetectsThemeKeyChange(): TestResult {
  return test("draftDiffersFromPublished detects theme_key change", () => {
    // Inline import to avoid circular dependencies
    const { draftDiffersFromPublished } = require("./draft") as typeof import("./draft");
    const draft = {
      theme_key: "modern-academy",
      custom_theme_id: null,
      brand: {},
      typography: {},
      last_saved_at: "2026-01-01T00:00:00Z",
      saved_by: "user-1",
      published_at: null,
    };
    const published = {
      theme_key: "classic-excellence",
      custom_theme_id: null,
      brand: {},
      typography: {},
    };
    if (!draftDiffersFromPublished(draft, published)) {
      return "Expected draft to differ when theme_key changed";
    }
    return true;
  });
}

export function testDraftDiffDetectsCustomThemeChange(): TestResult {
  return test("draftDiffersFromPublished detects custom_theme_id change", () => {
    const { draftDiffersFromPublished } = require("./draft") as typeof import("./draft");
    const draft = {
      theme_key: null,
      custom_theme_id: "uuid-custom-1",
      brand: {},
      typography: {},
      last_saved_at: "2026-01-01T00:00:00Z",
      saved_by: "user-1",
      published_at: null,
    };
    const published = {
      theme_key: "classic-excellence",
      custom_theme_id: null,
      brand: {},
      typography: {},
    };
    if (!draftDiffersFromPublished(draft, published)) {
      return "Expected draft to differ when custom_theme_id changed";
    }
    return true;
  });
}

export function testDraftNoDiffWhenSynced(): TestResult {
  return test("draftDiffersFromPublished returns false when synced", () => {
    const { draftDiffersFromPublished } = require("./draft") as typeof import("./draft");
    const state = {
      theme_key: "modern-academy",
      custom_theme_id: null,
      brand: { colors: { primary: "#1D4ED8" } },
      typography: { heading: "Poppins" },
    };
    const draft = {
      ...state,
      last_saved_at: "2026-01-01T00:00:00Z",
      saved_by: "user-1",
      published_at: "2026-01-01T00:00:00Z",
    };
    if (draftDiffersFromPublished(draft, state)) {
      return "Expected no difference when values match";
    }
    return true;
  });
}

export function testDraftNullReturnsNoDiff(): TestResult {
  return test("draftDiffersFromPublished returns false for null draft", () => {
    const { draftDiffersFromPublished } = require("./draft") as typeof import("./draft");
    const published = {
      theme_key: "modern-academy",
      custom_theme_id: null,
      brand: {},
      typography: {},
    };
    if (draftDiffersFromPublished(null, published)) {
      return "Expected false when draft is null";
    }
    return true;
  });
}

/**
 * Security posture verification — ensures the migration SQL contains
 * critical hardening markers. This is a static analysis of the migration
 * file content, not a live DB test.
 */
export function testSecurityPostureMigration(): TestResult {
  return test("migration hardening: search_path and REVOKE present", () => {
    // Read the migration file as a string
    const fs = require("fs");
    const path = require("path");
    const migrationPath = path.resolve(process.cwd(), "supabase/website_studio_upgrade_migration.sql");
    let sql: string;
    try {
      sql = fs.readFileSync(migrationPath, "utf-8");
    } catch {
      return "Could not read migration file for posture check";
    }

    const checks: string[] = [];

    // All SECURITY DEFINER function definitions must use pg_catalog, public
    // Only count actual function definitions (LANGUAGE ... SECURITY DEFINER SET)
    const definerCount = (sql.match(/LANGUAGE\s+plpgsql\s+(?:STABLE\s+)?SECURITY DEFINER/g) || []).length;
    const pgCatalogCount = (sql.match(/search_path\s*=\s*pg_catalog,\s*public/g) || []).length;
    if (pgCatalogCount < definerCount) {
      checks.push(`Expected ${definerCount} pg_catalog search_paths, found ${pgCatalogCount}`);
    }

    // All new RPCs (save, discard, publish, get_draft_preview) must have REVOKE FROM PUBLIC
    const newRpcs = ["save_website_draft", "discard_website_draft", "publish_website_draft", "get_draft_preview"];
    for (const rpc of newRpcs) {
      if (!sql.includes(`REVOKE EXECUTE ON FUNCTION ${rpc}`)) {
        checks.push(`Missing REVOKE EXECUTE for ${rpc}`);
      }
    }

    // CHECK constraint for exclusivity must exist
    if (!sql.includes("chk_draft_theme_source_exclusive")) {
      checks.push("Missing CHECK constraint chk_draft_theme_source_exclusive");
    }

    // published_at column must exist on website_drafts
    if (!sql.includes("published_at")) {
      checks.push("Missing published_at column");
    }

    // No public SELECT policy on website_custom_themes
    if (sql.includes("custom_themes_public_read")) {
      checks.push("Found disallowed custom_themes_public_read policy");
    }

    if (checks.length > 0) {
      return `Security posture failures: ${checks.join("; ")}`;
    }
    return true;
  });
}

export function testExclusivityConstraintInMigration(): TestResult {
  return test("migration contains CHECK constraint rejecting both theme sources", () => {
    const fs = require("fs");
    const path = require("path");
    const migrationPath = path.resolve(process.cwd(), "supabase/website_studio_upgrade_migration.sql");
    let sql: string;
    try {
      sql = fs.readFileSync(migrationPath, "utf-8");
    } catch {
      return "Could not read migration file";
    }

    // The constraint must prevent both being NOT NULL simultaneously
    if (!sql.includes("NOT (theme_key IS NOT NULL AND custom_theme_id IS NOT NULL)")) {
      return "CHECK constraint logic not found";
    }
    return true;
  });
}

export function testPublishRetainsDraftInMigration(): TestResult {
  return test("publish_website_draft retains draft (UPDATE not DELETE)", () => {
    const fs = require("fs");
    const path = require("path");
    const migrationPath = path.resolve(process.cwd(), "supabase/website_studio_upgrade_migration.sql");
    let sql: string;
    try {
      sql = fs.readFileSync(migrationPath, "utf-8");
    } catch {
      return "Could not read migration file";
    }

    // Extract the publish function body
    const publishStart = sql.indexOf("CREATE OR REPLACE FUNCTION publish_website_draft");
    const publishEnd = sql.indexOf("REVOKE EXECUTE ON FUNCTION publish_website_draft");
    if (publishStart === -1 || publishEnd === -1) {
      return "Could not locate publish_website_draft function";
    }
    const publishBody = sql.substring(publishStart, publishEnd);

    // Must NOT contain DELETE FROM website_drafts
    if (publishBody.includes("DELETE FROM") && publishBody.includes("website_drafts")) {
      return "publish_website_draft still DELETEs the draft — should UPDATE instead";
    }

    // Must contain UPDATE website_drafts to retain the draft
    if (!publishBody.includes("UPDATE public.website_drafts SET")) {
      return "publish_website_draft does not UPDATE the draft row to retain it";
    }

    // Must set published_at
    if (!publishBody.includes("published_at")) {
      return "publish_website_draft does not set published_at";
    }

    return true;
  });
}

export function testDiscardResetsInsteadOfDeleting(): TestResult {
  return test("discard_website_draft resets to published state (not DELETE)", () => {
    const fs = require("fs");
    const path = require("path");
    const migrationPath = path.resolve(process.cwd(), "supabase/website_studio_upgrade_migration.sql");
    let sql: string;
    try {
      sql = fs.readFileSync(migrationPath, "utf-8");
    } catch {
      return "Could not read migration file";
    }

    const discardStart = sql.indexOf("CREATE OR REPLACE FUNCTION discard_website_draft");
    const discardEnd = sql.indexOf("REVOKE EXECUTE ON FUNCTION discard_website_draft");
    if (discardStart === -1 || discardEnd === -1) {
      return "Could not locate discard_website_draft function";
    }
    const discardBody = sql.substring(discardStart, discardEnd);

    if (discardBody.includes("DELETE FROM") && discardBody.includes("website_drafts")) {
      return "discard_website_draft still DELETEs — should reset to published state";
    }

    if (!discardBody.includes("UPDATE public.website_drafts SET")) {
      return "discard_website_draft does not UPDATE the draft row";
    }

    // Must reference the published site values (v_site.theme_key, v_site.brand, etc.)
    if (!discardBody.includes("v_site.theme_key")) {
      return "discard does not copy from published site config";
    }

    return true;
  });
}

export function testSaveDraftRejectsExclusivityViolation(): TestResult {
  return test("save_website_draft rejects both theme_key and custom_theme_id", () => {
    const fs = require("fs");
    const path = require("path");
    const migrationPath = path.resolve(process.cwd(), "supabase/website_studio_upgrade_migration.sql");
    let sql: string;
    try {
      sql = fs.readFileSync(migrationPath, "utf-8");
    } catch {
      return "Could not read migration file";
    }

    const saveStart = sql.indexOf("CREATE OR REPLACE FUNCTION save_website_draft");
    const saveEnd = sql.indexOf("REVOKE EXECUTE ON FUNCTION save_website_draft");
    if (saveStart === -1 || saveEnd === -1) {
      return "Could not locate save_website_draft function";
    }
    const saveBody = sql.substring(saveStart, saveEnd);

    if (!saveBody.includes("p_theme_key IS NOT NULL AND p_custom_theme_id IS NOT NULL")) {
      return "save_website_draft does not check for both-selected violation";
    }

    if (!saveBody.includes("Cannot select both")) {
      return "save_website_draft does not return the exclusivity error message";
    }

    return true;
  });
}

/** Run all tests and return the full results. */
export function runAll(): { results: TestResult[]; passed: number; failed: number } {
  const tests = [
    testValidFullTheme,
    testValidMinimalTheme,
    testEmptyObjectPasses,
    testRejectsUrlInColor,
    testRejectsJavascriptProtocol,
    testRejectsScriptTag,
    testRejectsExpressionInColor,
    testRejectsDataUri,
    testRejectsUnknownTopLevelKeys,
    testRejectsUnknownColorKeys,
    testRejectsOversizedInput,
    testRejectsInvalidCssUnits,
    testRejectsFontNameWithSpecialChars,
    testRejectsInvalidHeaderStyle,
    testRejectsInvalidHeroStyle,
    testRejectsNonObjectInput,
    testAcceptsRgbColors,
    testAcceptsHslColors,
    // Increment 1.1 hardening tests
    testDraftDiffDetectsThemeKeyChange,
    testDraftDiffDetectsCustomThemeChange,
    testDraftNoDiffWhenSynced,
    testDraftNullReturnsNoDiff,
    testSecurityPostureMigration,
    testExclusivityConstraintInMigration,
    testPublishRetainsDraftInMigration,
    testDiscardResetsInsteadOfDeleting,
    testSaveDraftRejectsExclusivityViolation,
  ];

  const results = tests.map(t => t());
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;

  return { results, passed, failed };
}
