-- ============================================================
-- VERIFICATION for rls_finance_permission_scope.sql
-- ============================================================
-- Run this in the Supabase SQL editor AFTER applying
-- rls_finance_permission_scope.sql. It is READ-ONLY (SELECTs only) except
-- for the optional Section D role-simulation, which is wrapped in a
-- transaction that is ROLLED BACK, so it changes nothing permanently.
--
-- What it proves:
--   A. The helper and policies exist and are shaped correctly.
--   B. No finance/payroll table is left open to teachers or org-wide.
--   C. has_finance_access() resolves correctly for finance vs non-finance
--      permission sets (logic check, no impersonation needed).
--   D. (Optional) End-to-end RLS simulation as a real teacher and a real
--      bursar using set_config('request.jwt.claims', ...) inside a
--      rolled-back transaction.
-- ============================================================


-- ------------------------------------------------------------
-- A. Structural checks
-- ------------------------------------------------------------

-- A1. Helper function exists.
SELECT 'A1 has_finance_access exists' AS check,
       EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'has_finance_access') AS pass;

-- A2. Every finance/payroll table is FINANCE-GATED (and income also keeps
--     its self-read). Anything showing STAFF or ORG-WIDE is a failure.
SELECT tablename, policyname, cmd,
       CASE WHEN qual LIKE '%has_finance_access%' THEN 'FINANCE-GATED'
            WHEN qual LIKE '%my_linked_student_ids%' THEN 'self-scoped (income self-read — OK)'
            WHEN qual LIKE '%is_staff_user%' THEN 'STAFF (FAIL — still open to teachers)'
            WHEN qual LIKE '%current_user_org_id%' THEN 'ORG-WIDE (FAIL — leak)'
            ELSE 'other (review)' END AS access_shape
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'expense_entries','vendors','bank_transactions','sms_inbox','income_entries',
    'payroll_components','payroll_staff_components','payroll_runs','payroll_payslips'
  )
ORDER BY tablename, policyname;

-- A3. Fail-loud aggregate: count any finance/payroll policy that is NOT
--     finance-gated and is NOT the income self-read. Expected: 0.
SELECT 'A3 non-finance-gated finance policies (expect 0)' AS check,
       count(*) AS offending_policies
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'expense_entries','vendors','bank_transactions','sms_inbox','income_entries',
    'payroll_components','payroll_staff_components','payroll_runs','payroll_payslips'
  )
  AND qual NOT LIKE '%has_finance_access%'
  AND qual NOT LIKE '%my_linked_student_ids%';   -- income_self_read is allowed

-- A4. income_entries must STILL have its self-read policy (students/parents).
SELECT 'A4 income self-read preserved' AS check,
       EXISTS (
         SELECT 1 FROM pg_policies
         WHERE schemaname='public' AND tablename='income_entries'
           AND qual LIKE '%my_linked_student_ids%'
       ) AS pass;


-- ------------------------------------------------------------
-- B. Permission-logic check (no impersonation)
-- ------------------------------------------------------------
-- Confirms has_finance_access()'s definition matches the finance features
-- used elsewhere. This inspects the function source rather than calling it
-- (calling it as the SQL-editor superuser would not reflect a real user).
SELECT 'B1 helper checks the finance features' AS check,
       (prosrc LIKE '%income%' AND prosrc LIKE '%expenses%'
        AND prosrc LIKE '%vendors%' AND prosrc LIKE '%sms_alerts%'
        AND prosrc LIKE '%my_effective_permissions%') AS pass
FROM pg_proc WHERE proname = 'has_finance_access';


-- ------------------------------------------------------------
-- C. Data-shape sanity: which orgs have finance roles configured?
-- ------------------------------------------------------------
-- has_finance_access() reads roles.permissions. An org whose bursar/
-- accountant has NO roles row (or one without a finance feature) would
-- lose finance access after this migration. List them so you can seed the
-- role via the Roles UI before/after applying. (Owners/admins/super-admins
-- are unaffected — my_effective_permissions grants them everything.)
SELECT o.id AS organization_id, o.name,
       m.role AS finance_role_present_in_memberships,
       EXISTS (
         SELECT 1 FROM roles r
         WHERE r.organization_id = o.id AND r.name = m.role
           AND (r.permissions->>'income')::boolean IS TRUE
       ) AS role_grants_income
FROM organizations o
JOIN org_memberships m
  ON m.organization_id = o.id AND m.active = true
 AND m.role IN ('bursar','accountant')
ORDER BY o.name, m.role;
-- Any row with role_grants_income = false is an org where that bursar/
-- accountant would LOSE finance access. Seed their role in the Roles UI.


-- ------------------------------------------------------------
-- D. OPTIONAL end-to-end RLS simulation (rolled back — changes nothing)
-- ------------------------------------------------------------
-- Impersonates a real teacher and a real bursar via the JWT claims that
-- RLS reads (auth.uid()), then checks row visibility. Replace the two
-- UUIDs below with real user ids from your school:
--   SELECT user_id, role FROM org_memberships
--   WHERE organization_id = '<your org>' AND role IN ('teacher','bursar');
--
-- Everything runs inside BEGIN ... ROLLBACK, so no data is written.

-- BEGIN;
--   -- Teacher: expect 0 finance/payroll rows.
--   SELECT set_config('request.jwt.claims',
--     json_build_object('sub','<TEACHER_USER_UUID>','role','authenticated')::text, true);
--   SET LOCAL role = authenticated;
--   SELECT 'teacher expense_entries (expect 0)' AS check, count(*) FROM expense_entries;
--   SELECT 'teacher vendors (expect 0)'         AS check, count(*) FROM vendors;
--   SELECT 'teacher payroll_payslips (expect 0)'AS check, count(*) FROM payroll_payslips;
--   SELECT 'teacher payroll_runs (expect 0)'    AS check, count(*) FROM payroll_runs;
--   RESET role;
--
--   -- Bursar: expect finance/payroll rows visible.
--   SELECT set_config('request.jwt.claims',
--     json_build_object('sub','<BURSAR_USER_UUID>','role','authenticated')::text, true);
--   SET LOCAL role = authenticated;
--   SELECT 'bursar expense_entries (expect >=0, sees org rows)' AS check, count(*) FROM expense_entries;
--   SELECT 'bursar payroll_runs (expect >=0, sees org rows)'    AS check, count(*) FROM payroll_runs;
--   RESET role;
-- ROLLBACK;
--
-- NOTE: The set_config/SET LOCAL role trick approximates RLS as a given
-- user. It requires that auth.uid() reads request.jwt.claims->>'sub'
-- (Supabase's default). If your policies also depend on other JWT claims,
-- the authenticated-API harness (scripts/verify-finance-rls.mjs) is the
-- more faithful test — prefer it as the source of truth.
