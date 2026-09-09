-- ============================================================
-- CBT Violation Enforcement — server-side lockdown fix
-- ============================================================
-- Run after cbt_proctoring_infra.sql.
-- Idempotent — safe to re-run.
--
-- record_violation(p_attempt, p_kind, p_max_violations)
--   → acquires a row-level lock on the attempt row before counting
--   → counts violations from proctoring_events while holding the lock
--   → inserts the violation with the correct sequential strike_number
--   → on reaching limit: terminates attempt via submit_exam_attempt
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
  SELECT id INTO v_my_student FROM students WHERE profile_id = auth.uid() LIMIT 1;
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

  -- Cap max_violations: clamp client-supplied value between 1 and 10.
  v_max := GREATEST(1, LEAST(COALESCE(p_max_violations, 3), 10));

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
      'remaining', v_remaining
    );
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.record_violation(uuid, text, integer) TO authenticated;

-- ============================================================
-- Tighten log_proctoring_event: reject violation events for
-- non-in_progress attempts.
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
    v_attempt.student_id IN (SELECT id FROM students WHERE profile_id = auth.uid())
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_owner');
  END IF;
  IF p_violation = true AND v_attempt.status <> 'in_progress' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'attempt_not_in_progress');
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
