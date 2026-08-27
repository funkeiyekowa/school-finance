-- ============================================================
-- CBT UPGRADE MIGRATION
-- Adds server-side enforcement, per-student credentials, and
-- support for all question types.
--
-- Design invariants:
--   1. exam_attempts rows are only ever created through
--      start_exam_attempt() SECURITY DEFINER. The wide-open
--      "attempts_write" policy from cbt_migration.sql is
--      replaced with a strict per-student read + insert-nothing
--      write policy.
--   2. An exam is only visible to a student when
--        - exams.status = 'published'
--        - now() falls within exams.starts_at/ends_at (if set)
--        - the student is either directly assigned via
--          cbt_exam_assignments.student_id, or their current
--          class is assigned via cbt_exam_assignments.class_id
--        - the current time falls within
--          cbt_exam_assignments.available_from/available_to
--      All checks run inside the RPC so a malicious client
--      cannot bypass them.
--   3. reset_student_password() re-uses the same bcrypt +
--      auth.users pattern established in auto_provision_users.sql
--      and returns the one-time password ONCE for printing.
-- ============================================================

-- ------------------------------------------------------------
-- 1. HELPER: student's current class id
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.student_current_class_id(p_student uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT class_id
  FROM student_enrollments
  WHERE student_id = p_student
    AND status = 'active'
  ORDER BY enrolled_at DESC
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.student_current_class_id(uuid) TO authenticated;


-- ------------------------------------------------------------
-- 2. HELPER: is an exam actually takeable right now by a student
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_take_exam(p_exam uuid, p_student uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exam exams;
  v_class uuid;
  v_assign_ok boolean;
  v_now timestamptz := now();
  v_attempts_used integer;
BEGIN
  SELECT * INTO v_exam FROM exams WHERE id = p_exam;
  IF v_exam.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'exam_not_found');
  END IF;
  IF v_exam.status <> 'published' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_published');
  END IF;
  IF v_exam.starts_at IS NOT NULL AND v_now < v_exam.starts_at THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_yet_open',
                              'starts_at', v_exam.starts_at);
  END IF;
  IF v_exam.ends_at IS NOT NULL AND v_now > v_exam.ends_at THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'closed',
                              'ends_at', v_exam.ends_at);
  END IF;

  v_class := student_current_class_id(p_student);

  -- Direct assignment or class assignment, with per-assignment window
  SELECT EXISTS(
    SELECT 1 FROM cbt_exam_assignments a
    WHERE a.exam_id = p_exam
      AND (a.student_id = p_student OR (v_class IS NOT NULL AND a.class_id = v_class))
      AND (a.available_from IS NULL OR v_now >= a.available_from)
      AND (a.available_to   IS NULL OR v_now <= a.available_to)
  ) INTO v_assign_ok;

  -- Fallback: if nobody has been explicitly assigned and the exam is class-scoped
  -- via exams.class_id, treat that as the assignment (matches how the studio
  -- currently sets exams.class_id in the Create Exam form).
  IF NOT v_assign_ok THEN
    IF NOT EXISTS(SELECT 1 FROM cbt_exam_assignments WHERE exam_id = p_exam) THEN
      IF v_exam.class_id IS NULL OR v_exam.class_id = v_class THEN
        v_assign_ok := true;
      END IF;
    END IF;
  END IF;

  IF NOT v_assign_ok THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_assigned');
  END IF;

  SELECT count(*) INTO v_attempts_used
  FROM exam_attempts
  WHERE exam_id = p_exam
    AND student_id = p_student
    AND status IN ('submitted','graded','timed_out');

  IF v_attempts_used >= v_exam.max_attempts THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'max_attempts_reached',
                              'used', v_attempts_used, 'max', v_exam.max_attempts);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'attempts_used', v_attempts_used,
    'attempts_remaining', v_exam.max_attempts - v_attempts_used
  );
END $$;

GRANT EXECUTE ON FUNCTION public.can_take_exam(uuid, uuid) TO authenticated;


-- ------------------------------------------------------------
-- 3. RPC: start_exam_attempt — the only sanctioned way to create
--    or resume an in-progress exam_attempts row
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_exam_attempt(p_exam uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student uuid;
  v_org uuid;
  v_check jsonb;
  v_existing exam_attempts;
  v_next_num integer;
  v_new_id uuid;
BEGIN
  -- Resolve the caller's linked student row.
  SELECT id, organization_id INTO v_student, v_org
  FROM students
  WHERE profile_id = auth.uid()
    AND status = 'active'
  LIMIT 1;

  IF v_student IS NULL THEN
    RAISE EXCEPTION 'No student profile linked to this user';
  END IF;

  v_check := can_take_exam(p_exam, v_student);
  IF (v_check->>'ok')::boolean IS DISTINCT FROM true THEN
    RETURN v_check;
  END IF;

  -- Resume an existing in-progress attempt if one is already open.
  SELECT * INTO v_existing FROM exam_attempts
  WHERE exam_id = p_exam AND student_id = v_student AND status = 'in_progress'
  ORDER BY started_at DESC LIMIT 1;

  IF v_existing.id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'resumed', true,
                              'attempt_id', v_existing.id,
                              'started_at', v_existing.started_at);
  END IF;

  SELECT COALESCE(MAX(attempt_number), 0) + 1 INTO v_next_num
  FROM exam_attempts WHERE exam_id = p_exam AND student_id = v_student;

  INSERT INTO exam_attempts(exam_id, student_id, attempt_number, status,
                            organization_id, started_at)
  VALUES (p_exam, v_student, v_next_num, 'in_progress', v_org, now())
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object('ok', true, 'resumed', false,
                            'attempt_id', v_new_id, 'attempt_number', v_next_num);
END $$;

GRANT EXECUTE ON FUNCTION public.start_exam_attempt(uuid) TO authenticated;


-- ------------------------------------------------------------
-- 4. Server-side grader for a single answer.
--    Handles multiple_choice, true_false, multi_answer,
--    short_answer, fill_blank, numeric, matching, essay.
--    Idempotent — safe to call from a client autosave loop.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.grade_answer(
  p_question jsonb,
  p_selected text,
  p_answer_text text
)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v_type text := p_question->>'question_type';
  v_marks numeric := COALESCE((p_question->>'marks')::numeric, 0);
  v_case_sensitive boolean := COALESCE((p_question->>'case_sensitive')::boolean, false);
  v_answer_text text := p_question->>'answer_text';
  v_options jsonb := COALESCE(p_question->'options', '[]'::jsonb);
  v_is_correct boolean := false;
  v_awarded numeric := 0;
  v_expected text;
  v_selected_set text[];
  v_correct_set text[];
BEGIN
  IF v_type IS NULL OR v_marks = 0 THEN
    RETURN jsonb_build_object('is_correct', NULL, 'marks_awarded', 0);
  END IF;

  IF v_type IN ('multiple_choice','true_false') THEN
    SELECT (o->>'id') INTO v_expected
      FROM jsonb_array_elements(v_options) o
      WHERE (o->>'is_correct')::boolean = true
      LIMIT 1;
    v_is_correct := (p_selected IS NOT NULL AND v_expected IS NOT NULL AND p_selected = v_expected);
    v_awarded := CASE WHEN v_is_correct THEN v_marks ELSE 0 END;

  ELSIF v_type = 'multi_answer' THEN
    -- p_selected is a pipe- or comma-separated set of option ids
    SELECT ARRAY(
      SELECT trim(v) FROM unnest(string_to_array(REPLACE(COALESCE(p_selected,''),'|',','), ',')) v
      WHERE trim(v) <> ''
    ) INTO v_selected_set;
    SELECT ARRAY(
      SELECT o->>'id' FROM jsonb_array_elements(v_options) o
      WHERE (o->>'is_correct')::boolean = true
    ) INTO v_correct_set;
    v_is_correct := (
      v_selected_set IS NOT NULL AND v_correct_set IS NOT NULL AND
      cardinality(v_selected_set) = cardinality(v_correct_set) AND
      NOT EXISTS (SELECT unnest(v_selected_set) EXCEPT SELECT unnest(v_correct_set)) AND
      NOT EXISTS (SELECT unnest(v_correct_set) EXCEPT SELECT unnest(v_selected_set))
    );
    v_awarded := CASE WHEN v_is_correct THEN v_marks ELSE 0 END;

  ELSIF v_type IN ('short_answer','fill_blank') THEN
    IF v_answer_text IS NOT NULL AND p_answer_text IS NOT NULL THEN
      IF v_case_sensitive THEN
        v_is_correct := trim(p_answer_text) = trim(v_answer_text);
      ELSE
        v_is_correct := lower(trim(p_answer_text)) = lower(trim(v_answer_text));
      END IF;
    END IF;
    v_awarded := CASE WHEN v_is_correct THEN v_marks ELSE 0 END;

  ELSIF v_type = 'numeric' THEN
    IF v_answer_text IS NOT NULL AND p_answer_text IS NOT NULL THEN
      BEGIN
        v_is_correct := (p_answer_text::numeric = v_answer_text::numeric);
      EXCEPTION WHEN OTHERS THEN
        v_is_correct := false;
      END;
    END IF;
    v_awarded := CASE WHEN v_is_correct THEN v_marks ELSE 0 END;

  ELSIF v_type = 'matching' THEN
    -- options: {"pairs":[{"left":"...","right":"..."}, ...]}
    -- selected: JSON string "[{\"left\":\"L1\",\"right\":\"R2\"}, ...]"
    DECLARE
      v_expected_pairs jsonb := COALESCE(v_options->'pairs', '[]'::jsonb);
      v_supplied_pairs jsonb;
      v_correct_count integer := 0;
      v_total_pairs integer := jsonb_array_length(v_expected_pairs);
    BEGIN
      IF v_total_pairs = 0 THEN
        RETURN jsonb_build_object('is_correct', NULL, 'marks_awarded', 0);
      END IF;
      BEGIN
        v_supplied_pairs := COALESCE(p_selected::jsonb, '[]'::jsonb);
      EXCEPTION WHEN OTHERS THEN
        v_supplied_pairs := '[]'::jsonb;
      END;
      SELECT count(*) INTO v_correct_count
      FROM jsonb_array_elements(v_expected_pairs) exp
      WHERE EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_supplied_pairs) sup
        WHERE sup->>'left' = exp->>'left' AND sup->>'right' = exp->>'right'
      );
      v_awarded := v_marks * v_correct_count::numeric / v_total_pairs::numeric;
      v_is_correct := (v_correct_count = v_total_pairs);
    END;

  ELSIF v_type = 'essay' THEN
    -- Manual grading — leave null so the teacher marks it later.
    RETURN jsonb_build_object('is_correct', NULL, 'marks_awarded', 0);
  END IF;

  RETURN jsonb_build_object('is_correct', v_is_correct, 'marks_awarded', v_awarded);
END $$;

GRANT EXECUTE ON FUNCTION public.grade_answer(jsonb, text, text) TO authenticated;


-- ------------------------------------------------------------
-- 5. RPC: submit_exam_attempt — grades every answer and closes
--    the attempt. Callable only by the owning student.
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
     SET status = CASE WHEN p_timed_out THEN 'timed_out' ELSE 'submitted' END,
         submitted_at = now(),
         total_score = v_total_score,
         total_marks = v_total_marks,
         percentage  = v_percentage,
         passed      = v_passed,
         time_spent_seconds = v_elapsed
   WHERE id = p_attempt;

  RETURN jsonb_build_object(
    'ok', true, 'already_submitted', false,
    'total_score', v_total_score,
    'total_marks', v_total_marks,
    'percentage',  v_percentage,
    'passed',      v_passed
  );
END $$;

GRANT EXECUTE ON FUNCTION public.submit_exam_attempt(uuid, boolean) TO authenticated;


-- ------------------------------------------------------------
-- 6. Tighten CBT RLS.
--    exam_attempts and exam_answers previously had USING (true)
--    from cbt_migration.sql. Replace them with per-org SELECT +
--    self-only student writes. tenant_isolation_full.sql already
--    put a strict per-org policy on these; we now add a targeted
--    exception so a student can UPDATE their own in-progress
--    answers via the auto-save upsert flow.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS attempts_read       ON exam_attempts;
DROP POLICY IF EXISTS attempts_write      ON exam_attempts;
DROP POLICY IF EXISTS answers_read        ON exam_answers;
DROP POLICY IF EXISTS answers_write       ON exam_answers;

-- Students can SELECT their own attempts (in addition to the org-scoped
-- policy from tenant_isolation_full which admins/teachers already have).
DO $$ BEGIN
  CREATE POLICY student_own_attempts_select ON exam_attempts
    FOR SELECT USING (
      student_id IN (SELECT id FROM students WHERE profile_id = auth.uid())
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Students may INSERT/UPDATE only their own answers, only while the
-- attempt is still in_progress. This is the write channel used by the
-- auto-save loop on the take page. Grading fields (is_correct,
-- marks_awarded) are still writable from the client during autosave
-- because Postgres row-level security operates at the row level, not
-- column level; the definitive grading happens in submit_exam_attempt
-- which overwrites those values.
DO $$ BEGIN
  CREATE POLICY student_own_answers_all ON exam_answers
    FOR ALL USING (
      attempt_id IN (
        SELECT id FROM exam_attempts
        WHERE student_id IN (SELECT id FROM students WHERE profile_id = auth.uid())
          AND status = 'in_progress'
      )
    ) WITH CHECK (
      attempt_id IN (
        SELECT id FROM exam_attempts
        WHERE student_id IN (SELECT id FROM students WHERE profile_id = auth.uid())
          AND status = 'in_progress'
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ------------------------------------------------------------
-- 7. RPC: reset_student_password
--    Admin-only. Generates a random 10-char password, updates
--    auth.users.encrypted_password, flips
--    students.must_change_password so the portal forces a change
--    on next login, and returns the temporary password ONCE.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reset_student_password(p_student uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_org uuid;
  v_profile uuid;
  v_email text;
  v_student_code text;
  v_temp_pw text;
BEGIN
  IF NOT is_org_admin(current_user_org_id()) THEN
    RAISE EXCEPTION 'Only a school administrator can reset student passwords';
  END IF;

  SELECT organization_id, profile_id, student_code
    INTO v_org, v_profile, v_student_code
  FROM students WHERE id = p_student;

  IF v_org IS NULL OR v_org <> current_user_org_id() THEN
    RAISE EXCEPTION 'Student not found in your organization';
  END IF;

  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'Student has no login profile yet — enable login first';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_profile;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Auth account not found for this student';
  END IF;

  -- 10 chars, alphanumeric, avoids ambiguous 0/O/1/l
  v_temp_pw := substr(
    translate(encode(gen_random_bytes(12), 'base64'), '+/=Ol01', 'abcdefg'),
    1, 10);

  UPDATE auth.users
     SET encrypted_password = extensions.crypt(v_temp_pw, extensions.gen_salt('bf')),
         updated_at = now()
   WHERE id = v_profile;

  UPDATE students
     SET must_change_password = true,
         updated_at = now()
   WHERE id = p_student;

  RETURN jsonb_build_object(
    'ok', true,
    'login_email', v_email,
    'student_code', v_student_code,
    'temporary_password', v_temp_pw
  );
END $$;

REVOKE EXECUTE ON FUNCTION public.reset_student_password(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reset_student_password(uuid) TO authenticated;


-- ------------------------------------------------------------
-- 8. Sanity report — run this after applying to confirm.
-- ------------------------------------------------------------
SELECT
  (SELECT count(*) FROM pg_proc WHERE proname = 'start_exam_attempt') = 1
    AS has_start_exam_attempt,
  (SELECT count(*) FROM pg_proc WHERE proname = 'submit_exam_attempt') = 1
    AS has_submit_exam_attempt,
  (SELECT count(*) FROM pg_proc WHERE proname = 'reset_student_password') = 1
    AS has_reset_student_password,
  (SELECT count(*) FROM pg_proc WHERE proname = 'grade_answer') = 1
    AS has_grade_answer,
  (SELECT count(*) FROM pg_policies
     WHERE tablename = 'exam_answers' AND policyname = 'student_own_answers_all') = 1
    AS student_answer_policy_installed;
