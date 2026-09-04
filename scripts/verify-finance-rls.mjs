#!/usr/bin/env node
/**
 * Post-migration verification harness for supabase/rls_finance_permission_scope.sql
 * ---------------------------------------------------------------------------------
 * Exercises the LIVE database through the authenticated Supabase REST API as
 * real signed-in users (student, teacher, bursar), so it tests the actual RLS
 * that a browser/API client hits — not just SQL-editor superuser behaviour.
 *
 * It creates a throwaway org + users + finance/payroll fixtures, runs the
 * assertions, and DELETES everything afterwards (service-role, scoped to the
 * throwaway org only). It never touches existing data.
 *
 * USAGE
 *   node scripts/verify-finance-rls.mjs            # asserts POST-migration expectations (default)
 *   node scripts/verify-finance-rls.mjs --pre      # documents PRE-migration leaks (won't fail on them)
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and
 * SUPABASE_SERVICE_ROLE_KEY from .env.local. The service-role key is used
 * ONLY for fixture setup/teardown; all access assertions use per-user JWTs.
 *
 * Exit code 0 = all assertions passed; 1 = at least one failed (CI-friendly).
 */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const MODE = process.argv.includes("--pre") ? "pre" : "post";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split(/\r?\n/).filter(l => l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const URL = env.NEXT_PUBLIC_SUPABASE_URL, SVC = env.SUPABASE_SERVICE_ROLE_KEY, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!URL || !SVC || !ANON) { console.error("Missing Supabase env vars in .env.local"); process.exit(2); }

function svcH(x = {}) { return { apikey: SVC, authorization: `Bearer ${SVC}`, "content-type": "application/json", ...x }; }
async function ins(t, rows, p = "return=representation") {
  const r = await fetch(`${URL}/rest/v1/${t}`, { method: "POST", headers: svcH({ Prefer: p }), body: JSON.stringify(rows) });
  const b = await r.text(); if (!r.ok) throw new Error(`ins ${t} ${r.status}: ${b}`); return b ? JSON.parse(b) : null;
}
async function del(t, f) { await fetch(`${URL}/rest/v1/${t}?${f}`, { method: "DELETE", headers: svcH() }); }
async function adminAuth(p, body, m = "POST") {
  const r = await fetch(`${URL}/auth/v1/${p}`, { method: m, headers: svcH(), body: body ? JSON.stringify(body) : undefined });
  const b = await r.text(); if (!r.ok) throw new Error(`auth ${p} ${r.status}: ${b}`); return b ? JSON.parse(b) : null;
}
async function signIn(email, pw) {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "content-type": "application/json" }, body: JSON.stringify({ email, password: pw }) });
  return (await r.json()).access_token;
}
/** SELECT a table AS a given user JWT so RLS applies. Returns row count (-1 = error). */
async function count(jwt, table, cols = "id") {
  const r = await fetch(`${URL}/rest/v1/${table}?select=${cols}`, { headers: { apikey: ANON, authorization: `Bearer ${jwt}` } });
  const b = await r.text(); let rows; try { rows = JSON.parse(b); } catch { return -1; }
  return Array.isArray(rows) ? rows.length : -1;
}

let failures = 0;
function assert(label, actual, expected) {
  const pass = actual === expected;
  if (!pass) failures++;
  console.log(`${pass ? "✅ PASS" : "❌ FAIL"}  ${label} — got ${actual}, expected ${expected}`);
}
function observe(label, actual, wanted) {
  // pre-mode: report without failing (documents current leaks)
  console.log(`${actual === wanted ? "✅" : "⚠️ "}  ${label} — got ${actual} (want ${wanted})`);
}

const TAG = "fr-" + randomUUID().slice(0, 8), pw = "Test-" + randomUUID();
let orgId; const u = {}; let staffId, runId;

try {
  console.log(`\n=== Finance/Payroll RLS verification (${MODE.toUpperCase()}-migration mode) ===\n`);
  orgId = (await ins("organizations", { name: `${TAG} Org`, slug: TAG }))[0].id;

  // Seed the bursar role so has_finance_access() can resolve finance perms
  // (mirrors what the Roles UI creates). Owners/admins never need this.
  await ins("roles", [{
    organization_id: orgId, name: "bursar",
    permissions: { income: true, expenses: true, receipts: true, reconciliation: true, sms_alerts: true, student_finance: true, vendors: true, reports: true, students: true, finance_overview: true },
  }], "return=minimal").catch(e => console.log("(bursar role seed skipped:", e.message.slice(0, 80), ")"));

  for (const role of ["student", "teacher", "bursar"]) {
    const email = `${TAG}-${role}@example.test`;
    const au = await adminAuth("admin/users", { email, password: pw, email_confirm: true });
    await ins("profiles", { id: au.id, email, full_name: `${TAG} ${role}`, role, active: true }, "return=minimal").catch(() => {});
    await ins("org_memberships", { user_id: au.id, organization_id: orgId, role, active: true, is_default: true }, "return=minimal").catch(() => {});
    u[role] = { id: au.id, email };
  }
  u.student.studentId = (await ins("students", { organization_id: orgId, full_name: `${TAG} student`, student_code: `${TAG}-S1`.toUpperCase(), status: "active", profile_id: u.student.id }))[0].id;

  // Fixtures across every affected table.
  await ins("expense_entries", [{ organization_id: orgId, date: "2026-01-11", amount: 3000, category: "Rent", voucher_no: `${TAG}-V1`, approved_by: "test" }], "return=minimal");
  await ins("vendors", [{ organization_id: orgId, name: `${TAG} Vendor`, vendor_code: `${TAG}-VEN` }], "return=minimal").catch(() => {});
  await ins("bank_transactions", [{ organization_id: orgId, date: "2026-01-11", amount: 3000, description: `${TAG} txn` }], "return=minimal").catch(() => {});
  await ins("sms_inbox", [{ organization_id: orgId, message_text: `${TAG} alert`, match_status: "needs_review" }], "return=minimal").catch(() => {});
  await ins("income_entries", [{ organization_id: orgId, student_id: u.student.studentId, student_name: `${TAG} student`, date: "2026-01-10", amount: 5000, category: "School Fees", receipt_no: `${TAG}-R1`, recorded_by: "test" }], "return=minimal");

  // Payroll fixtures (salary data).
  staffId = (await ins("staff_members", [{ organization_id: orgId, full_name: `${TAG} Teacher`, email: `${TAG}-t@x.test`, status: "active", salary: 250000 }]).catch(() => [{ id: null }]))[0]?.id;
  try {
    runId = (await ins("payroll_runs", [{ organization_id: orgId, period_month: 1, period_year: 2026, status: "draft" }]))[0].id;
    if (staffId) await ins("payroll_payslips", [{ organization_id: orgId, run_id: runId, staff_id: staffId, staff_name: `${TAG} Teacher`, staff_code: "T1", basic_salary: 250000, gross_pay: 250000, net_pay: 250000, lines: [] }], "return=minimal");
  } catch (e) { console.log("(payroll seed partial:", e.message.slice(0, 60), ")"); }

  for (const role of ["student", "teacher", "bursar"]) u[role].jwt = await signIn(u[role].email, pw);

  const financeTables = ["expense_entries", "vendors", "bank_transactions", "sms_inbox"];
  const payrollTables = ["payroll_components", "payroll_staff_components", "payroll_runs", "payroll_payslips"];

  if (MODE === "post") {
    console.log("-- TEACHER must see ZERO finance/payroll rows --");
    for (const t of financeTables) assert(`teacher ${t}`, await count(u.teacher.jwt, t), 0);
    for (const t of payrollTables) assert(`teacher ${t}`, await count(u.teacher.jwt, t), 0);

    console.log("\n-- STUDENT must see ZERO finance/payroll rows (own income only) --");
    for (const t of financeTables) assert(`student ${t}`, await count(u.student.jwt, t), 0);
    for (const t of payrollTables) assert(`student ${t}`, await count(u.student.jwt, t), 0);
    assert("student income_entries (own only)", await count(u.student.jwt, "income_entries"), 1);

    console.log("\n-- BURSAR must RETAIN access --");
    assert("bursar expense_entries", (await count(u.bursar.jwt, "expense_entries")) >= 1, true);
    assert("bursar vendors", (await count(u.bursar.jwt, "vendors")) >= 1, true);
    assert("bursar payroll_runs", (await count(u.bursar.jwt, "payroll_runs")) >= 1, true);
    assert("bursar income_entries", (await count(u.bursar.jwt, "income_entries")) >= 1, true);

    console.log("\n-- WRITE protection: student INSERT into expense_entries rejected --");
    const w = await fetch(`${URL}/rest/v1/expense_entries`, {
      method: "POST", headers: { apikey: ANON, authorization: `Bearer ${u.student.jwt}`, "content-type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ organization_id: orgId, date: "2026-01-12", amount: 1, category: "Hack", voucher_no: `${TAG}-HACK`, approved_by: "hacker" }),
    });
    assert("student expense INSERT blocked (403/401)", w.status === 401 || w.status === 403, true);

    console.log(`\n=== RESULT: ${failures === 0 ? "ALL PASSED ✅" : failures + " FAILURE(S) ❌"} ===`);
  } else {
    console.log("-- PRE-migration snapshot (documents leaks; does not fail) --");
    for (const t of financeTables) observe(`teacher ${t}`, await count(u.teacher.jwt, t), 0);
    for (const t of payrollTables) observe(`student ${t}`, await count(u.student.jwt, t), 0);
    observe("bursar expense_entries", (await count(u.bursar.jwt, "expense_entries")) >= 1 ? "visible" : "hidden", "visible");
    console.log("\n(PRE mode never sets a failing exit code.)");
  }
} catch (e) {
  console.error("HARNESS ERROR:", e.message); failures++;
} finally {
  if (runId) await del("payroll_payslips", `run_id=eq.${runId}`).catch(() => {});
  await del("payroll_runs", `organization_id=eq.${orgId}`).catch(() => {});
  if (staffId) await del("staff_members", `id=eq.${staffId}`).catch(() => {});
  await del("expense_entries", `organization_id=eq.${orgId}`).catch(() => {});
  await del("vendors", `organization_id=eq.${orgId}`).catch(() => {});
  await del("bank_transactions", `organization_id=eq.${orgId}`).catch(() => {});
  await del("sms_inbox", `organization_id=eq.${orgId}`).catch(() => {});
  await del("income_entries", `organization_id=eq.${orgId}`).catch(() => {});
  await del("students", `organization_id=eq.${orgId}`).catch(() => {});
  await del("roles", `organization_id=eq.${orgId}`).catch(() => {});
  for (const role of ["student", "teacher", "bursar"]) { const x = u[role]; if (!x) continue; await del("org_memberships", `user_id=eq.${x.id}`).catch(() => {}); await del("profiles", `id=eq.${x.id}`).catch(() => {}); await adminAuth(`admin/users/${x.id}`, null, "DELETE").catch(() => {}); }
  if (orgId) await del("organizations", `id=eq.${orgId}`).catch(() => {});
  console.log("(cleanup done)");
  process.exit(failures === 0 ? 0 : 1);
}
