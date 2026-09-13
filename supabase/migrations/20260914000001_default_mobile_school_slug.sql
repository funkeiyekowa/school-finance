-- ============================================================
-- Default mobile school slug — platform_settings extension
-- ============================================================
-- Adds a single column + one public RPC to the existing
-- platform_settings singleton (id = 'default'). No new table.
--
-- Purpose: the mobile app boots straight to sign-in for a
-- default school slug instead of showing a manual slug-entry
-- screen. Super Admin can change the default via the existing
-- platform_settings write path (already super_admin/developer
-- gated by platform_settings_super_admin_all).
--
-- Idempotent. Safe to re-run.
-- DO NOT apply to Production without explicit authorization.
-- ============================================================

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS default_mobile_school_slug text NOT NULL DEFAULT 'grant-schools';

-- Ensure the singleton row has a value (in case the row predates this column).
UPDATE public.platform_settings
   SET default_mobile_school_slug = 'grant-schools'
 WHERE id = 'default'
   AND default_mobile_school_slug IS NULL;

-- --------------------------------------------------------------
-- Public RPC — mirrors get_landing_contact_email() exactly.
-- Mobile app calls this unauthenticated (before sign-in) to
-- resolve which school slug to boot into.
-- --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_default_mobile_school_slug()
RETURNS text
LANGUAGE sql SECURITY DEFINER
SET search_path = public AS $$
  SELECT COALESCE(default_mobile_school_slug, 'grant-schools')
  FROM public.platform_settings
  WHERE id = 'default'
  LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.get_default_mobile_school_slug() TO anon, authenticated;

-- No RLS change needed: existing platform_settings_super_admin_all
-- policy already covers UPDATE of the new column for super_admin/developer.

-- ------------------------------------------------------------
-- Verification
-- ------------------------------------------------------------
SELECT default_mobile_school_slug FROM public.platform_settings WHERE id = 'default';
SELECT public.get_default_mobile_school_slug();
