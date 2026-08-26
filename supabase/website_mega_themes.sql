-- ============================================================
-- WEBSITE MEGA THEMES — 6 families x 3 variants = 18 themes
--
-- Run AFTER website_module.sql.
--
-- What this adds:
--   1. family / variant_label / lifestyle_prompts columns on
--      website_themes so the studio can group variants.
--   2. 18 fully-specified themes. The "Grant Heritage — Wine &
--      Gold" variant is a token-for-token match of the uploaded
--      Mega Premium design.
--   3. Richer token vocabulary: motif, divider, heroStyle,
--      cardStyle, grain, animations — so a theme controls
--      structure and texture, not just colour.
--   4. Per-section style capability (section_style_presets).
--   5. AI image prompts per theme so schools without photography
--      can generate on-brand lifestyle imagery.
--
-- Themes remain DATA. Adding a 19th theme is an INSERT.
-- ============================================================

-- ==========================================================
-- 1. SCHEMA EXTENSIONS
-- ==========================================================
ALTER TABLE website_themes ADD COLUMN IF NOT EXISTS family text;
ALTER TABLE website_themes ADD COLUMN IF NOT EXISTS family_label text;
ALTER TABLE website_themes ADD COLUMN IF NOT EXISTS variant_label text;
ALTER TABLE website_themes ADD COLUMN IF NOT EXISTS variant_order integer DEFAULT 1;
/* AI prompts a school can paste into an image generator to get
   on-brand photography for this theme. */
ALTER TABLE website_themes ADD COLUMN IF NOT EXISTS lifestyle_prompts jsonb DEFAULT '[]';
/* Which section types this theme is designed around. The studio
   offers these first when building a page. */
ALTER TABLE website_themes ADD COLUMN IF NOT EXISTS signature_sections jsonb DEFAULT '[]';

CREATE INDEX IF NOT EXISTS idx_themes_family ON website_themes(family, variant_order);

-- Allow per-section style overrides to be richer
ALTER TABLE website_sections ADD COLUMN IF NOT EXISTS anchor_id text;
ALTER TABLE website_sections ADD COLUMN IF NOT EXISTS eyebrow text;

-- ==========================================================
-- 2. SECTION STYLE PRESETS (platform-level, reusable)
-- ==========================================================
CREATE TABLE IF NOT EXISTS section_style_presets (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  style jsonb NOT NULL DEFAULT '{}',
  sort_order integer DEFAULT 0
);

ALTER TABLE section_style_presets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "presets_read" ON section_style_presets;
CREATE POLICY "presets_read" ON section_style_presets FOR SELECT USING (true);

INSERT INTO section_style_presets (key, name, description, style, sort_order) VALUES
  ('default',     'Default',        'Theme background, standard padding',
   '{"tone":"background","padding":"normal","align":"left","motif":false,"divider":"none"}', 1),
  ('surface',     'Surface band',   'Alternating surface colour',
   '{"tone":"surface","padding":"normal","align":"left","motif":false,"divider":"none"}', 2),
  ('accent',      'Accent band',    'Primary colour band with light text',
   '{"tone":"primary","padding":"normal","align":"center","motif":false,"divider":"none"}', 3),
  ('motif',       'Textured',       'Surface with the theme motif overlaid',
   '{"tone":"surfaceAlt","padding":"normal","align":"left","motif":true,"divider":"none"}', 4),
  ('curved',      'Curved edges',   'Curved dividers top and bottom',
   '{"tone":"primary","padding":"loose","align":"center","motif":false,"divider":"curve"}', 5),
  ('tight',       'Tight',          'Reduced vertical padding',
   '{"tone":"background","padding":"tight","align":"left","motif":false,"divider":"none"}', 6),
  ('full-bleed',  'Full bleed',     'Edge-to-edge, no container',
   '{"tone":"background","padding":"none","align":"left","motif":false,"divider":"none","fullBleed":true}', 7),
  ('dark',        'Dark band',      'Deep ink background, light text',
   '{"tone":"ink","padding":"loose","align":"center","motif":true,"divider":"none"}', 8)
ON CONFLICT (key) DO UPDATE SET style = EXCLUDED.style, description = EXCLUDED.description;

-- ==========================================================
-- 3. THE 18 THEMES
-- ==========================================================
-- Clear the old five so the catalogue is coherent. Any site
-- already pointing at an old key is remapped afterwards.
-- ==========================================================

-- ---------- FAMILY 1: GRANT HERITAGE ----------
-- Variant A is the uploaded Mega Premium design, token for token.
INSERT INTO website_themes (key, family, family_label, variant_label, variant_order, name, description, is_premium, sort_order, tokens, default_sections, signature_sections, lifestyle_prompts) VALUES
(
 'heritage-wine', 'heritage', 'Grant Heritage', 'Wine & Gold', 1,
 'Grant Heritage · Wine & Gold',
 'Deep maroon and gold drawn from a school uniform. Woven diamond motif, curved dividers, count-up statistics and house roundels.',
 true, 1,
 '{
   "colors":{
     "primary":"#6E1F30","primaryDark":"#4A1420","primaryDeeper":"#2A0C14",
     "secondary":"#A24A5E","accent":"#E0A526","accentDeep":"#B9800D","accentSoft":"#F0CE8C",
     "background":"#FBF3E4","surface":"#F6E7CC","surfaceAlt":"#EFDCB2","border":"#E4D0A0",
     "text":"#241620","textMuted":"#6E5A44","textFaint":"#8B7862",
     "ink":"#241620","inkDeep":"#170A10",
     "headerBg":"#6E1F30","headerText":"#FBF3E4",
     "footerBg":"#2A0C14","footerText":"#F0CE8C",
     "success":"#1E6E48","warning":"#B9800D","error":"#9C3A2A"
   },
   "fonts":{"heading":"Bricolage Grotesque","body":"Karla","accent":"Bricolage Grotesque"},
   "scale":{"h1":"clamp(2.6rem,6vw,4.2rem)","h2":"clamp(1.9rem,3.6vw,2.7rem)","h3":"1.25rem","body":"1rem","eyebrow":"0.78rem"},
   "radius":{"sm":"8px","md":"14px","lg":"26px","xl":"32px","pill":"999px"},
   "spacing":{"section":"clamp(64px,8vw,112px)","gap":"24px","container":"1180px"},
   "button":{"radius":"999px","weight":"700","transform":"none","borderWidth":"2px"},
   "shadow":{
     "soft":"0 1px 2px rgba(36,22,32,.06), 0 14px 32px rgba(36,22,32,.10)",
     "lift":"0 10px 20px rgba(36,22,32,.14), 0 28px 52px rgba(36,22,32,.14)",
     "premium":"0 2px 4px rgba(15,10,6,.14), 0 30px 70px rgba(15,10,6,.38)",
     "card":"0 1px 2px rgba(36,22,32,.06), 0 14px 32px rgba(36,22,32,.10)"
   },
   "motif":"weave","divider":"curve","heroStyle":"badge-ring","cardStyle":"soft",
   "headerStyle":"dark","grain":true,"animations":true,"marquee":true
 }'::jsonb,
 '["hero","marquee_band","why_choose_us","programs","journey","stats","houses","gallery","testimonials","leadership","news","key_dates","faq","admissions_cta","newsletter","contact"]'::jsonb,
 '["marquee_band","journey","houses","leadership","key_dates","newsletter"]'::jsonb,
 '[
   {"slot":"hero","prompt":"Wide editorial photograph of a Nigerian secondary school assembly courtyard at golden hour, students in maroon and gold uniforms walking between classroom blocks, warm terracotta walls, shallow depth of field, natural light, documentary style, 16:9"},
   {"slot":"gallery","prompt":"Candid photograph of West African students in maroon blazers working together at a science bench, sunlight through louvre windows, warm cream and gold palette, editorial documentary photography, square crop"},
   {"slot":"leadership","prompt":"Professional headshot of a Nigerian school principal in a maroon academic gown against a warm cream backdrop, soft window light, dignified and approachable, 3:4 portrait"},
   {"slot":"houses","prompt":"Four students each holding a different coloured house banner - deep green, terracotta, gold and wine - standing on a school sports field, late afternoon light, celebratory, 4:3"}
 ]'::jsonb
),
(
 'heritage-forest', 'heritage', 'Grant Heritage', 'Forest & Brass', 2,
 'Grant Heritage · Forest & Brass',
 'The same heritage structure in deep forest green with brass accents. Reads institutional and established.',
 true, 2,
 '{
   "colors":{
     "primary":"#1F4736","primaryDark":"#143024","primaryDeeper":"#0B1D16",
     "secondary":"#4A7A63","accent":"#C08A2E","accentDeep":"#96690F","accentSoft":"#E8CF9A",
     "background":"#F7F4EA","surface":"#EFEAD8","surfaceAlt":"#E4DDC4","border":"#D6CCAC",
     "text":"#18211C","textMuted":"#54604F","textFaint":"#7A8474",
     "ink":"#18211C","inkDeep":"#0C120E",
     "headerBg":"#1F4736","headerText":"#F7F4EA",
     "footerBg":"#0B1D16","footerText":"#E8CF9A",
     "success":"#1E6E48","warning":"#96690F","error":"#8F3527"
   },
   "fonts":{"heading":"Bricolage Grotesque","body":"Karla","accent":"Bricolage Grotesque"},
   "scale":{"h1":"clamp(2.6rem,6vw,4.2rem)","h2":"clamp(1.9rem,3.6vw,2.7rem)","h3":"1.25rem","body":"1rem","eyebrow":"0.78rem"},
   "radius":{"sm":"8px","md":"14px","lg":"26px","xl":"32px","pill":"999px"},
   "spacing":{"section":"clamp(64px,8vw,112px)","gap":"24px","container":"1180px"},
   "button":{"radius":"999px","weight":"700","transform":"none","borderWidth":"2px"},
   "shadow":{
     "soft":"0 1px 2px rgba(24,33,28,.06), 0 14px 32px rgba(24,33,28,.10)",
     "lift":"0 10px 20px rgba(24,33,28,.14), 0 28px 52px rgba(24,33,28,.14)",
     "premium":"0 2px 4px rgba(11,29,22,.14), 0 30px 70px rgba(11,29,22,.36)",
     "card":"0 1px 2px rgba(24,33,28,.06), 0 14px 32px rgba(24,33,28,.10)"
   },
   "motif":"weave","divider":"curve","heroStyle":"badge-ring","cardStyle":"soft",
   "headerStyle":"dark","grain":true,"animations":true,"marquee":true
 }'::jsonb,
 '["hero","marquee_band","why_choose_us","programs","journey","stats","houses","gallery","testimonials","leadership","news","faq","admissions_cta","contact"]'::jsonb,
 '["marquee_band","journey","houses","leadership","key_dates"]'::jsonb,
 '[
   {"slot":"hero","prompt":"Wide photograph of a leafy school campus walkway lined with mature trees, students in dark green blazers, dappled morning light, established institutional feel, editorial, 16:9"},
   {"slot":"gallery","prompt":"Students in forest green uniforms reading in a wood-panelled school library, brass reading lamps, warm natural light, square crop"},
   {"slot":"leadership","prompt":"Portrait of a school head teacher in dark green academic robes against a panelled wall, soft directional light, 3:4"}
 ]'::jsonb
),
(
 'heritage-indigo', 'heritage', 'Grant Heritage', 'Indigo & Copper', 3,
 'Grant Heritage · Indigo & Copper',
 'Adire-inspired indigo with copper highlights. The heritage layout with a distinctly West African textile palette.',
 true, 3,
 '{
   "colors":{
     "primary":"#26365E","primaryDark":"#182444","primaryDeeper":"#0C1329",
     "secondary":"#4E6493","accent":"#C87B4A","accentDeep":"#9E5729","accentSoft":"#EBC3A5",
     "background":"#F8F5F0","surface":"#EFEAE1","surfaceAlt":"#E2DACB","border":"#D3C9B6",
     "text":"#1B1F2A","textMuted":"#575E6E","textFaint":"#7C8494",
     "ink":"#1B1F2A","inkDeep":"#0D1017",
     "headerBg":"#26365E","headerText":"#F8F5F0",
     "footerBg":"#0C1329","footerText":"#EBC3A5",
     "success":"#1E6E48","warning":"#9E5729","error":"#94382C"
   },
   "fonts":{"heading":"Bricolage Grotesque","body":"Karla","accent":"Bricolage Grotesque"},
   "scale":{"h1":"clamp(2.6rem,6vw,4.2rem)","h2":"clamp(1.9rem,3.6vw,2.7rem)","h3":"1.25rem","body":"1rem","eyebrow":"0.78rem"},
   "radius":{"sm":"8px","md":"14px","lg":"26px","xl":"32px","pill":"999px"},
   "spacing":{"section":"clamp(64px,8vw,112px)","gap":"24px","container":"1180px"},
   "button":{"radius":"999px","weight":"700","transform":"none","borderWidth":"2px"},
   "shadow":{
     "soft":"0 1px 2px rgba(27,31,42,.06), 0 14px 32px rgba(27,31,42,.10)",
     "lift":"0 10px 20px rgba(27,31,42,.14), 0 28px 52px rgba(27,31,42,.14)",
     "premium":"0 2px 4px rgba(12,19,41,.14), 0 30px 70px rgba(12,19,41,.36)",
     "card":"0 1px 2px rgba(27,31,42,.06), 0 14px 32px rgba(27,31,42,.10)"
   },
   "motif":"weave","divider":"curve","heroStyle":"badge-ring","cardStyle":"soft",
   "headerStyle":"dark","grain":true,"animations":true,"marquee":true
 }'::jsonb,
 '["hero","marquee_band","why_choose_us","programs","journey","stats","houses","gallery","testimonials","leadership","news","faq","admissions_cta","contact"]'::jsonb,
 '["marquee_band","journey","houses","leadership","key_dates"]'::jsonb,
 '[
   {"slot":"hero","prompt":"Wide photograph of students in indigo uniforms crossing a school courtyard, adire textile patterns on a nearby banner, warm afternoon light, copper accents, editorial documentary, 16:9"},
   {"slot":"gallery","prompt":"Close-up of hands working with indigo-dyed fabric in a school art room, copper bowls, natural light, square crop"},
   {"slot":"leadership","prompt":"Portrait of a Nigerian educator in indigo formal wear against a neutral warm wall, soft window light, 3:4"}
 ]'::jsonb
),

-- ---------- FAMILY 2: MODERN ACADEMY ----------
(
 'modern-cobalt', 'modern', 'Modern Academy', 'Cobalt & Sky', 1,
 'Modern Academy · Cobalt & Sky',
 'Large photography, clean sans-serif type, generous white space and soft cards. The safest choice for most schools.',
 false, 10,
 '{
   "colors":{
     "primary":"#1D4ED8","primaryDark":"#1E3A8A","primaryDeeper":"#172554",
     "secondary":"#0EA5E9","accent":"#F59E0B","accentDeep":"#B45309","accentSoft":"#FDE68A",
     "background":"#FFFFFF","surface":"#F8FAFC","surfaceAlt":"#EFF6FF","border":"#E2E8F0",
     "text":"#0F172A","textMuted":"#64748B","textFaint":"#94A3B8",
     "ink":"#0F172A","inkDeep":"#020617",
     "headerBg":"#FFFFFF","headerText":"#0F172A",
     "footerBg":"#0F172A","footerText":"#CBD5E1",
     "success":"#16A34A","warning":"#D97706","error":"#DC2626"
   },
   "fonts":{"heading":"Poppins","body":"Inter","accent":"Inter"},
   "scale":{"h1":"clamp(2.4rem,5.5vw,3.6rem)","h2":"clamp(1.8rem,3.2vw,2.4rem)","h3":"1.25rem","body":"1rem","eyebrow":"0.75rem"},
   "radius":{"sm":"6px","md":"12px","lg":"20px","xl":"28px","pill":"999px"},
   "spacing":{"section":"clamp(56px,7vw,96px)","gap":"24px","container":"1200px"},
   "button":{"radius":"12px","weight":"600","transform":"none","borderWidth":"2px"},
   "shadow":{
     "soft":"0 1px 3px rgba(15,23,42,.08)",
     "lift":"0 8px 24px rgba(15,23,42,.10)",
     "premium":"0 20px 50px rgba(15,23,42,.16)",
     "card":"0 1px 3px rgba(15,23,42,.08), 0 8px 24px rgba(15,23,42,.06)"
   },
   "motif":"dots","divider":"none","heroStyle":"image-right","cardStyle":"elevated",
   "headerStyle":"light","grain":false,"animations":true,"marquee":false
 }'::jsonb,
 '["hero","why_choose_us","programs","stats","gallery","news","testimonials","admissions_cta","contact"]'::jsonb,
 '["trust_strip","key_dates"]'::jsonb,
 '[
   {"slot":"hero","prompt":"Bright modern school building exterior with glass frontage, students walking in, clear blue sky, contemporary architecture photography, 16:9"},
   {"slot":"gallery","prompt":"Students collaborating around a laptop in a bright modern classroom, large windows, blue and white palette, natural light, square"},
   {"slot":"programs","prompt":"Overhead shot of school supplies neatly arranged on a white desk - notebooks, tablet, pencils - soft blue accents, flat lay, 4:3"}
 ]'::jsonb
),
(
 'modern-emerald', 'modern', 'Modern Academy', 'Emerald & Lime', 2,
 'Modern Academy · Emerald & Lime',
 'Fresh green palette with lime highlights. Reads energetic and growth-focused.',
 false, 11,
 '{
   "colors":{
     "primary":"#047857","primaryDark":"#065F46","primaryDeeper":"#022C22",
     "secondary":"#10B981","accent":"#84CC16","accentDeep":"#4D7C0F","accentSoft":"#D9F99D",
     "background":"#FFFFFF","surface":"#F7FDF9","surfaceAlt":"#ECFDF5","border":"#D1FAE5",
     "text":"#0B1F17","textMuted":"#5B6B62","textFaint":"#8FA096",
     "ink":"#0B1F17","inkDeep":"#03110B",
     "headerBg":"#FFFFFF","headerText":"#0B1F17",
     "footerBg":"#022C22","footerText":"#D1FAE5",
     "success":"#16A34A","warning":"#CA8A04","error":"#DC2626"
   },
   "fonts":{"heading":"Poppins","body":"Inter","accent":"Inter"},
   "scale":{"h1":"clamp(2.4rem,5.5vw,3.6rem)","h2":"clamp(1.8rem,3.2vw,2.4rem)","h3":"1.25rem","body":"1rem","eyebrow":"0.75rem"},
   "radius":{"sm":"6px","md":"12px","lg":"20px","xl":"28px","pill":"999px"},
   "spacing":{"section":"clamp(56px,7vw,96px)","gap":"24px","container":"1200px"},
   "button":{"radius":"12px","weight":"600","transform":"none","borderWidth":"2px"},
   "shadow":{
     "soft":"0 1px 3px rgba(11,31,23,.08)",
     "lift":"0 8px 24px rgba(11,31,23,.10)",
     "premium":"0 20px 50px rgba(11,31,23,.16)",
     "card":"0 1px 3px rgba(11,31,23,.08), 0 8px 24px rgba(11,31,23,.06)"
   },
   "motif":"dots","divider":"none","heroStyle":"image-right","cardStyle":"elevated",
   "headerStyle":"light","grain":false,"animations":true,"marquee":false
 }'::jsonb,
 '["hero","why_choose_us","programs","stats","gallery","news","testimonials","admissions_cta","contact"]'::jsonb,
 '["trust_strip","key_dates"]'::jsonb,
 '[
   {"slot":"hero","prompt":"Students tending a school garden with green raised beds, bright morning light, sustainability theme, documentary photography, 16:9"},
   {"slot":"gallery","prompt":"Young students planting seedlings in a school courtyard garden, green and lime palette, joyful, natural light, square"}
 ]'::jsonb
),
(
 'modern-slate', 'modern', 'Modern Academy', 'Slate & Amber', 3,
 'Modern Academy · Slate & Amber',
 'Neutral slate with warm amber accents. Understated and professional.',
 false, 12,
 '{
   "colors":{
     "primary":"#334155","primaryDark":"#1E293B","primaryDeeper":"#0F172A",
     "secondary":"#64748B","accent":"#F59E0B","accentDeep":"#B45309","accentSoft":"#FEF3C7",
     "background":"#FFFFFF","surface":"#F8FAFC","surfaceAlt":"#F1F5F9","border":"#E2E8F0",
     "text":"#0F172A","textMuted":"#64748B","textFaint":"#94A3B8",
     "ink":"#0F172A","inkDeep":"#020617",
     "headerBg":"#FFFFFF","headerText":"#0F172A",
     "footerBg":"#1E293B","footerText":"#CBD5E1",
     "success":"#16A34A","warning":"#D97706","error":"#DC2626"
   },
   "fonts":{"heading":"Poppins","body":"Inter","accent":"Inter"},
   "scale":{"h1":"clamp(2.4rem,5.5vw,3.6rem)","h2":"clamp(1.8rem,3.2vw,2.4rem)","h3":"1.25rem","body":"1rem","eyebrow":"0.75rem"},
   "radius":{"sm":"6px","md":"12px","lg":"20px","xl":"28px","pill":"999px"},
   "spacing":{"section":"clamp(56px,7vw,96px)","gap":"24px","container":"1200px"},
   "button":{"radius":"12px","weight":"600","transform":"none","borderWidth":"2px"},
   "shadow":{
     "soft":"0 1px 3px rgba(15,23,42,.08)",
     "lift":"0 8px 24px rgba(15,23,42,.10)",
     "premium":"0 20px 50px rgba(15,23,42,.16)",
     "card":"0 1px 3px rgba(15,23,42,.08), 0 8px 24px rgba(15,23,42,.06)"
   },
   "motif":"grid","divider":"none","heroStyle":"split-diagonal","cardStyle":"bordered",
   "headerStyle":"light","grain":false,"animations":true,"marquee":false
 }'::jsonb,
 '["hero","why_choose_us","programs","stats","gallery","news","admissions_cta","contact"]'::jsonb,
 '["trust_strip"]'::jsonb,
 '[
   {"slot":"hero","prompt":"Clean architectural photograph of a school entrance with concrete and glass, single amber accent detail, overcast even light, minimal, 16:9"}
 ]'::jsonb
),

-- ---------- FAMILY 3: CLASSIC EXCELLENCE ----------
(
 'classic-navy', 'classic', 'Classic Excellence', 'Navy & Gold', 1,
 'Classic Excellence · Navy & Gold',
 'Elegant serif headings, navy and gold, a traditional and established feel. Crests, rules and restrained ornament.',
 false, 20,
 '{
   "colors":{
     "primary":"#0F2A47","primaryDark":"#0A1D33","primaryDeeper":"#05101D",
     "secondary":"#1B3E63","accent":"#C9A227","accentDeep":"#96760F","accentSoft":"#F4E9C7",
     "background":"#FFFDF8","surface":"#FBF6E8","surfaceAlt":"#F4E9C7","border":"#E7DCC3",
     "text":"#111827","textMuted":"#6B6355","textFaint":"#8E8776",
     "ink":"#111827","inkDeep":"#05101D",
     "headerBg":"#0F2A47","headerText":"#FFFFFF",
     "footerBg":"#0A1D33","footerText":"#E7DCC3",
     "success":"#15803D","warning":"#B45309","error":"#B91C1C"
   },
   "fonts":{"heading":"Playfair Display","body":"Lato","accent":"Cormorant Garamond"},
   "scale":{"h1":"clamp(2.6rem,6vw,3.9rem)","h2":"clamp(1.9rem,3.4vw,2.5rem)","h3":"1.3rem","body":"1.0625rem","eyebrow":"0.72rem"},
   "radius":{"sm":"2px","md":"4px","lg":"8px","xl":"10px","pill":"999px"},
   "spacing":{"section":"clamp(64px,8vw,104px)","gap":"28px","container":"1140px"},
   "button":{"radius":"4px","weight":"700","transform":"uppercase","borderWidth":"2px"},
   "shadow":{
     "soft":"0 1px 2px rgba(15,42,71,.10)",
     "lift":"0 6px 18px rgba(15,42,71,.12)",
     "premium":"0 16px 44px rgba(5,16,29,.24)",
     "card":"0 1px 2px rgba(15,42,71,.10)"
   },
   "motif":"rules","divider":"rule","heroStyle":"centered","cardStyle":"bordered",
   "headerStyle":"dark","grain":false,"animations":true,"marquee":false
 }'::jsonb,
 '["hero","principal_message","why_choose_us","programs","achievements","stats","gallery","testimonials","leadership","news","faq","admissions_cta","contact"]'::jsonb,
 '["principal_message","achievements","leadership","key_dates"]'::jsonb,
 '[
   {"slot":"hero","prompt":"Formal photograph of a historic school building facade with columns, students in navy blazers on the steps, late afternoon golden light, classical composition, 16:9"},
   {"slot":"leadership","prompt":"Formal portrait of a headmaster in navy academic gown with gold trim, dark panelled background, Rembrandt lighting, 3:4"},
   {"slot":"achievements","prompt":"Close-up of school trophies and gold medals arranged on a navy velvet cloth, dramatic side lighting, 4:3"}
 ]'::jsonb
),
(
 'classic-oxblood', 'classic', 'Classic Excellence', 'Oxblood & Cream', 2,
 'Classic Excellence · Oxblood & Cream',
 'Deep oxblood with cream and antique gold. Warmer than navy, equally formal.',
 false, 21,
 '{
   "colors":{
     "primary":"#5C1A1B","primaryDark":"#3F1112","primaryDeeper":"#240A0A",
     "secondary":"#8A3B3C","accent":"#B08D57","accentDeep":"#856734","accentSoft":"#EBDCC0",
     "background":"#FDFAF4","surface":"#F7F0E2","surfaceAlt":"#EFE4CE","border":"#DFD2B8",
     "text":"#1F1614","textMuted":"#6B5D52","textFaint":"#8F8074",
     "ink":"#1F1614","inkDeep":"#120C0A",
     "headerBg":"#5C1A1B","headerText":"#FDFAF4",
     "footerBg":"#240A0A","footerText":"#EBDCC0",
     "success":"#15803D","warning":"#856734","error":"#8F2422"
   },
   "fonts":{"heading":"Playfair Display","body":"Lato","accent":"Cormorant Garamond"},
   "scale":{"h1":"clamp(2.6rem,6vw,3.9rem)","h2":"clamp(1.9rem,3.4vw,2.5rem)","h3":"1.3rem","body":"1.0625rem","eyebrow":"0.72rem"},
   "radius":{"sm":"2px","md":"4px","lg":"8px","xl":"10px","pill":"999px"},
   "spacing":{"section":"clamp(64px,8vw,104px)","gap":"28px","container":"1140px"},
   "button":{"radius":"4px","weight":"700","transform":"uppercase","borderWidth":"2px"},
   "shadow":{
     "soft":"0 1px 2px rgba(31,22,20,.10)",
     "lift":"0 6px 18px rgba(31,22,20,.12)",
     "premium":"0 16px 44px rgba(36,10,10,.24)",
     "card":"0 1px 2px rgba(31,22,20,.10)"
   },
   "motif":"rules","divider":"rule","heroStyle":"centered","cardStyle":"bordered",
   "headerStyle":"dark","grain":true,"animations":true,"marquee":false
 }'::jsonb,
 '["hero","principal_message","why_choose_us","programs","achievements","gallery","testimonials","leadership","news","admissions_cta","contact"]'::jsonb,
 '["principal_message","achievements","leadership"]'::jsonb,
 '[
   {"slot":"hero","prompt":"School great hall interior with wooden beams and oxblood banners, warm chandelier light, empty formal seating, architectural photography, 16:9"},
   {"slot":"leadership","prompt":"Portrait of a school principal in a deep burgundy gown, cream wall background, soft classical lighting, 3:4"}
 ]'::jsonb
),
(
 'classic-forest', 'classic', 'Classic Excellence', 'Forest & Parchment', 3,
 'Classic Excellence · Forest & Parchment',
 'Traditional forest green on warm parchment. Quiet authority.',
 false, 22,
 '{
   "colors":{
     "primary":"#1B3A2B","primaryDark":"#12281D","primaryDeeper":"#081410",
     "secondary":"#3E6B52","accent":"#A98A4B","accentDeep":"#7E6530","accentSoft":"#E7DBBB",
     "background":"#FCFAF2","surface":"#F4F0E1","surfaceAlt":"#EAE3CD","border":"#DBD2B6",
     "text":"#161C18","textMuted":"#5A6459","textFaint":"#7F887C",
     "ink":"#161C18","inkDeep":"#0A0F0C",
     "headerBg":"#1B3A2B","headerText":"#FCFAF2",
     "footerBg":"#081410","footerText":"#E7DBBB",
     "success":"#15803D","warning":"#7E6530","error":"#8F2E24"
   },
   "fonts":{"heading":"Libre Baskerville","body":"Lato","accent":"Cormorant Garamond"},
   "scale":{"h1":"clamp(2.4rem,5.5vw,3.6rem)","h2":"clamp(1.8rem,3.2vw,2.4rem)","h3":"1.25rem","body":"1.0625rem","eyebrow":"0.72rem"},
   "radius":{"sm":"2px","md":"4px","lg":"8px","xl":"10px","pill":"999px"},
   "spacing":{"section":"clamp(64px,8vw,104px)","gap":"28px","container":"1140px"},
   "button":{"radius":"4px","weight":"700","transform":"uppercase","borderWidth":"2px"},
   "shadow":{
     "soft":"0 1px 2px rgba(22,28,24,.10)",
     "lift":"0 6px 18px rgba(22,28,24,.12)",
     "premium":"0 16px 44px rgba(8,20,16,.22)",
     "card":"0 1px 2px rgba(22,28,24,.10)"
   },
   "motif":"rules","divider":"rule","heroStyle":"centered","cardStyle":"flat",
   "headerStyle":"dark","grain":true,"animations":true,"marquee":false
 }'::jsonb,
 '["hero","principal_message","why_choose_us","programs","achievements","gallery","leadership","news","faq","admissions_cta","contact"]'::jsonb,
 '["principal_message","achievements","leadership"]'::jsonb,
 '[
   {"slot":"hero","prompt":"Old school library with dark green reading lamps and parchment-coloured walls, tall bookshelves, warm reading light, 16:9"}
 ]'::jsonb
),

-- ---------- FAMILY 4: FUTURE SCHOOL ----------
(
 'future-violet', 'future', 'Future School', 'Violet & Cyan', 1,
 'Future School · Violet & Cyan',
 'Technology-forward. Dark sections, gradient glows and bold animated statistics.',
 true, 30,
 '{
   "colors":{
     "primary":"#7C3AED","primaryDark":"#5B21B6","primaryDeeper":"#2E1065",
     "secondary":"#06B6D4","accent":"#22D3EE","accentDeep":"#0891B2","accentSoft":"#A5F3FC",
     "background":"#0B1020","surface":"#141B2E","surfaceAlt":"#1E2740","border":"#293449",
     "text":"#F1F5F9","textMuted":"#94A3B8","textFaint":"#64748B",
     "ink":"#F1F5F9","inkDeep":"#FFFFFF",
     "headerBg":"#0B1020","headerText":"#F1F5F9",
     "footerBg":"#070B16","footerText":"#94A3B8",
     "success":"#34D399","warning":"#FBBF24","error":"#F87171"
   },
   "fonts":{"heading":"Space Grotesk","body":"Inter","accent":"Space Grotesk"},
   "scale":{"h1":"clamp(2.6rem,6.5vw,4rem)","h2":"clamp(1.9rem,3.6vw,2.6rem)","h3":"1.25rem","body":"1rem","eyebrow":"0.75rem"},
   "radius":{"sm":"8px","md":"16px","lg":"24px","xl":"32px","pill":"999px"},
   "spacing":{"section":"clamp(64px,8vw,120px)","gap":"24px","container":"1240px"},
   "button":{"radius":"999px","weight":"600","transform":"none","borderWidth":"1px"},
   "shadow":{
     "soft":"0 0 0 1px rgba(124,58,237,.22)",
     "lift":"0 12px 40px rgba(6,182,212,.14)",
     "premium":"0 0 0 1px rgba(124,58,237,.28), 0 30px 80px rgba(6,182,212,.18)",
     "card":"0 0 0 1px rgba(124,58,237,.25), 0 12px 40px rgba(6,182,212,.10)"
   },
   "motif":"grid","divider":"angle","heroStyle":"gradient","cardStyle":"glass",
   "headerStyle":"dark","grain":false,"animations":true,"marquee":true
 }'::jsonb,
 '["hero","marquee_band","stats","programs","why_choose_us","video","facilities","news","admissions_cta","contact"]'::jsonb,
 '["marquee_band","video","trust_strip"]'::jsonb,
 '[
   {"slot":"hero","prompt":"Students working with robotics and laptops in a dark modern lab lit by violet and cyan LED strips, dramatic tech atmosphere, 16:9"},
   {"slot":"video","prompt":"Wide shot of a school makerspace at night, 3D printers glowing, violet ambient light, cinematic, 16:9"},
   {"slot":"facilities","prompt":"Modern computer laboratory with rows of monitors, cyan screen glow in a dark room, clean lines, 4:3"}
 ]'::jsonb
),
(
 'future-midnight', 'future', 'Future School', 'Midnight & Mint', 2,
 'Future School · Midnight & Mint',
 'Deep midnight blue with mint accents. Calmer than violet, still unmistakably modern.',
 true, 31,
 '{
   "colors":{
     "primary":"#1E3A8A","primaryDark":"#172554","primaryDeeper":"#0B1229",
     "secondary":"#2DD4BF","accent":"#5EEAD4","accentDeep":"#0D9488","accentSoft":"#CCFBF1",
     "background":"#0A0F1F","surface":"#111A2E","surfaceAlt":"#1A2542","border":"#243149",
     "text":"#E8EEF7","textMuted":"#8FA3BF","textFaint":"#5F7characters",
     "ink":"#E8EEF7","inkDeep":"#FFFFFF",
     "headerBg":"#0A0F1F","headerText":"#E8EEF7",
     "footerBg":"#060A14","footerText":"#8FA3BF",
     "success":"#34D399","warning":"#FBBF24","error":"#F87171"
   },
   "fonts":{"heading":"Space Grotesk","body":"Inter","accent":"Space Grotesk"},
   "scale":{"h1":"clamp(2.6rem,6.5vw,4rem)","h2":"clamp(1.9rem,3.6vw,2.6rem)","h3":"1.25rem","body":"1rem","eyebrow":"0.75rem"},
   "radius":{"sm":"8px","md":"16px","lg":"24px","xl":"32px","pill":"999px"},
   "spacing":{"section":"clamp(64px,8vw,120px)","gap":"24px","container":"1240px"},
   "button":{"radius":"999px","weight":"600","transform":"none","borderWidth":"1px"},
   "shadow":{
     "soft":"0 0 0 1px rgba(45,212,191,.20)",
     "lift":"0 12px 40px rgba(45,212,191,.12)",
     "premium":"0 0 0 1px rgba(45,212,191,.26), 0 30px 80px rgba(30,58,138,.30)",
     "card":"0 0 0 1px rgba(45,212,191,.22), 0 12px 40px rgba(30,58,138,.18)"
   },
   "motif":"grid","divider":"angle","heroStyle":"gradient","cardStyle":"glass",
   "headerStyle":"dark","grain":false,"animations":true,"marquee":true
 }'::jsonb,
 '["hero","marquee_band","stats","programs","why_choose_us","video","facilities","news","admissions_cta","contact"]'::jsonb,
 '["marquee_band","video","trust_strip"]'::jsonb,
 '[
   {"slot":"hero","prompt":"Night exterior of a modern school with mint-lit windows against a midnight blue sky, long exposure, architectural, 16:9"}
 ]'::jsonb
),
(
 'future-carbon', 'future', 'Future School', 'Carbon & Electric', 3,
 'Future School · Carbon & Electric',
 'Near-black carbon with a single electric accent. Maximum contrast, minimum decoration.',
 true, 32,
 '{
   "colors":{
     "primary":"#18181B","primaryDark":"#0C0C0E","primaryDeeper":"#000000",
     "secondary":"#3F3F46","accent":"#D4FF3F","accentDeep":"#A3CC1F","accentSoft":"#ECFFB8",
     "background":"#09090B","surface":"#141417","surfaceAlt":"#1F1F23","border":"#2A2A30",
     "text":"#FAFAFA","textMuted":"#A1A1AA","textFaint":"#71717A",
     "ink":"#FAFAFA","inkDeep":"#FFFFFF",
     "headerBg":"#09090B","headerText":"#FAFAFA",
     "footerBg":"#000000","footerText":"#A1A1AA",
     "success":"#4ADE80","warning":"#FACC15","error":"#F87171"
   },
   "fonts":{"heading":"Space Grotesk","body":"Inter","accent":"Space Grotesk"},
   "scale":{"h1":"clamp(2.8rem,7vw,4.4rem)","h2":"clamp(2rem,3.8vw,2.8rem)","h3":"1.25rem","body":"1rem","eyebrow":"0.72rem"},
   "radius":{"sm":"4px","md":"8px","lg":"12px","xl":"16px","pill":"999px"},
   "spacing":{"section":"clamp(64px,8vw,128px)","gap":"20px","container":"1280px"},
   "button":{"radius":"8px","weight":"700","transform":"uppercase","borderWidth":"1px"},
   "shadow":{
     "soft":"0 0 0 1px rgba(212,255,63,.16)",
     "lift":"0 12px 40px rgba(0,0,0,.60)",
     "premium":"0 0 0 1px rgba(212,255,63,.24), 0 30px 80px rgba(0,0,0,.70)",
     "card":"0 0 0 1px rgba(42,42,48,1)"
   },
   "motif":"none","divider":"angle","heroStyle":"full-bleed","cardStyle":"flat",
   "headerStyle":"dark","grain":true,"animations":true,"marquee":true
 }'::jsonb,
 '["hero","marquee_band","stats","programs","video","facilities","news","admissions_cta","contact"]'::jsonb,
 '["marquee_band","video"]'::jsonb,
 '[
   {"slot":"hero","prompt":"High contrast black and white photograph of a school corridor with a single bright lime-yellow door, stark minimal composition, 16:9"}
 ]'::jsonb
),

-- ---------- FAMILY 5: INTERNATIONAL MINIMAL ----------
(
 'minimal-mono', 'minimal', 'International Minimal', 'Monochrome', 1,
 'International Minimal · Monochrome',
 'Restrained, premium and corporate. Lots of space, sharp edges, almost no ornament.',
 true, 40,
 '{
   "colors":{
     "primary":"#111827","primaryDark":"#000000","primaryDeeper":"#000000",
     "secondary":"#4B5563","accent":"#B91C1C","accentDeep":"#7F1D1D","accentSoft":"#FEE2E2",
     "background":"#FFFFFF","surface":"#FAFAFA","surfaceAlt":"#F3F4F6","border":"#E5E7EB",
     "text":"#111827","textMuted":"#6B7280","textFaint":"#9CA3AF",
     "ink":"#111827","inkDeep":"#000000",
     "headerBg":"#FFFFFF","headerText":"#111827",
     "footerBg":"#111827","footerText":"#D1D5DB",
     "success":"#059669","warning":"#D97706","error":"#DC2626"
   },
   "fonts":{"heading":"Montserrat","body":"Open Sans","accent":"Montserrat"},
   "scale":{"h1":"clamp(2.2rem,5vw,3.2rem)","h2":"clamp(1.7rem,3vw,2.2rem)","h3":"1.2rem","body":"1rem","eyebrow":"0.7rem"},
   "radius":{"sm":"0","md":"0","lg":"0","xl":"0","pill":"0"},
   "spacing":{"section":"clamp(72px,9vw,128px)","gap":"32px","container":"1160px"},
   "button":{"radius":"0","weight":"600","transform":"uppercase","borderWidth":"1px"},
   "shadow":{"soft":"none","lift":"none","premium":"none","card":"none"},
   "motif":"none","divider":"rule","heroStyle":"full-bleed","cardStyle":"flat",
   "headerStyle":"light","grain":false,"animations":false,"marquee":false
 }'::jsonb,
 '["hero","about","programs","stats","leadership","gallery","news","contact"]'::jsonb,
 '["leadership","key_dates"]'::jsonb,
 '[
   {"slot":"hero","prompt":"Minimal black and white architectural photograph of a school building corner against a plain sky, generous negative space, fine art photography, 16:9"},
   {"slot":"gallery","prompt":"Black and white candid of students in a bright empty corridor, strong geometry, minimal, square"},
   {"slot":"leadership","prompt":"Minimal black and white headshot against a plain white wall, even soft light, 3:4"}
 ]'::jsonb
),
(
 'minimal-sand', 'minimal', 'International Minimal', 'Sand & Charcoal', 2,
 'International Minimal · Sand & Charcoal',
 'Warm sand neutrals with charcoal type. Minimal but not cold.',
 true, 41,
 '{
   "colors":{
     "primary":"#3D3833","primaryDark":"#28241F","primaryDeeper":"#161310",
     "secondary":"#6B635A","accent":"#A87C4F","accentDeep":"#7C5A38","accentSoft":"#EADFD0",
     "background":"#FBF9F5","surface":"#F4F0E9","surfaceAlt":"#EAE4D9","border":"#DDD5C7",
     "text":"#2B2723","textMuted":"#6B635A","textFaint":"#948B7E",
     "ink":"#2B2723","inkDeep":"#161310",
     "headerBg":"#FBF9F5","headerText":"#2B2723",
     "footerBg":"#28241F","footerText":"#EADFD0",
     "success":"#4D7C0F","warning":"#A16207","error":"#B91C1C"
   },
   "fonts":{"heading":"Montserrat","body":"Open Sans","accent":"Montserrat"},
   "scale":{"h1":"clamp(2.2rem,5vw,3.2rem)","h2":"clamp(1.7rem,3vw,2.2rem)","h3":"1.2rem","body":"1rem","eyebrow":"0.7rem"},
   "radius":{"sm":"0","md":"2px","lg":"2px","xl":"2px","pill":"999px"},
   "spacing":{"section":"clamp(72px,9vw,128px)","gap":"32px","container":"1160px"},
   "button":{"radius":"2px","weight":"600","transform":"uppercase","borderWidth":"1px"},
   "shadow":{"soft":"none","lift":"0 2px 12px rgba(43,39,35,.06)","premium":"0 8px 30px rgba(43,39,35,.10)","card":"none"},
   "motif":"none","divider":"rule","heroStyle":"split-diagonal","cardStyle":"flat",
   "headerStyle":"light","grain":true,"animations":false,"marquee":false
 }'::jsonb,
 '["hero","about","programs","stats","leadership","gallery","news","contact"]'::jsonb,
 '["leadership"]'::jsonb,
 '[
   {"slot":"hero","prompt":"Warm minimal photograph of a school courtyard with sand-coloured walls and a single tree, soft even daylight, generous space, 16:9"}
 ]'::jsonb
),
(
 'minimal-nordic', 'minimal', 'International Minimal', 'Ice & Steel', 3,
 'International Minimal · Ice & Steel',
 'Cool Nordic palette. Pale ice blues, steel grey type, crisp and calm.',
 true, 42,
 '{
   "colors":{
     "primary":"#2C3E50","primaryDark":"#1B2733","primaryDeeper":"#0E151C",
     "secondary":"#5D7285","accent":"#5BA3C7","accentDeep":"#2E7898","accentSoft":"#D6EAF4",
     "background":"#FCFDFE","surface":"#F2F6F9","surfaceAlt":"#E6EDF3","border":"#D5DFE7",
     "text":"#1F2933","textMuted":"#5D7285","textFaint":"#8A9AA8",
     "ink":"#1F2933","inkDeep":"#0E151C",
     "headerBg":"#FCFDFE","headerText":"#1F2933",
     "footerBg":"#1B2733","footerText":"#D6EAF4",
     "success":"#0F766E","warning":"#B45309","error":"#B91C1C"
   },
   "fonts":{"heading":"Work Sans","body":"Open Sans","accent":"Work Sans"},
   "scale":{"h1":"clamp(2.2rem,5vw,3.2rem)","h2":"clamp(1.7rem,3vw,2.2rem)","h3":"1.2rem","body":"1rem","eyebrow":"0.7rem"},
   "radius":{"sm":"2px","md":"4px","lg":"6px","xl":"8px","pill":"999px"},
   "spacing":{"section":"clamp(72px,9vw,128px)","gap":"32px","container":"1160px"},
   "button":{"radius":"4px","weight":"600","transform":"none","borderWidth":"1px"},
   "shadow":{"soft":"none","lift":"0 2px 14px rgba(31,41,51,.07)","premium":"0 10px 34px rgba(31,41,51,.10)","card":"0 1px 2px rgba(31,41,51,.05)"},
   "motif":"dots","divider":"rule","heroStyle":"image-right","cardStyle":"bordered",
   "headerStyle":"light","grain":false,"animations":false,"marquee":false
 }'::jsonb,
 '["hero","about","programs","stats","leadership","gallery","news","faq","contact"]'::jsonb,
 '["leadership","key_dates"]'::jsonb,
 '[
   {"slot":"hero","prompt":"Bright airy school atrium with pale wood and white surfaces, soft diffused northern light, Scandinavian design, 16:9"}
 ]'::jsonb
),

-- ---------- FAMILY 6: COMMUNITY & FAITH ----------
(
 'community-olive', 'community', 'Community & Faith', 'Olive & Terracotta', 1,
 'Community & Faith · Olive & Terracotta',
 'Warm, welcoming and community-centred, with room for values and a message from leadership.',
 false, 50,
 '{
   "colors":{
     "primary":"#4F6B3A","primaryDark":"#374B28","primaryDeeper":"#1E2A15",
     "secondary":"#7A9159","accent":"#C4643C","accentDeep":"#9A4A28","accentSoft":"#F2D6C6",
     "background":"#FDFBF6","surface":"#F6F1E6","surfaceAlt":"#EBE3D2","border":"#DCD2BC",
     "text":"#26241C","textMuted":"#62604F","textFaint":"#8A8874",
     "ink":"#26241C","inkDeep":"#14130E",
     "headerBg":"#4F6B3A","headerText":"#FDFBF6",
     "footerBg":"#1E2A15","footerText":"#F2D6C6",
     "success":"#15803D","warning":"#9A4A28","error":"#B0392B"
   },
   "fonts":{"heading":"Merriweather","body":"Source Sans 3","accent":"Merriweather"},
   "scale":{"h1":"clamp(2.3rem,5.5vw,3.4rem)","h2":"clamp(1.8rem,3.2vw,2.4rem)","h3":"1.25rem","body":"1.0625rem","eyebrow":"0.75rem"},
   "radius":{"sm":"6px","md":"12px","lg":"18px","xl":"24px","pill":"999px"},
   "spacing":{"section":"clamp(56px,7vw,100px)","gap":"24px","container":"1160px"},
   "button":{"radius":"8px","weight":"600","transform":"none","borderWidth":"2px"},
   "shadow":{
     "soft":"0 1px 3px rgba(38,36,28,.08)",
     "lift":"0 8px 22px rgba(38,36,28,.10)",
     "premium":"0 18px 48px rgba(30,42,21,.18)",
     "card":"0 1px 3px rgba(38,36,28,.08)"
   },
   "motif":"dots","divider":"curve","heroStyle":"centered","cardStyle":"soft",
   "headerStyle":"dark","grain":true,"animations":true,"marquee":false
 }'::jsonb,
 '["hero","principal_message","values","why_choose_us","programs","stats","events","gallery","testimonials","news","admissions_cta","contact"]'::jsonb,
 '["values","principal_message","events","newsletter"]'::jsonb,
 '[
   {"slot":"hero","prompt":"Warm photograph of a diverse group of school children and teachers gathered under a tree in a community courtyard, olive and terracotta tones, golden hour, documentary, 16:9"},
   {"slot":"values","prompt":"Close-up of children hands stacked together in a circle, warm earthy tones, symbolising community, square"},
   {"slot":"principal_message","prompt":"Warm approachable portrait of a school principal in olive green, terracotta wall background, natural light, 3:4"}
 ]'::jsonb
),
(
 'community-sky', 'community', 'Community & Faith', 'Sky & Sunflower', 2,
 'Community & Faith · Sky & Sunflower',
 'Bright sky blue and sunflower yellow. Optimistic and family-friendly, ideal for primary schools.',
 false, 51,
 '{
   "colors":{
     "primary":"#1E6FA8","primaryDark":"#155181","primaryDeeper":"#0B3050",
     "secondary":"#4FA3D1","accent":"#F5B72E","accentDeep":"#C08A0C","accentSoft":"#FDECC0",
     "background":"#FCFDFF","surface":"#F0F7FC","surfaceAlt":"#E1EFF8","border":"#CCE2F0",
     "text":"#152736","textMuted":"#587287","textFaint":"#8AA1B3",
     "ink":"#152736","inkDeep":"#0A1622",
     "headerBg":"#1E6FA8","headerText":"#FCFDFF",
     "footerBg":"#0B3050","footerText":"#FDECC0",
     "success":"#16A34A","warning":"#C08A0C","error":"#DC2626"
   },
   "fonts":{"heading":"Nunito","body":"Source Sans 3","accent":"Nunito"},
   "scale":{"h1":"clamp(2.3rem,5.5vw,3.4rem)","h2":"clamp(1.8rem,3.2vw,2.4rem)","h3":"1.25rem","body":"1.0625rem","eyebrow":"0.75rem"},
   "radius":{"sm":"10px","md":"18px","lg":"26px","xl":"32px","pill":"999px"},
   "spacing":{"section":"clamp(56px,7vw,100px)","gap":"24px","container":"1160px"},
   "button":{"radius":"999px","weight":"700","transform":"none","borderWidth":"2px"},
   "shadow":{
     "soft":"0 2px 6px rgba(21,39,54,.08)",
     "lift":"0 10px 26px rgba(21,39,54,.12)",
     "premium":"0 20px 52px rgba(11,48,80,.18)",
     "card":"0 2px 6px rgba(21,39,54,.08)"
   },
   "motif":"dots","divider":"curve","heroStyle":"image-right","cardStyle":"soft",
   "headerStyle":"dark","grain":false,"animations":true,"marquee":false
 }'::jsonb,
 '["hero","why_choose_us","programs","stats","events","gallery","testimonials","news","admissions_cta","newsletter","contact"]'::jsonb,
 '["events","newsletter","key_dates"]'::jsonb,
 '[
   {"slot":"hero","prompt":"Joyful photograph of primary school children running on a playground under a clear blue sky, yellow play equipment, bright cheerful daylight, 16:9"},
   {"slot":"gallery","prompt":"Young children painting at a low table in a bright classroom, sky blue and sunflower yellow accents, natural light, square"}
 ]'::jsonb
),
(
 'community-rose', 'community', 'Community & Faith', 'Rose & Sage', 3,
 'Community & Faith · Rose & Sage',
 'Soft rose with sage green. Gentle and pastoral, well suited to nurseries and faith schools.',
 false, 52,
 '{
   "colors":{
     "primary":"#8B4A5C","primaryDark":"#6A3444","primaryDeeper":"#3F1D28",
     "secondary":"#B4798A","accent":"#7D9B76","accentDeep":"#59774F","accentSoft":"#D9E6D5",
     "background":"#FEFBFB","surface":"#F9F0F1","surfaceAlt":"#F0E2E4","border":"#E5D2D5",
     "text":"#2A2124","textMuted":"#6B5B60","textFaint":"#93838A",
     "ink":"#2A2124","inkDeep":"#181215",
     "headerBg":"#8B4A5C","headerText":"#FEFBFB",
     "footerBg":"#3F1D28","footerText":"#D9E6D5",
     "success":"#59774F","warning":"#A16207","error":"#B0392B"
   },
   "fonts":{"heading":"Merriweather","body":"Source Sans 3","accent":"Merriweather"},
   "scale":{"h1":"clamp(2.3rem,5.5vw,3.4rem)","h2":"clamp(1.8rem,3.2vw,2.4rem)","h3":"1.25rem","body":"1.0625rem","eyebrow":"0.75rem"},
   "radius":{"sm":"8px","md":"16px","lg":"24px","xl":"30px","pill":"999px"},
   "spacing":{"section":"clamp(56px,7vw,100px)","gap":"24px","container":"1160px"},
   "button":{"radius":"999px","weight":"600","transform":"none","borderWidth":"2px"},
   "shadow":{
     "soft":"0 2px 6px rgba(42,33,36,.07)",
     "lift":"0 10px 26px rgba(42,33,36,.10)",
     "premium":"0 20px 52px rgba(63,29,40,.16)",
     "card":"0 2px 6px rgba(42,33,36,.07)"
   },
   "motif":"dots","divider":"curve","heroStyle":"centered","cardStyle":"soft",
   "headerStyle":"dark","grain":true,"animations":true,"marquee":false
 }'::jsonb,
 '["hero","principal_message","values","why_choose_us","programs","events","gallery","testimonials","news","admissions_cta","contact"]'::jsonb,
 '["values","principal_message","events"]'::jsonb,
 '[
   {"slot":"hero","prompt":"Soft gentle photograph of a nursery school reading corner with rose and sage cushions, warm diffused light, calm and nurturing, 16:9"},
   {"slot":"values","prompt":"Soft focus image of a teacher kneeling to help a small child, rose and sage tones, tender natural light, square"}
 ]'::jsonb
)
ON CONFLICT (key) DO UPDATE SET
  family = EXCLUDED.family,
  family_label = EXCLUDED.family_label,
  variant_label = EXCLUDED.variant_label,
  variant_order = EXCLUDED.variant_order,
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  is_premium = EXCLUDED.is_premium,
  sort_order = EXCLUDED.sort_order,
  tokens = EXCLUDED.tokens,
  default_sections = EXCLUDED.default_sections,
  signature_sections = EXCLUDED.signature_sections,
  lifestyle_prompts = EXCLUDED.lifestyle_prompts;

-- ==========================================================
-- 4. BACKFILL FAMILY DATA ON THE ORIGINAL FIVE THEMES
-- ==========================================================
-- The five themes from website_module.sql are kept so existing
-- sites do not break, but they are hidden from the picker and
-- mapped onto their nearest new equivalent.
UPDATE website_themes SET active = false
WHERE key IN ('modern-academy','classic-excellence','future-school','international-minimal','community-faith');

-- Remap any site still using an old key
UPDATE websites SET theme_key = 'modern-cobalt'   WHERE theme_key = 'modern-academy';
UPDATE websites SET theme_key = 'classic-navy'    WHERE theme_key = 'classic-excellence';
UPDATE websites SET theme_key = 'future-violet'   WHERE theme_key = 'future-school';
UPDATE websites SET theme_key = 'minimal-mono'    WHERE theme_key = 'international-minimal';
UPDATE websites SET theme_key = 'community-olive' WHERE theme_key = 'community-faith';

-- ==========================================================
-- 5. NEW SECTION DEFAULT CONTENT
-- ==========================================================
-- Extend default_section_content() with the section types the
-- heritage family introduces.
CREATE OR REPLACE FUNCTION default_section_content(p_type text, p_school text)
RETURNS jsonb
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE p_type
    WHEN 'hero' THEN jsonb_build_object(
      'eyebrow', 'Welcome',
      'heading', 'Welcome to ' || p_school,
      'subheading', 'A community where every child is known, challenged and supported.',
      'primary_cta_label', 'Apply for Admission', 'primary_cta_href', '/admissions',
      'secondary_cta_label', 'Book a Tour', 'secondary_cta_href', '/contact',
      'image_url', '', 'image_alt', '',
      'badge_initials', upper(left(p_school, 2)), 'badge_caption', 'Est. tradition',
      'trust_chips', jsonb_build_array('British & Nigerian curriculum','Small class sizes','Safe campus'),
      'stats', jsonb_build_array(
        jsonb_build_object('value','1,200','label','Students'),
        jsonb_build_object('value','85','label','Teachers'),
        jsonb_build_object('value','98%','label','Pass rate'),
        jsonb_build_object('value','25','label','Years of service')))
    WHEN 'marquee_band' THEN jsonb_build_object(
      'items', jsonb_build_array('Est. Community','British & Nigerian Curriculum','Small Class Sizes','Safe Campus','Enrolling Now'),
      'speed', 30)
    WHEN 'trust_strip' THEN jsonb_build_object(
      'items', jsonb_build_array('Accredited','Small class sizes','Qualified teachers','Safe campus'))
    WHEN 'journey' THEN jsonb_build_object(
      'eyebrow', 'How admissions works',
      'heading', 'Five steps from enquiry to enrolment',
      'body', 'A straightforward process, with a real person guiding you at every stage.',
      'items', jsonb_build_array(
        jsonb_build_object('title','Enquire','body','Send a message or call - we will ask a few questions about your child.'),
        jsonb_build_object('title','Visit','body','Tour the campus, meet staff and see a class in session.'),
        jsonb_build_object('title','Assess','body','A short, age-appropriate placement assessment for the right year group.'),
        jsonb_build_object('title','Offer','body','We confirm a place and walk you through fees and requirements.'),
        jsonb_build_object('title','Enrol','body','Complete registration and welcome pack - your child is ready to start.')))
    WHEN 'houses' THEN jsonb_build_object(
      'eyebrow', 'Our houses',
      'heading', 'Four houses, one school spirit',
      'body', 'Every student is placed in a house from their first week - for sport, service and friendly competition.',
      'items', jsonb_build_array(
        jsonb_build_object('name','Baobab','motto','Resilience & strength','color','#1F4736'),
        jsonb_build_object('name','Iroko','motto','Leadership & integrity','color','#6E1F30'),
        jsonb_build_object('name','Acacia','motto','Creativity & curiosity','color','#B9800D'),
        jsonb_build_object('name','Palm','motto','Service & community','color','#26365E')))
    WHEN 'leadership' THEN jsonb_build_object(
      'eyebrow', 'Leadership',
      'heading', 'The team guiding ' || p_school,
      'items', jsonb_build_array(
        jsonb_build_object('name','','role','Principal','image_url',''),
        jsonb_build_object('name','','role','Vice Principal (Academics)','image_url',''),
        jsonb_build_object('name','','role','Head of Primary','image_url','')))
    WHEN 'key_dates' THEN jsonb_build_object(
      'eyebrow', 'Diary',
      'heading', 'Key dates this term',
      'items', jsonb_build_array(
        jsonb_build_object('day','15','month','Oct','title','Inter-House Sports','detail','School sports field, 9am'),
        jsonb_build_object('day','02','month','Nov','title','Parent-Teacher Conference','detail','By appointment'),
        jsonb_build_object('day','12','month','Dec','title','End of Term','detail','Half day, 12pm close')))
    WHEN 'newsletter' THEN jsonb_build_object(
      'heading', 'Stay in the loop',
      'body', 'Term dates, events and school news - straight to your inbox. No more than once a month.',
      'cta_label', 'Subscribe',
      'form_key', 'newsletter')
    WHEN 'page_header' THEN jsonb_build_object('heading', '', 'subheading', '', 'eyebrow', '')
    WHEN 'about' THEN jsonb_build_object(
      'eyebrow', 'About us',
      'heading', 'About ' || p_school,
      'body', 'Tell your story here: when the school was founded, what it stands for, and what makes it different. Replace this text in Website Studio.',
      'image_url', '', 'image_alt', '')
    WHEN 'principal_message' THEN jsonb_build_object(
      'eyebrow', 'From the top',
      'heading', 'A message from our Principal',
      'body', 'Share a short welcome from the head of school.',
      'author_name', '', 'author_title', 'Principal',
      'image_url', '', 'image_alt', '')
    WHEN 'why_choose_us' THEN jsonb_build_object(
      'eyebrow', 'Why us',
      'heading', 'Known, challenged and supported - at every stage',
      'items', jsonb_build_array(
        jsonb_build_object('title','Experienced teachers','body','Qualified staff who know every child by name.','icon','users'),
        jsonb_build_object('title','Strong results','body','Consistent academic achievement across every year group.','icon','award'),
        jsonb_build_object('title','Safe environment','body','A secure, caring campus with pastoral support.','icon','shield')))
    WHEN 'values' THEN jsonb_build_object(
      'eyebrow', 'Our values',
      'heading', 'What we stand for',
      'items', jsonb_build_array(
        jsonb_build_object('title','Respect','body','For ourselves, each other and our community.','icon','heart'),
        jsonb_build_object('title','Excellence','body','Doing ordinary things extraordinarily well.','icon','star'),
        jsonb_build_object('title','Service','body','Using what we learn for the good of others.','icon','users')))
    WHEN 'programs' THEN jsonb_build_object(
      'eyebrow', 'Our programmes',
      'heading', 'A clear path from first steps to final exams',
      'body', 'Every stage builds directly on the one before it.',
      'numbered', true,
      'items', jsonb_build_array(
        jsonb_build_object('title','Early Years','body','Play-based foundations in literacy and numeracy.','image_url',''),
        jsonb_build_object('title','Primary','body','A broad curriculum building confident learners.','image_url',''),
        jsonb_build_object('title','Secondary','body','Rigorous preparation for national examinations.','image_url','')))
    WHEN 'stats' THEN jsonb_build_object(
      'eyebrow', 'At a glance',
      'heading', p_school || ' in numbers',
      'count_up', true,
      'items', jsonb_build_array(
        jsonb_build_object('value','1200','suffix','','label','Students'),
        jsonb_build_object('value','85','suffix','','label','Teachers'),
        jsonb_build_object('value','98','suffix','%','label','Pass rate'),
        jsonb_build_object('value','30','suffix','+','label','Clubs & societies'),
        jsonb_build_object('value','25','suffix','','label','Years of service')))
    WHEN 'achievements' THEN jsonb_build_object(
      'eyebrow', 'Achievements',
      'heading', 'Recognition and results',
      'items', jsonb_build_array(
        jsonb_build_object('title','Regional champions','body','First place in the state mathematics olympiad.','image_url','')))
    WHEN 'facilities' THEN jsonb_build_object(
      'eyebrow', 'Campus',
      'heading', 'Our facilities',
      'items', jsonb_build_array(
        jsonb_build_object('title','Science laboratories','body','Fully equipped physics, chemistry and biology labs.','image_url',''),
        jsonb_build_object('title','Library','body','A quiet space with a growing collection.','image_url',''),
        jsonb_build_object('title','Sports field','body','Room for football, athletics and inter-house sports.','image_url','')))
    WHEN 'gallery' THEN jsonb_build_object(
      'eyebrow', 'Campus life',
      'heading', 'Life at ' || p_school,
      'body', 'Campus photography is on its way.',
      'images', '[]'::jsonb)
    WHEN 'testimonials' THEN jsonb_build_object(
      'eyebrow', 'In their words',
      'heading', 'What parents say',
      'carousel', true,
      'items', jsonb_build_array(
        jsonb_build_object('quote','The teachers genuinely care. Our daughter has grown in confidence.','author','Parent','role','Primary 4')))
    WHEN 'staff' THEN jsonb_build_object(
      'eyebrow', 'Our people',
      'heading', 'Meet our staff', 'items', '[]'::jsonb)
    WHEN 'news' THEN jsonb_build_object(
      'eyebrow', 'Latest',
      'heading', 'What is happening at ' || p_school, 'limit', 3, 'show_all_link', true)
    WHEN 'events' THEN jsonb_build_object(
      'eyebrow', 'Diary',
      'heading', 'Upcoming events', 'limit', 3, 'show_all_link', true)
    WHEN 'admissions_cta' THEN jsonb_build_object(
      'eyebrow', 'Admissions',
      'heading', 'Admissions are open',
      'body', 'Start an application or arrange a visit. We would be glad to meet you.',
      'cta_label', 'Apply now', 'cta_href', '/admissions',
      'secondary_label', 'Talk to us', 'secondary_href', '/contact')
    WHEN 'video' THEN jsonb_build_object(
      'eyebrow', 'Watch',
      'heading', 'Take a look around', 'embed_url', '', 'caption', '')
    WHEN 'faq' THEN jsonb_build_object(
      'eyebrow', 'Questions',
      'heading', 'Frequently asked questions',
      'items', jsonb_build_array(
        jsonb_build_object('q','When does the school year start?','a','Please contact the school office for current term dates.'),
        jsonb_build_object('q','What are the class sizes?','a','We cap classes to keep teaching personal.'),
        jsonb_build_object('q','Do you offer transport?','a','Contact the office to discuss routes.')))
    WHEN 'contact' THEN jsonb_build_object(
      'eyebrow', 'Get in touch',
      'heading', 'Send us a message',
      'body', 'Send us a message and we will reply as soon as we can.',
      'form_key', 'contact', 'show_map', false, 'map_embed_url', '')
    WHEN 'rich_text' THEN jsonb_build_object('eyebrow','', 'heading', '', 'body', '')
    WHEN 'cta_banner' THEN jsonb_build_object(
      'heading', '', 'body', '', 'cta_label', '', 'cta_href', '')
    ELSE '{}'::jsonb
  END;
$$;

GRANT EXECUTE ON FUNCTION default_section_content(text, text) TO authenticated;

-- ==========================================================
-- 6. NEWSLETTER FORM FOR NEW SITES
-- ==========================================================
INSERT INTO website_forms (organization_id, website_id, key, name, destination, fields, success_message)
SELECT w.organization_id, w.id, 'newsletter', 'Newsletter', 'enquiry',
  '[{"name":"email","label":"Email address","type":"email","required":true}]'::jsonb,
  'You are on the list. Thank you.'
FROM websites w
WHERE NOT EXISTS (
  SELECT 1 FROM website_forms f WHERE f.website_id = w.id AND f.key = 'newsletter'
)
ON CONFLICT (website_id, key) DO NOTHING;

-- ==========================================================
-- 7. THEME LIST RPC (grouped by family, for the studio)
-- ==========================================================
CREATE OR REPLACE FUNCTION list_theme_families()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(fam ORDER BY fam->>'sort_order'), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
      'family', t.family,
      'label', min(t.family_label),
      'sort_order', min(t.sort_order),
      'variants', jsonb_agg(
        jsonb_build_object(
          'key', t.key,
          'name', t.name,
          'variant_label', t.variant_label,
          'description', t.description,
          'is_premium', t.is_premium,
          'tokens', t.tokens,
          'default_sections', t.default_sections,
          'signature_sections', t.signature_sections,
          'lifestyle_prompts', t.lifestyle_prompts
        ) ORDER BY t.variant_order
      )
    ) AS fam
    FROM website_themes t
    WHERE t.active = true AND t.family IS NOT NULL
    GROUP BY t.family
  ) grouped;
$$;

GRANT EXECUTE ON FUNCTION list_theme_families() TO authenticated, anon;


-- ==========================================================
-- 8. UPDATE get_public_page TO RETURN THE NEW SECTION FIELDS
-- ==========================================================
-- Sections gained eyebrow and anchor_id. Without this the renderer
-- never sees them.
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
