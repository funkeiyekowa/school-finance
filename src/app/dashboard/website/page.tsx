"use client";

/**
 * Website Studio.
 *
 * Everything a school needs to run its own public site: theme, branding,
 * typography, colours, pages, a section builder, media, news, events, SEO,
 * domains, version history, and publishing.
 *
 * All reads and writes are ordinary Supabase calls against tenant-scoped
 * tables, so RLS keeps one school's site entirely separate from another's.
 * Nothing here needs an org filter in the client: current_user_org_id()
 * decides what is visible.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { PageHeader, LoadingSpinner } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";
import {
  SECTION_CATALOGUE, SECTION_META, type SectionFieldMeta,
} from "@/components/website/sections";
import type { WebsiteTheme } from "@/lib/website/types";
import { motifBackground, motifSize } from "@/lib/website/theme";
import { ThemeGallery } from "@/components/website/ThemeGallery";
import {
  Globe, Palette, FileText, Newspaper, CalendarDays, Image as ImageIcon,
  Search, Link2, History, Rocket, Plus, Trash2, ChevronUp, ChevronDown,
  Eye, EyeOff, ExternalLink, AlertTriangle, CheckCircle2, Copy, Save,
  LayoutTemplate, Type, Monitor, Paintbrush, Shield,
} from "lucide-react";
import { DevicePreview } from "@/components/website/DevicePreview";
import { BrandKit } from "@/components/website/BrandKit";
import { ThemeStudio } from "@/components/website/ThemeStudio";
import { AiAssistButton } from "@/components/ai/AiAssistButton";
import type { CustomTheme } from "@/lib/website/types";

/* ------------------------------ types ------------------------------ */

interface SiteRow {
  id: string;
  organization_id: string;
  theme_key: string;
  custom_theme_id: string | null;
  site_name: string;
  tagline: string | null;
  logo_url: string | null;
  favicon_url: string | null;
  brand: Record<string, unknown>;
  typography: Record<string, string>;
  contact: Record<string, string>;
  social: Record<string, string>;
  seo: Record<string, string>;
  status: string;
  subdomain: string | null;
  maintenance_mode: boolean;
  features: Record<string, boolean>;
  published_at: string | null;
}

interface PageRow {
  id: string;
  slug: string;
  title: string;
  page_type: string;
  status: string;
  show_in_nav: boolean;
  nav_label: string | null;
  nav_order: number;
  seo: Record<string, string>;
}

interface SectionRow {
  id: string;
  page_id: string;
  section_type: string;
  position: number;
  visible: boolean;
  content: Record<string, unknown>;
  style: Record<string, unknown>;
  eyebrow: string | null;
  anchor_id: string | null;
}

interface NewsRow {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  body: string | null;
  cover_image_url: string | null;
  category: string | null;
  author_name: string | null;
  status: string;
  published_at: string | null;
}

interface EventRow {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  status: string;
}

interface DomainRow {
  id: string;
  hostname: string;
  is_primary: boolean;
  verified: boolean;
  verification_token: string;
  ssl_status: string;
}

interface VersionRow {
  id: string;
  label: string | null;
  created_at: string;
  created_by_email: string | null;
}

interface MediaRow {
  id: string;
  file_name: string;
  url: string;
  folder: string;
  alt_text: string | null;
  size_bytes: number | null;
}

type Tab =
  | "overview" | "theme" | "pages" | "news" | "events"
  | "media" | "seo" | "domains" | "versions" | "brand";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "overview", label: "Overview", icon: <Rocket size={14} /> },
  { id: "theme",    label: "Theme & Brand", icon: <Palette size={14} /> },
  { id: "brand",    label: "Brand Kit", icon: <Paintbrush size={14} /> },
  { id: "pages",    label: "Pages & Sections", icon: <FileText size={14} /> },
  { id: "news",     label: "News", icon: <Newspaper size={14} /> },
  { id: "events",   label: "Events", icon: <CalendarDays size={14} /> },
  { id: "media",    label: "Media", icon: <ImageIcon size={14} /> },
  { id: "seo",      label: "SEO", icon: <Search size={14} /> },
  { id: "domains",  label: "Domains", icon: <Link2 size={14} /> },
  { id: "versions", label: "History", icon: <History size={14} /> },
];

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/* ------------------------------ page ------------------------------ */

export default function WebsiteStudioPage() {
  const supabase = useMemo(() => createClient(), []);
  const { orgId, org, isOrgAdmin, profile } = useAuth();

  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("overview");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [site, setSite] = useState<SiteRow | null>(null);
  const [themes, setThemes] = useState<WebsiteTheme[]>([]);
  const [pages, setPages] = useState<PageRow[]>([]);
  const [sections, setSections] = useState<SectionRow[]>([]);
  const [news, setNews] = useState<NewsRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [domains, setDomains] = useState<DomainRow[]>([]);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [media, setMedia] = useState<MediaRow[]>([]);

  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [customThemes, setCustomThemes] = useState<CustomTheme[]>([]);
  const [showPreview, setShowPreview] = useState(false);

  const flash = useCallback((msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 3500);
  }, []);

  const load = useCallback(async () => {
    setError(null);

    const { data: themeRows, error: themeErr } = await supabase
      .from("website_themes").select("*").eq("active", true).order("sort_order");

    if (themeErr) {
      setError(
        themeErr.message.includes("does not exist")
          ? "The website tables are missing. Run supabase/website_module.sql in the Supabase SQL editor, then reload."
          : themeErr.message
      );
      setLoading(false);
      return;
    }
    setThemes((themeRows ?? []) as WebsiteTheme[]);

    // A platform admin sees more than one row via RLS (every published site
    // via websites_public_read, plus every tenant row for orgs they belong to).
    // Filter to the ACTIVE org so .maybeSingle() never throws
    // "Multiple rows returned" and we never pick some other school's site.
    let siteQuery = supabase.from("websites").select("*");
    if (orgId) siteQuery = siteQuery.eq("organization_id", orgId);
    const { data: siteRow, error: siteErr } = await siteQuery.maybeSingle();

    if (siteErr) {
      console.error("[WebsiteStudio] load websites failed", siteErr);
      setError(
        siteErr.message.includes("does not exist")
          ? "The website tables are missing. Run supabase/website_module.sql, then reload."
          : `Could not load your website: ${siteErr.message}`
      );
      setSite(null);
      setLoading(false);
      return;
    }

    if (!siteRow) {
      setSite(null);
      setLoading(false);
      return;
    }
    setSite(siteRow as SiteRow);
    const siteId = (siteRow as SiteRow).id;

    // All child selects also need to be scoped to this org's site — otherwise
    // a platform admin would see pages/sections/news/events for every other
    // school layered on top of their own.
    const [pageRes, secRes, newsRes, evRes, domRes, verRes, medRes] = await Promise.all([
      supabase.from("website_pages").select("*").eq("website_id", siteId).order("nav_order"),
      supabase.from("website_sections").select("*").eq("website_id", siteId).order("position"),
      supabase.from("website_news").select("*").eq("website_id", siteId).order("created_at", { ascending: false }),
      supabase.from("website_events").select("*").eq("website_id", siteId).order("starts_at"),
      supabase.from("website_domains").select("*").eq("website_id", siteId).order("created_at"),
      supabase.from("website_versions")
        .select("id, label, created_at, created_by_email")
        .eq("website_id", siteId)
        .order("created_at", { ascending: false }).limit(30),
      supabase.from("website_media")
        .select("*")
        .eq("organization_id", (siteRow as SiteRow).organization_id)
        .order("created_at", { ascending: false }).limit(200),
    ]);

    setPages((pageRes.data ?? []) as PageRow[]);
    setSections((secRes.data ?? []) as SectionRow[]);
    setNews((newsRes.data ?? []) as NewsRow[]);
    setEvents((evRes.data ?? []) as EventRow[]);
    setDomains((domRes.data ?? []) as DomainRow[]);
    setVersions((verRes.data ?? []) as VersionRow[]);
    setMedia((medRes.data ?? []) as MediaRow[]);

    // Custom themes: also scope by org so a platform admin doesn't get another
    // school's saved themes mixed in.
    let ctQuery = supabase.from("website_custom_themes").select("*");
    if (orgId) ctQuery = ctQuery.eq("organization_id", orgId);
    const { data: ctRows } = await ctQuery.order("created_at", { ascending: false });
    setCustomThemes((ctRows ?? []) as CustomTheme[]);

    setActivePageId(prev => prev ?? ((pageRes.data ?? [])[0]?.id ?? null));
    setLoading(false);
  }, [supabase, orgId]);

  useEffect(() => { load(); }, [load]);

  /* ------------------------- site level ------------------------- */

  async function createSite(themeKey: string) {
    setError(null);
    setSaving(true);
    console.log("[WebsiteStudio] creating site", { themeKey, orgId });
    const { data, error: err } = await supabase.rpc("provision_website", {
      p_org: orgId,
      p_theme: themeKey,
    });
    setSaving(false);
    if (err) {
      console.error("[WebsiteStudio] provision_website failed", err);
      setError(
        err.message.includes("does not exist")
          ? "provision_website is missing. Run supabase/website_module.sql in the Supabase SQL editor first, then reload."
          : `Could not create the website: ${err.message}`
      );
      return;
    }
    const res = data as { ok?: boolean; website_id?: string; created?: boolean; error?: string } | null;
    console.log("[WebsiteStudio] provision_website result", res);
    if (res?.ok) {
      flash(res.created === false
        ? "Website already exists — reloading it."
        : "Website created with a starter home page. Edit it, then publish.");
      await load();
    } else {
      setError(res?.error ?? "The server did not return a website. Please try another theme or reload the page.");
    }
  }

  async function patchSite(patch: Partial<SiteRow>) {
    if (!site) return;
    setSaving(true);
    const { error: err } = await supabase.from("websites").update(patch).eq("id", site.id);
    setSaving(false);
    if (err) { setError(err.message); return; }
    setSite({ ...site, ...patch } as SiteRow);
  }

  async function togglePublish() {
    if (!site) return;
    const next = site.status === "published" ? "draft" : "published";
    // Snapshot before going live so there is always something to roll
    // back to. If the snapshot itself fails, don't proceed to publish —
    // otherwise we've lost the pre-publish safety net.
    if (next === "published") {
      const { error: snapErr } = await supabase.rpc("snapshot_website", { p_label: "Before publish" });
      if (snapErr) { setError(`Snapshot failed, publish aborted: ${snapErr.message}`); return; }
    }
    await patchSite({
      status: next,
      published_at: next === "published" ? new Date().toISOString() : site.published_at,
    });
    flash(next === "published" ? "Your website is live." : "Website unpublished.");
    load();
  }

  /* ------------------------- guards ------------------------- */

  if (loading) return <div className="p-6"><LoadingSpinner /></div>;

  if (error && !site) {
    return (
      <div className="p-6 space-y-4">
        <PageHeader title="Website Studio" subtitle="Your school's public website" />
        <div className="flex items-start gap-2 p-4 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
          <AlertTriangle size={16} className="mt-px shrink-0" />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  if (!site) {
    return (
      <div className="p-6 space-y-5">
        <PageHeader
          title="Website Studio"
          subtitle={`Create the public website for ${org?.name ?? "your school"}`}
        />
        {error && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
            <AlertTriangle size={16} className="mt-px shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="font-medium">Could not create your website</div>
              <div className="mt-0.5 break-words">{error}</div>
            </div>
            <button
              onClick={() => setError(null)}
              className="text-red-500 hover:text-red-700 text-xs px-2 py-0.5 rounded hover:bg-red-100"
            >
              Dismiss
            </button>
          </div>
        )}
        {notice && (
          <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">
            {notice}
          </div>
        )}
        {saving && (
          <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-800">
            Creating your website — this can take a few seconds…
          </div>
        )}
        {!isOrgAdmin && (
          <div className="p-4 rounded-lg bg-gray-50 border text-sm text-gray-600">
            Only a school administrator can create the website.
          </div>
        )}
        <Card>
          <CardHeader><CardTitle>Choose a starting theme</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-gray-600 mb-5">
              A theme sets your colours, typography and section layout. You can change it
              at any time, and override anything afterwards — your content is never lost
              when you switch.
            </p>
            <ThemeGallery
              themes={themes}
              onSelect={key => createSite(key)}
              disabled={saving || !isOrgAdmin}
              actionLabel="Start with this"
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  const previewPath = `/s/${org?.slug ?? ""}`;
  const activePage = pages.find(p => p.id === activePageId) ?? null;
  const pageSections = sections
    .filter(s => s.page_id === activePageId)
    .sort((a, b) => a.position - b.position);

  return (
    <div className="p-6 space-y-5">
      {/*
        Header actions are about the SITE as a whole: is it reachable by the
        public, and what does the public currently see. Theme-specific
        actions (preview draft, publish theme changes) live inside the
        Theme & Brand tab, next to the controls that create them.
      */}
      <PageHeader title="Website Studio" subtitle={site.site_name}>
        <Button size="sm" variant="secondary" onClick={() => setShowPreview(true)}>
          <Monitor size={14} /> View live site
        </Button>
        {site.status === "published" && (
          <a href={previewPath} target="_blank" rel="noopener noreferrer">
            <Button size="sm" variant="secondary">
              <ExternalLink size={14} /> Open
            </Button>
          </a>
        )}
        <Button
          size="sm"
          variant={site.status === "published" ? "secondary" : "gold"}
          onClick={togglePublish}
          loading={saving}
          disabled={!isOrgAdmin}
          title={site.status === "published"
            ? "Take the site offline for the public"
            : "Make the site reachable by the public"}
        >
          {site.status === "published" ? <EyeOff size={14} /> : <Rocket size={14} />}
          {site.status === "published" ? "Take offline" : "Take site live"}
        </Button>
      </PageHeader>

      {error && <Banner tone="error" onDismiss={() => setError(null)}>{error}</Banner>}
      {notice && <Banner tone="success">{notice}</Banner>}

      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={site.status === "published" ? "green" : "amber"}>
          {site.status === "published" ? "Live" : "Draft"}
        </Badge>
        {site.status === "published" && (
          <a
            href={previewPath}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-[#0F2A47] hover:underline"
          >
            <ExternalLink size={11} /> {previewPath}
          </a>
        )}
        {site.maintenance_mode && <Badge variant="red">Maintenance mode</Badge>}
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "flex items-center gap-2 px-3.5 py-2 text-sm font-medium rounded-lg transition-colors",
              tab === t.id ? "bg-[#0F2A47] text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            )}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <OverviewTab
          supabase={supabase}
          orgId={site.organization_id}
          site={site}
          pages={pages}
          news={news}
          events={events}
          domains={domains}
          onPatch={patchSite}
          previewPath={previewPath}
          saving={saving}
        />
      )}

      {tab === "theme" && (
        <ThemeStudio
          supabase={supabase}
          site={site}
          themes={themes}
          customThemes={customThemes}
          previewPath={previewPath}
          isAdmin={!!isOrgAdmin}
          onSiteUpdate={load}
          flash={flash}
          setError={setError}
        />
      )}

      {tab === "pages" && (
        <PagesTab
          supabase={supabase}
          site={site}
          pages={pages}
          activePage={activePage}
          pageSections={pageSections}
          setActivePageId={setActivePageId}
          media={media}
          reload={load}
          flash={flash}
          setError={setError}
        />
      )}

      {tab === "news" && (
        <NewsTab
          supabase={supabase}
          site={site}
          rows={news}
          reload={load}
          flash={flash}
          setError={setError}
          authorDefault={profile?.full_name ?? ""}
          media={media}
        />
      )}

      {tab === "events" && (
        <EventsTab
          supabase={supabase}
          site={site}
          rows={events}
          reload={load}
          flash={flash}
          setError={setError}
        />
      )}

      {tab === "media" && (
        <MediaTab
          supabase={supabase}
          orgId={site.organization_id}
          rows={media}
          reload={load}
          flash={flash}
          setError={setError}
        />
      )}

      {tab === "seo" && (
        <SeoTab site={site} onPatch={patchSite} saving={saving} media={media} />
      )}

      {tab === "domains" && (
        <DomainsTab
          supabase={supabase}
          site={site}
          rows={domains}
          reload={load}
          flash={flash}
          setError={setError}
          onPatch={patchSite}
        />
      )}

      {tab === "versions" && (
        <VersionsTab
          supabase={supabase}
          rows={versions}
          reload={load}
          flash={flash}
          setError={setError}
        />
      )}

      {tab === "brand" && (
        <BrandKit
          site={{
            site_name: site.site_name,
            logo_url: site.logo_url,
            brand: site.brand,
            typography: site.typography,
          }}
          theme={themes.find(t => t.key === site.theme_key)}
        />
      )}

      {showPreview && (
        <DevicePreview
          previewUrl={previewPath}
          label="Live site"
          onClose={() => setShowPreview(false)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shared bits                                                         */
/* ------------------------------------------------------------------ */

function Banner({
  tone, children, onDismiss,
}: {
  tone: "error" | "success" | "info";
  children: React.ReactNode;
  onDismiss?: () => void;
}) {
  const style = {
    error: "bg-red-50 border-red-200 text-red-700",
    success: "bg-green-50 border-green-200 text-green-800",
    info: "bg-blue-50 border-blue-200 text-blue-800",
  }[tone];
  const Icon = tone === "success" ? CheckCircle2 : AlertTriangle;
  return (
    <div className={cn("flex items-start gap-2 p-3 rounded-lg border text-sm", style)} role="status">
      <Icon size={15} className="mt-px shrink-0" />
      <span className="flex-1">{children}</span>
      {onDismiss && (
        <button onClick={onDismiss} className="text-xs underline shrink-0">dismiss</button>
      )}
    </div>
  );
}

function ThemeCard({
  theme, onSelect, disabled, actionLabel, active,
}: {
  theme: WebsiteTheme;
  onSelect: () => void;
  disabled?: boolean;
  actionLabel: string;
  active?: boolean;
}) {
  const colors = theme.tokens?.colors ?? {};
  const fonts = theme.tokens?.fonts ?? {};
  return (
    <div className={cn(
      "rounded-xl border overflow-hidden flex flex-col",
      active ? "border-[#C9A227] ring-2 ring-[#C9A227]/30" : "border-gray-200"
    )}>
      <ThemePreview theme={theme} />
      <div className="p-4 flex-1 flex flex-col">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-bold text-sm text-[#0F2A47]">{theme.name}</h3>
          {theme.is_premium && <Badge variant="purple">premium</Badge>}
        </div>
        <p className="text-xs text-gray-500 mt-1 flex-1">{theme.description}</p>
        <p className="text-[10px] text-gray-400 mt-2">
          {fonts.heading} / {fonts.body}
        </p>
        <Button
          size="sm"
          variant={active ? "secondary" : "gold"}
          className="mt-3 w-full"
          onClick={onSelect}
          disabled={disabled || active}
        >
          {active ? "Current theme" : actionLabel}
        </Button>
      </div>
    </div>
  );
}

/**
 * Miniature rendering of a theme: header bar, hero with the theme's own
 * motif and hero style, a button and two cards. Enough to judge a theme
 * without leaving the studio.
 */
function ThemePreview({ theme, height = 132 }: { theme: WebsiteTheme; height?: number }) {
  const t = theme.tokens ?? {};
  const c = t.colors ?? {};
  const primary = c.primary ?? "#0F2A47";
  const accent = c.accent ?? "#C9A227";
  const bg = c.background ?? "#fff";
  const surface = c.surface ?? "#f8fafc";
  const border = c.border ?? "#e2e8f0";
  const text = c.text ?? "#0f172a";
  const radius = t.radius?.md ?? "12px";
  const motifImage = motifBackground(t.motif ?? "none", withPreviewAlpha(accent));
  const heroDark = ["badge-ring", "gradient", "centered", "full-bleed"].includes(t.heroStyle ?? "");

  return (
    <div aria-hidden="true" style={{ height, background: bg, overflow: "hidden", position: "relative" }}>
      {/* Header */}
      <div style={{
        height: 18, background: t.headerStyle === "dark" ? primary : bg,
        borderBottom: `1px solid ${border}`, display: "flex", alignItems: "center",
        gap: 4, padding: "0 8px",
      }}>
        <div style={{ width: 8, height: 8, borderRadius: 2, background: accent }} />
        <div style={{ width: 26, height: 3, borderRadius: 2, background: t.headerStyle === "dark" ? "rgba(255,255,255,.6)" : text, opacity: 0.7 }} />
        <div style={{ marginLeft: "auto", display: "flex", gap: 3 }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{ width: 10, height: 2, borderRadius: 1, background: t.headerStyle === "dark" ? "rgba(255,255,255,.45)" : text, opacity: 0.5 }} />
          ))}
        </div>
      </div>

      {/* Hero */}
      <div style={{
        height: 58, position: "relative",
        background: heroDark
          ? (t.heroStyle === "gradient"
            ? `radial-gradient(circle at 70% 20%, ${accent}44, transparent 60%), ${primary}`
            : primary)
          : surface,
        backgroundImage: motifImage !== "none" ? motifImage : undefined,
        backgroundSize: motifSize(t.motif ?? "none"),
        padding: "8px 10px",
        display: "flex", alignItems: "center",
        justifyContent: t.heroStyle === "centered" ? "center" : "flex-start",
        textAlign: t.heroStyle === "centered" ? "center" : "left",
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ width: 22, height: 2, background: accent, marginBottom: 4, marginInline: t.heroStyle === "centered" ? "auto" : undefined }} />
          <div style={{ width: "72%", height: 6, borderRadius: 2, background: heroDark ? "#fff" : text, opacity: 0.9, marginBottom: 3, marginInline: t.heroStyle === "centered" ? "auto" : undefined }} />
          <div style={{ width: "48%", height: 4, borderRadius: 2, background: heroDark ? "rgba(255,255,255,.6)" : text, opacity: 0.5, marginBottom: 6, marginInline: t.heroStyle === "centered" ? "auto" : undefined }} />
          <div style={{
            display: "inline-block", padding: "3px 10px", background: accent,
            borderRadius: t.button?.radius ?? radius, height: 12,
          }} />
        </div>
        {t.heroStyle === "badge-ring" && (
          <div style={{
            width: 38, height: 38, borderRadius: "50%", border: `2px solid ${accent}`,
            flexShrink: 0, display: "grid", placeItems: "center",
            fontSize: 11, fontWeight: 800, color: accent,
          }}>GS</div>
        )}
        {t.heroStyle === "image-right" && (
          <div style={{ width: 52, height: 40, borderRadius: radius, background: `${accent}33`, flexShrink: 0, marginLeft: 8 }} />
        )}
      </div>

      {/* Curve divider hint */}
      {t.divider === "curve" && (
        <svg viewBox="0 0 100 8" preserveAspectRatio="none" style={{ display: "block", width: "100%", height: 8, marginTop: -1 }}>
          <path d="M0,0 L100,0 L100,3 Q50,8 0,3 Z" fill={heroDark ? primary : surface} />
        </svg>
      )}

      {/* Cards */}
      <div style={{ display: "flex", gap: 5, padding: "8px 10px" }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{
            flex: 1, height: 30, borderRadius: radius,
            background: bg,
            border: t.cardStyle === "flat" ? "none" : `1px solid ${border}`,
            boxShadow: t.cardStyle === "elevated" ? "0 2px 6px rgba(0,0,0,.10)"
              : t.cardStyle === "glass" ? `0 0 0 1px ${accent}44` : "none",
            padding: 4,
          }}>
            <div style={{ width: 10, height: 10, borderRadius: 3, background: `${primary}22`, marginBottom: 3 }} />
            <div style={{ width: "80%", height: 2, background: text, opacity: 0.35, borderRadius: 1 }} />
          </div>
        ))}
      </div>
    </div>
  );
}

function withPreviewAlpha(hex: string): string {
  const c = hex.replace("#", "");
  const full = c.length === 3 ? c.split("").map(x => x + x).join("") : c;
  if (full.length !== 6) return "rgba(0,0,0,.12)";
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r},${g},${b},0.16)`;
}

/** Small labelled text field that writes into a jsonb column. */
function JsonField({
  label, value, onChange, placeholder, textarea, help, type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  textarea?: boolean;
  help?: string;
  type?: string;
}) {
  const id = `f-${label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {textarea ? (
        <textarea
          id={id}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          rows={4}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
        />
      ) : (
        <input
          id={id}
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
        />
      )}
      {help && <p className="text-xs text-gray-500 mt-1">{help}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Overview                                                            */
/* ------------------------------------------------------------------ */

function OverviewTab({
  supabase, orgId, site, pages, news, events, domains, onPatch, previewPath, saving,
}: {
  supabase: Sb;
  orgId: string;
  site: SiteRow;
  pages: PageRow[];
  news: NewsRow[];
  events: EventRow[];
  domains: DomainRow[];
  onPatch: (p: Partial<SiteRow>) => Promise<void>;
  previewPath: string;
  saving: boolean;
}) {
  const [form, setForm] = useState({
    site_name: site.site_name,
    tagline: site.tagline ?? "",
  });
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [logoUrlDraft, setLogoUrlDraft] = useState(site.logo_url ?? "");

  async function uploadLogo(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      alert("Please choose an image file (PNG, JPG, SVG, or WEBP).");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      alert("Logo must be under 5 MB.");
      return;
    }
    setUploadingLogo(true);
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
    const path = `${orgId}/logo-${Date.now()}-${safeName}`;

    const { error: upErr } = await supabase.storage
      .from("website-media")
      .upload(path, file, { cacheControl: "31536000", upsert: false });

    if (upErr) {
      setUploadingLogo(false);
      alert(
        upErr.message.includes("Bucket not found")
          ? "The website-media storage bucket is missing. Run supabase/website_module.sql."
          : upErr.message
      );
      return;
    }

    const { data: pub } = supabase.storage.from("website-media").getPublicUrl(path);
    setLogoUrlDraft(pub.publicUrl);
    await onPatch({ logo_url: pub.publicUrl });
    setUploadingLogo(false);
  }

  const checklist = [
    { done: pages.some(p => p.slug === "" && p.status === "published"), label: "Home page published" },
    { done: Boolean(site.logo_url), label: "Logo uploaded" },
    { done: Boolean((site.contact ?? {}).email || (site.contact ?? {}).phone), label: "Contact details added" },
    { done: news.filter(n => n.status === "published").length > 0, label: "At least one news article" },
    { done: Boolean((site.seo ?? {}).description), label: "SEO description written" },
    { done: domains.some(d => d.verified), label: "Custom domain verified (optional)" },
    { done: site.status === "published", label: "Site published" },
  ];

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader><CardTitle>Site identity</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Input
            label="Site name"
            value={form.site_name}
            onChange={e => setForm(f => ({ ...f, site_name: e.target.value }))}
          />
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm font-medium text-gray-700">Tagline</label>
              <AiAssistButton
                compact
                kinds={["website_tagline", "polish", "shorten"]}
                currentValue={form.tagline}
                extra={{ school_name: form.site_name || "The school" }}
                onApply={(text) => setForm(f => ({ ...f, tagline: text }))}
                source="website_tagline"
                label="AI"
              />
            </div>
            <input
              value={form.tagline}
              onChange={e => setForm(f => ({ ...f, tagline: e.target.value }))}
              placeholder="Educating with excellence since 1998"
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
            />
          </div>
          <div className="flex items-center gap-3">
            <Button
              size="sm" variant="gold" loading={saving}
              onClick={() => onPatch({ site_name: form.site_name, tagline: form.tagline })}
            >
              <Save size={14} /> Save
            </Button>
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={site.maintenance_mode}
                onChange={e => onPatch({ maintenance_mode: e.target.checked })}
                className="w-4 h-4 rounded border-gray-300 text-[#C9A227] focus:ring-[#C9A227]"
              />
              Maintenance mode
            </label>
          </div>

          <div className="pt-3 border-t border-gray-100">
            <h4 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">
              Addresses
            </h4>
            <ul className="text-sm space-y-1.5">
              <li className="flex items-center gap-2">
                <span className="text-gray-500 w-24 shrink-0">Preview</span>
                <a href={previewPath} target="_blank" rel="noopener noreferrer"
                   className="text-[#0F2A47] hover:underline break-all">{previewPath}</a>
              </li>
              {site.subdomain && (
                <li className="flex items-center gap-2">
                  <span className="text-gray-500 w-24 shrink-0">Subdomain</span>
                  <code className="text-xs">{site.subdomain}.&lt;your-platform-domain&gt;</code>
                </li>
              )}
              {domains.filter(d => d.verified).map(d => (
                <li key={d.id} className="flex items-center gap-2">
                  <span className="text-gray-500 w-24 shrink-0">Live domain</span>
                  <a href={`https://${d.hostname}`} target="_blank" rel="noopener noreferrer"
                     className="text-[#0F2A47] hover:underline">{d.hostname}</a>
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader><CardTitle>Logo</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-gray-600">
            Shown top-left in your site&apos;s header, and used as the default
            crest wherever your logo appears on the public site.
          </p>

          {site.logo_url && (
            <div className="flex items-center gap-4 p-4 border border-gray-200 rounded-lg bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={site.logo_url}
                alt={`${site.site_name} logo`}
                className="h-16 w-auto object-contain"
              />
              <p className="text-xs text-gray-500 break-all">{site.logo_url}</p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Upload a new logo
            </label>
            <input
              type="file"
              accept="image/*"
              disabled={uploadingLogo}
              onChange={e => uploadLogo(e.target.files)}
              className="block w-full text-sm text-gray-600
                file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0
                file:text-sm file:font-medium file:bg-gray-100 file:text-gray-700
                hover:file:bg-gray-200 disabled:opacity-50"
            />
            <p className="text-xs text-gray-400 mt-1">
              {uploadingLogo ? "Uploading\u2026" : "PNG or SVG with a transparent background works best. Under 5 MB."}
            </p>
          </div>

          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Input
                label="Or paste an image URL"
                value={logoUrlDraft}
                onChange={e => setLogoUrlDraft(e.target.value)}
                placeholder="https://example.com/logo.png"
              />
            </div>
            <Button
              size="sm" variant="secondary" loading={saving}
              onClick={() => onPatch({ logo_url: logoUrlDraft.trim() || null })}
            >
              <Save size={14} /> Save
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-5">
        <Card>
          <CardHeader><CardTitle>Launch checklist</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {checklist.map((c, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  {c.done
                    ? <CheckCircle2 size={15} className="text-green-600 mt-0.5 shrink-0" />
                    : <span className="w-[15px] h-[15px] mt-0.5 shrink-0 rounded-full border-2 border-gray-300" />}
                  <span className={c.done ? "text-gray-500 line-through" : "text-gray-800"}>
                    {c.label}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Content</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <Metric label="Pages" value={pages.length} />
              <Metric label="Published pages" value={pages.filter(p => p.status === "published").length} />
              <Metric label="News articles" value={news.length} />
              <Metric label="Events" value={events.length} />
            </dl>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <dt className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{label}</dt>
      <dd className="text-xl font-bold text-[#0F2A47] mt-0.5">{value}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pages & Sections                                                    */
/* ------------------------------------------------------------------ */

type Sb = ReturnType<typeof createClient>;

function PagesTab({
  supabase, site, pages, activePage, pageSections, setActivePageId,
  media, reload, flash, setError,
}: {
  supabase: Sb;
  site: SiteRow;
  pages: PageRow[];
  activePage: PageRow | null;
  pageSections: SectionRow[];
  setActivePageId: (id: string) => void;
  media: MediaRow[];
  reload: () => Promise<void>;
  flash: (m: string) => void;
  setError: (m: string) => void;
}) {
  const [showAddPage, setShowAddPage] = useState(false);
  const [showAddSection, setShowAddSection] = useState(false);
  const [newPage, setNewPage] = useState({ title: "", slug: "", page_type: "standard" });
  const [busy, setBusy] = useState(false);
  const [editingSection, setEditingSection] = useState<SectionRow | null>(null);

  async function addPage() {
    setBusy(true);
    const slug = slugify(newPage.slug || newPage.title);
    const { error } = await supabase.from("website_pages").insert({
      organization_id: site.organization_id,
      website_id: site.id,
      slug,
      title: newPage.title.trim(),
      page_type: newPage.page_type,
      status: "draft",
      nav_order: pages.length,
      nav_label: newPage.title.trim(),
    });
    setBusy(false);
    if (error) {
      setError(
        error.code === "23505" || error.message.includes("duplicate")
          ? `A page with the address /${slug} already exists.`
          : error.message
      );
      return;
    }
    setShowAddPage(false);
    setNewPage({ title: "", slug: "", page_type: "standard" });
    flash("Page created.");
    await reload();
  }

  async function patchPage(id: string, patch: Partial<PageRow>) {
    const { error } = await supabase.from("website_pages").update(patch).eq("id", id);
    if (error) { setError(error.message); return; }
    await reload();
  }

  async function deletePage(p: PageRow) {
    if (p.slug === "") {
      setError("The home page cannot be deleted.");
      return;
    }
    if (!confirm(`Delete the "${p.title}" page and all its sections? This cannot be undone.`)) return;
    const { error } = await supabase.from("website_pages").delete().eq("id", p.id);
    if (error) { setError(error.message); return; }
    flash("Page deleted.");
    await reload();
  }

  async function addSection(type: string) {
    if (!activePage) return;
    setBusy(true);
    const { data: defaults } = await supabase.rpc("default_section_content", {
      p_type: type,
      p_school: site.site_name,
    });
    const { error } = await supabase.from("website_sections").insert({
      organization_id: site.organization_id,
      website_id: site.id,
      page_id: activePage.id,
      section_type: type,
      position: pageSections.length + 1,
      content: (defaults as Record<string, unknown>) ?? {},
    });
    setBusy(false);
    if (error) { setError(error.message); return; }
    setShowAddSection(false);
    flash(`${SECTION_META[type]?.label ?? type} added.`);
    await reload();
  }

  async function moveSection(section: SectionRow, dir: -1 | 1) {
    const ordered = [...pageSections];
    const i = ordered.findIndex(s => s.id === section.id);
    const j = i + dir;
    if (j < 0 || j >= ordered.length) return;

    // Swap positions, then persist both rows.
    const a = ordered[i], b = ordered[j];
    await Promise.all([
      supabase.from("website_sections").update({ position: b.position }).eq("id", a.id),
      supabase.from("website_sections").update({ position: a.position }).eq("id", b.id),
    ]);
    await reload();
  }

  async function toggleSection(section: SectionRow) {
    await supabase.from("website_sections")
      .update({ visible: !section.visible }).eq("id", section.id);
    await reload();
  }

  async function deleteSection(section: SectionRow) {
    if (!confirm("Remove this section from the page?")) return;
    await supabase.from("website_sections").delete().eq("id", section.id);
    flash("Section removed.");
    await reload();
  }

  const groups = Array.from(new Set(SECTION_CATALOGUE.map(s => s.group)));

  return (
    <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
      {/* --- Page list --- */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Pages</CardTitle>
            <Button size="sm" variant="secondary" onClick={() => setShowAddPage(true)}>
              <Plus size={13} />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1 list-none p-0">
            {pages.map(p => (
              <li key={p.id}>
                <button
                  onClick={() => setActivePageId(p.id)}
                  className={cn(
                    "w-full text-left px-3 py-2 rounded-lg transition-colors",
                    activePage?.id === p.id ? "bg-[#0F2A47] text-white" : "hover:bg-gray-100"
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium truncate">{p.title}</span>
                    {p.status !== "published" && (
                      <span className={cn(
                        "text-[9px] font-bold px-1 rounded shrink-0",
                        activePage?.id === p.id ? "bg-white/20" : "bg-amber-100 text-amber-700"
                      )}>
                        draft
                      </span>
                    )}
                  </span>
                  <span className={cn(
                    "block text-[10px] font-mono truncate",
                    activePage?.id === p.id ? "text-white/60" : "text-gray-400"
                  )}>
                    /{p.slug || ""}
                    {p.page_type !== "standard" ? ` · ${p.page_type}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* --- Section builder --- */}
      <div className="space-y-5">
        {activePage ? (
          <>
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <CardTitle>{activePage.title}</CardTitle>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant={activePage.status === "published" ? "secondary" : "gold"}
                      onClick={() => patchPage(activePage.id, {
                        status: activePage.status === "published" ? "draft" : "published",
                      })}
                    >
                      {activePage.status === "published" ? "Unpublish page" : "Publish page"}
                    </Button>
                    {activePage.slug !== "" && (
                      <Button size="sm" variant="danger" onClick={() => deletePage(activePage)}>
                        <Trash2 size={13} />
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    label="Page title"
                    value={activePage.title}
                    onChange={e => patchPage(activePage.id, { title: e.target.value })}
                  />
                  <Input
                    label="Navigation label"
                    value={activePage.nav_label ?? ""}
                    onChange={e => patchPage(activePage.id, { nav_label: e.target.value })}
                  />
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={activePage.show_in_nav}
                    onChange={e => patchPage(activePage.id, { show_in_nav: e.target.checked })}
                    className="w-4 h-4 rounded border-gray-300 text-[#C9A227] focus:ring-[#C9A227]"
                  />
                  Show in the site menu
                </label>
                {activePage.page_type !== "standard" && (
                  <Banner tone="info">
                    This is a <strong>{activePage.page_type.replace("_", " ")}</strong> page. Its
                    main body is generated from your {activePage.page_type === "news_index" ? "news articles" : activePage.page_type === "event_index" ? "events" : "enquiry form"},
                    so you do not have to retype anything. Sections you add appear above it.
                  </Banner>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <LayoutTemplate size={15} /> Sections ({pageSections.length})
                  </CardTitle>
                  <Button size="sm" variant="gold" onClick={() => setShowAddSection(true)}>
                    <Plus size={13} /> Add section
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {pageSections.length === 0 ? (
                  <div className="py-10 text-center">
                    <LayoutTemplate size={28} className="mx-auto text-gray-300 mb-2" />
                    <p className="text-sm text-gray-500">
                      No sections yet. Add one to start building this page.
                    </p>
                  </div>
                ) : (
                  <ol className="space-y-2 list-none p-0">
                    {pageSections.map((s, i) => {
                      const meta = SECTION_META[s.section_type];
                      return (
                        <li
                          key={s.id}
                          className={cn(
                            "flex items-center gap-3 p-3 rounded-lg border",
                            s.visible ? "border-gray-200 bg-white" : "border-dashed border-gray-300 bg-gray-50"
                          )}
                        >
                          <span className="text-xs font-mono text-gray-400 w-5 shrink-0">{i + 1}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">
                              {meta?.label ?? s.section_type}
                              {!s.visible && <span className="ml-2 text-xs text-gray-400">(hidden)</span>}
                            </p>
                            <p className="text-xs text-gray-500 truncate">
                              {String((s.content as Record<string, unknown>)?.heading ?? meta?.description ?? "")}
                            </p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <IconBtn label="Move up" onClick={() => moveSection(s, -1)} disabled={i === 0}>
                              <ChevronUp size={14} />
                            </IconBtn>
                            <IconBtn label="Move down" onClick={() => moveSection(s, 1)}
                              disabled={i === pageSections.length - 1}>
                              <ChevronDown size={14} />
                            </IconBtn>
                            <IconBtn label={s.visible ? "Hide section" : "Show section"}
                              onClick={() => toggleSection(s)}>
                              {s.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                            </IconBtn>
                            <Button size="sm" variant="secondary" onClick={() => setEditingSection(s)}>
                              Edit
                            </Button>
                            <IconBtn label="Delete section" danger onClick={() => deleteSection(s)}>
                              <Trash2 size={14} />
                            </IconBtn>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </CardContent>
            </Card>
          </>
        ) : (
          <Card><CardContent><p className="text-sm text-gray-500 py-8 text-center">
            Select a page on the left.
          </p></CardContent></Card>
        )}
      </div>

      {/* --- Add page modal --- */}
      {showAddPage && (
        <Modal open onClose={() => setShowAddPage(false)} title="Add a page" size="lg">
          <div className="space-y-4">
            <Input
              label="Page title"
              value={newPage.title}
              onChange={e => setNewPage(f => ({ ...f, title: e.target.value }))}
              placeholder="Facilities"
            />
            <Input
              label="Address"
              value={newPage.slug}
              onChange={e => setNewPage(f => ({ ...f, slug: e.target.value }))}
              placeholder={slugify(newPage.title) || "facilities"}
              helpText="Left blank, this is generated from the title."
            />
            <div>
              <label htmlFor="page-type" className="block text-sm font-medium text-gray-700 mb-1">
                Page type
              </label>
              <select
                id="page-type"
                value={newPage.page_type}
                onChange={e => setNewPage(f => ({ ...f, page_type: e.target.value }))}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white"
              >
                <option value="standard">Standard — built from sections</option>
                <option value="news_index">News listing — pulls your articles</option>
                <option value="event_index">Events listing — pulls your events</option>
                <option value="contact">Contact — details plus an enquiry form</option>
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setShowAddPage(false)}>Cancel</Button>
              <Button variant="gold" loading={busy} disabled={!newPage.title.trim()} onClick={addPage}>
                Create page
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* --- Add section modal --- */}
      {showAddSection && (
        <Modal open onClose={() => setShowAddSection(false)} title="Add a section" size="xl">
          <div className="space-y-5 max-h-[65vh] overflow-y-auto">
            {groups.map(group => (
              <div key={group}>
                <h4 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">
                  {group}
                </h4>
                <div className="grid gap-2 sm:grid-cols-2">
                  {SECTION_CATALOGUE.filter(s => s.group === group).map(s => (
                    <button
                      key={s.type}
                      onClick={() => addSection(s.type)}
                      disabled={busy}
                      className="text-left p-3 rounded-lg border border-gray-200 hover:border-[#C9A227] hover:bg-[#FBF6E8] transition-colors disabled:opacity-50"
                    >
                      <span className="block text-sm font-semibold text-gray-900">{s.label}</span>
                      <span className="block text-xs text-gray-500 mt-0.5">{s.description}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Modal>
      )}

      {/* --- Section editor --- */}
      {editingSection && (
        <SectionEditor
          supabase={supabase}
          section={editingSection}
          media={media}
          onClose={() => setEditingSection(null)}
          onSaved={async () => { setEditingSection(null); flash("Section saved."); await reload(); }}
          setError={setError}
        />
      )}
    </div>
  );
}

function IconBtn({
  children, label, onClick, disabled, danger,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "p-1.5 rounded transition-colors disabled:opacity-30",
        danger ? "text-red-500 hover:bg-red-50" : "text-gray-500 hover:bg-gray-100"
      )}
    >
      {children}
    </button>
  );
}

/* ---------------------- Section content editor ---------------------- */

function SectionEditor({
  supabase, section, media, onClose, onSaved, setError,
}: {
  supabase: Sb;
  section: SectionRow;
  media: MediaRow[];
  onClose: () => void;
  onSaved: () => Promise<void>;
  setError: (m: string) => void;
}) {
  const meta = SECTION_META[section.section_type];
  const [content, setContent] = useState<Record<string, unknown>>(section.content ?? {});
  const [style, setStyle] = useState<Record<string, unknown>>(section.style ?? {});
  const [eyebrow, setEyebrow] = useState(section.eyebrow ?? "");
  const [anchorId, setAnchorId] = useState(section.anchor_id ?? "");
  const [pane, setPane] = useState<"content" | "style">("content");
  const [saving, setSaving] = useState(false);

  const set = (k: string, v: unknown) => setContent(c => ({ ...c, [k]: v }));
  const setSty = (k: string, v: unknown) => setStyle(s => ({ ...s, [k]: v }));

  async function save() {
    setSaving(true);
    const { error } = await supabase.from("website_sections")
      .update({
        content,
        style,
        eyebrow: eyebrow.trim() || null,
        // Anchors must be URL-safe so they work as #fragments.
        anchor_id: anchorId.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-") || null,
      })
      .eq("id", section.id);
    setSaving(false);
    if (error) { setError(error.message); return; }
    await onSaved();
  }

  if (!meta) {
    return (
      <Modal open onClose={onClose} title="Unknown section" size="md">
        <p className="text-sm text-gray-600">
          This section type ({section.section_type}) is not in the current block library, so it
          cannot be edited here. It is skipped when the page renders.
        </p>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title={`Edit: ${meta.label}`} size="xl">
      {/* Content / Style panes */}
      <div className="flex gap-1 p-1 bg-gray-100 rounded-lg mb-4" role="tablist">
        {([
          { id: "content", label: "Content", icon: <FileText size={13} /> },
          { id: "style", label: "Appearance", icon: <Palette size={13} /> },
        ] as const).map(p => (
          <button
            key={p.id}
            role="tab"
            aria-selected={pane === p.id}
            onClick={() => setPane(p.id)}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-colors",
              pane === p.id ? "bg-white shadow-sm text-[#0F2A47]" : "text-gray-600 hover:text-gray-900"
            )}
          >
            {p.icon} {p.label}
          </button>
        ))}
      </div>

      <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
        {pane === "content" ? (
          <>
            <p className="text-xs text-gray-500">{meta.description}</p>
            {meta.fields.map(field => (
              <FieldEditor
                key={field.name}
                field={field}
                value={content[field.name]}
                onChange={v => set(field.name, v)}
                media={media}
              />
            ))}
          </>
        ) : (
          <SectionStyleEditor
            style={style}
            setStyle={setSty}
            eyebrow={eyebrow}
            setEyebrow={setEyebrow}
            anchorId={anchorId}
            setAnchorId={setAnchorId}
          />
        )}
      </div>

      <div className="flex justify-end gap-2 pt-4 border-t border-gray-100 mt-4">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="gold" loading={saving} onClick={save}>
          <Save size={14} /> Save section
        </Button>
      </div>
    </Modal>
  );
}

/**
 * Per-section appearance controls.
 *
 * Everything here is an override on top of the theme. Left on "Theme
 * default" a section simply inherits, which is what most sections should
 * do — the controls exist for the one or two blocks a school wants to
 * make stand out.
 */
function SectionStyleEditor({
  style, setStyle, eyebrow, setEyebrow, anchorId, setAnchorId,
}: {
  style: Record<string, unknown>;
  setStyle: (k: string, v: unknown) => void;
  eyebrow: string;
  setEyebrow: (v: string) => void;
  anchorId: string;
  setAnchorId: (v: string) => void;
}) {
  const strv = (k: string) => (typeof style[k] === "string" ? style[k] as string : "");
  const boolv = (k: string) => style[k] === true;

  return (
    <div className="space-y-5">
      <fieldset className="space-y-3 p-3 border border-gray-200 rounded-xl">
        <legend className="text-xs font-bold uppercase tracking-wider text-gray-500 px-1">
          Band
        </legend>

        <SelectRow
          label="Background tone"
          help="Which theme surface this section sits on."
          value={strv("tone")}
          onChange={v => setStyle("tone", v || undefined)}
          options={[
            { value: "", label: "Theme default (alternating)" },
            { value: "background", label: "Page background" },
            { value: "surface", label: "Surface" },
            { value: "surfaceAlt", label: "Surface (alternate)" },
            { value: "primary", label: "Primary — light text" },
            { value: "primaryDark", label: "Primary dark — light text" },
            { value: "ink", label: "Ink — maximum contrast" },
          ]}
        />

        <div>
          <label htmlFor="sec-bg" className="block text-sm font-medium text-gray-700 mb-1">
            Custom background
          </label>
          <div className="flex items-center gap-2">
            <input
              id="sec-bg"
              type="color"
              value={strv("background") || "#ffffff"}
              onChange={e => setStyle("background", e.target.value)}
              className="w-9 h-9 rounded border border-gray-300 cursor-pointer shrink-0"
              aria-label="Custom background colour"
            />
            <input
              type="text"
              value={strv("background")}
              onChange={e => setStyle("background", e.target.value || undefined)}
              placeholder="Leave blank to use the tone above"
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono"
            />
            {strv("background") && (
              <button
                onClick={() => setStyle("background", undefined)}
                className="text-xs text-gray-500 hover:text-red-600 underline shrink-0"
              >
                clear
              </button>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Overrides the tone. Check contrast if you set a dark colour — text does not
            invert automatically.
          </p>
        </div>

        <SelectRow
          label="Vertical padding"
          value={strv("padding")}
          onChange={v => setStyle("padding", v || undefined)}
          options={[
            { value: "", label: "Theme default" },
            { value: "none", label: "None" },
            { value: "tight", label: "Tight" },
            { value: "normal", label: "Normal" },
            { value: "loose", label: "Loose" },
          ]}
        />

        <SelectRow
          label="Content alignment"
          value={strv("align")}
          onChange={v => setStyle("align", v || undefined)}
          options={[
            { value: "", label: "Theme default" },
            { value: "left", label: "Left" },
            { value: "center", label: "Centred" },
          ]}
        />
      </fieldset>

      <fieldset className="space-y-3 p-3 border border-gray-200 rounded-xl">
        <legend className="text-xs font-bold uppercase tracking-wider text-gray-500 px-1">
          Texture &amp; edges
        </legend>

        <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
          <input
            type="checkbox"
            checked={boolv("motif")}
            onChange={e => setStyle("motif", e.target.checked || undefined)}
            className="mt-0.5 w-4 h-4 rounded border-gray-300 text-[#C9A227] focus:ring-[#C9A227]"
          />
          <span>
            Overlay the theme texture
            <span className="block text-xs text-gray-500">
              Uses whichever motif the active theme defines — weave, dots, grid or rules.
            </span>
          </span>
        </label>

        <SelectRow
          label="Divider"
          help="Shape of the transition into the next section."
          value={strv("divider")}
          onChange={v => setStyle("divider", v || undefined)}
          options={[
            { value: "", label: "Theme default" },
            { value: "none", label: "None — hard edge" },
            { value: "curve", label: "Curve" },
            { value: "angle", label: "Angle" },
            { value: "weave", label: "Weave strip" },
            { value: "rule", label: "Rule with ornament" },
          ]}
        />

        <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
          <input
            type="checkbox"
            checked={boolv("fullBleed")}
            onChange={e => setStyle("fullBleed", e.target.checked || undefined)}
            className="mt-0.5 w-4 h-4 rounded border-gray-300 text-[#C9A227] focus:ring-[#C9A227]"
          />
          <span>
            Full bleed
            <span className="block text-xs text-gray-500">
              Ignore the container and run edge to edge.
            </span>
          </span>
        </label>
      </fieldset>

      <fieldset className="space-y-3 p-3 border border-gray-200 rounded-xl">
        <legend className="text-xs font-bold uppercase tracking-wider text-gray-500 px-1">
          Labelling
        </legend>

        <div>
          <label htmlFor="sec-eyebrow" className="block text-sm font-medium text-gray-700 mb-1">
            Eyebrow
          </label>
          <input
            id="sec-eyebrow"
            value={eyebrow}
            onChange={e => setEyebrow(e.target.value)}
            placeholder="e.g. Why us"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
          <p className="text-xs text-gray-500 mt-1">
            Small uppercase label above the heading.
          </p>
        </div>

        <div>
          <label htmlFor="sec-anchor" className="block text-sm font-medium text-gray-700 mb-1">
            Anchor id
          </label>
          <input
            id="sec-anchor"
            value={anchorId}
            onChange={e => setAnchorId(e.target.value)}
            placeholder="admissions"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono"
          />
          <p className="text-xs text-gray-500 mt-1">
            Lets you link straight here with <code>#{anchorId || "your-anchor"}</code> from a
            menu item or button.
          </p>
        </div>
      </fieldset>
    </div>
  );
}

function SelectRow({
  label, value, onChange, options, help,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  help?: string;
}) {
  const id = `sr-${label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <select
        id={id}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {help && <p className="text-xs text-gray-500 mt-1">{help}</p>}
    </div>
  );
}

function FieldEditor({
  field, value, onChange, media,
}: {
  field: SectionFieldMeta;
  value: unknown;
  onChange: (v: unknown) => void;
  media: MediaRow[];
}) {
  const id = `sf-${field.name}`;

  if (field.type === "list") {
    const items = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
    return (
      <fieldset className="border border-gray-200 rounded-lg p-3">
        <legend className="text-sm font-medium text-gray-700 px-1">{field.label}</legend>
        <div className="space-y-3">
          {items.map((item, i) => (
            <div key={i} className="p-3 rounded-lg bg-gray-50 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-gray-500">Item {i + 1}</span>
                <div className="flex items-center gap-1">
                  <IconBtn label="Move up" disabled={i === 0} onClick={() => {
                    const next = [...items];
                    [next[i - 1], next[i]] = [next[i], next[i - 1]];
                    onChange(next);
                  }}><ChevronUp size={13} /></IconBtn>
                  <IconBtn label="Move down" disabled={i === items.length - 1} onClick={() => {
                    const next = [...items];
                    [next[i + 1], next[i]] = [next[i], next[i + 1]];
                    onChange(next);
                  }}><ChevronDown size={13} /></IconBtn>
                  <IconBtn label="Remove item" danger onClick={() =>
                    onChange(items.filter((_, j) => j !== i))
                  }><Trash2 size={13} /></IconBtn>
                </div>
              </div>
              {(field.itemFields ?? []).map(f => (
                <div key={f.name}>
                  <label
                    htmlFor={`${id}-${i}-${f.name}`}
                    className="block text-xs font-medium text-gray-600 mb-1"
                  >
                    {f.label}
                  </label>
                  {f.type === "textarea" ? (
                    <textarea
                      id={`${id}-${i}-${f.name}`}
                      rows={2}
                      value={String(item[f.name] ?? "")}
                      onChange={e => {
                        const next = [...items];
                        next[i] = { ...next[i], [f.name]: e.target.value };
                        onChange(next);
                      }}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                    />
                  ) : f.type === "image" ? (
                    <ImagePicker
                      id={`${id}-${i}-${f.name}`}
                      value={String(item[f.name] ?? "")}
                      media={media}
                      onChange={v => {
                        const next = [...items];
                        next[i] = { ...next[i], [f.name]: v };
                        onChange(next);
                      }}
                    />
                  ) : (
                    <input
                      id={`${id}-${i}-${f.name}`}
                      value={String(item[f.name] ?? "")}
                      onChange={e => {
                        const next = [...items];
                        next[i] = { ...next[i], [f.name]: e.target.value };
                        onChange(next);
                      }}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                    />
                  )}
                </div>
              ))}
            </div>
          ))}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onChange([...items, {}])}
          >
            <Plus size={13} /> Add item
          </Button>
        </div>
      </fieldset>
    );
  }

  if (field.type === "boolean") {
    return (
      <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={e => onChange(e.target.checked)}
          className="w-4 h-4 rounded border-gray-300 text-[#C9A227] focus:ring-[#C9A227]"
        />
        {field.label}
      </label>
    );
  }

  if (field.type === "image") {
    return (
      <div>
        <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">
          {field.label}
        </label>
        <ImagePicker id={id} value={String(value ?? "")} media={media} onChange={v => onChange(v)} />
        {field.help && <p className="text-xs text-gray-500 mt-1">{field.help}</p>}
      </div>
    );
  }

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">
        {field.label}
      </label>
      {field.type === "textarea" ? (
        <textarea
          id={id}
          rows={4}
          value={String(value ?? "")}
          onChange={e => onChange(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
        />
      ) : (
        <input
          id={id}
          type={field.type === "number" ? "number" : field.type === "url" ? "text" : "text"}
          value={String(value ?? "")}
          onChange={e => onChange(
            field.type === "number" ? Number(e.target.value) : e.target.value
          )}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
        />
      )}
      {field.help && <p className="text-xs text-gray-500 mt-1">{field.help}</p>}
    </div>
  );
}

function ImagePicker({
  id, value, media, onChange,
}: {
  id: string;
  value: string;
  media: MediaRow[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-start gap-2">
      <div className="w-14 h-14 rounded border border-gray-200 bg-gray-50 grid place-items-center overflow-hidden shrink-0">
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="" className="w-full h-full object-cover" />
        ) : (
          <ImageIcon size={16} className="text-gray-300" />
        )}
      </div>
      <div className="flex-1 min-w-0 space-y-1.5">
        <input
          id={id}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="https://…"
          className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
        />
        {media.length > 0 && (
          <select
            aria-label="Choose from media library"
            value=""
            onChange={e => e.target.value && onChange(e.target.value)}
            className="w-full text-xs border border-gray-300 rounded px-2 py-1 bg-white"
          >
            <option value="">From media library…</option>
            {media.map(m => <option key={m.id} value={m.url}>{m.file_name}</option>)}
          </select>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* News                                                                */
/* ------------------------------------------------------------------ */

function NewsTab({
  supabase, site, rows, reload, flash, setError, authorDefault, media,
}: {
  supabase: Sb;
  site: SiteRow;
  rows: NewsRow[];
  reload: () => Promise<void>;
  flash: (m: string) => void;
  setError: (m: string) => void;
  authorDefault: string;
  media: MediaRow[];
}) {
  const [editing, setEditing] = useState<NewsRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    title: "", slug: "", excerpt: "", body: "", category: "",
    cover_image_url: "", author_name: authorDefault, status: "draft",
  });
  const [busy, setBusy] = useState(false);

  function openNew() {
    setForm({
      title: "", slug: "", excerpt: "", body: "", category: "",
      cover_image_url: "", author_name: authorDefault, status: "draft",
    });
    setEditing(null);
    setCreating(true);
  }

  function openEdit(r: NewsRow) {
    setForm({
      title: r.title, slug: r.slug, excerpt: r.excerpt ?? "", body: r.body ?? "",
      category: r.category ?? "", cover_image_url: r.cover_image_url ?? "",
      author_name: r.author_name ?? "", status: r.status,
    });
    setEditing(r);
    setCreating(true);
  }

  async function save() {
    setBusy(true);
    const slug = slugify(form.slug || form.title);
    const payload = {
      organization_id: site.organization_id,
      website_id: site.id,
      slug,
      title: form.title.trim(),
      excerpt: form.excerpt || null,
      body: form.body || null,
      category: form.category || null,
      cover_image_url: form.cover_image_url || null,
      author_name: form.author_name || null,
      status: form.status,
      published_at:
        form.status === "published"
          ? (editing?.published_at ?? new Date().toISOString())
          : null,
    };

    const { error } = editing
      ? await supabase.from("website_news").update(payload).eq("id", editing.id)
      : await supabase.from("website_news").insert(payload);

    setBusy(false);
    if (error) {
      setError(
        error.message.includes("duplicate")
          ? `An article with the address /${slug} already exists.`
          : error.message
      );
      return;
    }
    setCreating(false);
    setEditing(null);
    flash(editing ? "Article updated." : "Article created.");
    await reload();
  }

  async function remove(r: NewsRow) {
    if (!confirm(`Delete "${r.title}"?`)) return;
    await supabase.from("website_news").delete().eq("id", r.id);
    flash("Article deleted.");
    await reload();
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>News ({rows.length})</CardTitle>
          <Button size="sm" variant="gold" onClick={openNew}><Plus size={13} /> New article</Button>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-gray-500 mb-4">
          Published articles appear automatically on your website&apos;s news page and in any
          &ldquo;Latest news&rdquo; section. You never enter the same thing twice.
        </p>

        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-500">No articles yet.</p>
        ) : (
          <div className="overflow-x-auto border border-gray-200 rounded-lg">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b">
                  <th className="text-left px-3 py-2 font-semibold text-gray-600">Title</th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-600">Category</th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-600">Status</th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-600">Published</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="px-3 py-2 font-medium">{r.title}</td>
                    <td className="px-3 py-2 text-gray-500 text-xs">{r.category ?? "—"}</td>
                    <td className="px-3 py-2">
                      <Badge variant={r.status === "published" ? "green" : "amber"}>{r.status}</Badge>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-400">
                      {r.published_at ? new Date(r.published_at).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button onClick={() => openEdit(r)}
                        className="text-xs text-[#0F2A47] hover:underline mr-3">Edit</button>
                      <button onClick={() => remove(r)}
                        className="text-xs text-red-600 hover:underline">Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      {creating && (
        <Modal open onClose={() => setCreating(false)}
          title={editing ? "Edit article" : "New article"} size="xl">
          <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
            <Input label="Title" value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            <Input label="Address" value={form.slug}
              onChange={e => setForm(f => ({ ...f, slug: e.target.value }))}
              placeholder={slugify(form.title)}
              helpText="Left blank, generated from the title." />
            <Input label="Category" value={form.category}
              onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
              placeholder="Achievements" />
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm font-medium text-gray-700">Summary</label>
                <AiAssistButton
                  compact
                  kinds={["polish", "shorten", "expand"]}
                  currentValue={form.excerpt}
                  onApply={(text) => setForm(f => ({ ...f, excerpt: text }))}
                  source="website_news_excerpt"
                  label="AI"
                />
              </div>
              <JsonField label="" value={form.excerpt} textarea
                onChange={v => setForm(f => ({ ...f, excerpt: v }))}
                help="Shown in listings and previews." />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm font-medium text-gray-700">Article</label>
                <AiAssistButton
                  compact
                  kinds={["website_paragraph", "polish", "expand", "rewrite_encouraging"]}
                  currentValue={form.body}
                  extra={{ school_name: site.site_name || "The school", audience: "school community" }}
                  onApply={(text) => setForm(f => ({ ...f, body: text }))}
                  source="website_news_body"
                  label="AI"
                />
              </div>
              <JsonField label="" value={form.body} textarea
                onChange={v => setForm(f => ({ ...f, body: v }))}
                help="Separate paragraphs with a blank line." />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Cover image</label>
              <ImagePicker id="news-cover" value={form.cover_image_url} media={media}
                onChange={v => setForm(f => ({ ...f, cover_image_url: v }))} />
            </div>
            <Input label="Author" value={form.author_name}
              onChange={e => setForm(f => ({ ...f, author_name: e.target.value }))} />
            <div>
              <label htmlFor="news-status" className="block text-sm font-medium text-gray-700 mb-1">
                Status
              </label>
              <select id="news-status" value={form.status}
                onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white">
                <option value="draft">Draft — not visible publicly</option>
                <option value="in_review">In review — awaiting approval</option>
                <option value="published">Published — live on the website</option>
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setCreating(false)}>Cancel</Button>
              <Button variant="gold" loading={busy} disabled={!form.title.trim()} onClick={save}>
                {editing ? "Save changes" : "Create article"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

function EventsTab({
  supabase, site, rows, reload, flash, setError,
}: {
  supabase: Sb;
  site: SiteRow;
  rows: EventRow[];
  reload: () => Promise<void>;
  flash: (m: string) => void;
  setError: (m: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<EventRow | null>(null);
  const [form, setForm] = useState({
    title: "", slug: "", description: "", location: "",
    starts_at: "", ends_at: "", all_day: false, status: "draft",
  });
  const [busy, setBusy] = useState(false);

  function openNew() {
    setForm({
      title: "", slug: "", description: "", location: "",
      starts_at: "", ends_at: "", all_day: false, status: "draft",
    });
    setEditing(null);
    setCreating(true);
  }

  function openEdit(r: EventRow) {
    setForm({
      title: r.title, slug: r.slug, description: r.description ?? "",
      location: r.location ?? "",
      starts_at: r.starts_at ? r.starts_at.slice(0, 16) : "",
      ends_at: r.ends_at ? r.ends_at.slice(0, 16) : "",
      all_day: r.all_day, status: r.status,
    });
    setEditing(r);
    setCreating(true);
  }

  async function save() {
    if (!form.starts_at) { setError("A start date and time is required."); return; }
    setBusy(true);
    const slug = slugify(form.slug || form.title);
    const payload = {
      organization_id: site.organization_id,
      website_id: site.id,
      slug,
      title: form.title.trim(),
      description: form.description || null,
      location: form.location || null,
      starts_at: new Date(form.starts_at).toISOString(),
      ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null,
      all_day: form.all_day,
      status: form.status,
    };

    const { error } = editing
      ? await supabase.from("website_events").update(payload).eq("id", editing.id)
      : await supabase.from("website_events").insert(payload);

    setBusy(false);
    if (error) {
      setError(
        error.message.includes("duplicate")
          ? `An event with the address /${slug} already exists.`
          : error.message
      );
      return;
    }
    setCreating(false);
    flash(editing ? "Event updated." : "Event created.");
    await reload();
  }

  async function remove(r: EventRow) {
    if (!confirm(`Delete "${r.title}"?`)) return;
    await supabase.from("website_events").delete().eq("id", r.id);
    flash("Event deleted.");
    await reload();
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Events ({rows.length})</CardTitle>
          <Button size="sm" variant="gold" onClick={openNew}><Plus size={13} /> New event</Button>
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-500">No events yet.</p>
        ) : (
          <div className="overflow-x-auto border border-gray-200 rounded-lg">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b">
                  <th className="text-left px-3 py-2 font-semibold text-gray-600">Event</th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-600">When</th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-600">Where</th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-600">Status</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="px-3 py-2 font-medium">{r.title}</td>
                    <td className="px-3 py-2 text-xs text-gray-600">
                      {new Date(r.starts_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500">{r.location ?? "—"}</td>
                    <td className="px-3 py-2">
                      <Badge variant={r.status === "published" ? "green" : r.status === "cancelled" ? "red" : "amber"}>
                        {r.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button onClick={() => openEdit(r)}
                        className="text-xs text-[#0F2A47] hover:underline mr-3">Edit</button>
                      <button onClick={() => remove(r)}
                        className="text-xs text-red-600 hover:underline">Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      {creating && (
        <Modal open onClose={() => setCreating(false)}
          title={editing ? "Edit event" : "New event"} size="lg">
          <div className="space-y-4">
            <Input label="Title" value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="Inter-House Sports" />
            <JsonField label="Description" value={form.description} textarea
              onChange={v => setForm(f => ({ ...f, description: v }))} />
            <Input label="Location" value={form.location}
              onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
              placeholder="School sports field" />
            <div className="grid grid-cols-2 gap-3">
              <JsonField label="Starts" type="datetime-local" value={form.starts_at}
                onChange={v => setForm(f => ({ ...f, starts_at: v }))} />
              <JsonField label="Ends (optional)" type="datetime-local" value={form.ends_at}
                onChange={v => setForm(f => ({ ...f, ends_at: v }))} />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" checked={form.all_day}
                onChange={e => setForm(f => ({ ...f, all_day: e.target.checked }))}
                className="w-4 h-4 rounded border-gray-300 text-[#C9A227] focus:ring-[#C9A227]" />
              All-day event
            </label>
            <div>
              <label htmlFor="ev-status" className="block text-sm font-medium text-gray-700 mb-1">
                Status
              </label>
              <select id="ev-status" value={form.status}
                onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white">
                <option value="draft">Draft</option>
                <option value="published">Published</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setCreating(false)}>Cancel</Button>
              <Button variant="gold" loading={busy} disabled={!form.title.trim()} onClick={save}>
                {editing ? "Save changes" : "Create event"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Media                                                               */
/* ------------------------------------------------------------------ */

function MediaTab({
  supabase, orgId, rows, reload, flash, setError,
}: {
  supabase: Sb;
  orgId: string;
  rows: MediaRow[];
  reload: () => Promise<void>;
  flash: (m: string) => void;
  setError: (m: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [folder, setFolder] = useState("general");

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;

    // Defensive guard: if this ever runs before the active org has
    // resolved (e.g. a stale render during an org switch), every upload
    // below would write to a path/row that the RLS policies reject --
    // and silently, unless we catch it here first.
    if (!orgId) {
      setError("No active school selected -- reload the page and try again.");
      return;
    }

    setUploading(true);
    let succeeded = 0;
    let failed = 0;

    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/") && file.type !== "application/pdf") {
        setError(`${file.name} was skipped: only images and PDFs are accepted.`);
        failed++;
        continue;
      }
      if (file.size > 10 * 1024 * 1024) {
        setError(`${file.name} was skipped: files must be under 10 MB.`);
        failed++;
        continue;
      }

      // Path is prefixed with the org id, which the storage policy checks.
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
      const path = `${orgId}/${Date.now()}-${safeName}`;

      const { error: upErr } = await supabase.storage
        .from("website-media")
        .upload(path, file, { cacheControl: "31536000", upsert: false });

      if (upErr) {
        setError(
          upErr.message.includes("Bucket not found")
            ? "The website-media storage bucket is missing. Run supabase/website_module.sql."
            : `${file.name}: ${upErr.message}`
        );
        failed++;
        continue;
      }

      const { data: pub } = supabase.storage.from("website-media").getPublicUrl(path);

      // This insert failing used to be invisible: the file would sit
      // in storage with no library row, and the UI still said "Upload
      // complete." Check and surface it, and clean up the orphaned
      // storage object so a retry doesn't collide with it.
      const { error: insErr } = await supabase.from("website_media").insert({
        organization_id: orgId,
        folder,
        file_name: file.name,
        url: pub.publicUrl,
        storage_path: path,
        mime_type: file.type,
        size_bytes: file.size,
      });

      if (insErr) {
        await supabase.storage.from("website-media").remove([path]);
        setError(`${file.name} uploaded but could not be saved to the media library: ${insErr.message}`);
        failed++;
        continue;
      }

      succeeded++;
    }

    setUploading(false);
    // Every failure path above already called setError with the specific
    // reason, so success only gets a flash when at least one file made it
    // all the way into the library -- no more blanket "Upload complete."
    if (succeeded > 0) {
      flash(`Uploaded ${succeeded} file${succeeded === 1 ? "" : "s"}.` + (failed > 0 ? ` ${failed} failed -- see above.` : ""));
    }
    await reload();
  }

  async function updateAlt(row: MediaRow, alt: string) {
    await supabase.from("website_media").update({ alt_text: alt }).eq("id", row.id);
  }

  async function remove(row: MediaRow) {
    if (!confirm(`Delete ${row.file_name}? Pages using it will show a blank space.`)) return;
    const { data: full } = await supabase
      .from("website_media").select("storage_path").eq("id", row.id).single();
    const path = (full as { storage_path?: string } | null)?.storage_path;
    if (path) await supabase.storage.from("website-media").remove([path]);
    await supabase.from("website_media").delete().eq("id", row.id);
    flash("File deleted.");
    await reload();
  }

  const folders = Array.from(new Set(["general", ...rows.map(r => r.folder)]));

  return (
    <Card>
      <CardHeader><CardTitle>Media library ({rows.length})</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="media-folder" className="block text-sm font-medium text-gray-700 mb-1">
              Folder
            </label>
            <input
              id="media-folder"
              value={folder}
              onChange={e => setFolder(e.target.value)}
              list="folder-list"
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
            <datalist id="folder-list">
              {folders.map(f => <option key={f} value={f} />)}
            </datalist>
          </div>
          <div>
            <label htmlFor="media-upload" className="block text-sm font-medium text-gray-700 mb-1">
              Upload images or PDFs
            </label>
            <input
              id="media-upload"
              type="file"
              multiple
              accept="image/*,application/pdf"
              disabled={uploading}
              onChange={e => upload(e.target.files)}
              className="text-sm"
            />
          </div>
          {uploading && <span className="text-xs text-gray-500">Uploading…</span>}
        </div>

        <p className="text-xs text-gray-500">
          Files are stored under a folder named after your school, so one school&apos;s
          uploads are never writable by another. Maximum 10 MB per file.
        </p>

        {rows.filter(m => !m.alt_text).length > 0 && (
          <div className="flex items-start gap-2 p-3 rounded-lg border border-amber-200 bg-amber-50 text-sm text-amber-800">
            <AlertTriangle size={15} className="mt-px shrink-0" />
            <span>
              <strong>{rows.filter(m => !m.alt_text).length} image{rows.filter(m => !m.alt_text).length === 1 ? "" : "s"}</strong>{" "}
              missing alt text. Screen readers and search engines need descriptions for every image.
              Fill in the &ldquo;Describe this image&rdquo; field below each one.
            </span>
          </div>
        )}

        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-500">Nothing uploaded yet.</p>
        ) : (
          <ul className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 list-none p-0">
            {rows.map(m => (
              <li key={m.id} className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="aspect-square bg-gray-50 grid place-items-center overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={m.url} alt={m.alt_text ?? ""} className="w-full h-full object-cover" />
                </div>
                <div className="p-2 space-y-1.5">
                  <p className="text-xs font-medium truncate" title={m.file_name}>{m.file_name}</p>
                  <input
                    defaultValue={m.alt_text ?? ""}
                    onBlur={e => updateAlt(m, e.target.value)}
                    placeholder="Describe this image"
                    aria-label={`Description for ${m.file_name}`}
                    className="w-full px-1.5 py-1 border border-gray-200 rounded text-[11px]"
                  />
                  <div className="flex items-center justify-between">
                    <button
                      onClick={() => navigator.clipboard?.writeText(m.url)}
                      className="text-[10px] text-gray-500 hover:underline inline-flex items-center gap-1"
                    >
                      <Copy size={9} /> Copy URL
                    </button>
                    <button onClick={() => remove(m)} aria-label={`Delete ${m.file_name}`}
                      className="text-red-500 hover:text-red-700">
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* SEO                                                                 */
/* ------------------------------------------------------------------ */

function SeoTab({
  site, onPatch, saving, media,
}: {
  site: SiteRow;
  onPatch: (p: Partial<SiteRow>) => Promise<void>;
  saving: boolean;
  media: MediaRow[];
}) {
  const [seo, setSeo] = useState<Record<string, string>>(site.seo ?? {});
  const descLen = (seo.description ?? "").length;

  return (
    <Card>
      <CardHeader><CardTitle>Search engine settings</CardTitle></CardHeader>
      <CardContent className="space-y-4 max-w-2xl">
        <JsonField
          label="Default page title"
          value={seo.title ?? ""}
          onChange={v => setSeo(s => ({ ...s, title: v }))}
          placeholder={site.site_name}
          help="Used when a page has no title of its own."
        />
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm font-medium text-gray-700">Meta description</label>
            <AiAssistButton
              compact
              kinds={["seo_description", "polish", "shorten"]}
              currentValue={seo.description ?? ""}
              extra={{ school_name: site.site_name || "The school" }}
              onApply={(text) => setSeo(s => ({ ...s, description: text }))}
              source="website_seo_description"
              label="AI"
            />
          </div>
          <JsonField
            label=""
            value={seo.description ?? ""}
            onChange={v => setSeo(s => ({ ...s, description: v }))}
            textarea
            placeholder="A brief, welcoming summary of the school in one or two sentences."
          />
          <p className={cn(
            "text-xs mt-1",
            descLen > 160 ? "text-amber-600" : "text-gray-500"
          )}>
            {descLen} characters. Search engines usually show about 155–160.
          </p>
        </div>
        <JsonField
          label="Keywords"
          value={seo.keywords ?? ""}
          onChange={v => setSeo(s => ({ ...s, keywords: v }))}
          placeholder="school, admissions, education"
        />
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Social sharing image
          </label>
          <ImagePicker
            id="og-image"
            value={seo.og_image_url ?? ""}
            media={media}
            onChange={v => setSeo(s => ({ ...s, og_image_url: v }))}
          />
          <p className="text-xs text-gray-500 mt-1">
            Shown when someone shares a link. 1200 × 630 pixels works best.
          </p>
        </div>
        <div>
          <label htmlFor="robots" className="block text-sm font-medium text-gray-700 mb-1">
            Search engine visibility
          </label>
          <select
            id="robots"
            value={seo.robots ?? "index"}
            onChange={e => setSeo(s => ({ ...s, robots: e.target.value }))}
            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white"
          >
            <option value="index">Allow search engines to index this site</option>
            <option value="noindex">Hide from search engines</option>
          </select>
        </div>

        <Banner tone="info">
          Your school&apos;s name, address, phone and email are published as structured data
          automatically, so search engines can show them correctly. Fill those in under
          Theme &amp; Brand.
        </Banner>

        <Button size="sm" variant="gold" loading={saving} onClick={() => onPatch({ seo })}>
          <Save size={14} /> Save SEO settings
        </Button>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Domains                                                             */
/* ------------------------------------------------------------------ */

function DomainsTab({
  supabase, site, rows, reload, flash, setError, onPatch,
}: {
  supabase: Sb;
  site: SiteRow;
  rows: DomainRow[];
  reload: () => Promise<void>;
  flash: (m: string) => void;
  setError: (m: string) => void;
  onPatch: (p: Partial<SiteRow>) => Promise<void>;
}) {
  const [host, setHost] = useState("");
  const [busy, setBusy] = useState(false);
  const [subdomain, setSubdomain] = useState(site.subdomain ?? "");

  async function addDomain() {
    const clean = host.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!clean.includes(".")) { setError("Enter a full hostname, for example www.yourschool.com"); return; }

    setBusy(true);
    const { error } = await supabase.from("website_domains").insert({
      organization_id: site.organization_id,
      website_id: site.id,
      hostname: clean,
      is_primary: rows.length === 0,
    });
    setBusy(false);

    if (error) {
      setError(
        error.message.includes("duplicate") || error.code === "23505"
          ? `${clean} is already registered. A hostname can only point at one school.`
          : error.message
      );
      return;
    }
    setHost("");
    flash(`${clean} added. Create the DNS records below, then verify.`);
    await reload();
  }

  async function remove(d: DomainRow) {
    if (!confirm(`Remove ${d.hostname}?`)) return;
    const { error } = await supabase.from("website_domains").delete().eq("id", d.id);
    if (error) { setError(`Could not remove domain: ${error.message}`); return; }
    flash("Domain removed.");
    await reload();
  }

  async function makePrimary(d: DomainRow) {
    // Clear the primary flag on every other row for this website
    // first, then set it on the target row. If the clear fails we
    // don't want to leave two rows flagged primary, so bail early.
    const { error: clearErr } = await supabase.from("website_domains").update({ is_primary: false }).eq("website_id", site.id);
    if (clearErr) { setError(`Could not switch primary domain: ${clearErr.message}`); return; }
    const { error: setErr } = await supabase.from("website_domains").update({ is_primary: true }).eq("id", d.id);
    if (setErr) { setError(`Could not switch primary domain: ${setErr.message}`); return; }
    flash(`${d.hostname} is now the primary address.`);
    await reload();
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader><CardTitle>Platform subdomain</CardTitle></CardHeader>
        <CardContent className="space-y-3 max-w-xl">
          <p className="text-sm text-gray-600">
            Every school gets a free address on the platform domain. This works immediately,
            with no DNS setup.
          </p>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <JsonField
                label="Subdomain"
                value={subdomain}
                onChange={setSubdomain}
                placeholder="greenfield"
              />
            </div>
            <Button size="sm" variant="gold"
              onClick={() => onPatch({ subdomain: subdomain.trim().toLowerCase() || null })}>
              <Save size={14} /> Save
            </Button>
          </div>
          <p className="text-xs text-gray-500">
            Resulting address: <code>{subdomain || "your-school"}.&lt;platform domain&gt;</code>.
            Set <code>NEXT_PUBLIC_PLATFORM_HOST</code> in your hosting environment for this to
            resolve.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Custom domains ({rows.length})</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-end gap-2 max-w-xl">
            <div className="flex-1">
              <JsonField
                label="Add a domain you own"
                value={host}
                onChange={setHost}
                placeholder="www.greenfieldacademy.com"
              />
            </div>
            <Button size="sm" variant="gold" loading={busy} onClick={addDomain}>
              <Plus size={14} /> Add
            </Button>
          </div>

          {rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-500">
              No custom domain yet. Your site is reachable at its preview address.
            </p>
          ) : (
            <ul className="space-y-3 list-none p-0">
              {rows.map(d => (
                <li key={d.id} className="border border-gray-200 rounded-lg p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-sm flex items-center gap-2">
                        {d.hostname}
                        {d.is_primary && <Badge variant="navy">primary</Badge>}
                        {d.verified
                          ? <Badge variant="green">verified</Badge>
                          : <Badge variant="amber">pending</Badge>}
                      </p>
                      <p className="text-xs text-gray-500">SSL: {d.ssl_status}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {!d.is_primary && d.verified && (
                        <Button size="sm" variant="secondary" onClick={() => makePrimary(d)}>
                          Make primary
                        </Button>
                      )}
                      <Button size="sm" variant="danger" onClick={() => remove(d)}>
                        <Trash2 size={13} />
                      </Button>
                    </div>
                  </div>

                  {!d.verified && (
                    <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                      <p className="text-xs font-semibold text-gray-700">
                        Create these DNS records at your domain registrar
                      </p>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-gray-500">
                            <th className="text-left py-1">Type</th>
                            <th className="text-left py-1">Name</th>
                            <th className="text-left py-1">Value</th>
                          </tr>
                        </thead>
                        <tbody className="font-mono">
                          <tr>
                            <td className="py-1">TXT</td>
                            <td className="py-1">_schoolsuite</td>
                            <td className="py-1 break-all">{d.verification_token}</td>
                          </tr>
                          <tr>
                            <td className="py-1">CNAME</td>
                            <td className="py-1">{d.hostname.split(".")[0]}</td>
                            <td className="py-1">&lt;your hosting CNAME target&gt;</td>
                          </tr>
                        </tbody>
                      </table>
                      <p className="text-xs text-gray-500">
                        DNS changes can take up to 24 hours. Once the records are live, add the
                        domain in your hosting provider so a certificate is issued, then mark it
                        verified below.
                      </p>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={async () => {
                          const { error } = await supabase.from("website_domains").update({
                            verified: true,
                            verified_at: new Date().toISOString(),
                            ssl_status: "active",
                          }).eq("id", d.id);
                          if (error) { setError(`Could not mark verified: ${error.message}`); return; }
                          flash(`${d.hostname} marked as verified.`);
                          await reload();
                        }}
                      >
                        <CheckCircle2 size={13} /> Mark as verified
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          <Banner tone="info">
            A hostname is unique across the whole platform, so one domain can never resolve to
            two schools. Requests arriving on a verified domain are matched to its school before
            any content is read.
          </Banner>
        </CardContent>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Versions                                                            */
/* ------------------------------------------------------------------ */

function VersionsTab({
  supabase, rows, reload, flash, setError,
}: {
  supabase: Sb;
  rows: VersionRow[];
  reload: () => Promise<void>;
  flash: (m: string) => void;
  setError: (m: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState("");

  async function snapshot() {
    setBusy(true);
    const { error } = await supabase.rpc("snapshot_website", { p_label: label || null });
    setBusy(false);
    if (error) { setError(error.message); return; }
    setLabel("");
    flash("Snapshot saved.");
    await reload();
  }

  async function restore(v: VersionRow) {
    if (!confirm(
      `Restore the site to the version from ${new Date(v.created_at).toLocaleString()}? ` +
      "Your current pages and sections are snapshotted first, so this can be undone."
    )) return;

    setBusy(true);
    const { error } = await supabase.rpc("restore_website_version", { p_version: v.id });
    setBusy(false);
    if (error) { setError(error.message); return; }
    flash("Site restored.");
    await reload();
  }

  return (
    <Card>
      <CardHeader><CardTitle>Version history</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-gray-600">
          A snapshot records your settings, pages, sections and navigation. One is taken
          automatically before each publish and before each restore, so a bad editing session
          is always recoverable.
        </p>

        <div className="flex items-end gap-2 max-w-xl">
          <div className="flex-1">
            <JsonField label="Snapshot label (optional)" value={label} onChange={setLabel}
              placeholder="Before the admissions rewrite" />
          </div>
          <Button size="sm" variant="gold" loading={busy} onClick={snapshot}>
            <History size={14} /> Take snapshot
          </Button>
        </div>

        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-500">No snapshots yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100 border border-gray-200 rounded-lg list-none p-0">
            {rows.map(v => (
              <li key={v.id} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {v.label || "Snapshot"}
                  </p>
                  <p className="text-xs text-gray-500">
                    {new Date(v.created_at).toLocaleString()}
                    {v.created_by_email ? ` · ${v.created_by_email}` : ""}
                  </p>
                </div>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => restore(v)}>
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-gray-500">The 30 most recent snapshots are kept.</p>
      </CardContent>
    </Card>
  );
}
