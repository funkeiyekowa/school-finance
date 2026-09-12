-- ============================================================
-- FIX: school_settings SELECT RLS — cross-tenant read
--
-- Problem (Bolt audit #3, confirmed):
--   schema.sql created:
--     CREATE POLICY "Authenticated users can read settings"
--       ON school_settings FOR SELECT USING (auth.role() = 'authenticated');
--   This allows any authenticated user to read school_settings
--   rows from ALL organizations — including webhook secrets
--   (email_webhook_secret, sms_webhook_secret).
--
--   rls_role_scoped_access.sql, tenant_isolation_enforcement.sql,
--   and all subsequent migrations left this policy untouched.
--
-- Fix:
--   Replace with organization_id = current_user_org_id(), which
--   is the same pattern used on every other tenant table.
--
-- Platform-admin cross-tenant access:
--   NOT added here. Platform admins use switch_active_org(p_org)
--   to set their default org pointer before reading org data,
--   which makes current_user_org_id() resolve to the target org.
--   This is the established project pattern; a bypass clause here
--   is unnecessary and would reintroduce a cross-tenant read for
--   super_admins.
--
-- Write policies (admin-gated, from schema.sql) are unchanged.
--
-- Idempotent. Safe to re-run.
-- DO NOT apply to Production without explicit authorization.
-- ============================================================

-- Drop the original open-read policy.
DROP POLICY IF EXISTS "Authenticated users can read settings" ON public.school_settings;

-- Replace with org-scoped read (identical pattern to all other tenant tables).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'school_settings'
      AND policyname = 'school_settings_own_org_read'
  ) THEN
    CREATE POLICY school_settings_own_org_read ON public.school_settings
      FOR SELECT
      USING (organization_id = current_user_org_id());
  END IF;
END $$;

-- ============================================================
-- VERIFY
-- ============================================================
SELECT policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'school_settings'
ORDER BY cmd, policyname;
