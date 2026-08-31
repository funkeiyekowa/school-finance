-- ============================================================
-- FIX: new schools had no public website until a human admin
-- opened Website Studio and explicitly created one — which is why
-- Olly Schools and Flotual Schools (created, never opened Website
-- Studio) showed "This school hasn't set up its public website
-- yet." at /s/<slug> while Grant Schools (someone built + published
-- a site for it) worked fine. Per explicit request: every new
-- school created should have a website created for it automatically.
--
-- This migration:
--   1. Splits provision_website()'s body (the "build a full starter
--      site from a theme" logic — unchanged, still in
--      website_module.sql) into an internal helper,
--      provision_website_unchecked(), identical except it has no
--      is_org_admin() gate and can optionally publish immediately.
--      Needed because the normal provision_website() requires the
--      CALLER to be an admin of that org — fine when a human clicks
--      "create my website" in Website Studio, but wrong both for (a)
--      provision_organization(), called by a platform admin who is
--      creating the org itself and is not yet "an admin of it" in
--      the org_memberships sense at that exact instant, purely by
--      is_platform_admin()'s OR-clause this actually already passes,
--      and (b) the one-time backfill below, run directly in the SQL
--      editor with no auth.uid() at all, which would otherwise be
--      rejected outright.
--   2. Redefines provision_website() as a thin wrapper around the
--      unchecked version, keeping its admin check and its exact
--      current behavior (creates a DRAFT site) — Website Studio's
--      own "create website" flow is completely unaffected.
--   3. Redefines provision_organization() with one new line: after
--      seeding an org's defaults, it now also builds AND PUBLISHES a
--      complete starter site, so a brand-new school is immediately
--      viewable at /s/<slug> instead of showing "not available".
--   4. Backfills every EXISTING organization that has no `websites`
--      row yet (this is what actually fixes Olly Schools and Flotual
--      Schools) — builds and publishes the same starter site for
--      each. Idempotent: an org that already has a website (of any
--      status — draft, published, whatever an admin set) is left
--      completely untouched, both on backfill and on every re-run of
--      this file.
--
-- Run order: after saas_foundation.sql (defines provision_organization,
-- is_org_admin) and website_module.sql (defines provision_website,
-- the websites table, website_themes). Idempotent, safe to re-run.
-- ============================================================

-- --------------------------------------------------------------
-- 1. Internal helper: same site-building logic as provision_website,
--    minus the admin-identity check, plus an immediate-publish option.
-- --------------------------------------------------------------
CREATE OR REPLACE FUNCTION provision_website_unchecked(
  p_org uuid,
  p_theme text DEFAULT 'modern-academy',
  p_publish boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org uuid := p_org;
  v_site uuid;
  v_page uuid;
  v_org_name text;
  v_slug text;
  v_theme website_themes;
  v_sec text;
  v_pos integer := 0;
BEGIN
  IF v_org IS NULL THEN RAISE EXCEPTION 'No organization context'; END IF;

  SELECT name, slug INTO v_org_name, v_slug FROM organizations WHERE id = v_org;
  SELECT * INTO v_theme FROM website_themes WHERE key = p_theme AND active = true;
  IF v_theme.key IS NULL THEN
    SELECT * INTO v_theme FROM website_themes WHERE active = true ORDER BY sort_order LIMIT 1;
  END IF;

  SELECT id INTO v_site FROM websites WHERE organization_id = v_org;
  IF v_site IS NOT NULL THEN
    -- Never touch an org's existing site (draft, published, or
    -- otherwise) — this call only ever fills a genuine gap.
    RETURN jsonb_build_object('ok', true, 'website_id', v_site, 'created', false);
  END IF;

  INSERT INTO websites (organization_id, theme_key, site_name, tagline, subdomain, status)
  VALUES (
    v_org, v_theme.key, COALESCE(v_org_name, 'Our School'),
    'Educating with excellence',
    CASE WHEN EXISTS (SELECT 1 FROM websites WHERE subdomain = v_slug)
         THEN v_slug || '-' || substr(md5(random()::text), 1, 4)
         ELSE v_slug END,
    'draft'
  )
  RETURNING id INTO v_site;

  INSERT INTO website_pages (organization_id, website_id, slug, title, status, show_in_nav, nav_order, nav_label)
  VALUES (v_org, v_site, '', 'Home', 'published', true, 0, 'Home')
  RETURNING id INTO v_page;

  FOR v_sec IN SELECT jsonb_array_elements_text(v_theme.default_sections) LOOP
    v_pos := v_pos + 1;
    INSERT INTO website_sections (organization_id, website_id, page_id, section_type, position, content)
    VALUES (v_org, v_site, v_page, v_sec, v_pos, default_section_content(v_sec, COALESCE(v_org_name, 'Our School')));
  END LOOP;

  INSERT INTO website_pages (organization_id, website_id, slug, title, page_type, status, show_in_nav, nav_order, nav_label)
  VALUES
    (v_org, v_site, 'about',      'About Us',   'standard',    'published', true, 1, 'About'),
    (v_org, v_site, 'admissions', 'Admissions', 'standard',    'published', true, 2, 'Admissions'),
    (v_org, v_site, 'news',       'News',       'news_index',  'published', true, 3, 'News'),
    (v_org, v_site, 'events',     'Events',     'event_index', 'published', true, 4, 'Events'),
    (v_org, v_site, 'contact',    'Contact',    'contact',     'published', true, 5, 'Contact')
  ON CONFLICT (website_id, slug) DO NOTHING;

  INSERT INTO website_sections (organization_id, website_id, page_id, section_type, position, content)
  SELECT v_org, v_site, p.id, 'page_header', 0,
         jsonb_build_object('heading', p.title, 'subheading', '')
  FROM website_pages p WHERE p.website_id = v_site AND p.slug IN ('about','admissions');

  INSERT INTO website_sections (organization_id, website_id, page_id, section_type, position, content)
  SELECT v_org, v_site, p.id, 'about', 1,
         default_section_content('about', COALESCE(v_org_name, 'Our School'))
  FROM website_pages p WHERE p.website_id = v_site AND p.slug = 'about';

  INSERT INTO website_sections (organization_id, website_id, page_id, section_type, position, content)
  SELECT v_org, v_site, p.id, 'admissions_cta', 1,
         default_section_content('admissions_cta', COALESCE(v_org_name, 'Our School'))
  FROM website_pages p WHERE p.website_id = v_site AND p.slug = 'admissions';

  INSERT INTO website_forms (organization_id, website_id, key, name, destination, fields)
  VALUES (v_org, v_site, 'contact', 'Contact Us', 'enquiry',
    '[
      {"name":"name","label":"Your name","type":"text","required":true},
      {"name":"email","label":"Email","type":"email","required":true},
      {"name":"phone","label":"Phone","type":"tel","required":false},
      {"name":"subject","label":"Subject","type":"text","required":false},
      {"name":"message","label":"Message","type":"textarea","required":true}
    ]'::jsonb)
  ON CONFLICT (website_id, key) DO NOTHING;

  INSERT INTO website_forms (organization_id, website_id, key, name, destination, fields)
  VALUES (v_org, v_site, 'admissions', 'Admission Enquiry', 'admission',
    '[
      {"name":"name","label":"Parent or guardian name","type":"text","required":true},
      {"name":"email","label":"Email","type":"email","required":true},
      {"name":"phone","label":"Phone","type":"tel","required":true},
      {"name":"child_name","label":"Child''s name","type":"text","required":true},
      {"name":"class_applying","label":"Class applying for","type":"text","required":true},
      {"name":"message","label":"Anything else we should know","type":"textarea","required":false}
    ]'::jsonb)
  ON CONFLICT (website_id, key) DO NOTHING;

  IF p_publish THEN
    UPDATE websites SET status = 'published' WHERE id = v_site;
  END IF;

  RETURN jsonb_build_object('ok', true, 'website_id', v_site, 'created', true, 'theme', v_theme.key, 'published', p_publish);
END $$;

-- Never grant this directly — only callable from inside another
-- SECURITY DEFINER function (provision_website, provision_organization,
-- or this file's own backfill block), which is exactly the point: it
-- has no identity check of its own, so a regular user must go through
-- provision_website()'s admin gate to reach it.
REVOKE ALL ON FUNCTION provision_website_unchecked(uuid, text, boolean) FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------
-- 2. provision_website(): unchanged signature, unchanged behavior
--    (still admin-gated, still creates a DRAFT) — now just a thin
--    wrapper so Website Studio's existing "create my website" flow
--    is byte-for-byte identical to before this migration.
-- --------------------------------------------------------------
CREATE OR REPLACE FUNCTION provision_website(
  p_org uuid DEFAULT NULL,
  p_theme text DEFAULT 'modern-academy'
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org uuid := COALESCE(p_org, current_user_org_id());
BEGIN
  IF v_org IS NULL THEN RAISE EXCEPTION 'No organization context'; END IF;
  IF NOT is_org_admin(v_org) THEN
    RAISE EXCEPTION 'Only a school administrator can create the website';
  END IF;
  RETURN provision_website_unchecked(v_org, p_theme, false);
END $$;

GRANT EXECUTE ON FUNCTION provision_website(uuid, text) TO authenticated;

-- --------------------------------------------------------------
-- 3. provision_organization(): same as saas_foundation.sql, plus one
--    new line building AND PUBLISHING a starter site for the new org.
-- --------------------------------------------------------------
CREATE OR REPLACE FUNCTION provision_organization(
  p_name text,
  p_slug text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_plan text DEFAULT 'starter',
  p_status text DEFAULT 'trial',
  p_owner_email text DEFAULT NULL,
  p_modules text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_slug text;
  v_owner uuid;
  v_owner_note text := NULL;
  v_mod text;
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Platform admin access required';
  END IF;
  IF p_name IS NULL OR trim(p_name) = '' THEN
    RAISE EXCEPTION 'Organization name is required';
  END IF;

  v_slug := lower(regexp_replace(COALESCE(NULLIF(trim(p_slug), ''), p_name), '[^a-zA-Z0-9]+', '-', 'g'));
  v_slug := trim(both '-' from v_slug);
  IF EXISTS (SELECT 1 FROM organizations WHERE slug = v_slug) THEN
    v_slug := v_slug || '-' || substr(md5(random()::text), 1, 4);
  END IF;

  INSERT INTO organizations (name, slug, email, plan, status)
  VALUES (trim(p_name), v_slug, NULLIF(trim(COALESCE(p_email, '')), ''), p_plan, p_status)
  RETURNING id INTO v_org;

  PERFORM seed_org_defaults(v_org);

  -- Every new school gets a real, immediately-viewable public website
  -- from the default theme — no separate Website Studio step required
  -- before /s/<slug> shows something real. The school can still fully
  -- customize or re-theme it afterward; this only fills the gap of it
  -- not existing at all.
  PERFORM provision_website_unchecked(v_org, 'modern-academy', true);

  -- Optional extra modules beyond core
  IF p_modules IS NOT NULL THEN
    FOREACH v_mod IN ARRAY p_modules LOOP
      IF EXISTS (SELECT 1 FROM platform_modules WHERE key = v_mod) THEN
        INSERT INTO subscriptions (organization_id, module_key, status)
        VALUES (v_org, v_mod, 'active')
        ON CONFLICT (organization_id, module_key) DO UPDATE SET status = 'active';
      END IF;
    END LOOP;
  END IF;

  -- Optional owner assignment
  IF p_owner_email IS NOT NULL AND trim(p_owner_email) <> '' THEN
    SELECT id INTO v_owner FROM auth.users WHERE lower(email) = lower(trim(p_owner_email)) LIMIT 1;
    IF v_owner IS NULL THEN
      v_owner_note := format('No account found for %s — the school was created, but assign an owner once they sign up.', p_owner_email);
    ELSE
      INSERT INTO org_memberships (user_id, organization_id, role, is_default, active, invited_by, invited_at)
      VALUES (v_owner, v_org, 'owner', false, true, auth.uid(), now())
      ON CONFLICT (user_id, organization_id) DO UPDATE SET role = 'owner', active = true;
      IF NOT EXISTS (SELECT 1 FROM org_memberships WHERE user_id = v_owner AND is_default = true) THEN
        UPDATE org_memberships SET is_default = true
        WHERE user_id = v_owner AND organization_id = v_org;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'organization_id', v_org, 'slug', v_slug, 'notice', v_owner_note
  );
END $$;

GRANT EXECUTE ON FUNCTION provision_organization(text, text, text, text, text, text, text[]) TO authenticated;

-- --------------------------------------------------------------
-- 4. Backfill: give every EXISTING organization with no website yet
--    the same starter site, published. This is what actually fixes
--    Olly Schools and Flotual Schools (and any other pre-existing
--    school in the same state) the moment this file is run.
--    Organizations that already have a website row — any status —
--    are completely untouched.
-- --------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT o.id, o.name FROM organizations o
    WHERE NOT EXISTS (SELECT 1 FROM websites w WHERE w.organization_id = o.id)
  LOOP
    PERFORM provision_website_unchecked(r.id, 'modern-academy', true);
  END LOOP;
END $$;

-- VERIFY
-- Every organization should now have a website row:
--   SELECT o.name, o.slug, w.id AS website_id, w.status
--   FROM organizations o LEFT JOIN websites w ON w.organization_id = o.id
--   ORDER BY o.name;
-- Olly Schools / Flotual Schools specifically should show status = 'published':
--   SELECT o.name, w.status FROM organizations o
--   JOIN websites w ON w.organization_id = o.id
--   WHERE o.slug IN ('olly-schools', 'flotual-schools');
