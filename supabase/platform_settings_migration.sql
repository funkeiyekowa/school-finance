-- ============================================================
-- PLATFORM SETTINGS — a single global row keyed by 'default'.
-- Holds knobs for the public marketing landing page and other
-- Smart & Thrive O/S wide config (contact email, tagline, etc.).
--
-- Only super_admins can read/write. Public reads go through a
-- SECURITY DEFINER RPC so the landing page (unauthenticated)
-- can still fetch the contact email.
--
-- Idempotent. Safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.platform_settings (
  id              text PRIMARY KEY DEFAULT 'default',
  contact_email   text NOT NULL DEFAULT 'hello@smartandthrive.com',
  marketing_phone text,
  tagline         text,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT platform_settings_id_check CHECK (id = 'default')
);

-- Seed the singleton row.
INSERT INTO public.platform_settings (id, contact_email)
VALUES ('default', 'hello@smartandthrive.com')
ON CONFLICT (id) DO NOTHING;

-- --------------------------------------------------------------
-- RLS: super-admin only, but a public RPC exposes the email.
-- --------------------------------------------------------------
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS platform_settings_super_admin_all ON public.platform_settings;
CREATE POLICY platform_settings_super_admin_all
  ON public.platform_settings
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.id = auth.uid() AND p.role IN ('super_admin','developer')
    )
    OR EXISTS (
      SELECT 1 FROM public.org_memberships m
       WHERE m.user_id = auth.uid() AND m.role = 'super_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.id = auth.uid() AND p.role IN ('super_admin','developer')
    )
    OR EXISTS (
      SELECT 1 FROM public.org_memberships m
       WHERE m.user_id = auth.uid() AND m.role = 'super_admin'
    )
  );

-- --------------------------------------------------------------
-- Public RPC — returns the landing-page contact email.
-- --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_landing_contact_email()
RETURNS text
LANGUAGE sql SECURITY DEFINER
SET search_path = public AS $$
  SELECT COALESCE(contact_email, 'hello@smartandthrive.com')
  FROM public.platform_settings
  WHERE id = 'default'
  LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.get_landing_contact_email() TO anon, authenticated;

-- --------------------------------------------------------------
-- Updater trigger — timestamp + user.
-- --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.platform_settings_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_platform_settings_touch ON public.platform_settings;
CREATE TRIGGER trg_platform_settings_touch
  BEFORE UPDATE ON public.platform_settings
  FOR EACH ROW EXECUTE FUNCTION public.platform_settings_touch();

-- VERIFY
SELECT id, contact_email, updated_at FROM public.platform_settings;
