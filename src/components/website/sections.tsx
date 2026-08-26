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
  eyebrow: {
    name: "eyebrow", label: "Eyebrow", type: "text",
    help: "Small label above the heading, e.g. \"Why us\".",
  } as SectionFieldMeta,
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
      F.eyebrow, F.heading, F.subheading,
      { name: "primary_cta_label", label: "Primary button label", type: "text" },
      { name: "primary_cta_href", label: "Primary button link", type: "url" },
      { name: "secondary_cta_label", label: "Secondary button label", type: "text" },
      { name: "secondary_cta_href", label: "Secondary button link", type: "url" },
      F.image, F.imageAlt,
      { name: "badge_initials", label: "Crest initials", type: "text",
        help: "Shown in the medallion when the theme uses the badge-ring hero." },
      { name: "badge_caption", label: "Crest caption", type: "text" },
      { name: "trust_chips", label: "Trust chips", type: "list",
        itemFields: [{ name: "label", label: "Chip text", type: "text" }] },
      { name: "stats", label: "Hero statistics", type: "list",
        itemFields: [
          { name: "value", label: "Figure", type: "text" },
          { name: "label", label: "Label", type: "text" },
        ] },
    ],
  },
  {
    type: "page_header", label: "Page header", group: "Header",
    description: "Compact title band for interior pages.",
    fields: [F.eyebrow, F.heading, F.subheading],
  },
  {
    type: "marquee_band", label: "Marquee band", group: "Header",
    description: "A slow scrolling strip of short claims. Sits directly under the hero.",
    fields: [
      { name: "items", label: "Scrolling items", type: "list",
        itemFields: [{ name: "label", label: "Text", type: "text" }] },
      { name: "speed", label: "Seconds per loop", type: "number",
        help: "Higher is slower. 30 is a comfortable default." },
    ],
  },
  {
    type: "trust_strip", label: "Trust chips", group: "Header",
    description: "A row of short credibility chips.",
    fields: [
      { name: "items", label: "Chips", type: "list",
        itemFields: [{ name: "label", label: "Chip text", type: "text" }] },
    ],
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
    type: "journey", label: "Admissions journey", group: "Action",
    description: "Numbered steps from first enquiry to enrolment, joined by a connecting line.",
    fields: [
      F.eyebrow, F.heading, F.body,
      { name: "items", label: "Steps", type: "list", itemFields: [
        { name: "title", label: "Step name", type: "text" },
        { name: "body", label: "What happens", type: "textarea" },
      ]},
    ],
  },
  {
    type: "houses", label: "Houses", group: "Proof",
    description: "House or team roundels with mottos. Each house carries its own colour.",
    fields: [
      F.eyebrow, F.heading, F.body,
      { name: "items", label: "Houses", type: "list", itemFields: [
        { name: "name", label: "House name", type: "text" },
        { name: "motto", label: "Motto", type: "text" },
        { name: "color", label: "House colour (hex)", type: "text" },
      ]},
    ],
  },
  {
    type: "leadership", label: "Leadership team", group: "Proof",
    description: "Portrait cards for the senior team. Falls back to initials when no photo is set.",
    fields: [
      F.eyebrow, F.heading,
      { name: "items", label: "People", type: "list", itemFields: [
        { name: "name", label: "Name", type: "text" },
        { name: "role", label: "Role", type: "text" },
        { name: "image_url", label: "Photograph", type: "image" },
      ]},
    ],
  },
  {
    type: "key_dates", label: "Key dates", group: "Dynamic",
    description: "A diary strip of upcoming dates, entered by hand.",
    fields: [
      F.eyebrow, F.heading,
      { name: "items", label: "Dates", type: "list", itemFields: [
        { name: "day", label: "Day", type: "text" },
        { name: "month", label: "Month", type: "text" },
        { name: "title", label: "What", type: "text" },
        { name: "detail", label: "Detail", type: "text" },
      ]},
    ],
  },
  {
    type: "newsletter", label: "Newsletter signup", group: "Action",
    description: "Email capture band. Submissions land in Enquiries.",
    fields: [
      F.heading, F.body,
      { name: "cta_label", label: "Button label", type: "text" },
      { name: "form_key", label: "Form to use", type: "text",
        help: "Defaults to the built-in \"newsletter\" form." },
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
  heroStyle?: string;
  headerStyle?: string;
}

/**
 * Renders one section, then applies any per-section appearance overrides
 * the school set in Website Studio.
 *
 * Overrides are deliberately additive: a section with an empty style object
 * inherits everything from the theme, which is what most sections do. The
 * wrapper only appears when there is something to override.
 */
export function RenderSection(props: {
  section: PublicSection;
  ctx: SectionContext;
  index: number;
}) {
  const inner = <RenderSectionBody {...props} />;
  const s = props.section.style ?? {};

  const tone = typeof s.tone === "string" ? s.tone : "";
  const bg = typeof s.background === "string" ? s.background : "";
  const padding = typeof s.padding === "string" ? s.padding : "";
  const align = typeof s.align === "string" ? s.align : "";
  const divider = typeof s.divider === "string" ? s.divider : "";
  const motif = s.motif === true;
  const fullBleed = s.fullBleed === true;

  const hasOverride = !!(tone || bg || padding || align || divider !== "" || motif || fullBleed);
  if (!hasOverride) return inner;

  /* Tone maps onto the theme's own custom properties, so an override still
     tracks the palette rather than hard-coding a colour. */
  const toneBg: Record<string, string> = {
    background: "var(--c-background)",
    surface: "var(--c-surface)",
    surfaceAlt: "var(--c-surface-alt)",
    primary: "var(--c-primary)",
    primaryDark: "var(--c-primary-dark)",
    ink: "var(--c-ink-deep, var(--c-ink))",
  };
  const lightText = ["primary", "primaryDark", "ink"].includes(tone);

  const padMap: Record<string, string> = {
    none: "0",
    tight: "clamp(28px,4vw,48px)",
    normal: "var(--sp-section-y)",
    loose: "calc(var(--sp-section-y) * 1.35)",
  };

  const wrapStyle: React.CSSProperties = {
    background: bg || (tone ? toneBg[tone] : undefined),
    color: lightText && !bg ? "#fff" : undefined,
    paddingTop: padding ? padMap[padding] : undefined,
    paddingBottom: padding ? padMap[padding] : undefined,
    textAlign: align === "center" ? "center" : align === "left" ? "left" : undefined,
    backgroundImage: motif ? "var(--motif-image)" : undefined,
    backgroundSize: motif ? "var(--motif-size)" : undefined,
    clipPath: divider === "angle" ? "polygon(0 0,100% 0,100% calc(100% - 3vw),0 100%)" : undefined,
  };

  const fillColor = bg || (tone ? toneBg[tone] : "var(--c-background)");

  return (
    <div
      className={cx("section-override", fullBleed && "full-bleed", motif && "has-motif")}
      style={wrapStyle}
      data-tone={tone || undefined}
    >
      {inner}
      {divider === "curve" && (
        <div className="divider-curve bottom" aria-hidden="true">
          <svg viewBox="0 0 1200 120" preserveAspectRatio="none">
            <path d="M0,120 L1200,120 L1200,80 Q600,0 0,80 Z" fill={fillColor} />
          </svg>
        </div>
      )}
      {divider === "weave" && <div className="weave-divider" aria-hidden="true" />}
      {divider === "rule" && <div className="divider-rule" aria-hidden="true" />}
    </div>
  );
}

/** Tiny local classnames helper so this file has no extra dependency. */
function cx(...parts: (string | false | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

function RenderSectionBody({
  section, ctx, index,
}: {
  section: PublicSection;
  ctx: SectionContext;
  index: number;
}) {
  const c = section.content ?? {};
  const s = section.style ?? {};
  const alt = index % 2 === 1;
  /* Eyebrow and anchor are first-class: they live on the section row so a
     school can label and deep-link a block without editing content JSON. */
  const eyebrow = section.eyebrow ?? str(c, "eyebrow");
  const anchor = section.anchor_id || undefined;
  const link = (href: string) =>
    href.startsWith("http") || href.startsWith("#") || href.startsWith("mailto:")
      ? href
      : `${ctx.basePath}${href.startsWith("/") ? href : `/${href}`}`;

  switch (section.section_type) {
    /* ============================================================ */
    /* HERO                                                          */
    /* ============================================================ */
    case "hero": {
      const img = str(c, "image_url");
      const heroVariant = str(s, "variant") || ctx.heroStyle || "image-right";
      const hidePanel = heroVariant === "centered" || heroVariant === "gradient";
      const isCentered = hidePanel || !img;

      return (
        <section className={`hero${isCentered && heroVariant !== "full-bleed" ? " hero--centered" : ""}`}>
          <div className="hero-inner">
            <div className="hero-content">
              {str(c, "eyebrow") && (
                <span className="eyebrow on-dark">{str(c, "eyebrow")}</span>
              )}
              <h1
                dangerouslySetInnerHTML={{
                  __html: str(c, "heading").replace(
                    /\*(.*?)\*/g,
                    "<em>$1</em>"
                  ),
                }}
              />
              {str(c, "subheading") && (
                <p className="hero-sub">{str(c, "subheading")}</p>
              )}
              <div className="hero-ctas">
                {str(c, "primary_cta_label") && (
                  <a
                    href={link(str(c, "primary_cta_href", "/admissions"))}
                    className="btn btn-primary"
                  >
                    {str(c, "primary_cta_label")}
                  </a>
                )}
                {str(c, "secondary_cta_label") && (
                  <a
                    href={link(str(c, "secondary_cta_href", "/contact"))}
                    className="btn btn-outline-light"
                  >
                    {str(c, "secondary_cta_label")}
                  </a>
                )}
              </div>
              {list(c, "stats").length > 0 && (
                <div className="hero-stats">
                  {list(c, "stats").map((stat, i) => (
                    <div key={i} className="hero-stat">
                      <b>{str(stat, "value")}</b>
                      <span>{str(stat, "label")}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {img && !hidePanel && (
              <div className="hero-panel">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img}
                  alt={str(c, "image_alt", "")}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    position: "relative",
                    zIndex: 1,
                  }}
                />
              </div>
            )}
          </div>
        </section>
      );
    }

    /* ============================================================ */
    /* PAGE HEADER                                                   */
    /* ============================================================ */
    case "page_header":
      return (
        <section className="hero" style={{ padding: "clamp(48px,6vw,80px) 0" }}>
          <div className="hero-inner" style={{ display: "block" }}>
            {str(c, "eyebrow") && (
              <span className="eyebrow on-dark">{str(c, "eyebrow")}</span>
            )}
            <h1>{str(c, "heading")}</h1>
            {str(c, "subheading") && (
              <p className="hero-sub">{str(c, "subheading")}</p>
            )}
          </div>
        </section>
      );

    /* ============================================================ */
    /* ABOUT / SPLIT LAYOUT                                         */
    /* ============================================================ */
    case "about":
      return (
        <section className={`section${alt ? " alt" : ""} reveal`}>
          <div className="wrap">
            <div className={`split${alt ? " split--reverse" : ""}`}>
              <div>
                <div className="section-head">
                  <h2>{str(c, "heading")}</h2>
                </div>
                <div className="prose">
                  <Prose text={str(c, "body")} />
                </div>
              </div>
              <SectionImage url={str(c, "image_url")} alt={str(c, "image_alt")} />
            </div>
          </div>
        </section>
      );

    /* ============================================================ */
    /* PRINCIPAL'S MESSAGE                                           */
    /* ============================================================ */
    case "principal_message":
      return (
        <section className="section alt reveal">
          <div className="wrap">
            <div className="split">
              <SectionImage
                url={str(c, "image_url")}
                alt={str(c, "image_alt")}
                style={{ aspectRatio: "3/4" }}
              />
              <div>
                <div className="section-head">
                  <h2>{str(c, "heading")}</h2>
                </div>
                <div className="prose">
                  <Prose text={str(c, "body")} />
                </div>
                {str(c, "author_name") && (
                  <p style={{ marginTop: "1.5rem" }}>
                    <strong style={{ display: "block" }}>{str(c, "author_name")}</strong>
                    <span style={{ fontSize: ".88rem", color: "var(--c-text-muted)" }}>
                      {str(c, "author_title")}
                    </span>
                  </p>
                )}
              </div>
            </div>
          </div>
        </section>
      );

    /* ============================================================ */
    /* RICH TEXT                                                     */
    /* ============================================================ */
    case "rich_text":
      return (
        <section className={`section${alt ? " alt" : ""} reveal`}>
          <div className="wrap">
            <div style={{ maxWidth: 720 }}>
              {str(c, "heading") && (
                <div className="section-head">
                  <h2>{str(c, "heading")}</h2>
                </div>
              )}
              <div className="prose">
                <Prose text={str(c, "body")} />
              </div>
            </div>
          </div>
        </section>
      );

    /* ============================================================ */
    /* WHY CHOOSE US / VALUES — card grid                           */
    /* ============================================================ */
    case "why_choose_us":
    case "values": {
      const items = list(c, "items");
      return (
        <section className={`section${alt ? " alt" : ""} reveal`}>
          <div className="wrap">
            <div className="section-head center">
              <h2>{str(c, "heading")}</h2>
              {str(c, "subheading") && <p>{str(c, "subheading")}</p>}
            </div>
            <div className="grid-3 reveal-stagger">
              {items.map((it, i) => (
                <div key={i} className="card" style={{ "--i": i } as React.CSSProperties}>
                  <h3>{str(it, "title")}</h3>
                  <p>{str(it, "body")}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      );
    }

    /* ============================================================ */
    /* PROGRAMS / FACILITIES / ACHIEVEMENTS — image cards            */
    /* ============================================================ */
    case "programs":
    case "facilities":
    case "achievements": {
      const items = list(c, "items");
      return (
        <section className={`section${alt ? " alt" : ""} reveal`}>
          <div className="wrap">
            <div className="section-head center">
              <h2>{str(c, "heading")}</h2>
              {str(c, "subheading") && <p>{str(c, "subheading")}</p>}
            </div>
            <div className="grid-3 reveal-stagger">
              {items.map((it, i) => (
                <div
                  key={i}
                  className="card"
                  style={{ "--i": i, padding: 0, overflow: "hidden" } as React.CSSProperties}
                >
                  {str(it, "image_url") && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={str(it, "image_url")}
                      alt={str(it, "title")}
                      loading="lazy"
                      style={{ width: "100%", aspectRatio: "16/10", objectFit: "cover" }}
                    />
                  )}
                  <div style={{ padding: "24px 28px" }}>
                    <h3>{str(it, "title")}</h3>
                    <p>{str(it, "body")}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      );
    }

    /* ============================================================ */
    /* STATS BAND                                                    */
    /* ============================================================ */
    case "stats": {
      const items = list(c, "items");
      return (
        <section className="stats-band reveal">
          <div className="wrap">
            {str(c, "heading") && (
              <div className="section-head center" style={{ marginBottom: 36 }}>
                <h2 style={{ color: "#fff" }}>{str(c, "heading")}</h2>
              </div>
            )}
            <div className="stats-grid">
              {items.map((it, i) => (
                <div key={i}>
                  <span className="stat-value">{str(it, "value")}</span>
                  <span className="stat-label">{str(it, "label")}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      );
    }

    /* ============================================================ */
    /* TESTIMONIALS                                                  */
    /* ============================================================ */
    case "testimonials": {
      const items = list(c, "items");
      return (
        <section className="section alt reveal">
          <div className="wrap">
            <div className="section-head center">
              <h2>{str(c, "heading")}</h2>
            </div>
            <div className="testimonial-grid reveal-stagger">
              {items.map((it, i) => (
                <figure
                  key={i}
                  className="testimonial-card"
                  style={{ "--i": i } as React.CSSProperties}
                >
                  <blockquote>&ldquo;{str(it, "quote")}&rdquo;</blockquote>
                  <figcaption>
                    <cite>{str(it, "author")}</cite>
                    {str(it, "role") && (
                      <span className="cite-role">{str(it, "role")}</span>
                    )}
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>
      );
    }

    /* ============================================================ */
    /* STAFF                                                         */
    /* ============================================================ */
    case "staff": {
      const items = list(c, "items");
      return (
        <section className={`section${alt ? " alt" : ""} reveal`}>
          <div className="wrap">
            <div className="section-head center">
              <h2>{str(c, "heading")}</h2>
            </div>
            <div className="staff-grid reveal-stagger">
              {items.map((it, i) => (
                <div
                  key={i}
                  className="staff-card"
                  style={{ "--i": i } as React.CSSProperties}
                >
                  {str(it, "image_url") ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={str(it, "image_url")}
                      alt={str(it, "name")}
                      loading="lazy"
                    />
                  ) : (
                    <div
                      aria-hidden="true"
                      style={{
                        width: "100%",
                        aspectRatio: "1/1",
                        borderRadius: "var(--r-md)",
                        background: "var(--c-surface-alt)",
                        marginBottom: 12,
                      }}
                    />
                  )}
                  <span className="staff-name">{str(it, "name")}</span>
                  <span className="staff-role">{str(it, "role")}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      );
    }

    /* ============================================================ */
    /* GALLERY                                                       */
    /* ============================================================ */
    case "gallery": {
      const images = list(c, "images");
      return (
        <section className={`section${alt ? " alt" : ""} reveal`}>
          <div className="wrap">
            <div className="section-head center">
              <h2>{str(c, "heading")}</h2>
            </div>
            {images.length === 0 ? (
              <p style={{ color: "var(--c-text-muted)", textAlign: "center" }}>
                No photographs have been added yet.
              </p>
            ) : (
              <div className="gallery-grid">
                {images.map((im, i) =>
                  str(im, "url") ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={i}
                      src={str(im, "url")}
                      alt={str(im, "alt")}
                      loading="lazy"
                    />
                  ) : (
                    <div key={i} className="gallery-tile" aria-hidden="true">
                      <span>No image</span>
                    </div>
                  )
                )}
              </div>
            )}
          </div>
        </section>
      );
    }

    /* ============================================================ */
    /* VIDEO                                                         */
    /* ============================================================ */
    case "video": {
      const embed = str(c, "embed_url");
      return (
        <section className="section alt reveal">
          <div className="wrap">
            {str(c, "heading") && (
              <div className="section-head center">
                <h2>{str(c, "heading")}</h2>
              </div>
            )}
            {embed ? (
              <div className="video-wrap">
                <iframe
                  src={embed}
                  title={str(c, "heading") || "Video"}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            ) : (
              <p style={{ color: "var(--c-text-muted)", textAlign: "center" }}>
                No video has been added yet.
              </p>
            )}
            {str(c, "caption") && (
              <p style={{ textAlign: "center", color: "var(--c-text-muted)", marginTop: 12, fontSize: ".9rem" }}>
                {str(c, "caption")}
              </p>
            )}
          </div>
        </section>
      );
    }

    /* ============================================================ */
    /* LATEST NEWS                                                   */
    /* ============================================================ */
    case "news": {
      const items = ctx.news.slice(0, num(c, "limit", 3));
      if (items.length === 0) return null;
      return (
        <section className={`section${alt ? " alt" : ""} reveal`}>
          <div className="wrap">
            <div
              className="section-head"
              style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}
            >
              <h2>{str(c, "heading", "Latest news")}</h2>
              <a href={`${ctx.basePath}/news`} className="btn btn-ghost btn-sm">
                All news &rarr;
              </a>
            </div>
            <div className="grid-3 reveal-stagger">
              {items.map((n, i) => (
                <article
                  key={n.slug}
                  className="news-card"
                  style={{ "--i": i } as React.CSSProperties}
                >
                  {n.cover_image_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={n.cover_image_url} alt="" loading="lazy" />
                  )}
                  <div className="news-card-body">
                    <p className="meta">
                      {fmtDate(n.published_at)}
                      {n.category ? ` · ${n.category}` : ""}
                    </p>
                    <h3>
                      <a href={`${ctx.basePath}/news/${n.slug}`}>{n.title}</a>
                    </h3>
                    {n.excerpt && <p>{n.excerpt}</p>}
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
      );
    }

    /* ============================================================ */
    /* UPCOMING EVENTS                                               */
    /* ============================================================ */
    case "events": {
      const items = ctx.events.slice(0, num(c, "limit", 3));
      if (items.length === 0) return null;
      return (
        <section className={`section${alt ? " alt" : ""} reveal`}>
          <div className="wrap">
            <div
              className="section-head"
              style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}
            >
              <h2>{str(c, "heading", "Upcoming events")}</h2>
              <a href={`${ctx.basePath}/events`} className="btn btn-ghost btn-sm">
                All events &rarr;
              </a>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {items.map((ev) => (
                <div key={ev.slug} className="event-item">
                  <time dateTime={ev.starts_at} className="event-date">
                    <span className="day">{new Date(ev.starts_at).getDate()}</span>
                    <span className="month">
                      {new Date(ev.starts_at).toLocaleDateString(undefined, { month: "short" })}
                    </span>
                  </time>
                  <div className="event-info">
                    <h3>{ev.title}</h3>
                    {ev.location && <p>{ev.location}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      );
    }

    /* ============================================================ */
    /* FAQ                                                           */
    /* ============================================================ */
    case "faq": {
      const items = list(c, "items");
      return (
        <section className={`section${alt ? " alt" : ""} reveal`}>
          <div className="wrap">
            <div className="section-head center">
              <h2>{str(c, "heading")}</h2>
            </div>
            <div style={{ maxWidth: 720, margin: "0 auto" }}>
              {items.map((it, i) => (
                <details key={i} className="faq-item">
                  <summary>{str(it, "q")}</summary>
                  <div className="faq-body">{str(it, "a")}</div>
                </details>
              ))}
            </div>
          </div>
        </section>
      );
    }

    /* ============================================================ */
    /* ADMISSIONS CTA / CTA BANNER                                  */
    /* ============================================================ */
    case "admissions_cta":
    case "cta_banner":
      return (
        <section className="cta-band reveal">
          <div className="wrap">
            <h2>{str(c, "heading")}</h2>
            {str(c, "body") && <p>{str(c, "body")}</p>}
            <div className="cta-actions">
              {str(c, "cta_label") && (
                <a
                  href={link(str(c, "cta_href", "/admissions"))}
                  className="btn btn-primary"
                >
                  {str(c, "cta_label")}
                </a>
              )}
              {str(c, "secondary_label") && (
                <a
                  href={link(str(c, "secondary_href", "/contact"))}
                  className="btn btn-outline-light"
                >
                  {str(c, "secondary_label")}
                </a>
              )}
            </div>
          </div>
        </section>
      );

    /* ============================================================ */
    /* CONTACT                                                       */
    /* ============================================================ */
    case "contact": {
      const formKey = str(c, "form_key", "contact");
      const form = ctx.forms.find(f => f.key === formKey) ?? ctx.forms[0];
      const contact = ctx.site.contact ?? {};
      return (
        <section className="section reveal" id="contact">
          <div className="wrap">
            <div className="contact-grid">
              <div className="contact-info">
                <h2>{str(c, "heading", "Get in touch")}</h2>
                {str(c, "body") && <p>{str(c, "body")}</p>}
                {contact.address && (
                  <div className="info-row">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
                      <circle cx="12" cy="10" r="3" />
                    </svg>
                    <div>
                      <b>Address</b>
                      <address>{contact.address}</address>
                    </div>
                  </div>
                )}
                {contact.phone && (
                  <div className="info-row">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z" />
                    </svg>
                    <div>
                      <b>Telephone</b>
                      <a href={`tel:${contact.phone}`}>{contact.phone}</a>
                    </div>
                  </div>
                )}
                {contact.email && (
                  <div className="info-row">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                      <polyline points="22,6 12,13 2,6" />
                    </svg>
                    <div>
                      <b>Email</b>
                      <a href={`mailto:${contact.email}`}>{contact.email}</a>
                    </div>
                  </div>
                )}
                {contact.hours && (
                  <div className="info-row">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                    <div>
                      <b>Office hours</b>
                      <span>{contact.hours}</span>
                    </div>
                  </div>
                )}
                {bool(c, "show_map") && str(c, "map_embed_url") && (
                  <div className="video-wrap" style={{ marginTop: 24 }}>
                    <iframe
                      src={str(c, "map_embed_url")}
                      title="Map"
                      loading="lazy"
                    />
                  </div>
                )}
              </div>
              <div className="contact-form-box">
                {form ? (
                  <SiteForm form={form} websiteId={ctx.site.id} sourcePage={ctx.currentPath} />
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

    /* ============================================================ */
    /* MARQUEE BAND — slow scrolling claims strip                    */
    /* ============================================================ */
    case "marquee_band": {
      const items = list(c, "items").map(i => str(i, "label")).filter(Boolean);
      if (items.length === 0) return null;
      // Duplicated so the CSS translateX(-50%) loop is seamless.
      const doubled = [...items, ...items];
      return (
        <div
          className="marquee-band"
          aria-hidden="true"
          style={{ ["--marquee-speed" as string]: `${num(c, "speed", 30)}s` }}
        >
          <div className="marquee-track">
            {doubled.map((label, i) => (
              <span key={i} className="marquee-item">{label}</span>
            ))}
          </div>
        </div>
      );
    }

    /* ============================================================ */
    /* TRUST STRIP                                                   */
    /* ============================================================ */
    case "trust_strip": {
      const items = list(c, "items").map(i => str(i, "label")).filter(Boolean);
      if (items.length === 0) return null;
      return (
        <section className="section tight reveal">
          <div className="wrap">
            <div className="trust-strip on-light" style={{ marginTop: 0, justifyContent: "center" }}>
              {items.map((label, i) => (
                <span key={i} className="trust-chip">
                  <TickIcon />
                  {label}
                </span>
              ))}
            </div>
          </div>
        </section>
      );
    }

    /* ============================================================ */
    /* JOURNEY — numbered admissions steps                           */
    /* ============================================================ */
    case "journey": {
      const items = list(c, "items");
      if (items.length === 0) return null;
      return (
        <section className={`section${alt ? " alt" : ""} reveal`} id={anchor}>
          <div className="wrap">
            <div className="section-head center">
              {eyebrow && <p className="eyebrow">{eyebrow}</p>}
              <h2>{str(c, "heading")}</h2>
              {str(c, "body") && <p>{str(c, "body")}</p>}
            </div>
            <ol className="journey-track" style={{ listStyle: "none", padding: 0 }}>
              {items.map((it, i) => (
                <li
                  key={i}
                  className="journey-step reveal"
                  style={{ ["--reveal-delay" as string]: `${i * 0.08}s` }}
                >
                  <span className="journey-num" aria-hidden="true">{i + 1}</span>
                  <h3>{str(it, "title")}</h3>
                  <p>{str(it, "body")}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>
      );
    }

    /* ============================================================ */
    /* HOUSES — coloured roundels                                    */
    /* ============================================================ */
    case "houses": {
      const items = list(c, "items");
      if (items.length === 0) return null;
      return (
        <section className={`section${alt ? " alt" : ""} reveal`} id={anchor}>
          <div className="wrap">
            <div className="section-head center">
              {eyebrow && <p className="eyebrow">{eyebrow}</p>}
              <h2>{str(c, "heading")}</h2>
              {str(c, "body") && <p>{str(c, "body")}</p>}
            </div>
            <ul className="house-grid">
              {items.map((it, i) => {
                const name = str(it, "name");
                const color = str(it, "color") || "var(--c-primary)";
                return (
                  <li
                    key={i}
                    className="house-card reveal"
                    style={{ ["--reveal-delay" as string]: `${i * 0.08}s` }}
                  >
                    <div className="house-roundel" style={{ background: color }} aria-hidden="true">
                      <span>{name.toUpperCase()}</span>
                    </div>
                    <h3>{name}</h3>
                    <p>{str(it, "motto")}</p>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      );
    }

    /* ============================================================ */
    /* LEADERSHIP — portrait cards                                   */
    /* ============================================================ */
    case "leadership": {
      const items = list(c, "items").filter(it => str(it, "name") || str(it, "role"));
      if (items.length === 0) return null;
      return (
        <section className={`section${alt ? " alt" : ""} reveal`} id={anchor}>
          <div className="wrap">
            <div className="section-head center">
              {eyebrow && <p className="eyebrow">{eyebrow}</p>}
              <h2>{str(c, "heading")}</h2>
            </div>
            <ul className="leader-grid">
              {items.map((it, i) => {
                const name = str(it, "name");
                const img = str(it, "image_url");
                const initials = name
                  .split(/\s+/).filter(Boolean).slice(0, 2)
                  .map(w => w[0]?.toUpperCase() ?? "").join("");
                return (
                  <li
                    key={i}
                    className="leader-card reveal"
                    style={{ ["--reveal-delay" as string]: `${i * 0.07}s` }}
                  >
                    <div className="leader-avatar">
                      {img ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={img} alt={name ? `${name}, ${str(it, "role")}` : ""} loading="lazy" />
                      ) : (
                        <span className="initials" aria-hidden="true">{initials || "—"}</span>
                      )}
                    </div>
                    <h3>{name || "Name to follow"}</h3>
                    <p className="leader-role">{str(it, "role")}</p>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      );
    }

    /* ============================================================ */
    /* KEY DATES — hand-entered diary strip                          */
    /* ============================================================ */
    case "key_dates": {
      const items = list(c, "items");
      if (items.length === 0) return null;
      return (
        <section className={`section${alt ? " alt" : ""} reveal`} id={anchor}>
          <div className="wrap">
            <div className="section-head">
              {eyebrow && <p className="eyebrow">{eyebrow}</p>}
              <h2>{str(c, "heading")}</h2>
            </div>
            <ul className="key-dates">
              {items.map((it, i) => (
                <li
                  key={i}
                  className="key-date reveal"
                  style={{ ["--reveal-delay" as string]: `${i * 0.06}s` }}
                >
                  <div className="key-date-day" aria-hidden="true">
                    <b>{str(it, "day")}</b>
                    <span>{str(it, "month")}</span>
                  </div>
                  <div className="key-date-body">
                    <h3>{str(it, "title")}</h3>
                    {str(it, "detail") && <p>{str(it, "detail")}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      );
    }

    /* ============================================================ */
    /* NEWSLETTER — email capture band                               */
    /* ============================================================ */
    case "newsletter": {
      const formKey = str(c, "form_key", "newsletter");
      const form = ctx.forms.find(f => f.key === formKey);
      return (
        <section className="section reveal" id={anchor}>
          <div className="wrap">
            <div className="newsletter-band">
              <h2>{str(c, "heading", "Stay in the loop")}</h2>
              {str(c, "body") && <p>{str(c, "body")}</p>}
              {form ? (
                <SiteForm
                  form={form}
                  websiteId={ctx.site.id}
                  sourcePage={ctx.currentPath}
                  variant="inline"
                  submitLabel={str(c, "cta_label", "Subscribe")}
                />
              ) : (
                <p style={{ opacity: 0.8, fontSize: ".9rem" }}>
                  No newsletter form is configured yet.
                </p>
              )}
            </div>
          </div>
        </section>
      );
    }

    default:
      return null;
  }
}

function TickIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Shared sub-components                                               */
/* ------------------------------------------------------------------ */

function SectionImage({
  url,
  alt,
  style,
}: {
  url: string;
  alt: string;
  style?: React.CSSProperties;
}) {
  if (!url) {
    return (
      <div
        aria-hidden="true"
        style={{
          width: "100%",
          aspectRatio: "4/3",
          background: "var(--c-surface-alt)",
          borderRadius: "var(--r-md)",
          ...style,
        }}
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt}
      loading="lazy"
      style={{ width: "100%", objectFit: "cover", borderRadius: "var(--r-md)", ...style }}
    />
  );
}

function Prose({ text }: { text: string }) {
  if (!text) return null;
  return (
    <>
      {text.split(/\n{2,}|\n/).filter(Boolean).map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </>
  );
}
