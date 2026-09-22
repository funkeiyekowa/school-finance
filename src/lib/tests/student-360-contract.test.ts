import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..", "..", "..");
const route = fs.readFileSync(
  path.join(root, "src", "app", "api", "students", "360", "route.ts"),
  "utf8",
);

assert.match(route, /requireStaffSessionWithOrg\(\{ permission: "students" \}\)/);
assert.match(route, /\.eq\("organization_id", organizationId\)/);
assert.match(route, /\.eq\("id", studentId\)/);
assert.match(route, /\.eq\("student_id", studentId\)/);
assert.match(route, /A valid student_id is required/);
assert.match(route, /Student not found/);
assert.match(route, /unavailableSections/);
assert.match(route, /lookbackDays/);
assert.match(route, /subjectPerformance/);

// Sensitive domains must never be added to this broad summary contract.
for (const forbidden of [
  "guardian_email",
  "guardian_phone",
  "address",
  "date_of_birth",
  "medical_records",
  "clinic_visits",
  "safeguarding",
]) {
  assert.doesNotMatch(route, new RegExp(`select\\([^)]*${forbidden}`), `broad Student 360 query exposes ${forbidden}`);
}

// The endpoint must not use a service-role client or trust an org supplied by the browser.
assert.doesNotMatch(route, /SUPABASE_SERVICE_ROLE_KEY/);
assert.doesNotMatch(route, /searchParams\.get\(["']organization_id/);

console.log("Student 360 contract checks passed: tenant scope, field minimization, and partial-data behavior are present.");
console.log("Live Supabase persona and cross-tenant tests remain required before production sign-off.");
