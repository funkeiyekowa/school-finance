-- ============================================================
-- CBT FIX: reliable answer persistence + regrade RPC
-- ============================================================
-- Run order: after cbt_upgrade_migration.sql, cbt_sanitized_questions.sql,
--   tenant_isolation_full.sql and rls_role_scoped_access.sql (all already
--   in supabase/README.md). Idempotent — safe to re-run.
--
-- WHY THIS EXISTS
-- ---------------
-- Root cause of "student answered everything correctly but scored 0/Fail":
-- the exam runner saved each answer with a direct client-side upsert into
-- exam_answers. That table now has TWO relevant RLS policies:
--   • answers_self_all      (rls_role_scoped_access.sql) — lets a student
--     write answers for their own in-progress attempt, but does NOT set
--     organization_id.
--   • tenant_exam_answers_all (tenant_isolation_full.sql) — FOR ALL with
--     WITH CHECK (organization_id = current_user_org_id()).
-- The client upsert never sent organization_id, and the student->attempt
-- ownership path (my_linked_student_ids) is not guaranteed to resolve for
-- every student login, so the INSERT was silently rejected by RLS. Because
-- the runner fired the upsert fire-and-forget, the failure was invisible:
-- exam_answers stayed empty, and submit_exam_attempt then had nothing to
-- grade -> total_score 0, passed=false for everyone.
--
-- THE FIX
-- -------
-- Persist answers through a SECURITY DEFINER RPC that (a) verifies the
-- caller owns the attempt and it is still in_progress, (b) stamps the
-- correct organization_id from the attempt, and (c) upserts the row. This
-- removes the dependency on the fragile client-side RLS write path and
-- makes save failures surface to the caller instead of vanishing.
--
-- Also adds admin_regrade_attempt() so staff can re-run grading on an
-- already-submitted attempt after this fix (e.g. to re-score papers that
-- were affected — though papers submitted with zero saved answers cannot
-- be recovered and must be retaken).

-- ------------------------------------------------------------
-- 1. save_exam_answer — the runner's write channel
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_exam_answer(
  p_attempt uuid,
  p_question uuid,
  p_selected_option text DEFAULT NULL,
  p_answer_text text DEFAULT NULL,
  p_flagged boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_attempt exam_attempts;
  v_owns boolean;
BEGIN
  SELECT * INTO v_attempt FROM exam_attempts WHERE id = p_attempt;
  IF v_attempt.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'attempt_not_found');
  END IF;

  -- Ownership: the attempt's student must belong to the caller. Accept
  -- either the direct profile_id link or the my_linked_student_ids() set
  -- (covers parent-proxy and any indirection), so a save never silently
  -- fails the way the raw RLS INSERT did.
  SELECT (
    v_attempt.student_id IN (SELECT id FROM students WHERE profile_id = auth.uid())
    OR v_attempt.student_id IN (SELECT student_id FROM public.my_linked_student_ids())
  ) INTO v_owns;

  IF NOT COALESCE(v_owns, false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_owner');
  END IF;

  IF v_attempt.status <> 'in_progress' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_in_progress');
  END IF;

  INSERT INTO exam_answers (
    attempt_id, question_id, selected_option, answer_text, flagged,
    organization_id, updated_at
  )
  VALUES (
    p_attempt, p_question, p_selected_option, p_answer_text, COALESCE(p_flagged, false),
    v_attempt.organization_id, now()
  )
  ON CONFLICT (attempt_id, question_id) DO UPDATE
    SET selected_option = EXCLUDED.selected_option,
        answer_text     = EXCLUDED.answer_text,
        flagged         = EXCLUDED.flagged,
        updated_at      = now();

  RETURN jsonb_build_object('ok', true);
END $$;

GRANT EXECUTE ON FUNCTION public.save_exam_answer(uuid, uuid, text, text, boolean) TO authenticated;

-- ------------------------------------------------------------
-- 2. admin_regrade_attempt — re-run grading for one attempt
-- ------------------------------------------------------------
-- Staff-only. Recomputes is_correct / marks_awarded for every saved
-- answer using the CURRENT grade_answer(), then recomputes the attempt
-- totals. Useful for attempts that had saved answers graded 0 by an
-- earlier grader. Does nothing to recover attempts that saved no answers.
CREATE OR REPLACE FUNCTION public.admin_regrade_attempt(p_attempt uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_attempt exam_attempts;
  v_exam exams;
  v_total_score numeric := 0;
  v_total_marks numeric := 0;
  v_percentage numeric;
  v_passed boolean;
BEGIN
  IF NOT public.is_staff_user() THEN
    RAISE EXCEPTION 'Only staff can regrade attempts';
  END IF;

  SELECT * INTO v_attempt FROM exam_attempts WHERE id = p_attempt;
  IF v_attempt.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'attempt_not_found');
  END IF;
  SELECT * INTO v_exam FROM exams WHERE id = v_attempt.exam_id;

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
                       THEN ROUND((v_total_score / v_total_marks) * 100, 2) ELSE 0 END;
  v_passed := CASE WHEN v_exam.pass_mark > 0 THEN v_total_score >= v_exam.pass_mark ELSE NULL END;

  UPDATE exam_attempts
     SET total_score = v_total_score,
         total_marks = v_total_marks,
         percentage  = v_percentage,
         passed      = v_passed
   WHERE id = p_attempt;

  RETURN jsonb_build_object('ok', true,
    'total_score', v_total_score, 'total_marks', v_total_marks,
    'percentage', v_percentage, 'passed', v_passed);
END $$;

GRANT EXECUTE ON FUNCTION public.admin_regrade_attempt(uuid) TO authenticated;

-- ------------------------------------------------------------
-- Verification
-- ------------------------------------------------------------
-- 1. Both functions exist.
SELECT proname, pg_get_function_identity_arguments(oid) AS args
FROM pg_proc
WHERE proname IN ('save_exam_answer', 'admin_regrade_attempt')
ORDER BY proname;

-- 2. Sanity: after students take a NEW exam post-deploy, this should be > 0.
SELECT count(*) AS exam_answer_rows FROM exam_answers;
