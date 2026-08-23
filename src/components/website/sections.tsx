/**
 * Section registry — the block library pages are composed from.
 *
 * Every component reads colour, type and spacing from CSS custom properties
 * emitted by the theme engine, so the same block looks native in all five
 * themes without a single hard-coded colour.
 *
 * An unknown section_type renders nothing rather than throwing, so a page
 * saved by a newer build never breaks an older renderer.
 */

import type {
  PublicSection, PublicSite, NewsItem, EventItem, PublicForm, JsonObject,
} from "@/lib/website/types";
import { SiteForm } from "@/components/website/SiteForm";

/* ------------------------------------------------------------------ */
/* Catalogue — drives the "Add section" picker in Website Studio      */
/* ------------------------------------------------------------------ */

export interface SectionMeta {
  type: string;
  label: string;
  description: string;
  group: "Header" | "Story" | "Offering" | "Proof" | "Media" | "Dynamic" | "Action";
  /** Editable fields, used to generate the studio form. */
  fields: SectionFieldMeta[];
}

export interface SectionFieldMeta {
  name: string;
  label: string;
  type: "text" | "textarea" | "image" | "url" | "number" | "boolean" | "list";
  /** For list fields: the shape of each item. */
  itemFields?: { name: string; label: string; type: "text" | "textarea" | "image" }[];
  help?: string;
}

const F = {
  heading: { name: "heading", label: "Heading", type: "text" } as SectionFieldMeta,
  subheading: { name: "subheading", label: "Sub-heading", type: "textarea" } as SectionFieldMeta,
  body: { name: "body", label: "Body copy", type: "textarea" } as SectionFieldMeta,
  image: { name: "image_url", label: "Image", type: "image" } as SectionFieldMeta,
  imageAlt: {
    name: "image_alt", label: "Image description", type: "text",
    help: "Describes the image for screen readers and when the image fails to load.",
  } as SectionFieldMeta,
};

export const SECTION_CATALOGUE: SectionMeta[] = [
  {
    type: "hero", label: "Hero", group: "Header",
    description: "Full-width opening statement with calls to action.",
    fields: [
      F.heading, F.subheading,
      { name: "primary_cta_label", label: "Primary button label", type: "text" },
      { name: "primary_cta_href", label: "Primary button link", type: "url" },
      { name: "secondary_cta_label", label: "Secondary button label", type: "text" },
      { name: "secondary_cta_href", label: "Secondary button link", type: "url" },
      F.image, F.imageAlt,
    ],
  },
  {
    type: "page_header", label: "Page header", group: "Header",
    description: "Compact title band for interior pages.",
    fields: [F.heading, F.subheading],
  },
  {
    type: "about", label: "About", group: "Story",
    description: "Text beside an image. Your story in one block.",
    fields: [F.heading, F.body, F.image, F.imageAlt],
  },
  {
    type: "principal_message", label: "Principal's message", group: "Story",
    description: "A signed welcome from the head of school.",
    fields: [
      F.heading, F.body,
      { name: "author_name", label: "Name", type: "text" },
      { name: "author_title", label: "Title", type: "text" },
      F.image, F.imageAlt,
    ],
  },
  {
    type: "rich_text", label: "Text block", group: "Story",
    description: "A plain heading and paragraphs.",
    fields: [F.heading, F.body],
  },
  {
    type: "why_choose_us", label: "Why choose us", group: "Offering",
    description: "Three or more reasons, as cards.",
    fields: [
      F.heading,
      { name: "items", label: "Reasons", type: "list", itemFields: [
        { name: "title", label: "Title", type: "text" },
        { name: "body", label: "Description", type: "textarea" },
      ]},
    ],
  },
  {
    type: "values", label: "Our values", group: "Offering",
    description: "What the school stands for.",
    fields: [
      F.heading,
      { name: "items", label: "Values", type: "list", itemFields: [
        { name: "title", label: "Value", type: "text" },
        { name: "body", label: "Description", type: "textarea" },
      ]},
    ],
  },
  {
    type: "programs", label: "Programmes", group: "Offering",
    description: "Year groups or streams, with optional images.",
    fields: [
      F.heading,
      { name: "items", label: "Programmes", type: "list", itemFields: [
        { name: "title", label: "Name", type: "text" },
        { name: "body", label: "Description", type: "textarea" },
        { name: "image_url", label: "Image", type: "image" },
      ]},
    ],
  },
  {
    type: "facilities", label: "Facilities", group: "Offering",
    description: "Labs, library, sports and more.",
    fields: [
      F.heading,
      { name: "items", label: "Facilities", type: "list", itemFields: [
        { name: "title", label: "Name", type: "text" },
        { name: "body", label: "Description", type: "textarea" },
        { name: "image_url", label: "Image", type: "image" },
      ]},
    ],
  },
  {
    type: "stats", label: "Statistics", group: "Proof",
    description: "Headline numbers in a row.",
    fields: [
      F.heading,
      { name: "items", label: "Figures", type: "list", itemFields: [
        { name: "value", label: "Figure", type: "text" },
        { name: "label", label: "Label", type: "text" },
      ]},
    ],
  },
  {
    type: "achievements", label: "Achievements", group: "Proof",
    description: "Awards, results and milestones.",
    fields: [
      F.heading,
      { name: "items", label: "Achievements", type: "list", itemFields: [
        { name: "title", label: "Title", type: "text" },
        { name: "body", label: "Detail", type: "textarea" },
        { name: "image_url", label: "Image", type: "image" },
      ]},
    ],
  },
  {
    type: "testimonials", label: "Testimonials", group: "Proof",
    description: "Quotes from parents, students or alumni.",
    fields: [
      F.heading,
      { name: "items", label: "Quotes", type: "list", itemFields: [
        { name: "quote", label: "Quote", type: "textarea" },
        { name: "author", label: "Name", type: "text" },
        { name: "role", label: "Relationship", type: "text" },
      ]},
    ],
  },
  {
    type: "staff", label: "Staff", group: "Proof",
    description: "Leadership team or teaching staff.",
    fields: [
      F.heading,
      { name: "items", label: "People", type: "list", itemFields: [
        { name: "name", label: "Name", type: "text" },
        { name: "role", label: "Role", type: "text" },
        { name: "image_url", label: "Photograph", type: "image" },
      ]},
    ],
  },
  {
    type: "gallery", label: "Gallery", group: "Media",
    description: "A grid of photographs.",
    fields: [
      F.heading,
      { name: "images", label: "Images", type: "list", itemFields: [
        { name: "url", label: "Image", type: "image" },
        { name: "alt", label: "Description", type: "text" },
      ]},
    ],
  },
  {
    type: "video", label: "Video", group: "Media",
    description: "An embedded tour or promotional film.",
    fields: [
      F.heading,
      { name: "embed_url", label: "Embed URL", type: "url",
        help: "Use the privacy-friendly embed address, e.g. https://www.youtube-nocookie.com/embed/ID" },
      { name: "caption", label: "Caption", type: "text" },
    ],
  },
  {
    type: "news", label: "Latest news", group: "Dynamic",
    description: "Pulls published articles automatically. No duplicate typing.",
    fields: [
      F.heading,
      { name: "limit", label: "How many to show", type: "number" },
    ],
  },
  {
    type: "events", label: "Upcoming events", group: "Dynamic",
    description: "Pulls published events automatically.",
    fields: [
      F.heading,
      { name: "limit", label: "How many to show", type: "number" },
    ],
  },
  {
    type: "faq", label: "FAQ", group: "Dynamic",
    description: "Questions and answers.",
    fields: [
      F.heading,
      { name: "items", label: "Questions", type: "list", itemFields: [
        { name: "q", label: "Question", type: "text" },
        { name: "a", label: "Answer", type: "textarea" },
      ]},
    ],
  },
  {
    type: "admissions_cta", label: "Admissions call to action", group: "Action",
    description: "Prominent band driving applications.",
    fields: [
      F.heading, F.body,
      { name: "cta_label", label: "Button label", type: "text" },
      { name: "cta_href", label: "Button link", type: "url" },
      { name: "secondary_label", label: "Secondary label", type: "text" },
      { name: "secondary_href", label: "Secondary link", type: "url" },
    ],
  },
  {
    type: "cta_banner", label: "Call to action banner", group: "Action",
    description: "A simple prompt with one button.",
    fields: [
      F.heading, F.body,
      { name: "cta_label", label: "Button label", type: "text" },
      { name: "cta_href", label: "Button link", type: "url" },
    ],
  },
  {
    type: "contact", label: "Contact", group: "Action",
    description: "Contact details, an enquiry form and an optional map.",
    fields: [
      F.heading, F.body,
      { name: "form_key", label: "Form to use", type: "text" },
      { name: "show_map", label: "Show map", type: "boolean" },
      { name: "map_embed_url", label: "Map embed URL", type: "url" },
    ],
  },
];

export const SECTION_META: Record<string, SectionMeta> = Object.fromEntries(
  SECTION_CATALOGUE.map(s => [s.type, s])
);

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

const str = (o: JsonObject, k: string, d = ""): string => {
  const v = o?.[k];
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : d;
};
const num = (o: JsonObject, k: string, d: number): number => {
  const v = o?.[k];
  const n = typeof v === "number" ? v : typeof v === "string" ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) ? n : d;
};
const bool = (o: JsonObject, k: string, d = false): boolean =>
  typeof o?.[k] === "boolean" ? (o[k] as boolean) : d;
const list = (o: JsonObject, k: string): JsonObject[] => {
  const v = o?.[k];
  return Array.isArray(v) ? (v as JsonObject[]) : [];
};

/** Section wrapper: alternating band colour and consistent rhythm. */
function Band({
  children, style, tone = "background", id,
}: {
  children: React.ReactNode;
  style?: JsonObject;
  tone?: "background" | "surface" | "surfaceAlt" | "primary";
  id?: string;
}) {
  const override = str(style ?? {}, "background");
  const bg = override
    ? override
    : tone === "surface" ? "var(--c-surface)"
    : tone === "surfaceAlt" ? "var(--c-surface-alt)"
    : tone === "primary" ? "var(--c-primary)"
    : "var(--c-background)";
  const fg = tone === "primary" ? "#fff" : "var(--c-text)";

  return (
    <section
      id={id}
      style={{
        background: bg,
        color: fg,
        paddingTop: "var(--sp-section)",
        paddingBottom: "var(--sp-section)",
      }}
    >
      <div className="mx-auto w-full max-w-6xl px-5">{children}</div>
    </section>
  );
}

function H2({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return (
    <h2
      className="mb-8 text-balance"
      style={{
        fontFamily: "var(--font-heading)",
        fontSize: "var(--fs-h2)",
        fontWeight: 700,
        lineHeight: 1.15,
      }}
    >
      {children}
    </h2>
  );
}

function Btn({
  href, label, variant = "primary",
}: { href: string; label: string; variant?: "primary" | "outline" }) {
  if (!label) return null;
  const base: React.CSSProperties = {
    borderRadius: "var(--btn-radius)",
    fontWeight: "var(--btn-weight)" as unknown as number,
    textTransform: "var(--btn-transform)" as React.CSSProperties["textTransform"],
  };
  const styles: React.CSSProperties = variant === "primary"
    ? { ...base, background: "var(--c-accent)", color: "#111827" }
    : { ...base, background: "transparent", color: "inherit", border: "2px solid currentColor" };

  return (
    <a
      href={href || "#"}
      className="inline-flex items-center justify-center px-6 py-3 text-sm transition-opacity hover:opacity-85"
      style={styles}
    >
      {label}
    </a>
  );
}

/** Image that degrades to a themed placeholder when none is set. */
function Img({
  url, alt, className, ratio = "aspect-[4/3]",
}: { url: string; alt: string; className?: string; ratio?: string }) {
  if (!url) {
    return (
      <div
        className={`${ratio} w-full ${className ?? ""}`}
        style={{ background: "var(--c-surface-alt)", borderRadius: "var(--r-md)" }}
        aria-hidden="true"
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt}
      loading="lazy"
      className={`${ratio} w-full object-cover ${className ?? ""}`}
      style={{ borderRadius: "var(--r-md)" }}
    />
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="p-6 h-full"
      style={{
        background: "var(--c-background)",
        border: "1px solid var(--c-border)",
        borderRadius: "var(--r-md)",
        boxShadow: "var(--sh-card)",
      }}
    >
      {children}
    </div>
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}

/* ------------------------------------------------------------------ */
/* The renderer                                                        */
/* ------------------------------------------------------------------ */

export interface SectionContext {
  site: PublicSite;
  news: NewsItem[];
  events: EventItem[];
  forms: PublicForm[];
  /** Base path for internal links: "" on a real domain, "/s/<slug>" otherwise. */
  basePath: string;
  currentPath?: string;
}

export function RenderSection({
  section, ctx, index,
}: {
  section: PublicSection;
  ctx: SectionContext;
  index: number;
}) {
  const c = section.content ?? {};
  const s = section.style ?? {};
  const alt = index % 2 === 1;
  const link = (href: string) =>
    href.startsWith("http") || href.startsWith("#") || href.startsWith("mailto:")
      ? href
      : `${ctx.basePath}${href.startsWith("/") ? href : `/${href}`}`;

  switch (section.section_type) {
    /* ---------------- Header ---------------- */
    case "hero": {
      const img = str(c, "image_url");
      return (
        <section
          style={{
            background: img ? "var(--c-background)" : "var(--c-primary)",
            color: img ? "var(--c-text)" : "#fff",
            paddingTop: "var(--sp-section)",
            paddingBottom: "var(--sp-section)",
          }}
        >
          <div className="mx-auto w-full max-w-6xl px-5 grid gap-10 lg:grid-cols-2 lg:items-center">
            <div>
              <h1
                className="text-balance"
                style={{
                  fontFamily: "var(--font-heading)",
                  fontSize: "var(--fs-h1)",
                  fontWeight: 700,
                  lineHeight: 1.08,
                }}
              >
                {str(c, "heading")}
              </h1>
              {str(c, "subheading") && (
                <p className="mt-4 text-lg" style={{ opacity: 0.85, maxWidth: "38ch" }}>
                  {str(c, "subheading")}
                </p>
              )}
              <div className="mt-8 flex flex-wrap gap-3">
                <Btn href={link(str(c, "primary_cta_href", "/admissions"))} label={str(c, "primary_cta_label")} />
                <Btn href={link(str(c, "secondary_cta_href", "/contact"))} label={str(c, "secondary_cta_label")} variant="outline" />
              </div>
            </div>
            {img && (
              <Img url={img} alt={str(c, "image_alt")} ratio="aspect-[4/3]" />
            )}
          </div>
        </section>
      );
    }

    case "page_header":
      return (
        <section
          style={{
            background: "var(--c-primary)",
            color: "#fff",
            paddingTop: "3.5rem",
            paddingBottom: "3.5rem",
          }}
        >
          <div className="mx-auto w-full max-w-6xl px-5">
            <h1 style={{ fontFamily: "var(--font-heading)", fontSize: "var(--fs-h2)", fontWeight: 700 }}>
              {str(c, "heading")}
            </h1>
            {str(c, "subheading") && (
              <p className="mt-2 text-base" style={{ opacity: 0.85 }}>{str(c, "subheading")}</p>
            )}
          </div>
        </section>
      );

    /* ---------------- Story ---------------- */
    case "about":
      return (
        <Band style={s} tone={alt ? "surface" : "background"}>
          <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
            <div>
              <H2>{str(c, "heading")}</H2>
              <Prose text={str(c, "body")} />
            </div>
            <Img url={str(c, "image_url")} alt={str(c, "image_alt")} />
          </div>
        </Band>
      );

    case "principal_message":
      return (
        <Band style={s} tone="surface">
          <div className="grid gap-10 lg:grid-cols-[280px_1fr] lg:items-start">
            <Img url={str(c, "image_url")} alt={str(c, "image_alt")} ratio="aspect-[3/4]" />
            <div>
              <H2>{str(c, "heading")}</H2>
              <Prose text={str(c, "body")} />
              {str(c, "author_name") && (
                <p className="mt-6 font-semibold" style={{ fontFamily: "var(--font-accent)" }}>
                  {str(c, "author_name")}
                  <span className="block text-sm font-normal" style={{ color: "var(--c-text-muted)" }}>
                    {str(c, "author_title")}
                  </span>
                </p>
              )}
            </div>
          </div>
        </Band>
      );

    case "rich_text":
      return (
        <Band style={s} tone={alt ? "surface" : "background"}>
          <div className="max-w-3xl">
            <H2>{str(c, "heading")}</H2>
            <Prose text={str(c, "body")} />
          </div>
        </Band>
      );

    /* ---------------- Offering ---------------- */
    case "why_choose_us":
    case "values": {
      const items = list(c, "items");
      return (
        <Band style={s} tone={alt ? "surface" : "background"}>
          <H2>{str(c, "heading")}</H2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((it, i) => (
              <Card key={i}>
                <h3 className="font-bold mb-2" style={{ fontFamily: "var(--font-heading)", fontSize: "var(--fs-h3)" }}>
                  {str(it, "title")}
                </h3>
                <p className="text-sm leading-relaxed" style={{ color: "var(--c-text-muted)" }}>
                  {str(it, "body")}
                </p>
              </Card>
            ))}
          </div>
        </Band>
      );
    }

    case "programs":
    case "facilities":
    case "achievements": {
      const items = list(c, "items");
      return (
        <Band style={s} tone={alt ? "surface" : "background"}>
          <H2>{str(c, "heading")}</H2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((it, i) => (
              <Card key={i}>
                <Img url={str(it, "image_url")} alt={str(it, "title")} className="mb-4" />
                <h3 className="font-bold mb-1.5" style={{ fontFamily: "var(--font-heading)", fontSize: "1.125rem" }}>
                  {str(it, "title")}
                </h3>
                <p className="text-sm leading-relaxed" style={{ color: "var(--c-text-muted)" }}>
                  {str(it, "body")}
                </p>
              </Card>
            ))}
          </div>
        </Band>
      );
    }

    /* ---------------- Proof ---------------- */
    case "stats": {
      const items = list(c, "items");
      return (
        <Band style={s} tone="primary">
          {str(c, "heading") && (
            <h2 className="mb-8 text-center" style={{ fontFamily: "var(--font-heading)", fontSize: "var(--fs-h2)", fontWeight: 700 }}>
              {str(c, "heading")}
            </h2>
          )}
          <dl className="grid gap-8 grid-cols-2 lg:grid-cols-4 text-center">
            {items.map((it, i) => (
              <div key={i}>
                <dt className="sr-only">{str(it, "label")}</dt>
                <dd>
                  <span className="block font-bold" style={{ fontFamily: "var(--font-heading)", fontSize: "2.5rem", lineHeight: 1 }}>
                    {str(it, "value")}
                  </span>
                  <span className="block mt-1.5 text-sm uppercase tracking-wide" style={{ opacity: 0.8 }}>
                    {str(it, "label")}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        </Band>
      );
    }

    case "testimonials": {
      const items = list(c, "items");
      return (
        <Band style={s} tone="surface">
          <H2>{str(c, "heading")}</H2>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {items.map((it, i) => (
              <figure key={i}>
                <Card>
                  <blockquote className="text-base leading-relaxed" style={{ fontFamily: "var(--font-accent)" }}>
                    &ldquo;{str(it, "quote")}&rdquo;
                  </blockquote>
                  <figcaption className="mt-4 text-sm font-semibold">
                    {str(it, "author")}
                    {str(it, "role") && (
                      <span className="block font-normal" style={{ color: "var(--c-text-muted)" }}>
                        {str(it, "role")}
                      </span>
                    )}
                  </figcaption>
                </Card>
              </figure>
            ))}
          </div>
        </Band>
      );
    }

    case "staff": {
      const items = list(c, "items");
      return (
        <Band style={s} tone={alt ? "surface" : "background"}>
          <H2>{str(c, "heading")}</H2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {items.map((it, i) => (
              <div key={i} className="text-center">
                <Img url={str(it, "image_url")} alt={str(it, "name")} ratio="aspect-square" className="mb-3" />
                <p className="font-semibold">{str(it, "name")}</p>
                <p className="text-sm" style={{ color: "var(--c-text-muted)" }}>{str(it, "role")}</p>
              </div>
            ))}
          </div>
        </Band>
      );
    }

    /* ---------------- Media ---------------- */
    case "gallery": {
      const images = list(c, "images");
      return (
        <Band style={s} tone={alt ? "surface" : "background"}>
          <H2>{str(c, "heading")}</H2>
          {images.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--c-text-muted)" }}>
              No photographs have been added yet.
            </p>
          ) : (
            <ul className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-4 list-none p-0">
              {images.map((im, i) => (
                <li key={i}>
                  <Img url={str(im, "url")} alt={str(im, "alt")} ratio="aspect-square" />
                </li>
              ))}
            </ul>
          )}
        </Band>
      );
    }

    case "video": {
      const embed = str(c, "embed_url");
      return (
        <Band style={s} tone="surface">
          <H2>{str(c, "heading")}</H2>
          {embed ? (
            <div className="aspect-video w-full overflow-hidden" style={{ borderRadius: "var(--r-md)" }}>
              <iframe
                src={embed}
                title={str(c, "heading") || "Video"}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="w-full h-full border-0"
              />
            </div>
          ) : (
            <p className="text-sm" style={{ color: "var(--c-text-muted)" }}>No video has been added yet.</p>
          )}
          {str(c, "caption") && (
            <p className="mt-3 text-sm" style={{ color: "var(--c-text-muted)" }}>{str(c, "caption")}</p>
          )}
        </Band>
      );
    }

    /* ---------------- Dynamic ---------------- */
    case "news": {
      const items = ctx.news.slice(0, num(c, "limit", 3));
      if (items.length === 0) return null;
      return (
        <Band style={s} tone={alt ? "surface" : "background"}>
          <div className="flex items-end justify-between gap-4 mb-8">
            <h2 style={{ fontFamily: "var(--font-heading)", fontSize: "var(--fs-h2)", fontWeight: 700 }}>
              {str(c, "heading", "Latest news")}
            </h2>
            <a href={`${ctx.basePath}/news`} className="text-sm font-semibold underline shrink-0">
              All news
            </a>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {items.map((n) => (
              <article key={n.slug}>
                <Card>
                  <Img url={n.cover_image_url ?? ""} alt={n.title} className="mb-4" />
                  <p className="text-xs uppercase tracking-wide mb-1.5" style={{ color: "var(--c-text-muted)" }}>
                    {fmtDate(n.published_at)}
                    {n.category ? ` · ${n.category}` : ""}
                  </p>
                  <h3 className="font-bold mb-2" style={{ fontFamily: "var(--font-heading)", fontSize: "1.125rem" }}>
                    <a href={`${ctx.basePath}/news/${n.slug}`} className="hover:underline">{n.title}</a>
                  </h3>
                  {n.excerpt && (
                    <p className="text-sm leading-relaxed" style={{ color: "var(--c-text-muted)" }}>{n.excerpt}</p>
                  )}
                </Card>
              </article>
            ))}
          </div>
        </Band>
      );
    }

    case "events": {
      const items = ctx.events.slice(0, num(c, "limit", 3));
      if (items.length === 0) return null;
      return (
        <Band style={s} tone={alt ? "surface" : "background"}>
          <div className="flex items-end justify-between gap-4 mb-8">
            <h2 style={{ fontFamily: "var(--font-heading)", fontSize: "var(--fs-h2)", fontWeight: 700 }}>
              {str(c, "heading", "Upcoming events")}
            </h2>
            <a href={`${ctx.basePath}/events`} className="text-sm font-semibold underline shrink-0">
              All events
            </a>
          </div>
          <ul className="grid gap-4 md:grid-cols-3 list-none p-0">
            {items.map((ev) => (
              <li key={ev.slug}>
                <Card>
                  <time
                    dateTime={ev.starts_at}
                    className="block text-xs font-bold uppercase tracking-wide mb-1.5"
                    style={{ color: "var(--c-accent)" }}
                  >
                    {fmtDate(ev.starts_at)}
                  </time>
                  <h3 className="font-bold mb-1.5" style={{ fontFamily: "var(--font-heading)", fontSize: "1.125rem" }}>
                    {ev.title}
                  </h3>
                  {ev.location && (
                    <p className="text-sm" style={{ color: "var(--c-text-muted)" }}>{ev.location}</p>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        </Band>
      );
    }

    case "faq": {
      const items = list(c, "items");
      return (
        <Band style={s} tone={alt ? "surface" : "background"}>
          <H2>{str(c, "heading")}</H2>
          <div className="max-w-3xl space-y-3">
            {items.map((it, i) => (
              <details
                key={i}
                className="p-4"
                style={{
                  background: "var(--c-background)",
                  border: "1px solid var(--c-border)",
                  borderRadius: "var(--r-md)",
                }}
              >
                <summary className="font-semibold cursor-pointer">{str(it, "q")}</summary>
                <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--c-text-muted)" }}>
                  {str(it, "a")}
                </p>
              </details>
            ))}
          </div>
        </Band>
      );
    }

    /* ---------------- Action ---------------- */
    case "admissions_cta":
    case "cta_banner":
      return (
        <Band style={s} tone="primary">
          <div className="text-center max-w-2xl mx-auto">
            <h2 style={{ fontFamily: "var(--font-heading)", fontSize: "var(--fs-h2)", fontWeight: 700 }}>
              {str(c, "heading")}
            </h2>
            {str(c, "body") && <p className="mt-3" style={{ opacity: 0.9 }}>{str(c, "body")}</p>}
            <div className="mt-7 flex flex-wrap gap-3 justify-center">
              <Btn href={link(str(c, "cta_href", "/admissions"))} label={str(c, "cta_label")} />
              <Btn href={link(str(c, "secondary_href", "/contact"))} label={str(c, "secondary_label")} variant="outline" />
            </div>
          </div>
        </Band>
      );

    case "contact": {
      const formKey = str(c, "form_key", "contact");
      const form = ctx.forms.find(f => f.key === formKey) ?? ctx.forms[0];
      const contact = ctx.site.contact ?? {};
      return (
        <Band style={s} tone={alt ? "surface" : "background"} id="contact">
          <H2>{str(c, "heading", "Get in touch")}</H2>
          <div className="grid gap-10 lg:grid-cols-2">
            <div>
              {str(c, "body") && <p className="mb-6 leading-relaxed">{str(c, "body")}</p>}
              <dl className="space-y-3 text-sm">
                {contact.address && <ContactLine label="Address" value={contact.address} />}
                {contact.phone && <ContactLine label="Telephone" value={contact.phone} href={`tel:${contact.phone}`} />}
                {contact.email && <ContactLine label="Email" value={contact.email} href={`mailto:${contact.email}`} />}
                {contact.hours && <ContactLine label="Office hours" value={contact.hours} />}
              </dl>
              {bool(c, "show_map") && str(c, "map_embed_url") && (
                <div className="mt-6 aspect-video overflow-hidden" style={{ borderRadius: "var(--r-md)" }}>
                  <iframe
                    src={str(c, "map_embed_url")}
                    title="Map"
                    className="w-full h-full border-0"
                    loading="lazy"
                  />
                </div>
              )}
            </div>
            <div>
              {form ? (
                <SiteForm form={form} websiteId={ctx.site.id} sourcePage={ctx.currentPath} />
              ) : (
                <p className="text-sm" style={{ color: "var(--c-text-muted)" }}>
                  No enquiry form has been configured yet.
                </p>
              )}
            </div>
          </div>
        </Band>
      );
    }

    default:
      // Unknown block type: render nothing rather than break the page.
      return null;
  }
}

function ContactLine({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <div className="flex gap-2">
      <dt className="font-semibold shrink-0" style={{ minWidth: "6.5rem" }}>{label}</dt>
      <dd>
        {href ? <a href={href} className="underline">{value}</a> : value}
      </dd>
    </div>
  );
}

/** Renders newline-separated copy as paragraphs. */
function Prose({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div className="space-y-4">
      {text.split(/\n{2,}|\n/).filter(Boolean).map((p, i) => (
        <p key={i} className="leading-relaxed" style={{ color: "var(--c-text-muted)" }}>{p}</p>
      ))}
    </div>
  );
}
