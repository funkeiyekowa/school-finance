-- ============================================================
-- ATTENDANCE MULTI-CAPTURE PLATFORM — PHASE 1
-- Shared processing seam for attendance recording
-- ============================================================
-- Adds two additive columns (capture_method, recorded_by_user_id)
-- to attendance_records and creates record_attendance_batch() —
-- a SECURITY DEFINER RPC that atomically replaces all attendance
-- for a given (class_id, date, session) with the submitted batch.
--
-- This preserves the existing "complete roster state" semantics:
-- the saved roster IS the entire attendance for that class/date/
-- session — students not in the batch have their rows removed.
--
-- Nothing here changes existing RLS policies, the
-- phase1_sensitive_write_guard trigger, classes/subjects/periods/
-- timetable_entries, or any other table's schema.
--
-- Future capture methods (QR, RFID, biometric) will call this
-- same RPC with a different capture_method value, entering the
-- identical validation and write path.
--
-- Run order: after 20260905120000_phase1_security_enforcement.sql
-- (for phase1_hr_access, phase1_active_role, phase1_same_org,
-- current_user_org_id) and after attendance_migration.sql.
-- ============================================================

-- 1. Additive columns — nullable, no existing data breaks.
ALTER TABLE public.attendance_records
  ADD COLUMN IF NOT EXISTS capture_method text NOT NULL DEFAULT 'manual';

ALTER TABLE public.attendance_records
  ADD COLUMN IF NOT EXISTS recorded_by_user_id uuid;

-- Note: We intentionally do NOT add a FK to auth.users for
-- recorded_by_user_id. The auth schema is managed by Supabase
-- and cross-schema FKs to it cause migration ordering issues.
-- The value is set server-side from auth.uid() so it is always
-- a valid auth user id.

COMMENT ON COLUMN public.attendance_records.capture_method IS
  'How this record was captured: manual, qr, rfid, fingerprint, facial (extensible). Phase 1 always sets manual.';
COMMENT ON COLUMN public.attendance_records.recorded_by_user_id IS
  'auth.uid() of the user who recorded or triggered this attendance entry. Supplements the legacy recorded_by text column.';

-- 2. record_attendance_batch() — the shared processing seam.
--
-- SECURITY DEFINER so it can bypass RLS for the atomic
-- DELETE+INSERT. The phase1_sensitive_write_guard trigger still
-- fires on every row and validates authorization independently
-- (defense in depth). auth.uid() and auth.role() are preserved
-- across SECURITY DEFINER boundaries in Supabase, so the
-- trigger's caller-identity checks work correctly.
--
-- Parameters:
--   p_class_id  — which class
--   p_date      — attendance date
--   p_session   — 'morning', 'afternoon', 'full_day', etc.
--   p_marks     — jsonb array: [{"student_id":"uuid","status_code":"text","remarks":"text or null"}, ...]
--
-- Returns jsonb: { "success": true, "count": N } on success,
-- raises an exception on any validation failure (no partial save).

CREATE OR REPLACE FUNCTION public.record_attendance_batch(
  p_class_id uuid,
  p_date date,
  p_session text,
  p_marks jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
  v_caller_role text;
  v_caller_uid uuid;
  v_caller_name text;
  v_caller_email text;
  v_year_id uuid;
  v_class_name text;
  v_mark jsonb;
  v_student_id uuid;
  v_status_code text;
  v_remarks text;
  v_count int := 0;
BEGIN
  -- --------------------------------------------------------
  -- A. Resolve caller identity (never trust client-supplied)
  -- --------------------------------------------------------
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  v_org_id := public.current_user_org_id();
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
  -- C. Validate the class belongs to the caller's org
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

  -- Validate every student belongs to the caller's org and
  -- every status_code exists for this org.
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
  -- v_year_id may be NULL — that is acceptable (matches
  -- the existing client-side behavior).

  -- --------------------------------------------------------
  -- F. Atomic replace: DELETE then INSERT in one transaction
  -- --------------------------------------------------------
  -- This preserves "complete roster state" semantics: the
  -- submitted batch IS the entire attendance for this
  -- class/date/session. Any students not in the batch who
  -- had rows get those rows removed.
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
      COALESCE(v_caller_name, v_caller_email), v_caller_uid, 'manual',
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

GRANT EXECUTE ON FUNCTION public.record_attendance_batch(uuid, date, text, jsonb) TO authenticated;

-- ============================================================
-- VERIFICATION (run after applying, expect the results below)
-- ============================================================

-- Expect capture_method and recorded_by_user_id columns:
-- SELECT column_name, data_type, column_default
-- FROM information_schema.columns
-- WHERE table_name = 'attendance_records'
--   AND column_name IN ('capture_method', 'recorded_by_user_id');

-- Expect the function to exist:
-- SELECT proname, prosecdef FROM pg_proc WHERE proname = 'record_attendance_batch';

-- Existing RLS policies on attendance_records should be UNCHANGED:
-- SELECT policyname, cmd FROM pg_policies WHERE tablename = 'attendance_records';
