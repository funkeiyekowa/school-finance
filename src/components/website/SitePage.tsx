/**
 * Public site renderer.
 *
 * Server component. Fetches the whole page in one RPC call
 * (get_public_page), resolves the theme, injects it as CSS custom
 * properties, then renders the section list.
 *
 * Tenant safety: the payload is fetched by website_id, which the caller
 * obtained from resolve_site_by_host / resolve_site_by_slug. Those functions
 * return only PUBLISHED sites belonging to ACTIVE organizations, so an
 * unpublished or suspended school cannot be reached from the public internet
 * even if someone guesses the id.
 */

import { createClient } from "@supabase/supabase-js";
import Link from "next/link";
import { resolveTheme, themeToCss, googleFontsHref } from "@/lib/website/theme";
import { RenderSection, type SectionContext } from "@/components/website/sections";
import { SiteForm } from "@/components/website/SiteForm";
import { SiteInteractive } from "@/components/website/SiteInteractive";
import type { PagePayload, NewsItem, EventItem } from "@/lib/website/types";

/** Anon client: the public site is read with the same privileges a visitor has. */
function publicClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

export async function fetchPage(websiteId: string, slug: string): Promise<PagePayload | null> {
  const supabase = publicClient();
  const { data, error } = await supabase.rpc("get_public_page", {
    p_website_id: websiteId,
    p_slug: slug,
  });
  if (error || !data) return null;
  return data as PagePayload;
}

export async function fetchArticle(orgId: string, slug: string): Promise<NewsItem | null> {
  const supabase = publicClient();
  const { data } = await supabase
    .from("website_news")
    .select("slug, title, excerpt, body, cover_image_url, category, author_name, published_at")
    .eq("organization_id", orgId)
    .eq("slug", slug)
    .eq("status", "published")
    .maybeSingle();
  return (data as NewsItem) ?? null;
}

export async function fetchAllNews(orgId: string): Promise<NewsItem[]> {
  const supabase = publicClient();
  const { data } = await supabase
    .from("website_news")
    .select("slug, title, excerpt, cover_image_url, category, published_at")
    .eq("organization_id", orgId)
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(60);
  return (data ?? []) as NewsItem[];
}

export async function fetchAllEvents(orgId: string): Promise<EventItem[]> {
  const supabase = publicClient();
  const { data } = await supabase
    .from("website_events")
    .select("slug, title, description, location, starts_at, ends_at, all_day, cover_image_url")
    .eq("organization_id", orgId)
    .eq("status", "published")
    .order("starts_at", { ascending: true })
    .limit(120);
  return (data ?? []) as EventItem[];
}

/* ------------------------------------------------------------------ */
/* Structured Data                                                     */
/* ------------------------------------------------------------------ */

function schemaOrg(payload: PagePayload, origin: string) {
  const contact = payload.site.contact ?? {};
  const json = {
    "@context": "https://schema.org",
    "@type": "School",
    name: payload.site.site_name,
    description: payload.site.tagline ?? undefined,
    url: origin || undefined,
    logo: payload.site.logo_url ?? undefined,
    telephone: contact.phone ?? undefined,
    email: contact.email ?? undefined,
    address: contact.address
      ? { "@type": "PostalAddress", streetAddress: contact.address }
      : undefined,
  };
  return JSON.stringify(json, (_k, v) => (v === undefined ? undefined : v));
}

/* ------------------------------------------------------------------ */
/* Social link SVG icons                                               */
/* ------------------------------------------------------------------ */

function SocialIcon({ network }: { network: string }) {
  const paths: Record<string, string> = {
    facebook: "M18 2h-3a5 5 0 00-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 011-1h3z",
    instagram: "M7.8 2h8.4C19.4 2 22 4.6 22 7.8v8.4a5.8 5.8 0 01-5.8 5.8H7.8C4.6 22 2 19.4 2 16.2V7.8A5.8 5.8 0 017.8 2m-.2 2A3.6 3.6 0 004 7.6v8.8C4 18.39 5.61 20 7.6 20h8.8a3.6 3.6 0 003.6-3.6V7.6C20 5.61 18.39 4 16.4 4H7.6m9.65 1.5a1.25 1.25 0 110 2.5 1.25 1.25 0 010-2.5M12 7a5 5 0 110 10 5 5 0 010-10m0 2a3 3 0 100 6 3 3 0 000-6",
    x: "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z",
    youtube: "M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z",
    linkedin: "M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z",
    tiktok: "M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z",
  };
  const d = paths[network];
  if (!d) return null;
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Helper: format dates nicely                                        */
/* ------------------------------------------------------------------ */

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}

/* ------------------------------------------------------------------ */
/* SiteShell — main page wrapper                                      */
/* ------------------------------------------------------------------ */

export function SiteShell({
  payload, basePath, currentPath, children,
}: {
  payload: PagePayload;
  basePath: string;
  currentPath: string;
  children?: React.ReactNode;
}) {
  const theme = resolveTheme(payload.theme, payload.site);
  const css = themeToCss(theme, ".site-root");
  const fontsHref = googleFontsHref(theme);

  const ctx: SectionContext = {
    site: payload.site,
    news: payload.news ?? [],
    events: payload.events ?? [],
    forms: payload.forms ?? [],
    basePath,
    currentPath,
    heroStyle: theme.heroStyle,
    headerStyle: theme.headerStyle,
    divider: theme.divider,
  };

  const navPages = (payload.pages ?? []).filter(p => p.slug !== "");
  const customNav = (payload.nav ?? []).filter(n => n.menu === "primary");
  const footerNav = (payload.nav ?? []).filter(n => n.menu === "footer");
  const contact = payload.site.contact ?? {};
  const social = payload.site.social ?? {};

  const navItems = customNav.length > 0
    ? customNav.map(n => ({ href: n.href, label: n.label, external: n.new_tab }))
    : navPages.map(p => ({ href: `/${p.slug}`, label: p.label, external: false }));

  const footerItems = footerNav.length > 0
    ? footerNav.map(n => ({ href: n.href, label: n.label }))
    : navPages.map(p => ({ href: `/${p.slug}`, label: p.label }));

  const resolveHref = (href: string) =>
    href.startsWith("http") || href.startsWith("mailto:") || href.startsWith("tel:")
      ? href
      : `${basePath}${href.startsWith("/") ? href : `/${href}`}`;

  const socialEntries = Object.entries(social).filter(
    ([, url]) => typeof url === "string" && url.trim() !== ""
  ) as [string, string][];

  return (
    <>
      {fontsHref && <link rel="stylesheet" href={fontsHref} />}
      <style dangerouslySetInnerHTML={{ __html: css }} />

      <div className="site-root" data-header-style={theme.headerStyle} data-hero-style={theme.heroStyle}>
        {/* Preloader */}
        {theme.animations && (
          <div className="site-preloader" data-site-preloader aria-hidden="true">
            <div className="preloader-mark">
              <strong>{(payload.site.site_name || "S").split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase()}</strong>
            </div>
            <span className="preloader-word">{payload.site.site_name}</span>
            <span className="preloader-bar" />
          </div>
        )}

        {/* Scroll progress bar */}
        <div className="scroll-progress" aria-hidden="true" />

        {/* Cursor glow (desktop only, added via JS to avoid SSR/CSR mismatch on touch devices) */}
        {theme.animations && <div className="cursor-glow" data-cursor-glow aria-hidden="true" />}

        {/* Grain overlay for textured themes */}
        {theme.grain && <div className="grain-overlay" aria-hidden="true" />}

        {/* Skip link */}
        <a className="skip-link" href="#site-main">
          Skip to main content
        </a>

        {/* ============ HEADER ============ */}
        <header className="site-header">
          <div className="header-inner">
            {/* Brand */}
            <a href={basePath || "/"} className="brand">
              {payload.site.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={payload.site.logo_url}
                  alt={`${payload.site.site_name} logo`}
                  className="brand-mark"
                />
              ) : (
                <span className="brand-mark" aria-hidden="true"
                  style={{
                    width: 42, height: 42, borderRadius: "var(--r-sm)",
                    background: "var(--c-accent)", color: "#111827",
                    display: "grid", placeItems: "center",
                    fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: "1.2rem",
                  }}
                >
                  {payload.site.site_name.charAt(0)}
                </span>
              )}
              <span className="brand-text">
                <span className="brand-name">{payload.site.site_name}</span>
                {payload.site.tagline && <span className="brand-tag">{payload.site.tagline}</span>}
              </span>
            </a>

            {/* Desktop nav */}
            <nav className="main-nav" aria-label="Main navigation">
              <ul>
                {navItems.map((item, i) => (
                  <li key={i}>
                    <a
                      href={resolveHref(item.href)}
                      {...(item.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                    >
                      {item.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>

            {/* Header actions */}
            <div className="header-actions">
              <a href="/login" className="btn btn-gold btn-sm" aria-label="Sign in to portal">
                Sign In
              </a>
              <button
                className="nav-toggle"
                aria-label="Open menu"
                aria-expanded="false"
                aria-controls="mobile-nav"
              >
                <svg className="icon-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 12h18M3 6h18M3 18h18" />
                </svg>
                <svg className="icon-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Mobile nav */}
          <nav id="mobile-nav" className="mobile-nav" aria-label="Mobile navigation">
            <ul>
              {navItems.map((item, i) => (
                <li key={i}>
                  <a href={resolveHref(item.href)}>{item.label}</a>
                </li>
              ))}
              <li>
                <a href="/login" className="btn btn-gold">
                  Sign In
                </a>
              </li>
            </ul>
          </nav>
        </header>

        {/* ============ MAIN ============ */}
        <main id="site-main" style={{ flex: 1 }}>
          {children ?? (
            <>
              {(payload.sections ?? []).map((section, i) => (
                <RenderSection key={section.id} section={section} ctx={ctx} index={i} />
              ))}

              {payload.page.page_type === "news_index" && (
                <NewsIndex items={payload.news ?? []} basePath={basePath} />
              )}
              {payload.page.page_type === "event_index" && (
                <EventIndex items={payload.events ?? []} />
              )}
              {payload.page.page_type === "contact" &&
                !(payload.sections ?? []).some(s => s.section_type === "contact") && (
                <ContactBlock payload={payload} currentPath={currentPath} />
              )}
            </>
          )}
        </main>

        {/* ============ FOOTER ============ */}
        <footer className="site-footer">
          <div className="footer-inner">
            {/* Column 1: Brand */}
            <div className="footer-brand">
              {payload.site.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={payload.site.logo_url}
                  alt=""
                  style={{ width: 40, height: 40, objectFit: "contain" }}
                />
              ) : (
                <span
                  aria-hidden="true"
                  style={{
                    width: 40, height: 40, borderRadius: "var(--r-sm)", flexShrink: 0,
                    background: "var(--c-accent)", color: "#111827",
                    display: "grid", placeItems: "center",
                    fontFamily: "var(--font-heading)", fontWeight: 700,
                  }}
                >
                  {payload.site.site_name.charAt(0)}
                </span>
              )}
              <div>
                <span className="brand-name">{payload.site.site_name}</span>
                {payload.site.tagline && <p>{payload.site.tagline}</p>}
                {socialEntries.length > 0 && (
                  <div className="social-links" style={{ marginTop: 16 }}>
                    {socialEntries.map(([network, url]) => (
                      <a
                        key={network}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={network}
                      >
                        <SocialIcon network={network} />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Column 2: Contact */}
            <div className="footer-col">
              <h3>Contact</h3>
              <address style={{ fontStyle: "normal", fontSize: ".9rem", opacity: 0.82 }}>
                {contact.address && <p style={{ margin: "0 0 6px" }}>{contact.address}</p>}
                {contact.phone && (
                  <p style={{ margin: "0 0 6px" }}>
                    <a href={`tel:${contact.phone}`}>{contact.phone}</a>
                  </p>
                )}
                {contact.email && (
                  <p style={{ margin: "0 0 6px" }}>
                    <a href={`mailto:${contact.email}`}>{contact.email}</a>
                  </p>
                )}
                {contact.hours && <p style={{ margin: 0 }}>{contact.hours}</p>}
              </address>
            </div>

            {/* Column 3: Quick Links */}
            <div className="footer-col">
              <h3>Quick links</h3>
              {footerItems.map((item, i) => (
                <a key={i} href={resolveHref(item.href)}>{item.label}</a>
              ))}
            </div>
          </div>

          {/* Copyright bar */}
          <div className="footer-bottom">
            <p style={{ margin: 0 }}>
              © {new Date().getFullYear()} {payload.site.site_name}. All rights reserved.
            </p>
            {socialEntries.length > 0 && (
              <div className="social-links">
                {socialEntries.map(([network, url]) => (
                  <a key={network} href={url} target="_blank" rel="noopener noreferrer" aria-label={network}>
                    <SocialIcon network={network} />
                  </a>
                ))}
              </div>
            )}
          </div>
        </footer>

        {/* Client-side interactivity */}
        <SiteInteractive />
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Built-in dynamic page bodies                                       */
/* ------------------------------------------------------------------ */

function NewsIndex({ items, basePath }: { items: NewsItem[]; basePath: string }) {
  return (
    <section className="section">
      <div className="wrap">
        <div className="section-head">
          <h2>Latest News</h2>
          <p>Stay up to date with what&apos;s happening at our school.</p>
        </div>
        {items.length === 0 ? (
          <p style={{ color: "var(--c-text-muted)" }}>There is no news to show yet.</p>
        ) : (
          <div className="grid-3">
            {items.map(n => (
              <article key={n.slug} className="news-card reveal">
                {n.cover_image_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={n.cover_image_url} alt="" loading="lazy" />
                )}
                <div className="news-card-body">
                  <p className="meta">
                    {n.published_at ? fmtDate(n.published_at) : ""}
                    {n.category ? ` · ${n.category}` : ""}
                  </p>
                  <h3><a href={`${basePath}/news/${n.slug}`}>{n.title}</a></h3>
                  {n.excerpt && <p>{n.excerpt}</p>}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function EventIndex({ items }: { items: EventItem[] }) {
  return (
    <section className="section">
      <div className="wrap">
        <div className="section-head">
          <h2>Upcoming Events</h2>
          <p>Mark your calendar for these important dates.</p>
        </div>
        {items.length === 0 ? (
          <p style={{ color: "var(--c-text-muted)" }}>There are no upcoming events.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {items.map(ev => (
              <div key={ev.slug} className="event-item reveal">
                <time dateTime={ev.starts_at} className="event-date">
                  <span className="day">{new Date(ev.starts_at).getDate()}</span>
                  <span className="month">
                    {new Date(ev.starts_at).toLocaleDateString(undefined, { month: "short" })}
                  </span>
                </time>
                <div className="event-info">
                  <h3>{ev.title}</h3>
                  {ev.location && <p>{ev.location}</p>}
                  {ev.description && <p>{ev.description}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function ContactBlock({ payload, currentPath }: { payload: PagePayload; currentPath: string }) {
  const form = payload.forms?.find(f => f.key === "contact") ?? payload.forms?.[0];
  const contact = payload.site.contact ?? {};
  return (
    <section className="section">
      <div className="wrap">
        <div className="contact-grid">
          <div className="contact-info reveal">
            <h2>Get in touch</h2>
            <p>
              We&apos;d love to hear from you. Whether it&apos;s about admissions, a visit,
              or a general question — reach out and we&apos;ll respond promptly.
            </p>
            {contact.address && (
              <div className="info-row">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
                <div>
                  <b>Address</b>
                  <address>{contact.address}</address>
                </div>
              </div>
            )}
            {contact.phone && (
              <div className="info-row">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z"/></svg>
                <div>
                  <b>Telephone</b>
                  <a href={`tel:${contact.phone}`}>{contact.phone}</a>
                </div>
              </div>
            )}
            {contact.email && (
              <div className="info-row">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                <div>
                  <b>Email</b>
                  <a href={`mailto:${contact.email}`}>{contact.email}</a>
                </div>
              </div>
            )}
            {contact.hours && (
              <div className="info-row">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                <div>
                  <b>Office hours</b>
                  <span>{contact.hours}</span>
                </div>
              </div>
            )}
          </div>
          <div className="contact-form-box reveal">
            {form ? (
              <SiteForm form={form} websiteId={payload.site.id} sourcePage={currentPath} />
            ) : (
              <p style={{ color: "var(--c-text-muted)" }}>
                No enquiry form has been configured yet.
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/** Shown when a host resolves but the site is not live. */
export function SiteUnavailable({ reason }: { reason?: string }) {
  const message =
    reason === "unpublished"
      ? "This website has not been published yet."
      : reason?.startsWith("org_")
      ? "This school's account is not currently active."
      : "This website is not available.";

  return (
    <main style={{
      minHeight: "100vh", display: "grid", placeItems: "center",
      background: "#f8fafc", padding: "24px",
    }}>
      <div style={{ textAlign: "center", maxWidth: 360 }}>
        <h1 style={{ fontSize: "1.125rem", fontWeight: 700, color: "#111827", marginBottom: 8 }}>
          Not available
        </h1>
        <p style={{ fontSize: ".9rem", color: "#4b5563" }}>{message}</p>
        <Link
          href="/"
          style={{ display: "inline-block", marginTop: 24, fontSize: ".9rem", color: "#1d4ed8", textDecoration: "underline" }}
        >
          Go to the platform
        </Link>
      </div>
    </main>
  );
}
