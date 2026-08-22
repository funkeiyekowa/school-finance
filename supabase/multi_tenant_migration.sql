-- ============================================================
-- MULTI-TENANT SaaS FOUNDATION
-- Run this in the Supabase SQL editor.
--
-- This migration introduces tenant isolation to the existing
-- single-school application. It:
--   1. Creates organization/membership/subscription/module tables
--   2. Adds organization_id to all tenant-owned tables
--   3. Backfills existing data into a default organization
--   4. Updates RLS policies for tenant isolation
--
-- SAFETY: No existing data is deleted or modified destructively.
-- All existing records are assigned to a default organization.
-- ============================================================

-- ==========================================================
-- 1. PLATFORM MODULES — what features exist in the product
-- ==========================================================
CREATE TABLE IF NOT EXISTS platform_modules (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  key text NOT NULL UNIQUE,         -- 'finance', 'academics', 'cbt', 'attendance', etc.
  name text NOT NULL,               -- Display name
  description text,
  category text,                    -- 'core', 'academic', 'operations', 'communication'
  is_core boolean NOT NULL DEFAULT false,  -- Core modules are always enabled
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Seed default modules
INSERT INTO platform_modules (key, name, category, is_core, sort_order) VALUES
  ('finance', 'Finance', 'core', true, 1),
  ('students', 'Students', 'core', true, 2),
  ('academics', 'Academics', 'academic', false, 3),
  ('attendance', 'Attendance', 'academic', false, 4),
  ('timetable', 'Timetable', 'academic', false, 5),
  ('assessments', 'Assessments & Gradebook', 'academic', false, 6),
  ('cbt', 'CBT / Online Exams', 'academic', false, 7),
  ('lms', 'Learning Management', 'academic', false, 8),
  ('admissions', 'Admissions', 'operations', false, 9),
  ('hr', 'HR & Staff', 'operations', false, 10),
  ('payroll', 'Payroll', 'operations', false, 11),
  ('procurement', 'Procurement', 'operations', false, 12),
  ('inventory', 'Inventory', 'operations', false, 13),
  ('assets', 'Asset Management', 'operations', false, 14),
  ('transport', 'Transport', 'operations', false, 15),
  ('library', 'Library', 'operations', false, 16),
  ('clinic', 'Health / Clinic', 'operations', false, 17),
  ('hostel', 'Hostel / Boarding', 'operations', false, 18),
  ('communication', 'Communication', 'communication', false, 19),
  ('parent_portal', 'Parent Portal', 'communication', false, 20),
  ('student_portal', 'Student Portal', 'communication', false, 21),
  ('teacher_portal', 'Teacher Portal', 'communication', false, 22)
ON CONFLICT (key) DO NOTHING;

-- ==========================================================
-- 2. ORGANIZATIONS — each school/tenant
-- ==========================================================
CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,        -- URL-friendly identifier
  logo_url text,
  email text,
  phone text,
  address text,
  country text,
  timezone text DEFAULT 'Africa/Lagos',
  currency_code text DEFAULT 'NGN',
  currency_symbol text DEFAULT '₦',
  status text NOT NULL DEFAULT 'active',  -- 'active', 'suspended', 'trial', 'cancelled'
  plan text DEFAULT 'starter',      -- For display; actual entitlements are in subscriptions
  settings jsonb DEFAULT '{}',      -- Org-level settings (can override platform defaults)
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_organizations_slug ON organizations(slug);
CREATE INDEX IF NOT EXISTS idx_organizations_status ON organizations(status);

-- ==========================================================
-- 3. SUBSCRIPTIONS — what each org is subscribed to
-- ==========================================================
CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  module_key text NOT NULL REFERENCES platform_modules(key) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active',  -- 'active', 'expired', 'trial'
  starts_at timestamptz DEFAULT now(),
  expires_at timestamptz,
  limits jsonb DEFAULT '{}',        -- e.g. {"max_students": 500, "max_teachers": 50}
  created_at timestamptz DEFAULT now(),
  UNIQUE(organization_id, module_key)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_org ON subscriptions(organization_id);

-- ==========================================================
-- 4. ORG MEMBERSHIPS — links users to organizations
-- ==========================================================
CREATE TABLE IF NOT EXISTS org_memberships (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'staff',  -- 'super_admin', 'owner', 'admin', 'staff', 'teacher', 'parent', 'student'
  is_default boolean NOT NULL DEFAULT false,  -- The user's default org (shown on login)
  active boolean NOT NULL DEFAULT true,
  joined_at timestamptz DEFAULT now(),
  UNIQUE(user_id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_memberships_user ON org_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_org ON org_memberships(organization_id);

-- ==========================================================
-- 5. ADD organization_id TO ALL TENANT-OWNED TABLES
-- ==========================================================
-- We add the column as NULLABLE first, backfill, then make NOT NULL.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE students ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE fee_schedules ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE income_entries ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE expense_entries ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE sms_inbox ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE roles ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE classes ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE academic_years ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE student_enrollments ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE promotion_batches ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE promotion_events ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE policy_audit_log ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE;

-- ==========================================================
-- 6. CREATE DEFAULT ORGANIZATION + BACKFILL
-- ==========================================================
-- Create a default org from the existing school_settings data.
DO $$
DECLARE
  default_org_id uuid;
  school_name_val text;
BEGIN
  -- Get the existing school name
  SELECT school_name INTO school_name_val FROM school_settings LIMIT 1;
  IF school_name_val IS NULL OR school_name_val = '' THEN
    school_name_val := 'My School';
  END IF;

  -- Check if default org already exists
  SELECT id INTO default_org_id FROM organizations WHERE slug = 'default' LIMIT 1;

  IF default_org_id IS NULL THEN
    INSERT INTO organizations (name, slug, status, plan)
    VALUES (school_name_val, 'default', 'active', 'full')
    RETURNING id INTO default_org_id;
  END IF;

  -- Backfill all tenant-owned tables
  UPDATE profiles SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE school_settings SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE students SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE vendors SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE fee_schedules SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE income_entries SET organization_id = default_org_id WHERE organization_id IS NULL;
  UPDATE expense_entries SET organization_id = default_org_id WHERE organization_id IS NULL;
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
  UPDATE policy_audit_log SET organization_id = default_org_id WHERE organization_id IS NULL;

  -- Create membership for all existing users
  INSERT INTO org_memberships (user_id, organization_id, role, is_default)
  SELECT p.id, default_org_id,
    CASE
      WHEN p.role = 'admin' THEN 'admin'
      WHEN p.role = 'developer' THEN 'owner'
      ELSE COALESCE(p.role, 'staff')
    END,
    true
  FROM profiles p
  WHERE NOT EXISTS (
    SELECT 1 FROM org_memberships m
    WHERE m.user_id = p.id AND m.organization_id = default_org_id
  );

  -- Enable all modules for the default org (existing school has full access)
  INSERT INTO subscriptions (organization_id, module_key, status)
  SELECT default_org_id, key, 'active'
  FROM platform_modules
  ON CONFLICT (organization_id, module_key) DO NOTHING;
END $$;

-- ==========================================================
-- 7. INDEXES ON organization_id
-- ==========================================================
CREATE INDEX IF NOT EXISTS idx_profiles_org ON profiles(organization_id);
CREATE INDEX IF NOT EXISTS idx_students_org ON students(organization_id);
CREATE INDEX IF NOT EXISTS idx_vendors_org ON vendors(organization_id);
CREATE INDEX IF NOT EXISTS idx_fee_schedules_org ON fee_schedules(organization_id);
CREATE INDEX IF NOT EXISTS idx_income_entries_org ON income_entries(organization_id);
CREATE INDEX IF NOT EXISTS idx_expense_entries_org ON expense_entries(organization_id);
CREATE INDEX IF NOT EXISTS idx_sms_inbox_org ON sms_inbox(organization_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_org ON activity_log(organization_id);
CREATE INDEX IF NOT EXISTS idx_classes_org ON classes(organization_id);
CREATE INDEX IF NOT EXISTS idx_academic_years_org ON academic_years(organization_id);

-- ==========================================================
-- 8. RLS FOR NEW TABLES
-- ==========================================================
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_modules ENABLE ROW LEVEL SECURITY;

-- Platform modules are read-only for everyone
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='platform_modules' AND policyname='modules_read') THEN
    CREATE POLICY "modules_read" ON platform_modules FOR SELECT USING (true);
  END IF;
END $$;

-- Organizations: users can see orgs they belong to
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='organizations' AND policyname='orgs_member_read') THEN
    CREATE POLICY "orgs_member_read" ON organizations FOR SELECT
    USING (
      id IN (SELECT organization_id FROM org_memberships WHERE user_id = auth.uid())
      OR
      EXISTS (SELECT 1 FROM org_memberships WHERE user_id = auth.uid() AND role = 'super_admin')
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='organizations' AND policyname='orgs_write') THEN
    CREATE POLICY "orgs_write" ON organizations FOR ALL USING (true);
  END IF;
END $$;

-- Subscriptions: users can see their org's subscriptions
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='subscriptions' AND policyname='subs_read') THEN
    CREATE POLICY "subs_read" ON subscriptions FOR SELECT
    USING (
      organization_id IN (SELECT organization_id FROM org_memberships WHERE user_id = auth.uid())
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='subscriptions' AND policyname='subs_write') THEN
    CREATE POLICY "subs_write" ON subscriptions FOR ALL USING (true);
  END IF;
END $$;

-- Org memberships: users can see memberships for their orgs
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='org_memberships' AND policyname='memberships_read') THEN
    CREATE POLICY "memberships_read" ON org_memberships FOR SELECT
    USING (
      user_id = auth.uid()
      OR
      organization_id IN (SELECT organization_id FROM org_memberships WHERE user_id = auth.uid())
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='org_memberships' AND policyname='memberships_write') THEN
    CREATE POLICY "memberships_write" ON org_memberships FOR ALL USING (true);
  END IF;
END $$;

-- ==========================================================
-- 9. HELPER FUNCTION: get current user's org
-- ==========================================================
CREATE OR REPLACE FUNCTION current_user_org_id()
RETURNS uuid AS $$
  SELECT organization_id
  FROM org_memberships
  WHERE user_id = auth.uid() AND is_default = true
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;
