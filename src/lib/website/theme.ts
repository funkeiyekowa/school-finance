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
    primary: "#0F2A47", primaryDark: "#0A1D33", primaryDeeper: "#05101D",
    secondary: "#1B3E63", accent: "#C9A227", accentDeep: "#96760F", accentSoft: "#F4E9C7",
    background: "#FFFFFF", surface: "#F8FAFC",
    surfaceAlt: "#F1F5F9", text: "#0F172A", textMuted: "#64748B", textFaint: "#94A3B8",
    ink: "#0F172A", inkDeep: "#020617",
    border: "#E2E8F0", headerBg: "#FFFFFF", headerText: "#0F172A",
    footerBg: "#0F2A47", footerText: "#CBD5E1",
    success: "#16A34A", warning: "#D97706", error: "#DC2626",
  },
  fonts: { heading: "Poppins", body: "Inter", accent: "Inter" },
  scale: { h1: "3rem", h2: "2.125rem", h3: "1.5rem", body: "1rem", eyebrow: "0.75rem" },
  radius: { sm: "0.375rem", md: "0.75rem", lg: "1.25rem", xl: "1.75rem", pill: "9999px" },
  spacing: { section: "5rem", gap: "1.5rem", container: "1180px" },
  button: { radius: "0.75rem", weight: "600", transform: "none", borderWidth: "2px" },
  shadow: {
    soft: "0 1px 3px rgba(15,23,42,.08)",
    lift: "0 8px 24px rgba(15,23,42,.10)",
    premium: "0 20px 50px rgba(15,23,42,.16)",
    card: "0 1px 3px rgba(15,23,42,.08)",
  },
};

/** Structural options a theme can express beyond colour and type. */
export const MOTIF_OPTIONS = [
  { value: "none", label: "None", hint: "Flat surfaces" },
  { value: "weave", label: "Woven lattice", hint: "Diagonal diamond weave" },
  { value: "dots", label: "Dot grid", hint: "Subtle dotted texture" },
  { value: "grid", label: "Line grid", hint: "Technical grid lines" },
  { value: "rules", label: "Fine rules", hint: "Classic horizontal rules" },
  { value: "rings", label: "Concentric rings", hint: "Soft radial rings" },
] as const;

export const DIVIDER_OPTIONS = [
  { value: "none", label: "None", hint: "Hard edges" },
  { value: "curve", label: "Curve", hint: "Sweeping curved edge" },
  { value: "angle", label: "Angle", hint: "Diagonal slice" },
  { value: "weave", label: "Weave strip", hint: "Patterned band" },
  { value: "rule", label: "Rule", hint: "Thin line with ornament" },
] as const;

export const HERO_STYLE_OPTIONS = [
  { value: "badge-ring", label: "Badge ring", hint: "Crest medallion panel" },
  { value: "image-right", label: "Image right", hint: "Copy left, photo right" },
  { value: "centered", label: "Centred", hint: "Symmetrical, formal" },
  { value: "gradient", label: "Gradient glow", hint: "Dark with colour bloom" },
  { value: "full-bleed", label: "Full bleed", hint: "Edge-to-edge image" },
  { value: "split-diagonal", label: "Split diagonal", hint: "Angled two-tone split" },
] as const;

export const CARD_STYLE_OPTIONS = [
  { value: "soft", label: "Soft", hint: "Rounded with gentle shadow" },
  { value: "flat", label: "Flat", hint: "No shadow, no border" },
  { value: "bordered", label: "Bordered", hint: "Hairline outline" },
  { value: "elevated", label: "Elevated", hint: "Pronounced lift" },
  { value: "glass", label: "Glass", hint: "Translucent with glow ring" },
] as const;

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
  /** Background texture applied to motif-enabled sections. */
  motif: string;
  /** Shape of the transition between section bands. */
  divider: string;
  /** How cards are treated across the site. */
  cardStyle: string;
  /** Film-grain overlay for warmth. */
  grain: boolean;
  /** Whether reveal / count-up animations run. */
  animations: boolean;
  /** Whether the scrolling marquee band is available. */
  marquee: boolean;
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

  /** Booleans need explicit undefined checks — false is a real value. */
  const flag = (override: unknown, base: unknown, dflt: boolean): boolean => {
    if (typeof override === "boolean") return override;
    if (typeof base === "boolean") return base;
    return dflt;
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
    motif: pick(brand.motif, t.motif, "none"),
    divider: pick(brand.divider, t.divider, "none"),
    cardStyle: pick(brand.cardStyle, t.cardStyle, "soft"),
    grain: flag(brand.grain, t.grain, false),
    animations: flag(brand.animations, t.animations, true),
    marquee: flag(brand.marquee, t.marquee, false),
  };
}

/**
 * CSS for a motif texture. Returned as a background-image value so it can
 * be layered onto any section without extra markup.
 */
export function motifBackground(motif: string, color: string): string {
  switch (motif) {
    case "weave":
      return `repeating-linear-gradient(45deg, ${color} 0 2px, transparent 2px 26px), repeating-linear-gradient(-45deg, ${color} 0 2px, transparent 2px 26px)`;
    case "dots":
      return `radial-gradient(${color} 1.5px, transparent 1.5px)`;
    case "grid":
      return `linear-gradient(${color} 1px, transparent 1px), linear-gradient(90deg, ${color} 1px, transparent 1px)`;
    case "rules":
      return `repeating-linear-gradient(0deg, ${color} 0 1px, transparent 1px 8px)`;
    case "rings":
      return `repeating-radial-gradient(circle at 50% 50%, ${color} 0 1px, transparent 1px 22px)`;
    default:
      return "none";
  }
}

/** Matching background-size for each motif. */
export function motifSize(motif: string): string {
  switch (motif) {
    case "dots": return "22px 22px";
    case "grid": return "44px 44px";
    case "rings": return "180px 180px";
    default: return "auto";
  }
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
  vars.push(`--sp-section-y: ${theme.spacing.section ?? "clamp(64px, 9vw, 128px)"};`);
  vars.push(`--container: ${theme.spacing.container ?? "1180px"};`);
  vars.push(`--ease: cubic-bezier(.22,.61,.32,1);`);
  vars.push(`--shadow-soft: ${theme.shadow.soft ?? "0 1px 2px rgba(15,23,42,.06), 0 14px 32px rgba(15,23,42,.10)"};`);
  vars.push(`--shadow-lift: ${theme.shadow.lift ?? "0 10px 20px rgba(15,23,42,.14), 0 28px 52px rgba(15,23,42,.14)"};`);
  vars.push(`--shadow-premium: ${theme.shadow.premium ?? "0 20px 50px rgba(15,23,42,.20)"};`);

  // Motif texture, ready to layer onto any section
  const motifColor = withAlpha(theme.colors.accent ?? "#000000", 0.13);
  vars.push(`--motif-image: ${motifBackground(theme.motif, motifColor)};`);
  vars.push(`--motif-size: ${motifSize(theme.motif)};`);

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
${S} .btn-primary,${S} .btn-gold{background:var(--c-accent);color:var(--c-text);box-shadow:var(--shadow-soft);}
${S} .btn-primary:hover,${S} .btn-gold:hover{box-shadow:var(--shadow-lift);filter:brightness(1.08);}
${S} .btn-outline{background:transparent;border-color:currentColor;color:inherit;}
${S} .btn-outline:hover{background:rgba(255,255,255,.08);border-color:currentColor;}
${S} .btn-accent{background:var(--c-primary);color:#fff;box-shadow:var(--shadow-soft);}
${S} .btn-accent:hover{box-shadow:var(--shadow-lift);filter:brightness(1.1);}
${S} .btn-ghost{background:transparent;color:var(--c-primary);padding:.9em 1.2em;border:none;}
${S} .btn-ghost:hover{background:var(--c-surface);}
${S} .btn-outline-light{background:transparent;border-color:rgba(255,255,255,.55);color:#fff;}
${S} .btn-outline-light:hover{background:rgba(255,255,255,.1);border-color:#fff;}
${S} .btn-terracotta{background:var(--c-secondary,var(--c-primary-dark,var(--c-primary)));color:#fff;box-shadow:var(--shadow-soft);}
${S} .btn-terracotta:hover{box-shadow:var(--shadow-lift);filter:brightness(1.12);}
${S} .btn-outline-ink{background:transparent;border-color:var(--c-text);color:var(--c-text);}
${S} .btn-outline-ink:hover{background:var(--c-text);color:#fff;}
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

/* --- Header style: LIGHT --- */
${S}[data-header-style="light"] .site-header{background:var(--c-background);color:var(--c-text);border-bottom-color:var(--c-border);}
${S}[data-header-style="light"] .main-nav a{color:var(--c-text);}
${S}[data-header-style="light"] .main-nav a:hover{border-color:var(--c-primary);}
${S}[data-header-style="light"] .nav-toggle{border-color:var(--c-border);color:var(--c-text);}
${S}[data-header-style="light"] .mobile-nav{background:var(--c-surface);border-top-color:var(--c-border);}
${S}[data-header-style="light"] .mobile-nav a{color:var(--c-text);border-bottom-color:var(--c-border);}

/* --- Header style: DARK (default — primary color bg, white text) --- */
${S}[data-header-style="dark"] .site-header{background:var(--c-primary);color:#fff;border-bottom-color:rgba(255,255,255,.12);}
${S}[data-header-style="dark"] .nav-toggle{border-color:rgba(255,255,255,.3);color:#fff;}

/* --- Header style: MINIMAL — transparent until scrolled --- */
${S}[data-header-style="minimal"] .site-header{background:transparent;color:#fff;border-bottom-color:transparent;}
${S}[data-header-style="minimal"] .site-header.is-scrolled{background:var(--c-primary);border-bottom-color:rgba(255,255,255,.12);}
${S}[data-header-style="minimal"] .nav-toggle{border-color:rgba(255,255,255,.3);color:#fff;}

/* ============ HERO ============ */
${S} .hero{
  position:relative;
  background:linear-gradient(175deg, var(--c-primary) 0%, var(--c-primary-dark,var(--c-primary)) 100%);
  color:#fff;overflow:hidden;
  padding:clamp(72px,12vw,132px) 0 clamp(88px,10vw,120px);
}
${S} .hero::before{
  content:'';position:absolute;inset:0;pointer-events:none;
  background-image:var(--motif-image);
  background-size:var(--motif-size);
  transform:translateY(var(--hero-parallax,0px));
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

/* --- Hero style: IMAGE-RIGHT (default at 960px+, no override needed) --- */

/* --- Hero style: CENTERED --- overrides grid to single column centered */
${S}[data-hero-style="centered"] .hero{text-align:center;}
${S}[data-hero-style="centered"] .hero-inner{display:block;max-width:800px;}
${S}[data-hero-style="centered"] .hero h1{margin:0 auto 22px;max-width:16ch;}
${S}[data-hero-style="centered"] .hero-sub{margin:0 auto 40px;}
${S}[data-hero-style="centered"] .hero-ctas{justify-content:center;}
${S}[data-hero-style="centered"] .hero-stats{justify-content:center;}
${S}[data-hero-style="centered"] .hero-panel{display:none;}

/* --- Hero style: FULL-BLEED — image covers entire background --- */
${S}[data-hero-style="full-bleed"] .hero{background:var(--c-primary);padding:0;}
${S}[data-hero-style="full-bleed"] .hero::before{display:none;}
${S}[data-hero-style="full-bleed"] .hero-inner{max-width:none;padding:0;grid-template-columns:1fr !important;position:relative;min-height:70vh;display:flex;align-items:center;justify-content:center;}
${S}[data-hero-style="full-bleed"] .hero-panel{position:absolute;inset:0;border-radius:0;border:none;aspect-ratio:auto;}
${S}[data-hero-style="full-bleed"] .hero-panel img{width:100%;height:100%;object-fit:cover;opacity:.35;}
${S}[data-hero-style="full-bleed"] .hero-content{position:relative;z-index:2;text-align:center;padding:clamp(48px,8vw,100px) 24px;}
${S}[data-hero-style="full-bleed"] .hero h1{max-width:16ch;margin:0 auto .5em;text-align:center;}
${S}[data-hero-style="full-bleed"] .hero-sub{margin:0 auto 1.75em;text-align:center;}
${S}[data-hero-style="full-bleed"] .hero-ctas{justify-content:center;}

/* --- Hero style: GRADIENT — no image, bold gradient + pattern --- */
${S}[data-hero-style="gradient"] .hero{
  background:linear-gradient(135deg, var(--c-primary) 0%, var(--c-primary-dark,var(--c-primary)) 50%, var(--c-secondary,var(--c-primary)) 100%);
}
${S}[data-hero-style="gradient"] .hero-panel{display:none;}
${S}[data-hero-style="gradient"] .hero-inner{grid-template-columns:1fr !important;text-align:center;max-width:800px;}
${S}[data-hero-style="gradient"] .hero h1{max-width:16ch;margin:0 auto .5em;}
${S}[data-hero-style="gradient"] .hero-sub{margin:0 auto 1.75em;}
${S}[data-hero-style="gradient"] .hero-ctas{justify-content:center;}

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

/* ============ CURVE DIVIDERS (stats band top/bottom) ============ */
${S} .curve-divider{position:absolute;left:0;width:100%;height:56px;line-height:0;z-index:2;pointer-events:none;}
${S} .curve-divider.top{top:-1px;}
${S} .curve-divider.bottom{bottom:-1px;transform:scaleY(-1);}
${S} .curve-divider svg{width:100%;height:100%;display:block;}
${S} .curve-fill-background{fill:var(--c-background);}
${S} .curve-fill-surface{fill:var(--c-surface);}
@media (min-width:720px){${S} .curve-divider{height:80px;}}

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

/* ============ TESTIMONIAL CAROUSEL ============ */
${S} .testimonial-carousel{max-width:760px;margin:0 auto;text-align:center;position:relative;}
${S} .testimonial-viewport{position:relative;min-height:150px;}
${S} .testimonial-slide{
  position:absolute;inset:0;opacity:0;transform:translateY(10px);
  transition:opacity .45s var(--ease),transform .45s var(--ease);pointer-events:none;
}
${S} .testimonial-slide.is-active{opacity:1;transform:none;pointer-events:auto;position:relative;}
${S} .testimonial-slide blockquote{
  margin:0 0 18px;font-family:var(--font-heading);font-weight:600;
  font-size:clamp(1.2rem,1.05rem + .6vw,1.6rem);line-height:1.35;color:var(--c-primary);
}
${S} .testimonial-slide cite{font-style:normal;color:var(--c-text-muted);font-weight:600;font-size:.92rem;}
${S} .carousel-controls{display:flex;align-items:center;justify-content:center;gap:18px;margin-top:22px;}
${S} .carousel-arrow{
  width:38px;height:38px;border-radius:50%;border:1px solid var(--c-border);background:var(--c-background);
  color:var(--c-primary);display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;
}
${S} .carousel-arrow:hover{background:var(--c-surface);}
${S} .carousel-arrow svg{width:16px;height:16px;}
${S} .carousel-dots{display:flex;gap:8px;}
${S} .carousel-dot{width:8px;height:8px;border-radius:50%;border:none;background:var(--c-border);padding:0;cursor:pointer;}
${S} .carousel-dot.is-active{background:var(--c-accent);width:22px;border-radius:var(--r-pill);transition:width .25s var(--ease),background .25s var(--ease);}

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
${S} .gallery-tile.is-placeholder{
  position:relative;aspect-ratio:4/5;border:none;display:flex;align-items:flex-end;justify-content:flex-start;
  padding:0;overflow:hidden;box-shadow:var(--sh-card);
  background-image:
    repeating-linear-gradient(45deg, rgba(255,255,255,.24) 0 2px, transparent 2px 22px),
    repeating-linear-gradient(-45deg, rgba(255,255,255,.24) 0 2px, transparent 2px 22px);
}
${S} .gallery-tile.is-placeholder.t1{background-color:var(--c-secondary,var(--c-primary));}
${S} .gallery-tile.is-placeholder.t2{background-color:var(--c-primary);}
${S} .gallery-tile.is-placeholder.t3{background-color:var(--c-accent);}
${S} .gallery-tile.is-placeholder.t3 .tile-caption{color:var(--c-ink-deep,var(--c-text));background:linear-gradient(180deg,transparent,rgba(0,0,0,.18));}
${S} .gallery-tile.is-placeholder.t4{background-color:var(--c-primary-deeper,var(--c-primary-dark,var(--c-primary)));}
${S} .gallery-tile.is-placeholder .tile-caption{
  display:block;width:100%;padding:14px;color:#fff;font-size:.8rem;font-weight:700;letter-spacing:.02em;
  background:linear-gradient(180deg,transparent,rgba(0,0,0,.32));
}
${S} .gallery-season{
  position:absolute;top:12px;left:12px;z-index:1;background:rgba(0,0,0,.45);color:#fff;
  font-size:.68rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:.3em .7em;border-radius:var(--r-pill);
}
${S} .gallery-note{margin-top:22px;display:flex;align-items:center;gap:10px;color:var(--c-text-muted);font-size:.92rem;}
${S} .gallery-note svg{flex:none;width:18px;height:18px;color:var(--c-accent);}
${S} .gallery-note a{color:var(--c-primary);font-weight:700;}

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
${S} .news-card--empty{
  border:1px dashed var(--c-border);border-radius:var(--r-lg);padding:44px 32px;text-align:center;
  background:
    repeating-linear-gradient(45deg, var(--c-surface-alt) 0 2px, transparent 2px 26px),
    repeating-linear-gradient(-45deg, var(--c-surface-alt) 0 2px, transparent 2px 26px),
    var(--c-background);
}
${S} .news-card--empty .icon-badge{
  margin:0 auto 18px;width:52px;height:52px;border-radius:var(--r-sm);
  background:var(--c-surface-alt);color:var(--c-primary);
  display:flex;align-items:center;justify-content:center;
}
${S} .news-card--empty .icon-badge svg{width:26px;height:26px;}
${S} .news-card--empty h3{font-size:1.3rem;margin-bottom:.4em;}
${S} .news-card--empty p{color:var(--c-text-muted);max-width:44ch;margin:0 auto;}
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

/* ============ MOTIF / TEXTURE ============ */
${S} .has-motif{
  background-image:var(--motif-image);
  background-size:var(--motif-size);
}

/* ============ PER-SECTION OVERRIDES ============ */
/* When a school overrides a section's band, the wrapper owns the padding
   and background so the inner <section> must not paint its own. */
${S} .section-override{position:relative;}
${S} .section-override>.section{background:transparent !important;padding-top:0;padding-bottom:0;}
${S} .section-override[data-tone="primary"] h1,
${S} .section-override[data-tone="primary"] h2,
${S} .section-override[data-tone="primary"] h3,
${S} .section-override[data-tone="primaryDark"] h1,
${S} .section-override[data-tone="primaryDark"] h2,
${S} .section-override[data-tone="primaryDark"] h3,
${S} .section-override[data-tone="ink"] h1,
${S} .section-override[data-tone="ink"] h2,
${S} .section-override[data-tone="ink"] h3{color:#fff;}
${S} .section-override[data-tone="primary"] p,
${S} .section-override[data-tone="primaryDark"] p,
${S} .section-override[data-tone="ink"] p{color:rgba(255,255,255,.82);}
${S} .section-override.full-bleed>.section>.wrap{max-width:none;padding-inline:0;}
${theme.grain ? `
${S} .grain-overlay{
  position:fixed;inset:0;pointer-events:none;z-index:1;opacity:.04;mix-blend-mode:multiply;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.82' numOctaves='3'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)'/%3E%3C/svg%3E");
}` : ""}

/* ============ REVEAL ANIMATIONS ============ */
${theme.animations ? `
${S} .reveal{opacity:0;transform:translateY(20px);
  transition:opacity .75s var(--ease) var(--reveal-delay,0s),transform .75s var(--ease) var(--reveal-delay,0s);}
${S} .reveal.is-visible,${S} .reveal.is-in{opacity:1;transform:none;}
@media (prefers-reduced-motion:reduce){
  ${S} .reveal,.reveal.is-visible{opacity:1 !important;transform:none !important;transition:none !important;}
}` : `${S} .reveal{opacity:1;transform:none;}`}

/* ============ CURVE / ANGLE DIVIDERS ============ */
${S} .divider-curve{position:relative;}
${S} .divider-curve>svg{display:block;width:100%;height:70px;}
${S} .divider-curve.top>svg{margin-bottom:-1px;}
${S} .divider-curve.bottom>svg{margin-top:-1px;}
${S} .divider-angle{clip-path:polygon(0 0,100% 3.5vw,100% 100%,0 calc(100% - 3.5vw));}
${S} .divider-rule{
  height:1px;background:var(--c-border);position:relative;
}
${S} .divider-rule::after{
  content:'';position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) rotate(45deg);
  width:9px;height:9px;background:var(--c-accent);
}
${S} .weave-divider{
  height:34px;border-top:1px solid var(--c-border);border-bottom:1px solid var(--c-border);
  background-color:var(--c-background);background-size:40px 40px;
  background-image:
    repeating-linear-gradient(45deg,var(--c-primary) 0 3px,transparent 3px 20px),
    repeating-linear-gradient(-45deg,var(--c-primary) 0 3px,transparent 3px 20px);
  opacity:.35;
}

/* ============ MARQUEE BAND ============ */
@keyframes site-marquee{from{transform:translateX(0)}to{transform:translateX(-50%)}}
${S} .marquee-band{
  overflow:hidden;background:var(--c-primary-dark,var(--c-primary));
  color:var(--c-accent-soft,#fff);padding:14px 0;
  border-top:1px solid rgba(255,255,255,.10);border-bottom:1px solid rgba(255,255,255,.10);
}
${S} .marquee-track{
  display:flex;gap:2.5rem;width:max-content;
  animation:site-marquee var(--marquee-speed,30s) linear infinite;
}
${S} .marquee-item{
  display:inline-flex;align-items:center;gap:.6em;white-space:nowrap;
  font-family:var(--font-heading);font-weight:700;font-size:.82rem;
  letter-spacing:.12em;text-transform:uppercase;
}
${S} .marquee-item::before{
  content:'';width:6px;height:6px;border-radius:50%;background:var(--c-accent);flex-shrink:0;
}
@media (prefers-reduced-motion:reduce){${S} .marquee-track{animation:none;}}

/* ============ TRUST STRIP ============ */
${S} .trust-strip{display:flex;flex-wrap:wrap;gap:10px;margin-top:26px;}
${S} .trust-chip{
  display:inline-flex;align-items:center;gap:.5em;
  padding:.45em 1em;border-radius:var(--r-pill);
  background:rgba(255,255,255,.10);border:1px solid rgba(255,255,255,.20);
  font-size:.8rem;font-weight:600;
}
${S} .trust-chip svg{width:14px;height:14px;flex-shrink:0;color:var(--c-accent);}
${S} .trust-strip.on-light .trust-chip{
  background:var(--c-surface);border-color:var(--c-border);color:var(--c-text);
}

/* ============ HERO BADGE RING ============ */
${S} .hero-panel{display:none;}
@media (min-width:1024px){${S} .hero-panel{display:grid;place-items:center;}}
${S} .badge-ring{
  width:min(340px,86%);aspect-ratio:1;border-radius:50%;
  display:grid;place-content:center;text-align:center;gap:6px;
  border:2px solid var(--c-accent);
  /* Solid fill — the woven/motif texture belongs on the outer .hero-panel
     behind it (via ::before), not on the badge face itself. A textured
     badge reads as muddy and makes the initials harder to see. */
  background:var(--c-primary-dark,var(--c-primary));
  box-shadow:0 0 0 12px rgba(255,255,255,.05),var(--shadow-premium);
  animation:heroFloatY 5.5s ease-in-out infinite;
}
@keyframes heroFloatY{0%,100%{transform:translateY(0);}50%{transform:translateY(-10px);}}
@media (prefers-reduced-motion:reduce){${S} .badge-ring{animation:none;}}
${S} .badge-ring strong{
  font-family:var(--font-heading);font-size:3.4rem;line-height:1;
  color:var(--c-accent);letter-spacing:.02em;
}
${S} .badge-ring span{
  font-size:.72rem;letter-spacing:.18em;text-transform:uppercase;
  color:rgba(255,255,255,.72);
}

/* ============ SCROLL PROGRESS BAR ============ */
${S} .scroll-progress{
  position:fixed;top:0;left:0;height:3px;width:0%;z-index:999;
  background:linear-gradient(90deg, var(--c-accent), var(--c-accent-soft, var(--c-accent)));
  transition:width .08s linear;pointer-events:none;
}

/* ============ SCROLL CUE ============ */
@keyframes cue-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(6px)}}
${S} .scroll-cue{
  position:absolute;left:50%;bottom:22px;transform:translateX(-50%);
  width:38px;height:38px;border-radius:50%;display:grid;place-items:center;
  border:1px solid rgba(255,255,255,.3);color:#fff;text-decoration:none;
  animation:cue-bob 2.2s ease-in-out infinite;
}
${S} .scroll-cue svg{width:18px;height:18px;}
@media (prefers-reduced-motion:reduce){${S} .scroll-cue{animation:none;}}

/* ============ PROGRAMME TRACK (numbered) ============ */
${S} .programme-track{display:grid;gap:20px;}
@media (min-width:768px){${S} .programme-track{grid-template-columns:repeat(3,1fr);}}
${S} .programme-card{
  position:relative;padding:32px 26px 26px;border-radius:var(--r-lg);
  background:var(--c-background);border:1px solid var(--c-border);
  box-shadow:var(--sh-card);
}
${S} .programme-stage{
  position:absolute;top:-18px;left:26px;
  width:44px;height:44px;border-radius:50%;display:grid;place-items:center;
  background:var(--c-accent);color:var(--c-primary-deeper,var(--c-primary));
  font-family:var(--font-heading);font-weight:800;font-size:1.15rem;
  box-shadow:var(--shadow-soft);
}
${S} .programme-card h3{margin-top:12px;font-size:1.2rem;}
${S} .programme-card p{color:var(--c-text-muted);font-size:.95rem;margin:0;}
${S} .programme-arrow{
  position:absolute;top:50%;right:-24px;transform:translateY(-50%);
  color:var(--c-accent);display:none;
}
@media (min-width:768px){${S} .programme-arrow{display:block;}}
${S} .programme-arrow svg{width:22px;height:22px;}

/* ============ JOURNEY (admissions steps) ============ */
${S} .journey-track{display:grid;gap:26px;position:relative;}
@media (min-width:900px){
  ${S} .journey-track{grid-template-columns:repeat(5,1fr);}
  ${S} .journey-track::before{
    content:'';position:absolute;top:22px;left:8%;right:8%;height:2px;
    background:linear-gradient(90deg,var(--c-accent),var(--c-border));
  }
}
${S} .journey-step{position:relative;text-align:center;}
${S} .journey-num{
  width:46px;height:46px;margin:0 auto 16px;border-radius:50%;
  display:grid;place-items:center;position:relative;z-index:1;
  background:var(--c-primary);color:#fff;
  font-family:var(--font-heading);font-weight:800;font-size:1.1rem;
  border:3px solid var(--c-background);box-shadow:var(--shadow-soft);
}
${S} .journey-step h3{font-size:1.05rem;margin-bottom:.35em;}
${S} .journey-step p{font-size:.88rem;color:var(--c-text-muted);margin:0;}

/* ============ HOUSES ============ */
${S} .house-grid{display:grid;gap:22px;grid-template-columns:repeat(2,1fr);}
@media (min-width:900px){${S} .house-grid{grid-template-columns:repeat(4,1fr);}}
${S} .house-card{text-align:center;}
${S} .house-roundel{
  width:96px;height:96px;margin:0 auto 16px;border-radius:50%;
  display:grid;place-items:center;color:#fff;
  font-family:var(--font-heading);font-weight:800;font-size:.62rem;
  letter-spacing:.1em;box-shadow:var(--shadow-lift);
  border:3px solid var(--c-background);
}
${S} .house-card h3{font-size:1.1rem;margin-bottom:.25em;}
${S} .house-card p{font-size:.85rem;color:var(--c-text-muted);margin:0;}

/* ============ LEADERSHIP ============ */
${S} .leader-grid{display:grid;gap:24px;grid-template-columns:repeat(2,1fr);}
@media (min-width:900px){${S} .leader-grid{grid-template-columns:repeat(4,1fr);}}
${S} .leader-card{text-align:center;}
${S} .leader-avatar{
  width:100%;aspect-ratio:3/4;border-radius:var(--r-md);overflow:hidden;
  background:var(--c-surface-alt);margin-bottom:14px;
  display:grid;place-items:center;
  border:1px solid var(--c-border);
}
${S} .leader-avatar img{width:100%;height:100%;object-fit:cover;}
${S} .leader-avatar .initials{
  font-family:var(--font-heading);font-size:2rem;font-weight:700;color:var(--c-accent);
}
${S} .leader-card h3{font-size:1rem;margin-bottom:.15em;}
${S} .leader-role{font-size:.82rem;color:var(--c-text-muted);}

/* ============ KEY DATES ============ */
${S} .key-dates{display:grid;gap:14px;}
${S} .key-date{
  display:flex;align-items:center;gap:18px;padding:16px 20px;
  border-radius:var(--r-md);background:var(--c-background);
  border:1px solid var(--c-border);
}
${S} .key-date-day{
  flex-shrink:0;width:60px;text-align:center;padding:8px 0;
  border-radius:var(--r-sm);background:var(--c-primary);color:#fff;
}
${S} .key-date-day b{display:block;font-family:var(--font-heading);font-size:1.4rem;line-height:1;}
${S} .key-date-day span{display:block;font-size:.68rem;text-transform:uppercase;letter-spacing:.08em;margin-top:3px;}
${S} .key-date-body h3{font-size:1rem;margin-bottom:.15em;}
${S} .key-date-body p{font-size:.85rem;color:var(--c-text-muted);margin:0;}

/* ============ NEWSLETTER BAND ============ */
${S} .newsletter-band{
  border-radius:var(--r-lg);padding:38px 32px;
  background:var(--c-primary);color:#fff;text-align:center;
  background-image:var(--motif-image);background-size:var(--motif-size);
}
${S} .newsletter-band h2{color:#fff;}
${S} .newsletter-band p{color:rgba(255,255,255,.82);max-width:46ch;margin:0 auto 22px;}
${S} .newsletter-form{
  display:flex;gap:10px;max-width:440px;margin:0 auto;flex-wrap:wrap;
}
${S} .newsletter-form input{
  flex:1;min-width:200px;padding:.85em 1.1em;border-radius:var(--btn-radius);
  border:1px solid rgba(255,255,255,.28);background:rgba(255,255,255,.12);
  color:#fff;font:inherit;
}
${S} .newsletter-form input::placeholder{color:rgba(255,255,255,.60);}

${theme.animations ? `
/* ============ PRELOADER ============ */
${S} .site-preloader{
  position:fixed;inset:0;z-index:999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;
  background:radial-gradient(120% 120% at 50% 28%, var(--c-primary) 0%, var(--c-primary-deeper,var(--c-primary-dark,var(--c-primary))) 100%);
  transition:opacity .5s var(--ease), visibility 0s linear .5s;
}
${S} .site-preloader.is-hidden{opacity:0;visibility:hidden;pointer-events:none;}
${S} .preloader-mark{
  position:relative;width:80px;height:80px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  background:var(--c-primary-dark,var(--c-primary));border:2px solid var(--c-accent);
  animation:preloaderPulse 1.7s ease-in-out infinite;
}
${S} .preloader-mark::before{content:'';position:absolute;inset:-12px;border-radius:50%;border:1px dashed rgba(255,255,255,.35);animation:preloaderSpin 9s linear infinite;}
${S} .preloader-mark strong{font-family:var(--font-heading);font-size:1.7rem;color:var(--c-accent);}
${S} .preloader-word{font-family:var(--font-heading);font-weight:700;letter-spacing:.1em;text-transform:uppercase;font-size:.72rem;color:rgba(255,255,255,.72);}
${S} .preloader-bar{width:110px;height:2px;background:rgba(255,255,255,.18);border-radius:2px;overflow:hidden;}
${S} .preloader-bar::after{content:'';display:block;height:100%;width:40%;background:var(--c-accent);animation:preloaderBar 1.1s ease-in-out infinite;}
@keyframes preloaderPulse{0%,100%{transform:scale(1);}50%{transform:scale(1.05);}}
@keyframes preloaderSpin{to{transform:rotate(360deg);}}
@keyframes preloaderBar{0%{transform:translateX(-120%);}100%{transform:translateX(340%);}}
@media (prefers-reduced-motion:reduce){${S} .site-preloader{display:none;}}

/* ============ CURSOR GLOW (desktop, fine pointer only) ============ */
${S} .cursor-glow{
  position:fixed;top:0;left:0;width:400px;height:400px;border-radius:50%;
  background:radial-gradient(circle, color-mix(in srgb, var(--c-accent) 22%, transparent) 0%, transparent 70%);
  transform:translate(-50%,-50%);pointer-events:none;z-index:40;opacity:0;
  transition:opacity .4s var(--ease), width .35s var(--ease), height .35s var(--ease);
}
${S} .cursor-glow.is-active{opacity:1;}
${S} .cursor-glow.is-hovering{width:540px;height:540px;}
@media (hover:none),(pointer:coarse),(prefers-reduced-motion:reduce){${S} .cursor-glow{display:none;}}

/* ============ MAGNETIC BUTTONS (desktop, fine pointer only) ============ */
${S} .js-magnetic{will-change:transform;}
` : ""}

/* ============ COUNT-UP STATS ============ */
${S} .stat-item b{
  display:block;font-family:var(--font-heading);font-weight:700;
  font-size:clamp(2rem,4.4vw,3.25rem);line-height:1;
  color:var(--c-accent);margin-bottom:8px;font-variant-numeric:tabular-nums;
}
${S} .stat-item span{
  font-size:.82rem;text-transform:uppercase;letter-spacing:.08em;opacity:.82;
}
`.trim();
}

/** Add an alpha channel to a hex colour. */
function withAlpha(hex: string, alpha: number): string {
  const c = hex.replace("#", "");
  const full = c.length === 3 ? c.split("").map(x => x + x).join("") : c;
  if (full.length !== 6) return `rgba(0,0,0,${alpha})`;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
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
