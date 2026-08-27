-- =====================================================================
-- Turn OFF hero panel frame everywhere for Grant Schools:
--   - All hero sections (any page, any status)
--   - Draft AND published site state
--   - Also updates the brand token so any future hero inherits it
-- =====================================================================

-- 1. Every hero section on any page belonging to Grant Schools
UPDATE public.website_sections s
SET content = COALESCE(content, '{}'::jsonb) || jsonb_build_object('show_panel_frame', false)
FROM public.website_pages p, public.websites w, public.organizations o
WHERE s.page_id = p.id
  AND p.website_id = w.id
  AND w.organization_id = o.id
  AND s.section_type = 'hero'
  AND (o.slug ILIKE '%grant%' OR o.name ILIKE '%grant%');

-- 2. Also patch the draft table if it exists (studio saves go there first)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'website_drafts') THEN
    EXECUTE $q$
      UPDATE public.website_drafts
      SET brand = COALESCE(brand, '{}'::jsonb) || jsonb_build_object('heroPanelFrame', false)
      WHERE website_id IN (
        SELECT w.id FROM public.websites w
        JOIN public.organizations o ON o.id = w.organization_id
        WHERE o.slug ILIKE '%grant%' OR o.name ILIKE '%grant%'
      )
    $q$;
  END IF;
END $$;

-- 3. Verification — show every hero row and its flag
SELECT
  p.slug AS page,
  s.section_type,
  s.position,
  content->>'show_panel_frame' AS frame,
  jsonb_pretty(s.content) AS full_content
FROM public.website_sections s
JOIN public.website_pages p ON p.id = s.page_id
JOIN public.websites w ON w.id = p.website_id
JOIN public.organizations o ON o.id = w.organization_id
WHERE s.section_type = 'hero'
  AND (o.slug ILIKE '%grant%' OR o.name ILIKE '%grant%');
