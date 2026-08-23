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
 * Emit the resolved theme as CSS custom properties.
 * Scoped to a selector so the studio can preview a theme without it
 * bleeding into the dashboard chrome.
 */
export function themeToCss(theme: ResolvedTheme, selector = ".site-root"): string {
  const lines: string[] = [];

  for (const [k, v] of Object.entries(theme.colors)) lines.push(`--c-${kebab(k)}: ${v};`);
  for (const [k, v] of Object.entries(theme.scale))  lines.push(`--fs-${kebab(k)}: ${v};`);
  for (const [k, v] of Object.entries(theme.radius)) lines.push(`--r-${kebab(k)}: ${v};`);
  for (const [k, v] of Object.entries(theme.spacing))lines.push(`--sp-${kebab(k)}: ${v};`);
  for (const [k, v] of Object.entries(theme.button)) lines.push(`--btn-${kebab(k)}: ${v};`);
  for (const [k, v] of Object.entries(theme.shadow)) lines.push(`--sh-${kebab(k)}: ${v};`);

  lines.push(`--font-heading: ${cssFontStack(theme.fonts.heading)};`);
  lines.push(`--font-body: ${cssFontStack(theme.fonts.body)};`);
  lines.push(`--font-accent: ${cssFontStack(theme.fonts.accent)};`);

  return `${selector}{${lines.join("")}}`;
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
