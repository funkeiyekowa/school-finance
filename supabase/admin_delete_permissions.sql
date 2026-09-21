-- =====================================================================
-- ADMIN DELETE PERMISSIONS
--
-- WHY: super_admin can always delete + purge; regular admins can delete
-- only entity types the super_admin has explicitly enabled per-org, and
-- can never purge. This table stores the per-org toggle map.
--
-- Shape of `permissions` JSONB (all keys optional; missing = false):
--   { "students": true, "income": false, "expenses": true, ... }
--
-- Reading the row is safe for any org member (the client needs it to
-- decide which delete controls to render). Writing is restricted to
-- super_admin / platform_admin via RLS.
--
-- Run order: after saas_foundation.sql (is_platform_admin) and
-- 20260905120000_phase1_security_enforcement.sql (phase1_same_org).
-- Idempotent. Manual apply in Supabase SQL editor.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.admin_delete_permissions (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  permissions     jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.admin_delete_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_delete_perms_read   ON public.admin_delete_permissions;
DROP POLICY IF EXISTS admin_delete_perms_insert ON public.admin_delete_permissions;
DROP POLICY IF EXISTS admin_delete_perms_update ON public.admin_delete_permissions;

-- Any member of the org can read their org's row so the client can
-- decide which delete controls to render.
CREATE POLICY admin_delete_perms_read ON public.admin_delete_permissions FOR SELECT
  USING (public.phase1_same_org(organization_id));

-- Only super_admin (via org_memberships) or a platform admin may write.
CREATE POLICY admin_delete_perms_insert ON public.admin_delete_permissions FOR INSERT
  WITH CHECK (
    public.phase1_same_org(organization_id) AND (
      public.is_platform_admin() OR EXISTS (
        SELECT 1 FROM public.org_memberships m
        WHERE m.user_id = auth.uid()
          AND m.organization_id = admin_delete_permissions.organization_id
          AND m.role = 'super_admin'
          AND m.active
      )
    )
  );

CREATE POLICY admin_delete_perms_update ON public.admin_delete_permissions FOR UPDATE
  USING (
    public.phase1_same_org(organization_id) AND (
      public.is_platform_admin() OR EXISTS (
        SELECT 1 FROM public.org_memberships m
        WHERE m.user_id = auth.uid()
          AND m.organization_id = admin_delete_permissions.organization_id
          AND m.role = 'super_admin'
          AND m.active
      )
    )
  )
  WITH CHECK (
    public.phase1_same_org(organization_id) AND (
      public.is_platform_admin() OR EXISTS (
        SELECT 1 FROM public.org_memberships m
        WHERE m.user_id = auth.uid()
          AND m.organization_id = admin_delete_permissions.organization_id
          AND m.role = 'super_admin'
          AND m.active
      )
    )
  );

GRANT SELECT, INSERT, UPDATE ON public.admin_delete_permissions TO authenticated;
