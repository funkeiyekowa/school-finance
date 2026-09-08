/**
 * Static contract tests for POST /api/attendance/insights
 * Uses tsx — same pattern as existing tests. Does NOT connect to a live DB.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..", "..", "..", "..", "..", "..");
const routeSrc = fs.readFileSync(
  path.join(root, "src", "app", "api", "attendance", "insights", "route.ts"),
  "utf8"
);
const insightsSrc = fs.readFileSync(
  path.join(root, "src", "lib", "attendance", "ai-insights.ts"),
  "utf8"
);

// ----------------------------------------------------------------
// 1. No auth → 401
// ----------------------------------------------------------------
assert.match(routeSrc, /status: 401/, "Route must return 401 when not signed in");
assert.match(routeSrc, /auth\.getUser\(\)/, "Route must call auth.getUser()");
console.log("PASS: no auth → 401");

// ----------------------------------------------------------------
// 2. ai_insights_enabled false → 403
// ----------------------------------------------------------------
assert.match(routeSrc, /ai_insights_enabled/, "Route must check ai_insights_enabled");
assert.match(routeSrc, /get_my_attendance_capture_settings/, "Route must call get_my_attendance_capture_settings RPC");
// The check must appear before the AI call
const aiInsightsCheck = routeSrc.indexOf("ai_insights_enabled");
const aiCallIndex = routeSrc.indexOf("resolveProviderForOrg");
assert.ok(aiInsightsCheck < aiCallIndex, "ai_insights_enabled must be checked before AI call");
console.log("PASS: ai_insights_enabled false → 403 (checked before AI call)");

// ----------------------------------------------------------------
// 3. Teacher requesting unassigned class → 403
// ----------------------------------------------------------------
assert.match(routeSrc, /teacher_assignments/, "Route must check teacher_assignments");
assert.match(routeSrc, /allowed_class_ids\.includes\(req\.class_id\)/, "Route must verify class_id in allowed list");
assert.match(routeSrc, /Not authorized for this class/, "Route must return 403 for unassigned class");
console.log("PASS: teacher requesting unassigned class → 403");

// ----------------------------------------------------------------
// 4. Teacher requesting assigned class → 200 path exists
// ----------------------------------------------------------------
assert.match(routeSrc, /phase1_active_role/, "Route must call phase1_active_role");
assert.match(routeSrc, /activeRole === "teacher"/, "Route must handle teacher role");
assert.match(routeSrc, /NextResponse\.json\(resolved\)/, "Route must return resolved findings");
console.log("PASS: teacher with assigned class → 200 path exists");

// ----------------------------------------------------------------
// 5. Admin → 200 path exists (HR_ACCESS_ROLES)
// ----------------------------------------------------------------
assert.match(routeSrc, /HR_ACCESS_ROLES/, "Route must define HR_ACCESS_ROLES set");
assert.match(routeSrc, /HR_ACCESS_ROLES\.has\(activeRole\)/, "Route must check HR_ACCESS_ROLES");
assert.match(routeSrc, /"admin"/, "HR_ACCESS_ROLES must include admin");
assert.match(routeSrc, /"owner"/, "HR_ACCESS_ROLES must include owner");
console.log("PASS: admin → 200 path exists via HR_ACCESS_ROLES");

// ----------------------------------------------------------------
// 6. AI returns malformed JSON → safe 500 response
// ----------------------------------------------------------------
assert.match(routeSrc, /validateAndSanitizeResponse/, "Route must call validateAndSanitizeResponse");
// validateAndSanitizeResponse wraps in try/catch and route handles it
assert.match(routeSrc, /AI returned an unexpected response format/, "Route must catch validation errors safely");
console.log("PASS: malformed AI JSON → safe 500 response");

// ----------------------------------------------------------------
// 7. AI returns unknown ref → 'Unknown' in display_name
// ----------------------------------------------------------------
assert.match(insightsSrc, /refMap\.get\(f\.ref\) \?\? "Unknown"/, "resolveRefs must use 'Unknown' for unknown refs");
assert.match(routeSrc, /resolveRefs\(validated, refMap\)/, "Route must call resolveRefs with refMap");
// AI-returned refs are never used as DB keys
assert.doesNotMatch(
  routeSrc,
  /supabase.*finding\.ref|from\(.*finding\.ref/,
  "AI refs must never be passed to supabase queries"
);
console.log("PASS: unknown AI ref → 'Unknown' in display_name");

// ----------------------------------------------------------------
// 8. validateAndSanitizeResponse called on EVERY AI response
// ----------------------------------------------------------------
// The route calls validateAndSanitizeResponse before returning
const validateCallIdx = routeSrc.indexOf("validateAndSanitizeResponse(rawOutput)");
const returnIdx = routeSrc.indexOf("NextResponse.json(resolved)");
assert.ok(validateCallIdx > 0, "validateAndSanitizeResponse must be called");
assert.ok(validateCallIdx < returnIdx, "validateAndSanitizeResponse must be called before returning");
console.log("PASS: validateAndSanitizeResponse called before every return");

// ----------------------------------------------------------------
// 9. No student names/UUIDs in AI payload (buildInsightsPayload)
// ----------------------------------------------------------------
assert.match(insightsSrc, /makeRef\(/, "Must use makeRef to anonymise identifiers");
assert.match(insightsSrc, /sha256/, "Must use SHA-256 hashing");
// student_stats only contains ref (hash), not student_id or full_name
assert.doesNotMatch(insightsSrc, /student_id.*AiPayloadStudentStat|student_stats.*student_id\b/, "student_id must not appear in student stats output");
console.log("PASS: student IDs and names not in AI payload");

// ----------------------------------------------------------------
// 10. auth.getUser() called before any DB or AI operation
// ----------------------------------------------------------------
const authIdx = routeSrc.indexOf("auth.getUser()");
const captureSettingsIdx = routeSrc.indexOf("get_my_attendance_capture_settings");
assert.ok(authIdx < captureSettingsIdx, "auth.getUser must be called before capture settings check");
console.log("PASS: auth.getUser() called first");

console.log("\nAll insights route contract tests passed.");
