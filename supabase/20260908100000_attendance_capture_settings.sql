-- ============================================================
-- Attendance Capture Configuration
-- One row per organisation, auto-created on first access.
-- Follows the same pattern as timetable_settings.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.attendance_capture_settings (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- Which capture methods the school has enabled in their UI.
  -- Does NOT block registered devices from posting to /api/attendance/ingest.
  -- Supported now: manual, qr, rfid. Others deferred until hardware ships.
  enabled_capture_methods text[] NOT NULL DEFAULT ARRAY['manual'],
  -- AI intelligence layer. Requires org AI provider to be configured.
  -- No AI framework is built yet; this flag gates the future insights panel.
  ai_insights_enabled     boolean NOT NULL DEFAULT false,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT acs_org_unique UNIQUE (organization_id)
);

-- RLS: same shape as timetable_settings
ALTER TABLE public.attendance_capture_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "acs_select" ON public.attendance_capture_settings
  FOR SELECT USING (public.is_org_member(organization_id));

CREATE POLICY "acs_insert" ON public.attendance_capture_settings
  FOR INSERT WITH CHECK (public.is_org_admin(organization_id));

CREATE POLICY "acs_update" ON public.attendance_capture_settings
  FOR UPDATE USING (public.is_org_admin(organization_id))
  WITH CHECK (public.is_org_admin(organization_id));

CREATE INDEX IF NOT EXISTS idx_acs_org ON public.attendance_capture_settings(organization_id);

-- Convenience RPC — returns the row for the caller's org,
-- creating a default row if none exists yet.
CREATE OR REPLACE FUNCTION public.get_my_attendance_capture_settings()
RETURNS public.attendance_capture_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org  uuid;
  v_row  public.attendance_capture_settings;
BEGIN
  v_org := public.current_user_org_id();
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'no active organization';
  END IF;

  SELECT * INTO v_row FROM public.attendance_capture_settings WHERE organization_id = v_org;

  IF NOT FOUND THEN
    INSERT INTO public.attendance_capture_settings (organization_id)
    VALUES (v_org)
    RETURNING * INTO v_row;
  END IF;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_attendance_capture_settings() TO authenticated;
