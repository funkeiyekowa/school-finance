-- ============================================================
-- SaaS FOUNDATION — Org management, RBAC, provisioning,
--                    and live isolation verification
--
-- Run this in the Supabase SQL editor AFTER:
--   1. schema.sql
--   2. multi_tenant_migration.sql
--   3. tenant_isolation_enforcement.sql
--
-- What this adds:
--   A. Hardens the over-permissive write policies on
--      organizations / subscriptions / org_memberships
--      (they were FOR ALL USING (true) — any logged-in user
--      could create or modify ANY organization).
--   B. Fixes roles.name to be unique PER ORG (was global,
--      which blocked a second school from having its own
--      "admin" role).
--   C. Active-org switching that RLS actually respects.
--   D. Membership management RPCs (assign users to schools).
--   E. One-call organization provisioning (create a school
--      with roles, categories, settings, modules, owner).
--   F. verify_tenant_isolation() — live introspection of the
--      RLS state so the app can prove isolation is enforced.
--
-- All privileged RPCs are SECURITY DEFINER with an explicit
-- caller authorization check inside the function body.
-- ============================================================

-- ==========================================================
-- 0. PREREQUISITE GUARD
-- ==========================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'organizations') THEN
    RAISE EXCEPTION 'organizations table missing. Run multi_tenant_migration.sql first.';
  END IF;
END $$;


-- ==========================================================
-- 1. MEMBERSHIP MODEL EXTENSIONS
-- ==========================================================
-- An explicit "active org" pointer is safer than overloading
-- is_default, but we keep is_default as the source of truth so
-- the existing current_user_org_id() keeps working. We add
-- columns that make membership auditable.
ALTER TABLE org_memberships ADD COLUMN IF NOT EXISTS invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE org_memberships ADD COLUMN IF NOT EXISTS invited_at timestamptz;
ALTER TABLE org_memberships ADD COLUMN IF NOT EXISTS last_active_at timestamptz;

-- A user must not have two default orgs. Clear any existing duplicates
-- first, keeping the earliest membership, otherwise the index below
-- cannot be created and the migration would stop here.
UPDATE org_memberships m
SET is_default = false
WHERE m.is_default = true
  AND m.id <> (
    SELECT m2.id FROM org_memberships m2
    WHERE m2.user_id = m.user_id AND m2.is_default = true
    ORDER BY m2.joined_at NULLS LAST, m2.id
    LIMIT 1
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_memberships_one_default
  ON org_memberships(user_id) WHERE is_default = true;


-- ==========================================================
-- 2. AUTHORIZATION HELPERS
-- ==========================================================
-- These are SECURITY DEFINER so they can read org_memberships
-- without tripping over the policies defined on it (avoids
-- infinite policy recursion).

-- Is the caller a platform-level super admin?
CREATE OR REPLACE FUNCTION is_platform_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM org_memberships
    WHERE user_id = auth.uid() AND role = 'super_admin' AND active = true
  )
  OR EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'developer' AND active = true
  );
$$;

-- Is the caller an owner/admin of the given org?
CREATE OR REPLACE FUNCTION is_org_admin(p_org uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT is_platform_admin() OR EXISTS (
    SELECT 1 FROM org_memberships
    WHERE user_id = auth.uid()
      AND organization_id = p_org
      AND active = true
      AND role IN ('super_admin', 'owner', 'admin')
  );
$$;

-- Is the caller a member (any role) of the given org?
CREATE OR REPLACE FUNCTION is_org_member(p_org uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT is_platform_admin() OR EXISTS (
    SELECT 1 FROM org_memberships
    WHERE user_id = auth.uid() AND organization_id = p_org AND active = true
  );
$$;

-- Rewritten to ignore inactive memberships.
CREATE OR REPLACE FUNCTION current_user_org_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT organization_id
  FROM org_memberships
  WHERE user_id = auth.uid() AND is_default = true AND active = true
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION is_platform_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION is_org_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION is_org_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION current_user_org_id() TO authenticated, anon;


-- ==========================================================
-- 3. HARDEN THE PLATFORM-TABLE POLICIES
-- ==========================================================
-- Before: "orgs_write" ON organizations FOR ALL USING (true)
-- meant ANY authenticated user could rename, suspend, or delete
-- ANY school. Same for subscriptions and memberships. Fixed.

-- --- organizations ---
DROP POLICY IF EXISTS "orgs_write" ON organizations;
DROP POLICY IF EXISTS "orgs_member_read" ON organizations;
DROP POLICY IF EXISTS "orgs_read" ON organizations;
DROP POLICY IF EXISTS "orgs_insert" ON organizations;
DROP POLICY IF EXISTS "orgs_update" ON organizations;
DROP POLICY IF EXISTS "orgs_delete" ON organizations;

CREATE POLICY "orgs_read" ON organizations FOR SELECT
  USING (is_org_member(id));
-- Only platform admins create schools.
CREATE POLICY "orgs_insert" ON organizations FOR INSERT
  WITH CHECK (is_platform_admin());
-- Org owners/admins can edit their own school; platform admins any.
CREATE POLICY "orgs_update" ON organizations FOR UPDATE
  USING (is_org_admin(id));
CREATE POLICY "orgs_delete" ON organizations FOR DELETE
  USING (is_platform_admin());

-- --- subscriptions (entitlements) ---
DROP POLICY IF EXISTS "subs_write" ON subscriptions;
DROP POLICY IF EXISTS "subs_read" ON subscriptions;
DROP POLICY IF EXISTS "subs_manage" ON subscriptions;

CREATE POLICY "subs_read" ON subscriptions FOR SELECT
  USING (is_org_member(organization_id));
-- Entitlements are billing state: platform admins only.
-- A school admin must NOT be able to grant itself a paid module.
CREATE POLICY "subs_manage" ON subscriptions FOR ALL
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

-- --- org_memberships ---
DROP POLICY IF EXISTS "memberships_write" ON org_memberships;
DROP POLICY IF EXISTS "memberships_read" ON org_memberships;
DROP POLICY IF EXISTS "memberships_insert" ON org_memberships;
DROP POLICY IF EXISTS "memberships_update" ON org_memberships;
DROP POLICY IF EXISTS "memberships_delete" ON org_memberships;

-- You can always read your own memberships (needed to log in and
-- to populate the org switcher). Org admins read their org's roster.
CREATE POLICY "memberships_read" ON org_memberships FOR SELECT
  USING (user_id = auth.uid() OR is_org_admin(organization_id));
CREATE POLICY "memberships_insert" ON org_memberships FOR INSERT
  WITH CHECK (is_org_admin(organization_id));
-- Org admins manage the roster. A user may update only their own
-- row (that is how switching the default org works).
CREATE POLICY "memberships_update" ON org_memberships FOR UPDATE
  USING (user_id = auth.uid() OR is_org_admin(organization_id));
CREATE POLICY "memberships_delete" ON org_memberships FOR DELETE
  USING (is_org_admin(organization_id));

-- --- platform_modules (catalogue) ---
DROP POLICY IF EXISTS "modules_read" ON platform_modules;
DROP POLICY IF EXISTS "modules_write" ON platform_modules;
CREATE POLICY "modules_read" ON platform_modules FOR SELECT USING (true);
CREATE POLICY "modules_write" ON platform_modules FOR ALL
  USING (is_platform_admin()) WITH CHECK (is_platform_admin());


-- ==========================================================
-- 4. FIX roles.name TO BE UNIQUE PER ORG
-- ==========================================================
-- roles.name was globally UNIQUE, so once School A had a role
-- named "admin", School B could never create its own. This is
-- the same class of bug that student_code had.
ALTER TABLE roles DROP CONSTRAINT IF EXISTS roles_name_key;
DROP INDEX IF EXISTS roles_name_key;

DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_name_org
    ON roles(name, organization_id);
EXCEPTION WHEN unique_violation THEN
  RAISE WARNING
    'roles already contains duplicate (name, organization_id) pairs. Remove the duplicates, then run: CREATE UNIQUE INDEX idx_roles_name_org ON roles(name, organization_id);';
END $$;

-- categories: unique per org per kind, if a global one exists
ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_name_key;

-- Also make sure the roles lookup in the app is org-scoped-safe:
CREATE INDEX IF NOT EXISTS idx_roles_org_name ON roles(organization_id, name);


-- ==========================================================
-- 5. ACTIVE ORG SWITCHING
-- ==========================================================
-- current_user_org_id() reads is_default, so switching context
-- MUST move the is_default flag or RLS will keep serving the old
-- tenant's rows. This RPC does it atomically and validates that
-- the caller is actually entitled to the target org.
--
-- Platform admins may switch into any org for support; a
-- membership row is created on demand so RLS resolves correctly.
CREATE OR REPLACE FUNCTION switch_active_org(p_org uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_has_membership boolean;
  v_org_status text;
  v_org_name text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT status, name INTO v_org_status, v_org_name
  FROM organizations WHERE id = p_org;

  IF v_org_status IS NULL THEN
    RAISE EXCEPTION 'Organization not found';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM org_memberships
    WHERE user_id = v_uid AND organization_id = p_org AND active = true
  ) INTO v_has_membership;

  IF NOT v_has_membership THEN
    IF is_platform_admin() THEN
      -- Support access: materialise a membership so RLS resolves.
      INSERT INTO org_memberships (user_id, organization_id, role, is_default, active)
      VALUES (v_uid, p_org, 'super_admin', false, true)
      ON CONFLICT (user_id, organization_id)
        DO UPDATE SET active = true;
    ELSE
      RAISE EXCEPTION 'You are not a member of that organization';
    END IF;
  END IF;

  IF v_org_status NOT IN ('active', 'trial') AND NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Organization is % and cannot be accessed', v_org_status;
  END IF;

  -- Move the default pointer atomically (partial unique index
  -- enforces at most one default per user).
  UPDATE org_memberships SET is_default = false
    WHERE user_id = v_uid AND is_default = true AND organization_id <> p_org;
  UPDATE org_memberships
    SET is_default = true, last_active_at = now()
    WHERE user_id = v_uid AND organization_id = p_org;

  RETURN jsonb_build_object(
    'ok', true,
    'organization_id', p_org,
    'organization_name', v_org_name
  );
END $$;

GRANT EXECUTE ON FUNCTION switch_active_org(uuid) TO authenticated;

-- Which orgs can the caller switch into?
CREATE OR REPLACE FUNCTION my_organizations()
RETURNS TABLE (
  organization_id uuid,
  name text,
  slug text,
  plan text,
  status text,
  logo_url text,
  membership_role text,
  is_default boolean,
  is_support_access boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  -- Orgs the caller actually belongs to
  SELECT o.id, o.name, o.slug, o.plan, o.status, o.logo_url,
         m.role, m.is_default, false
  FROM org_memberships m
  JOIN organizations o ON o.id = m.organization_id
  WHERE m.user_id = auth.uid() AND m.active = true

  UNION

  -- Plus every org, for platform admins (support access)
  SELECT o.id, o.name, o.slug, o.plan, o.status, o.logo_url,
         'super_admin', false, true
  FROM organizations o
  WHERE is_platform_admin()
    AND NOT EXISTS (
      SELECT 1 FROM org_memberships m2
      WHERE m2.user_id = auth.uid() AND m2.organization_id = o.id AND m2.active = true
    )

  ORDER BY 8 DESC, 2;
$$;

GRANT EXECUTE ON FUNCTION my_organizations() TO authenticated;


-- ==========================================================
-- 6. MEMBERSHIP MANAGEMENT RPCs
-- ==========================================================
-- auth.users is not reachable from PostgREST, so assigning a
-- user to a school by email needs a SECURITY DEFINER function.

CREATE OR REPLACE FUNCTION list_org_members(p_org uuid)
RETURNS TABLE (
  membership_id uuid,
  user_id uuid,
  email text,
  full_name text,
  profile_role text,
  profile_active boolean,
  membership_role text,
  is_default boolean,
  active boolean,
  joined_at timestamptz,
  last_active_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT is_org_admin(p_org) THEN
    RAISE EXCEPTION 'Not authorized to view members of this organization';
  END IF;

  RETURN QUERY
  SELECT m.id, m.user_id,
         COALESCE(p.email, u.email::text),
         p.full_name, p.role, p.active,
         m.role, m.is_default, m.active, m.joined_at, m.last_active_at
  FROM org_memberships m
  LEFT JOIN profiles p ON p.id = m.user_id
  LEFT JOIN auth.users u ON u.id = m.user_id
  WHERE m.organization_id = p_org
  ORDER BY m.role, COALESCE(p.full_name, p.email, u.email::text);
END $$;

GRANT EXECUTE ON FUNCTION list_org_members(uuid) TO authenticated;

-- Assign an EXISTING user (looked up by email) to an org.
CREATE OR REPLACE FUNCTION add_org_member(
  p_org uuid,
  p_email text,
  p_role text DEFAULT 'staff',
  p_make_default boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user uuid;
  v_email text := lower(trim(p_email));
BEGIN
  IF NOT is_org_admin(p_org) THEN
    RAISE EXCEPTION 'Not authorized to manage members of this organization';
  END IF;

  IF p_role NOT IN ('super_admin','owner','admin','staff','editor','viewer','teacher','parent','student','accountant','bursar') THEN
    RAISE EXCEPTION 'Invalid role: %', p_role;
  END IF;

  -- Only platform admins may mint another super_admin.
  IF p_role = 'super_admin' AND NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Only platform admins can assign super_admin';
  END IF;

  SELECT id INTO v_user FROM auth.users WHERE lower(email) = v_email LIMIT 1;

  IF v_user IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'no_such_user',
      'message', format('No user account exists for %s. Ask them to sign up first, then assign them here.', v_email)
    );
  END IF;

  INSERT INTO org_memberships (user_id, organization_id, role, is_default, active, invited_by, invited_at)
  VALUES (v_user, p_org, p_role, false, true, auth.uid(), now())
  ON CONFLICT (user_id, organization_id)
    DO UPDATE SET role = EXCLUDED.role, active = true;

  IF p_make_default THEN
    UPDATE org_memberships SET is_default = false
      WHERE user_id = v_user AND organization_id <> p_org;
    UPDATE org_memberships SET is_default = true
      WHERE user_id = v_user AND organization_id = p_org;
  ELSE
    -- Guarantee the user has exactly one default somewhere.
    IF NOT EXISTS (SELECT 1 FROM org_memberships WHERE user_id = v_user AND is_default = true) THEN
      UPDATE org_memberships SET is_default = true
        WHERE user_id = v_user AND organization_id = p_org;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'user_id', v_user, 'email', v_email, 'role', p_role);
END $$;

GRANT EXECUTE ON FUNCTION add_org_member(uuid, text, text, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION update_org_member(
  p_membership_id uuid,
  p_role text DEFAULT NULL,
  p_active boolean DEFAULT NULL,
  p_make_default boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_user uuid;
BEGIN
  SELECT organization_id, user_id INTO v_org, v_user
  FROM org_memberships WHERE id = p_membership_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Membership not found';
  END IF;
  IF NOT is_org_admin(v_org) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_role = 'super_admin' AND NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Only platform admins can assign super_admin';
  END IF;

  UPDATE org_memberships
  SET role   = COALESCE(p_role, role),
      active = COALESCE(p_active, active)
  WHERE id = p_membership_id;

  IF COALESCE(p_make_default, false) THEN
    UPDATE org_memberships SET is_default = false
      WHERE user_id = v_user AND organization_id <> v_org;
    UPDATE org_memberships SET is_default = true
      WHERE id = p_membership_id;
  END IF;

  -- Deactivating the row must not leave a dangling default.
  IF p_active IS FALSE THEN
    UPDATE org_memberships SET is_default = false WHERE id = p_membership_id;
    UPDATE org_memberships SET is_default = true
      WHERE id = (
        SELECT id FROM org_memberships
        WHERE user_id = v_user AND active = true
        ORDER BY joined_at LIMIT 1
      )
      AND NOT EXISTS (
        SELECT 1 FROM org_memberships WHERE user_id = v_user AND is_default = true
      );
  END IF;

  RETURN jsonb_build_object('ok', true);
END $$;

GRANT EXECUTE ON FUNCTION update_org_member(uuid, text, boolean, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION remove_org_member(p_membership_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_user uuid;
  v_role text;
  v_owner_count int;
BEGIN
  SELECT organization_id, user_id, role INTO v_org, v_user, v_role
  FROM org_memberships WHERE id = p_membership_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Membership not found';
  END IF;
  IF NOT is_org_admin(v_org) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- Never orphan a school: keep at least one owner/admin.
  IF v_role IN ('owner','admin','super_admin') THEN
    SELECT count(*) INTO v_owner_count
    FROM org_memberships
    WHERE organization_id = v_org AND active = true
      AND role IN ('owner','admin','super_admin') AND id <> p_membership_id;
    IF v_owner_count = 0 THEN
      RAISE EXCEPTION 'Cannot remove the last administrator of this organization';
    END IF;
  END IF;

  DELETE FROM org_memberships WHERE id = p_membership_id;

  -- Repair the user's default pointer if we just removed it.
  IF NOT EXISTS (SELECT 1 FROM org_memberships WHERE user_id = v_user AND is_default = true) THEN
    UPDATE org_memberships SET is_default = true
    WHERE id = (SELECT id FROM org_memberships
                WHERE user_id = v_user AND active = true
                ORDER BY joined_at LIMIT 1);
  END IF;

  RETURN jsonb_build_object('ok', true);
END $$;

GRANT EXECUTE ON FUNCTION remove_org_member(uuid) TO authenticated;

-- Directory of user accounts a platform admin can assign.
CREATE OR REPLACE FUNCTION list_assignable_users(p_search text DEFAULT NULL)
RETURNS TABLE (
  user_id uuid,
  email text,
  full_name text,
  profile_role text,
  profile_active boolean,
  org_count bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Platform admin access required';
  END IF;

  RETURN QUERY
  SELECT u.id, u.email::text, p.full_name, p.role, p.active,
         (SELECT count(*) FROM org_memberships m WHERE m.user_id = u.id)
  FROM auth.users u
  LEFT JOIN profiles p ON p.id = u.id
  WHERE p_search IS NULL OR p_search = ''
     OR u.email ILIKE '%' || p_search || '%'
     OR COALESCE(p.full_name, '') ILIKE '%' || p_search || '%'
  ORDER BY u.email
  LIMIT 200;
END $$;

GRANT EXECUTE ON FUNCTION list_assignable_users(text) TO authenticated;


-- ==========================================================
-- 7. ORGANIZATION PROVISIONING
-- ==========================================================
-- Creating a usable school means more than one INSERT: it needs
-- its own roles, categories, settings row, academic year, and
-- module entitlements. Doing it in one transaction avoids the
-- half-created tenants the previous UI could produce.
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

  -- Core module entitlements
  INSERT INTO subscriptions (organization_id, module_key, status)
  SELECT p_org, key, 'active' FROM platform_modules WHERE is_core = true
  ON CONFLICT (organization_id, module_key) DO NOTHING;
END $$;

CREATE OR REPLACE FUNCTION provision_organization(
  p_name text,
  p_slug text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_plan text DEFAULT 'starter',
  p_status text DEFAULT 'trial',
  p_owner_email text DEFAULT NULL,
  p_modules text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_slug text;
  v_owner uuid;
  v_owner_note text := NULL;
  v_mod text;
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Platform admin access required';
  END IF;
  IF p_name IS NULL OR trim(p_name) = '' THEN
    RAISE EXCEPTION 'Organization name is required';
  END IF;

  v_slug := lower(regexp_replace(COALESCE(NULLIF(trim(p_slug), ''), p_name), '[^a-zA-Z0-9]+', '-', 'g'));
  v_slug := trim(both '-' from v_slug);
  IF EXISTS (SELECT 1 FROM organizations WHERE slug = v_slug) THEN
    v_slug := v_slug || '-' || substr(md5(random()::text), 1, 4);
  END IF;

  INSERT INTO organizations (name, slug, email, plan, status)
  VALUES (trim(p_name), v_slug, NULLIF(trim(COALESCE(p_email, '')), ''), p_plan, p_status)
  RETURNING id INTO v_org;

  PERFORM seed_org_defaults(v_org);

  -- Optional extra modules beyond core
  IF p_modules IS NOT NULL THEN
    FOREACH v_mod IN ARRAY p_modules LOOP
      IF EXISTS (SELECT 1 FROM platform_modules WHERE key = v_mod) THEN
        INSERT INTO subscriptions (organization_id, module_key, status)
        VALUES (v_org, v_mod, 'active')
        ON CONFLICT (organization_id, module_key) DO UPDATE SET status = 'active';
      END IF;
    END LOOP;
  END IF;

  -- Optional owner assignment
  IF p_owner_email IS NOT NULL AND trim(p_owner_email) <> '' THEN
    SELECT id INTO v_owner FROM auth.users WHERE lower(email) = lower(trim(p_owner_email)) LIMIT 1;
    IF v_owner IS NULL THEN
      v_owner_note := format('No account found for %s — the school was created, but assign an owner once they sign up.', p_owner_email);
    ELSE
      INSERT INTO org_memberships (user_id, organization_id, role, is_default, active, invited_by, invited_at)
      VALUES (v_owner, v_org, 'owner', false, true, auth.uid(), now())
      ON CONFLICT (user_id, organization_id) DO UPDATE SET role = 'owner', active = true;
      IF NOT EXISTS (SELECT 1 FROM org_memberships WHERE user_id = v_owner AND is_default = true) THEN
        UPDATE org_memberships SET is_default = true
        WHERE user_id = v_owner AND organization_id = v_org;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'organization_id', v_org, 'slug', v_slug, 'notice', v_owner_note
  );
END $$;

GRANT EXECUTE ON FUNCTION seed_org_defaults(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION provision_organization(text, text, text, text, text, text, text[]) TO authenticated;

-- Backfill defaults for any org created before this migration.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM organizations LOOP
    PERFORM seed_org_defaults(r.id);
  END LOOP;
END $$;


-- ==========================================================
-- 8. LIVE ISOLATION VERIFICATION
-- ==========================================================
-- pg_policies / pg_class are not queryable through PostgREST, so
-- the app cannot check its own RLS posture without this. Returns
-- a structured report the verification dashboard renders directly.
CREATE OR REPLACE FUNCTION verify_tenant_isolation()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tables text[] := ARRAY[
    'students','vendors','income_entries','expense_entries','fee_schedules',
    'bank_transactions','sms_inbox','roles','categories','classes',
    'academic_years','student_enrollments','promotion_batches','promotion_events'
  ];
  v_tbl text;
  v_tables_report jsonb := '[]'::jsonb;
  v_nulls jsonb := '[]'::jsonb;
  v_rls boolean;
  v_exists boolean;
  v_policy_count int;
  v_tenant_policy_count int;
  v_null_count bigint;
  v_notnull boolean;
  v_unique jsonb := '[]'::jsonb;
  v_open_policies jsonb := '[]'::jsonb;
  r record;
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Platform admin access required';
  END IF;

  FOREACH v_tbl IN ARRAY v_tables LOOP
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = v_tbl
    ) INTO v_exists;

    IF NOT v_exists THEN
      v_tables_report := v_tables_report || jsonb_build_object(
        'table', v_tbl, 'exists', false);
      CONTINUE;
    END IF;

    -- RLS enabled?
    SELECT c.relrowsecurity INTO v_rls
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = v_tbl;

    -- Policy counts: total, and how many reference the org helper
    SELECT count(*),
           count(*) FILTER (
             WHERE COALESCE(qual, '') LIKE '%current_user_org_id%'
                OR COALESCE(with_check, '') LIKE '%current_user_org_id%'
           )
    INTO v_policy_count, v_tenant_policy_count
    FROM pg_policies WHERE schemaname = 'public' AND tablename = v_tbl;

    -- organization_id NOT NULL?
    SELECT a.attnotnull INTO v_notnull
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = v_tbl
      AND a.attname = 'organization_id' AND a.attnum > 0 AND NOT a.attisdropped;

    -- Any rows without a tenant?
    EXECUTE format('SELECT count(*) FROM public.%I WHERE organization_id IS NULL', v_tbl)
      INTO v_null_count;

    v_tables_report := v_tables_report || jsonb_build_object(
      'table', v_tbl,
      'exists', true,
      'rls_enabled', COALESCE(v_rls, false),
      'policy_count', v_policy_count,
      'tenant_scoped_policies', v_tenant_policy_count,
      'org_id_not_null', COALESCE(v_notnull, false),
      'null_org_rows', v_null_count,
      'pass', COALESCE(v_rls, false)
              AND v_tenant_policy_count > 0
              AND v_null_count = 0
    );

    IF v_null_count > 0 THEN
      v_nulls := v_nulls || jsonb_build_object('table', v_tbl, 'count', v_null_count);
    END IF;
  END LOOP;

  -- Policies that are wide open (USING true) on tenant tables
  FOR r IN
    SELECT tablename, policyname, cmd
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = ANY(v_tables)
      AND COALESCE(qual, 'true') = 'true'
      AND COALESCE(with_check, 'true') = 'true'
  LOOP
    v_open_policies := v_open_policies || jsonb_build_object(
      'table', r.tablename, 'policy', r.policyname, 'command', r.cmd);
  END LOOP;

  -- Per-org unique constraints
  FOR r IN
    SELECT i.relname AS index_name, t.relname AS table_name,
           pg_get_indexdef(i.oid) AS def
    FROM pg_index x
    JOIN pg_class i ON i.oid = x.indexrelid
    JOIN pg_class t ON t.oid = x.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND x.indisunique
      AND t.relname IN ('students','academic_years','classes','roles','school_settings')
  LOOP
    v_unique := v_unique || jsonb_build_object(
      'table', r.table_name,
      'index', r.index_name,
      'includes_org', r.def LIKE '%organization_id%',
      'definition', r.def);
  END LOOP;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'helper_functions', jsonb_build_object(
      'current_user_org_id', EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'current_user_org_id'),
      'is_platform_admin',   EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'is_platform_admin'),
      'is_org_admin',        EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'is_org_admin')
    ),
    'tables', v_tables_report,
    'null_org_tables', v_nulls,
    'open_policies', v_open_policies,
    'unique_indexes', v_unique,
    'organization_count', (SELECT count(*) FROM organizations),
    'membership_count', (SELECT count(*) FROM org_memberships),
    'users_without_org', (
      SELECT count(*) FROM auth.users u
      WHERE NOT EXISTS (SELECT 1 FROM org_memberships m WHERE m.user_id = u.id)
    ),
    'all_pass', NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_tables_report) e
      WHERE (e->>'exists')::boolean IS TRUE AND (e->>'pass')::boolean IS NOT TRUE
    ) AND jsonb_array_length(v_open_policies) = 0
  );
END $$;

GRANT EXECUTE ON FUNCTION verify_tenant_isolation() TO authenticated;


-- ==========================================================
-- 9. ORG-SCOPED PROFILE / ROLE RESOLUTION
-- ==========================================================
-- The app read permissions from roles WHERE name = profile.role
-- with no org filter. With per-org roles that could resolve to
-- another tenant's row. This RPC resolves it correctly.
CREATE OR REPLACE FUNCTION my_effective_permissions()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org uuid := current_user_org_id();
  v_profile_role text;
  v_membership_role text;
  v_perms jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;

  SELECT role INTO v_profile_role FROM profiles WHERE id = auth.uid();
  SELECT role INTO v_membership_role FROM org_memberships
    WHERE user_id = auth.uid() AND organization_id = v_org AND active = true;

  -- Owners, org admins and platform admins get everything.
  IF is_platform_admin() OR v_membership_role IN ('owner','admin','super_admin') THEN
    RETURN jsonb_build_object(
      'income', true, 'expenses', true, 'students', true, 'student_finance', true,
      'vendors', true, 'reconciliation', true, 'reports', true, 'receipts', true,
      'setup', true, 'roles', true, 'team', true, 'activity', true,
      'sms_alerts', true, 'website', true, 'analytics', true
    );
  END IF;

  -- Prefer a role defined in THIS org, matching the membership
  -- role first, then falling back to the legacy profile role.
  SELECT permissions INTO v_perms FROM roles
   WHERE organization_id = v_org AND name = v_membership_role LIMIT 1;

  IF v_perms IS NULL THEN
    SELECT permissions INTO v_perms FROM roles
     WHERE organization_id = v_org AND name = v_profile_role LIMIT 1;
  END IF;

  RETURN COALESCE(v_perms, '{}'::jsonb);
END $$;

GRANT EXECUTE ON FUNCTION my_effective_permissions() TO authenticated;


-- ==========================================================
-- 10. AUTO-PROVISION MEMBERSHIP FOR NEW SIGNUPS
-- ==========================================================
-- Without this, a brand-new signup has no membership, so
-- current_user_org_id() is NULL and they see nothing with no
-- explanation. Park them in a pending state instead.
CREATE OR REPLACE FUNCTION handle_new_user_membership()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org uuid;
BEGIN
  -- Only if the profile has no membership at all.
  IF EXISTS (SELECT 1 FROM org_memberships WHERE user_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  -- If an org claims this email domain, join it automatically.
  SELECT id INTO v_org FROM organizations
   WHERE settings->>'email_domain' IS NOT NULL
     AND NEW.email ILIKE '%@' || (settings->>'email_domain')
   LIMIT 1;

  IF v_org IS NOT NULL THEN
    INSERT INTO org_memberships (user_id, organization_id, role, is_default, active)
    VALUES (NEW.id, v_org, 'staff', true, true)
    ON CONFLICT (user_id, organization_id) DO NOTHING;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_new_profile_membership ON profiles;
CREATE TRIGGER trg_new_profile_membership
AFTER INSERT ON profiles
FOR EACH ROW EXECUTE FUNCTION handle_new_user_membership();


-- ==========================================================
-- 11. REGISTER THE WEBSITE MODULE IN THE CATALOGUE
-- ==========================================================
INSERT INTO platform_modules (key, name, description, category, is_core, sort_order) VALUES
  ('website', 'Website & Digital Presence', 'Public school website with theme engine, page builder, media library and lead capture', 'growth', false, 23),
  ('admissions_online', 'Online Admissions', 'Public application forms feeding the admissions pipeline', 'growth', false, 24),
  ('crm', 'Enquiries & Leads', 'Website enquiries, prospectus requests and tour bookings', 'growth', false, 25)
ON CONFLICT (key) DO NOTHING;


-- ==========================================================
-- 12. REMAINING GLOBAL UNIQUE CONSTRAINTS -> PER ORG
-- ==========================================================
-- tenant_isolation_enforcement.sql fixed student_code, but these
-- were missed. Each one silently blocks a second school from
-- using a document number that another school already used —
-- e.g. School B cannot issue receipt RCT-0001 because School A
-- has it. Every one of these must be scoped to the tenant.

-- income_entries.receipt_no
ALTER TABLE income_entries DROP CONSTRAINT IF EXISTS income_entries_receipt_no_key;
DROP INDEX IF EXISTS income_entries_receipt_no_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_income_receipt_no_org
  ON income_entries(receipt_no, organization_id);

-- expense_entries.voucher_no
ALTER TABLE expense_entries DROP CONSTRAINT IF EXISTS expense_entries_voucher_no_key;
DROP INDEX IF EXISTS expense_entries_voucher_no_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_expense_voucher_no_org
  ON expense_entries(voucher_no, organization_id);

-- vendors.vendor_code
ALTER TABLE vendors DROP CONSTRAINT IF EXISTS vendors_vendor_code_key;
DROP INDEX IF EXISTS vendors_vendor_code_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendors_code_org
  ON vendors(vendor_code, organization_id);

-- fee_schedules: name should be unique per org, not globally
ALTER TABLE fee_schedules DROP CONSTRAINT IF EXISTS fee_schedules_name_key;

-- ----------------------------------------------------------
-- Optional module tables (subjects, attendance_statuses).
--
-- These only exist if the academic modules were installed, and
-- their identifier column differs between them (subjects uses
-- short_code, attendance_statuses uses code). So rather than
-- assume a shape, discover it.
--
-- Index creation is wrapped in an exception handler: if a school
-- already has duplicate codes, we do NOT want that to abort this
-- whole migration. It reports and moves on.
-- ----------------------------------------------------------
DO $$
DECLARE
  v_default_org uuid;
  v_target record;
  v_col text;
BEGIN
  SELECT id INTO v_default_org FROM organizations WHERE slug = 'default' LIMIT 1;
  IF v_default_org IS NULL THEN
    SELECT id INTO v_default_org FROM organizations ORDER BY created_at LIMIT 1;
  END IF;

  FOR v_target IN
    SELECT * FROM (VALUES
      ('subjects',            'idx_subjects_code_org'),
      ('attendance_statuses', 'idx_attendance_statuses_code_org')
    ) AS t(tbl, idx)
  LOOP
    -- Skip tables that were never installed.
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = v_target.tbl
    );

    -- Make sure the tenant column exists and is populated.
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS organization_id uuid
         REFERENCES organizations(id) ON DELETE CASCADE', v_target.tbl);

    IF v_default_org IS NOT NULL THEN
      EXECUTE format(
        'UPDATE public.%I SET organization_id = %L WHERE organization_id IS NULL',
        v_target.tbl, v_default_org);
    END IF;

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON public.%I(organization_id)',
      'idx_' || v_target.tbl || '_org', v_target.tbl);

    -- Find whichever identifier column this table actually uses.
    SELECT column_name INTO v_col
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = v_target.tbl
      AND column_name IN ('short_code', 'code')
    ORDER BY CASE column_name WHEN 'short_code' THEN 1 ELSE 2 END
    LIMIT 1;

    IF v_col IS NULL THEN
      RAISE NOTICE 'Table % has no code column; nothing to scope.', v_target.tbl;
      CONTINUE;
    END IF;

    -- Drop any global unique constraint on that column.
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I',
                   v_target.tbl, v_target.tbl || '_' || v_col || '_key');

    BEGIN
      EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON public.%I(%I, organization_id)',
                     v_target.idx, v_target.tbl, v_col);
      RAISE NOTICE 'Scoped %.% to organization.', v_target.tbl, v_col;
    EXCEPTION WHEN unique_violation THEN
      -- Existing duplicates within one school. Leave the data alone and
      -- tell the operator, rather than failing the migration.
      RAISE WARNING
        'Could not make %.% unique per organization: duplicate values already exist. Resolve the duplicates, then run: CREATE UNIQUE INDEX % ON %(%, organization_id);',
        v_target.tbl, v_col, v_target.idx, v_target.tbl, v_col;
    END;
  END LOOP;
END $$;
