/**
 * Shared resolution + rendering logic for the two public entry points:
 *   /s/<org-slug>/...   (preview path, works without DNS)
 *   any custom host      (rewritten by middleware to /site/tenant/...)
 *
 * Keeping this in one place means the two routes cannot drift apart and
 * accidentally apply different tenant checks.
 */

import { createClient } from "@supabase/supabase-js";
import type { Metadata } from "next";
import {
  SiteShell, SiteUnavailable, fetchPage, fetchArticle, fetchAllNews, fetchAllEvents,
} from "@/components/website/SitePage";
import type { SiteResolution, PagePayload } from "@/lib/website/types";

function publicClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

export async function resolveByHost(host: string): Promise<SiteResolution | null> {
  const { data } = await publicClient().rpc("resolve_site_by_host", { p_host: host });
  return (data as SiteResolution) ?? null;
}

export async function resolveBySlug(slug: string): Promise<SiteResolution | null> {
  const { data } = await publicClient().rpc("resolve_site_by_slug", { p_slug: slug });
  return (data as SiteResolution) ?? null;
}

/** Turn catch-all segments into a page slug plus an optional record slug. */
export function splitPath(segments: string[] | undefined): {
  pageSlug: string;
  recordSlug: string | null;
} {
  const parts = (segments ?? []).filter(Boolean);
  if (parts.length === 0) return { pageSlug: "", recordSlug: null };
  if (parts.length === 1) return { pageSlug: parts[0], recordSlug: null };
  return { pageSlug: parts[0], recordSlug: parts.slice(1).join("/") };
}

export async function buildMetadata(
  resolution: SiteResolution | null,
  segments: string[] | undefined
): Promise<Metadata> {
  if (!resolution?.available || !resolution.website_id) {
    return { title: "Not available", robots: { index: false, follow: false } };
  }

  const { pageSlug } = splitPath(segments);
  const payload = await fetchPage(resolution.website_id, pageSlug);
  if (!payload || payload.not_found) {
    return { title: "Page not found", robots: { index: false, follow: false } };
  }

  const siteSeo = payload.site.seo ?? {};
  const pageSeo = payload.page.seo ?? {};
  const title = pageSeo.title || `${payload.page.title} · ${payload.site.site_name}`;
  const description =
    pageSeo.description || siteSeo.description || payload.site.tagline || undefined;
  const image = pageSeo.og_image_url || siteSeo.og_image_url;

  return {
    title,
    description,
    keywords: pageSeo.keywords || siteSeo.keywords,
    icons: payload.site.favicon_url ? { icon: payload.site.favicon_url } : undefined,
    openGraph: {
      title,
      description,
      siteName: payload.site.site_name,
      type: "website",
      images: image ? [{ url: image }] : undefined,
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title,
      description,
    },
    robots:
      (pageSeo.robots || siteSeo.robots) === "noindex"
        ? { index: false, follow: false }
        : { index: true, follow: true },
  };
}

/** Structured data so search engines understand the organisation. */
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

/**
 * Renders the resolved site. `basePath` is prefixed to every internal link so
 * the same page works at greenfield.edu/about and /s/greenfield/about.
 */
export async function renderSite({
  resolution, segments, basePath,
}: {
  resolution: SiteResolution | null;
  segments: string[] | undefined;
  basePath: string;
}) {
  if (!resolution || !resolution.found) {
    return <SiteUnavailable />;
  }
  if (!resolution.available || !resolution.website_id) {
    return <SiteUnavailable reason={resolution.reason} />;
  }

  const { pageSlug, recordSlug } = splitPath(segments);
  const currentPath = `${basePath}/${(segments ?? []).join("/")}`;

  // A news article: /news/<slug>
  if (pageSlug === "news" && recordSlug) {
    const payload = await fetchPage(resolution.website_id, "news");
    if (!payload || payload.not_found) return <SiteUnavailable />;

    const article = await fetchArticle(resolution.organization_id!, recordSlug);
    if (!article) {
      return (
        <SiteShell payload={payload} basePath={basePath} currentPath={currentPath}>
          <NotFoundBody basePath={basePath} />
        </SiteShell>
      );
    }

    return (
      <SiteShell payload={payload} basePath={basePath} currentPath={currentPath}>
        <article
          style={{ paddingTop: "var(--sp-section)", paddingBottom: "var(--sp-section)" }}
        >
          <div className="mx-auto w-full max-w-3xl px-5">
            <p className="text-xs uppercase tracking-wide mb-2" style={{ color: "var(--c-text-muted)" }}>
              {article.published_at ? new Date(article.published_at).toLocaleDateString() : ""}
              {article.category ? ` · ${article.category}` : ""}
            </p>
            <h1
              className="mb-6"
              style={{ fontFamily: "var(--font-heading)", fontSize: "var(--fs-h1)", fontWeight: 700, lineHeight: 1.1 }}
            >
              {article.title}
            </h1>
            {article.cover_image_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={article.cover_image_url}
                alt=""
                className="w-full aspect-[16/9] object-cover mb-8"
                style={{ borderRadius: "var(--r-md)" }}
              />
            )}
            <div className="space-y-4">
              {(article.body ?? article.excerpt ?? "")
                .split(/\n{2,}|\n/)
                .filter(Boolean)
                .map((p, i) => (
                  <p key={i} className="leading-relaxed">{p}</p>
                ))}
            </div>
            {article.author_name && (
              <p className="mt-8 text-sm" style={{ color: "var(--c-text-muted)" }}>
                By {article.author_name}
              </p>
            )}
            <a href={`${basePath}/news`} className="inline-block mt-10 text-sm font-semibold underline">
              Back to all news
            </a>
          </div>
        </article>
      </SiteShell>
    );
  }

  const payload = await fetchPage(resolution.website_id, pageSlug);
  if (!payload) return <SiteUnavailable />;

  if (payload.not_found) {
    // Fall back to the home page's chrome so the 404 still looks like the school.
    const home = await fetchPage(resolution.website_id, "");
    if (!home || home.not_found) return <SiteUnavailable />;
    return (
      <SiteShell payload={home} basePath={basePath} currentPath={currentPath}>
        <NotFoundBody basePath={basePath} />
      </SiteShell>
    );
  }

  // Index pages get their full record set rather than the capped preview list.
  if (payload.page.page_type === "news_index") {
    payload.news = await fetchAllNews(resolution.organization_id!);
  }
  if (payload.page.page_type === "event_index") {
    payload.events = await fetchAllEvents(resolution.organization_id!);
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: schemaOrg(payload, basePath ? "" : "") }}
      />
      <SiteShell payload={payload} basePath={basePath} currentPath={currentPath} />
    </>
  );
}

function NotFoundBody({ basePath }: { basePath: string }) {
  return (
    <section
      className="grid place-items-center text-center"
      style={{ paddingTop: "var(--sp-section)", paddingBottom: "var(--sp-section)" }}
    >
      <div className="px-5">
        <h1 style={{ fontFamily: "var(--font-heading)", fontSize: "var(--fs-h2)", fontWeight: 700 }}>
          Page not found
        </h1>
        <p className="mt-3" style={{ color: "var(--c-text-muted)" }}>
          The page you were looking for does not exist or has not been published.
        </p>
        <a
          href={basePath || "/"}
          className="inline-block mt-8 px-6 py-3 text-sm"
          style={{
            background: "var(--c-primary)", color: "#fff",
            borderRadius: "var(--btn-radius)", fontWeight: 600,
          }}
        >
          Return home
        </a>
      </div>
    </section>
  );
}
