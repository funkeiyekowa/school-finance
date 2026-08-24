-- ============================================================
-- WEBSITE STUDIO UPGRADE — ROLLBACK
-- Reverses supabase/website_studio_upgrade_migration.sql.
-- Run this in the Supabase SQL Editor to undo all changes.
--
-- IMPORTANT: This will drop all draft data and custom themes.
-- Published sites will continue to work via theme_key (the original path).
-- ============================================================

-- 1. Revoke grants and drop new RPCs
REVOKE EXECUTE ON FUNCTION save_website_draft(text, uuid, jsonb, jsonb) FROM authenticated;
DROP FUNCTION IF EXISTS save_website_draft(text, uuid, jsonb, jsonb);

REVOKE EXECUTE ON FUNCTION discard_website_draft() FROM authenticated;
DROP FUNCTION IF EXISTS discard_website_draft();

REVOKE EXECUTE ON FUNCTION publish_website_draft() FROM authenticated;
DROP FUNCTION IF EXISTS publish_website_draft();

REVOKE EXECUTE ON FUNCTION get_draft_preview(uuid, text) FROM authenticated;
DROP FUNCTION IF EXISTS get_draft_preview(uuid, text);

-- 2. Drop drafts table (RLS policies cascade with the table)
DROP TABLE IF EXISTS website_drafts;

-- 3. Remove custom_theme_id from websites
ALTER TABLE websites DROP COLUMN IF EXISTS custom_theme_id;

-- 4. Drop custom themes table
DROP TRIGGER IF EXISTS trg_touch_website_custom_themes ON website_custom_themes;
DROP TABLE IF EXISTS website_custom_themes;

-- 5. Remove category column from themes
ALTER TABLE website_themes DROP COLUMN IF EXISTS category;

-- 6. Restore original get_public_page (without custom theme support)
-- The original version is in website_module.sql. Re-run that function
-- definition from website_module.sql section 16 to restore it, or:
CREATE OR REPLACE FUNCTION get_public_page(p_website_id uuid, p_slug text DEFAULT '')
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_site websites;
  v_org organizations;
  v_page website_pages;
  v_theme website_themes;
  v_slug text := coalesce(trim(p_slug), '');
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

  SELECT * INTO v_theme FROM website_themes WHERE key = v_site.theme_key;

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
    'theme', COALESCE(to_jsonb(v_theme) - 'default_sections', '{}'::jsonb),
    'page', jsonb_build_object(
      'id', v_page.id, 'slug', v_page.slug, 'title', v_page.title,
      'page_type', v_page.page_type, 'seo', v_page.seo
    ),
    'sections', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', s.id, 'section_type', s.section_type,
               'content', s.content, 'style', s.style
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
