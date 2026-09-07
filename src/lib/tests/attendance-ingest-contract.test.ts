/**
 * Static contract tests for Attendance Multi-Capture Platform — Phase 2
 * (supabase/20260907130000_attendance_capture_devices.sql +
 *  src/app/api/attendance/ingest/route.ts).
 *
 * Same convention as attendance-batch-rpc.test.ts: checks that
 * required security- and correctness-relevant patterns exist.
 * Does NOT connect to a live database.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..", "..", "..");
const migration = fs.readFileSync(
  path.join(root, "supabase", "20260907130000_attendance_capture_devices.sql"),
  "utf8"
);
const route = fs.readFileSync(
  path.join(root, "src", "app", "api", "attendance", "ingest", "route.ts"),
  "utf8"
);

// ================================================================
// Migration: attendance_capture_devices table
// ================================================================
assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.attendance_capture_devices/, "must create attendance_capture_devices table");
assert.match(migration, /token_hash\s+text\s+NOT NULL UNIQUE/, "token_hash must be NOT NULL UNIQUE");
assert.match(migration, /device_type.*CHECK.*IN.*'qr'.*'rfid'/, "device_type must be constrained to qr/rfid");
assert.match(migration, /active\s+boolean\s+NOT NULL DEFAULT true/, "active must default to true");
assert.match(migration, /ENABLE ROW LEVEL SECURITY/, "RLS must be enabled on the table");
assert.match(migration, /is_org_admin\(org_id\)/, "policy must require is_org_admin");

// Index on token_hash for active devices only
assert.match(migration, /idx_capture_devices_token_hash/, "must create index on token_hash");
assert.match(migration, /WHERE active = true/, "token_hash index must be partial (active only)");

// ================================================================
// Migration: record_attendance_batch extended with p_capture_method
// ================================================================
assert.match(migration, /DROP FUNCTION IF EXISTS public\.record_attendance_batch\(uuid, date, text, jsonb\)/, "must drop old 4-param signature to avoid ambiguity");
assert.match(migration, /p_capture_method text DEFAULT 'manual'/, "must add p_capture_method with DEFAULT 'manual'");
assert.match(migration, /p_capture_method NOT IN.*'manual'.*'qr'.*'rfid'/, "must validate p_capture_method value");
// Backward-compat: the INSERT now uses p_capture_method not hardcoded 'manual'
assert.match(migration, /capture_method,[\s\S]*?\)\s*VALUES[\s\S]*?p_capture_method/, "INSERT must use p_capture_method not hardcoded value");
// Grant on new 5-param signature
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.record_attendance_batch\(uuid, date, text, jsonb, text\) TO authenticated/, "must re-grant new signature to authenticated");

// ================================================================
// Migration: ingest_attendance_from_device()
// ================================================================
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.ingest_attendance_from_device\(/, "must create ingest_attendance_from_device function");
assert.match(migration, /p_token_hash text/, "ingest function must accept p_token_hash");
assert.match(migration, /SECURITY DEFINER/, "ingest function must be SECURITY DEFINER");
assert.match(migration, /SET search_path = public/, "ingest function must pin search_path");

// Must NOT be granted to authenticated — only callable via service role
assert.doesNotMatch(migration, /GRANT EXECUTE ON FUNCTION public\.ingest_attendance_from_device.*TO authenticated/, "ingest function must NOT be granted to authenticated");

// Token validation: active device lookup
assert.match(migration, /WHERE token_hash = p_token_hash\s*\n\s*AND active = true/, "must validate token against active devices only");
assert.match(migration, /invalid or inactive device/, "must raise exception for invalid/inactive device");

// Org isolation: class must belong to device's org
assert.match(migration, /device class not found in its organization/, "must validate class belongs to device's org");

// Student org validation
assert.match(migration, /student.*not found in device org/, "must validate each student belongs to device's org");

// Status code validation
assert.match(migration, /attendance_statuses/, "must validate status_code against attendance_statuses");

// Atomic replace scoped to daily attendance only
// Scope to ingest function body to avoid matching the DELETE inside record_attendance_batch
const ingestFnMatch = migration.match(/CREATE OR REPLACE FUNCTION public\.ingest_attendance_from_device[\s\S]*?\n\$\$;/);
assert.ok(ingestFnMatch, "ingest_attendance_from_device function body must be present in migration");
const deviceDeleteMatch = ingestFnMatch![0].match(/DELETE FROM public\.attendance_records[\s\S]*?AND subject_id IS NULL;/);
assert.ok(deviceDeleteMatch, "ingest function must DELETE existing rows atomically");
assert.match(deviceDeleteMatch![0], /class_id\s*=\s*v_device\.class_id/, "DELETE must scope to device's class");
assert.doesNotMatch(deviceDeleteMatch![0], /student_id\s*(=|IN)/, "DELETE must NOT filter by student_id");

// capture_method set from device_type
assert.match(migration, /v_device\.device_type/, "must use device_type from device row for capture_method");

// recorded_by_user_id set to device's UUID (attributability)
assert.match(migration, /recorded_by_user_id[\s\S]*?v_device\.id/, "recorded_by_user_id must be set to device.id");

// Activity log
assert.match(migration, /INSERT INTO public\.activity_log/, "must write to activity_log");
assert.match(migration, /Record Attendance/, "activity_log action must be 'Record Attendance'");

// ================================================================
// Route: security checks
// ================================================================
// Must use SHA-256 (Node crypto), not send plaintext token to DB
assert.match(route, /createHash\("sha256"\)/, "route must hash token with SHA-256");
assert.match(route, /\.update\(rawToken\)\.digest\("hex"\)/, "route must produce hex digest of raw token");
assert.doesNotMatch(route, /p_token\b(?!_hash)/, "route must never pass raw token to DB — only the hash");

// Must use service role, not user JWT
assert.match(route, /SUPABASE_SERVICE_ROLE_KEY/, "route must use service role key");
assert.match(route, /persistSession: false/, "service client must not persist a session");

// Must extract Bearer token from Authorization header
assert.match(route, /Bearer /, "route must require Bearer token");
assert.match(route, /missing or invalid device token/, "route must return 401 for missing token");

// Must call the correct DB function
assert.match(route, /ingest_attendance_from_device/, "route must call ingest_attendance_from_device RPC");
assert.match(route, /p_token_hash/, "route must pass p_token_hash to the RPC");

// Must NOT call record_attendance_batch directly (device ingest uses its own function)
assert.doesNotMatch(route, /record_attendance_batch/, "route must NOT call record_attendance_batch — use ingest_attendance_from_device");

// Must validate body before calling DB
assert.match(route, /Array\.isArray\(marks\)/, "route must validate marks is an array");
assert.match(route, /marks\.length === 0/, "route must reject empty marks array");

// httpStatusForDbError must map "not enrolled in device class" to 422
assert.match(route, /not enrolled in device class/, "route must map unenrolled-student DB error to 422 (Phase 3)");

console.log("Attendance ingest contract checks passed.");
console.log("Live verification required: valid device token → 200 with correct capture_method; invalid token → 401; inactive device → 401; cross-org student → 422; manual attendance page unaffected.");
