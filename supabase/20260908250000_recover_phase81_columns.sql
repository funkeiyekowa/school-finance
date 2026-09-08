-- Recovery: add missing Phase 8.1 columns and fix get_my_attendance_capture_settings()
-- Idempotent: IF NOT EXISTS on all columns, CREATE OR REPLACE on function.
-- Phase 8.2 columns (default_session, default_attendance_mode) are untouched.

ALTER TABLE public.attendance_capture_settings
  ADD COLUMN IF NOT EXISTS subject_attendance_enabled      boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS period_selection_enabled        boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS class_level_attendance_enabled  boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS subject_required_for_attendance boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS manual_session_enabled          boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS attendance_reports_enabled      boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS attendance_csv_export_enabled   boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.get_my_attendance_capture_settings()
RETURNS TABLE (
  id                             uuid,
  organization_id                uuid,
  enabled_capture_methods        text[],
  ai_insights_enabled            boolean,
  subject_attendance_enabled     boolean,
  period_selection_enabled       boolean,
  class_level_attendance_enabled boolean,
  subject_required_for_attendance boolean,
  manual_session_enabled         boolean,
  attendance_reports_enabled     boolean,
  attendance_csv_export_enabled  boolean,
  default_session                text,
  default_attendance_mode        text,
  updated_at                     timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_org uuid;
BEGIN
  v_org := current_user_org_id();
  IF v_org IS NULL THEN RETURN; END IF;

  INSERT INTO public.attendance_capture_settings (organization_id)
  VALUES (v_org)
  ON CONFLICT ON CONSTRAINT acs_org_unique DO NOTHING;

  RETURN QUERY
    SELECT
      acs.id,
      acs.organization_id,
      acs.enabled_capture_methods,
      acs.ai_insights_enabled,
      acs.subject_attendance_enabled,
      acs.period_selection_enabled,
      acs.class_level_attendance_enabled,
      acs.subject_required_for_attendance,
      acs.manual_session_enabled,
      acs.attendance_reports_enabled,
      acs.attendance_csv_export_enabled,
      acs.default_session,
      acs.default_attendance_mode,
      acs.updated_at
    FROM public.attendance_capture_settings acs
    WHERE acs.organization_id = v_org;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_my_attendance_capture_settings() TO authenticated;
