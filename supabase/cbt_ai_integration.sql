-- ============================================================
-- CBT ↔ AI integration + exam auto-submit reason
-- ============================================================
-- Run order: after cbt_upgrade_migration.sql (#36), cbt_sanitized_questions.sql
--   (#51), cbt_save_answer_fix.sql (#69) and ai_assistant_module.sql (#70),
--   all already in supabase/README.md. Idempotent — safe to re-run.
--
-- Three things, all server-side:
--   1. exam_attempts.termination_reason — records WHY an attempt ended
--      (e.g. 'tab_switch_limit', 'timed_out', 'manual'). Purely additive.
--   2. has_active_exam_attempt() — returns true when the CALLING user has
--      an in_progress attempt they own. /api/ai/ask calls this to block the
--      AI Assistant during a live exam (enforced on the server, never on a
--      client flag).
--   3. submit_exam_attempt(p_attempt, p_timed_out, p_reason) — adds an
--      optional reason argument and stores it. The existing 2-arg calls keep
--      working (p_reason defaults to NULL); the runner now passes a reason.
--      Re-submission of an already-finished attempt is still refused (the
--      status guard from cbt_upgrade_migration.sql is preserved), so an
--      attempt can never be flipped back to in_progress.

-- ------------------------------------------------------------
-- 1. termination_reason column
-- ------------------------------------------------------------
ALTER TABLE public.exam_attempts
  ADD COLUMN IF NOT EXISTS termination_reason text;

COMMENT ON COLUMN public.exam_attempts.termination_reason IS
  'Why the attempt ended: manual | timed_out | tab_switch_limit (NULL while in_progress).';

-- ------------------------------------------------------------
-- 2. has_active_exam_attempt() — used by the AI interlock
-- ------------------------------------------------------------
-- True when the caller (resolved to their student row) has an attempt still
-- in_progress. STABLE + SECURITY DEFINER so it can read exam_attempts
-- regardless of the caller's own RLS, but it only ever checks the CALLER's
-- own student ids (my_linked_student_ids covers self + linked children).
CREATE OR REPLACE FUNCTION public.has_active_exam_attempt()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.exam_attempts ea
    WHERE ea.status = 'in_progress'
      AND (
        ea.student_id IN (SELECT id FROM public.students WHERE profile_id = auth.uid())
        OR ea.student_id IN (SELECT student_id FROM public.my_linked_student_ids())
      )
  );
$$;
GRANT EXECUTE ON FUNCTION public.has_active_exam_attempt() TO authenticated;

-- ------------------------------------------------------------
-- 3. submit_exam_attempt with optional reason
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_exam_attempt(
  p_attempt uuid,
  p_timed_out boolean DEFAULT false,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt exam_attempts;
  v_exam exams;
  v_my_student uuid;
  v_total_score numeric := 0;
  v_total_marks numeric := 0;
  v_percentage numeric;
  v_passed boolean;
  v_elapsed integer;
  v_reason text;
BEGIN
  SELECT * INTO v_attempt FROM exam_attempts WHERE id = p_attempt;
  IF v_attempt.id IS NULL THEN
    RAISE EXCEPTION 'Attempt not found';
  END IF;

  -- Ownership: caller must be the student who owns this attempt.
  SELECT id INTO v_my_student FROM students
    WHERE profile_id = auth.uid() LIMIT 1;
  IF v_my_student IS NULL OR v_my_student <> v_attempt.student_id THEN
    RAISE EXCEPTION 'You do not own this attempt';
  END IF;

  -- Never re-open or re-grade a finished attempt. Idempotent: return the
  -- stored totals. This is what prevents a submitted attempt from being
  -- flipped back to in_progress or double-submitted.
  IF v_attempt.status <> 'in_progress' THEN
    RETURN jsonb_build_object(
      'ok', true, 'already_submitted', true,
      'total_score', v_attempt.total_score,
      'total_marks', v_attempt.total_marks,
      'percentage', v_attempt.percentage,
      'passed',     v_attempt.passed
    );
  END IF;

  SELECT * INTO v_exam FROM exams WHERE id = v_attempt.exam_id;

  -- Grade every saved answer with the current grader.
  WITH graded AS (
    SELECT ea.id,
           grade_answer(
             jsonb_build_object(
               'question_type', q.question_type,
               'marks', q.marks,
               'options', q.options,
               'answer_text', q.answer_text,
               'case_sensitive', q.case_sensitive
             ),
             ea.selected_option,
             ea.answer_text
           ) AS g
    FROM exam_answers ea
    JOIN questions q ON q.id = ea.question_id
    WHERE ea.attempt_id = p_attempt
  )
  UPDATE exam_answers ea
     SET is_correct    = (g.g->>'is_correct')::boolean,
         marks_awarded = (g.g->>'marks_awarded')::numeric
    FROM graded g
   WHERE ea.id = g.id;

  SELECT COALESCE(SUM(COALESCE(ea.marks_awarded, 0)), 0),
         COALESCE(SUM(COALESCE(eq.marks_override, q.marks)), 0)
    INTO v_total_score, v_total_marks
  FROM exam_questions eq
  JOIN questions q ON q.id = eq.question_id
  LEFT JOIN exam_answers ea
         ON ea.attempt_id = p_attempt AND ea.question_id = q.id
  WHERE eq.exam_id = v_attempt.exam_id;

  v_percentage := CASE WHEN v_total_marks > 0
                       THEN ROUND((v_total_score / v_total_marks) * 100, 2)
                       ELSE 0 END;
  v_passed := CASE WHEN v_exam.pass_mark > 0
                   THEN v_total_score >= v_exam.pass_mark
                   ELSE NULL END;
  v_elapsed := GREATEST(0,
    EXTRACT(EPOCH FROM (now() - v_attempt.started_at))::integer);

  -- Normalise the reason. Default to 'timed_out' / 'manual' based on the
  -- boolean when no explicit reason was supplied, so older 2-arg callers
  -- still record something sensible.
  v_reason := COALESCE(
    NULLIF(p_reason, ''),
    CASE WHEN p_timed_out THEN 'timed_out' ELSE 'manual' END
  );

  UPDATE exam_attempts
     SET status = CASE WHEN p_timed_out OR v_reason IN ('timed_out','tab_switch_limit')
                       THEN 'timed_out' ELSE 'submitted' END,
         submitted_at = now(),
         total_score = v_total_score,
         total_marks = v_total_marks,
         percentage  = v_percentage,
         passed      = v_passed,
         time_spent_seconds = v_elapsed,
         termination_reason = v_reason
   WHERE id = p_attempt;

  RETURN jsonb_build_object(
    'ok', true, 'already_submitted', false,
    'total_score', v_total_score,
    'total_marks', v_total_marks,
    'percentage',  v_percentage,
    'passed',      v_passed,
    'reason',      v_reason
  );
END $$;

GRANT EXECUTE ON FUNCTION public.submit_exam_attempt(uuid, boolean, text) TO authenticated;

-- ------------------------------------------------------------
-- Verification
-- ------------------------------------------------------------
-- 1. Column present.
SELECT column_name FROM information_schema.columns
WHERE table_name = 'exam_attempts' AND column_name = 'termination_reason';

-- 2. Functions present (both submit_exam_attempt arities may coexist).
SELECT proname, pg_get_function_identity_arguments(oid) AS args
FROM pg_proc
WHERE proname IN ('has_active_exam_attempt', 'submit_exam_attempt')
ORDER BY proname, args;
