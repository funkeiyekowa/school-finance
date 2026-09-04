-- ============================================================
-- RLS: scope finance / payroll / vendor / bank / SMS data to users
--      whose EXISTING permissions authorize finance access
-- ============================================================
-- Run order: after rls_role_scoped_access.sql (#50), payroll_module.sql,
--   and saas_foundation.sql (all already applied). Idempotent — safe to
--   re-run. No data is modified; only RLS policies + one helper function.
--
-- WHY
-- ---
-- rls_role_scoped_access.sql gates a set of "staff-only" tables with
-- is_staff_user(), which returns true for EVERY staff role — including
-- 'teacher' and 'viewer'. So a teacher (or any staff role) could directly
-- read expense_entries / vendors / bank_transactions / sms_inbox / income
-- via the Supabase API even though the app now hides the finance pages
-- from them. Separately, the payroll tables (payroll_module.sql) shipped
-- with a bare `organization_id = current_user_org_id()` policy and NO
-- staff gate at all — meaning any active member, INCLUDING A STUDENT OR
-- PARENT, could read every staff member's salary and payslips.
--
-- APPROACH — reuse the existing permission model, do NOT hard-code roles
-- ----------------------------------------------------------------------
-- The app already resolves per-user finance authorization via
-- my_effective_permissions() (saas_foundation.sql): owners/admins/
-- super-admins get everything; every other role gets the permission jsonb
-- from its org-scoped roles row (bursar/accountant presets grant income/
-- expenses/etc.). This migration adds has_finance_access() that reuses
-- that exact resolver, so:
--   • bursar / accountant  -> allowed (their role grants income/expenses)
--   • admin / owner / super_admin -> allowed (get everything)
--   • teacher / viewer / plain staff -> denied UNLESS their org's role
--     config explicitly grants a finance feature (fully configurable per
--     school through the existing Roles UI — no code change needed).
-- No new hard-coded role list is introduced; authorization stays driven
-- by roles.permissions.

-- ------------------------------------------------------------
-- Helper: does the caller's effective permission set grant finance access?
-- ------------------------------------------------------------
-- True if my_effective_permissions() grants ANY finance-area feature.
-- STABLE + SECURITY DEFINER (mirrors the helpers it builds on). Resolves
-- the caller from auth.uid() only — never trusts client input.
CREATE OR REPLACE FUNCTION public.has_finance_access()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT
      (p->>'income')::boolean IS TRUE
      OR (p->>'expenses')::boolean IS TRUE
      OR (p->>'receipts')::boolean IS TRUE
      OR (p->>'reconciliation')::boolean IS TRUE
      OR (p->>'vendors')::boolean IS TRUE
      OR (p->>'sms_alerts')::boolean IS TRUE
      OR (p->>'student_finance')::boolean IS TRUE
      OR (p->>'finance_overview')::boolean IS TRUE
    FROM (SELECT public.my_effective_permissions() AS p) q
  ), false);
$$;
GRANT EXECUTE ON FUNCTION public.has_finance_access() TO authenticated;

-- ------------------------------------------------------------
-- 1. Finance ledgers, vendors, bank, SMS — replace the is_staff_user()
--    gate with has_finance_access(). Students/parents keep NO access
--    (they never had it); income keeps its self-read policy.
-- ------------------------------------------------------------

-- expense_entries: finance-only (no self policy — students never see expenses)
DROP POLICY IF EXISTS expense_entries_staff_all ON public.expense_entries;
CREATE POLICY expense_entries_finance_all ON public.expense_entries FOR ALL
  USING (organization_id = current_user_org_id() AND public.has_finance_access())
  WITH CHECK (organization_id = current_user_org_id() AND public.has_finance_access());

-- vendors
DROP POLICY IF EXISTS vendors_staff_all ON public.vendors;
CREATE POLICY vendors_finance_all ON public.vendors FOR ALL
  USING (organization_id = current_user_org_id() AND public.has_finance_access())
  WITH CHECK (organization_id = current_user_org_id() AND public.has_finance_access());

-- bank_transactions
DROP POLICY IF EXISTS bank_transactions_staff_all ON public.bank_transactions;
CREATE POLICY bank_transactions_finance_all ON public.bank_transactions FOR ALL
  USING (organization_id = current_user_org_id() AND public.has_finance_access())
  WITH CHECK (organization_id = current_user_org_id() AND public.has_finance_access());

-- sms_inbox (payment alerts)
DROP POLICY IF EXISTS sms_inbox_staff_all ON public.sms_inbox;
CREATE POLICY sms_inbox_finance_all ON public.sms_inbox FOR ALL
  USING (organization_id = current_user_org_id() AND public.has_finance_access())
  WITH CHECK (organization_id = current_user_org_id() AND public.has_finance_access());

-- income_entries: finance staff get all; student/parent keep self-read.
DROP POLICY IF EXISTS income_staff_all ON public.income_entries;
CREATE POLICY income_finance_all ON public.income_entries FOR ALL
  USING (organization_id = current_user_org_id() AND public.has_finance_access())
  WITH CHECK (organization_id = current_user_org_id() AND public.has_finance_access());
-- (income_self_read from rls_role_scoped_access.sql is left intact so a
--  student/parent still sees their own family's payments.)

-- ------------------------------------------------------------
-- 2. Payroll — currently org-wide with NO staff gate. Lock to finance
--    access. This closes a student/parent-readable salary leak.
-- ------------------------------------------------------------
DO $$
DECLARE t text;
  payroll_tables text[] := ARRAY[
    'payroll_components','payroll_staff_components','payroll_runs','payroll_payslips'
  ];
BEGIN
  FOREACH t IN ARRAY payroll_tables LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema='public' AND table_name=t) THEN CONTINUE; END IF;
    -- Drop the known bare-tenant policy names from payroll_module.sql.
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'tenant_' || t || '_all', t);
    -- Also drop any prior run of this migration's policy.
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_finance_all', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I FOR ALL
      USING (organization_id = current_user_org_id() AND public.has_finance_access())
      WITH CHECK (organization_id = current_user_org_id() AND public.has_finance_access())
    $f$, t || '_finance_all', t);
  END LOOP;
END $$;

-- ============================================================
-- Verification
-- ============================================================
-- 1. Helper exists.
SELECT proname FROM pg_proc WHERE proname = 'has_finance_access';

-- 2. Every finance/payroll table's policy is now finance-gated (should show
--    has_finance_access for each; income_entries also shows its self-read).
SELECT tablename, policyname, cmd,
       CASE WHEN qual LIKE '%has_finance_access%' THEN 'FINANCE-GATED'
            WHEN qual LIKE '%my_linked_student_ids%' THEN 'self-scoped'
            WHEN qual LIKE '%is_staff_user%' THEN 'STAFF (still open to teachers — review)'
            WHEN qual LIKE '%current_user_org_id%' THEN 'ORG-WIDE (LEAK — review)'
            ELSE 'other' END AS access_shape
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'expense_entries','vendors','bank_transactions','sms_inbox','income_entries',
    'payroll_components','payroll_staff_components','payroll_runs','payroll_payslips'
  )
ORDER BY tablename, policyname;

-- 3. Manual check after applying: sign in as a teacher and confirm
--    SELECT on expense_entries / payroll_payslips returns 0 rows; sign in
--    as a bursar and confirm both return rows.
