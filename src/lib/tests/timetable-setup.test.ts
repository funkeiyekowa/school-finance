/**
 * Static contract tests for the Timetable Setup feature
 * (supabase/20260906190000_timetable_setup_settings.sql +
 *  src/app/dashboard/setup/timetable/page.tsx +
 *  src/app/dashboard/timetable/print/page.tsx +
 *  src/components/layout/AppShell.tsx).
 *
 * Same convention as phase1-authorization.test.ts /
 * timetable-authorization.test.ts: these check that the required
 * security- and correctness-relevant source patterns exist, and
 * that this presentation-only feature has not crept into touching
 * timetable allocation data (classes/subjects/periods/
 * timetable_entries) or the existing role-scoped access controls.
 * They do NOT connect to a live database -- live Supabase
 * verification (saving settings as an admin, confirming a
 * student/teacher cannot write them, confirming the print page
 * renders with the configured options) remains required against a
 * real project.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..", "..", "..");
const migration = fs.readFileSync(path.join(root, "supabase", "20260906190000_timetable_setup_settings.sql"), "utf8");
const setupPage = fs.readFileSync(path.join(root, "src", "app", "dashboard", "setup", "timetable", "page.tsx"), "utf8");
const printPage = fs.readFileSync(path.join(root, "src", "app", "dashboard", "timetable", "print", "page.tsx"), "utf8");
const appShell = fs.readFileSync(path.join(root, "src", "components", "layout", "AppShell.tsx"), "utf8");

// 1. Required SQL contracts exist.
const requiredSqlContracts = [
  "CREATE TABLE IF NOT EXISTS public.timetable_settings",
  "timetable_settings_read",
  "timetable_settings_write",
  "get_my_timetable_settings",
];
for (const contract of requiredSqlContracts) {
  assert.match(migration, new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `missing timetable_settings contract: ${contract}`);
}

// 2. Read policy: any org member, not a wildcard, not admin-only.
const readPolicyMatch = migration.match(
  /CREATE POLICY timetable_settings_read[\s\S]*?FOR SELECT\s*\n\s*USING \(([\s\S]*?)\);/
);
assert.ok(readPolicyMatch, "timetable_settings_read policy body not found");
const readPolicyBody = readPolicyMatch![1];
assert.doesNotMatch(readPolicyBody, /USING\s*\(\s*true\s*\)/i, "read policy must not be a bare true");
assert.match(readPolicyBody, /is_org_member\(organization_id\)/, "read policy must scope to the caller's own org via is_org_member");
assert.doesNotMatch(readPolicyBody, /is_org_admin/, "read policy must not be admin-only -- students/teachers need it too for the print page");

// 3. Write policy: admin-only, org-scoped, applies to all commands.
const writePolicyMatch = migration.match(
  /CREATE POLICY timetable_settings_write[\s\S]*?FOR ALL\s*\n\s*USING \(([\s\S]*?)\)\s*\n\s*WITH CHECK \(([\s\S]*?)\);/
);
assert.ok(writePolicyMatch, "timetable_settings_write policy body not found");
assert.match(writePolicyMatch![1], /is_org_admin\(organization_id\)/, "write USING must require is_org_admin");
assert.match(writePolicyMatch![2], /is_org_admin\(organization_id\)/, "write WITH CHECK must require is_org_admin");

// 4. RLS must actually be enabled on the new table.
assert.match(migration, /ALTER TABLE public\.timetable_settings ENABLE ROW LEVEL SECURITY/);

// 5. One row per org -- unique index on organization_id.
assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS idx_timetable_settings_org\s*\n\s*ON public\.timetable_settings\(organization_id\)/);

// 6. get_my_timetable_settings scopes by the caller's own org, not a
// client-supplied id.
const rpcMatch = migration.match(/CREATE OR REPLACE FUNCTION public\.get_my_timetable_settings\(\)[\s\S]*?\$\$;/);
assert.ok(rpcMatch, "get_my_timetable_settings function body not found");
assert.match(rpcMatch![0], /current_user_org_id\(\)/, "must resolve the caller's own org server-side");
assert.doesNotMatch(rpcMatch![0], /p_org(anization)?_id/i, "must not take a client-supplied organization id parameter");

// 7. This migration must never touch timetable allocation tables or
// their policies -- presentation settings only.
const forbiddenAllocationEdits = [
  /ALTER TABLE public\.timetable_entries/,
  /ALTER TABLE public\.classes\b/,
  /ALTER TABLE public\.periods\b/,
  /ALTER TABLE public\.subjects\b/,
  /DROP POLICY[\s\S]*?timetable_entries/,
  /CREATE POLICY[\s\S]*?ON public\.timetable_entries/,
];
for (const pattern of forbiddenAllocationEdits) {
  assert.doesNotMatch(migration, pattern, `timetable setup migration must not touch timetable allocation tables/policies: ${pattern}`);
}

// 8. Setup page: admin-gated, reads via the RPC (not a raw
// unfiltered table select), and never queries allocation tables.
assert.match(setupPage, /isOrgAdmin/, "setup page must check isOrgAdmin");
assert.match(setupPage, /Only school administrators can manage timetable setup/);
assert.match(setupPage, /get_my_timetable_settings/, "setup page must load settings via the RPC");
for (const forbiddenTable of ["timetable_entries", '"classes"', '"periods"', '"subjects"']) {
  assert.doesNotMatch(setupPage, new RegExp(`from\\(${forbiddenTable.replace(/"/g, '\\"')}\\)`), `setup page must not read/write allocation table ${forbiddenTable}`);
}

// 9. Print page: still enforces role-scoped authorization
// (unchanged from fix_timetable_role_scoped_access.sql), and now
// also applies the settings RPC for presentation.
assert.match(printPage, /isPrivilegedStaff/);
assert.match(printPage, /get_my_current_class_id/, "print page must still resolve the student's class server-side");
assert.match(printPage, /teacher_assignments/, "print page must still check teacher assignment before showing a requested class");
assert.match(printPage, /setDenied\(true\)/, "print page must still deny unauthorized requested classes");
assert.match(printPage, /get_my_timetable_settings/, "print page must apply the org's timetable display/print settings");
assert.match(printPage, /DEFAULT_SETTINGS/, "print page must fall back to sane defaults when no settings row exists yet");

// 10. Nav wiring: a Timetable Setup entry under Setup, admin-only.
const navLineMatch = appShell.match(/\{ href: "\/dashboard\/setup\/timetable"[\s\S]*?\},/);
assert.ok(navLineMatch, "Timetable Setup nav entry not found in AppShell");
assert.match(navLineMatch![0], /adminOnly: true/, "Timetable Setup nav entry must be adminOnly");

console.log("Timetable setup settings contract checks passed.");
console.log("Live Supabase verification (admin can save settings, non-admin cannot, print page reflects saved settings) remains required; this test intentionally does not claim database verification.");
