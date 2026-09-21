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
  -- T3 -- cross-org student DELETE is blocked for a NON-platform-admin
  -- Grant org admin. Rewritten: the previous version used the developer
  -- (Deji) session, but by design is_platform_admin()=true for the
  -- developer role, so phase1_same_org() correctly returns true across
  -- orgs -- a platform admin CAN delete any student. The invariant we
  -- actually need to test is that an ordinary org admin from Org A
  -- cannot touch Org B's rows. Verified by checking the row still
  -- exists after the attempt (RLS filtering silently returns 0 rows
  -- deleted, which is also secure but wouldn't raise an exception).
  -- =============================================================
  DECLARE
    grant_admin uuid;
    after_exists boolean;
    n_rows int;
    developer_sub text := 'f0008584-ba0f-475f-9126-cb576d2d61a4';
    grant_org uuid := '8f1b965f-7df2-479d-bdd9-a52c63d01401'::uuid;
  BEGIN
    IF jason_student IS NULL THEN
      RAISE NOTICE 'T3 SKIP: no Jason Academy student to target';
    ELSE
      SELECT m.user_id INTO grant_admin
        FROM public.org_memberships m
        JOIN public.profiles p ON p.id = m.user_id
       WHERE m.organization_id = grant_org
         AND m.role IN ('admin','owner')
         AND m.active
         AND (p.role IS NULL OR p.role <> 'developer')
         AND COALESCE(p.active, true)
         AND m.user_id <> developer_sub::uuid
       LIMIT 1;

      IF grant_admin IS NULL THEN
        RAISE NOTICE 'T3 SKIP: no non-platform-admin Grant org admin available';
      ELSE
        -- Confirm the target row exists before we start.
        IF NOT EXISTS(SELECT 1 FROM public.students WHERE id = jason_student) THEN
          RAISE EXCEPTION 'T3 SETUP FAIL: Jason student % not visible pre-test', jason_student;
        END IF;

        -- Switch to the ordinary Grant admin.
        PERFORM set_config('request.jwt.claims',
          json_build_object('sub', grant_admin::text, 'role', 'authenticated')::text, true);

        BEGIN
          DELETE FROM public.students WHERE id = jason_student;
          GET DIAGNOSTICS n_rows = ROW_COUNT;
        EXCEPTION WHEN OTHERS THEN
          -- An exception here is expected/acceptable (org boundary or hr access).
          GET STACKED DIAGNOSTICS err = MESSAGE_TEXT;
        END;

        -- Switch back to developer so we can observe post-state.
        PERFORM set_config('request.jwt.claims',
          json_build_object('sub', developer_sub, 'role', 'authenticated')::text, true);

        after_exists := EXISTS(SELECT 1 FROM public.students WHERE id = jason_student);

        IF after_exists THEN
          RAISE NOTICE 'T3 PASS: cross-org DELETE by Grant admin left target Jason student intact (rows affected reported: %, error: %)', n_rows, COALESCE(err, '(none)');
        ELSE
          RAISE EXCEPTION 'T3 FAIL: Jason student % was removed by a Grant admin - cross-tenant vulnerability', jason_student;
        END IF;
      END IF;
    END IF;
  END;

  -- =============================================================
  -- T4 -- cross-org student INSERT is blocked for a NON-platform-admin
  -- Grant org admin. Same rationale as T3.
  -- =============================================================
  DECLARE
    grant_admin uuid;
    new_id uuid := gen_random_uuid();
    after_exists boolean;
    developer_sub text := 'f0008584-ba0f-475f-9126-cb576d2d61a4';
    grant_org uuid := '8f1b965f-7df2-479d-bdd9-a52c63d01401'::uuid;
  BEGIN
    SELECT m.user_id INTO grant_admin
      FROM public.org_memberships m
      JOIN public.profiles p ON p.id = m.user_id
     WHERE m.organization_id = grant_org
       AND m.role IN ('admin','owner')
       AND m.active
       AND (p.role IS NULL OR p.role <> 'developer')
       AND COALESCE(p.active, true)
       AND m.user_id <> developer_sub::uuid
     LIMIT 1;

    IF grant_admin IS NULL THEN
      RAISE NOTICE 'T4 SKIP: no non-platform-admin Grant org admin available';
    ELSE
      -- Switch to Grant admin.
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', grant_admin::text, 'role', 'authenticated')::text, true);

      BEGIN
        INSERT INTO public.students(id, organization_id, full_name, student_code)
        VALUES (new_id, jason_org, 'T4-INJECT', 'T4-'||floor(random()*100000)::text);
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS err = MESSAGE_TEXT;
      END;

      -- Switch back to developer to verify state.
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', developer_sub, 'role', 'authenticated')::text, true);

      after_exists := EXISTS(SELECT 1 FROM public.students WHERE id = new_id);

      IF after_exists THEN
        RAISE EXCEPTION 'T4 FAIL: cross-org student INSERT by Grant admin actually created a Jason row (%) - cross-tenant vulnerability', new_id;
      ELSE
        RAISE NOTICE 'T4 PASS: cross-org student INSERT by Grant admin correctly did not create a row (error: %)', COALESCE(err, '(RLS filtered, 0 rows)');
      END IF;
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
DECLARE
  err text;
  any_id uuid;
  after_exists boolean;
  developer_sub text := 'f0008584-ba0f-475f-9126-cb576d2d61a4';
BEGIN
  -- Same-shape fix as T3/T4: RLS may silently filter to 0 rows without
  -- raising, so we verify state after by switching back to developer.
  SELECT id INTO any_id FROM public.students LIMIT 1;
  IF any_id IS NULL THEN RAISE NOTICE 'T9 SKIP: no student rows available'; RETURN; END IF;

  BEGIN
    DELETE FROM public.students WHERE id = any_id;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err = MESSAGE_TEXT;
  END;

  -- Switch back to developer to observe post-state.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', developer_sub, 'role', 'authenticated')::text, true);

  after_exists := EXISTS(SELECT 1 FROM public.students WHERE id = any_id);
  IF after_exists THEN
    RAISE NOTICE 'T9 PASS: non-admin DELETE did not remove target student (error: %)', COALESCE(err, '(RLS filtered, 0 rows)');
  ELSE
    RAISE EXCEPTION 'T9 FAIL: non-admin user removed student % - authorization bypass', any_id;
  END IF;
END
$t9$;

ROLLBACK;
