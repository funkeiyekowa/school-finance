-- ============================================================
-- WEBSITE STUDIO UPGRADE — DRAFT/PUBLISH + CUSTOM THEMES
-- Run AFTER website_module.sql.
--
-- This migration adds:
--   1. A category column to the theme catalogue for gallery filtering.
--   2. A custom_themes table (per-organization, RLS-scoped).
--   3. A custom_theme_id column on the websites table.
--   4. A website_drafts table isolating unpublished edits from the live site.
--   5. RPCs: save_website_draft, get_draft_preview, publish_website_draft,
--      discard_website_draft.
--   6. An updated get_public_page that supports custom themes.
--
-- Design invariants:
--   - The published public site always reads from websites.theme_key or
--     websites.custom_theme_id. Draft state is invisible to anonymous visitors.
--   - Every mutation uses current_user_org_id(). No client-supplied org IDs
--     are trusted.
--   - publish_website_draft is atomic: validate → snapshot → promote → retain.
--   - Theme source exclusivity: at most one of theme_key / custom_theme_id
--     can be non-null (enforced by CHECK constraint and RPC logic).
--   - Draft is retained after publish (updated to match promoted state) so
--     the studio always has a working draft row. Discard resets to published.
--   - Rollback script: supabase/website_studio_upgrade_rollback.sql
--
-- Security posture:
--   - All SECURITY DEFINER RPCs use SET search_path = pg_catalog, public.
--   - EXECUTE is explicitly REVOKEd from PUBLIC on every new RPC, then
--     GRANTed only to the intended role.
--   - No new anonymous (anon) grants are introduced.
--   - get_public_page retains its existing anon grant (unchanged scope).
--   - Custom themes are NOT directly readable by anon — the SECURITY DEFINER
--     get_public_page reads them internally and returns only sanitized tokens.
-- ============================================================

-- ==========================================================
-- 1. THEME CATEGORIES
-- ==========================================================
ALTER TABLE website_themes ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'general';

UPDATE website_themes SET category = 'modern'    WHERE key = 'modern-academy';
UPDATE website_themes SET category = 'classic'   WHERE key = 'classic-excellence';
UPDATE website_themes SET category = 'bold'      WHERE key = 'future-school';
UPDATE website_themes SET category = 'minimal'   WHERE key = 'international-minimal';
UPDATE website_themes SET category = 'community' WHERE key = 'community-faith';

-- ==========================================================
-- 2. CUSTOM THEMES (per-organization)
-- ==========================================================
CREATE TABLE IF NOT EXISTS website_custom_themes (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  description     text,
  tokens          jsonb NOT NULL DEFAULT '{}',
  based_on        text,  -- informational: which platform theme was the starting point
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_custom_themes_org
  ON website_custom_themes(organization_id);

-- updated_at trigger
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_touch_website_custom_themes'
  ) THEN
    CREATE TRIGGER trg_touch_website_custom_themes
      BEFORE UPDATE ON website_custom_themes
      FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
  END IF;
END $$;

-- ==========================================================
-- 3. CUSTOM THEME REFERENCE ON WEBSITES
-- ==========================================================
-- When set, this overrides theme_key as the token source for the published site.
ALTER TABLE websites ADD COLUMN IF NOT EXISTS custom_theme_id uuid
  REFERENCES website_custom_themes(id) ON DELETE SET NULL;

-- Exclusivity: a published site uses at most one theme source.
-- (theme_key has a NOT NULL default so it is always set; custom_theme_id
-- overrides it when non-null. No constraint needed on websites itself —
-- the semantics are: custom_theme_id wins when present, else theme_key.)

-- ==========================================================
-- 4. WEBSITE DRAFTS
-- ==========================================================
-- Exactly one draft row per organization. Holds the in-progress theme/brand/
-- typography edits. The live public site reads exclusively from the websites
-- table, never from here.
--
-- After a successful publish, the draft is RETAINED and updated to match the
-- published state (not deleted). This ensures:
--   - The studio always has a draft row to write to.
--   - "Has unpublished changes" = compare draft vs published.
--   - Discard = reset draft to match currently published config.
CREATE TABLE IF NOT EXISTS website_drafts (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  website_id      uuid NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  -- Theme selection: AT MOST ONE may be non-null (enforced by CHECK)
  theme_key       text REFERENCES website_themes(key) ON UPDATE CASCADE,
  custom_theme_id uuid REFERENCES website_custom_themes(id) ON DELETE SET NULL,
  -- Brand/typography overrides (same shape as websites.brand / .typography)
  brand           jsonb NOT NULL DEFAULT '{}',
  typography      jsonb NOT NULL DEFAULT '{}',
  -- Metadata
  last_saved_at   timestamptz DEFAULT now(),
  saved_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Publication tracking: when was this draft last successfully published?
  published_at    timestamptz,
  -- Exclusivity constraint: cannot select both a platform theme AND a custom theme
  CONSTRAINT chk_draft_theme_source_exclusive
    CHECK (NOT (theme_key IS NOT NULL AND custom_theme_id IS NOT NULL)),
  UNIQUE (organization_id),
  UNIQUE (website_id)
);

CREATE INDEX IF NOT EXISTS idx_drafts_org ON website_drafts(organization_id);

-- ==========================================================
-- 5. ROW LEVEL SECURITY — CUSTOM THEMES
-- ==========================================================
ALTER TABLE website_custom_themes ENABLE ROW LEVEL SECURITY;

-- Staff of the owning org: full access
DROP POLICY IF EXISTS "custom_themes_tenant_all" ON website_custom_themes;
CREATE POLICY "custom_themes_tenant_all" ON website_custom_themes FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

-- NO public SELECT policy. Anonymous visitors never read this table directly.
-- get_public_page is SECURITY DEFINER and reads the custom theme internally,
-- returning only sanitized token data. This prevents enumeration of custom
-- themes and exposure of organization_id / created_by to anonymous callers.

-- ==========================================================
-- 6. ROW LEVEL SECURITY — DRAFTS
-- ==========================================================
ALTER TABLE website_drafts ENABLE ROW LEVEL SECURITY;

-- Only authenticated staff of the owning org. Never public.
DROP POLICY IF EXISTS "drafts_tenant_all" ON website_drafts;
CREATE POLICY "drafts_tenant_all" ON website_drafts FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

-- ==========================================================
-- 7. SAVE DRAFT RPC
-- ==========================================================
-- Upserts the draft row. Does NOT touch the published websites table.
-- Enforces theme-source exclusivity: rejects if both theme_key and
-- custom_theme_id are provided.
CREATE OR REPLACE FUNCTION save_website_draft(
  p_theme_key       text    DEFAULT NULL,
  p_custom_theme_id uuid    DEFAULT NULL,
  p_brand           jsonb   DEFAULT '{}'::jsonb,
  p_typography      jsonb   DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  v_org  uuid := public.current_user_org_id();
  v_site uuid;
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'No organization context';
  END IF;

  -- Exclusivity: reject if both theme sources are provided
  IF p_theme_key IS NOT NULL AND p_custom_theme_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'Cannot select both a platform theme and a custom theme. Choose one.'
    );
  END IF;

  SELECT id INTO v_site FROM public.websites WHERE organization_id = v_org;
  IF v_site IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No website exists for this school');
  END IF;

  -- Validate theme_key exists if provided
  IF p_theme_key IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.website_themes WHERE key = p_theme_key AND active = true) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Unknown theme key');
    END IF;
  END IF;

  -- Validate custom_theme_id belongs to this org if provided
  IF p_custom_theme_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.website_custom_themes
      WHERE id = p_custom_theme_id AND organization_id = v_org
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Custom theme not found');
    END IF;
  END IF;

  INSERT INTO public.website_drafts (
    organization_id, website_id, theme_key, custom_theme_id, brand, typography,
    last_saved_at, saved_by
  ) VALUES (
    v_org, v_site, p_theme_key, p_custom_theme_id,
    COALESCE(p_brand, '{}'::jsonb), COALESCE(p_typography, '{}'::jsonb),
    now(), auth.uid()
  )
  ON CONFLICT (organization_id) DO UPDATE SET
    theme_key       = EXCLUDED.theme_key,
    custom_theme_id = EXCLUDED.custom_theme_id,
    brand           = EXCLUDED.brand,
    typography      = EXCLUDED.typography,
    last_saved_at   = now(),
    saved_by        = auth.uid();

  RETURN jsonb_build_object('ok', true, 'saved_at', now());
END $$;

REVOKE EXECUTE ON FUNCTION save_website_draft(text, uuid, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION save_website_draft(text, uuid, jsonb, jsonb) TO authenticated;

-- ==========================================================
-- 8. DISCARD DRAFT RPC
-- ==========================================================
-- Resets the draft to match the currently published site configuration.
-- Does NOT delete the draft row — it remains as a clean baseline.
CREATE OR REPLACE FUNCTION discard_website_draft()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  v_org  uuid := public.current_user_org_id();
  v_site public.websites;
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'No organization context';
  END IF;

  SELECT * INTO v_site FROM public.websites WHERE organization_id = v_org;
  IF v_site.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No website found');
  END IF;

  -- Reset draft to match the currently published configuration
  UPDATE public.website_drafts SET
    theme_key       = v_site.theme_key,
    custom_theme_id = v_site.custom_theme_id,
    brand           = v_site.brand,
    typography      = v_site.typography,
    last_saved_at   = now(),
    saved_by        = auth.uid(),
    published_at    = now()  -- marks as "in sync with published"
  WHERE organization_id = v_org;

  -- If no draft row existed, create one from published state
  IF NOT FOUND THEN
    INSERT INTO public.website_drafts (
      organization_id, website_id, theme_key, custom_theme_id,
      brand, typography, last_saved_at, saved_by, published_at
    ) VALUES (
      v_org, v_site.id, v_site.theme_key, v_site.custom_theme_id,
      v_site.brand, v_site.typography, now(), auth.uid(), now()
    );
  END IF;

  RETURN jsonb_build_object('ok', true, 'reset_to', 'published');
END $$;

REVOKE EXECUTE ON FUNCTION discard_website_draft() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION discard_website_draft() TO authenticated;

-- ==========================================================
-- 9. PUBLISH DRAFT RPC
-- ==========================================================
-- Atomic: validate → snapshot → promote → retain draft as baseline.
-- The draft is NOT deleted — it is updated to match the newly published
-- state so the studio can detect subsequent divergence.
CREATE OR REPLACE FUNCTION publish_website_draft()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  v_org     uuid := public.current_user_org_id();
  v_site    public.websites;
  v_draft   public.website_drafts;
  v_theme   public.website_themes;
  v_plan    text;
  v_effective_theme_key text;
  v_effective_custom_id uuid;
BEGIN
  -- 1. Authorization
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'No organization context';
  END IF;
  IF NOT public.is_org_admin(v_org) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Only administrators can publish');
  END IF;

  -- 2. Load draft
  SELECT * INTO v_draft FROM public.website_drafts WHERE organization_id = v_org;
  IF v_draft.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No draft to publish');
  END IF;

  -- 3. Load site
  SELECT * INTO v_site FROM public.websites WHERE organization_id = v_org;
  IF v_site.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No website found');
  END IF;

  -- 4. Theme-source resolution and exclusivity enforcement
  --    The CHECK constraint prevents both being non-null, but verify here too.
  IF v_draft.theme_key IS NOT NULL AND v_draft.custom_theme_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'Draft has both a platform theme and a custom theme selected. This is invalid.'
    );
  END IF;

  IF v_draft.theme_key IS NOT NULL THEN
    -- Using a platform theme
    v_effective_theme_key := v_draft.theme_key;
    v_effective_custom_id := NULL;
  ELSIF v_draft.custom_theme_id IS NOT NULL THEN
    -- Using a custom theme — verify it still exists and belongs to this org
    IF NOT EXISTS (
      SELECT 1 FROM public.website_custom_themes
      WHERE id = v_draft.custom_theme_id AND organization_id = v_org
    ) THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'The selected custom theme no longer exists. Please choose another theme.'
      );
    END IF;
    v_effective_theme_key := v_site.theme_key;  -- keep existing theme_key as fallback
    v_effective_custom_id := v_draft.custom_theme_id;
  ELSE
    -- Neither selected: inherit from currently published configuration.
    -- Validate that the published configuration is still valid.
    IF v_site.custom_theme_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.website_custom_themes
        WHERE id = v_site.custom_theme_id AND organization_id = v_org
      ) THEN
        RETURN jsonb_build_object(
          'ok', false,
          'error', 'No theme selected in draft and the published custom theme no longer exists. Please select a theme.'
        );
      END IF;
      v_effective_theme_key := v_site.theme_key;
      v_effective_custom_id := v_site.custom_theme_id;
    ELSIF v_site.theme_key IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.website_themes WHERE key = v_site.theme_key AND active = true
      ) THEN
        RETURN jsonb_build_object(
          'ok', false,
          'error', 'No theme selected in draft and the published platform theme is no longer available. Please select a theme.'
        );
      END IF;
      v_effective_theme_key := v_site.theme_key;
      v_effective_custom_id := v_site.custom_theme_id;
    ELSE
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'No theme selected. Please choose a theme before publishing.'
      );
    END IF;
  END IF;

  -- 5. Premium entitlement check (server-enforced)
  IF v_effective_theme_key IS NOT NULL AND v_effective_custom_id IS NULL THEN
    SELECT * INTO v_theme FROM public.website_themes WHERE key = v_effective_theme_key;
    IF v_theme.is_premium THEN
      SELECT plan INTO v_plan FROM public.organizations WHERE id = v_org;
      IF COALESCE(v_plan, 'starter') NOT IN ('premium', 'enterprise', 'unlimited') THEN
        RETURN jsonb_build_object(
          'ok', false,
          'error', 'This theme requires a Premium plan. Please upgrade to publish.',
          'code', 'premium_required'
        );
      END IF;
    END IF;
  END IF;

  -- 6. Snapshot current published state (creates a restorable version)
  PERFORM public.snapshot_website('Before publish');

  -- 7. Promote draft to live
  UPDATE public.websites SET
    theme_key       = v_effective_theme_key,
    custom_theme_id = v_effective_custom_id,
    brand           = v_draft.brand,
    typography      = v_draft.typography,
    updated_at      = now()
  WHERE id = v_site.id;

  -- 8. Retain draft — update to match newly published state (clean baseline)
  UPDATE public.website_drafts SET
    theme_key       = v_effective_theme_key,
    custom_theme_id = v_effective_custom_id,
    brand           = v_draft.brand,
    typography      = v_draft.typography,
    published_at    = now(),
    last_saved_at   = now()
  WHERE id = v_draft.id;

  RETURN jsonb_build_object('ok', true, 'published_at', now());
END $$;

REVOKE EXECUTE ON FUNCTION publish_website_draft() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION publish_website_draft() TO authenticated;

-- ==========================================================
-- 10. DRAFT PREVIEW RPC
-- ==========================================================
-- Returns the same PagePayload shape as get_public_page but with the
-- draft's theme/brand/typography applied. Requires authentication and
-- org membership — anonymous callers get NULL.
CREATE OR REPLACE FUNCTION get_draft_preview(p_website_id uuid, p_slug text DEFAULT '')
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  v_org    uuid := public.current_user_org_id();
  v_site   public.websites;
  v_draft  public.website_drafts;
  v_page   public.website_pages;
  v_theme  jsonb;
  v_slug   text := coalesce(trim(p_slug), '');
BEGIN
  -- Must be authenticated and belong to the owning org
  IF v_org IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO v_site FROM public.websites WHERE id = p_website_id;
  IF v_site.id IS NULL THEN RETURN NULL; END IF;
  IF v_site.organization_id <> v_org THEN RETURN NULL; END IF;

  -- Load draft (may be null → fall back to published state)
  SELECT * INTO v_draft FROM public.website_drafts WHERE website_id = p_website_id;

  -- Resolve theme tokens: draft selection > published selection > fallback
  IF v_draft.id IS NOT NULL AND v_draft.custom_theme_id IS NOT NULL THEN
    SELECT to_jsonb(ct) - 'organization_id' - 'created_by' INTO v_theme
    FROM public.website_custom_themes ct WHERE ct.id = v_draft.custom_theme_id;
  ELSIF v_draft.id IS NOT NULL AND v_draft.theme_key IS NOT NULL THEN
    SELECT to_jsonb(wt) - 'default_sections' INTO v_theme
    FROM public.website_themes wt WHERE wt.key = v_draft.theme_key;
  ELSIF v_site.custom_theme_id IS NOT NULL THEN
    SELECT to_jsonb(ct) - 'organization_id' - 'created_by' INTO v_theme
    FROM public.website_custom_themes ct WHERE ct.id = v_site.custom_theme_id;
  ELSE
    SELECT to_jsonb(wt) - 'default_sections' INTO v_theme
    FROM public.website_themes wt WHERE wt.key = v_site.theme_key;
  END IF;

  -- Locate page (drafts can preview unpublished pages too)
  SELECT * INTO v_page FROM public.website_pages
   WHERE website_id = p_website_id AND slug = v_slug
   LIMIT 1;
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
      'brand', COALESCE(v_draft.brand, v_site.brand),
      'typography', COALESCE(v_draft.typography, v_site.typography),
      'contact', v_site.contact,
      'social', v_site.social,
      'seo', v_site.seo,
      'features', v_site.features,
      'maintenance_mode', false,
      'organization_id', v_site.organization_id,
      'organization_name', (SELECT name FROM public.organizations WHERE id = v_site.organization_id)
    ),
    'theme', COALESCE(v_theme, '{}'::jsonb),
    'page', jsonb_build_object(
      'id', v_page.id, 'slug', v_page.slug, 'title', v_page.title,
      'page_type', v_page.page_type, 'seo', v_page.seo
    ),
    'sections', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', s.id, 'section_type', s.section_type,
               'content', s.content, 'style', s.style
             ) ORDER BY s.position)
      FROM public.website_sections s
      WHERE s.page_id = v_page.id AND s.visible = true
    ), '[]'::jsonb),
    'nav', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'label', n.label, 'menu', n.menu,
               'href', COALESCE(n.href, '/' || NULLIF(p.slug, '')),
               'new_tab', n.open_in_new_tab
             ) ORDER BY n.menu, n.position)
      FROM public.website_nav_items n
      LEFT JOIN public.website_pages p ON p.id = n.page_id
      WHERE n.website_id = p_website_id
    ), '[]'::jsonb),
    'pages', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'slug', p2.slug,
               'label', COALESCE(NULLIF(p2.nav_label, ''), p2.title)
             ) ORDER BY p2.nav_order, p2.title)
      FROM public.website_pages p2
      WHERE p2.website_id = p_website_id AND p2.show_in_nav = true
    ), '[]'::jsonb),
    'news', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'slug', nw.slug, 'title', nw.title, 'excerpt', nw.excerpt,
               'cover_image_url', nw.cover_image_url, 'category', nw.category,
               'published_at', nw.published_at
             ) ORDER BY nw.published_at DESC)
      FROM (
        SELECT * FROM public.website_news
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
        SELECT * FROM public.website_events
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
      FROM public.website_forms f
      WHERE f.website_id = p_website_id AND f.active = true
    ), '[]'::jsonb),
    'is_preview', true
  );
END $$;

REVOKE EXECUTE ON FUNCTION get_draft_preview(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_draft_preview(uuid, text) TO authenticated;

-- ==========================================================
-- 11. UPDATE get_public_page FOR CUSTOM THEME SUPPORT
-- ==========================================================
-- Replace the theme lookup to also check custom_theme_id.
-- The full function is redefined to avoid patching.
-- NOTE: This function already has GRANT ... TO anon, authenticated from
-- website_module.sql. CREATE OR REPLACE preserves existing grants.
-- We do NOT re-issue or broaden any grant here.
CREATE OR REPLACE FUNCTION get_public_page(p_website_id uuid, p_slug text DEFAULT '')
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  v_site  public.websites;
  v_org   public.organizations;
  v_page  public.website_pages;
  v_theme jsonb;
  v_slug  text := coalesce(trim(p_slug), '');
BEGIN
  SELECT * INTO v_site FROM public.websites WHERE id = p_website_id AND status = 'published';
  IF v_site.id IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO v_org FROM public.organizations WHERE id = v_site.organization_id;
  IF v_org.status NOT IN ('active','trial') THEN RETURN NULL; END IF;

  SELECT * INTO v_page FROM public.website_pages
   WHERE website_id = p_website_id AND slug = v_slug AND status = 'published'
   LIMIT 1;
  IF v_page.id IS NULL THEN
    RETURN jsonb_build_object('not_found', true);
  END IF;

  -- Theme resolution: custom_theme_id takes priority over theme_key.
  -- This function is SECURITY DEFINER so it can read website_custom_themes
  -- without needing a public SELECT policy on that table.
  IF v_site.custom_theme_id IS NOT NULL THEN
    SELECT to_jsonb(ct) - 'organization_id' - 'created_by' INTO v_theme
    FROM public.website_custom_themes ct WHERE ct.id = v_site.custom_theme_id;
  END IF;
  IF v_theme IS NULL THEN
    SELECT to_jsonb(wt) - 'default_sections' INTO v_theme
    FROM public.website_themes wt WHERE wt.key = v_site.theme_key;
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
               'content', s.content, 'style', s.style
             ) ORDER BY s.position)
      FROM public.website_sections s
      WHERE s.page_id = v_page.id AND s.visible = true
    ), '[]'::jsonb),
    'nav', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'label', n.label, 'menu', n.menu,
               'href', COALESCE(n.href, '/' || NULLIF(p.slug, '')),
               'new_tab', n.open_in_new_tab
             ) ORDER BY n.menu, n.position)
      FROM public.website_nav_items n
      LEFT JOIN public.website_pages p ON p.id = n.page_id
      WHERE n.website_id = p_website_id
        AND (n.page_id IS NULL OR p.status = 'published')
    ), '[]'::jsonb),
    'pages', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'slug', p2.slug,
               'label', COALESCE(NULLIF(p2.nav_label, ''), p2.title)
             ) ORDER BY p2.nav_order, p2.title)
      FROM public.website_pages p2
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
        SELECT * FROM public.website_news
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
        SELECT * FROM public.website_events
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
      FROM public.website_forms f
      WHERE f.website_id = p_website_id AND f.active = true
    ), '[]'::jsonb)
  );
END $$;

-- Do NOT re-grant here. The existing GRANT ... TO anon, authenticated from
-- website_module.sql is preserved by CREATE OR REPLACE.
