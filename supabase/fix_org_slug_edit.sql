-- ============================================================
-- FIX: editing an existing school's slug from platform admin
-- had zero normalization or uniqueness check, unlike creating a
-- new school (provision_organization already slugifies + dedupes).
--
-- Symptom this caused: an admin edits a school's slug via
-- Dashboard -> Platform -> School details and types e.g.
-- "Greenfield Academy" instead of "greenfield-academy". The raw
-- value was saved as-is. Every login/lookup path
-- (resolve_school_brand_by_slug, resolve_site_by_slug,
-- resolve_login_context) matches with `slug = lower(trim(p_slug))`
-- only - it does not re-slugify - so a slug containing spaces,
-- uppercase letters, or punctuation stored via the edit path can
-- never match the URL people are actually sent to. That reproduces
-- the exact "school not found" bug the create path already avoids.
--
-- Fix: route slug (and general org field) edits through a new
-- SECURITY DEFINER RPC that applies the SAME canonicalization
-- provision_organization uses, checks uniqueness (excluding the
-- row being edited), and raises a distinct, catchable error on
-- collision instead of silently mutating the admin's chosen slug
-- (silent-suffix, as the create path does on collision, would be
-- confusing on an intentional edit - the admin would believe the
-- slug is X when it actually saved as X-a1b2).
--
-- Run order: after saas_foundation.sql (needs is_org_admin(),
-- organizations table) and upgrades_2026_08.sql (not a hard
-- dependency, just keeps these together chronologically).
-- Idempotent, safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_organization(
  p_org uuid,
  p_name text,
  p_slug text,
  p_email text DEFAULT NULL,
  p_plan text DEFAULT NULL,
  p_status text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_slug text;
BEGIN
  IF NOT is_org_admin(p_org) THEN
    RAISE EXCEPTION 'Not authorized to edit this school' USING ERRCODE = '42501';
  END IF;
  IF p_name IS NULL OR trim(p_name) = '' THEN
    RAISE EXCEPTION 'Organization name is required';
  END IF;

  -- Same canonicalization as provision_organization: strip everything
  -- but letters/digits to hyphens, lowercase, trim leading/trailing
  -- hyphens. This guarantees the stored slug is already exactly what
  -- resolve_school_brand_by_slug / resolve_site_by_slug /
  -- resolve_login_context will look up (they only lower(trim(...)),
  -- they do not re-slugify), so a normalized slug always matches.
  v_slug := lower(regexp_replace(COALESCE(NULLIF(trim(p_slug), ''), p_name), '[^a-zA-Z0-9]+', '-', 'g'));
  v_slug := trim(both '-' from v_slug);

  IF v_slug = '' THEN
    RAISE EXCEPTION 'Slug must contain at least one letter or number';
  END IF;

  IF EXISTS (SELECT 1 FROM organizations WHERE slug = v_slug AND id <> p_org) THEN
    -- Distinct SQLSTATE so the client can show a specific, actionable
    -- message ("that slug is taken") instead of a generic DB error.
    RAISE EXCEPTION 'Slug "%" is already used by another school', v_slug
      USING ERRCODE = '23505', DETAIL = v_slug;
  END IF;

  UPDATE organizations SET
    name = trim(p_name),
    slug = v_slug,
    email = NULLIF(trim(COALESCE(p_email, '')), ''),
    plan = COALESCE(p_plan, plan),
    status = COALESCE(p_status, status),
    updated_at = now()
  WHERE id = p_org;

  RETURN jsonb_build_object('ok', true, 'organization_id', p_org, 'slug', v_slug);
END $$;

REVOKE ALL ON FUNCTION public.update_organization(uuid, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_organization(uuid, text, text, text, text, text) TO authenticated;

-- VERIFY
-- Re-saving a school with its own unchanged slug must succeed (excludes self):
--   SELECT update_organization('<org-id>', 'Some School', 'some-school');
-- Attempting to reuse another school's slug must raise SQLSTATE 23505:
--   SELECT update_organization('<org-id>', 'Some School', '<some-other-orgs-slug>');
-- A messy slug must come back canonicalized:
--   SELECT update_organization('<org-id>', 'Some School', 'Some  Weird SLUG!!');
--   -- -> slug: 'some-weird-slug'
