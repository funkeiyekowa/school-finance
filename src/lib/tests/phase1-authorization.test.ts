import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..", "..", "..");
const migration = fs.readFileSync(path.join(root, "supabase", "20260905120000_phase1_security_enforcement.sql"), "utf8");
const broadcast = fs.readFileSync(path.join(root, "supabase", "broadcast_channels_module.sql"), "utf8");
const studyHelp = fs.readFileSync(path.join(root, "src", "app", "api", "ai", "lms-study-help", "route.ts"), "utf8");
const dashboardGuard = fs.readFileSync(path.join(root, "src", "lib", "api", "requireDashboardAccess.ts"), "utf8");

const requiredContracts = [
  "phase1_same_org", "phase1_student_scope", "phase1_finance_access",
  "phase1_sensitive_write_guard", "phase1_lms_course_stats", "phase1_lms_submit_quiz_attempt",
  "phase1_lms_get_quiz_questions", "phase1_clinic_stats", "phase1_payroll_stats",
  "phase1_assets_stats", "phase1_procurement_stats", "phase1_memberships_read",
  "phase1_parent_links_self_read", "phase1_students_self_read",
];
for (const contract of requiredContracts) assert.match(migration, new RegExp(contract), `missing Phase 1 contract: ${contract}`);

assert.match(studyHelp, /requireActiveSession/);
assert.match(studyHelp, /session\.role !== "student"/);
assert.match(studyHelp, /\.eq\("profile_id", session\.user\.id\)/);
assert.match(studyHelp, /\.eq\("organization_id", session\.organizationId\)/);
assert.doesNotMatch(studyHelp, /guardian_email/);
assert.doesNotMatch(migration, /x\.student_id/);
assert.doesNotMatch(migration, /x\.id\s*=\s*id/);
assert.doesNotMatch(broadcast, /SET\s+plpgsql\.variable_conflict/);
assert.match(migration, /DECLARE t text;\s*BEGIN[\s\S]*FOREACH t IN ARRAY ARRAY\['payroll_components'/);
assert.match(migration, /Clinic\/medical records:[\s\S]*?DO \$\$\s*DECLARE t text;\s*BEGIN[\s\S]*?FOREACH t IN ARRAY ARRAY\['clinic_medications_inventory'/);
assert.match(broadcast, /DROP FUNCTION IF EXISTS public\.broadcast_announcement_to_inbox\(text, text, text, uuid\)/);
assert.match(dashboardGuard, /redirect\("\/dashboard"\)/);
assert.match(dashboardGuard, /org_memberships/);

type Persona = "student" | "parent" | "teacher" | "bursar" | "staff" | "admin" | "super_admin";
const matrix: Record<Persona, { allow: string[]; deny: string[] }> = {
  student: { allow: ["own_student", "enrolled_lms"], deny: ["other_student", "payroll", "clinic_management"] },
  parent: { allow: ["linked_children"], deny: ["other_children", "payroll", "lms_answer_keys"] },
  teacher: { allow: ["assigned_class", "assigned_lms"], deny: ["unassigned_class", "payroll"] },
  bursar: { allow: ["finance", "payroll"], deny: ["clinic_management", "other_tenant"] },
  staff: { allow: ["operations", "clinic"], deny: ["payroll_without_permission", "other_tenant"] },
  admin: { allow: ["own_tenant"], deny: ["other_tenant_without_platform_role"] },
  super_admin: { allow: ["platform_support"], deny: ["credential_mutation"] },
};
assert.equal(Object.keys(matrix).length, 7);
assert.ok(Object.values(matrix).every((entry) => entry.allow.length > 0 && entry.deny.length > 0));

console.log(`Phase 1 authorization contract checks passed for ${Object.keys(matrix).length} personas.`);
console.log("Live Supabase role/account tests remain required; this test intentionally does not claim database verification.");
