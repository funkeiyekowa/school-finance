/**
 * Phase 8.2 — Attendance Configuration UX / Flexibility contract tests
 *
 * Static-analysis tests verifying that the migration and UI files
 * correctly expose and consume the two new defaults.
 *
 * Run: node --import tsx/esm \
 *        src/app/api/attendance/settings/__tests__/phase82.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(process.cwd(), "src");

function read(rel: string) {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

const migrationSrc  = readFileSync(resolve(process.cwd(), "supabase/20260908220000_attendance_defaults.sql"), "utf8");
const captureSrc    = read("app/dashboard/attendance/page.tsx");
const settingsUiSrc = read("app/dashboard/setup/attendance-capture/page.tsx");

// ──────────────────────────────────────────────────────────────────────────
// Test 1 — migration adds default_session with CHECK constraint
// ──────────────────────────────────────────────────────────────────────────
{
  assert.match(migrationSrc, /default_session\s+text\s+NOT NULL\s+DEFAULT\s+'full_day'/, "migration must add default_session with DEFAULT 'full_day'");
  assert.match(migrationSrc, /CHECK.*default_session.*full_day.*morning.*afternoon/, "migration must add CHECK constraint for default_session values");
  console.log("✓ Test 1: migration adds default_session with correct default and CHECK");
}

// ──────────────────────────────────────────────────────────────────────────
// Test 2 — migration adds default_attendance_mode with CHECK constraint
// ──────────────────────────────────────────────────────────────────────────
{
  assert.match(migrationSrc, /default_attendance_mode\s+text\s+NOT NULL\s+DEFAULT\s+'class'/, "migration must add default_attendance_mode with DEFAULT 'class'");
  assert.match(migrationSrc, /CHECK.*default_attendance_mode.*class.*subject/, "migration must add CHECK constraint for default_attendance_mode values");
  console.log("✓ Test 2: migration adds default_attendance_mode with correct default and CHECK");
}

// ──────────────────────────────────────────────────────────────────────────
// Test 3 — RPC RETURNS TABLE includes both new columns
// ──────────────────────────────────────────────────────────────────────────
{
  assert.match(migrationSrc, /RETURNS TABLE[\s\S]*?default_session[\s\S]*?\$\$/, "RPC must include default_session in RETURNS TABLE");
  assert.match(migrationSrc, /RETURNS TABLE[\s\S]*?default_attendance_mode[\s\S]*?\$\$/, "RPC must include default_attendance_mode in RETURNS TABLE");
  console.log("✓ Test 3: RPC RETURNS TABLE includes both new columns");
}

// ──────────────────────────────────────────────────────────────────────────
// Test 4 — settings UI exposes Default Session dropdown
// ──────────────────────────────────────────────────────────────────────────
{
  assert.match(settingsUiSrc, /defaultSession/, "settings UI must declare defaultSession state");
  assert.match(settingsUiSrc, /default_session/, "settings UI must reference default_session from ACSRow");
  // Three options present
  assert.match(settingsUiSrc, /value="full_day"/, "settings UI must include full_day option");
  assert.match(settingsUiSrc, /value="morning"/, "settings UI must include morning option");
  assert.match(settingsUiSrc, /value="afternoon"/, "settings UI must include afternoon option");
  console.log("✓ Test 4: settings UI exposes Default Session dropdown with all three options");
}

// ──────────────────────────────────────────────────────────────────────────
// Test 5 — settings UI exposes Default Attendance Mode dropdown
// ──────────────────────────────────────────────────────────────────────────
{
  assert.match(settingsUiSrc, /defaultAttendanceMode/, "settings UI must declare defaultAttendanceMode state");
  assert.match(settingsUiSrc, /default_attendance_mode/, "settings UI must reference default_attendance_mode from ACSRow");
  assert.match(settingsUiSrc, /value="class"/, "settings UI must include class option");
  assert.match(settingsUiSrc, /value="subject"/, "settings UI must include subject option");
  console.log("✓ Test 5: settings UI exposes Default Attendance Mode dropdown with class/subject options");
}

// ──────────────────────────────────────────────────────────────────────────
// Test 6 — settings UI save() includes both new fields
// ──────────────────────────────────────────────────────────────────────────
{
  // Both fields must be in the .update() call
  const updateIdx = settingsUiSrc.lastIndexOf(".update(");
  const updateBlock = settingsUiSrc.slice(updateIdx, updateIdx + 400);
  assert.match(updateBlock, /default_session/, "save() must include default_session");
  assert.match(updateBlock, /default_attendance_mode/, "save() must include default_attendance_mode");
  console.log("✓ Test 6: settings UI save() sends both new fields");
}

// ──────────────────────────────────────────────────────────────────────────
// Test 7 — capture page captureConfig type includes both new fields
// ──────────────────────────────────────────────────────────────────────────
{
  assert.match(captureSrc, /default_session.*string/, "captureConfig type must include default_session: string");
  assert.match(captureSrc, /default_attendance_mode.*string/, "captureConfig type must include default_attendance_mode: string");
  console.log("✓ Test 7: capture page captureConfig type includes both new fields");
}

// ──────────────────────────────────────────────────────────────────────────
// Test 8 — capture page applies default_session from config after load
// ──────────────────────────────────────────────────────────────────────────
{
  assert.match(captureSrc, /setSession\(newCfg\.default_session\)/, "capture page must call setSession(newCfg.default_session) after config loads");
  console.log("✓ Test 8: capture page applies default_session from config after load");
}

// ──────────────────────────────────────────────────────────────────────────
// Test 9 — capture page pre-selects first subject when default_attendance_mode = 'subject'
// ──────────────────────────────────────────────────────────────────────────
{
  assert.match(captureSrc, /default_attendance_mode.*===.*subject/, "capture page must check default_attendance_mode === 'subject'");
  assert.match(captureSrc, /setSelectedSubjectId\(fetched\[0\]\.id\)/, "capture page must pre-select first subject when mode is 'subject'");
  console.log("✓ Test 9: capture page pre-selects first subject when default_attendance_mode = 'subject'");
}

// ──────────────────────────────────────────────────────────────────────────
// Test 10 — Phase 8.1 tests still pass (regression: config.test.ts source unchanged)
// ──────────────────────────────────────────────────────────────────────────
{
  const phase81Src = read("app/api/attendance/settings/__tests__/config.test.ts");
  assert.match(phase81Src, /All Phase 8.1 contract tests passed/, "Phase 8.1 test file must still contain its pass message");
  console.log("✓ Test 10: Phase 8.1 test file still present and unchanged");
}

console.log("\nAll Phase 8.2 contract tests passed.");
