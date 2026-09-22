-- ============================================================================
-- PHASE 2 — LMS RUBRICS AND CRITERION-LEVEL GRADING
-- ============================================================================
-- Run manually AFTER:
--   1. lms_module.sql
--   2. 20260905120000_phase1_security_enforcement.sql
--   3. 20260922011500_phase2_lms_grading_integrity.sql
--
-- Additive and safe to re-run. No existing assignment or grade is changed.
-- Rollback: drop phase2_grade_submission_with_rubric,
-- phase2_save_assignment_rubric, then lms_rubric_scores,
-- lms_rubric_criteria, and lms_rubrics. Existing final grades remain.
-- ============================================================================

BEGIN;

DO $$
DECLARE missing text[] := ARRAY[]::text[];
BEGIN
  IF to_regclass('public.lms_assignments') IS NULL THEN missing := missing || 'lms_assignments'; END IF;
  IF to_regclass('public.lms_submissions') IS NULL THEN missing := missing || 'lms_submissions'; END IF;
  IF to_regprocedure('public.phase1_teacher_course_scope(uuid)') IS NULL THEN missing := missing || 'phase1_teacher_course_scope(uuid)'; END IF;
  IF to_regprocedure('public.phase2_grade_lms_submission(uuid,numeric,text)') IS NULL THEN missing := missing || 'phase2_grade_lms_submission(uuid,numeric,text)'; END IF;
  IF array_length(missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'Phase 2 rubric prerequisites missing: %', array_to_string(missing, ', ');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.lms_rubrics (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  assignment_id uuid NOT NULL UNIQUE REFERENCES public.lms_assignments(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  total_points numeric(8,2) NOT NULL CHECK (total_points > 0),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lms_rubric_criteria (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  rubric_id uuid NOT NULL REFERENCES public.lms_rubrics(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  max_points numeric(8,2) NOT NULL CHECK (max_points > 0),
  sort_order integer NOT NULL DEFAULT 0,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lms_rubric_scores (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  submission_id uuid NOT NULL REFERENCES public.lms_submissions(id) ON DELETE CASCADE,
  criterion_id uuid NOT NULL REFERENCES public.lms_rubric_criteria(id) ON DELETE CASCADE,
  points numeric(8,2) NOT NULL CHECK (points >= 0),
  feedback text,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  graded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  graded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(submission_id, criterion_id)
);

CREATE INDEX IF NOT EXISTS idx_lms_rubrics_org ON public.lms_rubrics(organization_id);
CREATE INDEX IF NOT EXISTS idx_lms_rubric_criteria_rubric ON public.lms_rubric_criteria(rubric_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_lms_rubric_scores_submission ON public.lms_rubric_scores(submission_id);
CREATE INDEX IF NOT EXISTS idx_lms_rubric_scores_org ON public.lms_rubric_scores(organization_id);

ALTER TABLE public.lms_rubrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lms_rubric_criteria ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lms_rubric_scores ENABLE ROW LEVEL SECURITY;

SELECT public._reset_policies('lms_rubrics');
CREATE POLICY phase2_rubrics_teacher_all ON public.lms_rubrics FOR ALL
USING (public.phase1_same_org(organization_id) AND public.phase1_teacher_course_scope((
  SELECT l.course_id FROM public.lms_assignments a JOIN public.lms_lessons l ON l.id = a.lesson_id
  WHERE a.id = public.lms_rubrics.assignment_id
)))
WITH CHECK (public.phase1_same_org(organization_id) AND public.phase1_teacher_course_scope((
  SELECT l.course_id FROM public.lms_assignments a JOIN public.lms_lessons l ON l.id = a.lesson_id
  WHERE a.id = public.lms_rubrics.assignment_id
)));
CREATE POLICY phase2_rubrics_student_read ON public.lms_rubrics FOR SELECT
USING (public.phase1_same_org(organization_id) AND EXISTS (
  SELECT 1 FROM public.lms_assignments a
  JOIN public.lms_lessons l ON l.id = a.lesson_id
  JOIN public.lms_enrollments e ON e.course_id = l.course_id
  WHERE a.id = public.lms_rubrics.assignment_id
    AND e.status IN ('active','completed')
    AND e.student_id IN (SELECT student_id FROM public.my_linked_student_ids())
));

SELECT public._reset_policies('lms_rubric_criteria');
CREATE POLICY phase2_rubric_criteria_teacher_all ON public.lms_rubric_criteria FOR ALL
USING (public.phase1_same_org(organization_id) AND public.phase1_teacher_course_scope((
  SELECT l.course_id FROM public.lms_rubrics r
  JOIN public.lms_assignments a ON a.id = r.assignment_id
  JOIN public.lms_lessons l ON l.id = a.lesson_id
  WHERE r.id = public.lms_rubric_criteria.rubric_id
)))
WITH CHECK (public.phase1_same_org(organization_id) AND public.phase1_teacher_course_scope((
  SELECT l.course_id FROM public.lms_rubrics r
  JOIN public.lms_assignments a ON a.id = r.assignment_id
  JOIN public.lms_lessons l ON l.id = a.lesson_id
  WHERE r.id = public.lms_rubric_criteria.rubric_id
)));
CREATE POLICY phase2_rubric_criteria_student_read ON public.lms_rubric_criteria FOR SELECT
USING (public.phase1_same_org(organization_id) AND EXISTS (
  SELECT 1 FROM public.lms_rubrics r
  JOIN public.lms_assignments a ON a.id = r.assignment_id
  JOIN public.lms_lessons l ON l.id = a.lesson_id
  JOIN public.lms_enrollments e ON e.course_id = l.course_id
  WHERE r.id = public.lms_rubric_criteria.rubric_id
    AND e.status IN ('active','completed')
    AND e.student_id IN (SELECT student_id FROM public.my_linked_student_ids())
));

SELECT public._reset_policies('lms_rubric_scores');
CREATE POLICY phase2_rubric_scores_teacher_all ON public.lms_rubric_scores FOR ALL
USING (public.phase1_same_org(organization_id) AND public.phase1_teacher_course_scope((
  SELECT l.course_id FROM public.lms_submissions s
  JOIN public.lms_assignments a ON a.id = s.assignment_id
  JOIN public.lms_lessons l ON l.id = a.lesson_id
  WHERE s.id = public.lms_rubric_scores.submission_id
)))
WITH CHECK (public.phase1_same_org(organization_id) AND public.phase1_teacher_course_scope((
  SELECT l.course_id FROM public.lms_submissions s
  JOIN public.lms_assignments a ON a.id = s.assignment_id
  JOIN public.lms_lessons l ON l.id = a.lesson_id
  WHERE s.id = public.lms_rubric_scores.submission_id
)));
CREATE POLICY phase2_rubric_scores_self_read ON public.lms_rubric_scores FOR SELECT
USING (public.phase1_same_org(organization_id) AND EXISTS (
  SELECT 1 FROM public.lms_submissions s
  WHERE s.id = public.lms_rubric_scores.submission_id
    AND s.student_id IN (SELECT student_id FROM public.my_linked_student_ids())
));

CREATE OR REPLACE FUNCTION public.phase2_save_assignment_rubric(
  p_assignment_id uuid,
  p_title text,
  p_description text,
  p_criteria jsonb
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_assignment public.lms_assignments%ROWTYPE;
  v_course uuid;
  v_rubric uuid;
  v_count integer;
  v_total numeric := 0;
  v_item jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NULLIF(btrim(COALESCE(p_title, '')), '') IS NULL THEN RAISE EXCEPTION 'Rubric title is required'; END IF;
  IF jsonb_typeof(p_criteria) <> 'array' THEN RAISE EXCEPTION 'Rubric criteria must be an array'; END IF;

  SELECT a.* INTO v_assignment FROM public.lms_assignments a
  WHERE a.id = p_assignment_id AND a.organization_id = public.current_user_org_id()
  FOR UPDATE;
  IF v_assignment.id IS NULL THEN RAISE EXCEPTION 'Assignment not found'; END IF;
  SELECT l.course_id INTO v_course FROM public.lms_lessons l WHERE l.id = v_assignment.lesson_id;
  IF NOT public.phase1_teacher_course_scope(v_course) THEN RAISE EXCEPTION 'Teacher assignment or LMS administrator access required'; END IF;

  v_count := jsonb_array_length(p_criteria);
  IF v_count < 1 OR v_count > 20 THEN RAISE EXCEPTION 'A rubric requires 1 to 20 criteria'; END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_criteria) LOOP
    IF NULLIF(btrim(COALESCE(v_item->>'title', '')), '') IS NULL THEN RAISE EXCEPTION 'Every criterion requires a title'; END IF;
    IF COALESCE((v_item->>'max_points')::numeric, 0) <= 0 THEN RAISE EXCEPTION 'Every criterion requires positive max_points'; END IF;
    v_total := v_total + (v_item->>'max_points')::numeric;
  END LOOP;
  IF v_total IS DISTINCT FROM v_assignment.max_score THEN
    RAISE EXCEPTION 'Rubric total (%) must equal assignment maximum (%)', v_total, v_assignment.max_score;
  END IF;

  SELECT r.id INTO v_rubric FROM public.lms_rubrics r WHERE r.assignment_id = p_assignment_id;
  IF v_rubric IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.lms_rubric_scores rs
    JOIN public.lms_rubric_criteria rc ON rc.id = rs.criterion_id
    WHERE rc.rubric_id = v_rubric
  ) THEN RAISE EXCEPTION 'Cannot edit a rubric after scoring has begun'; END IF;

  INSERT INTO public.lms_rubrics (assignment_id, title, description, total_points, organization_id, created_by, updated_at)
  VALUES (p_assignment_id, btrim(p_title), NULLIF(btrim(COALESCE(p_description, '')), ''), v_total, v_assignment.organization_id, auth.uid(), now())
  ON CONFLICT (assignment_id) DO UPDATE SET
    title = EXCLUDED.title, description = EXCLUDED.description,
    total_points = EXCLUDED.total_points, updated_at = now()
  RETURNING id INTO v_rubric;

  DELETE FROM public.lms_rubric_criteria WHERE rubric_id = v_rubric;
  INSERT INTO public.lms_rubric_criteria (rubric_id, title, description, max_points, sort_order, organization_id)
  SELECT v_rubric,
         btrim(item->>'title'),
         NULLIF(btrim(COALESCE(item->>'description', '')), ''),
         (item->>'max_points')::numeric,
         ordinal::integer - 1,
         v_assignment.organization_id
  FROM jsonb_array_elements(p_criteria) WITH ORDINALITY AS criteria(item, ordinal);

  RETURN v_rubric;
END $$;

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
  IF NOT public.phase1_teacher_course_scope(v_course) THEN RAISE EXCEPTION 'Teacher assignment or LMS administrator access required'; END IF;

  IF jsonb_array_length(p_scores) <> (SELECT COUNT(*) FROM public.lms_rubric_criteria WHERE rubric_id = v_rubric) THEN
    RAISE EXCEPTION 'Every rubric criterion must be scored exactly once';
  END IF;

  FOR v_criterion IN SELECT * FROM public.lms_rubric_criteria WHERE rubric_id = v_rubric ORDER BY sort_order LOOP
    SELECT COUNT(*), MIN(item) INTO v_matches, v_score_item
    FROM jsonb_array_elements(p_scores) item
    WHERE item->>'criterion_id' = v_criterion.id::text;
    IF v_matches <> 1 THEN RAISE EXCEPTION 'Every rubric criterion must be scored exactly once'; END IF;
    IF (v_score_item->>'points')::numeric < 0 OR (v_score_item->>'points')::numeric > v_criterion.max_points THEN
      RAISE EXCEPTION 'Criterion score must be between 0 and %', v_criterion.max_points;
    END IF;
    v_total := v_total + (v_score_item->>'points')::numeric;
  END LOOP;

  DELETE FROM public.lms_rubric_scores rs
  USING public.lms_rubric_criteria rc
  WHERE rs.criterion_id = rc.id AND rc.rubric_id = v_rubric AND rs.submission_id = p_submission_id;

  INSERT INTO public.lms_rubric_scores (submission_id, criterion_id, points, feedback, organization_id, graded_by, graded_at)
  SELECT p_submission_id,
         (item->>'criterion_id')::uuid,
         (item->>'points')::numeric,
         NULLIF(btrim(COALESCE(item->>'feedback', '')), ''),
         v_submission.organization_id,
         auth.uid(), now()
  FROM jsonb_array_elements(p_scores) item;

  PERFORM * FROM public.phase2_grade_lms_submission(p_submission_id, v_total, p_feedback);

  RETURN QUERY SELECT s.id, s.score, v_max, s.status, s.graded_at
  FROM public.lms_submissions s WHERE s.id = p_submission_id;
END $$;

REVOKE ALL ON FUNCTION public.phase2_save_assignment_rubric(uuid,text,text,jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.phase2_grade_submission_with_rubric(uuid,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.phase2_save_assignment_rubric(uuid,text,text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.phase2_grade_submission_with_rubric(uuid,jsonb,text) TO authenticated;

COMMIT;

-- Verification:
-- SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'lms_rubric%';
-- SELECT routine_name FROM information_schema.routines WHERE routine_schema='public' AND routine_name LIKE 'phase2_%rubric%';
