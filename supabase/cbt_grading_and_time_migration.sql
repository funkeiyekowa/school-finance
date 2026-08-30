-- ============================================================
-- CBT GRADING + SERVER-SIDE TIME ENFORCEMENT MIGRATION
-- ============================================================
-- Run this LAST — after cbt_migration.sql, cbt_upgrade_migration.sql,
-- report_card_and_portals_migration.sql, tenant_isolation_full.sql,
-- rls_role_scoped_access.sql and cbt_sanitized_questions.sql.
-- It must be the final migration to touch exam_answers: it recreates the
-- answers_self_all policy with a time gate, and re-running
-- rls_role_scoped_access.sql afterwards would drop that gate (re-run
-- section 3 if you ever do). Safe to re-run (CREATE OR REPLACE / DROP..CREATE).
--
-- What this adds
-- --------------
-- 1. can_grade_org()      — teacher/staff/admin authorization helper.
-- 2. attempt_is_open()    — true only while an attempt is in_progress
--                           AND still inside its time budget. Used to
--                           tighten the student answer-write policy so
--                           the auto-save loop can't write after time.
-- 3. answers_self_all     — student answer policy recreated with the
--                           attempt_is_open() time gate on WITH CHECK, so
--                           the auto-save loop can't write after time.
-- 4. submit_exam_attempt() — now records a submission that arrives past
--                           the deadline as 'timed_out', server-side,
--                           even if the client claims otherwise.
-- 5. get_exam_submissions() — attempts list for the teacher grading UI
--                           (SECURITY DEFINER: bypasses RLS so essay
--                           answers written by students — whose rows may
--                           carry a NULL organization_id — are visible).
-- 6. get_attempt_answers()  — per-attempt answer detail for grading.
-- 7. grade_attempt()        — writes manual marks for essay/short answers,
--                           recomputes totals, sets status='graded'.
--
-- Design note: 5/6/7 are SECURITY DEFINER and gated by can_grade_org()
-- so a teacher only ever sees/grades attempts inside their own org, and
-- grading never depends on exam_answers.organization_id being populated.
-- ============================================================


-- ------------------------------------------------------------
-- 1. HELPER: may the caller grade attempts in this org?
--    Admins/owners/super_admins (via is_org_admin) plus teachers
--    and staff. Platform admins pass through is_org_admin().
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_grade_org(p_org uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT is_org_admin(p_org) OR EXISTS (
    SELECT 1 FROM org_memberships
    WHERE user_id = auth.uid()
      AND organization_id = p_org
      AND active = true
      AND role IN ('teacher', 'staff')
  );
$$;

GRANT EXECUTE ON FUNCTION public.can_grade_org(uuid) TO authenticated;


-- ------------------------------------------------------------
-- 2. HELPER: is this attempt still open for writing?
--    True only while status='in_progress' and the current time is
--    within the exam's duration window (from started_at) and before
--    exams.ends_at. A small grace absorbs clock skew and a final
--    autosave landing right on the buzzer.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.attempt_is_open(p_attempt uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM exam_attempts a
    JOIN exams e ON e.id = a.exam_id
    WHERE a.id = p_attempt
      AND a.status = 'in_progress'
      AND (
        COALESCE(e.duration_minutes, 0) = 0
        OR now() <= a.started_at
                    + make_interval(mins => e.duration_minutes)
                    + interval '30 seconds'
      )
      AND (e.ends_at IS NULL OR now() <= e.ends_at + interval '30 seconds')
  );
$$;

GRANT EXECUTE ON FUNCTION public.attempt_is_open(uuid) TO authenticated;


-- ------------------------------------------------------------
-- 3. Tighten the student answer-write policy with the time gate.
--
--    rls_role_scoped_access.sql is the final word on exam_answers RLS:
--    it drops every prior policy (via _reset_policies) and installs
--    answers_staff_all + answers_self_all. answers_self_all lets a
--    student READ answers for any of their linked attempts (so post-exam
--    review still works) but only WRITE while status = 'in_progress'.
--
--    Here we recreate answers_self_all identically EXCEPT we append the
--    attempt_is_open() time gate to the WITH CHECK only. Once an attempt
--    is past its budget, attempt_is_open() returns false and the auto-save
--    upsert is rejected by RLS — a client that keeps the tab open can no
--    longer mutate answers after time expires. USING is left untouched so
--    read-back / review is unaffected.
--
--    Postgres OR-combines permissive policies, so we must REPLACE
--    answers_self_all in place: adding a second policy would leave the
--    un-gated write path open and defeat the gate. This migration must
--    therefore be the LAST one to touch exam_answers — re-running
--    rls_role_scoped_access.sql afterwards drops this gate, so re-run
--    this section after any such reset.
-- ------------------------------------------------------------
-- Legacy name from cbt_upgrade_migration.sql (normally already removed by
-- rls_role_scoped_access's _reset_policies) — drop defensively.
DROP POLICY IF EXISTS student_own_answers_all ON public.exam_answers;
DROP POLICY IF EXISTS answers_self_all        ON public.exam_answers;

CREATE POLICY answers_self_all ON public.exam_answers FOR ALL
  USING (
    attempt_id IN (
      SELECT ea.id FROM public.exam_attempts ea
      WHERE ea.student_id IN (SELECT student_id FROM public.my_linked_student_ids())
    )
  )
  WITH CHECK (
    attempt_id IN (
      SELECT ea.id FROM public.exam_attempts ea
      WHERE ea.student_id IN (SELECT student_id FROM public.my_linked_student_ids())
        AND ea.status = 'in_progress'
    )
    AND public.attempt_is_open(attempt_id)
  );


-- ------------------------------------------------------------
-- 4. submit_exam_attempt — same as cbt_upgrade_migration.sql PLUS a
--    server-side deadline check. If the attempt is submitted after
--    its computed deadline (duration from started_at, capped by
--    exams.ends_at), it is recorded as 'timed_out' regardless of the
--    p_timed_out flag the client sends.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_exam_attempt(
  p_attempt uuid,
  p_timed_out boolean DEFAULT false
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
  v_deadline timestamptz;
  v_late boolean := false;
BEGIN
  SELECT * INTO v_attempt FROM exam_attempts WHERE id = p_attempt;
  IF v_attempt.id IS NULL THEN
    RAISE EXCEPTION 'Attempt not found';
  END IF;

  SELECT id INTO v_my_student FROM students
    WHERE profile_id = auth.uid() LIMIT 1;
  IF v_my_student IS NULL OR v_my_student <> v_attempt.student_id THEN
    RAISE EXCEPTION 'You do not own this attempt';
  END IF;

  IF v_attempt.status <> 'in_progress' THEN
    -- Already submitted — return the recorded totals.
    RETURN jsonb_build_object(
      'ok', true, 'already_submitted', true,
      'total_score', v_attempt.total_score,
      'total_marks', v_attempt.total_marks,
      'percentage', v_attempt.percentage,
      'passed',     v_attempt.passed
    );
  END IF;

  SELECT * INTO v_exam FROM exams WHERE id = v_attempt.exam_id;

  -- ---- Server-side deadline: don't trust the client's timer alone. ----
  IF COALESCE(v_exam.duration_minutes, 0) > 0 THEN
    v_deadline := v_attempt.started_at + make_interval(mins => v_exam.duration_minutes);
  END IF;
  IF v_exam.ends_at IS NOT NULL
     AND (v_deadline IS NULL OR v_exam.ends_at < v_deadline) THEN
    v_deadline := v_exam.ends_at;
  END IF;
  v_late := (v_deadline IS NOT NULL AND now() > v_deadline + interval '15 seconds');

  -- Grade every answer, including ones the client hasn't already graded.
  WITH graded AS (
    SELECT ea.id,
           q.question_type, q.marks,
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
     SET is_correct   = (g.g->>'is_correct')::boolean,
         marks_awarded = (g.g->>'marks_awarded')::numeric
    FROM graded g
   WHERE ea.id = g.id;

  -- Sum totals across every exam question, using zero for questions
  -- the student left unanswered.
  SELECT COALESCE(SUM(COALESCE(ea.marks_awarded, 0)), 0),
         COALESCE(SUM(COALESCE(eq_marks.m, q.marks)), 0)
    INTO v_total_score, v_total_marks
  FROM exam_questions eq
  JOIN questions q ON q.id = eq.question_id
  LEFT JOIN LATERAL (SELECT eq.marks_override AS m) eq_marks ON true
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

  UPDATE exam_attempts
     SET status = CASE WHEN p_timed_out OR v_late THEN 'timed_out' ELSE 'submitted' END,
         submitted_at = now(),
         total_score = v_total_score,
         total_marks = v_total_marks,
         percentage  = v_percentage,
         passed      = v_passed,
         time_spent_seconds = v_elapsed
   WHERE id = p_attempt;

  RETURN jsonb_build_object(
    'ok', true, 'already_submitted', false,
    'timed_out',   (p_timed_out OR v_late),
    'total_score', v_total_score,
    'total_marks', v_total_marks,
    'percentage',  v_percentage,
    'passed',      v_passed
  );
END $$;

GRANT EXECUTE ON FUNCTION public.submit_exam_attempt(uuid, boolean) TO authenticated;


-- ------------------------------------------------------------
-- 5. RPC: get_exam_submissions — the attempts list for one exam.
--    Returns student name/code, status, score and a needs_grading
--    flag (true when the attempt has an essay answer that hasn't
--    been manually marked yet and the attempt isn't already graded).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_exam_submissions(p_exam uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_rows jsonb;
BEGIN
  SELECT organization_id INTO v_org FROM exams WHERE id = p_exam;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Exam not found';
  END IF;
  IF NOT can_grade_org(v_org) THEN
    RAISE EXCEPTION 'Not authorized to view submissions for this exam';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      to_jsonb(t)
      ORDER BY t.needs_grading DESC, t.submitted_at DESC NULLS LAST
    ),
    '[]'::jsonb
  )
    INTO v_rows
  FROM (
    SELECT a.id,
           a.student_id,
           s.full_name    AS student_name,
           s.student_code AS student_code,
           a.attempt_number,
           a.status,
           a.total_score,
           a.total_marks,
           a.percentage,
           a.passed,
           a.submitted_at,
           a.started_at,
           (
             a.status <> 'graded'
             AND EXISTS (
               SELECT 1
               FROM exam_answers ea
               JOIN questions q ON q.id = ea.question_id
               WHERE ea.attempt_id = a.id
                 AND q.question_type = 'essay'
                 AND ea.is_correct IS NULL
             )
           ) AS needs_grading
    FROM exam_attempts a
    LEFT JOIN students s ON s.id = a.student_id
    WHERE a.exam_id = p_exam
      AND a.status IN ('submitted', 'timed_out', 'graded')
  ) t;

  RETURN jsonb_build_object('ok', true, 'submissions', v_rows);
END $$;

GRANT EXECUTE ON FUNCTION public.get_exam_submissions(uuid) TO authenticated;


-- ------------------------------------------------------------
-- 6. RPC: get_attempt_answers — the per-question detail a teacher
--    needs to grade one attempt. Includes the student's answer, the
--    auto-grade result, the marks cap, and (for reference) the
--    model answer / options.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_attempt_answers(p_attempt uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt exam_attempts;
  v_org uuid;
  v_answers jsonb;
BEGIN
  SELECT * INTO v_attempt FROM exam_attempts WHERE id = p_attempt;
  IF v_attempt.id IS NULL THEN
    RAISE EXCEPTION 'Attempt not found';
  END IF;
  v_org := v_attempt.organization_id;
  IF NOT can_grade_org(v_org) THEN
    RAISE EXCEPTION 'Not authorized to view this attempt';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.sort_order), '[]'::jsonb)
    INTO v_answers
  FROM (
    SELECT eq.sort_order,
           q.id                              AS question_id,
           q.question_text,
           q.question_type,
           COALESCE(eq.marks_override, q.marks) AS marks,
           q.options,
           q.answer_text                     AS model_answer,
           q.explanation,
           ea.id                             AS answer_id,
           ea.selected_option,
           ea.answer_text,
           ea.is_correct,
           ea.marks_awarded
    FROM exam_questions eq
    JOIN questions q ON q.id = eq.question_id
    LEFT JOIN exam_answers ea
           ON ea.attempt_id = p_attempt AND ea.question_id = q.id
    WHERE eq.exam_id = v_attempt.exam_id
  ) t;

  RETURN jsonb_build_object(
    'ok', true,
    'attempt', jsonb_build_object(
      'id',          v_attempt.id,
      'status',      v_attempt.status,
      'total_score', v_attempt.total_score,
      'total_marks', v_attempt.total_marks,
      'percentage',  v_attempt.percentage,
      'passed',      v_attempt.passed
    ),
    'answers', v_answers
  );
END $$;

GRANT EXECUTE ON FUNCTION public.get_attempt_answers(uuid) TO authenticated;


-- ------------------------------------------------------------
-- 7. RPC: grade_attempt — apply a teacher's manual marks, recompute
--    totals exactly the way submit_exam_attempt does, and flip the
--    attempt to 'graded'.
--
--    p_marks: jsonb array of {"question_id": uuid, "marks": number}.
--    Each mark is clamped to [0, question max]. Questions omitted from
--    p_marks keep whatever marks_awarded they already have (so the
--    auto-graded objective questions are preserved).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.grade_attempt(
  p_attempt uuid,
  p_marks jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt exam_attempts;
  v_exam exams;
  v_org uuid;
  v_total_score numeric := 0;
  v_total_marks numeric := 0;
  v_percentage numeric;
  v_passed boolean;
  v_item jsonb;
  v_qid uuid;
  v_marks numeric;
  v_qmax numeric;
BEGIN
  SELECT * INTO v_attempt FROM exam_attempts WHERE id = p_attempt;
  IF v_attempt.id IS NULL THEN
    RAISE EXCEPTION 'Attempt not found';
  END IF;
  v_org := v_attempt.organization_id;
  IF NOT can_grade_org(v_org) THEN
    RAISE EXCEPTION 'Not authorized to grade this attempt';
  END IF;

  SELECT * INTO v_exam FROM exams WHERE id = v_attempt.exam_id;

  -- Apply each manual mark, clamped to that question's maximum.
  IF p_marks IS NOT NULL AND jsonb_typeof(p_marks) = 'array' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_marks)
    LOOP
      v_qid := NULLIF(v_item->>'question_id', '')::uuid;
      IF v_qid IS NULL THEN CONTINUE; END IF;
      v_marks := COALESCE((v_item->>'marks')::numeric, 0);

      SELECT COALESCE(eq.marks_override, q.marks) INTO v_qmax
        FROM exam_questions eq
        JOIN questions q ON q.id = eq.question_id
        WHERE eq.exam_id = v_attempt.exam_id
          AND eq.question_id = v_qid;

      IF v_qmax IS NULL THEN CONTINUE; END IF;
      v_marks := GREATEST(0, LEAST(v_marks, v_qmax));

      UPDATE exam_answers
         SET marks_awarded = v_marks,
             is_correct    = (v_marks >= v_qmax),
             updated_at    = now()
       WHERE attempt_id = p_attempt
         AND question_id = v_qid;
    END LOOP;
  END IF;

  -- Recompute totals identically to submit_exam_attempt.
  SELECT COALESCE(SUM(COALESCE(ea.marks_awarded, 0)), 0),
         COALESCE(SUM(COALESCE(eq_marks.m, q.marks)), 0)
    INTO v_total_score, v_total_marks
  FROM exam_questions eq
  JOIN questions q ON q.id = eq.question_id
  LEFT JOIN LATERAL (SELECT eq.marks_override AS m) eq_marks ON true
  LEFT JOIN exam_answers ea
         ON ea.attempt_id = p_attempt AND ea.question_id = q.id
  WHERE eq.exam_id = v_attempt.exam_id;

  v_percentage := CASE WHEN v_total_marks > 0
                       THEN ROUND((v_total_score / v_total_marks) * 100, 2)
                       ELSE 0 END;
  v_passed := CASE WHEN v_exam.pass_mark > 0
                   THEN v_total_score >= v_exam.pass_mark
                   ELSE NULL END;

  UPDATE exam_attempts
     SET total_score = v_total_score,
         total_marks = v_total_marks,
         percentage  = v_percentage,
         passed      = v_passed,
         status      = 'graded'
   WHERE id = p_attempt;

  RETURN jsonb_build_object(
    'ok', true,
    'total_score', v_total_score,
    'total_marks', v_total_marks,
    'percentage',  v_percentage,
    'passed',      v_passed
  );
END $$;

GRANT EXECUTE ON FUNCTION public.grade_attempt(uuid, jsonb) TO authenticated;


-- ------------------------------------------------------------
-- 8. Sanity report — run this after applying to confirm.
-- ------------------------------------------------------------
SELECT
  (SELECT count(*) FROM pg_proc WHERE proname = 'can_grade_org')       = 1 AS has_can_grade_org,
  (SELECT count(*) FROM pg_proc WHERE proname = 'attempt_is_open')     = 1 AS has_attempt_is_open,
  (SELECT count(*) FROM pg_proc WHERE proname = 'get_exam_submissions')= 1 AS has_get_exam_submissions,
  (SELECT count(*) FROM pg_proc WHERE proname = 'get_attempt_answers') = 1 AS has_get_attempt_answers,
  (SELECT count(*) FROM pg_proc WHERE proname = 'grade_attempt')       = 1 AS has_grade_attempt,
  (SELECT count(*) FROM pg_policies
     WHERE tablename = 'exam_answers' AND policyname = 'answers_self_all') = 1
     AS student_answer_policy_installed;
