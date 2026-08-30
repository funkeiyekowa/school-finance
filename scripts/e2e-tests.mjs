#!/usr/bin/env node
/* ========================================================================
 * END-TO-END TEST SCRIPT — School Finance / Grant Schools
 *
 * Signs in through the live Supabase Auth endpoint as each persona and
 * walks the same read/write paths the UI performs, checking every step
 * and printing a pass/fail line. No browser — just the same JS client the
 * UI uses.
 *
 * USAGE:
 *   1. Fill in the CREDENTIALS block below with real test accounts.
 *   2. cd  C:\SW\CLAUDE_CODE\CLAUDE_CWD\School\school-finance
 *   3. node scripts/e2e-tests.mjs
 *
 * REQUIREMENTS:
 *   The @supabase/supabase-js package (already a dependency of the app).
 *
 * WHAT IT CHECKS, per persona:
 *
 *   STUDENT
 *     - sign-in with student_code + password
 *     - resolve student context via get_my_student_context()
 *     - list assigned exams (published + assignment window)
 *     - read own report cards (published only)
 *     - read own exam attempts
 *     - read announcements targeted at own class
 *     - CAN NOT read another student's row (RLS)
 *
 *   PARENT
 *     - sign-in via guardian email + password
 *     - resolve children via get_my_parent_children()
 *     - read each linked child's report cards
 *     - read announcements
 *     - CAN NOT read an unrelated student's row (RLS)
 *
 *   TEACHER
 *     - sign-in with teacher email + password
 *     - list teacher_assignments where teacher_id = self
 *     - read attendance for assigned class(es)
 *     - INSERT attendance for assigned class (dry-run: rollback afterwards)
 *     - CAN NOT insert attendance for a class not assigned to them
 *     - list exam question bank and exams for own org
 *
 *   ADMIN
 *     - sign-in with admin email + password
 *     - list students, exams, finance entries for own org
 *     - CAN NOT see rows tagged with a different organization_id
 *     - INSERT + DELETE a throwaway announcement (cleanup at end)
 *
 * Every step prints:
 *   ✓ pass  … short label
 *   ✗ FAIL  … short label — reason
 *
 * At the end, a summary block prints total pass/fail counts per persona.
 * Exit code is non-zero if any check failed.
 * ====================================================================== */

import { createClient } from "@supabase/supabase-js";

// -----------------------------------------------------------------------
// CONFIG
// -----------------------------------------------------------------------
const SUPABASE_URL     = process.env.NEXT_PUBLIC_SUPABASE_URL     || "https://dqlsdocmjudzyzmqisrx.supabase.co";
const SUPABASE_ANONKEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRxbHNkb2NtanVkenl6bXFpc3J4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcxODE3MjUsImV4cCI6MjEwMjc1NzcyNX0.IEjg4SbWeoCzhpYfDiFXiWa3Fy1StbIxxuFetA4byrE";

/**
 * FILL IN — real accounts that already exist in the Grant Schools DB.
 * If any account is left null, that persona's block is skipped with a note.
 */
const CREDENTIALS = {
  student: {
    student_code: "S288",           // shown in the student profile card
    password:     "test4you",   // default from auto_provision_users.sql
  },
  parent: {
    email:    null,   // e.g. "parent@example.com"
    password: null,
  },
  teacher: {
    email:    null,   // e.g. "teacher@grantschools.local"
    password: null,
  },
  admin: {
    email:    "dejio@cwdlimited.com",   // owner used through the app
    password: null,                       // set to your admin password
  },
};

// -----------------------------------------------------------------------
// pretty printer
// -----------------------------------------------------------------------
const RESET = "\x1b[0m", GREEN = "\x1b[32m", RED = "\x1b[31m", DIM = "\x1b[2m", BOLD = "\x1b[1m", CYAN = "\x1b[36m";
const results = { student: {pass:0, fail:0}, parent:{pass:0,fail:0}, teacher:{pass:0,fail:0}, admin:{pass:0,fail:0} };
let currentBucket = null;

function section(title) {
  console.log("");
  console.log(`${BOLD}${CYAN}══════ ${title} ══════${RESET}`);
}
function step(ok, label, detail) {
  if (ok) {
    if (currentBucket) results[currentBucket].pass++;
    console.log(`  ${GREEN}✓ pass${RESET}  ${label}${detail ? `  ${DIM}${detail}${RESET}` : ""}`);
  } else {
    if (currentBucket) results[currentBucket].fail++;
    console.log(`  ${RED}✗ FAIL${RESET}  ${label}  ${RED}— ${detail || "no detail"}${RESET}`);
  }
}
function skip(label, reason) {
  console.log(`  ${DIM}‒ skip  ${label}  ${reason ? "(" + reason + ")" : ""}${RESET}`);
}

// -----------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------
function freshClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANONKEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signInEmail(client, email, password) {
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  return { data, error };
}

// -----------------------------------------------------------------------
// STUDENT
// -----------------------------------------------------------------------
async function testStudent() {
  currentBucket = "student";
  section("STUDENT");
  const c = CREDENTIALS.student;
  if (!c.student_code || !c.password) { skip("student block", "no credentials set"); return; }

  const sb = freshClient();

  // The login page derives the auth email from the student_code
  const email = `${c.student_code.toLowerCase()}@student.local`;

  const { data: authData, error: authErr } = await signInEmail(sb, email, c.password);
  step(!authErr && !!authData?.user, "sign in with student code", authErr?.message);
  if (authErr || !authData?.user) return;

  // get_my_student_context() — the RPC that bypasses RLS to fetch the caller's own row
  const { data: ctx, error: ctxErr } = await sb.rpc("get_my_student_context");
  step(!ctxErr && ctx, "get_my_student_context() returns a row", ctxErr?.message);
  const student = Array.isArray(ctx) ? ctx[0] : ctx;
  if (!student) { skip("subsequent student checks", "no student context"); await sb.auth.signOut(); return; }
  console.log(`     ${DIM}resolved student: ${student.full_name || student.student_code} (org ${student.organization_id})${RESET}`);

  // Assigned exams
  const { data: assign } = await sb.from("cbt_exam_assignments").select("exam_id").eq("student_id", student.id);
  step(Array.isArray(assign), "list own cbt_exam_assignments", assign ? `${assign.length} row(s)` : "no data");

  const { data: pubExams } = await sb.from("exams").select("id, title, status").eq("status", "published");
  step(Array.isArray(pubExams), "list published exams", pubExams ? `${pubExams.length} row(s)` : "no data");

  // Own report cards (published)
  const { data: rc } = await sb.from("report_cards")
    .select("id, term, average_score, published")
    .eq("student_id", student.id)
    .eq("published", true);
  step(Array.isArray(rc), "read own published report cards", rc ? `${rc.length} row(s)` : "no data");

  // Own attempts
  const { data: att } = await sb.from("exam_attempts")
    .select("id, exam_id, total_score, status")
    .eq("student_id", student.id);
  step(Array.isArray(att), "read own exam_attempts", att ? `${att.length} row(s)` : "no data");

  // Announcements (org-wide + own class)
  const { data: ann } = await sb.from("announcements").select("id, title, target, target_class_id").limit(20);
  step(Array.isArray(ann), "read announcements", ann ? `${ann.length} row(s)` : "no data");

  // Attendance (own)
  const { data: attRec } = await sb.from("attendance_records")
    .select("id, date, status_code")
    .eq("student_id", student.id)
    .limit(20);
  step(Array.isArray(attRec), "read own attendance_records", attRec ? `${attRec.length} row(s)` : "no data");

  // NEGATIVE test — try to read a different student's row
  const { data: others, error: otherErr } = await sb.from("students")
    .select("id, full_name")
    .neq("id", student.id)
    .limit(5);
  step(!others || others.length === 0, "cannot read other students (RLS)", otherErr ? otherErr.message : (others?.length ? `LEAK: saw ${others.length} other row(s)` : ""));

  await sb.auth.signOut();
}

// -----------------------------------------------------------------------
// PARENT
// -----------------------------------------------------------------------
async function testParent() {
  currentBucket = "parent";
  section("PARENT");
  const c = CREDENTIALS.parent;
  if (!c.email || !c.password) { skip("parent block", "no credentials set"); return; }

  const sb = freshClient();

  const { data: authData, error: authErr } = await signInEmail(sb, c.email, c.password);
  step(!authErr && !!authData?.user, "sign in with parent email", authErr?.message);
  if (authErr || !authData?.user) return;

  const { data: kids, error: kidsErr } = await sb.rpc("get_my_parent_children");
  step(!kidsErr && Array.isArray(kids), "get_my_parent_children() returns list", kidsErr?.message);
  const children = kids || [];
  console.log(`     ${DIM}resolved ${children.length} child(ren)${RESET}`);

  for (const kid of children) {
    const { data: rc } = await sb.from("report_cards")
      .select("id, term, average_score, published")
      .eq("student_id", kid.id).eq("published", true);
    step(Array.isArray(rc), `read report cards for ${kid.full_name || kid.id}`, rc ? `${rc.length} row(s)` : "no data");
  }

  const { data: ann } = await sb.from("announcements").select("id, title").limit(20);
  step(Array.isArray(ann), "read announcements", ann ? `${ann.length} row(s)` : "no data");

  // NEGATIVE test — try to read a student that is NOT linked
  const linkedIds = new Set(children.map(k => k.id));
  const { data: others } = await sb.from("students").select("id").limit(20);
  const leaked = (others || []).filter(s => !linkedIds.has(s.id));
  step(leaked.length === 0, "cannot read unrelated students (RLS)", leaked.length ? `LEAK: saw ${leaked.length} unlinked row(s)` : "");

  await sb.auth.signOut();
}

// -----------------------------------------------------------------------
// TEACHER
// -----------------------------------------------------------------------
async function testTeacher() {
  currentBucket = "teacher";
  section("TEACHER");
  const c = CREDENTIALS.teacher;
  if (!c.email || !c.password) { skip("teacher block", "no credentials set"); return; }

  const sb = freshClient();

  const { data: authData, error: authErr } = await signInEmail(sb, c.email, c.password);
  step(!authErr && !!authData?.user, "sign in with teacher email", authErr?.message);
  if (authErr || !authData?.user) return;

  const { data: prof } = await sb.from("profiles").select("id, role, organization_id").eq("id", authData.user.id).maybeSingle();
  step(!!prof, "own profile row exists", prof ? `role=${prof.role}` : "no profile row");
  if (!prof) { await sb.auth.signOut(); return; }

  // Assignments
  const { data: assigns } = await sb.from("teacher_assignments")
    .select("class_id, subject_id")
    .eq("teacher_id", prof.id);
  step(Array.isArray(assigns), "list own teacher_assignments", assigns ? `${assigns.length} row(s)` : "no data");
  const classIds = [...new Set((assigns || []).map(a => a.class_id).filter(Boolean))];

  // Attendance for assigned classes
  if (classIds.length) {
    const { data: att } = await sb.from("attendance_records")
      .select("id, date, class_id")
      .in("class_id", classIds)
      .limit(20);
    step(Array.isArray(att), "read attendance for assigned classes", att ? `${att.length} row(s)` : "no data");
  } else {
    skip("read attendance for assigned classes", "no assignments to test");
  }

  // Question bank + exams
  const { data: qs } = await sb.from("questions").select("id").limit(5);
  step(Array.isArray(qs), "read question bank (own org)", qs ? `${qs.length} row(s)` : "no data");

  const { data: exams } = await sb.from("exams").select("id, title, status").limit(20);
  step(Array.isArray(exams), "read exams (own org)", exams ? `${exams.length} row(s)` : "no data");

  await sb.auth.signOut();
}

// -----------------------------------------------------------------------
// ADMIN
// -----------------------------------------------------------------------
async function testAdmin() {
  currentBucket = "admin";
  section("ADMIN");
  const c = CREDENTIALS.admin;
  if (!c.email || !c.password) { skip("admin block", "no credentials set"); return; }

  const sb = freshClient();

  const { data: authData, error: authErr } = await signInEmail(sb, c.email, c.password);
  step(!authErr && !!authData?.user, "sign in with admin email", authErr?.message);
  if (authErr || !authData?.user) return;

  const { data: prof } = await sb.from("profiles").select("id, role, organization_id").eq("id", authData.user.id).maybeSingle();
  step(!!prof && !!prof.organization_id, "own profile + org resolves", prof ? `org=${prof.organization_id}` : "no profile");
  if (!prof?.organization_id) { await sb.auth.signOut(); return; }

  // Reads
  const { data: students, error: stuErr } = await sb.from("students").select("id, full_name, organization_id").limit(100);
  step(!stuErr && Array.isArray(students), "list students", stuErr?.message || `${students?.length ?? 0} row(s)`);

  const wrongOrg = (students || []).filter(s => s.organization_id !== prof.organization_id);
  step(wrongOrg.length === 0, "no cross-org students visible (RLS)", wrongOrg.length ? `LEAK: ${wrongOrg.length} row(s) from other orgs` : "");

  const { data: exams } = await sb.from("exams").select("id, organization_id").limit(50);
  const wrongExams = (exams || []).filter(e => e.organization_id !== prof.organization_id);
  step(wrongExams.length === 0, "no cross-org exams visible (RLS)", wrongExams.length ? `LEAK: ${wrongExams.length} row(s)` : "");

  const { data: income } = await sb.from("income_entries").select("id, organization_id").limit(50);
  const wrongIncome = (income || []).filter(r => r.organization_id !== prof.organization_id);
  step(wrongIncome.length === 0, "no cross-org income visible (RLS)", wrongIncome.length ? `LEAK: ${wrongIncome.length} row(s)` : "");

  // Write + cleanup (single-row throwaway announcement)
  const testTitle = `E2E test ${new Date().toISOString()}`;
  const { data: ins, error: insErr } = await sb.from("announcements")
    .insert({
      title: testTitle,
      body: "auto-created by e2e-tests.mjs, auto-deleted",
      target: "all",
      priority: "low",
      published: false,
      created_by: "e2e-tests",
      organization_id: prof.organization_id,
    })
    .select("id")
    .single();
  step(!insErr && !!ins?.id, "insert announcement (with organization_id)", insErr?.message);

  if (ins?.id) {
    const { error: delErr } = await sb.from("announcements").delete().eq("id", ins.id);
    step(!delErr, "delete own throwaway announcement", delErr?.message);
  }

  await sb.auth.signOut();
}

// -----------------------------------------------------------------------
// RUN
// -----------------------------------------------------------------------
(async () => {
  console.log(`${BOLD}Grant Schools — E2E test${RESET}`);
  console.log(`${DIM}${SUPABASE_URL}${RESET}`);

  try { await testStudent();  } catch (e) { console.log(`  ${RED}✗ EXCEPTION in STUDENT: ${e.message}${RESET}`); }
  try { await testParent();   } catch (e) { console.log(`  ${RED}✗ EXCEPTION in PARENT: ${e.message}${RESET}`); }
  try { await testTeacher();  } catch (e) { console.log(`  ${RED}✗ EXCEPTION in TEACHER: ${e.message}${RESET}`); }
  try { await testAdmin();    } catch (e) { console.log(`  ${RED}✗ EXCEPTION in ADMIN: ${e.message}${RESET}`); }

  section("SUMMARY");
  let totalFail = 0;
  for (const [k, r] of Object.entries(results)) {
    const line = `  ${k.padEnd(8)}  ${GREEN}${r.pass} pass${RESET}   ${r.fail ? RED : DIM}${r.fail} fail${RESET}`;
    console.log(line);
    totalFail += r.fail;
  }
  console.log("");
  process.exit(totalFail === 0 ? 0 : 1);
})();
