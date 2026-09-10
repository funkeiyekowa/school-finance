-- ============================================================
-- CBT Violation Enforcement — server-side lockdown fix
-- ============================================================
-- Run after cbt_ai_integration.sql (which provides the three-argument
-- submit_exam_attempt RPC used for server-side termination).
-- Idempotent — safe to re-run.
--
-- record_violation(p_attempt, p_kind, p_max_violations)
--   → acquires a row-level lock on the attempt row before counting
--   → counts violations from proctoring_events while holding the lock
--   → inserts the violation with the correct sequential strike_number
--   → on reaching limit: terminates attempt via submit_exam_attempt
--   → reads max_violations from the exam's server-side settings; the legacy
--     p_max_violations argument is deliberately ignored and cannot weaken
--     enforcement
--   → returns directive: action='warn'|'terminate', strike, remaining
--
-- Concurrency guarantee: SELECT ... FOR UPDATE on the exam_attempts row
-- serializes all concurrent record_violation calls for the same attempt.
-- Two simultaneous tab-switch events block on the lock; the second sees
-- the updated proctoring_events count from the first and gets an accurate
-- strike number. submit_exam_attempt is idempotent on finished attempts.

CREATE OR REPLACE FUNCTION public.record_violation(
  p_attempt       uuid,
  p_kind          text,
  p_max_violations integer DEFAULT 3
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_attempt       exam_attempts;
  v_my_student    uuid;
  v_configured_max integer;
  v_max           integer;
  v_strike        integer;
  v_remaining     integer;
  v_submit_result jsonb;
BEGIN
  -- Acquire a row-level lock on the attempt. This serializes all concurrent
  -- record_violation calls for the same attempt — each call must wait for the
  -- previous one to commit before it reads the violation count and inserts.
  -- NOWAIT is intentionally NOT used: we want concurrent calls to queue, not fail.
  SELECT * INTO v_attempt
  FROM exam_attempts
  WHERE id = p_attempt
  FOR UPDATE;

  IF v_attempt.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'attempt_not_found');
  END IF;

  -- Ownership check: caller must own this attempt.
  SELECT id INTO v_my_student
  FROM students
  WHERE profile_id = auth.uid()
    AND organization_id = v_attempt.organization_id
  LIMIT 1;
  IF v_my_student IS NULL OR v_my_student <> v_attempt.student_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_owner');
  END IF;

  -- If attempt is already finished (terminated by a concurrent call that
  -- committed just before we acquired the lock), return terminate immediately.
  -- No double-counting, no double-termination.
  IF v_attempt.status <> 'in_progress' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'action', 'terminate',
      'already_terminated', true,
      'strike', 0,
      'remaining', 0
    );
  END IF;

  -- The limit is server-authoritative. Never trust p_max_violations: it is
  -- retained only for backwards-compatible RPC calls from deployed clients.
  -- Treat missing or malformed configuration as the safe default of 3.
  SELECT CASE
           WHEN e.settings->>'max_violations' ~ '^[0-9]+$'
             THEN (e.settings->>'max_violations')::integer
           ELSE 3
         END
    INTO v_configured_max
    FROM exams e
   WHERE e.id = v_attempt.exam_id
     AND e.organization_id = v_attempt.organization_id;

  v_max := GREATEST(1, LEAST(COALESCE(v_configured_max, 3), 10));

  -- Count existing violations while holding the lock. Because we hold FOR UPDATE
  -- on the attempt row, any concurrent call that also needs to insert a violation
  -- for this attempt is blocked until this transaction commits. The count here
  -- is therefore the definitive, consistent count before this violation.
  SELECT COUNT(*) INTO v_strike
  FROM proctoring_events
  WHERE attempt_id = p_attempt AND violation = true;

  -- This violation is strike (v_strike + 1).
  v_strike := v_strike + 1;

  -- Insert the violation with its definitive sequential strike_number.
  INSERT INTO proctoring_events (
    attempt_id, organization_id, event_type, event_data, violation, strike_number
  ) VALUES (
    p_attempt,
    v_attempt.organization_id,
    p_kind,
    jsonb_build_object('kind', p_kind),
    true,
    v_strike
  );

  v_remaining := GREATEST(0, v_max - v_strike);

  IF v_strike >= v_max THEN
    -- Terminate the attempt server-side while still holding the FOR UPDATE lock.
    -- submit_exam_attempt checks status = 'in_progress' itself and is idempotent,
    -- but since we hold the lock and confirmed in_progress above, this is the
    -- exactly-one termination path for this attempt.
    SELECT public.submit_exam_attempt(
      p_attempt,
      true,
      'tab_switch_limit'
    ) INTO v_submit_result;

    RETURN jsonb_build_object(
      'ok',          true,
      'action',      'terminate',
      'strike',      v_strike,
      'max_violations', v_max,
      'remaining',   0,
      'score',       v_submit_result->'total_score',
      'total_marks', v_submit_result->'total_marks',
      'percentage',  v_submit_result->'percentage',
      'passed',      v_submit_result->'passed'
    );
  ELSE
    RETURN jsonb_build_object(
      'ok',        true,
      'action',    'warn',
      'strike',    v_strike,
      'max_violations', v_max,
      'remaining', v_remaining
    );
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.record_violation(uuid, text, integer) TO authenticated;

-- ============================================================
-- Student-safe proctoring state for an attempt they own. The underlying
-- proctoring_events table stays staff-only for reads, while the student can
-- still see the authoritative strike total after a warning logout/re-login.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_attempt_proctoring_state(p_attempt uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt exam_attempts;
  v_my_student uuid;
  v_count integer;
BEGIN
  SELECT * INTO v_attempt
  FROM exam_attempts
  WHERE id = p_attempt;

  IF v_attempt.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'attempt_not_found');
  END IF;

  SELECT id INTO v_my_student
  FROM students
  WHERE profile_id = auth.uid()
    AND organization_id = v_attempt.organization_id
  LIMIT 1;
  IF v_my_student IS NULL OR v_my_student <> v_attempt.student_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_owner');
  END IF;

  SELECT COUNT(*)::integer INTO v_count
  FROM proctoring_events
  WHERE attempt_id = p_attempt
    AND violation = true;

  RETURN jsonb_build_object(
    'ok', true,
    'violation_count', v_count,
    'status', v_attempt.status,
    'termination_reason', v_attempt.termination_reason
  );
END $$;

GRANT EXECUTE ON FUNCTION public.get_attempt_proctoring_state(uuid) TO authenticated;

-- ============================================================
-- Disqualification is terminal for this exam, even when the exam's normal
-- max_attempts setting would otherwise permit another attempt. This function
-- also locks an existing in-progress attempt before returning it, so a login
-- concurrent with the final record_violation call cannot resume the attempt
-- after it is closed.
-- ============================================================
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
  v_completed exam_attempts;
  v_exam exams;
  v_violation_count integer;
  v_next_num integer;
  v_new_id uuid;
BEGIN
  SELECT id, organization_id INTO v_student, v_org
  FROM students
  WHERE profile_id = auth.uid()
    AND status = 'active'
  LIMIT 1;

  IF v_student IS NULL THEN
    RAISE EXCEPTION 'No student profile linked to this user';
  END IF;

  -- A proctored exam cannot safely start without the event table that holds
  -- the server-authoritative violation history. Return a clear setup status
  -- instead of leaking a PostgreSQL "relation does not exist" error.
  IF to_regclass('public.proctoring_events') IS NULL
     AND EXISTS (
       SELECT 1
       FROM exams
       WHERE id = p_exam
         AND organization_id = v_org
         AND settings->>'proctored' = 'true'
     ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'proctoring_not_configured');
  END IF;

  -- A tab-switch disqualification consumes the exam regardless of the
  -- ordinary retry setting. Check before the generic availability response so
  -- the student receives the correct terminal state.
  IF EXISTS (
    SELECT 1
    FROM exam_attempts
    WHERE exam_id = p_exam
      AND student_id = v_student
      AND organization_id = v_org
      AND termination_reason = 'tab_switch_limit'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'disqualified');
  END IF;

  v_check := can_take_exam(p_exam, v_student);
  IF (v_check->>'ok')::boolean IS DISTINCT FROM true THEN
    -- A completed exam deserves a completion summary, not a generic retry
    -- error. This is still server-authoritative: only the owner's latest
    -- finished attempt is returned, and score fields are later rendered only
    -- when the exam owner enabled show_results.
    IF v_check->>'reason' = 'max_attempts_reached' THEN
      SELECT * INTO v_completed
      FROM exam_attempts
      WHERE exam_id = p_exam
        AND student_id = v_student
        AND organization_id = v_org
        AND status IN ('submitted', 'graded', 'timed_out')
      ORDER BY submitted_at DESC NULLS LAST, started_at DESC
      LIMIT 1;
      SELECT * INTO v_exam FROM exams WHERE id = p_exam AND organization_id = v_org;
      IF v_completed.id IS NOT NULL THEN
        RETURN jsonb_build_object(
          'ok', true,
          'completed', true,
          'attempt_id', v_completed.id,
          'status', v_completed.status,
          'show_results', COALESCE(v_exam.show_results, false),
          'completion_message', COALESCE(NULLIF(v_exam.settings->>'completion_message', ''), 'This exam has been completed. Your submission has been recorded.'),
          'total_score', v_completed.total_score,
          'total_marks', v_completed.total_marks,
          'percentage', v_completed.percentage,
          'passed', v_completed.passed
        );
      END IF;
    END IF;
    RETURN v_check;
  END IF;

  -- Share the attempt-row lock used by record_violation. If final
  -- termination is in progress, this waits and then re-evaluates the row.
  SELECT * INTO v_existing
  FROM exam_attempts
  WHERE exam_id = p_exam
    AND student_id = v_student
    AND organization_id = v_org
    AND status = 'in_progress'
  ORDER BY started_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_existing.id IS NOT NULL THEN
    SELECT COUNT(*)::integer INTO v_violation_count
    FROM proctoring_events
    WHERE attempt_id = v_existing.id
      AND violation = true;
    RETURN jsonb_build_object('ok', true, 'resumed', true,
                              'attempt_id', v_existing.id,
                              'started_at', v_existing.started_at,
                              'violation_count', v_violation_count);
  END IF;

  -- Re-check after the shared row lock. This closes the race where the final
  -- violation commits while this call is waiting to resume the attempt.
  IF EXISTS (
    SELECT 1
    FROM exam_attempts
    WHERE exam_id = p_exam
      AND student_id = v_student
      AND organization_id = v_org
      AND termination_reason = 'tab_switch_limit'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'disqualified');
  END IF;

  SELECT COALESCE(MAX(attempt_number), 0) + 1 INTO v_next_num
  FROM exam_attempts
  WHERE exam_id = p_exam
    AND student_id = v_student
    AND organization_id = v_org;

  INSERT INTO exam_attempts(exam_id, student_id, attempt_number, status,
                            organization_id, started_at)
  VALUES (p_exam, v_student, v_next_num, 'in_progress', v_org, now())
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object('ok', true, 'resumed', false,
                            'attempt_id', v_new_id, 'attempt_number', v_next_num,
                            'violation_count', 0);
END $$;

GRANT EXECUTE ON FUNCTION public.start_exam_attempt(uuid) TO authenticated;

-- ============================================================
-- Tighten log_proctoring_event: it is for non-violation audit events only.
-- All violation strikes must go through record_violation so the attempt lock,
-- server-side threshold, and sequential numbering cannot be bypassed.
-- ============================================================
CREATE OR REPLACE FUNCTION public.log_proctoring_event(
  p_attempt uuid,
  p_event_type text,
  p_event_data jsonb DEFAULT '{}',
  p_violation boolean DEFAULT false,
  p_strike_number integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_attempt exam_attempts;
BEGIN
  SELECT * INTO v_attempt FROM exam_attempts WHERE id = p_attempt;
  IF v_attempt.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'attempt_not_found');
  END IF;
  IF NOT (
    v_attempt.student_id IN (
      SELECT id
      FROM students
      WHERE profile_id = auth.uid()
        AND organization_id = v_attempt.organization_id
    )
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_owner');
  END IF;
  IF COALESCE(p_violation, false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'use_record_violation');
  END IF;

  INSERT INTO proctoring_events (attempt_id, organization_id, event_type, event_data, violation, strike_number)
  VALUES (p_attempt, v_attempt.organization_id, p_event_type, COALESCE(p_event_data, '{}'), COALESCE(p_violation, false), p_strike_number);

  RETURN jsonb_build_object('ok', true);
END $$;

GRANT EXECUTE ON FUNCTION public.log_proctoring_event(uuid, text, jsonb, boolean, integer) TO authenticated;

-- ============================================================
-- Verification
-- ============================================================
SELECT proname, pg_get_function_identity_arguments(oid) AS args
FROM pg_proc
WHERE proname IN ('record_violation', 'log_proctoring_event')
ORDER BY proname;
