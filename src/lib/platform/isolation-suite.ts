/**
 * Executable tenant-isolation suite.
 *
 * This is not a specification document — it provisions two throwaway schools,
 * signs in as a real user of each, and then genuinely attempts cross-tenant
 * reads and writes through the ordinary Supabase client. If row-level security
 * is misconfigured, these assertions fail.
 *
 * Why real sessions: RLS resolves the tenant through current_user_org_id(),
 * which reads auth.uid(). A service-role client bypasses RLS entirely, so
 * testing with one would prove nothing. Every assertion below runs on an
 * anon-key client carrying a genuine JWT.
 *
 * All fixtures are namespaced with an "__isotest" marker and removed in a
 * finally block, including on failure.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface TestResult {
  id: string;
  name: string;
  /** What a correct system must do. */
  expectation: string;
  status: "pass" | "fail" | "skip" | "error";
  detail?: string;
  severity: "critical" | "high" | "medium";
}

export interface SuiteReport {
  ran: boolean;
  reason?: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  results: TestResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    errored: number;
    criticalFailures: number;
    allPass: boolean;
  };
  cleanup: { ok: boolean; detail?: string };
}

const MARKER = "__isotest";

function tag(): string {
  return Math.random().toString(36).slice(2, 8);
}

export async function runIsolationSuite(opts: {
  supabaseUrl: string;
  serviceRoleKey: string;
  anonKey: string;
}): Promise<SuiteReport> {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const results: TestResult[] = [];

  const record = (r: TestResult) => { results.push(r); };

  const pass = (id: string, name: string, expectation: string, severity: TestResult["severity"], detail?: string) =>
    record({ id, name, expectation, status: "pass", severity, detail });
  const fail = (id: string, name: string, expectation: string, severity: TestResult["severity"], detail: string) =>
    record({ id, name, expectation, status: "fail", severity, detail });

  const admin = createClient(opts.supabaseUrl, opts.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const run = tag();
  const orgASlug = `isotest-a-${run}`;
  const orgBSlug = `isotest-b-${run}`;
  const emailA = `isotest-a-${run}@isolation.test`;
  const emailB = `isotest-b-${run}@isolation.test`;
  const password = `Iso!${run}Aa1${tag()}`;

  let orgA = "";
  let orgB = "";
  let userA = "";
  let userB = "";
  let studentB = "";
  let incomeB = "";
  const sharedStudentCode = `ISO-${run}`;
  const sharedReceiptNo = `ISORCT-${run}`;

  let clientA: SupabaseClient | null = null;
  let cleanupOk = true;
  let cleanupDetail: string | undefined;

  try {
    // ---------- Provision two schools ----------
    const { data: createdA, error: orgAErr } = await admin
      .from("organizations")
      .insert({ name: `${MARKER} School A ${run}`, slug: orgASlug, status: "active", plan: "premium" })
      .select("id").single();
    if (orgAErr || !createdA) {
      throw new Error(`Could not create test org A: ${orgAErr?.message ?? "no row returned"}`);
    }
    orgA = createdA.id;

    const { data: createdB, error: orgBErr } = await admin
      .from("organizations")
      .insert({ name: `${MARKER} School B ${run}`, slug: orgBSlug, status: "active", plan: "starter" })
      .select("id").single();
    if (orgBErr || !createdB) {
      throw new Error(`Could not create test org B: ${orgBErr?.message ?? "no row returned"}`);
    }
    orgB = createdB.id;

    // Entitlements: A gets the finance + students + cbt modules, B only core.
    // This lets us verify entitlements are per-tenant too.
    await admin.from("subscriptions").insert([
      { organization_id: orgA, module_key: "finance", status: "active" },
      { organization_id: orgA, module_key: "students", status: "active" },
      { organization_id: orgA, module_key: "cbt", status: "active" },
      { organization_id: orgB, module_key: "finance", status: "active" },
      { organization_id: orgB, module_key: "students", status: "active" },
    ]);

    // ---------- Two real user accounts ----------
    const mk = async (email: string) => {
      const { data, error } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
      });
      if (error || !data.user) throw new Error(`Could not create user ${email}: ${error?.message}`);
      return data.user.id;
    };
    userA = await mk(emailA);
    userB = await mk(emailB);

    // Profiles may already exist via a signup trigger; upsert to be safe.
    await admin.from("profiles").upsert([
      { id: userA, email: emailA, full_name: `${MARKER} User A`, role: "admin", active: true },
      { id: userB, email: emailB, full_name: `${MARKER} User B`, role: "admin", active: true },
    ], { onConflict: "id" });

    // Memberships bind each user to exactly one school.
    await admin.from("org_memberships").delete().in("user_id", [userA, userB]);
    await admin.from("org_memberships").insert([
      { user_id: userA, organization_id: orgA, role: "admin", is_default: true, active: true },
      { user_id: userB, organization_id: orgB, role: "admin", is_default: true, active: true },
    ]);

    // ---------- Seed tenant data with the service role ----------
    const { data: stuA } = await admin.from("students").insert({
      student_code: sharedStudentCode, full_name: `${MARKER} Alice A`,
      organization_id: orgA, status: "active",
    }).select("id").single();

    const { data: stuB, error: stuBErr } = await admin.from("students").insert({
      student_code: `${sharedStudentCode}-B`, full_name: `${MARKER} Bob B`,
      organization_id: orgB, status: "active",
    }).select("id").single();
    if (stuBErr) throw new Error(`Could not seed student in org B: ${stuBErr.message}`);
    studentB = stuB?.id ?? "";

    const { data: incB } = await admin.from("income_entries").insert({
      receipt_no: `${sharedReceiptNo}-B`, date: new Date().toISOString().slice(0, 10),
      category: "School Fees", amount: 50000, student_name: `${MARKER} Bob B`,
      organization_id: orgB,
    }).select("id").single();
    incomeB = incB?.id ?? "";

    await admin.from("income_entries").insert({
      receipt_no: `${sharedReceiptNo}-A`, date: new Date().toISOString().slice(0, 10),
      category: "School Fees", amount: 25000, student_name: `${MARKER} Alice A`,
      organization_id: orgA,
    });

    await admin.from("vendors").insert([
      { vendor_code: `ISOV-${run}-A`, name: `${MARKER} Vendor A`, organization_id: orgA },
      { vendor_code: `ISOV-${run}-B`, name: `${MARKER} Vendor B`, organization_id: orgB },
    ]);

    await admin.from("expense_entries").insert([
      { voucher_no: `ISOVCH-${run}-A`, date: new Date().toISOString().slice(0, 10),
        category: "Utilities", amount: 1000, organization_id: orgA },
      { voucher_no: `ISOVCH-${run}-B`, date: new Date().toISOString().slice(0, 10),
        category: "Utilities", amount: 2000, organization_id: orgB },
    ]);

    // ---------- Sign in as School A's user ----------
    clientA = createClient(opts.supabaseUrl, opts.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: signInErr } = await clientA.auth.signInWithPassword({ email: emailA, password });
    if (signInErr) throw new Error(`Could not sign in as test user A: ${signInErr.message}`);

    // T-001 — the session resolves to School A
    {
      const { data, error } = await clientA.rpc("current_user_org_id");
      if (error) {
        fail("T-001", "Session resolves to its own tenant",
          "current_user_org_id() returns School A's id", "critical", error.message);
      } else if (data === orgA) {
        pass("T-001", "Session resolves to its own tenant",
          "current_user_org_id() returns School A's id", "critical");
      } else {
        fail("T-001", "Session resolves to its own tenant",
          "current_user_org_id() returns School A's id", "critical",
          `Returned ${String(data)}, expected ${orgA}`);
      }
    }

    // Reads: for each tenant table, School A must see its own rows and
    // none of School B's.
    const tables = [
      "students", "income_entries", "expense_entries", "vendors",
    ] as const;

    let n = 1;
    for (const table of tables) {
      const idx = String(++n).padStart(3, "0");

      const { data: own, error: ownErr } = await clientA
        .from(table).select("id, organization_id").eq("organization_id", orgA);
      if (ownErr) {
        fail(`T-${idx}a`, `Can read own ${table}`,
          "School A sees its own rows", "high", ownErr.message);
      } else if ((own ?? []).length > 0) {
        pass(`T-${idx}a`, `Can read own ${table}`,
          "School A sees its own rows", "high", `${own!.length} row(s) visible`);
      } else {
        fail(`T-${idx}a`, `Can read own ${table}`,
          "School A sees its own rows", "high",
          "No rows visible — policies may be too restrictive");
      }

      // Explicitly ask for the other tenant's rows.
      const { data: foreign, error: foreignErr } = await clientA
        .from(table).select("id, organization_id").eq("organization_id", orgB);
      if (foreignErr) {
        pass(`T-${idx}b`, `Cannot read School B's ${table}`,
          "Query for the other tenant returns nothing", "critical",
          `Rejected: ${foreignErr.message}`);
      } else if ((foreign ?? []).length === 0) {
        pass(`T-${idx}b`, `Cannot read School B's ${table}`,
          "Query for the other tenant returns nothing", "critical");
      } else {
        fail(`T-${idx}b`, `Cannot read School B's ${table}`,
          "Query for the other tenant returns nothing", "critical",
          `LEAK: ${foreign!.length} row(s) from School B were readable`);
      }

      // Unfiltered read must not include foreign rows either.
      const { data: all } = await clientA.from(table).select("organization_id");
      const leaked = (all ?? []).filter(
        (r) => (r as { organization_id: string }).organization_id !== orgA
      );
      if (leaked.length === 0) {
        pass(`T-${idx}c`, `Unfiltered ${table} read stays in tenant`,
          "SELECT with no filter returns only School A rows", "critical",
          `${(all ?? []).length} row(s), all School A`);
      } else {
        fail(`T-${idx}c`, `Unfiltered ${table} read stays in tenant`,
          "SELECT with no filter returns only School A rows", "critical",
          `LEAK: ${leaked.length} foreign row(s) in an unfiltered read`);
      }
    }

    // T-010 — cross-tenant UPDATE must affect nothing
    {
      const { data, error } = await clientA
        .from("students")
        .update({ full_name: "TAMPERED BY SCHOOL A" })
        .eq("id", studentB)
        .select("id");
      if (error) {
        pass("T-010", "Cannot update School B's student",
          "Cross-tenant UPDATE is refused or matches no rows", "critical",
          `Rejected: ${error.message}`);
      } else if ((data ?? []).length === 0) {
        pass("T-010", "Cannot update School B's student",
          "Cross-tenant UPDATE is refused or matches no rows", "critical",
          "0 rows affected");
      } else {
        fail("T-010", "Cannot update School B's student",
          "Cross-tenant UPDATE is refused or matches no rows", "critical",
          "BREACH: School A modified School B's record");
      }

      // Confirm from the service side that the row is untouched.
      const { data: check } = await admin
        .from("students").select("full_name").eq("id", studentB).single();
      if (check && check.full_name !== "TAMPERED BY SCHOOL A") {
        pass("T-011", "School B's data is byte-for-byte intact",
          "The target row still holds its original value", "critical");
      } else {
        fail("T-011", "School B's data is byte-for-byte intact",
          "The target row still holds its original value", "critical",
          "BREACH: the row was actually modified");
      }
    }

    // T-012 — cross-tenant DELETE must affect nothing
    {
      const { data, error } = await clientA
        .from("income_entries").delete().eq("id", incomeB).select("id");
      const stillThere = await admin
        .from("income_entries").select("id").eq("id", incomeB).maybeSingle();

      if (stillThere.data) {
        pass("T-012", "Cannot delete School B's payment",
          "Cross-tenant DELETE removes nothing", "critical",
          error ? `Rejected: ${error.message}` : `${(data ?? []).length} row(s) reported`);
      } else {
        fail("T-012", "Cannot delete School B's payment",
          "Cross-tenant DELETE removes nothing", "critical",
          "BREACH: School A deleted School B's payment record");
      }
    }

    // T-013 — cross-tenant INSERT must be rejected
    {
      const { data, error } = await clientA.from("students").insert({
        student_code: `ISO-INJECT-${run}`,
        full_name: "Injected into School B",
        organization_id: orgB,
        status: "active",
      }).select("id");

      if (error) {
        pass("T-013", "Cannot insert into School B",
          "INSERT naming another tenant is refused", "critical",
          `Rejected: ${error.message}`);
      } else {
        fail("T-013", "Cannot insert into School B",
          "INSERT naming another tenant is refused", "critical",
          `BREACH: row ${data?.[0]?.id ?? "?"} was written into School B`);
        if (data?.[0]?.id) {
          await admin.from("students").delete().eq("id", data[0].id);
        }
      }
    }

    // T-014 — per-org unique constraint: the same student code must be
    // usable by both schools.
    {
      const { error } = await admin.from("students").insert({
        student_code: sharedStudentCode,
        full_name: `${MARKER} Same code, School B`,
        organization_id: orgB,
        status: "active",
      });
      if (error) {
        fail("T-014", "Student codes are unique per school",
          "Both schools can use the same student_code", "high",
          `Blocked: ${error.message} — the unique constraint is still global`);
      } else {
        pass("T-014", "Student codes are unique per school",
          "Both schools can use the same student_code", "high");
      }
    }

    // T-015 — the same receipt number in both schools
    {
      const { error } = await admin.from("income_entries").insert([
        { receipt_no: sharedReceiptNo, date: new Date().toISOString().slice(0, 10),
          category: "School Fees", amount: 100, organization_id: orgA },
        { receipt_no: sharedReceiptNo, date: new Date().toISOString().slice(0, 10),
          category: "School Fees", amount: 100, organization_id: orgB },
      ]);
      if (error) {
        fail("T-015", "Receipt numbers are unique per school",
          "Both schools can issue the same receipt_no", "high",
          `Blocked: ${error.message} — receipt_no is still globally unique`);
      } else {
        pass("T-015", "Receipt numbers are unique per school",
          "Both schools can issue the same receipt_no", "high");
      }
    }

    // T-016 — entitlements are per tenant
    {
      const { data } = await clientA.from("subscriptions").select("organization_id, module_key");
      const foreign = (data ?? []).filter(
        (s) => (s as { organization_id: string }).organization_id !== orgA
      );
      if (foreign.length === 0) {
        pass("T-016", "Sees only its own entitlements",
          "Subscription rows are limited to School A", "high",
          `${(data ?? []).length} entitlement row(s)`);
      } else {
        fail("T-016", "Sees only its own entitlements",
          "Subscription rows are limited to School A", "high",
          `LEAK: ${foreign.length} foreign entitlement row(s) visible`);
      }
    }

    // T-017 — a school cannot grant itself a paid module
    {
      const { error } = await clientA.from("subscriptions").insert({
        organization_id: orgA, module_key: "payroll", status: "active",
      });
      if (error) {
        pass("T-017", "Cannot self-grant a paid module",
          "Writing an entitlement is refused for tenant users", "high",
          `Rejected: ${error.message}`);
      } else {
        fail("T-017", "Cannot self-grant a paid module",
          "Writing an entitlement is refused for tenant users", "high",
          "BREACH: a school admin enabled a module it does not pay for");
        await admin.from("subscriptions").delete()
          .eq("organization_id", orgA).eq("module_key", "payroll");
      }
    }

    // T-018 — cannot tamper with another school's record
    {
      const { error } = await clientA.from("organizations")
        .update({ name: "HIJACKED" }).eq("id", orgB).select("id");
      const { data: check } = await admin
        .from("organizations").select("name").eq("id", orgB).single();
      if (check && check.name !== "HIJACKED") {
        pass("T-018", "Cannot rename another school",
          "Updating a foreign organization row does nothing", "critical",
          error ? `Rejected: ${error.message}` : "0 rows affected");
      } else {
        fail("T-018", "Cannot rename another school",
          "Updating a foreign organization row does nothing", "critical",
          "BREACH: School A renamed School B");
      }
    }

    // T-019 — cannot read another school's member roster
    {
      const { data, error } = await clientA.rpc("list_org_members", { p_org: orgB });
      if (error) {
        pass("T-019", "Cannot list School B's members",
          "The roster RPC refuses a foreign org", "critical",
          `Rejected: ${error.message}`);
      } else if ((data ?? []).length === 0) {
        pass("T-019", "Cannot list School B's members",
          "The roster RPC refuses a foreign org", "critical", "Empty result");
      } else {
        fail("T-019", "Cannot list School B's members",
          "The roster RPC refuses a foreign org", "critical",
          `LEAK: ${(data as unknown[]).length} member row(s) exposed`);
      }
    }

    // T-020 — cannot switch into a school it does not belong to
    {
      const { error } = await clientA.rpc("switch_active_org", { p_org: orgB });
      if (error) {
        pass("T-020", "Cannot switch into a foreign school",
          "switch_active_org refuses a non-member", "critical",
          `Rejected: ${error.message}`);
      } else {
        // If it succeeded, the tenant pointer moved — put it back.
        const { data: nowOrg } = await clientA.rpc("current_user_org_id");
        await admin.from("org_memberships").delete()
          .eq("user_id", userA).eq("organization_id", orgB);
        await admin.from("org_memberships").update({ is_default: true })
          .eq("user_id", userA).eq("organization_id", orgA);
        fail("T-020", "Cannot switch into a foreign school",
          "switch_active_org refuses a non-member", "critical",
          `BREACH: the tenant pointer moved to ${String(nowOrg)}`);
      }
    }

    // T-021 — an unauthenticated client sees nothing
    {
      const anon = createClient(opts.supabaseUrl, opts.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error } = await anon.from("students").select("id").limit(5);
      if (error) {
        pass("T-021", "Anonymous access is blocked",
          "No session means no tenant rows", "critical", `Rejected: ${error.message}`);
      } else if ((data ?? []).length === 0) {
        pass("T-021", "Anonymous access is blocked",
          "No session means no tenant rows", "critical");
      } else {
        fail("T-021", "Anonymous access is blocked",
          "No session means no tenant rows", "critical",
          `LEAK: ${data!.length} student row(s) readable with no login`);
      }
    }

    // T-022 — suspending the membership revokes access immediately
    {
      await admin.from("org_memberships")
        .update({ active: false }).eq("user_id", userA).eq("organization_id", orgA);

      const { data } = await clientA.from("students").select("id");
      if ((data ?? []).length === 0) {
        pass("T-022", "Suspending a membership cuts access",
          "A deactivated member reads no tenant rows", "high");
      } else {
        fail("T-022", "Suspending a membership cuts access",
          "A deactivated member reads no tenant rows", "high",
          `${data!.length} row(s) still readable after suspension`);
      }

      await admin.from("org_memberships")
        .update({ active: true }).eq("user_id", userA).eq("organization_id", orgA);
    }
  } catch (e) {
    record({
      id: "SETUP",
      name: "Suite setup",
      expectation: "Fixtures provision cleanly",
      status: "error",
      severity: "critical",
      detail: e instanceof Error ? e.message : String(e),
    });
  } finally {
    // ---------- Teardown ----------
    try {
      if (clientA) await clientA.auth.signOut();

      // Organizations cascade to their tenant rows.
      if (orgA) await admin.from("organizations").delete().eq("id", orgA);
      if (orgB) await admin.from("organizations").delete().eq("id", orgB);

      // Any row that escaped the cascade.
      await admin.from("students").delete().like("student_code", `ISO-%${run}%`);
      await admin.from("students").delete().eq("student_code", sharedStudentCode);
      await admin.from("students").delete().eq("student_code", `ISO-INJECT-${run}`);
      await admin.from("income_entries").delete().like("receipt_no", `%${run}%`);
      await admin.from("expense_entries").delete().like("voucher_no", `%${run}%`);
      await admin.from("vendors").delete().like("vendor_code", `%${run}%`);

      if (userA) {
        await admin.from("org_memberships").delete().eq("user_id", userA);
        await admin.from("profiles").delete().eq("id", userA);
        await admin.auth.admin.deleteUser(userA);
      }
      if (userB) {
        await admin.from("org_memberships").delete().eq("user_id", userB);
        await admin.from("profiles").delete().eq("id", userB);
        await admin.auth.admin.deleteUser(userB);
      }
    } catch (e) {
      cleanupOk = false;
      cleanupDetail = e instanceof Error ? e.message : String(e);
    }
  }

  const passed = results.filter(r => r.status === "pass").length;
  const failed = results.filter(r => r.status === "fail").length;
  const skipped = results.filter(r => r.status === "skip").length;
  const errored = results.filter(r => r.status === "error").length;
  const criticalFailures = results.filter(
    r => (r.status === "fail" || r.status === "error") && r.severity === "critical"
  ).length;

  const finished = Date.now();
  return {
    ran: true,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: finished - started,
    results,
    summary: {
      total: results.length,
      passed, failed, skipped, errored,
      criticalFailures,
      allPass: failed === 0 && errored === 0 && results.length > 0,
    },
    cleanup: { ok: cleanupOk, detail: cleanupDetail },
  };
}
