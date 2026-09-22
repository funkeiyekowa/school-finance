-- Run immediately after 20260922021500_secure_parent_recovery_onboarding.sql.
-- Compatibility wrapper for the current Parents UI. It derives the active tenant
-- on the server and delegates to the tenant-checked two-argument implementation.

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_create_parent_user(p_email text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid := public.current_user_org_id();
BEGIN
  IF v_org IS NULL OR NOT public.is_org_admin(v_org) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  RETURN public.admin_create_parent_user(p_email, v_org);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_parent_user(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_parent_user(text) TO authenticated;

COMMIT;
