/**
 * REAL persona authorization tests — executed against a database.
 *
 * Covers the boundaries the audit listed as unverified: parent→linked child,
 * teacher scope, finance role gating, and the admin password-reset RPC. Every
 * assertion runs under a real signed-in user's JWT, so RLS applies exactly as
 * it does in the browser.
 *
 * Complements tenant-isolation.db.test.ts (admin / student / anonymous).
 *
 * RPCs that only exist once an unmerged PR's migration has been applied are
 * probed first and SKIPPED if absent, so this suite is safe to run against a
 * database that has not had PR #11/#12/#13 applied. A skipped RPC is reported
 * as skipped — never as a pass.
 *
 * Skips cleanly when no test database is configured.
 */

import {
  requireTestDb, adminClient, createPersona,
  ok, expectRows, expectNoRows, expectDenied, expectAllowed, expectUpdateBlocked, summary,
  type TestEnv,
} from "./harness";
import type { SupabaseClient } from "@supabase/supabase-js";

const SUITE = "persona authorization (database-backed)";
const tag = `p${Date.now()}`;

/** True when the RPC exists on this database. */
async function rpcExists(client: SupabaseClient, name: string, args: Record<string, unknown>) {
  const { error } = await client.rpc(name, args);
  // PGRST202 = function not found in the schema cache.
  return !(error && (error as { code?: string }).code === "PGRST202");
}

function skip(label: string, why: string) {
  console.log(`  SKIP  ${label} — ${why}`);
}

async function main() {
  const env = requireTestDb(SUITE);
  if (!env) return;

  const admin = adminClient(env);
  const orgIds: string[] = [];
  const userIds: string[] = [];

  try {
    console.log(`\n${SUITE}\n${"=".repeat(SUITE.length)}`);

    /* ---------------- fixtures: two orgs ---------------- */
    const mk = async (label: string) => {
      const { data, error } = await admin
        .from("organizations")
        .insert({ name: `${label} ${tag}`, slug: `${label.toLowerCase()}-${tag}` })
        .select("id").single();
      if (error || !data) throw new Error(`org ${label}: ${error?.message}`);
      return (data as { id: string }).id;
    };
    const orgA = await mk("PorgA");
    const orgB = await mk("PorgB");
    orgIds.push(orgA, orgB);

    const enrol = async (orgId: string, uid: string, role: string, email: string, name: string) => {
      await admin.from("profiles").upsert({ id: uid, email, full_name: name, role, active: true });
      await admin.from("org_memberships").insert({
        user_id: uid, organization_id: orgId, role, active: true, is_default: true,
      });
    };

    const mkStudent = async (orgId: string, code: string, profileId: string | null) => {
      const { data, error } = await admin.from("students").insert({
        student_code: code, full_name: `Student ${code}`,
        organization_id: orgId, profile_id: profileId, status: "active",
      }).select("id").single();
      if (error || !data) throw new Error(`student ${code}: ${error?.message}`);
      return (data as { id: string }).id;
    };

    // Org A: parent linked to child1; child2 unlinked. Teacher. Bursar. Admin.
    const child1 = await mkStudent(orgA, `C1-${tag}`, null);
    const child2 = await mkStudent(orgA, `C2-${tag}`, null);
    const childB = await mkStudent(orgB, `CB-${tag}`, null);

    const parent = await createPersona(env, admin, `parent-${tag}@example.test`);
    userIds.push(parent.userId);
    await enrol(orgA, parent.userId, "parent", `parent-${tag}@example.test`, "Parent A");

    const { data: pp, error: ppErr } = await admin.from("parent_profiles").insert({
      profile_id: parent.userId, organization_id: orgA, full_name: "Parent A",
    }).select("id").single();
    if (ppErr || !pp) throw new Error(`parent_profiles: ${ppErr?.message}`);
    await admin.from("parent_student_links").insert({
      parent_id: (pp as { id: string }).id, student_id: child1, organization_id: orgA,
    });

    const teacher = await createPersona(env, admin, `teacher-${tag}@example.test`);
    userIds.push(teacher.userId);
    await enrol(orgA, teacher.userId, "teacher", `teacher-${tag}@example.test`, "Teacher A");

    const bursar = await createPersona(env, admin, `bursar-${tag}@example.test`);
    userIds.push(bursar.userId);
    await enrol(orgA, bursar.userId, "bursar", `bursar-${tag}@example.test`, "Bursar A");

    const adminA = await createPersona(env, admin, `admina-${tag}@example.test`);
    userIds.push(adminA.userId);
    await enrol(orgA, adminA.userId, "admin", `admina-${tag}@example.test`, "Admin A");

    const adminB = await createPersona(env, admin, `adminb-${tag}@example.test`);
    userIds.push(adminB.userId);
    await enrol(orgB, adminB.userId, "admin", `adminb-${tag}@example.test`, "Admin B");

    /* ---------------- PARENT ---------------- */
    const linked = await parent.client.rpc("my_linked_student_ids");
    const linkedIds = Array.isArray(linked.data)
      ? (linked.data as { student_id: string }[]).map((r) => r.student_id)
      : [];
    ok(linkedIds.includes(child1), "parent: my_linked_student_ids() includes the linked child");
    ok(!linkedIds.includes(child2), "parent: my_linked_student_ids() EXCLUDES an unlinked child in same org");
    ok(!linkedIds.includes(childB), "parent: my_linked_student_ids() EXCLUDES another org's student");

    expectRows(
      await parent.client.from("students").select("id").eq("id", child1),
      "parent CAN read their linked child"
    );
    expectNoRows(
      await parent.client.from("students").select("id").eq("id", child2),
      "parent CANNOT read an unlinked child in the same org"
    );
    expectNoRows(
      await parent.client.from("students").select("id").eq("id", childB),
      "parent CANNOT read another org's student"
    );

    /* ---------------- TEACHER ---------------- */
    expectNoRows(
      await teacher.client.from("students").select("id").eq("id", childB),
      "teacher CANNOT read another org's student"
    );
    // UPDATE blocked by RLS matches zero rows and returns {data:[], error:null}
    // -- see expectUpdateBlocked()'s doc comment. Confirmed with a
    // service-role read, not just the client's empty response.
    expectUpdateBlocked(
      await teacher.client.from("org_memberships")
        .update({ role: "admin" }).eq("user_id", teacher.userId).select(),
      "teacher CANNOT promote self to admin"
    );
    const { data: teacherRoleCheck } = await admin
      .from("org_memberships").select("role")
      .eq("user_id", teacher.userId).eq("organization_id", orgA).single();
    ok(
      (teacherRoleCheck as { role: string } | null)?.role === "teacher",
      "teacher's blocked self-escalation did NOT actually change their role (verified via service role)"
    );

    /* ---------------- FINANCE ---------------- */
    // Two income entries: one for the parent's OWN linked child (child1),
    // one for a DIFFERENT child in the same org (child2). This matters:
    // phase1_income_self_read (20260905120000_phase1_security_enforcement.sql)
    // deliberately grants a parent/student read access to income_entries
    // where student_id IN my_linked_student_ids() -- a parent is meant to see
    // their own child's fee/payment history. That is a designed feature, not
    // a hole, and the real boundary to test is narrower than "no access to
    // the ledger at all": self-read yes, anyone-else's entries no.
    const { data: incChild1, error: incErr1 } = await admin.from("income_entries").insert({
      receipt_no: `RCT-C1-${tag}`, date: new Date().toISOString().slice(0, 10),
      category: "School Fees", amount: 1000, payment_method: "Cash",
      organization_id: orgA, student_id: child1,
    }).select("id").single();
    const { data: incChild2, error: incErr2 } = await admin.from("income_entries").insert({
      receipt_no: `RCT-C2-${tag}`, date: new Date().toISOString().slice(0, 10),
      category: "School Fees", amount: 1000, payment_method: "Cash",
      organization_id: orgA, student_id: child2,
    }).select("id").single();

    if (incErr1 || incErr2) {
      skip("finance fixtures", `could not seed income_entries: ${incErr1?.message ?? incErr2?.message}`);
    } else {
      ok(!!incChild1 && !!incChild2, "finance: seeded income entries in org A");
      expectNoRows(
        await adminB.client.from("income_entries").select("id").eq("organization_id", orgA),
        "admin B CANNOT read org A's income entries"
      );
      expectRows(
        await parent.client.from("income_entries").select("id").eq("id", (incChild1 as { id: string }).id),
        "parent CAN read the income entry for their OWN linked child (designed self-service read)"
      );
      expectNoRows(
        await parent.client.from("income_entries").select("id").eq("id", (incChild2 as { id: string }).id),
        "parent CANNOT read an income entry for a DIFFERENT child in the same org"
      );
      expectRows(
        await bursar.client.from("income_entries").select("id").eq("organization_id", orgA),
        "bursar CAN read own org's income entries"
      );
    }

    /* ---------------- PASSWORD / ADMIN OPERATION ---------------- */
    const pwArgs = { p_user_id: teacher.userId, p_org: orgA };
    if (!(await rpcExists(admin, "admin_reset_user_password", pwArgs))) {
      skip("admin_reset_user_password", "not applied to this database (PR #10 migration)");
    } else {
      expectDenied(
        await parent.client.rpc("admin_reset_user_password", pwArgs),
        "parent CANNOT reset another user's password"
      );
      expectDenied(
        await teacher.client.rpc("admin_reset_user_password", pwArgs),
        "teacher CANNOT reset another user's password"
      );
      expectDenied(
        await adminB.client.rpc("admin_reset_user_password", pwArgs),
        "admin of org B CANNOT reset an org A user's password (cross-tenant)"
      );
      expectAllowed(
        await adminA.client.rpc("admin_reset_user_password", pwArgs),
        "admin of org A CAN reset an org A user's password"
      );
    }

    /* ---------------- PR #12: parent course enrolment ---------------- */
    const enrolArgs = { p_course_id: child1, p_student_id: child1 }; // ids are placeholders
    if (!(await rpcExists(admin, "enrol_my_child_in_course", enrolArgs))) {
      skip("enrol_my_child_in_course", "not applied to this database (PR #12 migration)");
    } else {
      expectDenied(
        await parent.client.rpc("enrol_my_child_in_course", {
          p_course_id: child1, p_student_id: childB,
        }),
        "parent CANNOT enrol another org's student"
      );
      expectDenied(
        await parent.client.rpc("enrol_my_child_in_course", {
          p_course_id: child1, p_student_id: child2,
        }),
        "parent CANNOT enrol an unlinked child"
      );
    }

    /* ---------------- PR #13: admissions ---------------- */
    if (!(await rpcExists(admin, "admit_application", { p_application_id: child1 }))) {
      skip("admit_application", "not applied to this database (PR #13 migration)");
    } else {
      expectDenied(
        await parent.client.rpc("admit_application", { p_application_id: child1 }),
        "parent CANNOT run the admissions admit operation"
      );
    }

    /* ---------------- PR #11: grievances ---------------- */
    const { error: grvProbe } = await admin.from("grievances").select("id").limit(1);
    if (grvProbe && (grvProbe as { code?: string }).code === "PGRST205") {
      skip("grievances RLS", "table not applied to this database (PR #11 migration)");
    } else {
      const { data: g } = await admin.from("grievances").insert({
        organization_id: orgA, raised_by: parent.userId, student_id: child1,
        subject: `probe ${tag}`, category: "academic", status: "submitted",
      }).select("id").single();
      if (g) {
        expectRows(
          await parent.client.from("grievances").select("id").eq("id", (g as { id: string }).id),
          "grievances: raiser CAN read their own grievance"
        );
        expectNoRows(
          await adminB.client.from("grievances").select("id").eq("id", (g as { id: string }).id),
          "grievances: admin of org B CANNOT read org A's grievance"
        );
      }
    }
  } finally {
    for (const id of orgIds) await admin.from("organizations").delete().eq("id", id);
    for (const uid of userIds) await admin.auth.admin.deleteUser(uid).catch(() => undefined);
  }

  summary(SUITE);
}

main().catch((e) => {
  console.error(`\n${SUITE} crashed: ${(e as Error).message}`);
  process.exit(1);
});
