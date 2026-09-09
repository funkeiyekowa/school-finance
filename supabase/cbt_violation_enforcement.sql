-- ============================================================
-- CBT Violation Enforcement — server-side lockdown fix
-- ============================================================
-- Run after cbt_proctoring_infra.sql.
-- Idempotent — safe to re-run.
--
-- Adds:
--   record_violation(p_attempt, p_kind, p_max_violations)
--     → counts violations server-side from proctoring_events
--     → on reaching limit: terminates attempt via submit_exam_attempt
--     → returns directive: action='warn'|'terminate', strike, remaining
--
-- The client is no longer authoritative for the violation count.
-- The violation count is always derived from the server (proctoring_events).
-- max_violations is passed by the client but comes from exam.settings which
-- was loaded server-side via start_exam_attempt; the RPC also caps it at a
-- safe maximum (10) to prevent the client inflating it.

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
  -- Load attempt
  SELECT * INTO v_attempt FROM exam_attempts WHERE id = p_attempt;
  IF v_attempt.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'attempt_not_found');
  END IF;

  -- Ownership check
  SELECT id INTO v_my_student FROM students WHERE profile_id = auth.uid() LIMIT 1;
  IF v_my_student IS NULL OR v_my_student <> v_attempt.student_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_owner');
  END IF;

  -- If attempt is already finished, reject silently — no double-termination.
  IF v_attempt.status <> 'in_progress' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'action', 'terminate',
      'already_terminated', true,
      'strike', 0,
      'remaining', 0
    );
  END IF;

  -- Cap max_violations: clamp between 1 and 10.
  -- Client supplies this from exam.settings (loaded server-side), but we
  -- never trust the client to inflate it beyond a safe ceiling.
  v_max := GREATEST(1, LEAST(COALESCE(p_max_violations, 3), 10));

  -- Insert the violation event row FIRST, then count. This makes the count
  -- include this current violation and is atomic within the transaction.
  INSERT INTO proctoring_events (
    attempt_id, organization_id, event_type, event_data, violation, strike_number
  ) VALUES (
    p_attempt,
    v_attempt.organization_id,
    p_kind,
    jsonb_build_object('kind', p_kind),
    true,
    NULL   -- strike_number updated below after counting
  );

  -- Count all violation rows for this attempt (including the one just inserted).
  SELECT COUNT(*) INTO v_strike
  FROM proctoring_events
  WHERE attempt_id = p_attempt AND violation = true;

  -- Back-fill the strike_number on the row we just inserted.
  UPDATE proctoring_events
     SET strike_number = v_strike
   WHERE attempt_id = p_attempt
     AND violation = true
     AND strike_number IS NULL
     AND created_at = (
       SELECT MAX(created_at)
       FROM proctoring_events
       WHERE attempt_id = p_attempt AND violation = true AND strike_number IS NULL
     );

  v_remaining := GREATEST(0, v_max - v_strike);

  IF v_strike >= v_max THEN
    -- Terminate the attempt server-side. submit_exam_attempt is idempotent
    -- for already-finished attempts, so concurrent calls are safe.
    SELECT public.submit_exam_attempt(
      p_attempt,
      true,           -- p_timed_out = true (auto-submit)
      'tab_switch_limit'
    ) INTO v_submit_result;

    RETURN jsonb_build_object(
      'ok',        true,
      'action',    'terminate',
      'strike',    v_strike,
      'remaining', 0,
      'score',     v_submit_result->'total_score',
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
-- Also tighten log_proctoring_event: reject if attempt is not in_progress.
-- Previously it accepted events for any attempt status, allowing a student
-- to keep logging events even after termination.
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
  -- Only allow logging for in-progress attempts. Non-violation events (consent,
  -- camera status) are harmless to log after termination, but violation events
  -- must not be accepted for finished attempts.
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
