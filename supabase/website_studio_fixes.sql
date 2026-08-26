-- ============================================================
-- WEBSITE STUDIO FIXES
--
-- Run LAST, after both website_mega_themes.sql and
-- website_studio_upgrade_migration.sql.
--
-- Fixes three defects found while auditing why a theme selection
-- never reached the public site:
--
--   1. get_public_page was defined twice with different columns.
--      website_mega_themes.sql added eyebrow / anchor_id;
--      website_studio_upgrade_migration.sql added custom theme
--      resolution but dropped eyebrow / anchor_id. Whichever ran
--      last silently removed the other's fields. This is the single
--      authoritative version with BOTH.
--
--   2. get_draft_preview did not return eyebrow / anchor_id either,
--      so the draft preview rendered sections without their labels.
--
--   3. publish_website_draft treated an empty draft as "inherit"
--      and returned ok, which made a broken publish look successful.
--      It now reports what it actually did.
--
-- Also adds apply_theme_layout(), which is what a school actually
-- means by "make my site look like that theme": switching theme
-- changes colour and type, but the section list is content and is
-- never touched automatically. This lets them opt in explicitly.
-- ============================================================

-- ==========================================================
-- 1. AUTHORITATIVE get_public_page
-- ==========================================================
-- Theme resolution order: custom theme (if set) then platform theme.
-- Section fields include eyebrow and anchor_id.
CREATE OR REPLACE FUNCTION get_public_page(p_website_id uuid, p_slug text DEFAULT '')
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_site websites;
  v_org organizations;
  v_page website_pages;
  v_theme jsonb;
  v_slug text := coalesce(trim(p_slug), '');
  v_has_custom boolean;
BEGIN
  SELECT * INTO v_site FROM websites WHERE id = p_website_id AND status = 'published';
  IF v_site.id IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO v_org FROM organizations WHERE id = v_site.organization_id;
  IF v_org.status NOT IN ('active','trial') THEN RETURN NULL; END IF;

  SELECT * INTO v_page FROM website_pages
   WHERE website_id = p_website_id AND slug = v_slug AND status = 'published'
   LIMIT 1;
  IF v_page.id IS NULL THEN
    RETURN jsonb_build_object('not_found', true);
  END IF;

  -- Custom theme wins when present. Sensitive columns are stripped:
  -- anon must never see organization_id or created_by.
  v_has_custom := false;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='websites'
               AND column_name='custom_theme_id')
     AND v_site.custom_theme_id IS NOT NULL THEN
    SELECT to_jsonb(ct) - 'organization_id' - 'created_by' - 'created_at' - 'updated_at'
      INTO v_theme
    FROM website_custom_themes ct
    WHERE ct.id = v_site.custom_theme_id;
    IF v_theme IS NOT NULL THEN v_has_custom := true; END IF;
  END IF;

  IF NOT v_has_custom THEN
    SELECT to_jsonb(t) - 'default_sections' INTO v_theme
    FROM website_themes t WHERE t.key = v_site.theme_key;
  END IF;

  RETURN jsonb_build_object(
    'site', jsonb_build_object(
      'id', v_site.id,
      'site_name', v_site.site_name,
      'tagline', v_site.tagline,
      'logo_url', v_site.logo_url,
      'favicon_url', v_site.favicon_url,
      'theme_key', v_site.theme_key,
      'brand', v_site.brand,
      'typography', v_site.typography,
      'contact', v_site.contact,
      'social', v_site.social,
      'seo', v_site.seo,
      'features', v_site.features,
      'maintenance_mode', v_site.maintenance_mode,
      'organization_id', v_site.organization_id,
      'organization_name', v_org.name
    ),
    'theme', COALESCE(v_theme, '{}'::jsonb),
    'page', jsonb_build_object(
      'id', v_page.id, 'slug', v_page.slug, 'title', v_page.title,
      'page_type', v_page.page_type, 'seo', v_page.seo
    ),
    'sections', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', s.id, 'section_type', s.section_type,
               'content', s.content, 'style', s.style,
               'eyebrow', s.eyebrow, 'anchor_id', s.anchor_id
             ) ORDER BY s.position)
      FROM website_sections s
      WHERE s.page_id = v_page.id AND s.visible = true
    ), '[]'::jsonb),
    'nav', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'label', n.label, 'menu', n.menu,
               'href', COALESCE(n.href, '/' || NULLIF(p.slug, '')),
               'new_tab', n.open_in_new_tab
             ) ORDER BY n.menu, n.position)
      FROM website_nav_items n
      LEFT JOIN website_pages p ON p.id = n.page_id
      WHERE n.website_id = p_website_id
        AND (n.page_id IS NULL OR p.status = 'published')
    ), '[]'::jsonb),
    'pages', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'slug', p2.slug,
               'label', COALESCE(NULLIF(p2.nav_label, ''), p2.title)
             ) ORDER BY p2.nav_order, p2.title)
      FROM website_pages p2
      WHERE p2.website_id = p_website_id
        AND p2.status = 'published' AND p2.show_in_nav = true
    ), '[]'::jsonb),
    'news', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'slug', nw.slug, 'title', nw.title, 'excerpt', nw.excerpt,
               'cover_image_url', nw.cover_image_url, 'category', nw.category,
               'published_at', nw.published_at
             ) ORDER BY nw.published_at DESC)
      FROM (
        SELECT * FROM website_news
        WHERE organization_id = v_site.organization_id
          AND status = 'published' AND published_at <= now()
        ORDER BY published_at DESC LIMIT 9
      ) nw
    ), '[]'::jsonb),
    'events', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'slug', ev.slug, 'title', ev.title, 'description', ev.description,
               'location', ev.location, 'starts_at', ev.starts_at,
               'ends_at', ev.ends_at, 'all_day', ev.all_day,
               'cover_image_url', ev.cover_image_url
             ) ORDER BY ev.starts_at)
      FROM (
        SELECT * FROM website_events
        WHERE organization_id = v_site.organization_id
          AND status = 'published'
          AND (ends_at IS NULL OR ends_at >= now() - interval '1 day')
        ORDER BY starts_at LIMIT 9
      ) ev
    ), '[]'::jsonb),
    'forms', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', f.id, 'key', f.key, 'name', f.name,
               'fields', f.fields, 'success_message', f.success_message
             ))
      FROM website_forms f
      WHERE f.website_id = p_website_id AND f.active = true
    ), '[]'::jsonb)
  );
END $$;

GRANT EXECUTE ON FUNCTION get_public_page(uuid, text) TO anon, authenticated;


-- ==========================================================
-- 2. DRAFT PREVIEW — same payload, draft theme applied
-- ==========================================================
-- Authenticated + org-scoped. Renders unpublished pages too, so a
-- school can preview before anything is live.
CREATE OR REPLACE FUNCTION get_draft_preview(p_website_id uuid, p_slug text DEFAULT '')
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_site websites;
  v_org organizations;
  v_page website_pages;
  v_draft record;
  v_theme jsonb;
  v_brand jsonb;
  v_typo jsonb;
  v_slug text := coalesce(trim(p_slug), '');
BEGIN
  SELECT * INTO v_site FROM websites WHERE id = p_website_id;
  IF v_site.id IS NULL THEN RETURN NULL; END IF;

  -- Tenant check: you may only preview your own school's site.
  IF v_site.organization_id <> current_user_org_id() THEN
    RAISE EXCEPTION 'Not authorized to preview this site';
  END IF;

  SELECT * INTO v_org FROM organizations WHERE id = v_site.organization_id;

  -- Draft is optional; fall back to published values.
  SELECT * INTO v_draft FROM website_drafts
   WHERE organization_id = v_site.organization_id LIMIT 1;

  v_brand := COALESCE(v_draft.brand, v_site.brand, '{}'::jsonb);
  v_typo  := COALESCE(v_draft.typography, v_site.typography, '{}'::jsonb);

  IF v_draft.custom_theme_id IS NOT NULL THEN
    SELECT to_jsonb(ct) - 'organization_id' - 'created_by' - 'created_at' - 'updated_at'
      INTO v_theme
    FROM website_custom_themes ct WHERE ct.id = v_draft.custom_theme_id;
  ELSIF v_draft.theme_key IS NOT NULL THEN
    SELECT to_jsonb(t) - 'default_sections' INTO v_theme
    FROM website_themes t WHERE t.key = v_draft.theme_key;
  END IF;

  -- No draft theme chosen: show what is published.
  IF v_theme IS NULL THEN
    IF v_site.custom_theme_id IS NOT NULL THEN
      SELECT to_jsonb(ct) - 'organization_id' - 'created_by' - 'created_at' - 'updated_at'
        INTO v_theme
      FROM website_custom_themes ct WHERE ct.id = v_site.custom_theme_id;
    END IF;
    IF v_theme IS NULL THEN
      SELECT to_jsonb(t) - 'default_sections' INTO v_theme
      FROM website_themes t WHERE t.key = v_site.theme_key;
    END IF;
  END IF;

  -- Preview includes DRAFT pages, unlike the public function.
  SELECT * INTO v_page FROM website_pages
   WHERE website_id = p_website_id AND slug = v_slug LIMIT 1;
  IF v_page.id IS NULL THEN
    RETURN jsonb_build_object('not_found', true);
  END IF;

  RETURN jsonb_build_object(
    'site', jsonb_build_object(
      'id', v_site.id,
      'site_name', v_site.site_name,
      'tagline', v_site.tagline,
      'logo_url', v_site.logo_url,
      'favicon_url', v_site.favicon_url,
      'theme_key', COALESCE(v_draft.theme_key, v_site.theme_key),
      'brand', v_brand,
      'typography', v_typo,
      'contact', v_site.contact,
      'social', v_site.social,
      'seo', v_site.seo,
      'features', v_site.features,
      'maintenance_mode', v_site.maintenance_mode,
      'organization_id', v_site.organization_id,
      'organization_name', v_org.name
    ),
    'theme', COALESCE(v_theme, '{}'::jsonb),
    'page', jsonb_build_object(
      'id', v_page.id, 'slug', v_page.slug, 'title', v_page.title,
      'page_type', v_page.page_type, 'seo', v_page.seo
    ),
    'sections', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', s.id, 'section_type', s.section_type,
               'content', s.content, 'style', s.style,
               'eyebrow', s.eyebrow, 'anchor_id', s.anchor_id
             ) ORDER BY s.position)
      FROM website_sections s
      WHERE s.page_id = v_page.id AND s.visible = true
    ), '[]'::jsonb),
    'nav', '[]'::jsonb,
    'pages', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'slug', p2.slug,
               'label', COALESCE(NULLIF(p2.nav_label, ''), p2.title)
             ) ORDER BY p2.nav_order, p2.title)
      FROM website_pages p2
      WHERE p2.website_id = p_website_id AND p2.show_in_nav = true
    ), '[]'::jsonb),
    'news', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'slug', nw.slug, 'title', nw.title, 'excerpt', nw.excerpt,
               'cover_image_url', nw.cover_image_url, 'category', nw.category,
               'published_at', nw.published_at
             ) ORDER BY nw.published_at DESC NULLS LAST)
      FROM (
        SELECT * FROM website_news
        WHERE organization_id = v_site.organization_id
        ORDER BY published_at DESC NULLS LAST LIMIT 9
      ) nw
    ), '[]'::jsonb),
    'events', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'slug', ev.slug, 'title', ev.title, 'description', ev.description,
               'location', ev.location, 'starts_at', ev.starts_at,
               'ends_at', ev.ends_at, 'all_day', ev.all_day,
               'cover_image_url', ev.cover_image_url
             ) ORDER BY ev.starts_at)
      FROM (
        SELECT * FROM website_events
        WHERE organization_id = v_site.organization_id
        ORDER BY starts_at LIMIT 9
      ) ev
    ), '[]'::jsonb),
    'forms', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', f.id, 'key', f.key, 'name', f.name,
               'fields', f.fields, 'success_message', f.success_message
             ))
      FROM website_forms f
      WHERE f.website_id = p_website_id AND f.active = true
    ), '[]'::jsonb)
  );
END $$;

GRANT EXECUTE ON FUNCTION get_draft_preview(uuid, text) TO authenticated;


-- ==========================================================
-- 3. APPLY A THEME'S RECOMMENDED LAYOUT
-- ==========================================================
-- Switching theme changes colour and type only — the section list is
-- content and must never be silently rewritten. But "make my site
-- look like that theme" usually means the layout too, so this is the
-- explicit opt-in.
--
-- Snapshots first, so it is undoable from History.
CREATE OR REPLACE FUNCTION apply_theme_layout(
  p_theme_key text,
  p_page_slug text DEFAULT '',
  p_mode text DEFAULT 'append'   -- 'append' | 'replace'
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org uuid := current_user_org_id();
  v_site uuid;
  v_site_name text;
  v_page uuid;
  v_theme website_themes;
  v_sec text;
  v_pos integer := 0;
  v_added integer := 0;
  v_existing text[];
BEGIN
  IF v_org IS NULL THEN RAISE EXCEPTION 'No organization context'; END IF;
  IF NOT is_org_admin(v_org) THEN
    RAISE EXCEPTION 'Only a school administrator can change the page layout';
  END IF;

  SELECT id, site_name INTO v_site, v_site_name
  FROM websites WHERE organization_id = v_org;
  IF v_site IS NULL THEN RAISE EXCEPTION 'No website found'; END IF;

  SELECT * INTO v_theme FROM website_themes WHERE key = p_theme_key;
  IF v_theme.key IS NULL THEN RAISE EXCEPTION 'Unknown theme %', p_theme_key; END IF;

  SELECT id INTO v_page FROM website_pages
   WHERE website_id = v_site AND slug = coalesce(trim(p_page_slug), '');
  IF v_page IS NULL THEN RAISE EXCEPTION 'Page not found'; END IF;

  PERFORM snapshot_website(format('Before applying %s layout', v_theme.name));

  IF p_mode = 'replace' THEN
    DELETE FROM website_sections WHERE page_id = v_page;
    v_existing := ARRAY[]::text[];
  ELSE
    -- Append mode: only add block types the page does not already have,
    -- so running this twice is harmless.
    SELECT COALESCE(array_agg(DISTINCT section_type), ARRAY[]::text[])
      INTO v_existing
    FROM website_sections WHERE page_id = v_page;
  END IF;

  SELECT COALESCE(max(position), 0) INTO v_pos
  FROM website_sections WHERE page_id = v_page;

  FOR v_sec IN SELECT jsonb_array_elements_text(v_theme.default_sections) LOOP
    CONTINUE WHEN v_sec = ANY(v_existing);
    v_pos := v_pos + 1;
    v_added := v_added + 1;
    INSERT INTO website_sections (
      organization_id, website_id, page_id, section_type, position, content)
    VALUES (
      v_org, v_site, v_page, v_sec, v_pos,
      default_section_content(v_sec, COALESCE(v_site_name, 'Our School')));
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'theme', v_theme.name,
    'sections_added', v_added,
    'mode', p_mode
  );
END $$;

GRANT EXECUTE ON FUNCTION apply_theme_layout(text, text, text) TO authenticated;


-- ==========================================================
-- 4. HONEST PUBLISH RESULT
-- ==========================================================
-- The old version returned ok for an empty draft, which made a
-- broken publish look successful. It now says what changed.
CREATE OR REPLACE FUNCTION publish_website_draft()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org uuid := current_user_org_id();
  v_draft record;
  v_site websites;
  v_changed text[] := ARRAY[]::text[];
BEGIN
  IF v_org IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No organization context');
  END IF;
  IF NOT is_org_admin(v_org) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Only a school administrator can publish');
  END IF;

  SELECT * INTO v_site FROM websites WHERE organization_id = v_org;
  IF v_site.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No website to publish');
  END IF;

  SELECT * INTO v_draft FROM website_drafts WHERE organization_id = v_org;
  IF v_draft.organization_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error',
      'There is nothing to publish. Make a change first.');
  END IF;

  -- Work out what genuinely differs before writing.
  IF v_draft.custom_theme_id IS DISTINCT FROM v_site.custom_theme_id THEN
    v_changed := array_append(v_changed, 'custom theme');
  END IF;
  IF v_draft.theme_key IS NOT NULL
     AND v_draft.theme_key IS DISTINCT FROM v_site.theme_key THEN
    v_changed := array_append(v_changed, 'theme');
  END IF;
  IF COALESCE(v_draft.brand, '{}'::jsonb) IS DISTINCT FROM COALESCE(v_site.brand, '{}'::jsonb) THEN
    v_changed := array_append(v_changed, 'brand overrides');
  END IF;
  IF COALESCE(v_draft.typography, '{}'::jsonb) IS DISTINCT FROM COALESCE(v_site.typography, '{}'::jsonb) THEN
    v_changed := array_append(v_changed, 'typography');
  END IF;

  IF array_length(v_changed, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'no_changes', true,
      'message', 'The draft already matches the live site.');
  END IF;

  PERFORM snapshot_website('Before publishing theme');

  UPDATE websites SET
    -- theme_key stays as a fallback when a custom theme is chosen.
    theme_key       = COALESCE(v_draft.theme_key, theme_key),
    custom_theme_id = v_draft.custom_theme_id,
    brand           = COALESCE(v_draft.brand, '{}'::jsonb),
    typography      = COALESCE(v_draft.typography, '{}'::jsonb),
    updated_at      = now()
  WHERE organization_id = v_org;

  -- Keep the draft, aligned to what is now published.
  UPDATE website_drafts SET
    theme_key       = (SELECT theme_key FROM websites WHERE organization_id = v_org),
    custom_theme_id = (SELECT custom_theme_id FROM websites WHERE organization_id = v_org),
    brand           = (SELECT brand FROM websites WHERE organization_id = v_org),
    typography      = (SELECT typography FROM websites WHERE organization_id = v_org),
    published_at    = now()
  WHERE organization_id = v_org;

  RETURN jsonb_build_object(
    'ok', true,
    'changed', to_jsonb(v_changed),
    'message', format('Published: %s.', array_to_string(v_changed, ', '))
  );
END $$;

GRANT EXECUTE ON FUNCTION publish_website_draft() TO authenticated;


-- ==========================================================
-- 5. VERIFY
-- ==========================================================
-- Both should report true.
SELECT
  (SELECT count(*) FROM pg_proc WHERE proname = 'get_public_page') = 1
    AS single_get_public_page,
  EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.proname = 'get_public_page'
      AND pg_get_functiondef(p.oid) LIKE '%anchor_id%'
  ) AS returns_anchor_id,
  EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.proname = 'get_public_page'
      AND pg_get_functiondef(p.oid) LIKE '%custom_theme%'
  ) AS resolves_custom_theme,
  EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'apply_theme_layout')
    AS has_apply_theme_layout;
