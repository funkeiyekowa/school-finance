-- ============================================================
-- ATTENDANCE MULTI-CAPTURE PLATFORM — PHASE 2
-- Device registration table + ingest_attendance_from_device() RPC
-- ============================================================
-- Adds the server-side entry point for QR/RFID hardware devices.
-- The existing record_attendance_batch() is extended with an optional
-- p_capture_method parameter (DEFAULT 'manual') so device ingest can
-- set the correct value without touching existing callers.
--
-- Device registration is admin-only SQL for Phase 2 (no UI yet).
-- See the REGISTRATION section at the bottom for the SQL snippet
-- to run when adding a new device.
--
-- RATE LIMITING NOTE: No in-process or external rate limiter is
-- added here. A compromised device token could be used to flood
-- the ingest endpoint. Consider adding Upstash/Redis rate limiting
-- before moving to production at scale.
--
-- Run order: after 20260907120000_attendance_batch_rpc.sql.
-- ============================================================

-- ============================================================
-- 1. attendance_capture_devices
-- ============================================================
CREATE TABLE IF NOT EXISTS public.attendance_capture_devices (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid        NOT NULL,
  class_id    uuid        NOT NULL,
  device_type text        NOT NULL CHECK (device_type IN ('qr', 'rfid')),
  label       text,
  -- SHA-256 hex of the raw token — plaintext is shown once at
  -- registration and never stored.
  token_hash  text        NOT NULL UNIQUE,
  active      boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- RLS: only org admins may read or write device rows.
ALTER TABLE public.attendance_capture_devices ENABLE ROW LEVEL SECURITY;

CREATE POLICY devices_org_admin_all ON public.attendance_capture_devices
  FOR ALL
  USING  (public.is_org_admin(org_id))
  WITH CHECK (public.is_org_admin(org_id));

-- Fast lookup by hash for ingest (active devices only).
CREATE INDEX IF NOT EXISTS idx_capture_devices_token_hash
  ON public.attendance_capture_devices(token_hash)
  WHERE active = true;

-- ============================================================
-- 2. Extend record_attendance_batch() with p_capture_method
-- ============================================================
-- Drop the 4-parameter version so there is no ambiguity when
-- PostgREST resolves named-parameter calls.
DROP FUNCTION IF EXISTS public.record_attendance_batch(uuid, date, text, jsonb);

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
  v_count        int := 0;
BEGIN
  -- --------------------------------------------------------
  -- A. Validate capture_method
  -- --------------------------------------------------------
  IF p_capture_method NOT IN ('manual', 'qr', 'rfid', 'fingerprint', 'facial') THEN
    RAISE EXCEPTION 'invalid capture_method: %', p_capture_method;
  END IF;

  -- --------------------------------------------------------
  -- B. Resolve caller identity (never trust client-supplied)
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

  SELECT p.full_name, p.email INTO v_caller_name, v_caller_email
  FROM public.profiles p
  WHERE p.id = v_caller_uid;

  -- --------------------------------------------------------
  -- C. Validate caller authorization
  -- --------------------------------------------------------
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
  -- D. Validate class belongs to caller's org
  -- --------------------------------------------------------
  SELECT c.name INTO v_class_name
  FROM public.classes c
  WHERE c.id = p_class_id
    AND c.organization_id = v_org_id;
  IF v_class_name IS NULL THEN
    RAISE EXCEPTION 'class not found in caller''s organization';
  END IF;

  -- --------------------------------------------------------
  -- E. Validate inputs
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
  -- F. Resolve current academic year
  -- --------------------------------------------------------
  SELECT ay.id INTO v_year_id
  FROM public.academic_years ay
  WHERE ay.organization_id = v_org_id
    AND ay.status = 'current'
  LIMIT 1;

  -- --------------------------------------------------------
  -- G. Atomic replace (daily attendance only)
  -- --------------------------------------------------------
  DELETE FROM public.attendance_records
  WHERE class_id      = p_class_id
    AND date          = p_date
    AND session       = p_session
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
      v_student_id, p_class_id, v_year_id, NULL,
      p_date, v_status_code, p_session, v_remarks,
      COALESCE(v_caller_name, v_caller_email), v_caller_uid, p_capture_method,
      v_org_id
    );

    v_count := v_count + 1;
  END LOOP;

  -- --------------------------------------------------------
  -- H. Activity log
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

  RETURN jsonb_build_object('success', true, 'count', v_count);
END;
$$;

-- Restore the grant on the new (5-param) signature.
GRANT EXECUTE ON FUNCTION public.record_attendance_batch(uuid, date, text, jsonb, text) TO authenticated;

-- ============================================================
-- 3. ingest_attendance_from_device()
-- ============================================================
-- Called exclusively via the service-role API route
-- (/api/attendance/ingest). NOT granted to 'authenticated' —
-- regular clients cannot call this function directly.
--
-- Authorization flow:
--   1. Token hash lookup → device row (org_id, class_id, device_type)
--   2. Class belongs to device's org
--   3. Every student belongs to device's org
--   4. Every status_code is valid for device's org
--   5. Atomic DELETE (subject_id IS NULL) + INSERT
--   6. Activity log
--
-- recorded_by_user_id is set to the device row's UUID so attendance
-- saved by each device is attributable via:
--   SELECT * FROM attendance_records
--   WHERE recorded_by_user_id = '<device_id>';

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
  -- C. Validate marks
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

    IF NOT EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.id = v_student_id AND s.organization_id = v_org_id
    ) THEN
      RAISE EXCEPTION 'student % not found in device org', v_student_id;
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
  -- D. Resolve current academic year
  -- --------------------------------------------------------
  SELECT ay.id INTO v_year_id
  FROM public.academic_years ay
  WHERE ay.organization_id = v_org_id
    AND ay.status = 'current'
  LIMIT 1;

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

-- Intentionally NOT granting to 'authenticated'.
-- This function is only callable via service_role (the ingest API route).

-- ============================================================
-- DEVICE REGISTRATION (run once per device, from SQL Editor)
-- ============================================================
-- Step 1 — generate a token (save the output; it won't be shown again):
--   SELECT encode(gen_random_bytes(32), 'hex') AS device_token;
--
-- Step 2 — register the device with the hashed token:
--   INSERT INTO public.attendance_capture_devices
--     (org_id, class_id, device_type, label, token_hash)
--   VALUES (
--     '<org_id>',
--     '<class_id>',
--     'qr',   -- or 'rfid'
--     'Main Gate Scanner',
--     encode(digest('<token_from_step_1>', 'sha256'), 'hex')
--   );
--
-- The device authenticates with:
--   Authorization: Bearer <token_from_step_1>
-- ============================================================
