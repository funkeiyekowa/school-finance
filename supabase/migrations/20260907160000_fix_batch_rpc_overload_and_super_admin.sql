-- ============================================================
-- FIX: PostgREST overload ambiguity + SUPER ADMIN org resolution
--      in record_attendance_batch()
-- ============================================================
--
-- Problem 1 — Overload ambiguity
--   Migration 20260907130000 intentionally DROPped the 4-arg
--   record_attendance_batch(uuid,date,text,jsonb) and replaced
--   it with the 5-arg version (adds p_capture_method text DEFAULT
--   'manual').  Migration 20260907150000 accidentally re-created
--   the 4-arg overload by using CREATE OR REPLACE on the old
--   4-arg signature.  PostgreSQL stores two distinct functions;
--   PostgREST cannot resolve named-parameter calls and raises:
--     "Could not choose the best candidate function between
--      public.record_attendance_batch(4 args) and
--      public.record_attendance_batch(5 args)"
--
-- Problem 2 — SUPER ADMIN org resolution
--   current_user_org_id() returns the is_default org_membership
--   row.  For platform admins (super_admin role / developer
--   profile) that row points to a platform/support organization,
--   not the school being managed.  Steps C and D compare
--   class.organization_id and student.organization_id against
--   that platform org and raise errors.
--
-- Fix:
--   1. DROP the accidentally re-created 4-arg overload.
--   2. CREATE OR REPLACE the canonical 5-arg function, adding
--      the platform-admin org override immediately after the
--      current_user_org_id() call.
--   3. GRANT only on the 5-arg signature.
--
-- Security guarantees preserved:
--   • Normal users (school admin/teacher/staff): is_platform_admin()
--     is false, so v_org_id is never overridden.
--   • Cross-school safety: both the class (step C) AND every
--     student (step D) are validated against the same v_org_id
--     (now the class's org).  A platform admin cannot mix
--     students from a different school — step D rejects them.
--   • phase1_sensitive_write_guard BEFORE trigger fires on
--     every INSERT/DELETE row; phase1_same_org() returns TRUE
--     for platform admins via is_platform_admin().
--
-- Run order: after 20260907150000_fix_super_admin_attendance_batch.sql
-- ============================================================

-- Step 1: Remove the accidental 4-arg overload.
DROP FUNCTION IF EXISTS public.record_attendance_batch(uuid, date, text, jsonb);

-- Step 2: Replace the canonical 5-arg function with the super-admin fix.
CREATE OR REPLACE FUNCTION public.record_attendance_batch(
  p_class_id       uuid,
  p_date           date,
  p_session        text,
  p_marks          jsonb,
  p_capture_method text DEFAULT 'manual'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id       uuid;
  v_caller_role  text;
  v_caller_uid   uuid;
  v_caller_name  text;
  v_caller_email text;
  v_year_id      uuid;
  v_class_name   text;
  v_mark         jsonb;
  v_student_id   uuid;
  v_status_code  text;
  v_remarks      text;
  v_method       text;
  v_count        int := 0;
BEGIN
  -- --------------------------------------------------------
  -- A. Resolve caller identity (never trust client-supplied)
  -- --------------------------------------------------------
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- Validate capture method.
  v_method := COALESCE(p_capture_method, 'manual');
  IF v_method NOT IN ('manual', 'qr', 'rfid') THEN
    RAISE EXCEPTION 'invalid capture_method: %', v_method;
  END IF;

  v_org_id := public.current_user_org_id();

  -- Platform admins (super_admin / developer) may have their
  -- is_default membership pointing to a platform/support org
  -- rather than the school being managed.  Resolve the target
  -- org from the requested class instead so all subsequent
  -- validation operates on the correct school.
  -- Normal users are unaffected: is_platform_admin() is false
  -- for them, so v_org_id is not overridden.
  IF public.is_platform_admin() THEN
    SELECT c.organization_id INTO v_org_id
    FROM public.classes c
    WHERE c.id = p_class_id;
  END IF;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'caller has no active organization';
  END IF;

  v_caller_role := public.phase1_active_role();

  -- Caller display name + email for the legacy recorded_by
  -- column and the activity_log entry.
  SELECT p.full_name, p.email INTO v_caller_name, v_caller_email
  FROM public.profiles p
  WHERE p.id = v_caller_uid;

  -- --------------------------------------------------------
  -- B. Validate caller authorization (once, not per-row)
  -- --------------------------------------------------------
  -- Staff roles (admin/editor/staff/bursar/accountant/developer/
  -- owner) can record for any class in their org.
  -- Platform admins pass via phase1_hr_access() → is_platform_admin().
  -- Teachers can record only for classes they are assigned to.
  IF NOT public.phase1_hr_access() THEN
    IF v_caller_role = 'teacher' THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.teacher_assignments ta
        WHERE ta.user_id = v_caller_uid
          AND ta.organization_id = v_org_id
          AND ta.active = true
          AND ta.class_id = p_class_id
      ) THEN
        RAISE EXCEPTION 'teacher is not assigned to this class';
      END IF;
    ELSE
      RAISE EXCEPTION 'caller role (%) is not authorized to record attendance', v_caller_role;
    END IF;
  END IF;

  -- --------------------------------------------------------
  -- C. Validate the class belongs to the resolved org
  -- --------------------------------------------------------
  SELECT c.name INTO v_class_name
  FROM public.classes c
  WHERE c.id = p_class_id
    AND c.organization_id = v_org_id;
  IF v_class_name IS NULL THEN
    RAISE EXCEPTION 'class not found in caller''s organization';
  END IF;

  -- --------------------------------------------------------
  -- D. Validate inputs
  -- --------------------------------------------------------
  IF p_marks IS NULL OR jsonb_array_length(p_marks) = 0 THEN
    RAISE EXCEPTION 'marks array is empty';
  END IF;

  -- Validate every student belongs to the resolved org and
  -- every status_code exists for this org.
  -- Cross-school safety: both class (step C) and every student
  -- are checked against the same v_org_id, so a platform admin
  -- cannot mix students from different schools.
  FOR v_mark IN SELECT * FROM jsonb_array_elements(p_marks) LOOP
    v_student_id := (v_mark ->> 'student_id')::uuid;
    v_status_code := v_mark ->> 'status_code';

    IF v_student_id IS NULL OR v_status_code IS NULL THEN
      RAISE EXCEPTION 'each mark must have student_id and status_code';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.id = v_student_id AND s.organization_id = v_org_id
    ) THEN
      RAISE EXCEPTION 'student % not found in caller''s organization', v_student_id;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.attendance_statuses ast
      WHERE ast.code = v_status_code
        AND ast.organization_id = v_org_id
        AND ast.active = true
    ) THEN
      RAISE EXCEPTION 'status_code % is not valid for this organization', v_status_code;
    END IF;
  END LOOP;

  -- --------------------------------------------------------
  -- E. Resolve current academic year
  -- --------------------------------------------------------
  SELECT ay.id INTO v_year_id
  FROM public.academic_years ay
  WHERE ay.organization_id = v_org_id
    AND ay.status = 'current'
  LIMIT 1;
  -- v_year_id may be NULL — that is acceptable.

  -- --------------------------------------------------------
  -- F. Atomic replace: DELETE then INSERT in one transaction
  -- --------------------------------------------------------
  -- Preserves "complete roster state" semantics: the submitted
  -- batch IS the entire attendance for this class/date/session.
  DELETE FROM public.attendance_records
  WHERE class_id = p_class_id
    AND date = p_date
    AND session = p_session
    AND organization_id = v_org_id
    AND subject_id IS NULL;

  FOR v_mark IN SELECT * FROM jsonb_array_elements(p_marks) LOOP
    v_student_id := (v_mark ->> 'student_id')::uuid;
    v_status_code := v_mark ->> 'status_code';
    v_remarks := v_mark ->> 'remarks';

    INSERT INTO public.attendance_records (
      student_id, class_id, academic_year_id, subject_id,
      date, status_code, session, remarks,
      recorded_by, recorded_by_user_id, capture_method,
      organization_id
    ) VALUES (
      v_student_id, p_class_id, v_year_id, NULL,
      p_date, v_status_code, p_session, v_remarks,
      COALESCE(v_caller_name, v_caller_email), v_caller_uid, v_method,
      v_org_id
    );

    v_count := v_count + 1;
  END LOOP;

  -- --------------------------------------------------------
  -- G. Activity log (same shape as existing client-side log)
  -- --------------------------------------------------------
  INSERT INTO public.activity_log (
    user_email, user_name, action, details, organization_id
  ) VALUES (
    v_caller_email,
    v_caller_name,
    'Record Attendance',
    v_class_name || ' — ' || p_date::text || ' — ' || v_count || ' students',
    v_org_id
  );

  -- --------------------------------------------------------
  -- H. Return summary
  -- --------------------------------------------------------
  RETURN jsonb_build_object('success', true, 'count', v_count);
END;
$$;

-- Step 3: Grant execute only on the canonical 5-arg function.
GRANT EXECUTE ON FUNCTION public.record_attendance_batch(uuid, date, text, jsonb, text) TO authenticated;
