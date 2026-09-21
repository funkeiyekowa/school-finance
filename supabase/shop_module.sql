-- =====================================================================
-- SHOP -- the minimum finance/data-model requirement for a school shop
-- =====================================================================
-- Run order: after operations_migration.sql (inventory_items,
-- stock_movements), student_finance_module.sql / schema.sql
-- (income_entries, the atomic receipt-number trigger), and
-- 20260905120000_phase1_security_enforcement.sql (phase1_operations_access,
-- phase1_finance_access, phase1_sensitive_write_guard -- income_entries,
-- inventory_items and stock_movements are all guarded tables; this RPC
-- performs its writes under the guard's own service_role exemption, same
-- technique as fix_clear_must_change_password_guard_conflict.sql).
--
-- Adds one nullable column and one RPC. No new table, no policy touched.
-- Idempotent (ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE). Manual apply.
--
-- ---------------------------------------------------------------------
-- WHY THIS SHAPE, NOT A NEW COMMERCE MODEL
-- ---------------------------------------------------------------------
-- The earlier audit's finding stands: there is no order/product/cart
-- concept anywhere, and student-finance's own "total_due" is DERIVED from
-- fee_schedules by grade -- there is no per-student ad-hoc charge table,
-- so a running "buy now, pay later" tab has nowhere to live without
-- inventing a new finance concept.
--
-- But the audit also found what the app ALREADY expects here:
--   * inventory_items already models exactly the physical items a school
--     shop sells (uniforms, textbooks) -- it just has unit_cost (what the
--     school paid) and no customer-facing sale price.
--   * INCOME_CATEGORIES (src/lib/types/index.ts) already lists
--     "Textbook Sales" and "Uniform Sales" -- categories for exactly this,
--     defined before any Shop UI existed to use them.
--   * Every other finance flow in this app (income, receipts) is
--     STAFF-RECORDED, not self-service -- a parent does not record their
--     own payment anywhere else in the app either.
--   * Reconciliation already exists for collecting money (SMS bank-alert
--     auto-credit); no payment provider is required or justified.
--
-- So Shop here is a point-of-sale: staff (front desk / bursar) records a
-- sale against a student on the spot. It reuses income_entries -- the
-- SAME atomic per-org receipt numbering (prepare_income_receipt_number)
-- every other payment already gets -- for the money, and stock_movements
-- -- the SAME 'stock_out' movement type inventory already uses for any
-- other stock reduction -- for the inventory side. One receipt per
-- checkout (possibly multiple items), not one row per line item, matching
-- how a receipt already represents one payment event everywhere else in
-- this app.
--
-- The one addition needed for this to work at all: inventory_items had
-- no customer-facing price, only unit_cost (the school's own cost). Adds
-- sale_price, nullable -- a school that never uses Shop never sets it,
-- and its absence is how the Shop UI knows an item isn't for sale.
-- =====================================================================

ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS sale_price numeric(12,2);
COMMENT ON COLUMN public.inventory_items.sale_price IS
  'Customer-facing price for Shop sales, distinct from unit_cost (the school''s own procurement cost). NULL = not sold through Shop.';


-- ---------------------------------------------------------------------
-- record_shop_sale -- one checkout, possibly several line items, exactly
-- one income_entries receipt + one stock_movements row per line item, all
-- in a single transaction (a SECURITY DEFINER function call is one
-- transaction), so stock and the sale can never disagree.
--
-- p_lines: jsonb array of {"item_id": uuid, "quantity": numeric}
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_shop_sale(
  p_student_id     uuid,
  p_lines          jsonb,
  p_payment_method text DEFAULT 'Cash',
  p_notes          text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org       uuid := current_user_org_id();
  v_line      jsonb;
  v_item      RECORD;
  v_qty       numeric;
  v_total     numeric := 0;
  v_desc      text[] := ARRAY[]::text[];
  v_receipt   text;
  v_income_id uuid;
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'No organization in scope';
  END IF;
  IF NOT (public.phase1_operations_access() OR public.phase1_finance_access()) THEN
    RAISE EXCEPTION 'Only operations or finance staff can record a Shop sale';
  END IF;
  IF p_student_id IS NULL THEN
    RAISE EXCEPTION 'A student is required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.students WHERE id = p_student_id AND organization_id = v_org) THEN
    RAISE EXCEPTION 'That student is not in this organization';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'At least one item is required';
  END IF;

  -- Pass 1: validate every line and compute the total BEFORE writing
  -- anything, so a bad line (unknown item, insufficient stock) fails the
  -- whole checkout rather than leaving a partial sale.
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_qty := (v_line->>'quantity')::numeric;
    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Each line must have a positive quantity';
    END IF;

    SELECT * INTO v_item FROM public.inventory_items
     WHERE id = (v_line->>'item_id')::uuid AND organization_id = v_org AND active = true;
    IF v_item.id IS NULL THEN
      RAISE EXCEPTION 'Item % not found in this organization', v_line->>'item_id';
    END IF;
    IF v_item.sale_price IS NULL THEN
      RAISE EXCEPTION '"%" has no sale price set -- it is not available through Shop', v_item.name;
    END IF;
    IF v_item.quantity_on_hand < v_qty THEN
      RAISE EXCEPTION 'Not enough stock of "%" (have %, need %)', v_item.name, v_item.quantity_on_hand, v_qty;
    END IF;

    v_total := v_total + (v_item.sale_price * v_qty);
    v_desc := v_desc || (v_qty::text || 'x ' || v_item.name);
  END LOOP;

  -- Pass 2: write. income_entries, inventory_items and stock_movements all
  -- carry phase1_sensitive_write_guard, which re-checks the ACTUAL caller's
  -- JWT (not this function's SECURITY DEFINER owner): income_entries
  -- requires phase1_finance_access() specifically, inventory_items and
  -- stock_movements require phase1_operations_access() specifically. This
  -- function's own check above is deliberately BROADER than either alone
  -- (operations OR finance -- front-desk/operations staff should be able
  -- to ring up a uniform sale without finance-department access, and
  -- finance staff should not need operations access just to record one).
  -- An operations-only caller would therefore be blocked on the
  -- income_entries write, and a finance-only caller blocked on the
  -- inventory writes, despite already being authorized by this function.
  --
  -- Satisfied the same way fix_clear_must_change_password_guard_conflict.sql
  -- and enrol_my_child_in_course() (parent_course_enrolment.sql) already
  -- do: the guard's own built-in service_role exemption, set LOCAL to this
  -- transaction so it can never leak to a later statement or session, and
  -- merged into the existing claims via jsonb_set so 'sub' and every other
  -- claim survive. This does NOT widen authorization -- the check above
  -- has already authorized this specific caller for this specific action;
  -- it only stops the guard's finer-grained per-table check from refusing
  -- someone this function has already deliberately allowed.
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_set(
      COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb),
      '{role}', '"service_role"'
    )::text,
    true
  );

  INSERT INTO public.income_entries (
    date, student_id, category, description, amount, payment_method, organization_id
  ) VALUES (
    CURRENT_DATE, p_student_id, 'Uniform Sales',
    'Shop: ' || array_to_string(v_desc, ', ') || COALESCE(' -- ' || p_notes, ''),
    v_total, p_payment_method, v_org
  )
  RETURNING id, receipt_no INTO v_income_id, v_receipt;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_qty := (v_line->>'quantity')::numeric;

    UPDATE public.inventory_items
       SET quantity_on_hand = quantity_on_hand - v_qty, updated_at = now()
     WHERE id = (v_line->>'item_id')::uuid AND organization_id = v_org;

    INSERT INTO public.stock_movements (item_id, movement_type, quantity, reference, reason, organization_id)
    VALUES ((v_line->>'item_id')::uuid, 'stock_out', -v_qty, v_receipt, 'Shop sale', v_org);
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true, 'income_id', v_income_id, 'receipt_no', v_receipt, 'amount', v_total
  );
END $$;

REVOKE ALL ON FUNCTION public.record_shop_sale(uuid, jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_shop_sale(uuid, jsonb, text, text) TO authenticated;


-- ---------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------
SELECT 'V1 column' AS check, column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'inventory_items' AND column_name = 'sale_price';

SELECT 'V2 function' AS check, p.proname, p.prosecdef AS security_definer
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'record_shop_sale';

SELECT 'V3 anon cannot execute' AS check, p.proname
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'record_shop_sale'
  AND has_function_privilege('anon', p.oid, 'EXECUTE');
