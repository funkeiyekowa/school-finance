/**
 * REAL data-flow + authorization test for record_shop_sale()
 * (supabase/shop_module.sql) -- executed against a database.
 *
 * The critical thing this proves is the guard-exemption fix found while
 * writing the migration: record_shop_sale() authorizes on
 * phase1_operations_access() OR phase1_finance_access(), deliberately
 * broader than either alone -- but income_entries requires finance access
 * specifically and inventory_items/stock_movements require operations
 * access specifically (both via phase1_sensitive_write_guard, which
 * re-checks the ACTUAL caller's JWT, not this function's SECURITY DEFINER
 * owner). Without the guard exemption this migration adds, an
 * operations-only caller would be blocked on the income_entries write and
 * a finance-only caller blocked on the inventory writes, despite both
 * being correctly authorized by the function's own check. This test signs
 * in BOTH kinds of staff and proves each can complete a sale.
 *
 * Skips cleanly when no test database is configured, or when this
 * migration has not been applied to the target database (this feature is
 * unmerged).
 */

import {
  requireTestDb, adminClient, createPersona,
  ok, expectDenied, expectAllowed, summary,
} from "./harness";

const SUITE = "shop (database-backed)";
const tag = `shop${Date.now()}`;

async function main() {
  const env = requireTestDb(SUITE);
  if (!env) return;

  const admin = adminClient(env);
  const orgIds: string[] = [];
  const userIds: string[] = [];

  try {
    console.log(`\n${SUITE}\n${"=".repeat(SUITE.length)}`);

    const probe = await admin.rpc("record_shop_sale", { p_student_id: null, p_lines: [] });
    if (probe.error && (probe.error as { code?: string }).code === "PGRST202") {
      console.log("  SKIP  record_shop_sale not applied to this database (Shop feature)");
      return;
    }

    const { data: orgA, error: orgErr } = await admin
      .from("organizations").insert({ name: `ShopOrgA ${tag}`, slug: `shop-orga-${tag}` }).select("id").single();
    const { data: orgB, error: orgBErr } = await admin
      .from("organizations").insert({ name: `ShopOrgB ${tag}`, slug: `shop-orgb-${tag}` }).select("id").single();
    if (orgErr || !orgA || orgBErr || !orgB) throw new Error(`org: ${orgErr?.message ?? orgBErr?.message}`);
    const orgAId = (orgA as { id: string }).id;
    const orgBId = (orgB as { id: string }).id;
    orgIds.push(orgAId, orgBId);

    const enrol = async (orgId: string, uid: string, role: string, email: string, name: string) => {
      await admin.from("profiles").upsert({ id: uid, email, full_name: name, role, active: true });
      await admin.from("org_memberships").insert({ user_id: uid, organization_id: orgId, role, active: true, is_default: true });
    };

    const { data: student, error: stuErr } = await admin
      .from("students").insert({ student_code: `SHOP-${tag}`, full_name: "Shop Student", organization_id: orgAId, status: "active", grade: "JSS1" })
      .select("id").single();
    if (stuErr || !student) throw new Error(`student: ${stuErr?.message}`);
    const studentId = (student as { id: string }).id;

    const { data: item, error: itemErr } = await admin
      .from("inventory_items").insert({
        name: "School Shirt (M)", item_code: `UNI-${tag}`, category: "Uniform",
        quantity_on_hand: 5, unit_cost: 2000, sale_price: 3500, organization_id: orgAId, active: true,
      }).select("id").single();
    if (itemErr || !item) throw new Error(`item: ${itemErr?.message}`);
    const itemId = (item as { id: string }).id;

    // Item in org B, to prove cross-tenant purchase is refused.
    const { data: itemB } = await admin
      .from("inventory_items").insert({
        name: "Other School Item", item_code: `UNIB-${tag}`, category: "Uniform",
        quantity_on_hand: 5, sale_price: 1000, organization_id: orgBId, active: true,
      }).select("id").single();
    const itemBId = (itemB as { id: string } | null)?.id;

    const opsStaff = await createPersona(env, admin, `ops-${tag}@example.test`);
    userIds.push(opsStaff.userId);
    await enrol(orgAId, opsStaff.userId, "staff", `ops-${tag}@example.test`, "Ops Staff"); // operations, not finance

    const bursar = await createPersona(env, admin, `bursar-${tag}@example.test`);
    userIds.push(bursar.userId);
    await enrol(orgAId, bursar.userId, "bursar", `bursar-${tag}@example.test`, "Bursar"); // finance, not operations

    const teacher = await createPersona(env, admin, `teacher-${tag}@example.test`);
    userIds.push(teacher.userId);
    await enrol(orgAId, teacher.userId, "teacher", `teacher-${tag}@example.test`, "Teacher"); // neither

    /* ---------------- Negative: unauthorized role ---------------- */
    expectDenied(
      await teacher.client.rpc("record_shop_sale", {
        p_student_id: studentId, p_lines: [{ item_id: itemId, quantity: 1 }],
      }),
      "teacher (neither operations nor finance access) CANNOT record a shop sale"
    );

    /* ---------------- Negative: insufficient stock ---------------- */
    expectDenied(
      await opsStaff.client.rpc("record_shop_sale", {
        p_student_id: studentId, p_lines: [{ item_id: itemId, quantity: 999 }],
      }),
      "sale exceeding available stock is refused"
    );

    /* ---------------- Negative: cross-org item ---------------- */
    if (itemBId) {
      expectDenied(
        await opsStaff.client.rpc("record_shop_sale", {
          p_student_id: studentId, p_lines: [{ item_id: itemBId, quantity: 1 }],
        }),
        "purchasing another org's inventory item is refused (tenant isolation)"
      );
    }

    /* ---------------- Positive: operations-only staff ----------------
     * THE critical case: without the guard exemption, this caller passes
     * the function's own OR-check but has no phase1_finance_access(), so
     * the income_entries INSERT alone would be blocked by
     * phase1_sensitive_write_guard. */
    const saleResult = await opsStaff.client.rpc("record_shop_sale", {
      p_student_id: studentId, p_lines: [{ item_id: itemId, quantity: 2 }], p_payment_method: "Cash",
    });
    expectAllowed(saleResult, "operations-only staff CAN complete a sale (income_entries write via guard exemption)");
    const sale = saleResult.data as { ok?: boolean; income_id?: string; receipt_no?: string; amount?: number } | null;
    ok(sale?.amount === 7000, `sale total is correct (2 x 3500 = 7000; got ${sale?.amount})`);
    ok(!!sale?.receipt_no, "a receipt number was allocated");

    // Ground truth: income_entries row, stock decrement, stock_movements row.
    const { data: incRow } = await admin
      .from("income_entries").select("amount, student_id, receipt_no").eq("id", sale?.income_id).single();
    ok(
      (incRow as { amount: number; student_id: string } | null)?.amount === 7000
        && (incRow as { student_id: string } | null)?.student_id === studentId,
      "income_entries row was actually created with the correct amount and student"
    );

    const { data: itemAfter } = await admin
      .from("inventory_items").select("quantity_on_hand").eq("id", itemId).single();
    ok(
      (itemAfter as { quantity_on_hand: number } | null)?.quantity_on_hand === 3,
      `inventory was actually decremented (5 - 2 = 3; got ${(itemAfter as { quantity_on_hand: number } | null)?.quantity_on_hand})`
    );

    const { data: movement } = await admin
      .from("stock_movements").select("movement_type, quantity, reference").eq("item_id", itemId).eq("reference", sale?.receipt_no ?? "").maybeSingle();
    ok(
      (movement as { movement_type: string; quantity: number } | null)?.movement_type === "stock_out"
        && (movement as { quantity: number } | null)?.quantity === -2,
      "a stock_movements row was created referencing this sale's receipt"
    );

    /* ---------------- Positive: finance-only staff ----------------
     * The other critical case: without the guard exemption, this caller
     * has no phase1_operations_access(), so the inventory_items /
     * stock_movements writes alone would be blocked. */
    const saleResult2 = await bursar.client.rpc("record_shop_sale", {
      p_student_id: studentId, p_lines: [{ item_id: itemId, quantity: 1 }], p_payment_method: "Transfer",
    });
    expectAllowed(saleResult2, "finance-only staff (bursar) CAN also complete a sale (inventory writes via guard exemption)");

    const { data: itemAfter2 } = await admin
      .from("inventory_items").select("quantity_on_hand").eq("id", itemId).single();
    ok(
      (itemAfter2 as { quantity_on_hand: number } | null)?.quantity_on_hand === 2,
      `inventory reflects BOTH sales (5 - 2 - 1 = 2; got ${(itemAfter2 as { quantity_on_hand: number } | null)?.quantity_on_hand})`
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
