-- ============================================================
-- Phase 8.1 — Attendance Configuration Controls
-- Extends attendance_capture_settings with 7 org-level flags.
-- Each flag has a permissive default so existing schools are
-- unaffected until they change a setting.
-- ============================================================

ALTER TABLE public.attendance_capture_settings
  ADD COLUMN IF NOT EXISTS subject_attendance_enabled      boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS period_selection_enabled        boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS class_level_attendance_enabled  boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS subject_required_for_attendance boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS manual_session_enabled          boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS attendance_reports_enabled      boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS attendance_csv_export_enabled   boolean NOT NULL DEFAULT true;

-- ============================================================
-- Replace get_my_attendance_capture_settings so it returns the
-- new fields (RETURNS type is TABLE to avoid rowtype coupling).
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_my_attendance_capture_settings()
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
    s.updated_at
  FROM public.attendance_capture_settings s
  WHERE s.organization_id = v_org;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_attendance_capture_settings() TO authenticated;
