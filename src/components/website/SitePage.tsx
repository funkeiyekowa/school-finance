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
  };

  const navPages = (payload.pages ?? []).filter(p => p.slug !== "");
  const customNav = (payload.nav ?? []).filter(n => n.menu === "primary");
  const footerNav = (payload.nav ?? []).filter(n => n.menu === "footer");

  return (
    <>
      {fontsHref && <link rel="stylesheet" href={fontsHref} />}
      {/* Theme tokens. Scoped to .site-root so nothing leaks. */}
      <style dangerouslySetInnerHTML={{ __html: css }} />

      <div
        className="site-root min-h-screen flex flex-col"
        style={{
          background: "var(--c-background)",
          color: "var(--c-text)",
          fontFamily: "var(--font-body)",
          fontSize: "var(--fs-body)",
        }}
      >
        <a
          href="#site-main"
          className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 focus:px-4 focus:py-2 focus:bg-white focus:text-black focus:rounded"
        >
          Skip to main content
        </a>

        {/* ---------- Header ---------- */}
        <header
          style={{
            background: "var(--c-header-bg)",
            color: "var(--c-header-text)",
            borderBottom: "1px solid var(--c-border)",
          }}
        >
          <div className="mx-auto w-full max-w-6xl px-5 py-4 flex items-center justify-between gap-6">
            <a href={basePath || "/"} className="flex items-center gap-3 min-w-0">
              {payload.site.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={payload.site.logo_url}
                  alt={`${payload.site.site_name} logo`}
                  className="h-10 w-auto object-contain shrink-0"
                />
              ) : (
                <span
                  className="h-10 w-10 shrink-0 grid place-items-center font-bold"
                  style={{
                    background: "var(--c-accent)",
                    color: "#111827",
                    borderRadius: "var(--r-sm)",
                  }}
                  aria-hidden="true"
                >
                  {payload.site.site_name.charAt(0)}
                </span>
              )}
              <span className="min-w-0">
                <span
                  className="block font-bold truncate"
                  style={{ fontFamily: "var(--font-heading)", fontSize: "1.05rem" }}
                >
                  {payload.site.site_name}
                </span>
                {payload.site.tagline && (
                  <span className="block text-xs truncate" style={{ opacity: 0.7 }}>
                    {payload.site.tagline}
                  </span>
                )}
              </span>
            </a>

            <nav aria-label="Main" className="hidden md:block">
              <ul className="flex items-center gap-6 list-none p-0 m-0">
                {(customNav.length > 0
                  ? customNav.map(n => ({ slug: n.href, label: n.label }))
                  : navPages.map(p => ({ slug: `/${p.slug}`, label: p.label }))
                ).map((item, i) => (
                  <li key={i}>
                    <a
                      href={item.slug.startsWith("http") ? item.slug : `${basePath}${item.slug}`}
                      className="text-sm font-medium hover:underline"
                    >
                      {item.label}
                    </a>
                  </li>
                ))}
                <li>
                  <a
                    href={`${basePath}/admissions`}
                    className="inline-flex items-center px-4 py-2 text-sm"
                    style={{
                      background: "var(--c-accent)",
                      color: "#111827",
                      borderRadius: "var(--btn-radius)",
                      fontWeight: "var(--btn-weight)" as unknown as number,
                    }}
                  >
                    Apply
                  </a>
                </li>
              </ul>
            </nav>
          </div>

          {/* Mobile nav: a plain scrollable row keeps it usable without JS. */}
          <nav aria-label="Main" className="md:hidden border-t" style={{ borderColor: "var(--c-border)" }}>
            <ul className="flex gap-4 overflow-x-auto px-5 py-2.5 list-none m-0">
              {navPages.map(p => (
                <li key={p.slug} className="shrink-0">
                  <a href={`${basePath}/${p.slug}`} className="text-sm font-medium">{p.label}</a>
                </li>
              ))}
            </ul>
          </nav>
        </header>

        {/* ---------- Main ---------- */}
        <main id="site-main" className="flex-1">
          {children ?? (
            <>
              {(payload.sections ?? []).map((section, i) => (
                <RenderSection key={section.id} section={section} ctx={ctx} index={i} />
              ))}

              {/* Built-in page bodies for the dynamic page types. */}
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

        {/* ---------- Footer ---------- */}
        <footer
          style={{ background: "var(--c-footer-bg)", color: "var(--c-footer-text)" }}
        >
          <div className="mx-auto w-full max-w-6xl px-5 py-12 grid gap-8 md:grid-cols-3">
            <div>
              <p className="font-bold text-base" style={{ fontFamily: "var(--font-heading)" }}>
                {payload.site.site_name}
              </p>
              {payload.site.tagline && (
                <p className="mt-1.5 text-sm" style={{ opacity: 0.75 }}>{payload.site.tagline}</p>
              )}
            </div>

            <div>
              <h2 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ opacity: 0.7 }}>
                Contact
              </h2>
              <address className="text-sm not-italic space-y-1.5" style={{ opacity: 0.85 }}>
                {payload.site.contact?.address && <p>{payload.site.contact.address}</p>}
                {payload.site.contact?.phone && (
                  <p><a href={`tel:${payload.site.contact.phone}`} className="hover:underline">{payload.site.contact.phone}</a></p>
                )}
                {payload.site.contact?.email && (
                  <p><a href={`mailto:${payload.site.contact.email}`} className="hover:underline">{payload.site.contact.email}</a></p>
                )}
              </address>
            </div>

            <div>
              <h2 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ opacity: 0.7 }}>
                Links
              </h2>
              <ul className="text-sm space-y-1.5 list-none p-0" style={{ opacity: 0.85 }}>
                {(footerNav.length > 0
                  ? footerNav.map(n => ({ slug: n.href, label: n.label }))
                  : navPages.map(p => ({ slug: `/${p.slug}`, label: p.label }))
                ).map((item, i) => (
                  <li key={i}>
                    <a
                      href={item.slug.startsWith("http") ? item.slug : `${basePath}${item.slug}`}
                      className="hover:underline"
                    >
                      {item.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div
            className="border-t px-5 py-4 text-center text-xs"
            style={{ borderColor: "rgba(255,255,255,.12)", opacity: 0.6 }}
          >
            © {new Date().getFullYear()} {payload.site.site_name}. All rights reserved.
          </div>
        </footer>
      </div>
    </>
  );
}

/* ---------- Built-in dynamic bodies ---------- */

function NewsIndex({ items, basePath }: { items: NewsItem[]; basePath: string }) {
  return (
    <section style={{ paddingTop: "var(--sp-section)", paddingBottom: "var(--sp-section)" }}>
      <div className="mx-auto w-full max-w-6xl px-5">
        {items.length === 0 ? (
          <p style={{ color: "var(--c-text-muted)" }}>There is no news to show yet.</p>
        ) : (
          <div className="grid gap-6 md:grid-cols-3">
            {items.map(n => (
              <article key={n.slug}>
                <div
                  className="h-full p-6"
                  style={{
                    background: "var(--c-surface)",
                    border: "1px solid var(--c-border)",
                    borderRadius: "var(--r-md)",
                  }}
                >
                  <p className="text-xs uppercase tracking-wide mb-1.5" style={{ color: "var(--c-text-muted)" }}>
                    {n.published_at ? new Date(n.published_at).toLocaleDateString() : ""}
                  </p>
                  <h2 className="font-bold mb-2" style={{ fontFamily: "var(--font-heading)", fontSize: "1.125rem" }}>
                    <a href={`${basePath}/news/${n.slug}`} className="hover:underline">{n.title}</a>
                  </h2>
                  {n.excerpt && (
                    <p className="text-sm" style={{ color: "var(--c-text-muted)" }}>{n.excerpt}</p>
                  )}
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
    <section style={{ paddingTop: "var(--sp-section)", paddingBottom: "var(--sp-section)" }}>
      <div className="mx-auto w-full max-w-6xl px-5">
        {items.length === 0 ? (
          <p style={{ color: "var(--c-text-muted)" }}>There are no upcoming events.</p>
        ) : (
          <ul className="space-y-4 list-none p-0">
            {items.map(ev => (
              <li
                key={ev.slug}
                className="p-5 flex flex-col sm:flex-row sm:items-center gap-4"
                style={{
                  background: "var(--c-surface)",
                  border: "1px solid var(--c-border)",
                  borderRadius: "var(--r-md)",
                }}
              >
                <time
                  dateTime={ev.starts_at}
                  className="shrink-0 text-center px-4 py-2"
                  style={{ background: "var(--c-primary)", color: "#fff", borderRadius: "var(--r-sm)" }}
                >
                  <span className="block text-xl font-bold leading-none">
                    {new Date(ev.starts_at).getDate()}
                  </span>
                  <span className="block text-xs uppercase mt-0.5">
                    {new Date(ev.starts_at).toLocaleDateString(undefined, { month: "short" })}
                  </span>
                </time>
                <div className="min-w-0">
                  <h2 className="font-bold" style={{ fontFamily: "var(--font-heading)", fontSize: "1.125rem" }}>
                    {ev.title}
                  </h2>
                  {ev.location && (
                    <p className="text-sm" style={{ color: "var(--c-text-muted)" }}>{ev.location}</p>
                  )}
                  {ev.description && <p className="text-sm mt-1.5">{ev.description}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function ContactBlock({ payload, currentPath }: { payload: PagePayload; currentPath: string }) {
  const form = payload.forms?.find(f => f.key === "contact") ?? payload.forms?.[0];
  const contact = payload.site.contact ?? {};
  return (
    <section style={{ paddingTop: "var(--sp-section)", paddingBottom: "var(--sp-section)" }}>
      <div className="mx-auto w-full max-w-6xl px-5 grid gap-10 lg:grid-cols-2">
        <div>
          <h2 className="mb-6" style={{ fontFamily: "var(--font-heading)", fontSize: "var(--fs-h2)", fontWeight: 700 }}>
            Contact us
          </h2>
          <dl className="space-y-3 text-sm">
            {contact.address && (
              <><dt className="font-semibold">Address</dt><dd>{contact.address}</dd></>
            )}
            {contact.phone && (
              <><dt className="font-semibold">Telephone</dt>
                <dd><a href={`tel:${contact.phone}`} className="underline">{contact.phone}</a></dd></>
            )}
            {contact.email && (
              <><dt className="font-semibold">Email</dt>
                <dd><a href={`mailto:${contact.email}`} className="underline">{contact.email}</a></dd></>
            )}
            {contact.hours && (
              <><dt className="font-semibold">Office hours</dt><dd>{contact.hours}</dd></>
            )}
          </dl>
        </div>
        <div>
          {form ? (
            <SiteForm form={form} websiteId={payload.site.id} sourcePage={currentPath} />
          ) : (
            <p className="text-sm" style={{ color: "var(--c-text-muted)" }}>
              No enquiry form has been configured yet.
            </p>
          )}
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
    <main className="min-h-screen grid place-items-center bg-gray-50 px-6">
      <div className="text-center max-w-sm">
        <h1 className="text-lg font-bold text-gray-900 mb-2">Not available</h1>
        <p className="text-sm text-gray-600">{message}</p>
        <Link href="/" className="inline-block mt-6 text-sm text-blue-700 underline">
          Go to the platform
        </Link>
      </div>
    </main>
  );
}
