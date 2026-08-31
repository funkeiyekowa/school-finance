-- ============================================================
-- FIX: /s/<slug> shows a generic "This website is not available"
-- for a school that simply hasn't set up Website Studio yet.
--
-- SYMPTOM this fixes: two real, active schools (their /s/<slug>/login
-- page resolves their name correctly via resolve_school_brand_by_slug)
-- show a bare, unhelpful "This website is not available." at their
-- public site root, identical to what a completely nonexistent slug
-- would show — because resolve_site_by_slug() previously collapsed
-- two very different situations into the exact same bare
-- {"found": false} response:
--   1. No organization matches this slug at all (a true 404).
--   2. The organization exists and is perfectly fine, it just has no
--      `websites` row yet — nobody has opened Website Studio for it.
-- Case 2 already has sibling cases with clear, actionable messages
-- ("This website has not been published yet." for a website that
-- exists but isn't published; "This school's account is not
-- currently active." for a suspended org) — this migration gives
-- case 2 the same treatment: a distinct reason ('no_website') instead
-- of silently looking identical to "no such school".
--
-- This does NOT touch resolve_school_brand_by_slug (login continues
-- to work exactly as it already does) or resolve_site_by_host
-- (custom-domain lookup has no org context until a site already
-- matches, so there's nothing to disambiguate there).
--
-- Run order: after website_module.sql (defines resolve_site_by_slug).
-- Idempotent, safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION resolve_site_by_slug(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_site websites;
  v_org organizations;
BEGIN
  SELECT o.* INTO v_org FROM organizations o WHERE o.slug = lower(trim(p_slug));
  IF v_org.id IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO v_site FROM websites WHERE organization_id = v_org.id;
  IF v_site.id IS NULL THEN
    -- The org is real — only its public website was never set up.
    -- Distinct from "no such school" so the UI can say so plainly.
    RETURN jsonb_build_object(
      'found', true,
      'available', false,
      'reason', 'no_website',
      'organization_id', v_org.id,
      'organization_name', v_org.name,
      'organization_slug', v_org.slug
    );
  END IF;

  IF v_org.status NOT IN ('active','trial') THEN
    RETURN jsonb_build_object('found', true, 'available', false, 'reason', 'org_' || v_org.status);
  END IF;
  IF v_site.status <> 'published' THEN
    RETURN jsonb_build_object('found', true, 'available', false, 'reason', 'unpublished');
  END IF;

  RETURN jsonb_build_object(
    'found', true, 'available', true,
    'organization_id', v_org.id,
    'organization_name', v_org.name,
    'organization_slug', v_org.slug,
    'website_id', v_site.id,
    'maintenance_mode', v_site.maintenance_mode
  );
END $$;

GRANT EXECUTE ON FUNCTION resolve_site_by_slug(text) TO anon, authenticated;

-- VERIFY
-- A slug for an org with no websites row must now come back as:
--   found=true, available=false, reason='no_website' (not a bare found=false)
--   SELECT resolve_site_by_slug('olly-schools');
--   SELECT resolve_site_by_slug('flotual-schools');
-- A slug that matches no organization at all must still return NULL:
--   SELECT resolve_site_by_slug('no-such-school-at-all');
-- A published site must be unaffected:
--   SELECT resolve_site_by_slug('grant-schools');
