/**
 * Shapes returned by get_public_page() and used across the studio and the
 * public renderer. Section content is intentionally loose (jsonb) — each
 * section component narrows what it needs and tolerates missing keys, so an
 * older saved section never breaks a page.
 */

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
export type JsonObject = Record<string, unknown>;

export interface ThemeTokens {
  colors?: Record<string, string>;
  fonts?: { heading?: string; body?: string; accent?: string };
  scale?: Record<string, string>;
  radius?: Record<string, string>;
  spacing?: Record<string, string>;
  button?: Record<string, string>;
  shadow?: Record<string, string>;
  headerStyle?: string;
  heroStyle?: string;
  /** Background texture: none | weave | dots | grid | rules | rings */
  motif?: string;
  /** Section transition shape: none | curve | angle | weave | rule */
  divider?: string;
  /** Card treatment: soft | flat | bordered | elevated | glass */
  cardStyle?: string;
  /** Film-grain overlay. */
  grain?: boolean;
  /** Reveal and count-up animations. */
  animations?: boolean;
  /** Scrolling marquee band availability. */
  marquee?: boolean;
}

export interface WebsiteTheme {
  key: string;
  name: string;
  description?: string | null;
  preview_image_url?: string | null;
  tokens: ThemeTokens;
  default_sections?: string[];
  is_premium?: boolean;
  sort_order?: number;
  /** Grouping: several variants share one family. */
  family?: string | null;
  family_label?: string | null;
  variant_label?: string | null;
  variant_order?: number | null;
  /** Section types this theme is designed around. */
  signature_sections?: string[];
  /** AI image prompts a school can use to generate on-brand photography. */
  lifestyle_prompts?: LifestylePrompt[];
}

export interface LifestylePrompt {
  slot: string;
  prompt: string;
}

/** A family with its variants, as returned by list_theme_families(). */
export interface ThemeFamily {
  family: string;
  label: string;
  sort_order: number;
  variants: WebsiteTheme[];
}

export interface SiteContact {
  address?: string;
  phone?: string;
  email?: string;
  hours?: string;
  map_embed_url?: string;
}

export interface SiteSocial {
  facebook?: string;
  instagram?: string;
  x?: string;
  youtube?: string;
  linkedin?: string;
  tiktok?: string;
}

export interface SiteSeo {
  title?: string;
  description?: string;
  keywords?: string;
  og_image_url?: string;
  robots?: string;
}

export interface SiteFeatures {
  news?: boolean;
  events?: boolean;
  admissions?: boolean;
  contact_form?: boolean;
  gallery?: boolean;
}

export interface PublicSite {
  id: string;
  site_name: string;
  tagline: string | null;
  logo_url: string | null;
  favicon_url: string | null;
  theme_key: string;
  brand: ThemeTokens;
  typography: { heading?: string; body?: string; accent?: string };
  contact: SiteContact;
  social: SiteSocial;
  seo: SiteSeo;
  features: SiteFeatures;
  maintenance_mode: boolean;
  organization_id: string;
  organization_name: string;
}

export interface PublicPage {
  id: string;
  slug: string;
  title: string;
  page_type: string;
  seo: SiteSeo;
}

export interface PublicSection {
  id: string;
  section_type: string;
  content: JsonObject;
  style: JsonObject;
  /** Small label above the heading. */
  eyebrow?: string | null;
  /** Optional id so the section can be deep-linked from navigation. */
  anchor_id?: string | null;
}

export interface NavEntry {
  label: string;
  menu: string;
  href: string;
  new_tab?: boolean;
}

export interface PageLink {
  slug: string;
  label: string;
}

export interface NewsItem {
  slug: string;
  title: string;
  excerpt: string | null;
  cover_image_url: string | null;
  category: string | null;
  published_at: string | null;
  body?: string | null;
  author_name?: string | null;
}

export interface EventItem {
  slug: string;
  title: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  cover_image_url: string | null;
}

export interface FormField {
  name: string;
  label: string;
  type: string;
  required?: boolean;
  options?: string[];
  placeholder?: string;
  help?: string;
}

export interface PublicForm {
  id: string;
  key: string;
  name: string;
  fields: FormField[];
  success_message: string | null;
}

/** The full payload get_public_page() returns. */
export interface PagePayload {
  site: PublicSite;
  theme: WebsiteTheme;
  page: PublicPage;
  sections: PublicSection[];
  nav: NavEntry[];
  pages: PageLink[];
  news: NewsItem[];
  events: EventItem[];
  forms: PublicForm[];
  not_found?: boolean;
}

/** Host resolution result. */
export interface SiteResolution {
  found: boolean;
  available?: boolean;
  reason?: string;
  organization_id?: string;
  organization_name?: string;
  organization_slug?: string;
  website_id?: string;
  maintenance_mode?: boolean;
}

// ============================================================
// DRAFT / CUSTOM THEME TYPES (website_studio_upgrade_migration)
// ============================================================

/** A custom theme owned by a specific organization. */
export interface CustomTheme {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  tokens: ThemeTokens;
  based_on: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** The draft state stored in website_drafts. */
export interface WebsiteDraft {
  id: string;
  organization_id: string;
  website_id: string;
  theme_key: string | null;
  custom_theme_id: string | null;
  brand: ThemeTokens;
  typography: { heading?: string; body?: string; accent?: string };
  last_saved_at: string | null;
  saved_by: string | null;
  published_at: string | null;
}

/** Extended WebsiteTheme with the category field from the migration. */
export interface CategorizedTheme extends WebsiteTheme {
  category: string;
}

/** Result from publish_website_draft RPC. */
export interface PublishResult {
  ok: boolean;
  error?: string;
  code?: string;
  published_at?: string;
}

/** Result from save_website_draft RPC. */
export interface SaveDraftResult {
  ok: boolean;
  error?: string;
  saved_at?: string;
}

/** Payload returned by get_draft_preview RPC (same shape as PagePayload + is_preview flag). */
export interface DraftPreviewPayload extends PagePayload {
  is_preview?: boolean;
}
