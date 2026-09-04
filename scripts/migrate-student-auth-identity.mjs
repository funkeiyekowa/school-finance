// =====================================================================
// STUDENT AUTH IDENTITY MIGRATION  (Supabase Admin API)
// =====================================================================
// Re-identifies existing synthetic student logins from the OLD global
// scheme:      <lower(code)>@student.local
// to the NEW tenant-scoped scheme:
//              <lower(code)>.<organization_id>@student.local
//
// WHY: global emails let two schools' identical student_code (e.g. S123)
// collapse onto ONE auth account (shared password/session/reset). The new
// scheme keeps the VISIBLE student_code unchanged while giving each school
// a DISTINCT auth identity keyed on the immutable organization_id.
//
// SAFETY MODEL (read this before running):
//   * DRY-RUN BY DEFAULT. Without --execute it makes ZERO changes.
//   * Uses ONLY supported Admin APIs (auth.admin.getUserById /
//     updateUserById). It does NOT run DML against auth.users /
//     auth.identities.
//   * Renaming the email does NOT change the password hash, the user id,
//     or students.profile_id — so credentials + relationships are
//     preserved. Password reset then targets the per-org account.
//   * IDEMPOTENT: accounts already on the new scheme are skipped.
//   * FAIL CLOSED: any auth uid shared across >1 org, or by >1 student,
//     or any student with a null organization_id, is QUARANTINED and
//     never touched. Nothing is guessed. No auth account is ever deleted.
//   * PREFLIGHT gate: pass --expect-clean=N --expect-quarantine=M to
//     assert the live shape before executing; mismatch aborts.
//
// USAGE:
//   node scripts/migrate-student-auth-identity.mjs                # dry run
//   node scripts/migrate-student-auth-identity.mjs --execute \
//        --expect-clean=145 --expect-quarantine=1                 # apply
//
// Requires .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// =====================================================================
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const EXECUTE = args.includes("--execute");
const argVal = (name) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split("=")[1] : undefined;
};
const expectClean = argVal("expect-clean") !== undefined ? Number(argVal("expect-clean")) : undefined;
const expectQuar = argVal("expect-quarantine") !== undefined ? Number(argVal("expect-quarantine")) : undefined;

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; })
);
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SVC = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SVC) { console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY"); process.exit(1); }

const admin = createClient(URL, SVC, { auth: { persistSession: false, autoRefreshToken: false } });

// Canonical new-scheme email — MUST match public.student_auth_email() and
// the client studentAuthEmail() byte-for-byte.
const newEmail = (code, orgId) => `${String(code).trim().toLowerCase()}.${orgId}@student.local`;
const isOldScheme = (email) => /^[^.@]+@student\.local$/i.test(email || "");    // no dot before @ = global
const isNewScheme = (email) => /^[^@]+\.[0-9a-f-]{36}@student\.local$/i.test(email || "");

async function selectAll(table, cols) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from(table).select(cols).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

(async () => {
  console.log(`=== Student auth identity migration — ${EXECUTE ? "EXECUTE" : "DRY RUN"} ===\n`);

  const students = await selectAll("students", "id,student_code,organization_id,profile_id,status");

  // Build uid -> student rows to detect shared/anomalous identities.
  const byUid = new Map();
  for (const s of students) {
    if (!s.profile_id) continue;
    if (!byUid.has(s.profile_id)) byUid.set(s.profile_id, []);
    byUid.get(s.profile_id).push(s);
  }

  const clean = [];        // {student, uid, from, to}
  const quarantine = [];   // {reason, uid, students}
  const skippedNew = [];   // already migrated

  for (const [uid, rows] of byUid.entries()) {
    // Fail closed on shared identities.
    const orgs = new Set(rows.map((r) => r.organization_id));
    if (rows.length > 1 || orgs.size > 1) {
      quarantine.push({ reason: "shared_auth_uid", uid, students: rows.map((r) => ({ id: r.id, code: r.student_code, org: r.organization_id })) });
      continue;
    }
    const s = rows[0];
    if (!s.organization_id) {
      quarantine.push({ reason: "null_organization_id", uid, students: [{ id: s.id, code: s.student_code }] });
      continue;
    }

    // Read the live auth user (supported Admin API).
    const { data: got, error } = await admin.auth.admin.getUserById(uid);
    if (error || !got?.user) {
      quarantine.push({ reason: "auth_user_missing", uid, students: [{ id: s.id, code: s.student_code }] });
      continue;
    }
    const email = got.user.email || "";

    // Only migrate accounts on the OLD global @student.local scheme.
    if (isNewScheme(email)) { skippedNew.push({ uid, email }); continue; }
    if (!isOldScheme(email)) { continue; } // real email (parent/teacher etc.) — not ours

    const to = newEmail(s.student_code, s.organization_id);
    if (email.toLowerCase() === to.toLowerCase()) { skippedNew.push({ uid, email }); continue; }
    clean.push({ student: s, uid, from: email, to });
  }

  console.log(`students with a profile_id: ${byUid.size}`);
  console.log(`already on new scheme (skip): ${skippedNew.length}`);
  console.log(`CLEAN (eligible to migrate): ${clean.length}`);
  console.log(`QUARANTINE (never auto-touched): ${quarantine.length}`);
  quarantine.forEach((q) => {
    console.log(`  ! ${q.reason} uid=${q.uid}`);
    q.students.forEach((s) => console.log(`      student=${s.id} code=${s.code}${s.org ? " org=" + s.org : ""}`));
  });

  // Preflight gate: assert expected shape before any write.
  if (expectClean !== undefined && expectClean !== clean.length) {
    console.error(`\nPREFLIGHT FAIL: expected ${expectClean} clean, found ${clean.length}. Aborting (fail closed).`);
    process.exit(2);
  }
  if (expectQuar !== undefined && expectQuar !== quarantine.length) {
    console.error(`\nPREFLIGHT FAIL: expected ${expectQuar} quarantine, found ${quarantine.length}. Aborting (fail closed).`);
    process.exit(2);
  }

  if (!EXECUTE) {
    console.log("\n--- planned renames (first 20) ---");
    clean.slice(0, 20).forEach((c) => console.log(`  ${c.from}  ->  ${c.to}   (student ${c.student.id}, code ${c.student.student_code})`));
    console.log(`\nDRY RUN complete. No changes made. Re-run with --execute (and --expect-clean=${clean.length} --expect-quarantine=${quarantine.length}) to apply.`);
    return;
  }

  console.log("\n--- EXECUTING renames via auth.admin.updateUserById ---");
  let ok = 0, fail = 0;
  for (const c of clean) {
    // Re-check just-in-time (idempotent + avoids racing another run).
    const { data: cur } = await admin.auth.admin.getUserById(c.uid);
    const curEmail = cur?.user?.email || "";
    if (isNewScheme(curEmail)) { continue; }
    if (!isOldScheme(curEmail)) { continue; }

    const { error } = await admin.auth.admin.updateUserById(c.uid, {
      email: c.to,
      email_confirm: true, // synthetic domain; keep confirmed so login works
    });
    if (error) { fail++; console.log(`  FAIL ${c.uid} ${c.from}: ${error.message}`); }
    else { ok++; if (ok <= 20) console.log(`  ok ${c.from} -> ${c.to}`); }
  }
  console.log(`\nDONE. renamed=${ok} failed=${fail} quarantined=${quarantine.length} skipped(new)=${skippedNew.length}`);
  if (fail > 0) { console.error("Some renames failed — investigate before re-running (idempotent)."); process.exit(1); }
})().catch((e) => { console.error("MIGRATION ERROR:", e.message); process.exit(1); });
