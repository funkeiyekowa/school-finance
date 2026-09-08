-- ============================================================
-- Phase 8: Subject-Level Attendance Batch RPC
--
-- Adds record_attendance_subject_batch(6 args): same auth/
-- scoping as the class-level 5-arg RPC but accepts a subject_id.
-- Existing record_attendance_batch() is NOT modified.
--
-- Security:
--   - Teachers must be assigned to the class AND the subject
--     (or have a NULL-subject class-teacher assignment).
--   - HR-access / platform-admin roles can record for any
--     class+subject in the resolved org.
--   - subject_id must belong to the same org (validated).
--   - DELETE+INSERT scoped to (class_id, date, session, subject_id)
--     so subject records never touch class-level records.
-- ============================================================

CREATE OR REPLACE FUNCTION public.record_attendance_subject_batch(
  p_class_id       uuid,
  p_subject_id     uuid,
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
  v_subject_name text;
  v_mark         jsonb;
  v_student_id   uuid;
  v_status_code  text;
  v_remarks      text;
  v_method       text;
  v_count        int := 0;
BEGIN
  -- A. Resolve caller identity
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  v_method := COALESCE(p_capture_method, 'manual');
  IF v_method NOT IN ('manual', 'qr', 'rfid') THEN
    RAISE EXCEPTION 'invalid capture_method: %', v_method;
  END IF;

  v_org_id := public.current_user_org_id();

  -- Platform admins: resolve org from class (same as class-level RPC)
  IF public.is_platform_admin() THEN
    SELECT c.organization_id INTO v_org_id
    FROM public.classes c
    WHERE c.id = p_class_id;
  END IF;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'caller has no active organization';
  END IF;

  v_caller_role := public.phase1_active_role();

  SELECT p.full_name, p.email INTO v_caller_name, v_caller_email
  FROM public.profiles p
  WHERE p.id = v_caller_uid;

  -- B. Validate class belongs to org
  SELECT c.name, ay.id INTO v_class_name, v_year_id
  FROM public.classes c
  LEFT JOIN public.academic_years ay
    ON ay.organization_id = v_org_id AND ay.is_current = true
  WHERE c.id = p_class_id AND c.organization_id = v_org_id;

  IF v_class_name IS NULL THEN
    RAISE EXCEPTION 'class not found or not in caller org';
  END IF;

  -- C. Validate subject belongs to org
  SELECT s.name INTO v_subject_name
  FROM public.subjects s
  WHERE s.id = p_subject_id AND s.organization_id = v_org_id AND s.active = true;

  IF v_subject_name IS NULL THEN
    RAISE EXCEPTION 'subject not found, inactive, or not in caller org';
  END IF;

  -- D. Authorization: teachers must be assigned to class AND subject
  IF NOT public.phase1_hr_access() THEN
    IF v_caller_role = 'teacher' THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.teacher_assignments ta
        WHERE ta.user_id = v_caller_uid
          AND ta.organization_id = v_org_id
          AND ta.class_id = p_class_id
          AND ta.active = true
          AND (ta.subject_id = p_subject_id OR ta.subject_id IS NULL)
      ) THEN
        RAISE EXCEPTION 'teacher not authorized for this class/subject';
      END IF;
    ELSE
      RAISE EXCEPTION 'not authorized to record subject attendance';
    END IF;
  END IF;

  -- E. Validate marks array
  IF p_marks IS NULL OR jsonb_array_length(p_marks) = 0 THEN
    RAISE EXCEPTION 'marks array is empty';
  END IF;

  -- F. Atomic replace: delete existing subject records for this
  --    (class, date, session, subject_id), then insert fresh batch.
  DELETE FROM public.attendance_records
  WHERE class_id    = p_class_id
    AND date        = p_date
    AND session     = p_session
    AND subject_id  = p_subject_id;

  FOR v_mark IN SELECT * FROM jsonb_array_elements(p_marks) LOOP
    v_student_id  := (v_mark->>'student_id')::uuid;
    v_status_code := COALESCE(v_mark->>'status_code', 'present');
    v_remarks     := v_mark->>'remarks';

    -- Validate student belongs to org and is enrolled in class
    IF NOT EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.id = v_student_id AND s.organization_id = v_org_id
    ) THEN
      RAISE EXCEPTION 'student % not found in org', v_student_id;
    END IF;

    INSERT INTO public.attendance_records (
      student_id, class_id, academic_year_id, subject_id,
      date, status_code, session, remarks,
      recorded_by, organization_id
    ) VALUES (
      v_student_id, p_class_id, v_year_id, p_subject_id,
      p_date, v_status_code, p_session, v_remarks,
      v_caller_name, v_org_id
    )
    ON CONFLICT (student_id, date, session, subject_id)
    DO UPDATE SET
      status_code  = EXCLUDED.status_code,
      remarks      = EXCLUDED.remarks,
      recorded_by  = EXCLUDED.recorded_by,
      updated_at   = now();

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'count', v_count);
END;
$$;

-- Grant to authenticated users (same as class-level RPC)
GRANT EXECUTE ON FUNCTION public.record_attendance_subject_batch(uuid, uuid, date, text, jsonb, text)
  TO authenticated;

COMMENT ON FUNCTION public.record_attendance_subject_batch IS
  'Phase 8: subject-level attendance batch. Auth mirrors record_attendance_batch. '
  'Teachers must be assigned to the class+subject (or have a NULL-subject class-teacher row). '
  'DELETE+INSERT scoped to (class_id, date, session, subject_id) — never touches class-level rows.';
