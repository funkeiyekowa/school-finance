-- =====================================================================
-- PROFILES POLICY LOCKDOWN
-- =====================================================================
-- A follow-up to rls_role_scoped_access.sql. Verified live that a
-- signed-in student could still read every profile in the school (113
-- Grant members + 4 unassigned) — meaning some SELECT policy on
-- public.profiles remained that did NOT require is_staff_user(). Rather
-- than guess at policy names, this file drops ALL policies on profiles
-- and rebuilds them from scratch with an explicit staff gate on the
-- directory read.
--
-- Result per role after this migration:
--   Any signed-in user  →  reads their own profile.
--   Staff (owner/admin/editor/staff/bursar/accountant/developer/
--          super_admin/teacher/viewer)
--                       →  reads every profile that shares an org
--                          membership with them.
--   Platform admin      →  reads every profile.
--   Students / parents  →  read only their own profile.
--   Own-update          →  every user can update their own profile.
--   Org-admin update    →  owner/admin/super_admin can update profiles
--                          of their org's members.
--   Service insert      →  keeps the signup trigger working.
--
-- IDEMPOTENT. Run AFTER rls_role_scoped_access.sql.
-- =====================================================================

BEGIN;

-- 1. Drop every existing policy on profiles.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies
           WHERE schemaname='public' AND tablename='profiles' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.profiles', r.policyname);
  END LOOP;
END $$;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 2. Read: own row (always), staff of same org, platform admin.
CREATE POLICY profiles_own_read ON public.profiles FOR SELECT
  USING (id = auth.uid());

CREATE POLICY profiles_platform_admin_read ON public.profiles FOR SELECT
  USING (public.is_platform_admin());

-- Staff-scoped directory read: a staff user sees profiles of anyone
-- who shares an org_membership with them. Students and parents do
-- NOT satisfy is_staff_user(), so this policy adds nothing for them
-- beyond their own profile.
CREATE POLICY profiles_staff_org_read ON public.profiles FOR SELECT
  USING (
    public.is_staff_user()
    AND id IN (
      SELECT m.user_id FROM public.org_memberships m
      WHERE m.organization_id IN (
        SELECT m2.organization_id FROM public.org_memberships m2
        WHERE m2.user_id = auth.uid() AND m2.active = true
      )
    )
  );

-- 3. Update: own row, or org-admin over members of their org.
CREATE POLICY profiles_own_update ON public.profiles FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE POLICY profiles_org_admin_update ON public.profiles FOR UPDATE
  USING (
    public.is_platform_admin()
    OR id IN (
      SELECT m.user_id FROM public.org_memberships m
      WHERE m.organization_id IN (
        SELECT m2.organization_id FROM public.org_memberships m2
        WHERE m2.user_id = auth.uid() AND m2.active = true
          AND m2.role IN ('super_admin','owner','admin')
      )
    )
  );

-- 4. Insert: signup trigger creates the profile row. Keep permissive.
CREATE POLICY profiles_service_insert ON public.profiles FOR INSERT
  WITH CHECK (true);

COMMIT;

-- 5. Verify: after applying, sign in as a student and confirm
--    SELECT count(*) FROM profiles  returns 1.
SELECT policyname, cmd,
       CASE WHEN qual LIKE '%is_staff_user%' OR qual LIKE '%is_platform_admin%' THEN 'staff/platform-gated'
            WHEN qual LIKE '%id = auth.uid()%' THEN 'self'
            ELSE 'OTHER'
       END AS shape
FROM pg_policies
WHERE schemaname='public' AND tablename='profiles'
ORDER BY cmd, policyname;
