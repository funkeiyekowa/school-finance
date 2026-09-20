-- =====================================================================
-- AUTOMATION ENGINE -- the missing execution/scheduling path
-- =====================================================================
-- Run order: after automations_migration.sql (automation_rules,
-- automation_logs), tenant_isolation_full.sql / the later staff-scoped
-- policies on those two tables (already the org+staff scoped ones in
-- production -- verified, not touched here), student_finance_module.sql
-- (fee_schedules, income_entries), promotion_system_migration.sql
-- (promotion_events, student_enrollments), and
-- 20260907120000_attendance_batch_rpc.sql (attendance_records,
-- attendance_statuses).
--
-- Adds two functions and changes nothing else -- no table, no policy.
-- Idempotent (CREATE OR REPLACE). Order-independent with respect to
-- rls_role_scoped_access.sql. Manual apply.
--
-- ---------------------------------------------------------------------
-- WHY
-- ---------------------------------------------------------------------
-- automation_rules / automation_logs and the whole rule-builder UI at
-- /dashboard/automations were complete -- an admin can define a trigger,
-- conditions and actions -- but nothing ever executed a rule. No DB
-- trigger, no cron, no queue existed anywhere in the app (confirmed by
-- the earlier audit: no vercel.json crons, no pg_cron usage, no scheduled
-- GitHub Action). The UI's own banner said so plainly: "rule engine
-- backend not yet deployed."
--
-- ---------------------------------------------------------------------
-- WHAT THIS IS, AND WHY THIS SHAPE
-- ---------------------------------------------------------------------
-- Reuses the schema exactly as already designed, adds nothing new:
--   * automation_rules.last_executed_at is the idempotency boundary for
--     the seven event-based triggers below -- each run only considers
--     rows created strictly after the rule's own last run, so nothing is
--     processed twice and no separate "already handled" tracking table
--     is needed.
--   * automation_logs.trigger_data (already jsonb) doubles as the
--     anti-spam guard for the two balance-based triggers (fee_overdue,
--     balance_threshold), which are evaluated per-student rather than
--     per-event and would otherwise fire every single day forever for
--     the same unpaid balance.
--   * fee_schedules has no due-date column at all -- there is no
--     "overdue by N days" concept anywhere in this schema. fee_overdue
--     is therefore "this student's computed balance is greater than
--     zero", using the EXACT SAME derived-balance formula
--     src/app/dashboard/student-finance/page.tsx already computes
--     client-side (fee_schedules matched by grade, minus the sum of
--     income_entries for that student) -- not a new finance concept.
--   * student_absent checks attendance_statuses.counts_as_present, the
--     org's own configurable definition of "absent", not a hardcoded
--     status string.
--
-- Condition evaluation (the rule's own `conditions` jsonb array, each
-- `{field, operator, value}`, ALL must match) is generic: every trigger
-- branch below builds a small `context` jsonb object with that trigger's
-- relevant fields, and automation_conditions_match() evaluates the rule's
-- conditions against it the same way regardless of trigger type.
--
-- Actually SENDING an action (send_sms / send_email) needs an outbound
-- HTTP or SMTP call, which Postgres cannot make -- that is Node's job
-- (src/lib/notifications/send.ts, from the Notifications feature). So
-- this migration only detects and matches; execution and logging are
-- driven from /api/cron/automations, which calls
-- get_due_automation_triggers() to get the matched (rule, context) pairs,
-- performs each action, and calls record_automation_execution() to write
-- the result back.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. automation_conditions_match -- generic condition evaluator.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.automation_conditions_match(
  p_context jsonb, p_conditions jsonb
)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v_cond jsonb;
  v_field text;
  v_op text;
  v_expected jsonb;
  v_actual jsonb;
BEGIN
  IF p_conditions IS NULL OR jsonb_typeof(p_conditions) <> 'array' OR jsonb_array_length(p_conditions) = 0 THEN
    RETURN true; -- no conditions = always matches
  END IF;

  FOR v_cond IN SELECT * FROM jsonb_array_elements(p_conditions)
  LOOP
    v_field := v_cond->>'field';
    v_op := COALESCE(v_cond->>'operator', 'eq');
    v_expected := v_cond->'value';
    v_actual := p_context->v_field;

    IF v_actual IS NULL THEN
      RETURN false; -- referenced field isn't in this trigger's context
    END IF;

    CASE v_op
      WHEN 'eq' THEN IF NOT (v_actual = v_expected) THEN RETURN false; END IF;
      WHEN 'neq' THEN IF (v_actual = v_expected) THEN RETURN false; END IF;
      WHEN 'contains' THEN IF NOT (v_actual->>0 IS NOT NULL OR (v_actual #>> '{}') ILIKE '%' || (v_expected #>> '{}') || '%') THEN RETURN false; END IF;
      WHEN 'gt' THEN IF NOT ((v_actual #>> '{}')::numeric > (v_expected #>> '{}')::numeric) THEN RETURN false; END IF;
      WHEN 'gte' THEN IF NOT ((v_actual #>> '{}')::numeric >= (v_expected #>> '{}')::numeric) THEN RETURN false; END IF;
      WHEN 'lt' THEN IF NOT ((v_actual #>> '{}')::numeric < (v_expected #>> '{}')::numeric) THEN RETURN false; END IF;
      WHEN 'lte' THEN IF NOT ((v_actual #>> '{}')::numeric <= (v_expected #>> '{}')::numeric) THEN RETURN false; END IF;
      ELSE RETURN false; -- unknown operator: fail closed, never fire on a rule we can't evaluate
    END CASE;
  END LOOP;

  RETURN true;
EXCEPTION WHEN OTHERS THEN
  -- A malformed condition (e.g. non-numeric value compared with gt) must
  -- never crash the whole run or silently fire an unevaluated rule.
  RETURN false;
END $$;

REVOKE ALL ON FUNCTION public.automation_conditions_match(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.automation_conditions_match(jsonb, jsonb) TO service_role;


-- ---------------------------------------------------------------------
-- 2. get_due_automation_triggers -- detect + match, return what's due.
--    service_role only: called exclusively from /api/cron/automations
--    using the service client, never from a user session.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_due_automation_triggers()
RETURNS TABLE (
  rule_id uuid, organization_id uuid, rule_name text,
  trigger_event text, actions jsonb, context jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule RECORD;
  v_row RECORD;
  v_since timestamptz;
  v_ctx jsonb;
BEGIN
  -- NOTE: this function's own OUT parameters (organization_id,
  -- trigger_event, actions, rule_id, context) share names with columns on
  -- automation_rules and every trigger-source table below. Every query in
  -- this body therefore aliases its table and qualifies EVERY column
  -- reference (ar.organization_id, ie.amount, ...) -- an unqualified bare
  -- column name is ambiguous against the OUT parameter of the same name
  -- and Postgres will refuse to plan the query.
  FOR v_rule IN
    SELECT ar.* FROM automation_rules ar
     WHERE ar.enabled = true AND ar.organization_id IS NOT NULL
     ORDER BY ar.priority DESC, ar.created_at ASC
  LOOP
    -- Bounded lookback: never re-walk more than 2 days of history even for
    -- a rule that has never run or was disabled a long time, so re-enabling
    -- an old rule cannot suddenly fire hundreds of stale notifications.
    v_since := GREATEST(COALESCE(v_rule.last_executed_at, now() - interval '2 days'), now() - interval '2 days');

    IF v_rule.trigger_event = 'scheduled_daily' THEN
      IF v_rule.last_executed_at IS NULL OR v_rule.last_executed_at < date_trunc('day', now()) THEN
        rule_id := v_rule.id; organization_id := v_rule.organization_id; rule_name := v_rule.name;
        trigger_event := v_rule.trigger_event; actions := v_rule.actions; context := '{}'::jsonb;
        RETURN NEXT;
      END IF;

    ELSIF v_rule.trigger_event = 'payment_received' THEN
      FOR v_row IN
        SELECT ie.* FROM income_entries ie
         WHERE ie.organization_id = v_rule.organization_id AND ie.created_at > v_since
      LOOP
        v_ctx := jsonb_build_object(
          'amount', v_row.amount, 'category', v_row.category, 'student_id', v_row.student_id,
          'payment_method', v_row.payment_method
        );
        IF automation_conditions_match(v_ctx, v_rule.conditions) THEN
          rule_id := v_rule.id; organization_id := v_rule.organization_id; rule_name := v_rule.name;
          trigger_event := v_rule.trigger_event; actions := v_rule.actions; context := v_ctx;
          RETURN NEXT;
        END IF;
      END LOOP;

    ELSIF v_rule.trigger_event = 'student_absent' THEN
      FOR v_row IN
        SELECT ar2.* FROM attendance_records ar2
        JOIN attendance_statuses ast
          ON ast.organization_id = ar2.organization_id AND ast.code = ar2.status_code
         WHERE ar2.organization_id = v_rule.organization_id AND ar2.created_at > v_since
           AND ast.counts_as_present = false
      LOOP
        v_ctx := jsonb_build_object('student_id', v_row.student_id, 'date', v_row.date, 'status_code', v_row.status_code);
        IF automation_conditions_match(v_ctx, v_rule.conditions) THEN
          rule_id := v_rule.id; organization_id := v_rule.organization_id; rule_name := v_rule.name;
          trigger_event := v_rule.trigger_event; actions := v_rule.actions; context := v_ctx;
          RETURN NEXT;
        END IF;
      END LOOP;

    ELSIF v_rule.trigger_event = 'attendance_recorded' THEN
      FOR v_row IN
        SELECT ar2.* FROM attendance_records ar2
         WHERE ar2.organization_id = v_rule.organization_id AND ar2.created_at > v_since
      LOOP
        v_ctx := jsonb_build_object('student_id', v_row.student_id, 'date', v_row.date, 'status_code', v_row.status_code);
        IF automation_conditions_match(v_ctx, v_rule.conditions) THEN
          rule_id := v_rule.id; organization_id := v_rule.organization_id; rule_name := v_rule.name;
          trigger_event := v_rule.trigger_event; actions := v_rule.actions; context := v_ctx;
          RETURN NEXT;
        END IF;
      END LOOP;

    ELSIF v_rule.trigger_event = 'student_promoted' THEN
      FOR v_row IN
        SELECT pe.* FROM promotion_events pe
         WHERE pe.organization_id = v_rule.organization_id AND pe.created_at > v_since
           AND pe.action = 'promoted'
      LOOP
        v_ctx := jsonb_build_object('student_id', v_row.student_id, 'action', v_row.action);
        IF automation_conditions_match(v_ctx, v_rule.conditions) THEN
          rule_id := v_rule.id; organization_id := v_rule.organization_id; rule_name := v_rule.name;
          trigger_event := v_rule.trigger_event; actions := v_rule.actions; context := v_ctx;
          RETURN NEXT;
        END IF;
      END LOOP;

    ELSIF v_rule.trigger_event = 'exam_submitted' THEN
      FOR v_row IN
        SELECT ea.* FROM exam_attempts ea
         WHERE ea.organization_id = v_rule.organization_id AND ea.submitted_at > v_since
           AND ea.status IN ('submitted', 'completed', 'graded')
      LOOP
        v_ctx := jsonb_build_object(
          'student_id', v_row.student_id, 'exam_id', v_row.exam_id,
          'percentage', v_row.percentage, 'passed', v_row.passed
        );
        IF automation_conditions_match(v_ctx, v_rule.conditions) THEN
          rule_id := v_rule.id; organization_id := v_rule.organization_id; rule_name := v_rule.name;
          trigger_event := v_rule.trigger_event; actions := v_rule.actions; context := v_ctx;
          RETURN NEXT;
        END IF;
      END LOOP;

    ELSIF v_rule.trigger_event = 'new_student_enrolled' THEN
      FOR v_row IN
        SELECT s.* FROM students s
         WHERE s.organization_id = v_rule.organization_id AND s.created_at > v_since
      LOOP
        v_ctx := jsonb_build_object('student_id', v_row.id, 'grade', v_row.grade);
        IF automation_conditions_match(v_ctx, v_rule.conditions) THEN
          rule_id := v_rule.id; organization_id := v_rule.organization_id; rule_name := v_rule.name;
          trigger_event := v_rule.trigger_event; actions := v_rule.actions; context := v_ctx;
          RETURN NEXT;
        END IF;
      END LOOP;

    ELSIF v_rule.trigger_event IN ('fee_overdue', 'balance_threshold') THEN
      -- Per-student, not per-event: computes the SAME derived balance
      -- student-finance/page.tsx already shows (fee_schedules matched by
      -- grade, minus paid), then applies an anti-spam guard so the same
      -- student cannot be renotified for the same rule within 7 days --
      -- automation_logs.trigger_data->>'student_id' is the existing
      -- column this reuses for that, not a new table.
      FOR v_row IN
        SELECT s.id AS student_id, s.grade,
               COALESCE((SELECT SUM(fs.amount) FROM fee_schedules fs
                          WHERE fs.organization_id = v_rule.organization_id AND fs.active = true
                            AND (fs.grade IS NULL OR fs.grade = s.grade)), 0)
               - COALESCE((SELECT SUM(ie2.amount) FROM income_entries ie2
                            WHERE ie2.organization_id = v_rule.organization_id AND ie2.student_id = s.id), 0)
               AS balance
          FROM students s
         WHERE s.organization_id = v_rule.organization_id AND s.status = 'active'
      LOOP
        IF v_row.balance <= 0 THEN CONTINUE; END IF;
        IF EXISTS (
          SELECT 1 FROM automation_logs al
           WHERE al.rule_id = v_rule.id
             AND al.trigger_data->>'student_id' = v_row.student_id::text
             AND al.created_at > now() - interval '7 days'
        ) THEN CONTINUE; END IF;

        v_ctx := jsonb_build_object('student_id', v_row.student_id, 'balance', v_row.balance);
        IF automation_conditions_match(v_ctx, v_rule.conditions) THEN
          rule_id := v_rule.id; organization_id := v_rule.organization_id; rule_name := v_rule.name;
          trigger_event := v_rule.trigger_event; actions := v_rule.actions; context := v_ctx;
          RETURN NEXT;
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.get_due_automation_triggers() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_due_automation_triggers() TO service_role;


-- ---------------------------------------------------------------------
-- 3. record_automation_execution -- write back the result of executing
--    ONE matched (rule, context) pair. Called once per row returned by
--    get_due_automation_triggers() after /api/cron/automations has
--    actually performed the actions. service_role only.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_automation_execution(
  p_rule_id uuid, p_status text, p_trigger_data jsonb,
  p_actions_executed jsonb DEFAULT NULL, p_error_message text DEFAULT NULL,
  p_execution_time_ms integer DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule RECORD;
BEGIN
  SELECT id, organization_id, name, trigger_event INTO v_rule
    FROM automation_rules WHERE id = p_rule_id;
  IF v_rule.id IS NULL THEN RETURN; END IF;

  INSERT INTO automation_logs (
    rule_id, rule_name, trigger_event, trigger_data, conditions_met,
    actions_executed, status, error_message, execution_time_ms, organization_id
  ) VALUES (
    p_rule_id, v_rule.name, v_rule.trigger_event, p_trigger_data, true,
    p_actions_executed, p_status, p_error_message, p_execution_time_ms, v_rule.organization_id
  );

  UPDATE automation_rules
     SET execution_count = execution_count + 1,
         last_executed_at = now(),
         last_status = p_status,
         updated_at = now()
   WHERE id = p_rule_id;
END $$;

REVOKE ALL ON FUNCTION public.record_automation_execution(uuid, text, jsonb, jsonb, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_automation_execution(uuid, text, jsonb, jsonb, text, integer) TO service_role;


-- ---------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------
SELECT 'functions' AS check, proname
FROM pg_proc
WHERE proname IN ('automation_conditions_match', 'get_due_automation_triggers', 'record_automation_execution')
ORDER BY proname;

SELECT 'authenticated/anon cannot execute (expect 0 rows)' AS check, p.proname, r.rolname
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(rolname)
WHERE n.nspname = 'public'
  AND p.proname IN ('automation_conditions_match', 'get_due_automation_triggers', 'record_automation_execution')
  AND has_function_privilege(r.rolname, p.oid, 'EXECUTE');
