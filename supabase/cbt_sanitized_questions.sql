-- =====================================================================
-- CBT SANITIZED QUESTION DELIVERY
-- =====================================================================
-- After rls_role_scoped_access.sql, students can no longer read the
-- questions / exam_questions tables directly. These two SECURITY DEFINER
-- RPCs are the ONLY way a student receives exam content:
--
--   get_attempt_questions(attempt_id)
--     - Returns the questions for the exam of an attempt the caller
--       owns, with the answer keys STRIPPED: option `is_correct` flags
--       are removed and `answer_text` is never returned. This is what
--       the exam runner renders. A student inspecting the network tab
--       sees no correct answers.
--
--   get_attempt_review(attempt_id)
--     - Returns full questions WITH correctness + the student's own
--       submitted answer, but ONLY for a SUBMITTED/GRADED attempt the
--       caller owns AND only when the exam has show_answers = true.
--       This powers the post-exam "review answers" screen.
--
-- Staff keep normal table access via RLS for authoring/grading.
-- IDEMPOTENT. Run AFTER rls_role_scoped_access.sql.
-- =====================================================================

-- Helper: does the caller own this attempt? (student self or parent's child)
CREATE OR REPLACE FUNCTION public._owns_attempt(p_attempt uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM exam_attempts ea
    WHERE ea.id = p_attempt
      AND ea.student_id IN (SELECT student_id FROM public.my_linked_student_ids())
  );
$$;
GRANT EXECUTE ON FUNCTION public._owns_attempt(uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- get_attempt_questions — answer-stripped question payload
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_attempt_questions(p_attempt uuid)
RETURNS TABLE (
  id uuid,
  question_text text,
  question_type text,
  options jsonb,
  marks numeric,
  sort_order integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public._owns_attempt(p_attempt) AND NOT public.is_staff_user() THEN
    RAISE EXCEPTION 'Not authorized for this attempt';
  END IF;

  RETURN QUERY
  SELECT
    q.id,
    q.question_text,
    q.question_type,
    -- Strip the answer key from every option, keeping only id + text.
    -- For matching questions, keep the right-hand options as choices but
    -- drop any correctness metadata. Non-array option blobs return NULL.
    CASE
      WHEN jsonb_typeof(q.options) = 'array' THEN (
        SELECT COALESCE(jsonb_agg(jsonb_build_object('id', o->>'id', 'text', o->>'text')), '[]'::jsonb)
        FROM jsonb_array_elements(q.options) o
      )
      WHEN jsonb_typeof(q.options) = 'object' AND q.options ? 'pairs' THEN (
        -- matching: expose the left prompts and the shuffled right choices,
        -- but not which right belongs to which left.
        jsonb_build_object(
          'pairs', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object('left', p->>'left')), '[]'::jsonb)
            FROM jsonb_array_elements(q.options->'pairs') p
          ),
          'choices', (
            SELECT COALESCE(jsonb_agg(DISTINCT p->>'right'), '[]'::jsonb)
            FROM jsonb_array_elements(q.options->'pairs') p
          )
        )
      )
      ELSE NULL
    END AS options,
    COALESCE(eq.marks_override, q.marks) AS marks,
    eq.sort_order
  FROM exam_attempts ea
  JOIN exam_questions eq ON eq.exam_id = ea.exam_id
  JOIN questions q       ON q.id = eq.question_id
  WHERE ea.id = p_attempt
  ORDER BY eq.sort_order;
END $$;
GRANT EXECUTE ON FUNCTION public.get_attempt_questions(uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- get_attempt_review — full questions + own answers, post-submission only
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_attempt_review(p_attempt uuid)
RETURNS TABLE (
  question_id uuid,
  question_text text,
  question_type text,
  options jsonb,
  correct_answer_text text,
  explanation text,
  marks numeric,
  selected_option text,
  answer_text text,
  is_correct boolean,
  marks_awarded numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_status text;
  v_show boolean;
BEGIN
  IF NOT public._owns_attempt(p_attempt) AND NOT public.is_staff_user() THEN
    RAISE EXCEPTION 'Not authorized for this attempt';
  END IF;

  SELECT ea.status, e.show_answers
    INTO v_status, v_show
  FROM exam_attempts ea
  JOIN exams e ON e.id = ea.exam_id
  WHERE ea.id = p_attempt;

  -- Only reveal answers once the attempt is finished, and only if the
  -- exam is configured to show them (staff can always review).
  IF NOT public.is_staff_user() THEN
    IF v_status NOT IN ('submitted','graded','timed_out') THEN
      RAISE EXCEPTION 'Attempt is not yet submitted';
    END IF;
    IF COALESCE(v_show, false) = false THEN
      RAISE EXCEPTION 'Answer review is not enabled for this exam';
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    q.id,
    q.question_text,
    q.question_type,
    q.options,
    q.answer_text,
    q.explanation,
    COALESCE(eq.marks_override, q.marks),
    ans.selected_option,
    ans.answer_text,
    ans.is_correct,
    ans.marks_awarded
  FROM exam_attempts ea
  JOIN exam_questions eq ON eq.exam_id = ea.exam_id
  JOIN questions q       ON q.id = eq.question_id
  LEFT JOIN exam_answers ans ON ans.attempt_id = ea.id AND ans.question_id = q.id
  WHERE ea.id = p_attempt
  ORDER BY eq.sort_order;
END $$;
GRANT EXECUTE ON FUNCTION public.get_attempt_review(uuid) TO authenticated;
