-- ============================================================
-- Upgrades 2026-08
-- ============================================================
-- Three additive changes to fix known correctness gaps and enable
-- new features. All statements are idempotent — safe to re-run.
--
-- 1. resolve_school_brand_by_slug() — SECURITY DEFINER RPC that
--    anon can call to get {id, name, slug, logo_url, status,
--    plan} for any org by slug. Fixes "School not found" on
--    /s/[slug]/login when the org exists but has no published
--    website record (which is the current dependency of
--    resolve_site_by_slug). RLS on `organizations` requires
--    is_org_member, so the previous direct-fallback in
--    school-info.ts always returned null for anonymous callers.
--
-- 2. profiles.phone column + update_member_profile() RPC.
--    Adds a nullable text `phone` column on profiles, then
--    exposes a SECURITY DEFINER RPC gated by is_org_admin so
--    the platform Members panel can inline-edit full_name,
--    phone, and active without needing service-role from the
--    browser.
--
-- 3. ai_generation_log table for the new AI module — records
--    each server-side AI call: source, prompt category, prompt
--    length, response length, model, and owning org so the
--    admin can audit usage. RLS locks writes to service-role
--    and reads to org admins for their own rows.
-- ============================================================

-- --------------------------------------------------------------
-- 1. resolve_school_brand_by_slug
-- --------------------------------------------------------------
-- Anon-safe brand resolver. Returns null when no org matches; a
-- row otherwise. Never fails on missing website / unpublished
-- site — the school always identifies itself, even before
-- Website Studio is provisioned.
CREATE OR REPLACE FUNCTION public.resolve_school_brand_by_slug(p_slug text)
RETURNS TABLE (
  organization_id uuid,
  organization_name text,
  organization_slug text,
  logo_url text,
  status text,
  plan text
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_clean text := lower(trim(coalesce(p_slug, '')));
BEGIN
  IF v_clean = '' THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT o.id, o.name, o.slug, o.logo_url, o.status, o.plan
      FROM public.organizations o
     WHERE o.slug = v_clean
     LIMIT 1;
END $$;

REVOKE ALL ON FUNCTION public.resolve_school_brand_by_slug(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_school_brand_by_slug(text) TO anon, authenticated;

-- --------------------------------------------------------------
-- 2. profiles.phone + update_member_profile
-- --------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone text;

-- update_member_profile: gated by is_org_admin on the membership's
-- org. Allows nulling any updatable field by passing NULL for the
-- corresponding parameter; distinguishes "no change" from "clear"
-- by the presence of the p_touch_* flags.
--
-- Editable fields: full_name, phone, active.
-- Not editable here: role (system-wide profile.role) or email
-- (auth.users lives in the auth schema and rotates via a separate
-- admin flow).
CREATE OR REPLACE FUNCTION public.update_member_profile(
  p_membership_id uuid,
  p_full_name text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_active boolean DEFAULT NULL,
  p_touch_full_name boolean DEFAULT false,
  p_touch_phone boolean DEFAULT false,
  p_touch_active boolean DEFAULT false
)
RETURNS TABLE (
  user_id uuid,
  full_name text,
  phone text,
  active boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_org_id uuid;
BEGIN
  SELECT om.user_id, om.organization_id
    INTO v_user_id, v_org_id
    FROM public.org_memberships om
   WHERE om.id = p_membership_id;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Membership not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.is_org_admin(v_org_id) THEN
    RAISE EXCEPTION 'Not authorized to edit this member' USING ERRCODE = '42501';
  END IF;

  UPDATE public.profiles
     SET full_name = CASE WHEN p_touch_full_name THEN p_full_name ELSE full_name END,
         phone     = CASE WHEN p_touch_phone     THEN p_phone     ELSE phone     END,
         active    = CASE WHEN p_touch_active    THEN COALESCE(p_active, active) ELSE active END,
         updated_at = now()
   WHERE id = v_user_id
   RETURNING id, full_name, phone, active
     INTO user_id, full_name, phone, active;

  RETURN NEXT;
END $$;

REVOKE ALL ON FUNCTION public.update_member_profile(uuid, text, text, boolean, boolean, boolean, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_member_profile(uuid, text, text, boolean, boolean, boolean, boolean) TO authenticated;

-- Also expose phone in list_org_members. Recreate to preserve
-- signature but include the new column. Safe because CREATE OR
-- REPLACE with the same OUT columns fails if the row shape
-- changes; we drop and recreate.
DROP FUNCTION IF EXISTS public.list_org_members(uuid);
CREATE OR REPLACE FUNCTION public.list_org_members(p_org uuid)
RETURNS TABLE (
  membership_id uuid,
  user_id uuid,
  email text,
  full_name text,
  phone text,
  profile_role text,
  profile_active boolean,
  membership_role text,
  is_default boolean,
  active boolean,
  joined_at timestamptz,
  last_active_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_org_admin(p_org) THEN
    RAISE EXCEPTION 'Not authorized to list members of this org' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT
      om.id, om.user_id,
      u.email::text,
      p.full_name,
      p.phone,
      p.role::text AS profile_role,
      COALESCE(p.active, true) AS profile_active,
      om.role::text AS membership_role,
      om.is_default,
      COALESCE(om.active, true) AS active,
      om.joined_at,
      om.last_active_at
      FROM public.org_memberships om
      JOIN auth.users u ON u.id = om.user_id
 LEFT JOIN public.profiles p ON p.id = om.user_id
     WHERE om.organization_id = p_org
     ORDER BY p.full_name NULLS LAST, u.email;
END $$;

REVOKE ALL ON FUNCTION public.list_org_members(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_org_members(uuid) TO authenticated;

-- --------------------------------------------------------------
-- 3. AI generation log
-- --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_generation_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  source          text NOT NULL,                 -- e.g. 'report_card_comment', 'announcement', 'ai_module'
  category        text,                          -- freeform: 'tone_polish', 'draft', 'summarise'
  prompt_len      integer,
  response_len    integer,
  model           text,
  tokens_prompt   integer,
  tokens_response integer,
  error           text,                          -- non-null when the call failed
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_log_org_created ON public.ai_generation_log (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_log_source ON public.ai_generation_log (source);

ALTER TABLE public.ai_generation_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_log_org_admin_read ON public.ai_generation_log;
CREATE POLICY ai_log_org_admin_read
  ON public.ai_generation_log
  FOR SELECT
  USING (public.is_org_admin(organization_id));

-- Writes only via service-role, so no auth-level INSERT policy.
