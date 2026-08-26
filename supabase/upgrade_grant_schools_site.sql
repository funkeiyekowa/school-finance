-- =====================================================================
-- UPGRADE GRANT SCHOOLS WEBSITE — Full "Mega Premium" Signature Sections
-- =====================================================================
-- Rebuilds the Home page with the 15 signature sections that match the
-- Mega Premium reference. All content configurable from the Theme Builder.
-- Safe to re-run — deletes and re-inserts Home sections only.
-- =====================================================================

DO $$
DECLARE
  v_website_id UUID;
  v_home_page_id UUID;
  v_org_id UUID;
BEGIN
  -- Find Grant Schools' website
  SELECT w.id, w.organization_id
  INTO v_website_id, v_org_id
  FROM public.websites w
  JOIN public.organizations o ON o.id = w.organization_id
  WHERE o.slug ILIKE '%grant%' OR o.name ILIKE '%grant%'
  LIMIT 1;

  IF v_website_id IS NULL THEN
    RAISE EXCEPTION 'Grant Schools website not found';
  END IF;

  RAISE NOTICE 'Website: %  Org: %', v_website_id, v_org_id;

  -- Set theme to heritage-wine
  UPDATE public.websites SET theme_key = 'heritage-wine' WHERE id = v_website_id;

  -- Find or create Home page
  SELECT id INTO v_home_page_id
  FROM public.website_pages
  WHERE website_id = v_website_id AND (slug = '' OR slug = '/' OR slug = 'home')
  ORDER BY (slug = '') DESC, (slug = 'home') DESC
  LIMIT 1;

  IF v_home_page_id IS NULL THEN
    INSERT INTO public.website_pages (organization_id, website_id, slug, title, page_type, is_published)
    VALUES (v_org_id, v_website_id, '', 'Home', 'home', TRUE)
    RETURNING id INTO v_home_page_id;
  END IF;

  RAISE NOTICE 'Home page: %', v_home_page_id;

  -- Clear existing sections
  DELETE FROM public.website_sections WHERE page_id = v_home_page_id;

  -- 1. HERO
  INSERT INTO public.website_sections (organization_id, website_id, page_id, section_type, position, anchor_id, eyebrow, content, style) VALUES
  (v_org_id, v_website_id, v_home_page_id, 'hero', 10, 'top', 'Iju-Ishaga · Lagos State',
   jsonb_build_object(
     'heading', 'Welcome to *Grant Schools*',
     'subheading', 'A community where every child is known, challenged and supported — from Early Years right through to Secondary.',
     'primary_cta_label', 'Apply for Admission',
     'primary_cta_href', '/contact',
     'secondary_cta_label', 'Book a Tour',
     'secondary_cta_href', '/contact',
     'badge_initials', 'GS',
     'badge_caption', 'Est. tradition',
     'trust_chips', jsonb_build_array(
       jsonb_build_object('label', 'British & Nigerian curriculum'),
       jsonb_build_object('label', '12:1 student–teacher ratio'),
       jsonb_build_object('label', 'Safeguarding-trained staff')
     ),
     'stats', jsonb_build_array(
       jsonb_build_object('value', '1200', 'label', 'Students'),
       jsonb_build_object('value', '85', 'label', 'Teachers'),
       jsonb_build_object('value', '98%', 'label', 'Pass rate'),
       jsonb_build_object('value', '25', 'label', 'Years of service')
     )
   ),
   jsonb_build_object('variant', 'badge-ring'));

  -- 2. MARQUEE BAND
  INSERT INTO public.website_sections (organization_id, website_id, page_id, section_type, position, content) VALUES
  (v_org_id, v_website_id, v_home_page_id, 'marquee_band', 20,
   jsonb_build_object(
     'speed', 34,
     'items', jsonb_build_array(
       jsonb_build_object('label', 'Est. Community'),
       jsonb_build_object('label', 'British & Nigerian Curriculum'),
       jsonb_build_object('label', 'WAEC & NECO Prepared'),
       jsonb_build_object('label', '12:1 Student–Teacher Ratio'),
       jsonb_build_object('label', 'Four Houses, One Spirit'),
       jsonb_build_object('label', 'Safeguarding-Trained Staff')
     )
   ));

  -- 3. WHY CHOOSE US
  INSERT INTO public.website_sections (organization_id, website_id, page_id, section_type, position, anchor_id, eyebrow, content) VALUES
  (v_org_id, v_website_id, v_home_page_id, 'why_choose_us', 30, 'why', 'Why families choose us',
   jsonb_build_object(
     'heading', 'Known, challenged and supported — at every stage',
     'subheading', 'Three commitments guide everything we do at Grant Schools.',
     'items', jsonb_build_array(
       jsonb_build_object('title', 'Experienced teachers', 'body', 'Qualified staff who know every child by name.'),
       jsonb_build_object('title', 'Strong results', 'body', 'Consistent academic achievement across every year group.'),
       jsonb_build_object('title', 'Safe environment', 'body', 'A secure, caring campus with pastoral support.')
     )
   ));

  -- 4. PROGRAMMES
  INSERT INTO public.website_sections (organization_id, website_id, page_id, section_type, position, anchor_id, eyebrow, content, style) VALUES
  (v_org_id, v_website_id, v_home_page_id, 'programs', 40, 'programmes', 'Our programmes',
   jsonb_build_object(
     'heading', 'A clear path from first steps to final exams',
     'subheading', 'Every stage builds directly on the one before it.',
     'items', jsonb_build_array(
       jsonb_build_object('title', 'Early Years', 'body', 'Play-based foundations in literacy and numeracy.'),
       jsonb_build_object('title', 'Primary',    'body', 'A broad curriculum building confident learners.'),
       jsonb_build_object('title', 'Secondary',  'body', 'Rigorous preparation for national examinations.')
     )
   ),
   jsonb_build_object('tone', 'surface'));

  -- 5. JOURNEY
  INSERT INTO public.website_sections (organization_id, website_id, page_id, section_type, position, anchor_id, eyebrow, content) VALUES
  (v_org_id, v_website_id, v_home_page_id, 'journey', 50, 'journey', 'How admissions works',
   jsonb_build_object(
     'heading', 'Five steps from enquiry to enrolment',
     'subheading', 'A straightforward process, with a real person guiding you at every stage.',
     'items', jsonb_build_array(
       jsonb_build_object('title', 'Enquire', 'body', 'Send a message or call — we''ll ask a few questions about your child.'),
       jsonb_build_object('title', 'Visit',   'body', 'Tour the campus, meet staff and see a class in session.'),
       jsonb_build_object('title', 'Assess',  'body', 'A short, age-appropriate placement assessment for the right year group.'),
       jsonb_build_object('title', 'Offer',   'body', 'We confirm a place and walk you through fees and requirements.'),
       jsonb_build_object('title', 'Enrol',   'body', 'Complete registration and welcome pack — your child is ready to start.')
     )
   ));

  -- 6. STATS BAND
  INSERT INTO public.website_sections (organization_id, website_id, page_id, section_type, position, eyebrow, content, style) VALUES
  (v_org_id, v_website_id, v_home_page_id, 'stats', 60, 'At a glance',
   jsonb_build_object(
     'heading', 'Grant Schools in numbers',
     'items', jsonb_build_array(
       jsonb_build_object('value', '1200', 'label', 'Students'),
       jsonb_build_object('value', '85',   'label', 'Teachers'),
       jsonb_build_object('value', '98%',  'label', 'Pass rate'),
       jsonb_build_object('value', '30+',  'label', 'Clubs & societies'),
       jsonb_build_object('value', '25',   'label', 'Years of service')
     )
   ),
   jsonb_build_object('tone', 'primary', 'divider', 'curve'));

  -- 7. HOUSES
  INSERT INTO public.website_sections (organization_id, website_id, page_id, section_type, position, anchor_id, eyebrow, content, style) VALUES
  (v_org_id, v_website_id, v_home_page_id, 'houses', 70, 'houses', 'Our houses',
   jsonb_build_object(
     'heading', 'Four houses, one school spirit',
     'subheading', 'Every student is placed in a house from their first week — for sport, service and friendly competition.',
     'items', jsonb_build_array(
       jsonb_build_object('name', 'Baobab', 'motto', 'Resilience & community service', 'color', 'baobab'),
       jsonb_build_object('name', 'Iroko',  'motto', 'Leadership & sport',              'color', 'iroko'),
       jsonb_build_object('name', 'Acacia', 'motto', 'Creativity & the arts',           'color', 'acacia'),
       jsonb_build_object('name', 'Palm',   'motto', 'Curiosity & academics',           'color', 'palm')
     )
   ),
   jsonb_build_object('tone', 'surface'));

  -- 8. GALLERY
  INSERT INTO public.website_sections (organization_id, website_id, page_id, section_type, position, anchor_id, eyebrow, content) VALUES
  (v_org_id, v_website_id, v_home_page_id, 'gallery', 80, 'life', 'Life at Grant Schools',
   jsonb_build_object(
     'heading', 'Campus photography is on its way',
     'subheading', 'Until our first gallery goes live, here''s where it will sit.',
     'items', jsonb_build_array(
       jsonb_build_object('caption', 'Early Years · photos coming soon'),
       jsonb_build_object('caption', 'Assembly & sport · photos coming soon'),
       jsonb_build_object('caption', 'Classrooms · photos coming soon'),
       jsonb_build_object('caption', 'Campus grounds · photos coming soon')
     )
   ));

  -- 9. LEADERSHIP
  INSERT INTO public.website_sections (organization_id, website_id, page_id, section_type, position, anchor_id, eyebrow, content) VALUES
  (v_org_id, v_website_id, v_home_page_id, 'leadership', 90, 'leadership', 'Leadership',
   jsonb_build_object(
     'heading', 'The team guiding Grant Schools',
     'subheading', 'Experienced educators leading each stage of the school.',
     'items', jsonb_build_array(
       jsonb_build_object('initials', 'P',  'name', 'Principal',              'role', 'Whole-school leadership',   'bio', 'Oversees academic standards, staffing and the school''s long-term direction.'),
       jsonb_build_object('initials', 'VP', 'name', 'Vice Principal',         'role', 'Academics & curriculum',    'bio', 'Coordinates the curriculum across Early Years, Primary and Secondary.'),
       jsonb_build_object('initials', 'HP', 'name', 'Head of Pastoral Care',  'role', 'Student wellbeing',         'bio', 'Leads safeguarding, counselling support and day-to-day student welfare.'),
       jsonb_build_object('initials', 'HE', 'name', 'Head of Early Years',    'role', 'Foundation stage',          'bio', 'Guides play-based learning and the transition into Primary.')
     )
   ));

  -- 10. NEWS
  INSERT INTO public.website_sections (organization_id, website_id, page_id, section_type, position, anchor_id, eyebrow, content, style) VALUES
  (v_org_id, v_website_id, v_home_page_id, 'news', 100, 'news', 'News & events',
   jsonb_build_object(
     'heading', 'What''s happening at Grant Schools',
     'empty_state_heading', 'Updates are coming soon',
     'empty_state_body', 'Term dates, admissions news and upcoming events will be posted here. In the meantime, reach out directly and we''ll keep you posted.'
   ),
   jsonb_build_object('tone', 'surface'));

  -- 11. KEY DATES
  INSERT INTO public.website_sections (organization_id, website_id, page_id, section_type, position, content, style) VALUES
  (v_org_id, v_website_id, v_home_page_id, 'key_dates', 110,
   jsonb_build_object(
     'items', jsonb_build_array(
       jsonb_build_object('day', '08', 'month', 'Sep', 'title', 'First day of term', 'body', 'Autumn term begins for all year groups'),
       jsonb_build_object('day', '14', 'month', 'Nov', 'title', 'Open day',          'body', 'Tour the campus and meet the teaching team'),
       jsonb_build_object('day', '12', 'month', 'Dec', 'title', 'Term ends',         'body', 'Reports issued ahead of the festive break')
     )
   ),
   jsonb_build_object('tone', 'surface'));

  -- 12. TESTIMONIALS
  INSERT INTO public.website_sections (organization_id, website_id, page_id, section_type, position, content) VALUES
  (v_org_id, v_website_id, v_home_page_id, 'testimonials', 120,
   jsonb_build_object(
     'items', jsonb_build_array(
       jsonb_build_object('quote', 'The teachers genuinely care. Our daughter has grown in confidence.',                            'author', 'A Grant Schools parent', 'role', 'Primary 4'),
       jsonb_build_object('quote', 'What stood out was how quickly the staff learned our son''s name — and his learning style.',   'author', 'A Grant Schools parent', 'role', 'Year 2'),
       jsonb_build_object('quote', 'Small class sizes made a real difference. Our children get noticed here, not just taught.',    'author', 'A Grant Schools parent', 'role', 'Secondary')
     )
   ));

  -- 13. FAQ
  INSERT INTO public.website_sections (organization_id, website_id, page_id, section_type, position, anchor_id, eyebrow, content) VALUES
  (v_org_id, v_website_id, v_home_page_id, 'faq', 130, 'faq', 'Common questions',
   jsonb_build_object(
     'heading', 'Frequently asked questions',
     'items', jsonb_build_array(
       jsonb_build_object('question', 'What curriculum do you follow?',    'answer', 'We follow a blended British and Nigerian curriculum, preparing students for both WAEC/NECO and internationally recognised assessments.'),
       jsonb_build_object('question', 'What ages do you admit?',           'answer', 'We admit students from Early Years (age 3) right through to Secondary Year 12, with rolling admissions across most year groups.'),
       jsonb_build_object('question', 'Do you provide school transport?',  'answer', 'Transport routes serve most parts of Iju-Ishaga and neighbouring areas — ask us about the route closest to you when you enquire.'),
       jsonb_build_object('question', 'Is there a uniform?',               'answer', 'Yes — uniform (including house colours) is required for all year groups and can be purchased through the school office.'),
       jsonb_build_object('question', 'How do I book a tour?',             'answer', 'Use the contact form below or email us directly — we''ll arrange a convenient time to show you around the campus.')
     )
   ));

  -- 14. ADMISSIONS CTA
  INSERT INTO public.website_sections (organization_id, website_id, page_id, section_type, position, anchor_id, content, style) VALUES
  (v_org_id, v_website_id, v_home_page_id, 'admissions_cta', 140, 'admissions',
   jsonb_build_object(
     'heading', 'Admissions are open',
     'subheading', 'Start an application or arrange a visit — we''d be glad to meet you.',
     'primary_cta_label', 'Apply Now',
     'primary_cta_href', '/contact',
     'secondary_cta_label', 'Talk to Us',
     'secondary_cta_href', '/contact'
   ),
   jsonb_build_object('tone', 'surface'));

  -- 15. NEWSLETTER
  INSERT INTO public.website_sections (organization_id, website_id, page_id, section_type, position, content) VALUES
  (v_org_id, v_website_id, v_home_page_id, 'newsletter', 150,
   jsonb_build_object(
     'heading', 'Stay in the loop',
     'subheading', 'Occasional updates on admissions, term dates and school news — nothing else.',
     'button_label', 'Sign up'
   ));

  -- 16. CONTACT
  INSERT INTO public.website_sections (organization_id, website_id, page_id, section_type, position, anchor_id, eyebrow, content) VALUES
  (v_org_id, v_website_id, v_home_page_id, 'contact', 160, 'contact', 'Get in touch',
   jsonb_build_object(
     'heading', 'Send us a message',
     'subheading', 'We read every message and reply as soon as we can.'
   ));

  RAISE NOTICE 'Inserted 16 sections into Home page';
END $$;

-- Update contact info + tagline for Grant Schools
UPDATE public.websites
SET
  contact = COALESCE(contact, '{}'::jsonb) || jsonb_build_object(
    'address', 'No 10 Aga Layout, Iju-Ishaga, Lagos State, Nigeria',
    'email',   'grantschoolsiju@gmail.com',
    'hours',   'Monday – Friday, during school term'
  ),
  tagline = COALESCE(NULLIF(tagline, ''), 'Educating with Excellence')
WHERE id IN (
  SELECT w.id FROM public.websites w
  JOIN public.organizations o ON o.id = w.organization_id
  WHERE o.slug ILIKE '%grant%' OR o.name ILIKE '%grant%'
);

-- Verification
SELECT
  s.position,
  s.section_type,
  s.anchor_id,
  LEFT(COALESCE(s.content->>'heading', s.content->>'label', ''), 45) AS preview
FROM public.website_sections s
JOIN public.website_pages p ON p.id = s.page_id
JOIN public.websites w ON w.id = p.website_id
JOIN public.organizations o ON o.id = w.organization_id
WHERE o.slug ILIKE '%grant%' OR o.name ILIKE '%grant%'
ORDER BY s.position;
