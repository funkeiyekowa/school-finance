-- =====================================================================
-- Update Grant Schools' hero section:
--   - Turn OFF the panel frame (cleaner look with the full crest artwork)
--   - Set the badge image URL if you have one uploaded
--
-- The Theme Builder can override this at any time.
-- =====================================================================

UPDATE public.website_sections
SET content = content
  || jsonb_build_object('show_panel_frame', false)
  -- Uncomment and set the URL below to pin an image now:
  -- || jsonb_build_object('badge_image_url', 'https://your-cdn.com/grant-crest.png')
WHERE section_type = 'hero'
  AND page_id IN (
    SELECT p.id
    FROM public.website_pages p
    JOIN public.websites w ON w.id = p.website_id
    JOIN public.organizations o ON o.id = w.organization_id
    WHERE o.slug ILIKE '%grant%' OR o.name ILIKE '%grant%'
  );

-- Verify
SELECT
  section_type,
  content->>'badge_initials' AS initials,
  content->>'badge_image_url' AS image,
  content->>'show_panel_frame' AS frame_on
FROM public.website_sections s
JOIN public.website_pages p ON p.id = s.page_id
JOIN public.websites w ON w.id = p.website_id
JOIN public.organizations o ON o.id = w.organization_id
WHERE section_type = 'hero'
  AND (o.slug ILIKE '%grant%' OR o.name ILIKE '%grant%');
