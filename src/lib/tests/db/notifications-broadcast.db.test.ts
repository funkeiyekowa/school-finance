/**
 * Focused database-backed test for get_broadcast_recipients() -- the one
 * new security-relevant behavior introduced by the Notifications feature
 * (supabase/notification_delivery_rpcs.sql).
 *
 * The function is SECURITY DEFINER, so this proves it enforces its OWN
 * authorization (admin + org-scoped) rather than relying on the caller
 * already being trusted -- exactly the class of bug the admin RPCs fixed
 * in fix_cross_tenant_admin_rpcs.sql were guarding against.
 *
 * Skips cleanly when no test database is configured, or when this
 * migration has not been applied to the target database (this feature is
 * unmerged; the function may not exist yet on whatever database is
 * pointed at).
 */

import {
  requireTestDb, adminClient, createPersona,
  ok, expectDenied, summary,
} from "./harness";

const SUITE = "notifications broadcast recipients (database-backed)";
const tag = `nb${Date.now()}`;

async function main() {
  const env = requireTestDb(SUITE);
  if (!env) return;

  const admin = adminClient(env);
  const orgIds: string[] = [];
  const userIds: string[] = [];

  try {
    console.log(`\n${SUITE}\n${"=".repeat(SUITE.length)}`);

    // Probe: does this database have the function at all?
    const probe = await admin.rpc("get_broadcast_recipients", { p_scope: "all", p_class_id: null });
    if (probe.error && (probe.error as { code?: string }).code === "PGRST202") {
      console.log("  SKIP  get_broadcast_recipients not applied to this database (Notifications feature)");
      return;
    }

    const mk = async (label: string) => {
      const { data, error } = await admin
        .from("organizations")
        .insert({ name: `${label} ${tag}`, slug: `${label.toLowerCase()}-${tag}` })
        .select("id").single();
      if (error || !data) throw new Error(`org ${label}: ${error?.message}`);
      return (data as { id: string }).id;
    };
    const orgA = await mk("NbOrgA");
    const orgB = await mk("NbOrgB");
    orgIds.push(orgA, orgB);

    const enrol = async (orgId: string, uid: string, role: string, email: string, name: string) => {
      await admin.from("profiles").upsert({ id: uid, email, full_name: name, role, active: true, phone: "+2348000000000" });
      await admin.from("org_memberships").insert({ user_id: uid, organization_id: orgId, role, active: true, is_default: true });
    };

    const adminA = await createPersona(env, admin, `nb-admina-${tag}@example.test`);
    userIds.push(adminA.userId);
    await enrol(orgA, adminA.userId, "admin", `nb-admina-${tag}@example.test`, "Admin A");

    const teacherA = await createPersona(env, admin, `nb-teachera-${tag}@example.test`);
    userIds.push(teacherA.userId);
    await enrol(orgA, teacherA.userId, "teacher", `nb-teachera-${tag}@example.test`, "Teacher A");
    // A second, non-staff member of org A, so "all" has someone for the admin
    // to legitimately reach, and so we can prove a non-admin is refused
    // regardless of whether recipients exist.
    const parentA = await createPersona(env, admin, `nb-parenta-${tag}@example.test`);
    userIds.push(parentA.userId);
    await enrol(orgA, parentA.userId, "parent", `nb-parenta-${tag}@example.test`, "Parent A");

    const adminB = await createPersona(env, admin, `nb-adminb-${tag}@example.test`);
    userIds.push(adminB.userId);
    await enrol(orgB, adminB.userId, "admin", `nb-adminb-${tag}@example.test`, "Admin B");

    // Positive: org A's own admin can resolve org A's recipients.
    const { data: rowsA, error: errA } = await adminA.client.rpc("get_broadcast_recipients", {
      p_scope: "all", p_class_id: null,
    });
    ok(!errA, `admin A CAN call get_broadcast_recipients for their own org (error: ${errA?.message ?? "none"})`);
    const idsA = Array.isArray(rowsA) ? (rowsA as { user_id: string }[]).map((r) => r.user_id) : [];
    ok(idsA.includes(parentA.userId), "get_broadcast_recipients('all') includes another member of the SAME org");
    ok(!idsA.includes(adminB.userId), "get_broadcast_recipients('all') does NOT include a member of a DIFFERENT org");

    // Negative: a non-admin staff member (teacher) of the SAME org is refused.
    expectDenied(
      await teacherA.client.rpc("get_broadcast_recipients", { p_scope: "all", p_class_id: null }),
      "teacher (not an org admin) CANNOT call get_broadcast_recipients"
    );

    // Negative: a non-staff member (parent) is refused.
    expectDenied(
      await parentA.client.rpc("get_broadcast_recipients", { p_scope: "all", p_class_id: null }),
      "parent (not staff) CANNOT call get_broadcast_recipients"
    );

    // Tenant isolation: org B's admin resolving "all" must never see org A's
    // people, and vice versa -- the function is SECURITY DEFINER, so this is
    // exactly the case that would leak silently if it only trusted the
    // caller's claimed org rather than resolving current_user_org_id() itself.
    const { data: rowsB } = await adminB.client.rpc("get_broadcast_recipients", { p_scope: "all", p_class_id: null });
    const idsB = Array.isArray(rowsB) ? (rowsB as { user_id: string }[]).map((r) => r.user_id) : [];
    ok(!idsB.includes(parentA.userId), "admin B's recipients do NOT include org A's parent (tenant isolation)");
    ok(!idsB.includes(teacherA.userId), "admin B's recipients do NOT include org A's teacher (tenant isolation)");

    // Positive: contact details (phone/email) are actually populated, since
    // that is the entire point of this function existing separately from
    // broadcast_announcement_to_inbox (which resolves conversation members,
    // not contact info).
    const parentRow = (rowsA as { user_id: string; phone: string | null; email: string | null }[] | null)
      ?.find((r) => r.user_id === parentA.userId);
    ok(
      !!parentRow?.email && !!parentRow?.phone,
      "get_broadcast_recipients returns actual phone/email for a resolved recipient"
    );
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
