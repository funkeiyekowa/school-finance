-- ============================================================
-- WEBSITE & DIGITAL PRESENCE MODULE
-- Run AFTER saas_foundation.sql.
--
-- The public school website is a tenant-owned resource, not a
-- separate product bolted on the side. Every table here carries
-- organization_id and is protected by the same RLS pattern as
-- students or income.
--
-- Two audiences read these tables:
--   1. Signed-in school staff editing their site (org-scoped).
--   2. Anonymous visitors reading the PUBLISHED site. Anonymous
--      read is deliberately allowed, but ONLY for rows whose
--      status is 'published' AND whose site is published. Draft
--      content is never publicly readable.
--
-- A theme is data, not code: tokens live in the database and are
-- rendered to CSS custom properties. Adding a theme is an INSERT,
-- not a deployment.
-- ============================================================

-- ==========================================================
-- 1. THEME CATALOGUE (platform-level, shared by all tenants)
-- ==========================================================
CREATE TABLE IF NOT EXISTS website_themes (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  preview_image_url text,
  /* Design tokens. Rendered to CSS variables at request time, so a
     school's brand overrides merge cleanly on top. */
  tokens jsonb NOT NULL DEFAULT '{}',
  /* Section layout defaults this theme suggests for a new site. */
  default_sections jsonb NOT NULL DEFAULT '[]',
  is_premium boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- ==========================================================
-- 2. THE SITE ITSELF (one per organization)
-- ==========================================================
CREATE TABLE IF NOT EXISTS websites (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  theme_key text NOT NULL DEFAULT 'modern-academy' REFERENCES website_themes(key) ON UPDATE CASCADE,

  -- Identity
  site_name text NOT NULL DEFAULT 'Our School',
  tagline text,
  logo_url text,
  favicon_url text,

  /* Brand overrides layered over the theme tokens. Anything absent
     falls through to the theme. */
  brand jsonb NOT NULL DEFAULT '{}',
  typography jsonb NOT NULL DEFAULT '{}',

  -- Contact block, reused by the footer, contact section and schema.org
  contact jsonb NOT NULL DEFAULT '{}',
  social jsonb NOT NULL DEFAULT '{}',

  -- SEO defaults
  seo jsonb NOT NULL DEFAULT '{}',

  -- Publication
  status text NOT NULL DEFAULT 'draft',   -- 'draft' | 'published'
  published_at timestamptz,
  /* Subdomain label: <subdomain>.<platform domain>. Globally unique
     because it is a hostname. */
  subdomain text UNIQUE,
  maintenance_mode boolean NOT NULL DEFAULT false,

  /* Which dynamic feeds the site is allowed to surface. */
  features jsonb NOT NULL DEFAULT '{"news":true,"events":true,"admissions":true,"contact_form":true,"gallery":true}',

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (organization_id)
);

CREATE INDEX IF NOT EXISTS idx_websites_org ON websites(organization_id);
CREATE INDEX IF NOT EXISTS idx_websites_subdomain ON websites(subdomain) WHERE subdomain IS NOT NULL;

-- ==========================================================
-- 3. CUSTOM DOMAINS
-- ==========================================================
-- Host -> tenant resolution. UNIQUE on hostname is what guarantees
-- one domain can never resolve to two schools.
CREATE TABLE IF NOT EXISTS website_domains (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  website_id uuid NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  hostname text NOT NULL UNIQUE,          -- 'www.greenfield.edu'
  is_primary boolean NOT NULL DEFAULT false,
  verification_token text NOT NULL DEFAULT replace(uuid_generate_v4()::text, '-', ''),
  verified boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  ssl_status text NOT NULL DEFAULT 'pending',  -- 'pending' | 'active' | 'error'
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_domains_host ON website_domains(lower(hostname));
CREATE INDEX IF NOT EXISTS idx_domains_org ON website_domains(organization_id);
-- At most one primary domain per site.
CREATE UNIQUE INDEX IF NOT EXISTS idx_domains_one_primary
  ON website_domains(website_id) WHERE is_primary = true;

-- ==========================================================
-- 4. PAGES
-- ==========================================================
CREATE TABLE IF NOT EXISTS website_pages (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  website_id uuid NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  slug text NOT NULL,                     -- '' is the home page
  title text NOT NULL,
  /* 'standard' pages are section-built. 'news_index', 'event_index'
     and 'contact' render a built-in dynamic body. */
  page_type text NOT NULL DEFAULT 'standard',
  status text NOT NULL DEFAULT 'draft',   -- 'draft' | 'published'
  show_in_nav boolean NOT NULL DEFAULT true,
  nav_label text,
  nav_order integer NOT NULL DEFAULT 0,
  parent_id uuid REFERENCES website_pages(id) ON DELETE SET NULL,
  seo jsonb NOT NULL DEFAULT '{}',
  published_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  -- Slugs are unique within a site, not globally: two schools may
  -- both have /admissions.
  UNIQUE (website_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_pages_site ON website_pages(website_id);
CREATE INDEX IF NOT EXISTS idx_pages_org ON website_pages(organization_id);

-- ==========================================================
-- 5. SECTIONS (the block builder)
-- ==========================================================
CREATE TABLE IF NOT EXISTS website_sections (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  website_id uuid NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  page_id uuid NOT NULL REFERENCES website_pages(id) ON DELETE CASCADE,
  /* Matches a key in the front-end section registry. Unknown types
     are skipped by the renderer rather than crashing the page. */
  section_type text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  visible boolean NOT NULL DEFAULT true,
  /* All editable copy, images and settings for this block. */
  content jsonb NOT NULL DEFAULT '{}',
  /* Per-instance appearance overrides (background, padding, alignment). */
  style jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sections_page ON website_sections(page_id, position);
CREATE INDEX IF NOT EXISTS idx_sections_org ON website_sections(organization_id);

-- ==========================================================
-- 6. MEDIA LIBRARY
-- ==========================================================
CREATE TABLE IF NOT EXISTS website_media (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  folder text NOT NULL DEFAULT 'general',
  file_name text NOT NULL,
  /* Public URL. Supabase Storage paths are prefixed with the org id
     so the bucket is partitioned per tenant as well. */
  url text NOT NULL,
  storage_path text,
  mime_type text,
  size_bytes bigint,
  width integer,
  height integer,
  /* Accessibility is not optional: alt text is prompted for in the
     studio and surfaced on every rendered image. */
  alt_text text,
  caption text,
  tags text[] DEFAULT '{}',
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_media_org ON website_media(organization_id, folder);

-- ==========================================================
-- 7. NEWS / ARTICLES
-- ==========================================================
CREATE TABLE IF NOT EXISTS website_news (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  website_id uuid REFERENCES websites(id) ON DELETE CASCADE,
  slug text NOT NULL,
  title text NOT NULL,
  excerpt text,
  body text,
  cover_image_url text,
  category text,
  author_name text,
  status text NOT NULL DEFAULT 'draft',   -- 'draft' | 'in_review' | 'published'
  featured boolean NOT NULL DEFAULT false,
  published_at timestamptz,
  /* Approval workflow: who signed it off. */
  submitted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (organization_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_news_org ON website_news(organization_id, status, published_at DESC);

-- ==========================================================
-- 8. EVENTS
-- ==========================================================
CREATE TABLE IF NOT EXISTS website_events (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  website_id uuid REFERENCES websites(id) ON DELETE CASCADE,
  slug text NOT NULL,
  title text NOT NULL,
  description text,
  location text,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  all_day boolean NOT NULL DEFAULT false,
  cover_image_url text,
  category text,
  status text NOT NULL DEFAULT 'draft',   -- 'draft' | 'published' | 'cancelled'
  /* Also show this in the internal announcement feed / portals. */
  publish_internally boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (organization_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_events_org ON website_events(organization_id, status, starts_at);

-- ==========================================================
-- 9. FORMS + SUBMISSIONS (the front door into the SaaS)
-- ==========================================================
CREATE TABLE IF NOT EXISTS website_forms (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  website_id uuid NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  key text NOT NULL,                      -- 'contact', 'admissions', 'prospectus', 'tour'
  name text NOT NULL,
  description text,
  /* Field definitions: [{name,label,type,required,options[]}] */
  fields jsonb NOT NULL DEFAULT '[]',
  /* Where a submission lands inside the product. */
  destination text NOT NULL DEFAULT 'enquiry',  -- 'enquiry' | 'admission' | 'prospectus' | 'tour'
  notify_emails text[] DEFAULT '{}',
  success_message text DEFAULT 'Thank you. We will be in touch shortly.',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE (website_id, key)
);

CREATE TABLE IF NOT EXISTS website_submissions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  form_id uuid REFERENCES website_forms(id) ON DELETE SET NULL,
  form_key text,
  /* Submitted answers, keyed by field name. */
  data jsonb NOT NULL DEFAULT '{}',
  -- Denormalised for the leads table and for de-duplication
  contact_name text,
  contact_email text,
  contact_phone text,
  subject text,
  message text,
  /* Lead pipeline */
  status text NOT NULL DEFAULT 'new',     -- 'new' | 'contacted' | 'qualified' | 'converted' | 'closed'
  assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notes text,
  source_page text,
  user_agent text,
  /* Spam controls */
  is_spam boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_submissions_org ON website_submissions(organization_id, status, created_at DESC);

-- ==========================================================
-- 10. NAVIGATION
-- ==========================================================
CREATE TABLE IF NOT EXISTS website_nav_items (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  website_id uuid NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  menu text NOT NULL DEFAULT 'primary',   -- 'primary' | 'footer' | 'utility'
  label text NOT NULL,
  /* Either an internal page or an explicit href. */
  page_id uuid REFERENCES website_pages(id) ON DELETE CASCADE,
  href text,
  position integer NOT NULL DEFAULT 0,
  parent_id uuid REFERENCES website_nav_items(id) ON DELETE CASCADE,
  open_in_new_tab boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nav_site ON website_nav_items(website_id, menu, position);

-- ==========================================================
-- 11. VERSION HISTORY
-- ==========================================================
-- A full snapshot of the site (settings + pages + sections + nav)
-- so an administrator can undo a bad editing session.
CREATE TABLE IF NOT EXISTS website_versions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  website_id uuid NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  label text,
  snapshot jsonb NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_email text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_versions_site ON website_versions(website_id, created_at DESC);

-- ==========================================================
-- 12. updated_at TRIGGERS
-- ==========================================================
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['websites','website_pages','website_sections','website_news','website_events','website_submissions']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_touch_%1$s ON %1$s', t);
    EXECUTE format(
      'CREATE TRIGGER trg_touch_%1$s BEFORE UPDATE ON %1$s
       FOR EACH ROW EXECUTE FUNCTION touch_updated_at()', t);
  END LOOP;
END $$;

-- ==========================================================
-- 13. ROW LEVEL SECURITY
-- ==========================================================
ALTER TABLE website_themes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE websites            ENABLE ROW LEVEL SECURITY;
ALTER TABLE website_domains     ENABLE ROW LEVEL SECURITY;
ALTER TABLE website_pages       ENABLE ROW LEVEL SECURITY;
ALTER TABLE website_sections    ENABLE ROW LEVEL SECURITY;
ALTER TABLE website_media       ENABLE ROW LEVEL SECURITY;
ALTER TABLE website_news        ENABLE ROW LEVEL SECURITY;
ALTER TABLE website_events      ENABLE ROW LEVEL SECURITY;
ALTER TABLE website_forms       ENABLE ROW LEVEL SECURITY;
ALTER TABLE website_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE website_nav_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE website_versions    ENABLE ROW LEVEL SECURITY;

-- --- Theme catalogue: readable by anyone (needed to render), writable
--     only by platform admins.
DROP POLICY IF EXISTS "themes_read" ON website_themes;
DROP POLICY IF EXISTS "themes_write" ON website_themes;
CREATE POLICY "themes_read" ON website_themes FOR SELECT USING (true);
CREATE POLICY "themes_write" ON website_themes FOR ALL
  USING (is_platform_admin()) WITH CHECK (is_platform_admin());

-- --- websites
DROP POLICY IF EXISTS "websites_public_read" ON websites;
DROP POLICY IF EXISTS "websites_tenant_read" ON websites;
DROP POLICY IF EXISTS "websites_tenant_write" ON websites;
-- Anonymous visitors may read a site only once it is published.
CREATE POLICY "websites_public_read" ON websites FOR SELECT
  USING (status = 'published');
-- Staff of the owning school always see their own site, draft or not.
CREATE POLICY "websites_tenant_read" ON websites FOR SELECT
  USING (organization_id = current_user_org_id());
CREATE POLICY "websites_tenant_write" ON websites FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

-- --- domains: hostname lookup must work before anyone is signed in.
DROP POLICY IF EXISTS "domains_public_read" ON website_domains;
DROP POLICY IF EXISTS "domains_tenant_all" ON website_domains;
CREATE POLICY "domains_public_read" ON website_domains FOR SELECT
  USING (verified = true);
CREATE POLICY "domains_tenant_all" ON website_domains FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

-- --- pages: published pages of published sites are public.
DROP POLICY IF EXISTS "pages_public_read" ON website_pages;
DROP POLICY IF EXISTS "pages_tenant_all" ON website_pages;
CREATE POLICY "pages_public_read" ON website_pages FOR SELECT
  USING (
    status = 'published'
    AND EXISTS (SELECT 1 FROM websites w
                WHERE w.id = website_pages.website_id AND w.status = 'published')
  );
CREATE POLICY "pages_tenant_all" ON website_pages FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

-- --- sections: visible sections of published pages are public.
DROP POLICY IF EXISTS "sections_public_read" ON website_sections;
DROP POLICY IF EXISTS "sections_tenant_all" ON website_sections;
CREATE POLICY "sections_public_read" ON website_sections FOR SELECT
  USING (
    visible = true
    AND EXISTS (
      SELECT 1 FROM website_pages p
      JOIN websites w ON w.id = p.website_id
      WHERE p.id = website_sections.page_id
        AND p.status = 'published' AND w.status = 'published'
    )
  );
CREATE POLICY "sections_tenant_all" ON website_sections FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

-- --- media: public, because rendered pages reference it. Note this
--     exposes only metadata rows; the files themselves are governed
--     by Storage bucket policies.
DROP POLICY IF EXISTS "media_public_read" ON website_media;
DROP POLICY IF EXISTS "media_tenant_all" ON website_media;
CREATE POLICY "media_public_read" ON website_media FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM websites w
            WHERE w.organization_id = website_media.organization_id
              AND w.status = 'published')
  );
CREATE POLICY "media_tenant_all" ON website_media FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

-- --- news
DROP POLICY IF EXISTS "news_public_read" ON website_news;
DROP POLICY IF EXISTS "news_tenant_all" ON website_news;
CREATE POLICY "news_public_read" ON website_news FOR SELECT
  USING (
    status = 'published'
    AND published_at IS NOT NULL
    AND published_at <= now()
    AND EXISTS (SELECT 1 FROM websites w
                WHERE w.organization_id = website_news.organization_id
                  AND w.status = 'published')
  );
CREATE POLICY "news_tenant_all" ON website_news FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

-- --- events
DROP POLICY IF EXISTS "events_public_read" ON website_events;
DROP POLICY IF EXISTS "events_tenant_all" ON website_events;
CREATE POLICY "events_public_read" ON website_events FOR SELECT
  USING (
    status = 'published'
    AND EXISTS (SELECT 1 FROM websites w
                WHERE w.organization_id = website_events.organization_id
                  AND w.status = 'published')
  );
CREATE POLICY "events_tenant_all" ON website_events FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

-- --- forms: definitions are public so the form can render.
DROP POLICY IF EXISTS "forms_public_read" ON website_forms;
DROP POLICY IF EXISTS "forms_tenant_all" ON website_forms;
CREATE POLICY "forms_public_read" ON website_forms FOR SELECT
  USING (
    active = true
    AND EXISTS (SELECT 1 FROM websites w
                WHERE w.id = website_forms.website_id AND w.status = 'published')
  );
CREATE POLICY "forms_tenant_all" ON website_forms FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

-- --- submissions: the public may WRITE but never READ. An enquiry
--     from a parent must not be visible to the next visitor.
DROP POLICY IF EXISTS "submissions_public_insert" ON website_submissions;
DROP POLICY IF EXISTS "submissions_tenant_read" ON website_submissions;
DROP POLICY IF EXISTS "submissions_tenant_write" ON website_submissions;
CREATE POLICY "submissions_public_insert" ON website_submissions FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM websites w
            WHERE w.organization_id = website_submissions.organization_id
              AND w.status = 'published')
  );
CREATE POLICY "submissions_tenant_read" ON website_submissions FOR SELECT
  USING (organization_id = current_user_org_id());
CREATE POLICY "submissions_tenant_update" ON website_submissions FOR UPDATE
  USING (organization_id = current_user_org_id());
CREATE POLICY "submissions_tenant_delete" ON website_submissions FOR DELETE
  USING (organization_id = current_user_org_id());

-- --- navigation
DROP POLICY IF EXISTS "nav_public_read" ON website_nav_items;
DROP POLICY IF EXISTS "nav_tenant_all" ON website_nav_items;
CREATE POLICY "nav_public_read" ON website_nav_items FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM websites w
            WHERE w.id = website_nav_items.website_id AND w.status = 'published')
  );
CREATE POLICY "nav_tenant_all" ON website_nav_items FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

-- --- versions: never public.
DROP POLICY IF EXISTS "versions_tenant_all" ON website_versions;
CREATE POLICY "versions_tenant_all" ON website_versions FOR ALL
  USING (organization_id = current_user_org_id())
  WITH CHECK (organization_id = current_user_org_id());

-- ==========================================================
-- 14. SEED THEMES
-- ==========================================================
-- Themes are rows. Each supplies a full token set; a school's brand
-- overrides are merged on top at render time.
INSERT INTO website_themes (key, name, description, is_premium, sort_order, tokens, default_sections) VALUES
(
  'modern-academy', 'Modern Academy',
  'Large photography, clean sans-serif type, generous white space and soft cards.',
  false, 1,
  '{
    "colors": {
      "primary": "#1D4ED8", "primaryDark": "#1E3A8A", "secondary": "#0EA5E9",
      "accent": "#F59E0B", "background": "#FFFFFF", "surface": "#F8FAFC",
      "surfaceAlt": "#EFF6FF", "text": "#0F172A", "textMuted": "#64748B",
      "border": "#E2E8F0", "headerBg": "#FFFFFF", "headerText": "#0F172A",
      "footerBg": "#0F172A", "footerText": "#CBD5E1",
      "success": "#16A34A", "warning": "#D97706", "error": "#DC2626"
    },
    "fonts": { "heading": "Poppins", "body": "Inter", "accent": "Inter" },
    "scale": { "h1": "3rem", "h2": "2.125rem", "h3": "1.5rem", "body": "1rem" },
    "radius": { "sm": "0.375rem", "md": "0.75rem", "lg": "1.25rem", "pill": "9999px" },
    "spacing": { "section": "5rem", "gap": "1.5rem" },
    "button": { "radius": "0.75rem", "weight": "600", "transform": "none" },
    "shadow": { "card": "0 1px 3px rgba(15,23,42,.08), 0 8px 24px rgba(15,23,42,.06)" },
    "headerStyle": "light", "heroStyle": "image-right"
  }'::jsonb,
  '["hero","why_choose_us","programs","stats","gallery","news","testimonials","admissions_cta","contact"]'::jsonb
),
(
  'classic-excellence', 'Classic Excellence',
  'Elegant serif headings, navy and gold, a traditional and established feel.',
  false, 2,
  '{
    "colors": {
      "primary": "#0F2A47", "primaryDark": "#0A1D33", "secondary": "#1B3E63",
      "accent": "#C9A227", "background": "#FFFDF8", "surface": "#FBF6E8",
      "surfaceAlt": "#F4E9C7", "text": "#111827", "textMuted": "#6B6355",
      "border": "#E7DCC3", "headerBg": "#0F2A47", "headerText": "#FFFFFF",
      "footerBg": "#0A1D33", "footerText": "#E7DCC3",
      "success": "#15803D", "warning": "#B45309", "error": "#B91C1C"
    },
    "fonts": { "heading": "Playfair Display", "body": "Lato", "accent": "Cormorant Garamond" },
    "scale": { "h1": "3.25rem", "h2": "2.25rem", "h3": "1.5rem", "body": "1.0625rem" },
    "radius": { "sm": "0.125rem", "md": "0.25rem", "lg": "0.5rem", "pill": "9999px" },
    "spacing": { "section": "5.5rem", "gap": "1.75rem" },
    "button": { "radius": "0.25rem", "weight": "700", "transform": "uppercase" },
    "shadow": { "card": "0 1px 2px rgba(15,42,71,.10)" },
    "headerStyle": "dark", "heroStyle": "centered"
  }'::jsonb,
  '["hero","principal_message","why_choose_us","programs","achievements","gallery","testimonials","news","admissions_cta","contact"]'::jsonb
),
(
  'future-school', 'Future School',
  'Technology-forward. Dark sections, gradients and bold statistics.',
  true, 3,
  '{
    "colors": {
      "primary": "#7C3AED", "primaryDark": "#4C1D95", "secondary": "#06B6D4",
      "accent": "#22D3EE", "background": "#0B1020", "surface": "#141B2E",
      "surfaceAlt": "#1E2740", "text": "#F1F5F9", "textMuted": "#94A3B8",
      "border": "#293449", "headerBg": "#0B1020", "headerText": "#F1F5F9",
      "footerBg": "#070B16", "footerText": "#94A3B8",
      "success": "#34D399", "warning": "#FBBF24", "error": "#F87171"
    },
    "fonts": { "heading": "Space Grotesk", "body": "Inter", "accent": "Inter" },
    "scale": { "h1": "3.5rem", "h2": "2.25rem", "h3": "1.5rem", "body": "1rem" },
    "radius": { "sm": "0.5rem", "md": "1rem", "lg": "1.5rem", "pill": "9999px" },
    "spacing": { "section": "6rem", "gap": "1.5rem" },
    "button": { "radius": "9999px", "weight": "600", "transform": "none" },
    "shadow": { "card": "0 0 0 1px rgba(124,58,237,.25), 0 12px 40px rgba(6,182,212,.10)" },
    "headerStyle": "dark", "heroStyle": "gradient"
  }'::jsonb,
  '["hero","stats","programs","why_choose_us","video","facilities","news","admissions_cta","contact"]'::jsonb
),
(
  'international-minimal', 'International Minimal',
  'Restrained, premium and corporate. Lots of space, very little ornament.',
  true, 4,
  '{
    "colors": {
      "primary": "#111827", "primaryDark": "#000000", "secondary": "#4B5563",
      "accent": "#B91C1C", "background": "#FFFFFF", "surface": "#FAFAFA",
      "surfaceAlt": "#F3F4F6", "text": "#111827", "textMuted": "#6B7280",
      "border": "#E5E7EB", "headerBg": "#FFFFFF", "headerText": "#111827",
      "footerBg": "#111827", "footerText": "#D1D5DB",
      "success": "#059669", "warning": "#D97706", "error": "#DC2626"
    },
    "fonts": { "heading": "Montserrat", "body": "Open Sans", "accent": "Montserrat" },
    "scale": { "h1": "2.75rem", "h2": "2rem", "h3": "1.375rem", "body": "1rem" },
    "radius": { "sm": "0", "md": "0", "lg": "0", "pill": "0" },
    "spacing": { "section": "6rem", "gap": "2rem" },
    "button": { "radius": "0", "weight": "600", "transform": "uppercase" },
    "shadow": { "card": "none" },
    "headerStyle": "light", "heroStyle": "full-bleed"
  }'::jsonb,
  '["hero","about","programs","stats","staff","gallery","news","contact"]'::jsonb
),
(
  'community-faith', 'Community & Faith',
  'Warm, welcoming and community-centred, with room for values and messages.',
  false, 5,
  '{
    "colors": {
      "primary": "#166534", "primaryDark": "#14532D", "secondary": "#CA8A04",
      "accent": "#EA580C", "background": "#FFFBF5", "surface": "#FEF9F0",
      "surfaceAlt": "#FEF3C7", "text": "#1C1917", "textMuted": "#78716C",
      "border": "#E7E0D5", "headerBg": "#166534", "headerText": "#FFFFFF",
      "footerBg": "#14532D", "footerText": "#DCFCE7",
      "success": "#15803D", "warning": "#B45309", "error": "#B91C1C"
    },
    "fonts": { "heading": "Merriweather", "body": "Source Sans 3", "accent": "Merriweather" },
    "scale": { "h1": "2.875rem", "h2": "2.125rem", "h3": "1.5rem", "body": "1.0625rem" },
    "radius": { "sm": "0.375rem", "md": "0.75rem", "lg": "1rem", "pill": "9999px" },
    "spacing": { "section": "5rem", "gap": "1.5rem" },
    "button": { "radius": "0.5rem", "weight": "600", "transform": "none" },
    "shadow": { "card": "0 1px 3px rgba(28,25,23,.08)" },
    "headerStyle": "dark", "heroStyle": "centered"
  }'::jsonb,
  '["hero","principal_message","values","programs","events","gallery","testimonials","contact"]'::jsonb
)
ON CONFLICT (key) DO UPDATE
  SET tokens = EXCLUDED.tokens,
      default_sections = EXCLUDED.default_sections,
      description = EXCLUDED.description;

-- ==========================================================
-- 15. HOST -> TENANT RESOLUTION
-- ==========================================================
-- Called by the public renderer before any session exists, so it is
-- SECURITY DEFINER and granted to anon. It returns only what is
-- needed to render, and only for PUBLISHED sites.
--
-- The UNIQUE constraints on websites.subdomain and
-- website_domains.hostname are what make one host resolve to exactly
-- one tenant.
CREATE OR REPLACE FUNCTION resolve_site_by_host(p_host text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_host text := lower(split_part(coalesce(p_host, ''), ':', 1));
  v_site websites;
  v_org organizations;
BEGIN
  IF v_host = '' THEN RETURN NULL; END IF;

  -- 1. Verified custom domain
  SELECT w.* INTO v_site
  FROM website_domains d
  JOIN websites w ON w.id = d.website_id
  WHERE lower(d.hostname) = v_host AND d.verified = true
  LIMIT 1;

  -- 2. Also accept the bare/www variant of a verified domain
  IF v_site.id IS NULL THEN
    SELECT w.* INTO v_site
    FROM website_domains d
    JOIN websites w ON w.id = d.website_id
    WHERE d.verified = true
      AND (lower(d.hostname) = 'www.' || v_host
        OR 'www.' || lower(d.hostname) = v_host)
    LIMIT 1;
  END IF;

  -- 3. Platform subdomain: <label>.<platform host>
  IF v_site.id IS NULL THEN
    SELECT w.* INTO v_site
    FROM websites w
    WHERE w.subdomain IS NOT NULL
      AND v_host LIKE lower(w.subdomain) || '.%'
    LIMIT 1;
  END IF;

  IF v_site.id IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO v_org FROM organizations WHERE id = v_site.organization_id;

  -- A suspended school's public site goes dark.
  IF v_org.status NOT IN ('active', 'trial') THEN
    RETURN jsonb_build_object('found', true, 'available', false, 'reason', 'org_' || v_org.status);
  END IF;

  IF v_site.status <> 'published' THEN
    RETURN jsonb_build_object('found', true, 'available', false, 'reason', 'unpublished');
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'available', true,
    'organization_id', v_site.organization_id,
    'organization_name', v_org.name,
    'organization_slug', v_org.slug,
    'website_id', v_site.id,
    'maintenance_mode', v_site.maintenance_mode
  );
END $$;

GRANT EXECUTE ON FUNCTION resolve_site_by_host(text) TO anon, authenticated;

-- Slug-based lookup for the /s/<slug> fallback path.
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
    RETURN jsonb_build_object('found', false);
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

-- ==========================================================
-- 16. PUBLIC PAGE FETCH (one round trip, anon-safe)
-- ==========================================================
-- Assembling a page from six tables with six anon queries is slow and
-- leaks the shape of the schema. This returns the whole rendered
-- payload for a published page, or NULL.
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

GRANT EXECUTE ON FUNCTION get_public_page(uuid, text) TO anon, authenticated;

-- ==========================================================
-- 17. SITE PROVISIONING
-- ==========================================================
-- Builds a complete, immediately-viewable starter site for a school
-- from the chosen theme's default section list.
CREATE OR REPLACE FUNCTION provision_website(
  p_org uuid DEFAULT NULL,
  p_theme text DEFAULT 'modern-academy'
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org uuid := COALESCE(p_org, current_user_org_id());
  v_site uuid;
  v_page uuid;
  v_org_name text;
  v_slug text;
  v_theme website_themes;
  v_sec text;
  v_pos integer := 0;
BEGIN
  IF v_org IS NULL THEN RAISE EXCEPTION 'No organization context'; END IF;
  IF NOT is_org_admin(v_org) THEN
    RAISE EXCEPTION 'Only a school administrator can create the website';
  END IF;

  SELECT name, slug INTO v_org_name, v_slug FROM organizations WHERE id = v_org;
  SELECT * INTO v_theme FROM website_themes WHERE key = p_theme AND active = true;
  IF v_theme.key IS NULL THEN
    SELECT * INTO v_theme FROM website_themes WHERE active = true ORDER BY sort_order LIMIT 1;
  END IF;

  SELECT id INTO v_site FROM websites WHERE organization_id = v_org;
  IF v_site IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'website_id', v_site, 'created', false);
  END IF;

  INSERT INTO websites (organization_id, theme_key, site_name, tagline, subdomain, status)
  VALUES (
    v_org, v_theme.key, COALESCE(v_org_name, 'Our School'),
    'Educating with excellence',
    -- Subdomain must be globally unique; suffix on collision.
    CASE WHEN EXISTS (SELECT 1 FROM websites WHERE subdomain = v_slug)
         THEN v_slug || '-' || substr(md5(random()::text), 1, 4)
         ELSE v_slug END,
    'draft'
  )
  RETURNING id INTO v_site;

  -- Home page from the theme's suggested layout
  INSERT INTO website_pages (organization_id, website_id, slug, title, status, show_in_nav, nav_order, nav_label)
  VALUES (v_org, v_site, '', 'Home', 'published', true, 0, 'Home')
  RETURNING id INTO v_page;

  FOR v_sec IN SELECT jsonb_array_elements_text(v_theme.default_sections) LOOP
    v_pos := v_pos + 1;
    INSERT INTO website_sections (organization_id, website_id, page_id, section_type, position, content)
    VALUES (v_org, v_site, v_page, v_sec, v_pos, default_section_content(v_sec, COALESCE(v_org_name, 'Our School')));
  END LOOP;

  -- Standard supporting pages
  INSERT INTO website_pages (organization_id, website_id, slug, title, page_type, status, show_in_nav, nav_order, nav_label)
  VALUES
    (v_org, v_site, 'about',      'About Us',   'standard',    'published', true, 1, 'About'),
    (v_org, v_site, 'admissions', 'Admissions', 'standard',    'published', true, 2, 'Admissions'),
    (v_org, v_site, 'news',       'News',       'news_index',  'published', true, 3, 'News'),
    (v_org, v_site, 'events',     'Events',     'event_index', 'published', true, 4, 'Events'),
    (v_org, v_site, 'contact',    'Contact',    'contact',     'published', true, 5, 'Contact')
  ON CONFLICT (website_id, slug) DO NOTHING;

  -- Give the About and Admissions pages something real to show.
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

  -- Default enquiry form
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

  RETURN jsonb_build_object('ok', true, 'website_id', v_site, 'created', true, 'theme', v_theme.key);
END $$;

-- Starter copy per section type. Kept in SQL so provisioning is one call.
CREATE OR REPLACE FUNCTION default_section_content(p_type text, p_school text)
RETURNS jsonb
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE p_type
    WHEN 'hero' THEN jsonb_build_object(
      'heading', 'Welcome to ' || p_school,
      'subheading', 'A community where every child is known, challenged and supported.',
      'primary_cta_label', 'Apply for admission',
      'primary_cta_href', '/admissions',
      'secondary_cta_label', 'Book a tour',
      'secondary_cta_href', '/contact',
      'image_url', '', 'image_alt', '')
    WHEN 'page_header' THEN jsonb_build_object('heading', '', 'subheading', '')
    WHEN 'about' THEN jsonb_build_object(
      'heading', 'About ' || p_school,
      'body', 'Tell your story here: when the school was founded, what it stands for, and what makes it different. Replace this text in Website Studio.',
      'image_url', '', 'image_alt', '')
    WHEN 'principal_message' THEN jsonb_build_object(
      'heading', 'A message from our Principal',
      'body', 'Share a short welcome from the head of school.',
      'author_name', '', 'author_title', 'Principal',
      'image_url', '', 'image_alt', '')
    WHEN 'why_choose_us' THEN jsonb_build_object(
      'heading', 'Why families choose us',
      'items', jsonb_build_array(
        jsonb_build_object('title','Experienced teachers','body','Qualified staff who know every child by name.','icon','users'),
        jsonb_build_object('title','Strong results','body','Consistent academic achievement across every year group.','icon','award'),
        jsonb_build_object('title','Safe environment','body','A secure, caring campus with pastoral support.','icon','shield')))
    WHEN 'values' THEN jsonb_build_object(
      'heading', 'What we stand for',
      'items', jsonb_build_array(
        jsonb_build_object('title','Respect','body','For ourselves, each other and our community.','icon','heart'),
        jsonb_build_object('title','Excellence','body','Doing ordinary things extraordinarily well.','icon','star'),
        jsonb_build_object('title','Service','body','Using what we learn for the good of others.','icon','users')))
    WHEN 'programs' THEN jsonb_build_object(
      'heading', 'Our programmes',
      'items', jsonb_build_array(
        jsonb_build_object('title','Early Years','body','Play-based foundations in literacy and numeracy.','image_url',''),
        jsonb_build_object('title','Primary','body','A broad curriculum building confident learners.','image_url',''),
        jsonb_build_object('title','Secondary','body','Rigorous preparation for national examinations.','image_url','')))
    WHEN 'stats' THEN jsonb_build_object(
      'heading', 'At a glance',
      'items', jsonb_build_array(
        jsonb_build_object('value','1,200','label','Students'),
        jsonb_build_object('value','85','label','Teachers'),
        jsonb_build_object('value','98%','label','Pass rate'),
        jsonb_build_object('value','25','label','Years of service')))
    WHEN 'achievements' THEN jsonb_build_object(
      'heading', 'Achievements',
      'items', jsonb_build_array(
        jsonb_build_object('title','Regional champions','body','First place in the state mathematics olympiad.','image_url','')))
    WHEN 'facilities' THEN jsonb_build_object(
      'heading', 'Our facilities',
      'items', jsonb_build_array(
        jsonb_build_object('title','Science laboratories','body','Fully equipped physics, chemistry and biology labs.','image_url',''),
        jsonb_build_object('title','Library','body','A quiet space with a growing collection.','image_url',''),
        jsonb_build_object('title','Sports field','body','Room for football, athletics and inter-house sports.','image_url','')))
    WHEN 'gallery' THEN jsonb_build_object(
      'heading', 'Life at ' || p_school, 'images', '[]'::jsonb)
    WHEN 'testimonials' THEN jsonb_build_object(
      'heading', 'What parents say',
      'items', jsonb_build_array(
        jsonb_build_object('quote','The teachers genuinely care. Our daughter has grown in confidence.','author','Parent','role','Primary 4')))
    WHEN 'staff' THEN jsonb_build_object(
      'heading', 'Meet our leadership', 'items', '[]'::jsonb)
    WHEN 'news' THEN jsonb_build_object(
      'heading', 'Latest news', 'limit', 3, 'show_all_link', true)
    WHEN 'events' THEN jsonb_build_object(
      'heading', 'Upcoming events', 'limit', 3, 'show_all_link', true)
    WHEN 'admissions_cta' THEN jsonb_build_object(
      'heading', 'Admissions are open',
      'body', 'Start an application or arrange a visit. We would be glad to meet you.',
      'cta_label', 'Apply now', 'cta_href', '/admissions',
      'secondary_label', 'Talk to us', 'secondary_href', '/contact')
    WHEN 'video' THEN jsonb_build_object(
      'heading', 'Take a look around', 'embed_url', '', 'caption', '')
    WHEN 'faq' THEN jsonb_build_object(
      'heading', 'Frequently asked questions',
      'items', jsonb_build_array(
        jsonb_build_object('q','When does the school year start?','a','Please contact the school office for current term dates.')))
    WHEN 'contact' THEN jsonb_build_object(
      'heading', 'Get in touch',
      'body', 'Send us a message and we will reply as soon as we can.',
      'form_key', 'contact', 'show_map', false, 'map_embed_url', '')
    WHEN 'rich_text' THEN jsonb_build_object('heading', '', 'body', '')
    WHEN 'cta_banner' THEN jsonb_build_object(
      'heading', '', 'body', '', 'cta_label', '', 'cta_href', '')
    ELSE '{}'::jsonb
  END;
$$;

GRANT EXECUTE ON FUNCTION provision_website(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION default_section_content(text, text) TO authenticated;

-- ==========================================================
-- 18. VERSION SNAPSHOT / RESTORE
-- ==========================================================
CREATE OR REPLACE FUNCTION snapshot_website(p_label text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org uuid := current_user_org_id();
  v_site uuid;
  v_snap jsonb;
  v_id uuid;
BEGIN
  IF v_org IS NULL THEN RAISE EXCEPTION 'No organization context'; END IF;
  SELECT id INTO v_site FROM websites WHERE organization_id = v_org;
  IF v_site IS NULL THEN RAISE EXCEPTION 'No website to snapshot'; END IF;

  SELECT jsonb_build_object(
    'website', (SELECT to_jsonb(w) FROM websites w WHERE w.id = v_site),
    'pages',   COALESCE((SELECT jsonb_agg(to_jsonb(p)) FROM website_pages p WHERE p.website_id = v_site), '[]'::jsonb),
    'sections',COALESCE((SELECT jsonb_agg(to_jsonb(s)) FROM website_sections s WHERE s.website_id = v_site), '[]'::jsonb),
    'nav',     COALESCE((SELECT jsonb_agg(to_jsonb(n)) FROM website_nav_items n WHERE n.website_id = v_site), '[]'::jsonb)
  ) INTO v_snap;

  INSERT INTO website_versions (organization_id, website_id, label, snapshot, created_by, created_by_email)
  VALUES (v_org, v_site, p_label, v_snap, auth.uid(),
          (SELECT email FROM profiles WHERE id = auth.uid()))
  RETURNING id INTO v_id;

  -- Keep the 30 most recent snapshots per site.
  DELETE FROM website_versions
  WHERE website_id = v_site
    AND id NOT IN (
      SELECT id FROM website_versions WHERE website_id = v_site
      ORDER BY created_at DESC LIMIT 30
    );

  RETURN jsonb_build_object('ok', true, 'version_id', v_id);
END $$;

CREATE OR REPLACE FUNCTION restore_website_version(p_version uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org uuid := current_user_org_id();
  v_ver website_versions;
  v_site uuid;
  v_page jsonb;
  v_sec jsonb;
  v_nav jsonb;
BEGIN
  SELECT * INTO v_ver FROM website_versions WHERE id = p_version;
  IF v_ver.id IS NULL THEN RAISE EXCEPTION 'Version not found'; END IF;
  IF v_ver.organization_id <> v_org OR NOT is_org_admin(v_org) THEN
    RAISE EXCEPTION 'Not authorized to restore this version';
  END IF;

  v_site := v_ver.website_id;

  -- Snapshot the current state first, so restore is itself undoable.
  PERFORM snapshot_website('Auto-saved before restore');

  -- Replace structure. Sections cascade from pages.
  DELETE FROM website_nav_items WHERE website_id = v_site;
  DELETE FROM website_pages WHERE website_id = v_site;

  UPDATE websites SET
    theme_key  = COALESCE(v_ver.snapshot->'website'->>'theme_key', theme_key),
    site_name  = COALESCE(v_ver.snapshot->'website'->>'site_name', site_name),
    tagline    = v_ver.snapshot->'website'->>'tagline',
    logo_url   = v_ver.snapshot->'website'->>'logo_url',
    brand      = COALESCE(v_ver.snapshot->'website'->'brand', brand),
    typography = COALESCE(v_ver.snapshot->'website'->'typography', typography),
    contact    = COALESCE(v_ver.snapshot->'website'->'contact', contact),
    social     = COALESCE(v_ver.snapshot->'website'->'social', social),
    seo        = COALESCE(v_ver.snapshot->'website'->'seo', seo)
  WHERE id = v_site;

  FOR v_page IN SELECT * FROM jsonb_array_elements(COALESCE(v_ver.snapshot->'pages', '[]'::jsonb)) LOOP
    INSERT INTO website_pages (
      id, organization_id, website_id, slug, title, page_type, status,
      show_in_nav, nav_label, nav_order, seo)
    VALUES (
      (v_page->>'id')::uuid, v_org, v_site, v_page->>'slug', v_page->>'title',
      COALESCE(v_page->>'page_type','standard'), COALESCE(v_page->>'status','draft'),
      COALESCE((v_page->>'show_in_nav')::boolean, true), v_page->>'nav_label',
      COALESCE((v_page->>'nav_order')::int, 0), COALESCE(v_page->'seo','{}'::jsonb))
    ON CONFLICT (id) DO NOTHING;
  END LOOP;

  FOR v_sec IN SELECT * FROM jsonb_array_elements(COALESCE(v_ver.snapshot->'sections', '[]'::jsonb)) LOOP
    INSERT INTO website_sections (
      id, organization_id, website_id, page_id, section_type, position, visible, content, style)
    VALUES (
      (v_sec->>'id')::uuid, v_org, v_site, (v_sec->>'page_id')::uuid,
      v_sec->>'section_type', COALESCE((v_sec->>'position')::int, 0),
      COALESCE((v_sec->>'visible')::boolean, true),
      COALESCE(v_sec->'content','{}'::jsonb), COALESCE(v_sec->'style','{}'::jsonb))
    ON CONFLICT (id) DO NOTHING;
  END LOOP;

  FOR v_nav IN SELECT * FROM jsonb_array_elements(COALESCE(v_ver.snapshot->'nav', '[]'::jsonb)) LOOP
    INSERT INTO website_nav_items (
      id, organization_id, website_id, menu, label, page_id, href, position, open_in_new_tab)
    VALUES (
      (v_nav->>'id')::uuid, v_org, v_site, COALESCE(v_nav->>'menu','primary'),
      v_nav->>'label', NULLIF(v_nav->>'page_id','')::uuid, v_nav->>'href',
      COALESCE((v_nav->>'position')::int, 0),
      COALESCE((v_nav->>'open_in_new_tab')::boolean, false))
    ON CONFLICT (id) DO NOTHING;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'restored_from', v_ver.created_at);
END $$;

GRANT EXECUTE ON FUNCTION snapshot_website(text) TO authenticated;
GRANT EXECUTE ON FUNCTION restore_website_version(uuid) TO authenticated;

-- ==========================================================
-- 19. PUBLIC FORM SUBMISSION
-- ==========================================================
-- Anonymous visitors post through this instead of writing to the table
-- directly, so the payload can be normalised, rate-limited and pinned
-- to the correct tenant regardless of what the client claims.
CREATE OR REPLACE FUNCTION submit_website_form(
  p_website_id uuid,
  p_form_key text,
  p_data jsonb,
  p_source_page text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_site websites;
  v_form website_forms;
  v_recent int;
  v_email text := lower(trim(COALESCE(p_data->>'email', '')));
  v_id uuid;
BEGIN
  SELECT * INTO v_site FROM websites WHERE id = p_website_id AND status = 'published';
  IF v_site.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This site is not accepting submissions.');
  END IF;

  SELECT * INTO v_form FROM website_forms
   WHERE website_id = p_website_id AND key = p_form_key AND active = true;
  IF v_form.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unknown form.');
  END IF;

  IF v_email = '' OR v_email NOT LIKE '%_@_%' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'A valid email address is required.');
  END IF;

  -- Light rate limit: 3 submissions per email per form per hour.
  SELECT count(*) INTO v_recent FROM website_submissions
   WHERE organization_id = v_site.organization_id
     AND form_key = p_form_key
     AND contact_email = v_email
     AND created_at > now() - interval '1 hour';
  IF v_recent >= 3 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Too many submissions. Please try again later.');
  END IF;

  INSERT INTO website_submissions (
    organization_id, form_id, form_key, data,
    contact_name, contact_email, contact_phone, subject, message, source_page)
  VALUES (
    v_site.organization_id, v_form.id, p_form_key, COALESCE(p_data, '{}'::jsonb),
    NULLIF(trim(COALESCE(p_data->>'name', '')), ''),
    v_email,
    NULLIF(trim(COALESCE(p_data->>'phone', '')), ''),
    NULLIF(trim(COALESCE(p_data->>'subject', '')), ''),
    NULLIF(trim(COALESCE(p_data->>'message', '')), ''),
    p_source_page)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'ok', true, 'id', v_id,
    'message', COALESCE(v_form.success_message, 'Thank you. We will be in touch shortly.'));
END $$;

GRANT EXECUTE ON FUNCTION submit_website_form(uuid, text, jsonb, text) TO anon, authenticated;

-- ==========================================================
-- 20. STORAGE BUCKET FOR MEDIA
-- ==========================================================
-- Public read (site images must load for visitors), writes restricted
-- to the owning tenant by path prefix: <organization_id>/<file>.
INSERT INTO storage.buckets (id, name, public)
VALUES ('website-media', 'website-media', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "website_media_public_read" ON storage.objects;
CREATE POLICY "website_media_public_read" ON storage.objects FOR SELECT
  USING (bucket_id = 'website-media');

DROP POLICY IF EXISTS "website_media_tenant_write" ON storage.objects;
CREATE POLICY "website_media_tenant_write" ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'website-media'
    AND (storage.foldername(name))[1] = current_user_org_id()::text
  );

DROP POLICY IF EXISTS "website_media_tenant_update" ON storage.objects;
CREATE POLICY "website_media_tenant_update" ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'website-media'
    AND (storage.foldername(name))[1] = current_user_org_id()::text
  );

DROP POLICY IF EXISTS "website_media_tenant_delete" ON storage.objects;
CREATE POLICY "website_media_tenant_delete" ON storage.objects FOR DELETE
  USING (
    bucket_id = 'website-media'
    AND (storage.foldername(name))[1] = current_user_org_id()::text
  );

-- ==========================================================
-- 21. EXTEND THE ISOLATION VERIFIER TO COVER WEBSITE TABLES
-- ==========================================================
-- The website tables intentionally allow anonymous SELECT for
-- published content, so they cannot be judged by the same rule as
-- students or income. This reports on them separately.
CREATE OR REPLACE FUNCTION verify_website_isolation()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tables text[] := ARRAY[
    'websites','website_domains','website_pages','website_sections',
    'website_media','website_news','website_events','website_forms',
    'website_submissions','website_nav_items','website_versions'
  ];
  v_tbl text;
  v_report jsonb := '[]'::jsonb;
  v_rls boolean;
  v_tenant int;
  v_public int;
  v_nulls bigint;
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'Platform admin access required';
  END IF;

  FOREACH v_tbl IN ARRAY v_tables LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema='public' AND table_name=v_tbl) THEN
      v_report := v_report || jsonb_build_object('table', v_tbl, 'exists', false);
      CONTINUE;
    END IF;

    SELECT c.relrowsecurity INTO v_rls
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=v_tbl;

    SELECT
      count(*) FILTER (WHERE COALESCE(qual,'') LIKE '%current_user_org_id%'
                          OR COALESCE(with_check,'') LIKE '%current_user_org_id%'),
      count(*) FILTER (WHERE policyname LIKE '%public%')
    INTO v_tenant, v_public
    FROM pg_policies WHERE schemaname='public' AND tablename=v_tbl;

    EXECUTE format('SELECT count(*) FROM public.%I WHERE organization_id IS NULL', v_tbl)
      INTO v_nulls;

    v_report := v_report || jsonb_build_object(
      'table', v_tbl, 'exists', true,
      'rls_enabled', COALESCE(v_rls,false),
      'tenant_scoped_policies', v_tenant,
      'public_policies', v_public,
      'null_org_rows', v_nulls,
      'pass', COALESCE(v_rls,false) AND v_tenant > 0 AND v_nulls = 0);
  END LOOP;

  RETURN jsonb_build_object(
    'tables', v_report,
    'note', 'Public SELECT policies are expected here: visitors must read published content. Draft rows stay private.',
    'all_pass', NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_report) e
      WHERE (e->>'exists')::boolean IS TRUE AND (e->>'pass')::boolean IS NOT TRUE)
  );
END $$;

GRANT EXECUTE ON FUNCTION verify_website_isolation() TO authenticated;
