/**
 * REAL data-flow test for the automation engine
 * (supabase/automation_engine.sql) -- executed against a database.
 *
 * get_due_automation_triggers() / record_automation_execution() are
 * service_role-only (REVOKE'd from anon/authenticated, confirmed by the
 * migration's own V3 query), so there is no persona-authorization
 * boundary to test the way tenant-isolation.db.test.ts and
 * personas.db.test.ts do for user-facing RPCs -- Postgres GRANT/REVOKE
 * already proves that boundary. What matters here instead is DATA-FLOW
 * correctness: does the engine actually detect the right events, evaluate
 * conditions correctly, compute the right balance, and never re-fire on
 * something it already processed.
 *
 * Uses the service-role client directly (adminClient()) -- no persona
 * sign-in needed, since these functions are never called from a user
 * session.
 *
 * Writes to `students` go through phase1_sensitive_write_guard, so
 * fixture setup here sets the same service_role JWT claim the guard's own
 * exemption checks for, exactly as
 * fix_clear_must_change_password_guard_conflict.sql and this engine's own
 * manual verification (during development) did.
 *
 * Skips cleanly when no test database is configured, or when this
 * migration has not been applied to the target database (this feature is
 * unmerged).
 */

import { requireTestDb, adminClient, ok, summary } from "./harness";

const SUITE = "automation engine (database-backed)";
const tag = `ae${Date.now()}`;

async function main() {
  const env = requireTestDb(SUITE);
  if (!env) return;

  const admin = adminClient(env);
  let orgId: string | null = null;

  try {
    console.log(`\n${SUITE}\n${"=".repeat(SUITE.length)}`);

    const probe = await admin.rpc("get_due_automation_triggers");
    if (probe.error && (probe.error as { code?: string }).code === "PGRST202") {
      console.log("  SKIP  get_due_automation_triggers not applied to this database (Automations feature)");
      return;
    }

    // students carries phase1_sensitive_write_guard, but adminClient() here
    // authenticates with the service-role key -- PostgREST sets
    // auth.role() = 'service_role' for that key automatically, which the
    // guard's own built-in exemption already allows. No extra setup needed
    // (unlike the raw-psql superuser session used during this engine's own
    // manual development testing, which has no JWT context at all).
    const { data: org, error: orgErr } = await admin
      .from("organizations").insert({ name: `AutomationTest ${tag}`, slug: `automation-test-${tag}` })
      .select("id").single();
    if (orgErr || !org) throw new Error(`org: ${orgErr?.message}`);
    orgId = (org as { id: string }).id;

    const { data: student, error: stuErr } = await admin
      .from("students").insert({ student_code: `AE-${tag}`, full_name: "Test Student", organization_id: orgId, status: "active", grade: "JSS1" })
      .select("id").single();
    if (stuErr || !student) throw new Error(`student: ${stuErr?.message}`);
    const studentId = (student as { id: string }).id;

    const { data: rule, error: ruleErr } = await admin
      .from("automation_rules").insert({
        name: `Big payment alert ${tag}`, trigger_event: "payment_received",
        conditions: [{ field: "amount", operator: "gt", value: 1000 }],
        actions: [{ type: "log_activity" }], enabled: true, organization_id: orgId,
      })
      .select("id").single();
    if (ruleErr || !rule) throw new Error(`rule: ${ruleErr?.message}`);
    const ruleId = (rule as { id: string }).id;

    // Below threshold -- must NOT match.
    await admin.from("income_entries").insert({
      receipt_no: `RCT-LOW-${tag}`, date: new Date().toISOString().slice(0, 10),
      student_id: studentId, category: "School Fees", amount: 500, payment_method: "Cash", organization_id: orgId,
    });
    // Above threshold -- must match.
    await admin.from("income_entries").insert({
      receipt_no: `RCT-HIGH-${tag}`, date: new Date().toISOString().slice(0, 10),
      student_id: studentId, category: "School Fees", amount: 1500, payment_method: "Cash", organization_id: orgId,
    });

    const { data: due1 } = await admin.rpc("get_due_automation_triggers");
    const mine1 = ((due1 ?? []) as { rule_id: string; context: { amount: number } }[]).filter((r) => r.rule_id === ruleId);
    ok(mine1.length === 1, `detects exactly 1 matching event, not the below-threshold one (got ${mine1.length})`);
    ok(mine1[0]?.context?.amount === 1500, `matched event's context carries the correct amount (got ${mine1[0]?.context?.amount})`);

    // Record the execution -- proves record_automation_execution() writes
    // automation_logs AND bumps the rule's own execution_count/last_status.
    const { error: recErr } = await admin.rpc("record_automation_execution", {
      p_rule_id: ruleId, p_status: "success", p_trigger_data: mine1[0]?.context ?? {},
      p_actions_executed: [{ type: "log_activity", ok: true }], p_error_message: null, p_execution_time_ms: 12,
    });
    ok(!recErr, `record_automation_execution succeeds (error: ${recErr?.message ?? "none"})`);

    const { data: ruleAfter } = await admin
      .from("automation_rules").select("execution_count, last_status, last_executed_at").eq("id", ruleId).single();
    const r = ruleAfter as { execution_count: number; last_status: string; last_executed_at: string | null } | null;
    ok(r?.execution_count === 1, `rule's execution_count incremented to 1 (got ${r?.execution_count})`);
    ok(r?.last_status === "success", `rule's last_status recorded as success (got ${r?.last_status})`);
    ok(!!r?.last_executed_at, "rule's last_executed_at was set");

    const { data: logRow } = await admin
      .from("automation_logs").select("rule_name, trigger_event, status").eq("rule_id", ruleId).maybeSingle();
    ok(!!logRow, "an automation_logs row was actually written");

    // Idempotency: re-running detection must NOT re-match the same
    // already-processed payment now that last_executed_at has advanced.
    const { data: due2 } = await admin.rpc("get_due_automation_triggers");
    const mine2 = ((due2 ?? []) as { rule_id: string }[]).filter((r2) => r2.rule_id === ruleId);
    ok(mine2.length === 0, `re-running detection does NOT re-match the already-processed event (idempotency; got ${mine2.length})`);

    // Balance-based trigger: fee_overdue. Due 3000 (JSS1), paid so far
    // 500+1500=2000 -> balance should be exactly 1000.
    await admin.from("fee_schedules").insert({
      name: `Term Fee ${tag}`, amount: 3000, category: "School Fees", grade: "JSS1", organization_id: orgId, active: true,
    });
    const { data: feeRule, error: feeRuleErr } = await admin
      .from("automation_rules").insert({
        name: `Overdue balance ${tag}`, trigger_event: "fee_overdue",
        conditions: [], actions: [{ type: "send_sms" }], enabled: true, organization_id: orgId,
      })
      .select("id").single();
    if (feeRuleErr || !feeRule) throw new Error(`feeRule: ${feeRuleErr?.message}`);
    const feeRuleId = (feeRule as { id: string }).id;

    const { data: due3 } = await admin.rpc("get_due_automation_triggers");
    const feeMatch = ((due3 ?? []) as { rule_id: string; context: { balance: number; student_id: string } }[])
      .find((r3) => r3.rule_id === feeRuleId);
    ok(!!feeMatch, "fee_overdue trigger matches the student with an outstanding balance");
    ok(feeMatch?.context?.balance === 1000, `fee_overdue computes the SAME balance as student-finance (3000 due - 2000 paid = 1000; got ${feeMatch?.context?.balance})`);

    // scheduled_daily: fires once with an empty context.
    const { data: dailyRule, error: dailyErr } = await admin
      .from("automation_rules").insert({
        name: `Daily digest ${tag}`, trigger_event: "scheduled_daily",
        conditions: [], actions: [{ type: "log_activity" }], enabled: true, organization_id: orgId,
      })
      .select("id").single();
    if (dailyErr || !dailyRule) throw new Error(`dailyRule: ${dailyErr?.message}`);
    const dailyRuleId = (dailyRule as { id: string }).id;

    const { data: due4 } = await admin.rpc("get_due_automation_triggers");
    const dailyMatch = ((due4 ?? []) as { rule_id: string; context: Record<string, unknown> }[])
      .find((r4) => r4.rule_id === dailyRuleId);
    ok(!!dailyMatch, "scheduled_daily fires on its first eligible run");
    ok(Object.keys(dailyMatch?.context ?? { x: 1 }).length === 0, "scheduled_daily's context is empty (no single event drives it)");
  } finally {
    if (orgId) await admin.from("organizations").delete().eq("id", orgId);
  }

  summary(SUITE);
}

main().catch((e) => {
  console.error(`\n${SUITE} crashed: ${(e as Error).message}`);
  process.exit(1);
});
