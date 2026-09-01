-- =====================================================================
-- PAYROLL MODULE
-- =====================================================================
-- Adds real functionality behind the "Payroll" module row in the
-- Platform Admin > Module Catalogue (key='payroll'), which previously
-- had zero dashboard pages built for it.
--
-- Scope: reusable pay components (allowances & deductions, either
-- fixed amounts or a percent of basic salary), a per-staff override
-- of which components apply and their values, monthly payroll runs
-- (one per month per org), and per-staff payslips snapshotted at run
-- generation so that later changes to salary or components never
-- retroactively rewrite an already-generated payslip.
--
-- Basic gross salary comes from staff_members.salary (already exists,
-- from operations_migration.sql). Payroll adds structured line items
-- on top of that.
--
-- Conventions followed (see fix_paginated_ambiguous_columns.sql,
-- transport_module.sql, lms_module.sql, library_module.sql,
-- hostel_module.sql):
--   * RLS via current_user_org_id() from the start.
--   * Any RPC's RETURNS TABLE column names avoid colliding with bare
--     identifiers used in its body (the 42702 "ambiguous column" bug).
--   * organization_id has no DB-side default -- every INSERT from the
--     client must set it explicitly. Server-side RPCs set it via
--     v_org.
--
-- Run order: after saas_foundation.sql / multi_tenant_migration.sql
-- (current_user_org_id()) and operations_migration.sql (staff_members).
--
-- SAFE TO RE-RUN.
-- =====================================================================

-- ==========================================================
-- 1. COMPONENTS -- reusable allowance/deduction definitions
-- ==========================================================
CREATE TABLE IF NOT EXISTS payroll_components (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text NOT NULL,                          -- e.g. 'Housing Allowance', 'PAYE Tax', 'Pension'
  code text NOT NULL,                          -- short code, e.g. 'HOUSING', 'TAX'
  type text NOT NULL,                          -- 'allowance', 'deduction'
  calculation_type text NOT NULL DEFAULT 'fixed', -- 'fixed', 'percent_of_basic'
  default_amount numeric(12,2) NOT NULL DEFAULT 0,  -- interpreted as an absolute amount for 'fixed', a percentage (0-100) for 'percent_of_basic'
  is_taxable boolean NOT NULL DEFAULT true,    -- informational flag, for future tax-calc logic
  applies_to_all boolean NOT NULL DEFAULT false, -- true = auto-apply to every staff member on a new run
  active boolean NOT NULL DEFAULT true,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(organization_id, code)
);

CREATE INDEX IF NOT EXISTS idx_payroll_components_org ON payroll_components(organization_id);

-- ==========================================================
-- 2. STAFF COMPONENTS -- which components apply to which staff
-- ==========================================================
-- If applies_to_all is true on the component, no row is needed here
-- (the run picks up the default). This table is for opt-ins and for
-- per-staff amount overrides (e.g. "Sarah's housing is 40k, not the
-- default 30k").
CREATE TABLE IF NOT EXISTS payroll_staff_components (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  staff_id uuid NOT NULL REFERENCES staff_members(id) ON DELETE CASCADE,
  component_id uuid NOT NULL REFERENCES payroll_components(id) ON DELETE CASCADE,
  override_amount numeric(12,2),               -- NULL = use the component's default_amount
  active boolean NOT NULL DEFAULT true,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(staff_id, component_id)
);

CREATE INDEX IF NOT EXISTS idx_payroll_sc_staff ON payroll_staff_components(staff_id);
CREATE INDEX IF NOT EXISTS idx_payroll_sc_org ON payroll_staff_components(organization_id);

-- ==========================================================
-- 3. RUNS -- one monthly payroll period per org
-- ==========================================================
CREATE TABLE IF NOT EXISTS payroll_runs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  period_month integer NOT NULL,               -- 1-12
  period_year integer NOT NULL,
  label text,                                  -- e.g. 'September 2026 payroll'
  status text NOT NULL DEFAULT 'draft',        -- 'draft', 'finalized', 'paid'
  total_gross numeric(14,2) NOT NULL DEFAULT 0,
  total_deductions numeric(14,2) NOT NULL DEFAULT 0,
  total_net numeric(14,2) NOT NULL DEFAULT 0,
  staff_count integer NOT NULL DEFAULT 0,
  finalized_at timestamptz,
  paid_at timestamptz,
  notes text,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(organization_id, period_year, period_month)
);

CREATE INDEX IF NOT EXISTS idx_payroll_runs_org ON payroll_runs(organization_id, period_year, period_month);

-- ==========================================================
-- 4. PAYSLIPS -- one row per staff per run, snapshotted
-- ==========================================================
-- Once a payslip exists, later edits to the staff's salary or their
-- component list do NOT change the numbers here -- payslips are a
-- historical record of what was actually paid. Regenerating a run
-- (only allowed while its status is 'draft') deletes the old payslips
-- and rebuilds them.
CREATE TABLE IF NOT EXISTS payroll_payslips (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id uuid NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES staff_members(id) ON DELETE CASCADE,
  staff_name text NOT NULL,                    -- snapshotted, so renaming staff later doesn't rewrite history
  staff_code text NOT NULL,
  basic_salary numeric(12,2) NOT NULL DEFAULT 0,
  total_allowances numeric(12,2) NOT NULL DEFAULT 0,
  total_deductions numeric(12,2) NOT NULL DEFAULT 0,
  gross_pay numeric(12,2) NOT NULL DEFAULT 0,   -- basic + allowances
  net_pay numeric(12,2) NOT NULL DEFAULT 0,     -- gross - deductions
  lines jsonb NOT NULL DEFAULT '[]',            -- [{name, code, type, amount}] snapshot of every component line
  payment_status text NOT NULL DEFAULT 'unpaid',-- 'unpaid', 'paid'
  paid_at timestamptz,
  payment_reference text,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  UNIQUE(run_id, staff_id)
);

CREATE INDEX IF NOT EXISTS idx_payslips_run ON payroll_payslips(run_id);
CREATE INDEX IF NOT EXISTS idx_payslips_staff ON payroll_payslips(staff_id);
CREATE INDEX IF NOT EXISTS idx_payslips_org ON payroll_payslips(organization_id);

-- ==========================================================
-- 5. RLS -- tenant-isolated from the start via current_user_org_id()
-- ==========================================================
ALTER TABLE payroll_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_staff_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_payslips ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_payroll_components_all ON payroll_components;
CREATE POLICY tenant_payroll_components_all ON payroll_components FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

DROP POLICY IF EXISTS tenant_payroll_staff_components_all ON payroll_staff_components;
CREATE POLICY tenant_payroll_staff_components_all ON payroll_staff_components FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

DROP POLICY IF EXISTS tenant_payroll_runs_all ON payroll_runs;
CREATE POLICY tenant_payroll_runs_all ON payroll_runs FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

DROP POLICY IF EXISTS tenant_payroll_payslips_all ON payroll_payslips;
CREATE POLICY tenant_payroll_payslips_all ON payroll_payslips FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

-- ==========================================================
-- 6. STATS RPC -- fast counts for the dashboard tiles
-- ==========================================================
CREATE OR REPLACE FUNCTION payroll_stats()
RETURNS TABLE (
  total_staff_on_payroll bigint,
  total_monthly_gross numeric,
  active_components bigint,
  draft_runs bigint,
  unpaid_this_month bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := current_user_org_id();
  v_current_year integer := EXTRACT(YEAR FROM CURRENT_DATE)::integer;
  v_current_month integer := EXTRACT(MONTH FROM CURRENT_DATE)::integer;
BEGIN
  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM staff_members s WHERE s.organization_id = v_org AND s.status = 'active') as total_staff_on_payroll,
    (SELECT COALESCE(SUM(s.salary), 0) FROM staff_members s WHERE s.organization_id = v_org AND s.status = 'active') as total_monthly_gross,
    (SELECT COUNT(*) FROM payroll_components c WHERE c.organization_id = v_org AND c.active = true) as active_components,
    (SELECT COUNT(*) FROM payroll_runs r WHERE r.organization_id = v_org AND r.status = 'draft') as draft_runs,
    (SELECT COUNT(*) FROM payroll_payslips p
       JOIN payroll_runs r ON r.id = p.run_id
       WHERE p.organization_id = v_org AND r.period_year = v_current_year AND r.period_month = v_current_month AND p.payment_status = 'unpaid') as unpaid_this_month;
END $$;

GRANT EXECUTE ON FUNCTION payroll_stats() TO authenticated;

-- ==========================================================
-- 7. GENERATE RUN RPC -- builds all payslips atomically
-- ==========================================================
-- Called with an existing draft run's id. Deletes any existing
-- payslips on that run (safe: only draft runs are ever regenerated),
-- then loops over every active staff member and computes their
-- payslip from staff_members.salary + applicable payroll_components
-- (either applies_to_all=true, or opted in via payroll_staff_components).
-- Percent-of-basic components are computed against the staff's basic
-- salary at run time. Fixed-amount components use their default_amount
-- unless overridden per staff.
--
-- Refuses to run on non-draft runs, so a finalized/paid run can never
-- be silently rewritten.
CREATE OR REPLACE FUNCTION payroll_generate_run(p_run_id uuid)
RETURNS TABLE (payslip_count integer, gross_total numeric, net_total numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := current_user_org_id();
  v_run_status text;
  v_staff record;
  v_component record;
  v_basic numeric;
  v_amount numeric;
  v_allowances numeric;
  v_deductions numeric;
  v_gross numeric;
  v_net numeric;
  v_lines jsonb;
  v_count integer := 0;
  v_grand_gross numeric := 0;
  v_grand_deductions numeric := 0;
  v_grand_net numeric := 0;
BEGIN
  SELECT r.status INTO v_run_status FROM payroll_runs r WHERE r.id = p_run_id AND r.organization_id = v_org FOR UPDATE;
  IF v_run_status IS NULL THEN
    RAISE EXCEPTION 'Payroll run not found in this organization';
  END IF;
  IF v_run_status <> 'draft' THEN
    RAISE EXCEPTION 'Only draft runs can be generated (this run is %)', v_run_status;
  END IF;

  DELETE FROM payroll_payslips WHERE run_id = p_run_id;

  FOR v_staff IN
    SELECT s.id, s.staff_code, s.full_name, COALESCE(s.salary, 0) as basic FROM staff_members s
    WHERE s.organization_id = v_org AND s.status = 'active'
  LOOP
    v_basic := v_staff.basic;
    v_allowances := 0;
    v_deductions := 0;
    v_lines := '[]'::jsonb;

    FOR v_component IN
      SELECT c.id, c.name, c.code, c.type, c.calculation_type, c.default_amount,
             sc.override_amount
      FROM payroll_components c
      LEFT JOIN payroll_staff_components sc
        ON sc.component_id = c.id AND sc.staff_id = v_staff.id AND sc.active = true
      WHERE c.organization_id = v_org AND c.active = true
        AND (c.applies_to_all = true OR sc.id IS NOT NULL)
    LOOP
      -- Interpret the value based on calculation_type.
      -- override_amount ALWAYS wins when given, but its interpretation
      -- still follows the component's calculation_type (an override on
      -- a percent-of-basic component means "use this percentage
      -- instead", not "use this absolute amount").
      IF v_component.calculation_type = 'percent_of_basic' THEN
        v_amount := v_basic * (COALESCE(v_component.override_amount, v_component.default_amount) / 100.0);
      ELSE
        v_amount := COALESCE(v_component.override_amount, v_component.default_amount);
      END IF;

      IF v_component.type = 'allowance' THEN
        v_allowances := v_allowances + v_amount;
      ELSE
        v_deductions := v_deductions + v_amount;
      END IF;

      v_lines := v_lines || jsonb_build_object(
        'name', v_component.name,
        'code', v_component.code,
        'type', v_component.type,
        'amount', v_amount
      );
    END LOOP;

    v_gross := v_basic + v_allowances;
    v_net := v_gross - v_deductions;

    INSERT INTO payroll_payslips (
      run_id, staff_id, staff_name, staff_code, basic_salary,
      total_allowances, total_deductions, gross_pay, net_pay, lines,
      organization_id
    ) VALUES (
      p_run_id, v_staff.id, v_staff.full_name, v_staff.staff_code, v_basic,
      v_allowances, v_deductions, v_gross, v_net, v_lines,
      v_org
    );

    v_count := v_count + 1;
    v_grand_gross := v_grand_gross + v_gross;
    v_grand_deductions := v_grand_deductions + v_deductions;
    v_grand_net := v_grand_net + v_net;
  END LOOP;

  UPDATE payroll_runs
  SET total_gross = v_grand_gross,
      total_deductions = v_grand_deductions,
      total_net = v_grand_net,
      staff_count = v_count
  WHERE id = p_run_id;

  RETURN QUERY SELECT v_count, v_grand_gross, v_grand_net;
END $$;

GRANT EXECUTE ON FUNCTION payroll_generate_run(uuid) TO authenticated;

-- ==========================================================
-- 8. FINALIZE / MARK-PAID RPCs
-- ==========================================================
-- Finalize locks the numbers in: no more regeneration, no more edits
-- to payslip line items. Payment is a separate step because a school
-- typically approves the run (finalize) before actually running the
-- bank transfer (mark-paid).
CREATE OR REPLACE FUNCTION payroll_finalize_run(p_run_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := current_user_org_id();
  v_status text;
  v_slip_count integer;
BEGIN
  SELECT r.status INTO v_status FROM payroll_runs r WHERE r.id = p_run_id AND r.organization_id = v_org FOR UPDATE;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Payroll run not found in this organization';
  END IF;
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'Only draft runs can be finalized (this run is %)', v_status;
  END IF;

  SELECT COUNT(*) INTO v_slip_count FROM payroll_payslips WHERE run_id = p_run_id;
  IF v_slip_count = 0 THEN
    RAISE EXCEPTION 'Generate the run before finalizing (no payslips exist).';
  END IF;

  UPDATE payroll_runs SET status = 'finalized', finalized_at = now() WHERE id = p_run_id;
END $$;

GRANT EXECUTE ON FUNCTION payroll_finalize_run(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION payroll_mark_run_paid(p_run_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := current_user_org_id();
  v_status text;
BEGIN
  SELECT r.status INTO v_status FROM payroll_runs r WHERE r.id = p_run_id AND r.organization_id = v_org FOR UPDATE;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Payroll run not found in this organization';
  END IF;
  IF v_status <> 'finalized' THEN
    RAISE EXCEPTION 'Only finalized runs can be marked paid (this run is %)', v_status;
  END IF;

  UPDATE payroll_runs SET status = 'paid', paid_at = now() WHERE id = p_run_id;
  UPDATE payroll_payslips
    SET payment_status = 'paid', paid_at = now()
    WHERE run_id = p_run_id AND payment_status = 'unpaid';
END $$;

GRANT EXECUTE ON FUNCTION payroll_mark_run_paid(uuid) TO authenticated;

-- ==========================================================
-- 9. SEED A FEW STARTER COMPONENTS PER ORG (idempotent)
-- ==========================================================
INSERT INTO payroll_components (name, code, type, calculation_type, default_amount, applies_to_all, organization_id)
SELECT 'PAYE Tax', 'PAYE', 'deduction', 'percent_of_basic', 7.5, true, o.id
FROM organizations o
WHERE NOT EXISTS (SELECT 1 FROM payroll_components c WHERE c.organization_id = o.id AND c.code = 'PAYE');

INSERT INTO payroll_components (name, code, type, calculation_type, default_amount, applies_to_all, organization_id)
SELECT 'Pension Contribution', 'PENSION', 'deduction', 'percent_of_basic', 8, true, o.id
FROM organizations o
WHERE NOT EXISTS (SELECT 1 FROM payroll_components c WHERE c.organization_id = o.id AND c.code = 'PENSION');
