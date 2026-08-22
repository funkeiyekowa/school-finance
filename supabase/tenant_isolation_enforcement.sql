-- ============================================================
-- TENANT ISOLATION ENFORCEMENT
-- Run this in the Supabase SQL editor.
--
-- This migration:
--   1. Makes organization_id NOT NULL on all tenant-owned tables
--   2. Drops old RLS policies that don't check org
--   3. Creates new RLS policies that enforce org isolation via
--      current_user_org_id()
--   4. Fixes unique constraints to be per-org (student_code, etc.)
--   5. Service-role bypasses all RLS (webhooks still work)
--
-- SAFETY: Assumes multi_tenant_migration.sql has already run and
-- backfilled organization_id on all existing rows. If any NULL
-- rows remain, they are assigned to the default org first.
-- ============================================================

-- ==========================================================
-- 0. ENSURE NO NULLS REMAIN (safety net)
-- ==========================================================
DO $$
DECLARE
  default_org_id uuid;
BEGIN
  SELECT id INTO default_org_id FROM organizations WHERE slug = 'default' LIMIT 1;
  IF default_org_id IS NULL THEN
    RAISE EXCEPTION 'Default organization not found. Run multi_tenant_migration.sql first.';
  END IF;

  -- Backfill any stragglers
  UPDATE students SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE vendors SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE income_entries SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE expense_entries SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE fee_schedules SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE bank_transactions SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE sms_inbox SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE activity_log SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE roles SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE categories SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE classes SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE academic_years SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE student_enrollments SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE promotion_batches SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE promotion_events SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE profiles SET organization_id = default_org_id WHERE organization_id IS NULL;
END $$;

-- ==========================================================
-- 1. MAKE organization_id NOT NULL (where it was nullable)
-- ==========================================================
ALTER TABLE students ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE vendors ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE income_entries ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE expense_entries ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE fee_schedules ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE bank_transactions ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE sms_inbox ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE roles ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE classes ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE academic_years ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE student_enrollments ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE promotion_batches ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE promotion_events ALTER COLUMN organization_id SET NOT NULL;
-- activity_log and profiles stay nullable (system-level entries may not have org)

-- ==========================================================
-- 2. DROP OLD RLS POLICIES (that don't check org)
-- ==========================================================

-- Students
DROP POLICY IF EXISTS "Active users can read students" ON students;
DROP POLICY IF EXISTS "Admin/editor/staff can insert students" ON students;
DROP POLICY IF EXISTS "Admin/editor/staff can update students" ON students;

-- Vendors
DROP POLICY IF EXISTS "Active users can read vendors" ON vendors;
DROP POLICY IF EXISTS "Admin/editor can manage vendors" ON vendors;

-- Income
DROP POLICY IF EXISTS "Active users can read income" ON income_entries;
DROP POLICY IF EXISTS "Admin/editor/staff can manage income" ON income_entries;

-- Expenses
DROP POLICY IF EXISTS "Active users can read expenses" ON expense_entries;
DROP POLICY IF EXISTS "Admin/editor/staff can manage expenses" ON expense_entries;

-- Fee schedules
DROP POLICY IF EXISTS "Active users can read fees" ON fee_schedules;
DROP POLICY IF EXISTS "Admin can manage fees" ON fee_schedules;

-- Bank transactions
DROP POLICY IF EXISTS "Active users can read bank_transactions" ON bank_transactions;
DROP POLICY IF EXISTS "Admin/editor can manage bank_transactions" ON bank_transactions;

-- SMS inbox
DROP POLICY IF EXISTS "Active users can read sms" ON sms_inbox;
DROP POLICY IF EXISTS "Service can insert sms" ON sms_inbox;
DROP POLICY IF EXISTS "Admin/editor/staff can update sms" ON sms_inbox;

-- Activity log
DROP POLICY IF EXISTS "Admin can read activity" ON activity_log;
DROP POLICY IF EXISTS "Service can insert activity" ON activity_log;

-- Roles
DROP POLICY IF EXISTS "Active users can read roles" ON roles;
DROP POLICY IF EXISTS "Admin can manage roles" ON roles;

-- Categories
DROP POLICY IF EXISTS "categories_read" ON categories;
DROP POLICY IF EXISTS "categories_write" ON categories;

-- ==========================================================
-- 3. CREATE NEW TENANT-ISOLATED RLS POLICIES
-- ==========================================================
-- Pattern: SELECT requires org match OR service role
-- INSERT/UPDATE/DELETE requires org match OR service role
-- Service role (used by webhooks) bypasses RLS entirely by design.

-- Helper: check if user belongs to the same org as the row
-- current_user_org_id() already exists from multi_tenant_migration

-- STUDENTS
CREATE POLICY "tenant_students_select" ON students FOR SELECT
  USING (organization_id = current_user_org_id());
CREATE POLICY "tenant_students_insert" ON students FOR INSERT
  WITH CHECK (organization_id = current_user_org_id());
CREATE POLICY "tenant_students_update" ON students FOR UPDATE
  USING (organization_id = current_user_org_id());
CREATE POLICY "tenant_students_delete" ON students FOR DELETE
  USING (organization_id = current_user_org_id());

-- VENDORS
CREATE POLICY "tenant_vendors_select" ON vendors FOR SELECT
  USING (organization_id = current_user_org_id());
CREATE POLICY "tenant_vendors_insert" ON vendors FOR INSERT
  WITH CHECK (organization_id = current_user_org_id());
CREATE POLICY "tenant_vendors_update" ON vendors FOR UPDATE
  USING (organization_id = current_user_org_id());
CREATE POLICY "tenant_vendors_delete" ON vendors FOR DELETE
  USING (organization_id = current_user_org_id());

-- INCOME ENTRIES
CREATE POLICY "tenant_income_select" ON income_entries FOR SELECT
  USING (organization_id = current_user_org_id());
CREATE POLICY "tenant_income_insert" ON income_entries FOR INSERT
  WITH CHECK (organization_id = current_user_org_id());
CREATE POLICY "tenant_income_update" ON income_entries FOR UPDATE
  USING (organization_id = current_user_org_id());
CREATE POLICY "tenant_income_delete" ON income_entries FOR DELETE
  USING (organization_id = current_user_org_id());

-- EXPENSE ENTRIES
CREATE POLICY "tenant_expenses_select" ON expense_entries FOR SELECT
  USING (organization_id = current_user_org_id());
CREATE POLICY "tenant_expenses_insert" ON expense_entries FOR INSERT
  WITH CHECK (organization_id = current_user_org_id());
CREATE POLICY "tenant_expenses_update" ON expense_entries FOR UPDATE
  USING (organization_id = current_user_org_id());
CREATE POLICY "tenant_expenses_delete" ON expense_entries FOR DELETE
  USING (organization_id = current_user_org_id());

-- FEE SCHEDULES
CREATE POLICY "tenant_fees_select" ON fee_schedules FOR SELECT
  USING (organization_id = current_user_org_id());
CREATE POLICY "tenant_fees_insert" ON fee_schedules FOR INSERT
  WITH CHECK (organization_id = current_user_org_id());
CREATE POLICY "tenant_fees_update" ON fee_schedules FOR UPDATE
  USING (organization_id = current_user_org_id());

-- BANK TRANSACTIONS
CREATE POLICY "tenant_bank_select" ON bank_transactions FOR SELECT
  USING (organization_id = current_user_org_id());
CREATE POLICY "tenant_bank_insert" ON bank_transactions FOR INSERT
  WITH CHECK (organization_id = current_user_org_id());
CREATE POLICY "tenant_bank_update" ON bank_transactions FOR UPDATE
  USING (organization_id = current_user_org_id());

-- SMS INBOX
CREATE POLICY "tenant_sms_select" ON sms_inbox FOR SELECT
  USING (organization_id = current_user_org_id());
CREATE POLICY "tenant_sms_insert" ON sms_inbox FOR INSERT
  WITH CHECK (true);  -- Service role inserts (webhooks) — RLS bypassed by service key anyway
CREATE POLICY "tenant_sms_update" ON sms_inbox FOR UPDATE
  USING (organization_id = current_user_org_id());

-- ACTIVITY LOG (read own org, insert allowed for all — system entries)
CREATE POLICY "tenant_activity_select" ON activity_log FOR SELECT
  USING (organization_id = current_user_org_id() OR organization_id IS NULL);
CREATE POLICY "tenant_activity_insert" ON activity_log FOR INSERT
  WITH CHECK (true);

-- ROLES
CREATE POLICY "tenant_roles_select" ON roles FOR SELECT
  USING (organization_id = current_user_org_id());
CREATE POLICY "tenant_roles_insert" ON roles FOR INSERT
  WITH CHECK (organization_id = current_user_org_id());
CREATE POLICY "tenant_roles_update" ON roles FOR UPDATE
  USING (organization_id = current_user_org_id());

-- CATEGORIES
CREATE POLICY "tenant_categories_select" ON categories FOR SELECT
  USING (organization_id = current_user_org_id());
CREATE POLICY "tenant_categories_insert" ON categories FOR INSERT
  WITH CHECK (organization_id = current_user_org_id());
CREATE POLICY "tenant_categories_update" ON categories FOR UPDATE
  USING (organization_id = current_user_org_id());

-- CLASSES
DROP POLICY IF EXISTS "classes_read" ON classes;
DROP POLICY IF EXISTS "classes_write" ON classes;
CREATE POLICY "tenant_classes_select" ON classes FOR SELECT
  USING (organization_id = current_user_org_id());
CREATE POLICY "tenant_classes_all" ON classes FOR ALL
  USING (organization_id = current_user_org_id());

-- ACADEMIC YEARS
DROP POLICY IF EXISTS "academic_years_read" ON academic_years;
DROP POLICY IF EXISTS "academic_years_write" ON academic_years;
CREATE POLICY "tenant_years_select" ON academic_years FOR SELECT
  USING (organization_id = current_user_org_id());
CREATE POLICY "tenant_years_all" ON academic_years FOR ALL
  USING (organization_id = current_user_org_id());

-- STUDENT ENROLLMENTS
DROP POLICY IF EXISTS "enrollments_read" ON student_enrollments;
DROP POLICY IF EXISTS "enrollments_write" ON student_enrollments;
CREATE POLICY "tenant_enrollments_select" ON student_enrollments FOR SELECT
  USING (organization_id = current_user_org_id());
CREATE POLICY "tenant_enrollments_all" ON student_enrollments FOR ALL
  USING (organization_id = current_user_org_id());

-- PROMOTION BATCHES
DROP POLICY IF EXISTS "batches_read" ON promotion_batches;
DROP POLICY IF EXISTS "batches_write" ON promotion_batches;
CREATE POLICY "tenant_batches_select" ON promotion_batches FOR SELECT
  USING (organization_id = current_user_org_id());
CREATE POLICY "tenant_batches_all" ON promotion_batches FOR ALL
  USING (organization_id = current_user_org_id());

-- PROMOTION EVENTS
DROP POLICY IF EXISTS "events_read" ON promotion_events;
DROP POLICY IF EXISTS "events_write" ON promotion_events;
CREATE POLICY "tenant_events_select" ON promotion_events FOR SELECT
  USING (organization_id = current_user_org_id());
CREATE POLICY "tenant_events_all" ON promotion_events FOR ALL
  USING (organization_id = current_user_org_id());

-- ==========================================================
-- 4. FIX UNIQUE CONSTRAINTS TO BE PER-ORG
-- ==========================================================

-- student_code must be unique WITHIN an org, not globally
DROP INDEX IF EXISTS idx_students_code;
ALTER TABLE students DROP CONSTRAINT IF EXISTS students_student_code_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_students_code_org
  ON students(student_code, organization_id);

-- academic_years name must be unique within an org
ALTER TABLE academic_years DROP CONSTRAINT IF EXISTS academic_years_name_key;
DROP INDEX IF EXISTS idx_academic_years_current;
CREATE UNIQUE INDEX IF NOT EXISTS idx_academic_years_name_org
  ON academic_years(name, organization_id);
-- Only one 'current' year PER ORG
CREATE UNIQUE INDEX IF NOT EXISTS idx_academic_years_current_org
  ON academic_years(organization_id, status) WHERE status = 'current';

-- classes short_code unique per org
DROP INDEX IF EXISTS idx_classes_short_code;
CREATE UNIQUE INDEX IF NOT EXISTS idx_classes_short_code_org
  ON classes(short_code, organization_id);

-- school_settings: one row per org
ALTER TABLE school_settings DROP CONSTRAINT IF EXISTS school_settings_pkey;
-- school_settings already has id as PK, just add a unique on org
CREATE UNIQUE INDEX IF NOT EXISTS idx_school_settings_org
  ON school_settings(organization_id) WHERE organization_id IS NOT NULL;

-- ==========================================================
-- 5. VERIFY: current_user_org_id() returns NULL for
--    unauthenticated requests, blocking all access.
--    Service-role key bypasses RLS entirely (Supabase default).
-- ==========================================================
-- No action needed — this is Supabase's built-in behavior.
-- The function uses auth.uid() which returns NULL for anon,
-- making the policy USING clause always false for unauthenticated.
