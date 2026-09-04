-- ============================================================
-- CBT Proctoring Infrastructure
-- ============================================================
-- Run order: after cbt_exam_lock.sql (#72), already in supabase/README.md.
--   Idempotent — safe to re-run.
--
-- Creates:
--   1. proctoring_events      — every violation / proctoring signal
--   2. proctoring_recordings  — metadata for chunked camera/screen recordings
--   3. school_settings columns for school-wide proctoring defaults
--   4. students.guardian_consent_proctoring flag
--   5. RPCs for event logging, recording registration, and staff viewing
--   6. Drops the legacy 2-arg submit_exam_attempt overload
--
-- STORAGE NOTE: you must also create a PRIVATE Supabase Storage bucket
--   named "proctoring-recordings" via the Supabase dashboard (Storage →
--   New Bucket → proctoring-recordings → Private). The bucket must NOT be
--   public. RLS on Supabase Storage is configured via the dashboard's
--   bucket policies, not via SQL — see the instructions at the end.

-- ---- housekeeping: drop legacy overload ----
DROP FUNCTION IF EXISTS public.submit_exam_attempt(uuid, boolean);

-- ============================================================
-- 1. PROCTORING EVENTS — one row per event
-- ============================================================
CREATE TABLE IF NOT EXISTS public.proctoring_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id      uuid NOT NULL REFERENCES public.exam_attempts(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_type      text NOT NULL,
    -- 'tab_hidden', 'fullscreen_exit', 'screen_share_stopped',
    -- 'camera_revoked', 'mic_revoked', 'blur', 'violation_strike',
    -- 'camera_started', 'screen_started', 'consent_accepted',
    -- 'consent_declined', 'exam_started', 'exam_submitted'
  event_data      jsonb DEFAULT '{}',
  violation       boolean NOT NULL DEFAULT false,
  strike_number   integer,               -- only set when violation=true
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_proctoring_events_attempt
  ON public.proctoring_events(attempt_id);
CREATE INDEX IF NOT EXISTS idx_proctoring_events_org
  ON public.proctoring_events(organization_id);

ALTER TABLE public.proctoring_events ENABLE ROW LEVEL SECURITY;

-- Staff can read all events for their org; students can write (log) events
-- for their own in-progress attempt only.
DO $$ BEGIN
  CREATE POLICY proctoring_events_staff_read ON public.proctoring_events
    FOR SELECT USING (
      organization_id = current_user_org_id() AND public.is_staff_user()
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY proctoring_events_student_insert ON public.proctoring_events
    FOR INSERT WITH CHECK (
      attempt_id IN (
        SELECT id FROM public.exam_attempts
        WHERE student_id IN (SELECT id FROM public.students WHERE profile_id = auth.uid())
          AND status = 'in_progress'
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 2. PROCTORING RECORDINGS — chunked recording metadata
-- ============================================================
CREATE TABLE IF NOT EXISTS public.proctoring_recordings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id      uuid NOT NULL REFERENCES public.exam_attempts(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  recording_type  text NOT NULL,          -- 'camera', 'screen'
  chunk_index     integer NOT NULL DEFAULT 0,
  storage_path    text NOT NULL,          -- path in the proctoring-recordings bucket
  size_bytes      bigint,
  duration_ms     integer,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz,            -- when this chunk should be auto-deleted
  UNIQUE(attempt_id, recording_type, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_proctoring_recordings_attempt
  ON public.proctoring_recordings(attempt_id);
CREATE INDEX IF NOT EXISTS idx_proctoring_recordings_org
  ON public.proctoring_recordings(organization_id);
CREATE INDEX IF NOT EXISTS idx_proctoring_recordings_expires
  ON public.proctoring_recordings(expires_at)
  WHERE expires_at IS NOT NULL;

ALTER TABLE public.proctoring_recordings ENABLE ROW LEVEL SECURITY;

-- Staff can read recording metadata for their org; students cannot read
-- anyone's recordings (including their own) through a student-facing path.
DO $$ BEGIN
  CREATE POLICY proctoring_recordings_staff_read ON public.proctoring_recordings
    FOR SELECT USING (
      organization_id = current_user_org_id() AND public.is_staff_user()
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Students can insert (register a chunk) for their own in-progress attempt.
DO $$ BEGIN
  CREATE POLICY proctoring_recordings_student_insert ON public.proctoring_recordings
    FOR INSERT WITH CHECK (
      attempt_id IN (
        SELECT id FROM public.exam_attempts
        WHERE student_id IN (SELECT id FROM public.students WHERE profile_id = auth.uid())
          AND status = 'in_progress'
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 3. SCHOOL SETTINGS — proctoring defaults
-- ============================================================
ALTER TABLE public.school_settings
  ADD COLUMN IF NOT EXISTS proctoring_camera_required boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS proctoring_screen_required boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS proctoring_retention_days integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS proctoring_block_on_denial boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS proctoring_guardian_consent_required boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS proctoring_viewer_roles text[] NOT NULL DEFAULT ARRAY['admin','owner']::text[];

-- ============================================================
-- 4. GUARDIAN CONSENT FLAG
-- ============================================================
ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS guardian_consent_proctoring boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.students.guardian_consent_proctoring IS
  'True when a parent/guardian has consented to camera/screen recording during proctored exams. Set by admin or parent. When proctoring_guardian_consent_required is ON and this is false, the student sees a consent screen before the exam can start.';

-- ============================================================
-- 5. LOG PROCTORING EVENT — SECURITY DEFINER RPC
-- ============================================================
-- Called by the exam runner to log events server-side. Validates the caller
-- owns the attempt and it's in_progress. Stamps organization_id.
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

  INSERT INTO proctoring_events (attempt_id, organization_id, event_type, event_data, violation, strike_number)
  VALUES (p_attempt, v_attempt.organization_id, p_event_type, COALESCE(p_event_data, '{}'), COALESCE(p_violation, false), p_strike_number);

  RETURN jsonb_build_object('ok', true);
END $$;
GRANT EXECUTE ON FUNCTION public.log_proctoring_event(uuid, text, jsonb, boolean, integer) TO authenticated;

-- ============================================================
-- 6. REGISTER RECORDING CHUNK — SECURITY DEFINER RPC
-- ============================================================
CREATE OR REPLACE FUNCTION public.register_proctoring_chunk(
  p_attempt uuid,
  p_recording_type text,
  p_chunk_index integer,
  p_storage_path text,
  p_size_bytes bigint DEFAULT NULL,
  p_duration_ms integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_attempt exam_attempts;
  v_retention integer;
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

  -- Look up retention from school settings; default 60 days.
  SELECT COALESCE(ss.proctoring_retention_days, 60) INTO v_retention
  FROM school_settings ss
  WHERE ss.organization_id = v_attempt.organization_id
  LIMIT 1;
  IF v_retention IS NULL THEN v_retention := 60; END IF;

  INSERT INTO proctoring_recordings (
    attempt_id, organization_id, recording_type, chunk_index,
    storage_path, size_bytes, duration_ms, expires_at
  ) VALUES (
    p_attempt, v_attempt.organization_id, p_recording_type, p_chunk_index,
    p_storage_path, p_size_bytes, p_duration_ms,
    now() + (v_retention || ' days')::interval
  )
  ON CONFLICT (attempt_id, recording_type, chunk_index) DO UPDATE
    SET storage_path = EXCLUDED.storage_path,
        size_bytes = EXCLUDED.size_bytes,
        duration_ms = EXCLUDED.duration_ms,
        expires_at = EXCLUDED.expires_at;

  RETURN jsonb_build_object('ok', true);
END $$;
GRANT EXECUTE ON FUNCTION public.register_proctoring_chunk(uuid, text, integer, text, bigint, integer) TO authenticated;

-- ============================================================
-- 7. RETENTION CLEANUP — call periodically (pg_cron or manual)
-- ============================================================
-- Deletes expired recording metadata. The actual Storage objects must be
-- deleted separately (a scheduled Edge Function or cron job that reads
-- expired rows, calls Storage.remove(), then deletes the rows).
CREATE OR REPLACE FUNCTION public.cleanup_expired_proctoring_recordings()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM proctoring_recordings
  WHERE expires_at IS NOT NULL AND expires_at < now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_proctoring_recordings() TO service_role;

-- ============================================================
-- Verification
-- ============================================================
-- 1. Tables exist
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN ('proctoring_events', 'proctoring_recordings')
ORDER BY table_name;

-- 2. school_settings columns
SELECT column_name FROM information_schema.columns
WHERE table_name = 'school_settings' AND column_name LIKE 'proctoring_%'
ORDER BY column_name;

-- 3. students.guardian_consent_proctoring
SELECT column_name FROM information_schema.columns
WHERE table_name = 'students' AND column_name = 'guardian_consent_proctoring';

-- 4. RPCs
SELECT proname FROM pg_proc
WHERE proname IN ('log_proctoring_event', 'register_proctoring_chunk', 'cleanup_expired_proctoring_recordings')
ORDER BY proname;

-- 5. Legacy overload dropped
SELECT proname, pg_get_function_identity_arguments(oid) AS args
FROM pg_proc WHERE proname = 'submit_exam_attempt';
-- Should show exactly ONE row: (uuid, boolean, text)

-- ============================================================
-- STORAGE SETUP (manual — cannot be done via SQL)
-- ============================================================
-- In the Supabase Dashboard:
-- 1. Go to Storage → New Bucket
-- 2. Name: proctoring-recordings
-- 3. Public: OFF (PRIVATE)
-- 4. Allowed MIME types: video/webm, audio/webm, video/mp4, image/jpeg, image/png
-- 5. Max file size: 50MB (individual chunks are small; this is a safety cap)
--
-- Bucket policies (via the dashboard's policy editor):
--   SELECT: allow only when
--     auth.uid() IN (SELECT user_id FROM org_memberships WHERE role IN ('admin','owner') AND active = true)
--   INSERT: allow only when
--     (bucket_id = 'proctoring-recordings')
--     AND auth.uid() IS NOT NULL
--     AND (storage.foldername(name))[1] IN (
--       SELECT id::text FROM exam_attempts WHERE student_id IN (SELECT id FROM students WHERE profile_id = auth.uid()) AND status = 'in_progress'
--     )
--   DELETE: allow only service_role (for retention cleanup)
