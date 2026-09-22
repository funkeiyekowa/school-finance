-- ============================================================================
-- PHASE 2 — LMS ASSIGNMENT GRADING INTEGRITY
-- ============================================================================
-- Run manually in Supabase SQL Editor AFTER:
--   1. supabase/lms_module.sql
--   2. supabase/20260905120000_phase1_security_enforcement.sql
--
-- Additive and safe to re-run. No existing grade is changed. The migration:
--   * rejects scores outside the assignment's configured range;
--   * prevents student-authored rows from self-grading or injecting AI fields;
--   * requires a score before a submission can become graded;
--   * stamps the authenticated staff grader and grading time server-side;
--   * exposes one authoritative, row-locked grading RPC for web/mobile clients.
--
-- Rollback: drop phase2_validate_lms_submission_grade trigger/function and
-- phase2_grade_lms_submission. Existing submission data remains untouched.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  missing text[] := ARRAY[]::text[];
BEGIN
  IF to_regclass('public.lms_submissions') IS NULL THEN missing := missing || 'lms_submissions'; END IF;
  IF to_regclass('public.lms_assignments') IS NULL THEN missing := missing || 'lms_assignments'; END IF;
  IF to_regclass('public.lms_lessons') IS NULL THEN missing := missing || 'lms_lessons'; END IF;
  IF to_regclass('public.staff_members') IS NULL THEN missing := missing || 'staff_members'; END IF;
  IF to_regprocedure('public.phase1_teacher_course_scope(uuid)') IS NULL THEN missing := missing || 'phase1_teacher_course_scope(uuid)'; END IF;
  IF to_regprocedure('public.phase1_active_role()') IS NULL THEN missing := missing || 'phase1_active_role()'; END IF;
  IF array_length(missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'Phase 2 grading prerequisites missing: %', array_to_string(missing, ', ');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.phase2_validate_lms_submission_grade()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_course uuid;
  v_max_score numeric;
  v_role text := public.phase1_active_role();
  v_grading_changed boolean := false;
BEGIN
  SELECT a.organization_id, l.course_id, a.max_score
    INTO v_org, v_course, v_max_score
  FROM public.lms_assignments a
  JOIN public.lms_lessons l ON l.id = a.lesson_id
  WHERE a.id = NEW.assignment_id;

  IF v_org IS NULL OR v_course IS NULL THEN
    RAISE EXCEPTION 'Assignment not found';
  END IF;
  IF NEW.organization_id IS DISTINCT FROM v_org OR v_org IS DISTINCT FROM public.current_user_org_id() THEN
    RAISE EXCEPTION 'Assignment organization boundary violation';
  END IF;
  IF NEW.score IS NOT NULL AND (NEW.score < 0 OR NEW.score > v_max_score) THEN
    RAISE EXCEPTION 'Score must be between 0 and %', v_max_score;
  END IF;
  IF NEW.status = 'graded' AND NEW.score IS NULL THEN
    RAISE EXCEPTION 'A graded submission requires a score';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF v_role = 'student' AND (
      NEW.status <> 'submitted'
      OR NEW.score IS NOT NULL
      OR NEW.feedback IS NOT NULL
      OR NEW.ai_suggested_score IS NOT NULL
      OR NEW.ai_suggested_feedback IS NOT NULL
      OR NEW.graded_by_staff_id IS NOT NULL
      OR NEW.graded_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Students cannot set grading fields';
    END IF;
    RETURN NEW;
  END IF;

  v_grading_changed :=
    NEW.status IS DISTINCT FROM OLD.status
    OR NEW.score IS DISTINCT FROM OLD.score
    OR NEW.feedback IS DISTINCT FROM OLD.feedback
    OR NEW.ai_suggested_score IS DISTINCT FROM OLD.ai_suggested_score
    OR NEW.ai_suggested_feedback IS DISTINCT FROM OLD.ai_suggested_feedback
    OR NEW.graded_by_staff_id IS DISTINCT FROM OLD.graded_by_staff_id
    OR NEW.graded_at IS DISTINCT FROM OLD.graded_at;

  IF v_grading_changed THEN
    IF NOT public.phase1_teacher_course_scope(v_course) THEN
      RAISE EXCEPTION 'Teacher assignment or LMS administrator access required to grade';
    END IF;

    IF NEW.status = 'graded' THEN
      SELECT sm.id INTO NEW.graded_by_staff_id
      FROM public.staff_members sm
      WHERE sm.organization_id = v_org AND sm.user_id = auth.uid()
      ORDER BY sm.created_at
      LIMIT 1;
      NEW.graded_at := COALESCE(NEW.graded_at, now());
    ELSE
      NEW.graded_by_staff_id := NULL;
      NEW.graded_at := NULL;
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS phase2_validate_lms_submission_grade ON public.lms_submissions;
CREATE TRIGGER phase2_validate_lms_submission_grade
BEFORE INSERT OR UPDATE ON public.lms_submissions
FOR EACH ROW EXECUTE FUNCTION public.phase2_validate_lms_submission_grade();

CREATE OR REPLACE FUNCTION public.phase2_grade_lms_submission(
  p_submission_id uuid,
  p_score numeric,
  p_feedback text DEFAULT NULL
)
RETURNS TABLE(
  submission_id uuid,
  assignment_id uuid,
  student_id uuid,
  score numeric,
  max_score numeric,
  status text,
  feedback text,
  graded_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_submission public.lms_submissions%ROWTYPE;
  v_course uuid;
  v_max numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT s.* INTO v_submission
  FROM public.lms_submissions s
  WHERE s.id = p_submission_id
    AND s.organization_id = public.current_user_org_id()
  FOR UPDATE;

  IF v_submission.id IS NULL THEN RAISE EXCEPTION 'Submission not found'; END IF;

  SELECT l.course_id, a.max_score INTO v_course, v_max
  FROM public.lms_assignments a
  JOIN public.lms_lessons l ON l.id = a.lesson_id
  WHERE a.id = v_submission.assignment_id
    AND a.organization_id = public.current_user_org_id();

  IF v_course IS NULL OR NOT public.phase1_teacher_course_scope(v_course) THEN
    RAISE EXCEPTION 'Teacher assignment or LMS administrator access required to grade';
  END IF;
  IF p_score IS NULL OR p_score < 0 OR p_score > v_max THEN
    RAISE EXCEPTION 'Score must be between 0 and %', v_max;
  END IF;

  UPDATE public.lms_submissions s
  SET score = p_score,
      feedback = NULLIF(btrim(COALESCE(p_feedback, '')), ''),
      status = 'graded',
      graded_at = now()
  WHERE s.id = p_submission_id;

  RETURN QUERY
  SELECT s.id, s.assignment_id, s.student_id, s.score, v_max,
         s.status, s.feedback, s.graded_at
  FROM public.lms_submissions s
  WHERE s.id = p_submission_id;
END $$;

REVOKE ALL ON FUNCTION public.phase2_grade_lms_submission(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.phase2_grade_lms_submission(uuid, numeric, text) TO authenticated;

COMMENT ON FUNCTION public.phase2_grade_lms_submission(uuid, numeric, text) IS
  'Authoritative LMS grading command: tenant-scoped, teacher-scoped, range-checked, and row-locked.';

COMMIT;

-- Verification after applying:
-- SELECT trigger_name, event_manipulation
-- FROM information_schema.triggers
-- WHERE event_object_schema = 'public' AND event_object_table = 'lms_submissions';
--
-- SELECT routine_name, security_type
-- FROM information_schema.routines
-- WHERE routine_schema = 'public' AND routine_name = 'phase2_grade_lms_submission';
