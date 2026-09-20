/**
 * REAL tenant-isolation tests — executed against a database.
 *
 * This is the executable counterpart to `src/lib/tests/tenant-isolation.test.ts`,
 * which is a specification document: it prints "20 isolation tests defined"
 * and asserts nothing. That file is kept (it is useful documentation); this
 * one proves the behaviour.
 *
 * What this actually does:
 *   - builds two real organizations, A and B, with the service-role client
 *   - creates real auth users and SIGNS THEM IN, so every assertion below runs
 *     under that user's own JWT with RLS applied exactly as in the browser
 *   - asserts each persona can reach what it should, and CANNOT reach the
 *     other organization's rows
 *   - tears its fixtures down again
 *
 * A denied SELECT under RLS normally returns an empty set rather than an
 * error, so "zero rows" is the denial signal — see expectNoRows().
 *
 * Skips cleanly when no test database is configured.
 */

import {
  requireTestDb, adminClient, anonClient, createPersona,
  ok, expectRows, expectNoRows, expectDenied, summary,
  type TestEnv,
} from "./harness";
import type { SupabaseClient } from "@supabase/supabase-js";

const SUITE = "tenant isolation (database-backed)";
const stamp = Date.now();
const tag = `t${stamp}`;

interface OrgFixture {
  orgId: string;
  adminUserId: string;
  adminClient: SupabaseClient;
  studentUserId: string;
  studentClient: SupabaseClient;
  studentRowId: string;
}

async function makeOrg(env: TestEnv, admin: SupabaseClient, label: string): Promise<OrgFixture> {
  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .insert({ name: `${label} ${tag}`, slug: `${label.toLowerCase()}-${tag}` })
    .select("id")
    .single();
  if (orgErr || !org) throw new Error(`org ${label}: ${orgErr?.message}`);
  const orgId = (org as { id: string }).id;

  // Admin persona
  const adminP = await createPersona(env, admin, `admin-${label}-${tag}@example.test`);
  await admin.from("profiles").upsert({
    id: adminP.userId, email: `admin-${label}-${tag}@example.test`,
    full_name: `Admin ${label}`, role: "admin", active: true,
  });
  await admin.from("org_memberships").insert({
    user_id: adminP.userId, organization_id: orgId,
    role: "admin", active: true, is_default: true,
  });

  // Student persona + its student record
  const studentP = await createPersona(env, admin, `student-${label}-${tag}@example.test`);
  await admin.from("profiles").upsert({
    id: studentP.userId, email: `student-${label}-${tag}@example.test`,
    full_name: `Student ${label}`, role: "student", active: true,
  });
  await admin.from("org_memberships").insert({
    user_id: studentP.userId, organization_id: orgId,
    role: "student", active: true, is_default: true,
  });

  const { data: stu, error: stuErr } = await admin
    .from("students")
    .insert({
      student_code: `STU-${label}-${tag}`.slice(0, 40),
      full_name: `Student ${label} ${tag}`,
      organization_id: orgId,
      profile_id: studentP.userId,
      status: "active",
    })
    .select("id")
    .single();
  if (stuErr || !stu) throw new Error(`student ${label}: ${stuErr?.message}`);

  return {
    orgId,
    adminUserId: adminP.userId,
    adminClient: adminP.client,
    studentUserId: studentP.userId,
    studentClient: studentP.client,
    studentRowId: (stu as { id: string }).id,
  };
}

async function teardown(admin: SupabaseClient, orgIds: string[], userIds: string[]) {
  for (const id of orgIds) {
    // organizations cascade to memberships/students in this schema
    await admin.from("organizations").delete().eq("id", id);
  }
  for (const uid of userIds) {
    await admin.auth.admin.deleteUser(uid).catch(() => undefined);
  }
}

async function main() {
  const env = requireTestDb(SUITE);
  if (!env) return;

  const admin = adminClient(env);
  const orgIds: string[] = [];
  const userIds: string[] = [];

  try {
    console.log(`\n${SUITE}\n${"=".repeat(SUITE.length)}`);
    const A = await makeOrg(env, admin, "OrgA");
    const B = await makeOrg(env, admin, "OrgB");
    orgIds.push(A.orgId, B.orgId);
    userIds.push(A.adminUserId, A.studentUserId, B.adminUserId, B.studentUserId);

    /* ---------- Admin: own org vs other org ---------- */
    expectRows(
      await A.adminClient.from("students").select("id").eq("organization_id", A.orgId),
      "admin A CAN read students in own org"
    );
    expectNoRows(
      await A.adminClient.from("students").select("id").eq("organization_id", B.orgId),
      "admin A CANNOT read students in org B"
    );
    expectNoRows(
      await A.adminClient.from("students").select("id").eq("id", B.studentRowId),
      "admin A CANNOT read org B's student by direct id"
    );

    /* ---------- Student: self vs others ---------- */
    expectRows(
      await A.studentClient.from("students").select("id").eq("id", A.studentRowId),
      "student A CAN read own student record"
    );
    expectNoRows(
      await A.studentClient.from("students").select("id").eq("id", B.studentRowId),
      "student A CANNOT read org B's student record"
    );
    expectNoRows(
      await A.studentClient.from("organizations").select("id").eq("id", B.orgId),
      "student A CANNOT read org B's organization row"
    );

    /* ---------- Cross-org WRITE must be refused ---------- */
    expectDenied(
      await A.adminClient.from("students").insert({
        student_code: `X-${tag}`, full_name: "Injected", organization_id: B.orgId, status: "active",
      }),
      "admin A CANNOT insert a student into org B"
    );
    expectDenied(
      await A.adminClient.from("students").update({ full_name: "Hijacked" }).eq("id", B.studentRowId).select(),
      "admin A CANNOT update org B's student"
    );

    /* ---------- Student must not escalate ---------- */
    expectDenied(
      await A.studentClient.from("org_memberships").update({ role: "admin" }).eq("user_id", A.studentUserId).select(),
      "student A CANNOT promote self to admin"
    );

    /* ---------- Anonymous must see nothing ---------- */
    const anon = anonClient(env);
    expectNoRows(
      await anon.from("students").select("id"),
      "anonymous CANNOT read any students"
    );
    expectNoRows(
      await anon.from("organizations").select("id"),
      "anonymous CANNOT read any organizations"
    );

    /* ---------- current_user_org_id resolves per-caller ---------- */
    const { data: aOrg } = await A.adminClient.rpc("current_user_org_id");
    const { data: bOrg } = await B.adminClient.rpc("current_user_org_id");
    ok(aOrg === A.orgId, "current_user_org_id() returns org A for admin A");
    ok(bOrg === B.orgId, "current_user_org_id() returns org B for admin B");
    ok(aOrg !== bOrg, "current_user_org_id() differs between the two orgs");

    /* ---------- is_org_admin is org-scoped ---------- */
    const { data: aOwn } = await A.adminClient.rpc("is_org_admin", { p_org: A.orgId });
    const { data: aOther } = await A.adminClient.rpc("is_org_admin", { p_org: B.orgId });
    ok(aOwn === true, "is_org_admin(own org) is true for admin A");
    ok(aOther === false, "is_org_admin(other org) is FALSE for admin A — the cross-tenant guard");
  } finally {
    await teardown(admin, orgIds, userIds);
  }

  summary(SUITE);
}

main().catch((e) => {
  console.error(`\n${SUITE} crashed: ${(e as Error).message}`);
  process.exit(1);
});
