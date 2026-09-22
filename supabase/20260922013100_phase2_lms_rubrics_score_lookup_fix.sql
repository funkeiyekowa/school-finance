-- Apply immediately after 20260922013000_phase2_lms_rubrics.sql.
-- Replaces the criterion score lookup with explicit COUNT + LIMIT queries;
-- PostgreSQL does not define MIN(jsonb) on all supported installations.

BEGIN;

CREATE OR REPLACE FUNCTION public.phase2_grade_submission_with_rubric(
  p_submission_id uuid,
  p_scores jsonb,
  p_feedback text DEFAULT NULL
)
RETURNS TABLE(submission_id uuid, total_score numeric, max_score numeric, status text, graded_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_submission public.lms_submissions%ROWTYPE;
  v_rubric uuid;
  v_course uuid;
  v_max numeric;
  v_total numeric := 0;
  v_criterion record;
  v_score_item jsonb;
  v_matches integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF jsonb_typeof(p_scores) <> 'array' THEN RAISE EXCEPTION 'Rubric scores must be an array'; END IF;

  SELECT s.* INTO v_submission FROM public.lms_submissions s
  WHERE s.id = p_submission_id AND s.organization_id = public.current_user_org_id()
  FOR UPDATE;
  IF v_submission.id IS NULL THEN RAISE EXCEPTION 'Submission not found'; END IF;

  SELECT r.id, r.total_points, l.course_id INTO v_rubric, v_max, v_course
  FROM public.lms_rubrics r
  JOIN public.lms_assignments a ON a.id = r.assignment_id
  JOIN public.lms_lessons l ON l.id = a.lesson_id
  WHERE r.assignment_id = v_submission.assignment_id
    AND r.organization_id = public.current_user_org_id();
  IF v_rubric IS NULL THEN RAISE EXCEPTION 'This assignment has no rubric'; END IF;
  IF NOT public.phase1_teacher_course_scope(v_course) THEN
    RAISE EXCEPTION 'Teacher assignment or LMS administrator access required';
  END IF;

  IF jsonb_array_length(p_scores) <> (SELECT COUNT(*) FROM public.lms_rubric_criteria WHERE rubric_id = v_rubric) THEN
    RAISE EXCEPTION 'Every rubric criterion must be scored exactly once';
  END IF;

  FOR v_criterion IN
    SELECT * FROM public.lms_rubric_criteria WHERE rubric_id = v_rubric ORDER BY sort_order
  LOOP
    SELECT COUNT(*) INTO v_matches
    FROM jsonb_array_elements(p_scores) AS score_item(item)
    WHERE item->>'criterion_id' = v_criterion.id::text;
    IF v_matches <> 1 THEN
      RAISE EXCEPTION 'Every rubric criterion must be scored exactly once';
    END IF;

    SELECT item INTO v_score_item
    FROM jsonb_array_elements(p_scores) AS score_item(item)
    WHERE item->>'criterion_id' = v_criterion.id::text
    LIMIT 1;

    IF NULLIF(v_score_item->>'points', '') IS NULL THEN
      RAISE EXCEPTION 'Every rubric criterion requires numeric points';
    END IF;
    IF (v_score_item->>'points')::numeric < 0 OR (v_score_item->>'points')::numeric > v_criterion.max_points THEN
      RAISE EXCEPTION 'Criterion score must be between 0 and %', v_criterion.max_points;
    END IF;
    IF length(COALESCE(v_score_item->>'feedback', '')) > 2000 THEN
      RAISE EXCEPTION 'Criterion feedback must be 2,000 characters or fewer';
    END IF;
    v_total := v_total + (v_score_item->>'points')::numeric;
  END LOOP;

  DELETE FROM public.lms_rubric_scores rs
  USING public.lms_rubric_criteria rc
  WHERE rs.criterion_id = rc.id
    AND rc.rubric_id = v_rubric
    AND rs.submission_id = p_submission_id;

  INSERT INTO public.lms_rubric_scores
    (submission_id, criterion_id, points, feedback, organization_id, graded_by, graded_at)
  SELECT p_submission_id,
         (item->>'criterion_id')::uuid,
         (item->>'points')::numeric,
         NULLIF(btrim(COALESCE(item->>'feedback', '')), ''),
         v_submission.organization_id,
         auth.uid(), now()
  FROM jsonb_array_elements(p_scores) AS score_item(item);

  PERFORM * FROM public.phase2_grade_lms_submission(p_submission_id, v_total, p_feedback);

  RETURN QUERY
  SELECT s.id, s.score, v_max, s.status, s.graded_at
  FROM public.lms_submissions s
  WHERE s.id = p_submission_id;
END $$;

REVOKE ALL ON FUNCTION public.phase2_grade_submission_with_rubric(uuid,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.phase2_grade_submission_with_rubric(uuid,jsonb,text) TO authenticated;

COMMIT;
