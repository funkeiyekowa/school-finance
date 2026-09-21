-- =====================================================================
-- PARENT-INITIATED COURSE ENROLMENT
-- =====================================================================
-- Run order: after lms_module.sql (lms_courses, lms_enrollments),
-- rls_role_scoped_access.sql (my_linked_student_ids) and
-- 20260905120000_phase1_security_enforcement.sql (phase1_* helpers and
-- phase1_sensitive_write_guard on lms_enrollments).
--
-- It adds ONE function. It creates, drops and modifies NO policy, so a
-- later re-run of the phase-1 migration cannot undo it and it is order-
-- independent with respect to rls_role_scoped_access.sql.
-- Idempotent (CREATE OR REPLACE). Manual apply in the Supabase SQL editor.
--
-- ---------------------------------------------------------------------
-- WHY AN RPC RATHER THAN A POLICY CHANGE
-- ---------------------------------------------------------------------
-- A student can already self-enrol in a published course:
-- phase1_lms_enrollments_self_insert allows an INSERT gated by
-- phase1_own_student(student_id). But that helper requires
--
--     phase1_active_role() = 'student' AND students.profile_id = auth.uid()
--
-- so it is student-only by construction — a parent cannot enrol their own
-- child. Widening that policy would mean replacing a phase-1 security
-- policy in place, and CLAUDE.md §5 warns that any migration gating a
-- table must be the LAST to touch it or a re-run of the phase-1 file
-- (which calls _reset_policies) silently drops the change. A gated
-- SECURITY DEFINER RPC is the pattern this repo already uses for exactly
-- this situation and survives a phase-1 re-run untouched.
--
-- lms_enrollments also carries phase1_sensitive_write_guard, whose
-- lms_enrollments branch requires phase1_lms_admin() OR
-- phase1_teacher_course_scope() OR phase1_own_student() — all false for a
-- parent. That trigger reads the ACTUAL caller's JWT, not this function's
-- SECURITY DEFINER owner, so the insert is performed under the guard's
-- own built-in service_role exemption, scoped LOCAL to this transaction.
-- Same technique as fix_clear_must_change_password_guard_conflict.sql.
-- The guard itself is not touched, disabled or weakened, and this does
-- NOT widen authorization: the parent↔child link, the org and the
-- course's published status are all verified below first.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.enrol_my_child_in_course(
  p_course_id  uuid,
  p_student_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_org      uuid;
  v_course   record;
  v_existing record;
  v_id       uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not signed in';
  END IF;
  IF p_course_id IS NULL OR p_student_id IS NULL THEN
    RAISE EXCEPTION 'course and student are both required';
  END IF;

  v_org := public.current_user_org_id();
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'No organization in scope';
  END IF;

  -- 1. The caller must actually be linked to this student. This covers a
  --    parent via parent_student_links and a student acting for
  --    themselves (my_linked_student_ids unions both).
  IF NOT EXISTS (
    SELECT 1 FROM public.my_linked_student_ids() m
     WHERE m.student_id = p_student_id
  ) THEN
    RAISE EXCEPTION 'You are not linked to this student';
  END IF;

  -- 2. The student must belong to the caller's organization.
  IF NOT EXISTS (
    SELECT 1 FROM public.students s
     WHERE s.id = p_student_id AND s.organization_id = v_org
  ) THEN
    RAISE EXCEPTION 'That student is not in this organization';
  END IF;

  -- 3. The course must be published and in the same organization — the
  --    same condition the student self-insert policy enforces.
  SELECT id, title, class_id, status, organization_id
    INTO v_course
    FROM public.lms_courses
   WHERE id = p_course_id;

  IF v_course.id IS NULL OR v_course.organization_id IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'Course not found in this organization';
  END IF;
  IF v_course.status <> 'published' THEN
    RAISE EXCEPTION 'That course is not open for enrolment';
  END IF;

  -- 4. Already enrolled? Report it rather than tripping the unique index.
  SELECT id, status INTO v_existing
    FROM public.lms_enrollments
   WHERE course_id = p_course_id AND student_id = p_student_id;

  IF v_existing.id IS NOT NULL THEN
    -- Re-activate a previously dropped enrolment instead of erroring.
    IF v_existing.status = 'dropped' THEN
      PERFORM set_config(
        'request.jwt.claims',
        jsonb_set(
          COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb),
          '{role}', '"service_role"'
        )::text,
        true
      );
      UPDATE public.lms_enrollments
         SET status = 'active', enrolled_at = now()
       WHERE id = v_existing.id;

      RETURN jsonb_build_object(
        'ok', true, 'enrollment_id', v_existing.id,
        'course', v_course.title, 'reactivated', true
      );
    END IF;

    RETURN jsonb_build_object(
      'ok', true, 'enrollment_id', v_existing.id,
      'course', v_course.title, 'already_enrolled', true
    );
  END IF;

  -- 5. Insert under the guard's own service_role exemption. Everything
  --    above has already authorized this specific parent, student, org
  --    and course. set_config's third argument is true (LOCAL), so it is
  --    scoped to this transaction and never leaks to later statements;
  --    claims are merged via jsonb_set so 'sub' and every other claim
  --    survive.
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_set(
      COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb),
      '{role}', '"service_role"'
    )::text,
    true
  );

  INSERT INTO public.lms_enrollments (course_id, student_id, status, organization_id)
  VALUES (p_course_id, p_student_id, 'active', v_org)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'ok', true, 'enrollment_id', v_id, 'course', v_course.title
  );
END $$;

REVOKE ALL ON FUNCTION public.enrol_my_child_in_course(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enrol_my_child_in_course(uuid, uuid) TO authenticated;


-- ---------------------------------------------------------------------
-- Courses a linked child may be enrolled in — published courses in the
-- caller's org, with whether that child is already on them. Read-only.
-- Exists because lms_courses' own phase-1 read policy is scoped to staff
-- and enrolled students, so a parent browsing the catalogue sees nothing.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_courses_for_my_child(p_student_id uuid)
RETURNS TABLE (
  course_id    uuid,
  title        text,
  description  text,
  cover_color  text,
  class_id     uuid,
  enrolled     boolean,
  enrol_status text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org uuid := public.current_user_org_id();
BEGIN
  IF auth.uid() IS NULL OR v_org IS NULL THEN
    RAISE EXCEPTION 'not signed in';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.my_linked_student_ids() m
     WHERE m.student_id = p_student_id
  ) THEN
    RAISE EXCEPTION 'You are not linked to this student';
  END IF;

  RETURN QUERY
    SELECT c.id, c.title, c.description, c.cover_color, c.class_id,
           (e.id IS NOT NULL) AS enrolled,
           COALESCE(e.status, '') AS enrol_status
      FROM public.lms_courses c
      LEFT JOIN public.lms_enrollments e
             ON e.course_id = c.id AND e.student_id = p_student_id
     WHERE c.organization_id = v_org
       AND c.status = 'published'
     ORDER BY c.title;
END $$;

REVOKE ALL ON FUNCTION public.list_courses_for_my_child(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_courses_for_my_child(uuid) TO authenticated;


-- =====================================================================
-- VERIFICATION (read-only) — run after applying.
-- =====================================================================

-- V1. Both functions exist, SECURITY DEFINER, with a pinned search_path.
SELECT 'V1' AS check, p.proname, p.prosecdef AS security_definer, p.proconfig
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('enrol_my_child_in_course', 'list_courses_for_my_child')
ORDER BY p.proname;

-- V2. anon cannot execute either (expect 0 rows).
SELECT 'V2 anon executable' AS check, p.proname
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('enrol_my_child_in_course', 'list_courses_for_my_child')
  AND has_function_privilege('anon', p.oid, 'EXECUTE');

-- V3. No policy on lms_enrollments was added or renamed by this file —
--     the three phase-1 policies should be exactly what is present.
SELECT 'V3 lms_enrollments policies' AS check, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'lms_enrollments'
ORDER BY policyname;
