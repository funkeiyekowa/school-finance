-- PHASE 2 — AUTHORITATIVE STUDENT ASSIGNMENT SUBMISSIONS
-- Run after lms_module.sql, Phase 1 security enforcement, grading integrity,
-- and rubric migrations. Safe to re-run. Existing submissions are unchanged.

BEGIN;

CREATE OR REPLACE FUNCTION public.phase2_submit_lms_assignment(
  p_assignment_id uuid,
  p_response_text text
)
RETURNS TABLE(submission_id uuid, status text, submitted_at timestamptz, updated_existing boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org uuid := public.current_user_org_id();
  v_student uuid;
  v_assignment public.lms_assignments%ROWTYPE;
  v_course uuid;
  v_submission public.lms_submissions%ROWTYPE;
  v_existing boolean := false;
  v_response text := btrim(COALESCE(p_response_text, ''));
BEGIN
  IF auth.uid() IS NULL OR public.phase1_active_role() <> 'student' THEN
    RAISE EXCEPTION 'Student authentication required';
  END IF;
  IF length(v_response) < 1 THEN RAISE EXCEPTION 'A response is required'; END IF;
  IF length(v_response) > 20000 THEN RAISE EXCEPTION 'Response must be 20,000 characters or fewer'; END IF;

  SELECT s.id INTO v_student
  FROM public.students s
  WHERE s.profile_id = auth.uid() AND s.organization_id = v_org AND s.status = 'active'
  LIMIT 1;
  IF v_student IS NULL THEN RAISE EXCEPTION 'No active student record is linked to this account'; END IF;

  SELECT a.* INTO v_assignment
  FROM public.lms_assignments a
  WHERE a.id = p_assignment_id AND a.organization_id = v_org
  FOR UPDATE;
  IF v_assignment.id IS NULL THEN RAISE EXCEPTION 'Assignment not found'; END IF;

  SELECT l.course_id INTO v_course
  FROM public.lms_lessons l
  JOIN public.lms_courses c ON c.id = l.course_id
  WHERE l.id = v_assignment.lesson_id
    AND l.organization_id = v_org
    AND l.status = 'published'
    AND c.organization_id = v_org
    AND c.status = 'published';
  IF v_course IS NULL THEN RAISE EXCEPTION 'Assignment is not available in a published lesson'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.lms_enrollments e
    WHERE e.course_id = v_course AND e.student_id = v_student
      AND e.organization_id = v_org AND e.status = 'active'
  ) THEN RAISE EXCEPTION 'Student is not actively enrolled in this course'; END IF;

  SELECT s.* INTO v_submission
  FROM public.lms_submissions s
  WHERE s.assignment_id = p_assignment_id AND s.student_id = v_student
  FOR UPDATE;

  IF v_submission.id IS NOT NULL THEN
    v_existing := true;
    IF v_submission.status = 'graded' THEN
      RAISE EXCEPTION 'A graded submission cannot be changed';
    END IF;
    UPDATE public.lms_submissions s
    SET response_text = v_response,
        status = 'submitted',
        submitted_at = now()
    WHERE s.id = v_submission.id
    RETURNING s.* INTO v_submission;
  ELSE
    INSERT INTO public.lms_submissions
      (assignment_id, student_id, response_text, status, submitted_at, organization_id)
    VALUES
      (p_assignment_id, v_student, v_response, 'submitted', now(), v_org)
    RETURNING * INTO v_submission;
  END IF;

  RETURN QUERY SELECT v_submission.id, v_submission.status, v_submission.submitted_at, v_existing;
END $$;

REVOKE ALL ON FUNCTION public.phase2_submit_lms_assignment(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.phase2_submit_lms_assignment(uuid,text) TO authenticated;

COMMENT ON FUNCTION public.phase2_submit_lms_assignment(uuid,text) IS
  'Student-owned, tenant-scoped assignment submission command. Allows resubmission only until grading.';

COMMIT;
