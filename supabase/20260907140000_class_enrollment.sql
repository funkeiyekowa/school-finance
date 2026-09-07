-- ============================================================
-- Phase 3: Student–class enrollment validation in device ingest
-- ============================================================
-- Adds is_student_enrolled_in_class() helper and patches
-- ingest_attendance_from_device() to reject students not actively
-- enrolled in the device's class for the current academic year.
--
-- Uses the existing student_enrollments table (promotion_system_migration).
-- No new tables, no RLS changes, no backfill required.
-- record_attendance_batch() is NOT changed.
-- ============================================================

-- ============================================================
-- 1. Helper: is_student_enrolled_in_class
-- ============================================================
-- Returns TRUE iff the student has an active enrollment in the
-- specified class for the specified academic year within the org.
-- SECURITY DEFINER so it can be called from other SECURITY DEFINER
-- functions (ingest_attendance_from_device) without RLS interference.
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_student_enrolled_in_class(
  p_student_id     uuid,
  p_class_id       uuid,
  p_org_id         uuid,
  p_academic_year_id uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.student_enrollments se
    WHERE se.student_id       = p_student_id
      AND se.class_id         = p_class_id
      AND se.organization_id  = p_org_id
      AND se.academic_year_id = p_academic_year_id
      AND se.status           = 'active'
  );
$$;

-- Revoke default PUBLIC execute; only callable internally from
-- SECURITY DEFINER context (runs as owner = postgres).
REVOKE ALL ON FUNCTION public.is_student_enrolled_in_class(uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_student_enrolled_in_class(uuid, uuid, uuid, uuid) FROM anon, authenticated;

-- ============================================================
-- 2. Patch ingest_attendance_from_device() — enrollment check
-- ============================================================
-- Identical to Phase 2 except:
--   • D (resolve academic year) is moved BEFORE C (validate marks)
--     so v_year_id is available for the enrollment check.
--   • Per-mark validation (section C) gains a new enrollment check
--     after the org check.
-- ============================================================
CREATE OR REPLACE FUNCTION public.ingest_attendance_from_device(
  p_token_hash text,
  p_date       date,
  p_session    text,
  p_marks      jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_device      public.attendance_capture_devices%ROWTYPE;
  v_org_id      uuid;
  v_class_name  text;
  v_year_id     uuid;
  v_mark        jsonb;
  v_student_id  uuid;
  v_status_code text;
  v_remarks     text;
  v_count       int := 0;
BEGIN
  -- --------------------------------------------------------
  -- A. Validate device token
  -- --------------------------------------------------------
  SELECT * INTO v_device
  FROM public.attendance_capture_devices
  WHERE token_hash = p_token_hash
    AND active = true
  LIMIT 1;

  IF v_device.id IS NULL THEN
    RAISE EXCEPTION 'invalid or inactive device';
  END IF;

  v_org_id := v_device.org_id;

  -- --------------------------------------------------------
  -- B. Validate class belongs to device's org
  -- --------------------------------------------------------
  SELECT c.name INTO v_class_name
  FROM public.classes c
  WHERE c.id = v_device.class_id
    AND c.organization_id = v_org_id;
  IF v_class_name IS NULL THEN
    RAISE EXCEPTION 'device class not found in its organization';
  END IF;

  -- --------------------------------------------------------
  -- D. Resolve current academic year (moved before C so v_year_id
  --    is available for the enrollment check in C).
  -- --------------------------------------------------------
  SELECT ay.id INTO v_year_id
  FROM public.academic_years ay
  WHERE ay.organization_id = v_org_id
    AND ay.status = 'current'
  LIMIT 1;

  -- --------------------------------------------------------
  -- C. Validate marks (org, enrollment, status_code)
  -- --------------------------------------------------------
  IF p_marks IS NULL OR jsonb_array_length(p_marks) = 0 THEN
    RAISE EXCEPTION 'marks array is empty';
  END IF;

  FOR v_mark IN SELECT * FROM jsonb_array_elements(p_marks) LOOP
    v_student_id  := (v_mark ->> 'student_id')::uuid;
    v_status_code := v_mark ->> 'status_code';

    IF v_student_id IS NULL OR v_status_code IS NULL THEN
      RAISE EXCEPTION 'each mark must have student_id and status_code';
    END IF;

    -- C1. Student must belong to device's org
    IF NOT EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.id = v_student_id AND s.organization_id = v_org_id
    ) THEN
      RAISE EXCEPTION 'student % not found in device org', v_student_id;
    END IF;

    -- C2. Student must be actively enrolled in THIS device's class
    --     for the current academic year (Phase 3 addition).
    IF NOT public.is_student_enrolled_in_class(
          v_student_id, v_device.class_id, v_org_id, v_year_id) THEN
      RAISE EXCEPTION 'student % not enrolled in device class', v_student_id;
    END IF;

    -- C3. Status code must be valid for this org
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
  -- E. Atomic replace (daily attendance only)
  -- --------------------------------------------------------
  DELETE FROM public.attendance_records
  WHERE class_id        = v_device.class_id
    AND date            = p_date
    AND session         = p_session
    AND organization_id = v_org_id
    AND subject_id IS NULL;

  FOR v_mark IN SELECT * FROM jsonb_array_elements(p_marks) LOOP
    v_student_id  := (v_mark ->> 'student_id')::uuid;
    v_status_code := v_mark ->> 'status_code';
    v_remarks     := v_mark ->> 'remarks';

    INSERT INTO public.attendance_records (
      student_id, class_id, academic_year_id, subject_id,
      date, status_code, session, remarks,
      recorded_by, recorded_by_user_id, capture_method,
      organization_id
    ) VALUES (
      v_student_id, v_device.class_id, v_year_id, NULL,
      p_date, v_status_code, p_session, v_remarks,
      'device:' || v_device.device_type || ':' || COALESCE(v_device.label, v_device.id::text),
      v_device.id,
      v_device.device_type,
      v_org_id
    );

    v_count := v_count + 1;
  END LOOP;

  -- --------------------------------------------------------
  -- F. Activity log
  -- --------------------------------------------------------
  INSERT INTO public.activity_log (
    user_email, user_name, action, details, organization_id
  ) VALUES (
    NULL,
    COALESCE(v_device.label, 'device:' || v_device.id::text),
    'Record Attendance',
    v_class_name || ' — ' || p_date::text || ' — ' || v_count
      || ' students (' || v_device.device_type || ')',
    v_org_id
  );

  RETURN jsonb_build_object('success', true, 'count', v_count);
END;
$$;

-- Correct the privilege discrepancy: anon and authenticated must not
-- execute this function directly. Only the service_role API route may call it.
REVOKE ALL ON FUNCTION public.ingest_attendance_from_device(text, date, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ingest_attendance_from_device(text, date, text, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_attendance_from_device(text, date, text, jsonb) TO service_role;
