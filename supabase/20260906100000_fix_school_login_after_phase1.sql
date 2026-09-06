-- ============================================================================
-- SCHOOL LOGIN FIX AFTER PHASE 1 WRITE GUARD
-- ============================================================================
-- Run manually in Supabase SQL Editor AFTER:
--   - school_scoped_login.sql / fix_staff_login_and_roles.sql
--   - fix_staff_type_role_binary.sql (if installed)
--   - student_visibility_fixes.sql
--   - 20260905120000_phase1_security_enforcement.sql
--
-- The school login RPC only needs to resolve a role and redirect. Its former
-- implementation also tried to INSERT/UPDATE org_memberships on every login.
-- Phase 1 correctly rejects membership writes by students and teachers, so
-- their otherwise-valid sign-in failed with "organization administrator
-- required". Membership/profile provisioning remains an onboarding concern;
-- this login-time function is intentionally read-only.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.resolve_login_context(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_org_id uuid;
  v_org_name text;
  v_role text := NULL;
  v_redirect text := NULL;
  v_student_id uuid := NULL;
  v_membership_role text;
  v_staff_type text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('role', NULL, 'redirect', NULL, 'organization_id', NULL,
      'organization_name', NULL, 'student_id', NULL, 'reason', 'not_signed_in');
  END IF;

  SELECT id, name INTO v_org_id, v_org_name
    FROM public.organizations
   WHERE slug = LOWER(TRIM(p_slug));

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('role', NULL, 'redirect', NULL, 'organization_id', NULL,
      'organization_name', NULL, 'student_id', NULL, 'reason', 'unknown_school');
  END IF;

  -- Prefer the authoritative staff_members record when present. This keeps
  -- non-teaching staff out of the teacher-only path while retaining the
  -- existing admin/teacher/staff role conventions.
  SELECT LOWER(COALESCE(staff_type, 'teaching')) INTO v_staff_type
    FROM public.staff_members
   WHERE user_id = v_uid AND organization_id = v_org_id
   LIMIT 1;

  IF v_staff_type IS NOT NULL THEN
    IF v_staff_type IN ('admin', 'administrator') THEN
      v_role := 'admin'; v_redirect := '/dashboard';
    ELSIF v_staff_type IN ('non_teaching', 'nonteaching', 'non teaching', 'support') THEN
      v_role := 'staff'; v_redirect := '/dashboard';
    ELSE
      v_role := 'teacher'; v_redirect := '/dashboard/teaching';
    END IF;
  END IF;

  -- Membership fallback supports older staff rows and all portal roles.
  IF v_role IS NULL THEN
    SELECT role INTO v_membership_role
      FROM public.org_memberships
     WHERE user_id = v_uid
       AND organization_id = v_org_id
       AND active = TRUE
     ORDER BY is_default DESC, joined_at NULLS LAST
     LIMIT 1;

    IF v_membership_role IN ('super_admin', 'owner', 'admin', 'developer', 'editor') THEN
      v_role := 'admin'; v_redirect := '/dashboard';
    ELSIF v_membership_role = 'staff' THEN
      v_role := 'staff'; v_redirect := '/dashboard';
    ELSIF v_membership_role = 'teacher' THEN
      v_role := 'teacher'; v_redirect := '/dashboard/teaching';
    ELSIF v_membership_role = 'parent' THEN
      v_role := 'parent'; v_redirect := '/dashboard/parent-portal';
    ELSIF v_membership_role = 'student' THEN
      v_role := 'student'; v_redirect := '/dashboard/student-portal';
    END IF;
  END IF;

  -- Student identity is tied to students.profile_id, never to a caller
  -- supplied email or guardian email.
  IF v_role IS NULL THEN
    SELECT id INTO v_student_id
      FROM public.students
     WHERE profile_id = v_uid
       AND organization_id = v_org_id
     LIMIT 1;
    IF v_student_id IS NOT NULL THEN
      v_role := 'student'; v_redirect := '/dashboard/student-portal';
    END IF;
  END IF;

  IF v_role IS NULL THEN
    IF EXISTS (
      SELECT 1
        FROM public.parent_profiles pp
        JOIN public.parent_student_links psl ON psl.parent_id = pp.id
        JOIN public.students s ON s.id = psl.student_id
       WHERE pp.profile_id = v_uid
         AND s.organization_id = v_org_id
    ) THEN
      v_role := 'parent'; v_redirect := '/dashboard/parent-portal';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'role', v_role,
    'redirect', v_redirect,
    'organization_id', v_org_id,
    'organization_name', v_org_name,
    'student_id', v_student_id,
    'reason', CASE WHEN v_role IS NULL THEN 'not_attached' ELSE 'ok' END
  );
END $fn$;

REVOKE ALL ON FUNCTION public.resolve_login_context(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_login_context(text) TO authenticated;
