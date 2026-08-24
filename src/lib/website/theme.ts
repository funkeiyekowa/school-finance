/**
 * Theme engine.
 *
 * A theme is data. Its tokens live in the website_themes table; a school's
 * brand overrides live on its own websites row. At render time the two are
 * merged and emitted as CSS custom properties, which every section component
 * reads. Adding a theme is an INSERT, not a code change, and no section
 * component ever hard-codes a colour.
 *
 * Merge order (later wins):
 *   theme.tokens  ->  site.brand  ->  site.typography (fonts only)
 */

import type { ThemeTokens, WebsiteTheme, PublicSite } from "./types";

/** Fonts the studio offers. Kept curated so every site stays fast and legible. */
export const FONT_LIBRARY = {
  sans: [
    "Inter", "Poppins", "Montserrat", "Open Sans", "Lato", "Nunito",
    "Work Sans", "Source Sans 3", "Space Grotesk", "DM Sans", "Manrope",
  ],
  serif: [
    "Playfair Display", "Merriweather", "Libre Baskerville", "Lora",
    "Cormorant Garamond", "Crimson Text", "Bitter", "Spectral",
  ],
} as const;

export const ALL_FONTS: string[] = [...FONT_LIBRARY.sans, ...FONT_LIBRARY.serif];

/** Every colour role the design system exposes. */
export const COLOR_ROLES = [
  { key: "primary", label: "Primary", hint: "Buttons, links and key accents" },
  { key: "primaryDark", label: "Primary (dark)", hint: "Hover states and deep fills" },
  { key: "secondary", label: "Secondary", hint: "Supporting highlights" },
  { key: "accent", label: "Accent", hint: "Calls to action and emphasis" },
  { key: "background", label: "Page background", hint: "Base canvas" },
  { key: "surface", label: "Surface", hint: "Cards and alternating bands" },
  { key: "surfaceAlt", label: "Surface (alt)", hint: "Second band colour" },
  { key: "text", label: "Body text", hint: "Main reading colour" },
  { key: "textMuted", label: "Muted text", hint: "Captions and secondary copy" },
  { key: "border", label: "Borders", hint: "Dividers and outlines" },
  { key: "headerBg", label: "Header background", hint: "Site navigation bar" },
  { key: "headerText", label: "Header text", hint: "Navigation labels" },
  { key: "footerBg", label: "Footer background", hint: "Footer band" },
  { key: "footerText", label: "Footer text", hint: "Footer copy" },
] as const;

/** Safety net so a half-configured theme still renders legibly. */
const FALLBACK: Required<Pick<ThemeTokens, "colors" | "fonts" | "scale" | "radius" | "spacing" | "button" | "shadow">> = {
  colors: {
    primary: "#0F2A47", primaryDark: "#0A1D33", secondary: "#1B3E63",
    accent: "#C9A227", background: "#FFFFFF", surface: "#F8FAFC",
    surfaceAlt: "#F1F5F9", text: "#0F172A", textMuted: "#64748B",
    border: "#E2E8F0", headerBg: "#FFFFFF", headerText: "#0F172A",
    footerBg: "#0F2A47", footerText: "#CBD5E1",
    success: "#16A34A", warning: "#D97706", error: "#DC2626",
  },
  fonts: { heading: "Poppins", body: "Inter", accent: "Inter" },
  scale: { h1: "3rem", h2: "2.125rem", h3: "1.5rem", body: "1rem" },
  radius: { sm: "0.375rem", md: "0.75rem", lg: "1.25rem", pill: "9999px" },
  spacing: { section: "5rem", gap: "1.5rem" },
  button: { radius: "0.75rem", weight: "600", transform: "none" },
  shadow: { card: "0 1px 3px rgba(15,23,42,.08)" },
};

/** camelCase token key -> kebab-case CSS variable name. */
function kebab(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

export interface ResolvedTheme {
  colors: Record<string, string>;
  fonts: { heading: string; body: string; accent: string };
  scale: Record<string, string>;
  radius: Record<string, string>;
  spacing: Record<string, string>;
  button: Record<string, string>;
  shadow: Record<string, string>;
  headerStyle: string;
  heroStyle: string;
}

/**
 * Merge theme tokens with the school's brand overrides.
 * Only non-empty override values win, so clearing a field in the studio
 * falls back to the theme rather than producing an empty colour.
 */
export function resolveTheme(
  theme: Partial<WebsiteTheme> | null | undefined,
  site?: Pick<PublicSite, "brand" | "typography"> | null
): ResolvedTheme {
  const t: ThemeTokens = theme?.tokens ?? {};
  const brand: ThemeTokens = site?.brand ?? {};
  const typo = site?.typography ?? {};

  const mergeGroup = (
    group: "colors" | "scale" | "radius" | "spacing" | "button" | "shadow"
  ): Record<string, string> => {
    const out: Record<string, string> = { ...FALLBACK[group], ...(t[group] ?? {}) };
    for (const [k, v] of Object.entries(brand[group] ?? {})) {
      if (typeof v === "string" && v.trim() !== "") out[k] = v;
    }
    return out;
  };

  const fonts = {
    heading: pick(typo.heading, brand.fonts?.heading, t.fonts?.heading, FALLBACK.fonts.heading!),
    body: pick(typo.body, brand.fonts?.body, t.fonts?.body, FALLBACK.fonts.body!),
    accent: pick(typo.accent, brand.fonts?.accent, t.fonts?.accent, FALLBACK.fonts.accent!),
  };

  return {
    colors: mergeGroup("colors"),
    fonts,
    scale: mergeGroup("scale"),
    radius: mergeGroup("radius"),
    spacing: mergeGroup("spacing"),
    button: mergeGroup("button"),
    shadow: mergeGroup("shadow"),
    headerStyle: pick(brand.headerStyle, t.headerStyle, "light"),
    heroStyle: pick(brand.heroStyle, t.heroStyle, "image-right"),
  };
}

function pick(...vals: (string | undefined)[]): string {
  for (const v of vals) if (typeof v === "string" && v.trim() !== "") return v.trim();
  return "";
}

/**
 * Emit the resolved theme as a comprehensive site stylesheet.
 * Includes CSS custom properties, base styles, component classes, and
 * responsive breakpoints. Scoped to a selector so the studio can preview
 * a theme without it bleeding into the dashboard chrome.
 */
export function themeToCss(theme: ResolvedTheme, selector = ".site-root"): string {
  const vars: string[] = [];

  for (const [k, v] of Object.entries(theme.colors)) vars.push(`--c-${kebab(k)}: ${v};`);
  for (const [k, v] of Object.entries(theme.scale))  vars.push(`--fs-${kebab(k)}: ${v};`);
  for (const [k, v] of Object.entries(theme.radius)) vars.push(`--r-${kebab(k)}: ${v};`);
  for (const [k, v] of Object.entries(theme.spacing))vars.push(`--sp-${kebab(k)}: ${v};`);
  for (const [k, v] of Object.entries(theme.button)) vars.push(`--btn-${kebab(k)}: ${v};`);
  for (const [k, v] of Object.entries(theme.shadow)) vars.push(`--sh-${kebab(k)}: ${v};`);

  vars.push(`--font-heading: ${cssFontStack(theme.fonts.heading)};`);
  vars.push(`--font-body: ${cssFontStack(theme.fonts.body)};`);
  vars.push(`--font-accent: ${cssFontStack(theme.fonts.accent)};`);

  // Derived tokens
  vars.push(`--sp-section-y: clamp(64px, 9vw, 128px);`);
  vars.push(`--container: 1180px;`);
  vars.push(`--ease: cubic-bezier(.22,.61,.32,1);`);
  vars.push(`--shadow-soft: 0 1px 2px rgba(15,23,42,.06), 0 14px 32px rgba(15,23,42,.10);`);
  vars.push(`--shadow-lift: 0 10px 20px rgba(15,23,42,.14), 0 28px 52px rgba(15,23,42,.14);`);

  const S = selector; // shorthand

  return `
/* ============ TOKENS ============ */
${S}{${vars.join("")}}

/* ============ BASE ============ */
${S}{
  min-height:100vh;display:flex;flex-direction:column;
  background:var(--c-background);color:var(--c-text);
  font-family:var(--font-body);font-size:1rem;line-height:1.65;
  -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;
}
${S} *,${S} *::before,${S} *::after{box-sizing:border-box;}
${S} h1,${S} h2,${S} h3,${S} h4{
  font-family:var(--font-heading);line-height:1.1;margin:0 0 .5em;font-weight:700;letter-spacing:-.01em;
}
${S} p{margin:0 0 1em;}
${S} img{max-width:100%;display:block;}
${S} a{color:inherit;}
${S} ul{margin:0;padding:0;list-style:none;}
${S} button{font:inherit;cursor:pointer;}
${S} address{font-style:normal;}

/* ============ LAYOUT ============ */
${S} .wrap{max-width:var(--container);margin:0 auto;padding:0 24px;}

/* ============ ACCESSIBILITY ============ */
${S} .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;}
${S} .skip-link{
  position:absolute;left:12px;top:-60px;z-index:1000;
  background:var(--c-accent);color:var(--c-text);font-weight:700;
  padding:.75em 1.25em;border-radius:var(--r-sm);
  transition:top .2s var(--ease);text-decoration:none;
}
${S} .skip-link:focus{top:12px;}
${S} :focus-visible{outline:3px solid var(--c-accent);outline-offset:3px;border-radius:4px;}

/* ============ EYEBROW ============ */
${S} .eyebrow{
  display:inline-flex;align-items:center;gap:.55em;
  font-family:var(--font-heading);font-weight:700;font-size:.78rem;
  letter-spacing:.14em;text-transform:uppercase;color:var(--c-accent);
}
${S} .eyebrow::before{content:'';width:22px;height:2px;background:var(--c-accent);border-radius:2px;}
${S} .eyebrow.on-dark{color:var(--c-accent);}
${S} .eyebrow.on-dark::before{background:var(--c-accent);}

/* ============ BUTTONS ============ */
${S} .btn{
  display:inline-flex;align-items:center;justify-content:center;gap:.5em;
  padding:.9em 1.6em;border-radius:var(--btn-radius);
  font-family:var(--font-body);font-weight:var(--btn-weight);font-size:.95rem;
  text-transform:var(--btn-transform);text-decoration:none;
  border:2px solid transparent;cursor:pointer;white-space:nowrap;
  transition:transform .18s var(--ease),box-shadow .18s var(--ease),background-color .18s var(--ease),color .18s var(--ease),border-color .18s var(--ease);
}
${S} .btn:hover{transform:translateY(-2px);}
${S} .btn:active{transform:translateY(0);}
${S} .btn[disabled]{opacity:.6;cursor:default;transform:none;}
${S} .btn-primary{background:var(--c-accent);color:var(--c-text);box-shadow:var(--shadow-soft);}
${S} .btn-primary:hover{box-shadow:var(--shadow-lift);filter:brightness(1.08);}
${S} .btn-outline{background:transparent;border-color:currentColor;color:inherit;}
${S} .btn-outline:hover{background:rgba(255,255,255,.08);border-color:currentColor;}
${S} .btn-accent{background:var(--c-primary);color:#fff;box-shadow:var(--shadow-soft);}
${S} .btn-accent:hover{box-shadow:var(--shadow-lift);filter:brightness(1.1);}
${S} .btn-ghost{background:transparent;color:var(--c-primary);padding:.9em 1.2em;border:none;}
${S} .btn-ghost:hover{background:var(--c-surface);}
${S} .btn-outline-light{background:transparent;border-color:rgba(255,255,255,.55);color:#fff;}
${S} .btn-outline-light:hover{background:rgba(255,255,255,.1);border-color:#fff;}
${S} .btn-sm{padding:.6em 1.1em;font-size:.85rem;}

/* ============ HEADER ============ */
${S} .site-header{
  position:sticky;top:0;z-index:100;
  background:var(--c-header-bg);color:var(--c-header-text);
  border-bottom:1px solid var(--c-border);
  transition:box-shadow .25s var(--ease);
}
${S} .site-header.is-scrolled{box-shadow:0 6px 24px rgba(15,23,42,.15);}
${S} .header-inner{
  display:flex;align-items:center;justify-content:space-between;gap:20px;
  max-width:var(--container);margin:0 auto;padding:14px 24px;
}
${S} .brand{display:flex;align-items:center;gap:12px;text-decoration:none;min-width:0;}
${S} .brand-mark{flex:none;height:42px;width:auto;}
${S} .brand-text{display:flex;flex-direction:column;line-height:1.15;min-width:0;}
${S} .brand-name{
  font-family:var(--font-heading);font-weight:700;font-size:1.08rem;white-space:nowrap;
}
${S} .brand-tag{font-size:.72rem;opacity:.72;white-space:nowrap;}

${S} .main-nav{display:none;}
${S} .main-nav ul{display:flex;align-items:center;gap:30px;list-style:none;padding:0;margin:0;}
${S} .main-nav a{
  font-size:.92rem;font-weight:600;text-decoration:none;
  padding:6px 2px;border-bottom:2px solid transparent;
  transition:border-color .18s var(--ease),opacity .18s var(--ease);opacity:.88;
}
${S} .main-nav a:hover{border-color:var(--c-accent);opacity:1;}
${S} .header-actions{display:flex;align-items:center;gap:10px;}
${S} .nav-toggle{
  display:inline-flex;align-items:center;justify-content:center;
  width:42px;height:42px;border-radius:var(--r-sm);
  background:transparent;border:1px solid rgba(255,255,255,.3);color:inherit;cursor:pointer;
}
${S} .nav-toggle svg{width:20px;height:20px;}
${S} .nav-toggle .icon-close{display:none;}
${S} .nav-toggle[aria-expanded="true"] .icon-open{display:none;}
${S} .nav-toggle[aria-expanded="true"] .icon-close{display:block;}

${S} .mobile-nav{
  display:none;background:var(--c-primary-dark,var(--c-primary));
  border-top:1px solid rgba(255,255,255,.12);
}
${S} .mobile-nav.is-open{display:block;}
${S} .mobile-nav ul{padding:8px 24px 18px;display:flex;flex-direction:column;list-style:none;margin:0;}
${S} .mobile-nav a{
  display:block;padding:12px 4px;color:#fff;text-decoration:none;
  font-weight:600;border-bottom:1px solid rgba(255,255,255,.08);
}
${S} .mobile-nav .btn{margin-top:14px;width:100%;}

@media (min-width:900px){
  ${S} .main-nav{display:block;}
  ${S} .nav-toggle{display:none;}
  ${S} .mobile-nav{display:none !important;}
}

/* ============ HERO ============ */
${S} .hero{
  position:relative;
  background:linear-gradient(175deg, var(--c-primary) 0%, var(--c-primary-dark,var(--c-primary)) 100%);
  color:#fff;overflow:hidden;
  padding:clamp(72px,12vw,132px) 0 clamp(88px,10vw,120px);
}
${S} .hero::before{
  content:'';position:absolute;inset:0;pointer-events:none;
  background-image:
    repeating-linear-gradient(45deg, rgba(255,255,255,.04) 0 2px, transparent 2px 30px),
    repeating-linear-gradient(-45deg, rgba(255,255,255,.04) 0 2px, transparent 2px 30px);
}
${S} .hero-inner{
  position:relative;z-index:1;max-width:var(--container);margin:0 auto;padding:0 24px;
  display:grid;gap:44px;grid-template-columns:1fr;align-items:center;
}
${S} .hero h1{
  font-size:clamp(2.35rem, 1.85rem + 2.6vw, 3.9rem);color:#fff;max-width:14ch;
  line-height:1.06;letter-spacing:-.02em;
}
${S} .hero h1 em{font-style:normal;color:var(--c-accent);}
${S} .hero-sub{font-size:1.12rem;color:rgba(255,255,255,.86);max-width:46ch;margin-bottom:1.75em;}
${S} .hero-ctas{display:flex;flex-wrap:wrap;gap:14px;margin-bottom:34px;}
${S} .hero-stats{
  display:flex;flex-wrap:wrap;gap:28px 40px;
  padding-top:26px;border-top:1px solid rgba(255,255,255,.16);
}
${S} .hero-stat b{display:block;font-family:var(--font-heading);font-size:1.5rem;color:var(--c-accent);}
${S} .hero-stat span{font-size:.82rem;color:rgba(255,255,255,.72);}
${S} .hero-panel{
  position:relative;aspect-ratio:1/1;border-radius:var(--r-lg);
  background:var(--c-primary-dark,var(--c-primary));
  border:1px solid rgba(255,255,255,.15);
  display:flex;align-items:center;justify-content:center;overflow:hidden;
  box-shadow:var(--shadow-lift);
}
${S} .hero-panel::before{
  content:'';position:absolute;inset:0;
  background-image:
    repeating-linear-gradient(45deg, rgba(255,255,255,.08) 0 2px, transparent 2px 20px),
    repeating-linear-gradient(-45deg, rgba(255,255,255,.08) 0 2px, transparent 2px 20px);
}

/* Hero centered variant */
${S} .hero--centered{text-align:center;}
${S} .hero--centered .hero-inner{display:block;max-width:800px;}
${S} .hero--centered h1{margin:0 auto 22px;max-width:16ch;}
${S} .hero--centered .hero-sub{margin:0 auto 40px;}
${S} .hero--centered .hero-ctas{justify-content:center;}
${S} .hero--centered .hero-stats{justify-content:center;}

@media (min-width:960px){
  ${S} .hero-inner{grid-template-columns:1.15fr .85fr;}
}

/* ============ SECTIONS ============ */
${S} .section{padding:var(--sp-section-y) 0;}
${S} .section.alt{background:var(--c-surface);}
${S} .section.alt2{background:var(--c-surface-alt);}
${S} .section-head{max-width:640px;margin-bottom:48px;}
${S} .section-head.center{margin-left:auto;margin-right:auto;text-align:center;}
${S} .section-head h2{
  font-size:clamp(1.7rem, 1.45rem + 1.1vw, 2.5rem);color:var(--c-text);margin-bottom:.35em;
}
${S} .section-head p{color:var(--c-text-muted);font-size:1.05rem;max-width:52ch;}
${S} .section-head.center p{margin-left:auto;margin-right:auto;}

/* ============ CARDS ============ */
${S} .card{
  background:var(--c-background);
  border:1px solid var(--c-border);
  border-radius:var(--r-md);
  padding:32px 28px;
  box-shadow:var(--sh-card);
  transition:transform .25s var(--ease),box-shadow .25s var(--ease),border-color .25s var(--ease);
}
${S} .card:hover{transform:translateY(-4px);box-shadow:var(--shadow-lift);border-color:var(--c-accent);}
${S} .card h3{font-family:var(--font-heading);font-weight:700;font-size:1.2rem;margin-bottom:.5em;}
${S} .card p{color:var(--c-text-muted);font-size:.95rem;line-height:1.6;margin:0;}
${S} .card-icon{width:44px;height:44px;color:var(--c-primary);margin-bottom:18px;}

/* ============ GRID LAYOUTS ============ */
${S} .grid-2{display:grid;gap:26px;grid-template-columns:1fr;}
${S} .grid-3{display:grid;gap:26px;grid-template-columns:1fr;}
${S} .grid-4{display:grid;gap:26px;grid-template-columns:1fr;}
@media (min-width:640px){
  ${S} .grid-2{grid-template-columns:repeat(2,1fr);}
  ${S} .grid-3{grid-template-columns:repeat(2,1fr);}
  ${S} .grid-4{grid-template-columns:repeat(2,1fr);}
}
@media (min-width:1024px){
  ${S} .grid-3{grid-template-columns:repeat(3,1fr);}
  ${S} .grid-4{grid-template-columns:repeat(4,1fr);}
}

/* ============ STATS BAND ============ */
${S} .stats-band{
  background:var(--c-primary);color:#fff;position:relative;overflow:hidden;
  padding:clamp(56px,7vw,84px) 0;
}
${S} .stats-band::before{
  content:'';position:absolute;inset:0;opacity:.08;
  background-image:
    repeating-linear-gradient(45deg, #fff 0 2px, transparent 2px 26px),
    repeating-linear-gradient(-45deg, #fff 0 2px, transparent 2px 26px);
}
${S} .stats-band .wrap{position:relative;}
${S} .stats-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:24px;text-align:center;}
${S} .stats-grid .stat-value{
  display:block;font-family:var(--font-heading);font-weight:700;
  font-size:clamp(2rem,4.4vw,3.25rem);color:var(--c-accent);line-height:1;margin-bottom:10px;
}
${S} .stats-grid .stat-label{font-size:.78rem;letter-spacing:.1em;text-transform:uppercase;opacity:.78;}
@media (min-width:768px){
  ${S} .stats-grid{grid-template-columns:repeat(4,1fr);}
}

/* ============ TESTIMONIALS ============ */
${S} .testimonial{position:relative;text-align:center;max-width:720px;margin:0 auto;padding:0 20px;}
${S} .testimonial .quote-mark{
  display:block;width:40px;height:32px;color:var(--c-accent);margin:0 auto 26px;opacity:.5;
}
${S} .testimonial blockquote{
  font-family:var(--font-heading);font-style:italic;font-weight:500;
  font-size:clamp(1.25rem,3vw,1.75rem);line-height:1.5;color:var(--c-primary);margin:0 0 26px;
}
${S} .testimonial cite{
  display:block;font-style:normal;font-size:.85rem;letter-spacing:.06em;
  text-transform:uppercase;color:var(--c-text-muted);font-weight:600;
}
${S} .testimonial-grid{display:grid;gap:26px;grid-template-columns:1fr;}
@media (min-width:768px){${S} .testimonial-grid{grid-template-columns:repeat(2,1fr);}}
@media (min-width:1024px){${S} .testimonial-grid{grid-template-columns:repeat(3,1fr);}}
${S} .testimonial-card{
  background:var(--c-background);border:1px solid var(--c-border);border-radius:var(--r-md);
  padding:28px;text-align:left;position:relative;
}
${S} .testimonial-card::before{
  content:'"';position:absolute;top:16px;right:20px;
  font-family:var(--font-heading);font-size:3rem;line-height:1;color:var(--c-accent);opacity:.25;
}
${S} .testimonial-card blockquote{
  font-family:var(--font-accent);font-size:1rem;line-height:1.6;color:var(--c-text);margin:0 0 16px;font-style:italic;
}
${S} .testimonial-card cite{font-style:normal;font-size:.85rem;font-weight:600;color:var(--c-text);}
${S} .testimonial-card .cite-role{display:block;font-weight:400;color:var(--c-text-muted);font-size:.8rem;margin-top:2px;}

/* ============ GALLERY ============ */
${S} .gallery-grid{display:grid;gap:12px;grid-template-columns:repeat(2,1fr);}
@media (min-width:640px){${S} .gallery-grid{grid-template-columns:repeat(3,1fr);}}
@media (min-width:1024px){${S} .gallery-grid{grid-template-columns:repeat(4,1fr);}}
${S} .gallery-grid img{
  width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:var(--r-sm);
  border:1px solid var(--c-border);transition:transform .25s var(--ease);
}
${S} .gallery-grid img:hover{transform:scale(1.03);}
${S} .gallery-tile{
  aspect-ratio:1/1;border-radius:var(--r-sm);border:1px solid var(--c-border);
  background:var(--c-surface);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;
  padding:16px;text-align:center;color:var(--c-text-muted);font-size:.82rem;
}

/* ============ CTA BAND ============ */
${S} .cta-band{
  background:var(--c-primary-dark,var(--c-primary));color:#fff;
  text-align:center;padding:var(--sp-section-y) 0;position:relative;overflow:hidden;
}
${S} .cta-band::before{
  content:'';position:absolute;inset:0;opacity:.06;
  background-image:
    repeating-linear-gradient(45deg, #fff 0 2px, transparent 2px 26px),
    repeating-linear-gradient(-45deg, #fff 0 2px, transparent 2px 26px);
}
${S} .cta-band .wrap{position:relative;}
${S} .cta-band h2{
  font-size:clamp(1.6rem,4vw,2.75rem);margin-bottom:16px;color:#fff;
}
${S} .cta-band p{color:rgba(255,255,255,.78);font-size:1.05rem;margin-bottom:34px;max-width:440px;margin-left:auto;margin-right:auto;}
${S} .cta-actions{display:flex;gap:16px;justify-content:center;flex-wrap:wrap;}

/* ============ CONTACT ============ */
${S} .contact-grid{display:grid;gap:48px;grid-template-columns:1fr;}
@media (min-width:768px){${S} .contact-grid{grid-template-columns:1fr 1.3fr;}}
${S} .contact-info h2{
  font-size:clamp(1.5rem,3.2vw,2rem);color:var(--c-primary);margin-bottom:14px;
}
${S} .contact-info p{color:var(--c-text-muted);font-size:.95rem;margin-bottom:28px;}
${S} .info-row{display:flex;gap:14px;padding:18px 0;border-top:1px solid var(--c-border);}
${S} .info-row:last-of-type{border-bottom:1px solid var(--c-border);}
${S} .info-row svg{width:20px;height:20px;color:var(--c-primary);flex-shrink:0;margin-top:2px;}
${S} .info-row b{display:block;font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;color:var(--c-accent);margin-bottom:4px;}
${S} .info-row address,${S} .info-row a{font-size:.95rem;color:var(--c-text);line-height:1.55;}
${S} .contact-form-box{
  background:var(--c-surface);border:1px solid var(--c-border);border-radius:var(--r-md);
  padding:clamp(24px,4vw,40px);
}
${S} .contact-form-box label{display:block;font-size:.78rem;font-weight:600;margin-bottom:6px;color:var(--c-text);}
${S} .contact-form-box input,${S} .contact-form-box textarea{
  width:100%;border:1px solid var(--c-border);border-radius:var(--r-sm);background:#fff;
  padding:12px 14px;font-size:.95rem;color:var(--c-text);font-family:var(--font-body);
}
${S} .contact-form-box input:focus,${S} .contact-form-box textarea:focus{border-color:var(--c-primary);outline:none;}
${S} .contact-form-box textarea{resize:vertical;min-height:120px;}

/* ============ FOOTER ============ */
${S} .site-footer{background:var(--c-footer-bg);color:var(--c-footer-text);padding:64px 0 0;}
${S} .footer-inner{
  max-width:var(--container);margin:0 auto;padding:0 24px;
  display:grid;gap:44px;grid-template-columns:1fr;padding-bottom:44px;
}
@media (min-width:768px){${S} .footer-inner{grid-template-columns:1.6fr 1fr 1fr;}}
${S} .footer-brand{display:flex;align-items:flex-start;gap:14px;}
${S} .footer-brand .brand-name{font-family:var(--font-heading);font-weight:700;font-size:1.15rem;}
${S} .footer-brand p{font-size:.85rem;line-height:1.7;margin-top:6px;opacity:.68;}
${S} .footer-col h3{
  font-size:.72rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;
  margin-bottom:14px;opacity:.6;
}
${S} .footer-col a{display:block;padding:4px 0;font-size:.9rem;text-decoration:none;opacity:.82;transition:opacity .15s;}
${S} .footer-col a:hover{opacity:1;text-decoration:underline;}
${S} .footer-bottom{
  border-top:1px solid rgba(255,255,255,.12);padding:18px 24px;
  max-width:var(--container);margin:0 auto;
  display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;
  font-size:.78rem;opacity:.55;
}
${S} .social-links{display:flex;gap:14px;}
${S} .social-links a{display:inline-flex;opacity:.7;transition:opacity .15s;}
${S} .social-links a:hover{opacity:1;}
${S} .social-links svg{width:18px;height:18px;}

/* ============ DIVIDER ============ */
${S} .weave-divider{
  height:28px;
  background-image:
    repeating-linear-gradient(45deg, var(--c-accent) 0 2px, transparent 2px 20px),
    repeating-linear-gradient(-45deg, var(--c-accent) 0 2px, transparent 2px 20px);
  opacity:.12;
  border-top:1px solid var(--c-border);border-bottom:1px solid var(--c-border);
}

/* ============ PROSE ============ */
${S} .prose{font-size:1rem;line-height:1.7;color:var(--c-text);}
${S} .prose p{margin:0 0 1em;}
${S} .prose strong{font-weight:600;}
${S} .prose ul{list-style:disc;padding-left:1.4em;margin:0 0 1em;}
${S} .prose li{margin-bottom:.4em;}

/* ============ SCROLL REVEAL ============ */
${S} .reveal{opacity:0;transform:translateY(22px);transition:opacity .6s var(--ease),transform .6s var(--ease);}
${S} .reveal.is-visible{opacity:1;transform:none;}
${S} .reveal-stagger > *{transition-delay:calc(var(--i,0) * 80ms);}

@media (prefers-reduced-motion:reduce){
  ${S} .reveal,${S} .reveal-stagger > *{opacity:1 !important;transform:none !important;transition:none !important;}
  ${S} .btn,${S} .card,${S} .mobile-nav,${S} .site-header{transition:none !important;}
}

/* ============ ABOUT / SPLIT LAYOUT ============ */
${S} .split{display:grid;gap:40px;align-items:center;grid-template-columns:1fr;}
@media (min-width:768px){${S} .split{grid-template-columns:1fr 1fr;}}
${S} .split--reverse{direction:rtl;}
${S} .split--reverse > *{direction:ltr;}
${S} .split img{width:100%;border-radius:var(--r-md);object-fit:cover;}

/* ============ FAQ ============ */
${S} .faq-item{border-bottom:1px solid var(--c-border);padding:20px 0;}
${S} .faq-item summary{
  cursor:pointer;font-weight:600;font-size:1.05rem;list-style:none;
  display:flex;align-items:center;justify-content:space-between;gap:12px;
}
${S} .faq-item summary::-webkit-details-marker{display:none;}
${S} .faq-item summary::after{
  content:'+';font-size:1.4rem;color:var(--c-accent);transition:transform .2s var(--ease);
}
${S} .faq-item[open] summary::after{content:'−';}
${S} .faq-item .faq-body{padding-top:12px;color:var(--c-text-muted);font-size:.95rem;line-height:1.7;}

/* ============ STAFF GRID ============ */
${S} .staff-grid{display:grid;gap:28px;grid-template-columns:repeat(2,1fr);}
@media (min-width:768px){${S} .staff-grid{grid-template-columns:repeat(3,1fr);}}
@media (min-width:1024px){${S} .staff-grid{grid-template-columns:repeat(4,1fr);}}
${S} .staff-card{text-align:center;}
${S} .staff-card img{
  width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:var(--r-md);
  border:1px solid var(--c-border);margin-bottom:12px;
}
${S} .staff-card .staff-name{font-weight:700;font-size:1rem;}
${S} .staff-card .staff-role{font-size:.82rem;color:var(--c-text-muted);}

/* ============ NEWS / EVENT CARDS ============ */
${S} .news-card{
  background:var(--c-background);border:1px solid var(--c-border);border-radius:var(--r-md);
  overflow:hidden;transition:transform .25s var(--ease),box-shadow .25s var(--ease);
}
${S} .news-card:hover{transform:translateY(-4px);box-shadow:var(--shadow-lift);}
${S} .news-card img{width:100%;aspect-ratio:16/9;object-fit:cover;}
${S} .news-card-body{padding:20px 24px;}
${S} .news-card-body .meta{font-size:.78rem;color:var(--c-text-muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px;}
${S} .news-card-body h3{font-family:var(--font-heading);font-size:1.1rem;font-weight:700;margin:0 0 8px;}
${S} .news-card-body h3 a{text-decoration:none;}
${S} .news-card-body h3 a:hover{text-decoration:underline;}
${S} .news-card-body p{font-size:.9rem;color:var(--c-text-muted);margin:0;}

${S} .event-item{
  display:flex;gap:16px;align-items:flex-start;
  padding:20px;border:1px solid var(--c-border);border-radius:var(--r-md);
  background:var(--c-background);transition:border-color .2s;
}
${S} .event-item:hover{border-color:var(--c-accent);}
${S} .event-date{
  flex-shrink:0;text-align:center;padding:10px 14px;
  background:var(--c-primary);color:#fff;border-radius:var(--r-sm);min-width:60px;
}
${S} .event-date .day{display:block;font-size:1.4rem;font-weight:700;line-height:1;}
${S} .event-date .month{display:block;font-size:.7rem;text-transform:uppercase;letter-spacing:.06em;margin-top:4px;}
${S} .event-info h3{font-family:var(--font-heading);font-size:1.05rem;font-weight:700;margin:0 0 4px;}
${S} .event-info p{font-size:.88rem;color:var(--c-text-muted);margin:0;}

/* ============ VIDEO ============ */
${S} .video-wrap{
  aspect-ratio:16/9;width:100%;overflow:hidden;border-radius:var(--r-md);
  border:1px solid var(--c-border);
}
${S} .video-wrap iframe{width:100%;height:100%;border:0;}
`.trim();
}

/** Quote font families that contain spaces and append a sane fallback. */
function cssFontStack(family: string): string {
  const isSerif = (FONT_LIBRARY.serif as readonly string[]).includes(family);
  const quoted = /\s/.test(family) ? `"${family}"` : family;
  return `${quoted}, ${isSerif ? "Georgia, serif" : "system-ui, -apple-system, Segoe UI, sans-serif"}`;
}

/**
 * Build a single Google Fonts stylesheet URL for the families in use.
 * One request for all families keeps the render fast.
 */
export function googleFontsHref(theme: ResolvedTheme): string | null {
  const families = Array.from(
    new Set([theme.fonts.heading, theme.fonts.body, theme.fonts.accent].filter(Boolean))
  ).filter(f => ALL_FONTS.includes(f));

  if (families.length === 0) return null;

  const params = families
    .map(f => `family=${encodeURIComponent(f).replace(/%20/g, "+")}:wght@400;500;600;700`)
    .join("&");

  return `https://fonts.googleapis.com/css2?${params}&display=swap`;
}

/**
 * Relative luminance, used to choose readable text over an arbitrary
 * brand colour instead of assuming white.
 */
export function readableTextOn(hex: string): string {
  const c = hex.replace("#", "");
  if (c.length !== 3 && c.length !== 6) return "#FFFFFF";
  const full = c.length === 3 ? c.split("").map(x => x + x).join("") : c;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const l = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return l > 0.5 ? "#111827" : "#FFFFFF";
}

/**
 * Contrast ratio between two hex colours (WCAG formula). The studio uses
 * this to warn when a brand override would make text hard to read.
 * Note: this checks colour contrast only — it is not a full accessibility
 * audit, which needs manual testing with assistive technology.
 */
export function contrastRatio(hexA: string, hexB: string): number {
  const lum = (hex: string): number => {
    const c = hex.replace("#", "");
    const full = c.length === 3 ? c.split("").map(x => x + x).join("") : c;
    if (full.length !== 6) return 0;
    const ch = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16) / 255);
    const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
    return 0.2126 * lin(ch[0]) + 0.7152 * lin(ch[1]) + 0.0722 * lin(ch[2]);
  };
  const a = lum(hexA), b = lum(hexB);
  const light = Math.max(a, b), dark = Math.min(a, b);
  return (light + 0.05) / (dark + 0.05);
}
