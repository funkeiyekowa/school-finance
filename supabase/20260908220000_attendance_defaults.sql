-- ============================================================
-- Phase 8.2 — Attendance Configuration UX / Flexibility
-- Adds two default-behaviour columns to attendance_capture_settings.
--
-- default_session      — which session the capture page pre-selects
--                        ('full_day' | 'morning' | 'afternoon')
-- default_attendance_mode — 'class' or 'subject'
--
-- Both columns use IF NOT EXISTS so this migration is safe to re-run
-- after the previous failed attempt (which may have partially applied
-- the ALTER TABLE before the function replacement was rejected).
--
-- The function replacement uses DROP + CREATE (not CREATE OR REPLACE)
-- because PostgreSQL disallows changing a RETURNS TABLE column list
-- via CREATE OR REPLACE, even when the language and body are identical.
-- The existing Phase 8.1 function signature is dropped explicitly.
-- ============================================================

-- Step 1: Add columns (safe to re-run — IF NOT EXISTS is idempotent)
ALTER TABLE public.attendance_capture_settings
  ADD COLUMN IF NOT EXISTS default_session          text NOT NULL DEFAULT 'full_day'
    CHECK (default_session IN ('full_day', 'morning', 'afternoon')),
  ADD COLUMN IF NOT EXISTS default_attendance_mode  text NOT NULL DEFAULT 'class'
    CHECK (default_attendance_mode IN ('class', 'subject'));

-- Step 2: Drop the Phase 8.1 function (exact signature).
-- This is safe: the new function immediately below restores it with the
-- two new columns added. GRANT is re-applied in Step 3.
DROP FUNCTION IF EXISTS public.get_my_attendance_capture_settings();

-- Step 3: Re-create with both new columns in the return type.
CREATE FUNCTION public.get_my_attendance_capture_settings()
RETURNS TABLE (
  id                              uuid,
  organization_id                 uuid,
  enabled_capture_methods         text[],
  ai_insights_enabled             boolean,
  subject_attendance_enabled      boolean,
  period_selection_enabled        boolean,
  class_level_attendance_enabled  boolean,
  subject_required_for_attendance boolean,
  manual_session_enabled          boolean,
  attendance_reports_enabled      boolean,
  attendance_csv_export_enabled   boolean,
  default_session                 text,
  default_attendance_mode         text,
  updated_at                      timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
BEGIN
  v_org := public.current_user_org_id();
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'no active organization';
  END IF;

  -- Auto-create row with defaults if absent
  INSERT INTO public.attendance_capture_settings (organization_id)
  VALUES (v_org)
  ON CONFLICT (organization_id) DO NOTHING;

  RETURN QUERY
  SELECT
    s.id,
    s.organization_id,
    s.enabled_capture_methods,
    s.ai_insights_enabled,
    s.subject_attendance_enabled,
    s.period_selection_enabled,
    s.class_level_attendance_enabled,
    s.subject_required_for_attendance,
    s.manual_session_enabled,
    s.attendance_reports_enabled,
    s.attendance_csv_export_enabled,
    s.default_session,
    s.default_attendance_mode,
    s.updated_at
  FROM public.attendance_capture_settings s
  WHERE s.organization_id = v_org;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_attendance_capture_settings() TO authenticated;
