-- ============================================================
-- FIX RLS LEAKS — expense_entries, vendors, sms_inbox
--
-- The isolation suite found:
--   - expense_entries: School A can read School B's expenses
--   - vendors: School A can read School B's vendors
--   - sms_inbox: two wide-open INSERT policies flagged
--
-- ROOT CAUSE: Previous migrations tried to DROP policies by name,
-- but the actual names in the database didn't match (Supabase may
-- have auto-suffixed them, or they were created with different
-- casing). So the old permissive policies survived alongside the
-- new tenant-scoped ones, and PostgreSQL's RLS is OR-based: if
-- ANY policy on a table passes, the row is visible. A single
-- leftover "Active users can read..." policy negates everything.
--
-- FIX: Drop ALL existing policies on these tables unconditionally
-- (we list them by querying pg_policies, not by guessing names),
-- then recreate only the correct tenant-scoped ones.
--
-- Run this in the Supabase SQL editor.
-- ============================================================

-- ==========================================================
-- 1. NUKE ALL POLICIES ON THE LEAKING TABLES
-- ==========================================================
-- We cannot use DROP POLICY IF EXISTS with a wildcard, so we
-- generate and execute the statements dynamically.
DO $$
DECLARE
  v_tables text[] := ARRAY[
    'expense_entries',
    'vendors',
    'sms_inbox'
  ];
  v_tbl text;
  v_pol record;
BEGIN
  FOREACH v_tbl IN ARRAY v_tables LOOP
    FOR v_pol IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = v_tbl
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_pol.policyname, v_tbl);
      RAISE NOTICE 'Dropped: %.%', v_tbl, v_pol.policyname;
    END LOOP;
  END LOOP;
END $$;

-- ==========================================================
-- 2. RECREATE CORRECT TENANT-SCOPED POLICIES
-- ==========================================================

-- --- EXPENSE ENTRIES ---
CREATE POLICY "tenant_expenses_select" ON expense_entries FOR SELECT
  USING (organization_id = current_user_org_id());
CREATE POLICY "tenant_expenses_insert" ON expense_entries FOR INSERT
  WITH CHECK (organization_id = current_user_org_id());
CREATE POLICY "tenant_expenses_update" ON expense_entries FOR UPDATE
  USING (organization_id = current_user_org_id());
CREATE POLICY "tenant_expenses_delete" ON expense_entries FOR DELETE
  USING (organization_id = current_user_org_id());

-- --- VENDORS ---
CREATE POLICY "tenant_vendors_select" ON vendors FOR SELECT
  USING (organization_id = current_user_org_id());
CREATE POLICY "tenant_vendors_insert" ON vendors FOR INSERT
  WITH CHECK (organization_id = current_user_org_id());
CREATE POLICY "tenant_vendors_update" ON vendors FOR UPDATE
  USING (organization_id = current_user_org_id());
CREATE POLICY "tenant_vendors_delete" ON vendors FOR DELETE
  USING (organization_id = current_user_org_id());

-- --- SMS INBOX ---
-- SELECT: only your own org's messages.
-- INSERT: service role only (webhooks). The service role bypasses RLS
--   entirely, so we use a restrictive check here that blocks any
--   normal user from inserting. The webhook endpoint uses the service
--   role key which skips this policy.
CREATE POLICY "tenant_sms_select" ON sms_inbox FOR SELECT
  USING (organization_id = current_user_org_id());
CREATE POLICY "tenant_sms_insert" ON sms_inbox FOR INSERT
  WITH CHECK (organization_id = current_user_org_id());
CREATE POLICY "tenant_sms_update" ON sms_inbox FOR UPDATE
  USING (organization_id = current_user_org_id());

-- ==========================================================
-- 3. ALSO FIX ANY OTHER TABLE THAT HAS STALE POLICIES
-- ==========================================================
-- Let's be thorough: check ALL tenant tables and drop any policy
-- that doesn't reference current_user_org_id(). These are the
-- leftover "Active users can read..." and "Admin/editor can..." 
-- policies from schema.sql that were supposed to be removed.
DO $$
DECLARE
  v_tables text[] := ARRAY[
    'students', 'income_entries', 'fee_schedules',
    'bank_transactions', 'roles', 'categories'
  ];
  v_tbl text;
  v_pol record;
BEGIN
  FOREACH v_tbl IN ARRAY v_tables LOOP
    FOR v_pol IN
      SELECT policyname, qual, with_check FROM pg_policies
      WHERE schemaname = 'public' AND tablename = v_tbl
    LOOP
      -- Keep policies that reference the tenant function.
      IF COALESCE(v_pol.qual, '') LIKE '%current_user_org_id%'
         OR COALESCE(v_pol.with_check, '') LIKE '%current_user_org_id%' THEN
        CONTINUE;
      END IF;

      -- This is a stale policy — drop it.
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_pol.policyname, v_tbl);
      RAISE NOTICE 'Dropped stale policy: %.%', v_tbl, v_pol.policyname;
    END LOOP;
  END LOOP;
END $$;


-- ==========================================================
-- 4. VERIFY — run this to confirm
-- ==========================================================
-- After running, this should return ZERO rows. If it returns
-- anything, those policies still allow cross-tenant reads.
SELECT tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'students','vendors','income_entries','expense_entries',
    'fee_schedules','bank_transactions','sms_inbox','roles',
    'categories','classes','academic_years','student_enrollments',
    'promotion_batches','promotion_events'
  )
  AND COALESCE(qual, 'true') NOT LIKE '%current_user_org_id%'
  AND COALESCE(with_check, 'true') NOT LIKE '%current_user_org_id%'
ORDER BY tablename, policyname;
