-- =====================================================================
-- ENABLE ALL PLATFORM MODULES FOR EVERY SCHOOL + SEED DEPARTMENTS
-- =====================================================================
-- Run order: after saas_foundation.sql (#22), student_finance_module.sql
-- (#27), and website_module.sql (#25) — all already earlier in
-- supabase/README.md's run order. Safe to run after every other file
-- in this folder too.
--
-- WHY: seed_org_defaults() only auto-subscribed a new school to
-- modules flagged is_core = true in platform_modules. Today that is
-- only 'finance', 'students' and 'student_finance' — three modules.
-- Every other module (teacher_portal, student_portal, parent_portal,
-- communication, academics, attendance, timetable, assessments, cbt,
-- admissions, hr, payroll, procurement, inventory, assets, transport,
-- library, clinic, hostel, lms, website, admissions_online, crm, ...)
-- was left unsubscribed for any newly created school, so its sidebar
-- and pages were far sparser than the "Grant Schools" pilot tenant.
--
-- Grant Schools looks different not because of any is_core flag, but
-- because supabase/bootstrap_grant_schools.sql explicitly subscribed
-- it to EVERY row in platform_modules ("Every module, for this
-- school." — no WHERE clause). This migration makes that the standard
-- behaviour for every school, present and future, rather than a
-- one-off applied to a single pilot tenant:
--
--   1. seed_org_defaults() now:
--      - Seeds the standard school departments (Science, Arts, etc.)
--      - Subscribes a school to every module in platform_modules, not
--        just the is_core = true ones.
--      (New schools call this via provision_organization(); this makes
--      every new school created get full department and module access
--      immediately, matching Grant Schools.)
--   2. Backfill: every EXISTING organization gets:
--      - Any standard departments it doesn't already have rows for
--      - An active subscription row for every module it doesn't already
--        have one for. Existing subscriptions (including any a school
--        was deliberately downgraded/suspended on) are left untouched.
--
-- This does not change is_core itself — is_core still controls which
-- modules survive if something ever explicitly revokes a module's
-- subscription (e.g. a future "downgrade plan" action might restrict
-- to is_core-only). It only changes what a school starts with.
--
-- SAFE TO RE-RUN: uses ON CONFLICT DO NOTHING / DO UPDATE with an
-- idempotent WHERE guard. Departments backfill is idempotent via the
-- uniqueness of (organization_id, name) in departments table.
-- =====================================================================

CREATE OR REPLACE FUNCTION seed_org_defaults(p_org uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_name text;
BEGIN
  SELECT name INTO v_name FROM organizations WHERE id = p_org;

  -- Roles (per-org now that the unique index is composite)
  INSERT INTO roles (name, description, is_default, permissions, organization_id) VALUES
    ('admin', 'Full access to all features', false,
     '{"income":true,"expenses":true,"students":true,"student_finance":true,"vendors":true,"reconciliation":true,"reports":true,"receipts":true,"setup":true,"roles":true,"team":true,"activity":true,"sms_alerts":true,"website":true,"analytics":true}', p_org),
    ('bursar', 'Finance operations', false,
     '{"income":true,"expenses":true,"students":true,"student_finance":true,"vendors":true,"reconciliation":true,"reports":true,"receipts":true,"setup":false,"roles":false,"team":false,"activity":false,"sms_alerts":true,"website":false,"analytics":true}', p_org),
    ('editor', 'Can record and edit transactions', false,
     '{"income":true,"expenses":true,"students":true,"student_finance":true,"vendors":true,"reconciliation":false,"reports":true,"receipts":true,"setup":false,"roles":false,"team":false,"activity":false,"sms_alerts":true,"website":false,"analytics":false}', p_org),
    ('teacher', 'Teaching staff', false,
     '{"income":false,"expenses":false,"students":true,"student_finance":false,"vendors":false,"reconciliation":false,"reports":false,"receipts":false,"setup":false,"roles":false,"team":false,"activity":false,"sms_alerts":false,"website":false,"analytics":false}', p_org),
    ('viewer', 'Read-only access', true,
     '{"income":false,"expenses":false,"students":true,"vendors":false,"reconciliation":false,"reports":true,"receipts":false,"setup":false,"roles":false,"team":false,"activity":false,"sms_alerts":false,"website":false,"analytics":false}', p_org)
  ON CONFLICT DO NOTHING;

  -- School settings row
  INSERT INTO school_settings (school_name, organization_id)
  SELECT COALESCE(v_name, 'My School'), p_org
  WHERE NOT EXISTS (SELECT 1 FROM school_settings WHERE organization_id = p_org);

  -- Standard school departments: every school starts with these
  -- organizational units. Prevents the form fallback to string values.
  INSERT INTO departments (name, active, organization_id)
  SELECT d.name, true, p_org
  FROM (VALUES
    ('Science'),
    ('Arts'),
    ('Commercial'),
    ('Primary'),
    ('Junior Secondary'),
    ('Senior Secondary'),
    ('Administration'),
    ('Support Staff')
  ) AS d(name)
  WHERE NOT EXISTS (
    SELECT 1 FROM departments dp
    WHERE dp.organization_id = p_org AND dp.name = d.name
  );

  -- Module entitlements: every school starts with every module active,
  -- matching how the Grant Schools pilot tenant was bootstrapped
  -- (previously this only granted is_core = true modules).
  INSERT INTO subscriptions (organization_id, module_key, status)
  SELECT p_org, key, 'active' FROM platform_modules
  ON CONFLICT (organization_id, module_key) DO NOTHING;
END $$;

-- Backfill 1: give every existing organization the standard departments
-- it doesn't already have rows for. Never touches existing rows.
INSERT INTO departments (name, active, organization_id)
SELECT d.name, true, o.id
FROM organizations o
CROSS JOIN (VALUES
  ('Science'),
  ('Arts'),
  ('Commercial'),
  ('Primary'),
  ('Junior Secondary'),
  ('Senior Secondary'),
  ('Administration'),
  ('Support Staff')
) AS d(name)
WHERE NOT EXISTS (
  SELECT 1 FROM departments dp
  WHERE dp.organization_id = o.id AND dp.name = d.name
);

-- Backfill 2: give every existing organization every module it doesn't
-- already have a subscription row for. Never touches an existing row
-- (so a school someone deliberately unsubscribed from a module stays
-- unsubscribed) — it only fills in genuinely missing rows.
INSERT INTO subscriptions (organization_id, module_key, status)
SELECT o.id, pm.key, 'active'
FROM organizations o
CROSS JOIN platform_modules pm
WHERE NOT EXISTS (
  SELECT 1 FROM subscriptions s
  WHERE s.organization_id = o.id AND s.module_key = pm.key
)
ON CONFLICT (organization_id, module_key) DO NOTHING;
