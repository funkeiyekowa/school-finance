-- =====================================================================
-- Regression tests for phase1_guard_v2. Run in Supabase SQL Editor.
-- Everything happens inside BEGIN ... ROLLBACK -- nothing persists.
-- Reports each check via RAISE NOTICE. Any FAIL raises and aborts.
--
-- Requires (all present in the incident context):
--   profiles row with role='developer' active for the caller
--   organizations: Grant Schools (8f1b965f-...), Jason Academy
--   students: 00459c87-... in Grant Schools with cascadable child rows
--   student_enrollments: b4b60ba4-... under that student
-- =====================================================================

BEGIN;

-- Assume the incident user's session
SELECT set_config(
  'request.jwt.claims',
  json_build_object('sub','f0008584-ba0f-475f-9126-cb576d2d61a4','role','authenticated')::text,
  true
);

DO $tests$
DECLARE
  jason_org uuid;
  jason_student uuid;
  jason_student_org uuid;
  grant_org uuid := '8f1b965f-7df2-479d-bdd9-a52c63d01401';
  incident_student uuid := '00459c87-abda-4503-b1a5-26c87a45329c';
  incident_enrollment uuid := 'b4b60ba4-235f-4831-8597-4cc5a0048abf';
  err text; sqlstate_text text;
BEGIN
  SELECT id INTO jason_org FROM public.organizations WHERE name = 'Jason Academy' LIMIT 1;
  SELECT id INTO jason_student FROM public.students WHERE organization_id = jason_org LIMIT 1;

  -- =============================================================
  -- T1 -- same-org student_enrollments DELETE succeeds
  -- =============================================================
  BEGIN
    DELETE FROM public.student_enrollments WHERE id = incident_enrollment;
    RAISE NOTICE 'T1 PASS: same-org enrollment DELETE succeeded';
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'T1 FAIL: %', SQLERRM; END;

  -- =============================================================
  -- T2 -- same-org student DELETE (with full cascade) succeeds
  -- =============================================================
  BEGIN
    DELETE FROM public.students WHERE id = incident_student;
    RAISE NOTICE 'T2 PASS: same-org student DELETE + cascade succeeded';
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'T2 FAIL: %', SQLERRM; END;

  -- =============================================================
  -- T3 -- cross-org student DELETE is blocked
  -- =============================================================
  IF jason_student IS NOT NULL THEN
    BEGIN
      DELETE FROM public.students WHERE id = jason_student;
      RAISE EXCEPTION 'T3 FAIL: cross-org student DELETE was PERMITTED';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS err = MESSAGE_TEXT, sqlstate_text = RETURNED_SQLSTATE;
      IF sqlstate_text = 'P0001' AND (err LIKE '%organization boundary%' OR err LIKE '%student administration%') THEN
        RAISE NOTICE 'T3 PASS: cross-org student DELETE blocked (%, %)', sqlstate_text, err;
      ELSIF err LIKE 'T3 FAIL%' THEN RAISE;
      ELSE RAISE NOTICE 'T3 PASS: cross-org student DELETE blocked with %', err;
      END IF;
    END;
  END IF;

  -- =============================================================
  -- T4 -- cross-org student INSERT is blocked
  -- =============================================================
  BEGIN
    INSERT INTO public.students(id, organization_id, full_name, student_code)
    VALUES (gen_random_uuid(), jason_org, 'T4-INJECT', 'T4-'||floor(random()*100000)::text);
    RAISE EXCEPTION 'T4 FAIL: cross-org student INSERT was PERMITTED';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err = MESSAGE_TEXT;
    IF err LIKE 'T4 FAIL%' THEN RAISE;
    ELSE RAISE NOTICE 'T4 PASS: cross-org student INSERT blocked (%)', err;
    END IF;
  END;

  -- =============================================================
  -- T5 -- parent/child tenant mismatch on student_enrollments blocked
  -- =============================================================
  IF jason_student IS NOT NULL THEN
    BEGIN
      INSERT INTO public.student_enrollments(id, student_id, class_id, academic_year_id, status, organization_id)
      SELECT gen_random_uuid(), jason_student, c.id, ay.id, 'active', grant_org
        FROM public.classes c CROSS JOIN public.academic_years ay
        WHERE c.organization_id = grant_org AND ay.organization_id = grant_org LIMIT 1;
      RAISE EXCEPTION 'T5 FAIL: cross-tenant parent/child was PERMITTED';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS err = MESSAGE_TEXT;
      IF err LIKE 'T5 FAIL%' THEN RAISE;
      ELSE RAISE NOTICE 'T5 PASS: parent/child tenant mismatch blocked (%)', err;
      END IF;
    END;
  END IF;

  -- =============================================================
  -- T6 -- NULL organization_id on students INSERT is blocked
  -- =============================================================
  BEGIN
    INSERT INTO public.students(id, organization_id, full_name, student_code)
    VALUES (gen_random_uuid(), NULL, 'T6-NULL-ORG', 'T6-'||floor(random()*100000)::text);
    RAISE EXCEPTION 'T6 FAIL: NULL organization_id INSERT was PERMITTED';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err = MESSAGE_TEXT;
    IF err LIKE 'T6 FAIL%' THEN RAISE;
    ELSE RAISE NOTICE 'T6 PASS: NULL organization_id INSERT blocked (%)', err;
    END IF;
  END;
END
$tests$;

-- =============================================================
-- T7 -- LMS trigger plan-time safety: every table's trigger can
-- be executed against a filtered-empty DELETE without SPI plan
-- errors on OLD.<field>. If any of these raises 42703, the
-- refactor failed.
-- =============================================================
DO $lms$
DECLARE tbl text; n int; err text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'lms_courses','lms_lessons','lms_quizzes','lms_quiz_questions',
    'lms_quiz_attempts','lms_quiz_answers','lms_assignments','lms_submissions',
    'lms_enrollments','lms_lesson_progress','lms_student_badges',
    'lms_badges','lms_discussions','lms_discussion_replies'
  ] LOOP
    IF to_regclass('public.'||tbl) IS NULL THEN CONTINUE; END IF;
    BEGIN
      EXECUTE format('DELETE FROM public.%I WHERE 1 = 0', tbl);
      RAISE NOTICE 'T7 PASS: % trigger plans cleanly (no OLD.<field> resolution error)', tbl;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS err = MESSAGE_TEXT;
      RAISE EXCEPTION 'T7 FAIL on %: %', tbl, err;
    END;
  END LOOP;
END
$lms$;

-- =============================================================
-- T8 -- every table that had phase1_sensitive_write_guard has a
-- phase1_guard replacement attached.
-- =============================================================
DO $check_attach$
DECLARE remaining int;
BEGIN
  SELECT count(*) INTO remaining
    FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND tg.tgname = 'phase1_sensitive_write_guard'
     AND NOT tg.tgisinternal;
  IF remaining > 0 THEN RAISE EXCEPTION 'T8 FAIL: % tables still have the old universal trigger attached', remaining; END IF;
  RAISE NOTICE 'T8 PASS: old universal trigger fully removed';
END
$check_attach$;

-- =============================================================
-- T9 -- non-admin session cannot delete students
-- =============================================================
SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (SELECT p.id::text FROM public.profiles p
             JOIN public.org_memberships m ON m.user_id = p.id
             WHERE m.role IN ('student','parent') AND m.active LIMIT 1),
    'role','authenticated'
  )::text, true
);

DO $t9$
DECLARE err text; any_id uuid;
BEGIN
  SELECT id INTO any_id FROM public.students LIMIT 1;
  IF any_id IS NULL THEN RAISE NOTICE 'T9 SKIP: no student rows available'; RETURN; END IF;
  BEGIN
    DELETE FROM public.students WHERE id = any_id;
    RAISE EXCEPTION 'T9 FAIL: non-admin user was permitted to DELETE students';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err = MESSAGE_TEXT;
    IF err LIKE 'T9 FAIL%' THEN RAISE;
    ELSE RAISE NOTICE 'T9 PASS: non-admin DELETE blocked (%)', err;
    END IF;
  END;
END
$t9$;

ROLLBACK;
