-- ============================================================
-- Fix activity_log cross-tenant read/write leak
-- ============================================================
-- FINDING: tenant_activity_select allowed organization_id IS NULL rows to
-- be read by ANY authenticated user of ANY org (not just platform admins).
-- tenant_activity_insert allowed WITH CHECK (true), so any authenticated
-- user could insert a row with any organization_id (or NULL), including
-- one belonging to a different school.
--
-- Because several client-side insert paths never set organization_id,
-- essentially every activity_log row written through the normal app UI
-- has organization_id = NULL — and the old SELECT policy's
-- "OR organization_id IS NULL" clause made all of them visible to every
-- authenticated user at every school. This closes both the read leak and
-- the insert-forgery gap.
--
-- Platform-admin behavior is preserved: is_platform_admin() (SECURITY
-- DEFINER, saas_foundation.sql) still sees and can create NULL-org rows
-- (legitimate cross-org actions: provisioning an organization, running
-- the tenant-isolation test suite). Ordinary users can only see/insert
-- rows in their own org.
--
-- Historical NULL organization_id rows are NOT backfilled here — they
-- remain NULL and become platform-admin-only visible instead of
-- everyone-visible, which is the safe default given user_email cannot be
-- reliably re-attributed to a single historical organization.
--
-- No UPDATE or DELETE policy existed on activity_log before this
-- migration and none is added here — it stays an append-only log.
--
-- Idempotent — safe to re-run. Run in Supabase SQL editor / via
-- `supabase db push` when explicitly authorized. NOT applied here.
-- ============================================================

DROP POLICY IF EXISTS "tenant_activity_select" ON public.activity_log;
CREATE POLICY "tenant_activity_select" ON public.activity_log FOR SELECT
  USING (
    organization_id = public.current_user_org_id()
    OR (
      organization_id IS NULL
      AND public.is_platform_admin()
    )
  );

DROP POLICY IF EXISTS "tenant_activity_insert" ON public.activity_log;
CREATE POLICY "tenant_activity_insert" ON public.activity_log FOR INSERT
  WITH CHECK (
    organization_id = public.current_user_org_id()
    OR (
      organization_id IS NULL
      AND public.is_platform_admin()
    )
  );

-- ------------------------------------------------------------
-- Verification
-- ------------------------------------------------------------
-- Should show exactly the two policies above, both referencing
-- current_user_org_id() / is_platform_admin():
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'activity_log'
ORDER BY policyname;
