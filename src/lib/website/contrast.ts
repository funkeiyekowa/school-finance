/**
 * WCAG contrast-ratio utilities.
 *
 * Extends the single contrastRatio() function in theme.ts with a full
 * accessibility audit: checks every meaningful foreground/background
 * pairing in a resolved theme and reports AA/AAA pass/fail per pair.
 *
 * Relies on the same luminance math as theme.ts — duplicated here to
 * keep this module self-contained and testable without importing the
 * full theme engine.
 */

export interface ContrastPairing {
  id: string;
  label: string;
  foreground: string;
  background: string;
  ratio: number;
  aa: boolean;      // ratio >= 4.5 (normal text)
  aaLarge: boolean; // ratio >= 3.0 (large text / UI components)
  aaa: boolean;     // ratio >= 7.0 (enhanced normal text)
}

export interface ContrastAudit {
  pairings: ContrastPairing[];
  passCount: number;
  failCount: number;
  worstRatio: number;
  allPassAA: boolean;
}

function relativeLuminance(hex: string): number {
  const c = hex.replace("#", "");
  const full = c.length === 3 ? c.split("").map(x => x + x).join("") : c;
  if (full.length !== 6) return 0;
  const channels = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16) / 255);
  const linearize = (v: number) =>
    v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  return 0.2126 * linearize(channels[0]) + 0.7152 * linearize(channels[1]) + 0.0722 * linearize(channels[2]);
}

export function contrastRatio(hexA: string, hexB: string): number {
  const a = relativeLuminance(hexA);
  const b = relativeLuminance(hexB);
  const light = Math.max(a, b);
  const dark = Math.min(a, b);
  return (light + 0.05) / (dark + 0.05);
}

/**
 * Defines the meaningful foreground/background pairings to check.
 * Each entry maps color role names to (foreground, background) pairs
 * that a user would actually read on the live site.
 */
const PAIRING_DEFS: { id: string; label: string; fg: string; bg: string }[] = [
  { id: "body-text",       label: "Body text on page background",         fg: "text",       bg: "background" },
  { id: "muted-text",      label: "Muted text on page background",        fg: "textMuted",  bg: "background" },
  { id: "text-surface",    label: "Body text on surface cards",           fg: "text",       bg: "surface" },
  { id: "muted-surface",   label: "Muted text on surface cards",          fg: "textMuted",  bg: "surface" },
  { id: "text-surfacealt", label: "Body text on alternate surface",       fg: "text",       bg: "surfaceAlt" },
  { id: "header-text",     label: "Header navigation text",              fg: "headerText", bg: "headerBg" },
  { id: "footer-text",     label: "Footer text",                         fg: "footerText", bg: "footerBg" },
  { id: "primary-on-bg",   label: "Primary (links) on page background",  fg: "primary",    bg: "background" },
  { id: "accent-on-bg",    label: "Accent on page background",           fg: "accent",     bg: "background" },
];

/**
 * Run a full contrast audit against a resolved color set.
 * The colors object maps role names (e.g., "text", "background") to hex values.
 */
export function auditContrast(colors: Record<string, string>): ContrastAudit {
  const pairings: ContrastPairing[] = [];

  for (const def of PAIRING_DEFS) {
    const fg = colors[def.fg];
    const bg = colors[def.bg];
    if (!fg || !bg) continue;

    const ratio = contrastRatio(fg, bg);
    const rounded = Math.round(ratio * 100) / 100;

    pairings.push({
      id: def.id,
      label: def.label,
      foreground: fg,
      background: bg,
      ratio: rounded,
      aa: rounded >= 4.5,
      aaLarge: rounded >= 3.0,
      aaa: rounded >= 7.0,
    });
  }

  const passCount = pairings.filter(p => p.aa).length;
  const failCount = pairings.filter(p => !p.aa).length;
  const worstRatio = pairings.length > 0
    ? Math.min(...pairings.map(p => p.ratio))
    : 0;

  return {
    pairings,
    passCount,
    failCount,
    worstRatio,
    allPassAA: failCount === 0,
  };
}

/**
 * Check a single foreground/background pair and return a human-readable summary.
 */
export function checkPair(fg: string, bg: string): {
  ratio: number;
  aa: boolean;
  aaLarge: boolean;
  aaa: boolean;
  summary: string;
} {
  const ratio = Math.round(contrastRatio(fg, bg) * 100) / 100;
  const aa = ratio >= 4.5;
  const aaLarge = ratio >= 3.0;
  const aaa = ratio >= 7.0;

  let summary: string;
  if (aaa) summary = `${ratio}:1 — Passes AAA`;
  else if (aa) summary = `${ratio}:1 — Passes AA`;
  else if (aaLarge) summary = `${ratio}:1 — Passes AA for large text only`;
  else summary = `${ratio}:1 — Fails WCAG minimum`;

  return { ratio, aa, aaLarge, aaa, summary };
}
