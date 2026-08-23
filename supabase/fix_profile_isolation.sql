-- ============================================================
-- FIX PROFILE ISOLATION
-- Run AFTER saas_foundation.sql.
--
-- PROBLEM: The Team page shows pending users from ALL schools
-- because profiles has a legacy RLS policy:
--   "Admins can read all profiles" → any admin reads every user.
--
-- The registration flow also has no concept of "which school
-- am I joining", so new users land with no org membership and
-- are visible globally.
--
-- WHAT THIS FIXES:
--   1. Drops the global admin-read policy on profiles.
--   2. Creates tenant-scoped policies: you can only see profiles
--      that belong to the same organization(s) you do.
--   3. Adds a join_code column to organizations so new users can
--      specify which school they're registering for.
--   4. Adds an RPC that the registration flow calls to attach the
--      new user to the correct school immediately.
-- ============================================================

-- ==========================================================
-- 1. JOIN CODE — how a new user specifies their school
-- ==========================================================
-- A short alphanumeric code the school admin shares with staff.
-- Not secret (anyone in the school knows it), but specific enough
-- that a random signup doesn't end up in the wrong tenant.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS join_code text;

-- Generate codes for any school that doesn't have one yet.
UPDATE organizations
SET join_code = upper(substr(md5(id::text || now()::text), 1, 6))
WHERE join_code IS NULL OR join_code = '';

-- Codes must be unique across the platform.
CREATE UNIQUE INDEX IF NOT EXISTS idx_org_join_code
  ON organizations(join_code) WHERE join_code IS NOT NULL;

-- ==========================================================
-- 2. FIX PROFILES RLS — tenant-scoped
-- ==========================================================
-- Drop the dangerous global policies.
DROP POLICY IF EXISTS "Admins can read all profiles" ON profiles;
DROP POLICY IF EXISTS "Admins can update all profiles" ON profiles;
DROP POLICY IF EXISTS "Users can read own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Service can insert profiles" ON profiles;

-- New policies:
-- a) You can always read your own profile (needed to log in).
CREATE POLICY "profiles_own_read" ON profiles FOR SELECT
  USING (id = auth.uid());

-- b) You can see profiles of people in the same org(s) as you.
--    This is what makes the Team page tenant-scoped.
CREATE POLICY "profiles_org_read" ON profiles FOR SELECT
  USING (
    id IN (
      SELECT m.user_id FROM org_memberships m
      WHERE m.organization_id IN (
        SELECT m2.organization_id FROM org_memberships m2
        WHERE m2.user_id = auth.uid() AND m2.active = true
      )
    )
  );

-- c) Platform admins can read all profiles (for the Platform Admin
--    members panel and user directory).
CREATE POLICY "profiles_platform_admin_read" ON profiles FOR SELECT
  USING (is_platform_admin());

-- d) You can update your own profile.
CREATE POLICY "profiles_own_update" ON profiles FOR UPDATE
  USING (id = auth.uid());

-- e) Org admins can update profiles of their org members (approve,
--    change role, deactivate).
CREATE POLICY "profiles_org_admin_update" ON profiles FOR UPDATE
  USING (
    is_platform_admin()
    OR id IN (
      SELECT m.user_id FROM org_memberships m
      WHERE m.organization_id IN (
        SELECT m2.organization_id FROM org_memberships m2
        WHERE m2.user_id = auth.uid() AND m2.active = true
          AND m2.role IN ('super_admin','owner','admin')
      )
    )
  );

-- f) Service role can insert (signup trigger creates the profile row).
CREATE POLICY "profiles_service_insert" ON profiles FOR INSERT
  WITH CHECK (true);


-- ==========================================================
-- 3. REGISTRATION RPC — join a school by code
-- ==========================================================
-- Called from the registration page after signup. Finds the school
-- by its join_code and creates a membership. The user starts
-- inactive (pending approval) unless the school has auto-approve on.
CREATE OR REPLACE FUNCTION join_school_by_code(p_code text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org uuid;
  v_org_name text;
  v_auto_approve boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_code IS NULL OR trim(p_code) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Please enter your school code.');
  END IF;

  -- Find the school. Case-insensitive match.
  SELECT id, name,
         COALESCE((settings->>'auto_approve_members')::boolean, false)
  INTO v_org, v_org_name, v_auto_approve
  FROM organizations
  WHERE upper(trim(join_code)) = upper(trim(p_code))
    AND status IN ('active', 'trial')
  LIMIT 1;

  IF v_org IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'No active school found with that code. Check with your school administrator.'
    );
  END IF;

  -- Already a member?
  IF EXISTS (SELECT 1 FROM org_memberships WHERE user_id = v_uid AND organization_id = v_org) THEN
    RETURN jsonb_build_object('ok', true, 'already_member', true, 'school_name', v_org_name);
  END IF;

  -- Create the membership. Starts inactive unless auto-approve is on.
  INSERT INTO org_memberships (user_id, organization_id, role, is_default, active)
  VALUES (v_uid, v_org, 'pending', true, v_auto_approve);

  -- Set their profile org pointer too.
  UPDATE profiles SET organization_id = v_org WHERE id = v_uid;

  -- If auto-approve, also activate the profile.
  IF v_auto_approve THEN
    UPDATE profiles SET active = true, role = 'viewer' WHERE id = v_uid AND NOT active;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'school_name', v_org_name,
    'approved', v_auto_approve,
    'message', CASE
      WHEN v_auto_approve THEN 'Welcome to ' || v_org_name || '! You have been granted access.'
      ELSE 'Your request to join ' || v_org_name || ' has been sent. An administrator will approve your access shortly.'
    END
  );
END $$;

GRANT EXECUTE ON FUNCTION join_school_by_code(text) TO authenticated;

-- ==========================================================
-- 4. LOOKUP SCHOOL BY CODE (for the UI to show the name)
-- ==========================================================
CREATE OR REPLACE FUNCTION lookup_school_code(p_code text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE
    WHEN o.id IS NOT NULL THEN
      jsonb_build_object('found', true, 'name', o.name, 'logo_url', o.logo_url)
    ELSE
      jsonb_build_object('found', false)
  END
  FROM (SELECT 1) x
  LEFT JOIN organizations o
    ON upper(trim(o.join_code)) = upper(trim(p_code))
   AND o.status IN ('active', 'trial')
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION lookup_school_code(text) TO authenticated, anon;

-- ==========================================================
-- 5. HELPER: regenerate a school's join code
-- ==========================================================
CREATE OR REPLACE FUNCTION regenerate_join_code(p_org uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org uuid := COALESCE(p_org, current_user_org_id());
  v_code text;
BEGIN
  IF NOT is_org_admin(v_org) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- Generate a 6-char unique code.
  LOOP
    v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM organizations WHERE join_code = v_code);
  END LOOP;

  UPDATE organizations SET join_code = v_code WHERE id = v_org;

  RETURN jsonb_build_object('ok', true, 'join_code', v_code);
END $$;

GRANT EXECUTE ON FUNCTION regenerate_join_code(uuid) TO authenticated;
