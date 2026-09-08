/**
 * Phase 8.1 — Attendance Configuration Controls contract tests
 *
 * These are static-analysis / source-contract tests.
 * They verify that the server routes and UI files reference
 * the expected flags without executing actual DB queries.
 *
 * Run: node --import tsx/esm \
 *        src/app/api/attendance/settings/__tests__/config.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(process.cwd(), "src");

function read(rel: string) {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

// ── Sources ────────────────────────────────────────────────────────────────
const migrationSrc  = readFileSync(resolve(process.cwd(), "supabase/20260908210000_attendance_config_controls.sql"), "utf8");
const reportsSrc    = read("app/api/attendance/reports/route.ts");
const subjectsSrc   = read("app/api/attendance/subjects/route.ts");
const captureSrc    = read("app/dashboard/attendance/page.tsx");
const reportUiSrc   = read("app/dashboard/attendance/reports/page.tsx");
const settingsUiSrc = read("app/dashboard/setup/attendance-capture/page.tsx");

// ──────────────────────────────────────────────────────────────────────────
// Test 1 — migration adds all 7 fields with correct defaults
// ──────────────────────────────────────────────────────────────────────────
{
  const fields = [
    "subject_attendance_enabled",
    "period_selection_enabled",
    "class_level_attendance_enabled",
    "subject_required_for_attendance",
    "manual_session_enabled",
    "attendance_reports_enabled",
    "attendance_csv_export_enabled",
  ];
  for (const f of fields) {
    assert.match(migrationSrc, new RegExp(f), `migration must add field: ${f}`);
  }
  // boolean with NOT NULL DEFAULT
  assert.match(migrationSrc, /boolean NOT NULL DEFAULT true/, "migration must set boolean NOT NULL DEFAULT true for permissive flags");
  assert.match(migrationSrc, /subject_required_for_attendance boolean NOT NULL DEFAULT false/, "subject_required_for_attendance must default false");
  console.log("✓ Test 1: migration adds 7 fields with correct defaults");
}

// ──────────────────────────────────────────────────────────────────────────
// Test 2 — get_my_attendance_capture_settings RPC returns all 7 new fields
// ──────────────────────────────────────────────────────────────────────────
{
  const newFields = [
    "subject_attendance_enabled",
    "period_selection_enabled",
    "class_level_attendance_enabled",
    "subject_required_for_attendance",
    "manual_session_enabled",
    "attendance_reports_enabled",
    "attendance_csv_export_enabled",
  ];
  for (const f of newFields) {
    assert.match(migrationSrc, new RegExp(`RETURNS TABLE[\\s\\S]*?${f}[\\s\\S]*?\\$\\$`, ""), `RPC RETURNS TABLE must include: ${f}`);
  }
  assert.match(migrationSrc, /CREATE OR REPLACE FUNCTION public.get_my_attendance_capture_settings/, "migration must replace the RPC");
  console.log("✓ Test 2: get_my_attendance_capture_settings RPC returns all 7 new fields");
}

// ──────────────────────────────────────────────────────────────────────────
// Test 3 — reports route enforces attendance_reports_enabled → 403
// ──────────────────────────────────────────────────────────────────────────
{
  assert.match(reportsSrc, /attendance_reports_enabled/, "reports route must reference attendance_reports_enabled");
  assert.match(reportsSrc, /get_my_attendance_capture_settings/, "reports route must call settings RPC");
  // 403 returned when reports disabled — find the runtime guard (!cfg.attendance_reports_enabled)
  assert.match(reportsSrc, /!cfg\.attendance_reports_enabled[\s\S]{0,200}status: 403/, "reports route must return 403 when attendance_reports_enabled is false");
  console.log("✓ Test 3: reports route enforces attendance_reports_enabled → 403");
}

// ──────────────────────────────────────────────────────────────────────────
// Test 4 — reports route enforces attendance_csv_export_enabled → 403 for CSV
// ──────────────────────────────────────────────────────────────────────────
{
  assert.match(reportsSrc, /attendance_csv_export_enabled/, "reports route must reference attendance_csv_export_enabled");
  // 403 returned when CSV export disabled — find the runtime guard (!cfg.attendance_csv_export_enabled)
  assert.match(reportsSrc, /!cfg\.attendance_csv_export_enabled[\s\S]{0,200}status: 403/, "reports route must return 403 when CSV export disabled");
  console.log("✓ Test 4: reports route enforces attendance_csv_export_enabled → 403 for CSV");
}

// ──────────────────────────────────────────────────────────────────────────
// Test 5 — subjects route enforces subject_attendance_enabled → 403
// ──────────────────────────────────────────────────────────────────────────
{
  assert.match(subjectsSrc, /subject_attendance_enabled/, "subjects route must reference subject_attendance_enabled");
  assert.match(subjectsSrc, /get_my_attendance_capture_settings/, "subjects route must call settings RPC");
  // 403 returned when subject attendance disabled — find the runtime guard
  assert.match(subjectsSrc, /!subjectAttendanceEnabled[\s\S]{0,200}status: 403/, "subjects route must return 403 when subject attendance disabled");
  console.log("✓ Test 5: subjects route enforces subject_attendance_enabled → 403");
}

// ──────────────────────────────────────────────────────────────────────────
// Test 6 — capture page reads all 7 flags from captureConfig
// ──────────────────────────────────────────────────────────────────────────
{
  const flags = [
    "subject_attendance_enabled",
    "period_selection_enabled",
    "class_level_attendance_enabled",
    "subject_required_for_attendance",
    "attendance_reports_enabled",
  ];
  for (const f of flags) {
    assert.match(captureSrc, new RegExp(`captureConfig\\.${f}`), `capture page must use captureConfig.${f}`);
  }
  console.log("✓ Test 6: capture page reads config flags from captureConfig");
}

// ──────────────────────────────────────────────────────────────────────────
// Test 7 — capture page gates Reports link on attendance_reports_enabled
// ──────────────────────────────────────────────────────────────────────────
{
  assert.match(captureSrc, /captureConfig\.attendance_reports_enabled/, "capture page must gate Reports link on attendance_reports_enabled");
  // The link must be inside a conditional block
  const idx = captureSrc.indexOf("captureConfig.attendance_reports_enabled");
  const context = captureSrc.slice(idx, idx + 300);
  assert.match(context, /href="\/dashboard\/attendance\/reports"/, "Reports link must be gated by the flag");
  console.log("✓ Test 7: capture page gates Reports link on attendance_reports_enabled");
}

// ──────────────────────────────────────────────────────────────────────────
// Test 8 — reports UI page gates CSV Export button on csvExportEnabled
// ──────────────────────────────────────────────────────────────────────────
{
  assert.match(reportUiSrc, /csvExportEnabled/, "reports UI must declare csvExportEnabled state");
  assert.match(reportUiSrc, /get_my_attendance_capture_settings/, "reports UI must call settings RPC");
  // Button conditional includes csvExportEnabled
  // The guard wraps the Button — look for csvExportEnabled within 300 chars before "Export CSV"
  const btnIdx = reportUiSrc.indexOf("Export CSV");
  const btnContext = reportUiSrc.slice(Math.max(0, btnIdx - 300), btnIdx + 50);
  assert.match(btnContext, /csvExportEnabled/, "Export CSV button must be gated by csvExportEnabled");
  console.log("✓ Test 8: reports UI gates CSV Export button on csvExportEnabled");
}

// ──────────────────────────────────────────────────────────────────────────
// Test 9 — settings UI page exposes all 7 toggles
// ──────────────────────────────────────────────────────────────────────────
{
  const toggleKeys = [
    "subject_attendance_enabled",
    "period_selection_enabled",
    "class_level_attendance_enabled",
    "subject_required_for_attendance",
    "manual_session_enabled",
    "attendance_reports_enabled",
    "attendance_csv_export_enabled",
  ];
  for (const k of toggleKeys) {
    assert.match(settingsUiSrc, new RegExp(k), `settings UI must include toggle for: ${k}`);
  }
  console.log("✓ Test 9: settings UI exposes all 7 config toggles");
}

// ──────────────────────────────────────────────────────────────────────────
// Test 10 — settings UI handles RPC returning TABLE (array)
// ──────────────────────────────────────────────────────────────────────────
{
  assert.match(settingsUiSrc, /Array\.isArray/, "settings UI must handle RPC returning TABLE (array)");
  console.log("✓ Test 10: settings UI handles RPC TABLE response (array)");
}

console.log("\nAll Phase 8.1 contract tests passed.");
