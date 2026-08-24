/**
 * Theme token schema validation.
 *
 * Used when importing a theme from JSON or saving a custom theme. Enforces:
 *   - Only known keys at each level
 *   - Value format safety (no url(), javascript:, expressions, script tags)
 *   - Size limits
 *   - Type correctness for each token group
 *
 * This is a server-safe module — no DOM dependencies.
 */

import type { ThemeTokens } from "./types";

export interface ValidationResult {
  valid: boolean;
  tokens?: ThemeTokens;
  errors: string[];
}

const MAX_JSON_BYTES = 10_240; // 10 KB

const KNOWN_COLOR_KEYS = new Set([
  "primary", "primaryDark", "secondary", "accent",
  "background", "surface", "surfaceAlt",
  "text", "textMuted", "border",
  "headerBg", "headerText", "footerBg", "footerText",
  "success", "warning", "error",
]);

const KNOWN_FONT_KEYS = new Set(["heading", "body", "accent"]);
const KNOWN_SCALE_KEYS = new Set(["h1", "h2", "h3", "body"]);
const KNOWN_RADIUS_KEYS = new Set(["sm", "md", "lg", "pill"]);
const KNOWN_SPACING_KEYS = new Set(["section", "gap"]);
const KNOWN_BUTTON_KEYS = new Set(["radius", "weight", "transform"]);
const KNOWN_SHADOW_KEYS = new Set(["card"]);

const KNOWN_TOP_LEVEL_KEYS = new Set([
  "colors", "fonts", "scale", "radius", "spacing",
  "button", "shadow", "headerStyle", "heroStyle",
]);

const HEADER_STYLES = new Set(["light", "dark", "minimal"]);
const HERO_STYLES = new Set(["centered", "image-right", "full-bleed", "gradient"]);
const BUTTON_TRANSFORMS = new Set(["none", "uppercase", "lowercase", "capitalize"]);

const DANGEROUS_PATTERNS = [
  /url\s*\(/i,
  /javascript\s*:/i,
  /expression\s*\(/i,
  /<\s*script/i,
  /import\s/i,
  /eval\s*\(/i,
  /data\s*:/i,
  /on\w+\s*=/i,
];

function isDangerous(value: string): boolean {
  return DANGEROUS_PATTERNS.some(p => p.test(value));
}

const HEX_COLOR = /^#[0-9a-fA-F]{3,8}$/;
const RGB_COLOR = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+))?\s*\)$/;
const HSL_COLOR = /^hsla?\(\s*\d{1,3}\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%\s*(,\s*(0|1|0?\.\d+))?\s*\)$/;

function isValidColor(value: string): boolean {
  if (value.length > 30) return false;
  if (isDangerous(value)) return false;
  return HEX_COLOR.test(value) || RGB_COLOR.test(value) || HSL_COLOR.test(value);
}

const CSS_UNIT = /^\d+\.?\d*(rem|em|px)$/;

function isValidCssUnit(value: string): boolean {
  if (value.length > 10) return false;
  if (isDangerous(value)) return false;
  return CSS_UNIT.test(value) || value === "9999px" || value === "0";
}

const SAFE_FONT_NAME = /^[a-zA-Z0-9 ]+$/;

function isValidFontName(value: string): boolean {
  if (value.length > 60) return false;
  if (isDangerous(value)) return false;
  return SAFE_FONT_NAME.test(value);
}

function isValidShadow(value: string): boolean {
  if (value.length > 200) return false;
  if (isDangerous(value)) return false;
  if (value === "none") return true;
  return true;
}

function isValidWeight(value: string): boolean {
  const n = parseInt(value, 10);
  return !isNaN(n) && n >= 100 && n <= 900 && n % 100 === 0;
}

function validateObject(
  obj: unknown,
  allowedKeys: Set<string>,
  valueFn: (key: string, value: string) => string | null,
  groupName: string,
  errors: string[]
): Record<string, string> | undefined {
  if (obj === undefined || obj === null) return undefined;
  if (typeof obj !== "object" || Array.isArray(obj)) {
    errors.push(`${groupName} must be an object`);
    return undefined;
  }

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (!allowedKeys.has(key)) {
      errors.push(`${groupName}: unknown key "${key}"`);
      continue;
    }
    if (typeof value !== "string") {
      errors.push(`${groupName}.${key}: must be a string`);
      continue;
    }
    const err = valueFn(key, value);
    if (err) {
      errors.push(`${groupName}.${key}: ${err}`);
      continue;
    }
    result[key] = value;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export function validateThemeTokens(input: unknown): ValidationResult {
  const errors: string[] = [];

  // Size check on serialized input
  const serialized = JSON.stringify(input);
  if (serialized.length > MAX_JSON_BYTES) {
    return { valid: false, errors: [`Theme exceeds maximum size of ${MAX_JSON_BYTES} bytes`] };
  }

  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { valid: false, errors: ["Theme must be a JSON object"] };
  }

  const raw = input as Record<string, unknown>;

  // Reject unknown top-level keys
  for (const key of Object.keys(raw)) {
    if (!KNOWN_TOP_LEVEL_KEYS.has(key)) {
      errors.push(`Unknown top-level key: "${key}"`);
    }
  }

  const tokens: ThemeTokens = {};

  // Colors
  tokens.colors = validateObject(
    raw.colors, KNOWN_COLOR_KEYS,
    (_k, v) => isValidColor(v) ? null : `invalid color value "${v}"`,
    "colors", errors
  );

  // Fonts
  if (raw.fonts !== undefined) {
    if (typeof raw.fonts !== "object" || raw.fonts === null || Array.isArray(raw.fonts)) {
      errors.push("fonts must be an object");
    } else {
      const fonts: Record<string, string> = {};
      for (const [key, value] of Object.entries(raw.fonts as Record<string, unknown>)) {
        if (!KNOWN_FONT_KEYS.has(key)) {
          errors.push(`fonts: unknown key "${key}"`);
          continue;
        }
        if (typeof value !== "string") {
          errors.push(`fonts.${key}: must be a string`);
          continue;
        }
        if (!isValidFontName(value)) {
          errors.push(`fonts.${key}: invalid font name "${value}"`);
          continue;
        }
        fonts[key] = value;
      }
      if (Object.keys(fonts).length > 0) {
        tokens.fonts = fonts as ThemeTokens["fonts"];
      }
    }
  }

  // Scale
  tokens.scale = validateObject(
    raw.scale, KNOWN_SCALE_KEYS,
    (_k, v) => isValidCssUnit(v) ? null : `invalid CSS unit "${v}"`,
    "scale", errors
  );

  // Radius
  tokens.radius = validateObject(
    raw.radius, KNOWN_RADIUS_KEYS,
    (_k, v) => isValidCssUnit(v) ? null : `invalid CSS unit "${v}"`,
    "radius", errors
  );

  // Spacing
  tokens.spacing = validateObject(
    raw.spacing, KNOWN_SPACING_KEYS,
    (_k, v) => isValidCssUnit(v) ? null : `invalid CSS unit "${v}"`,
    "spacing", errors
  );

  // Button
  tokens.button = validateObject(
    raw.button, KNOWN_BUTTON_KEYS,
    (k, v) => {
      if (k === "radius") return isValidCssUnit(v) ? null : `invalid radius "${v}"`;
      if (k === "weight") return isValidWeight(v) ? null : `invalid weight "${v}" (must be 100-900)`;
      if (k === "transform") return BUTTON_TRANSFORMS.has(v) ? null : `invalid transform "${v}"`;
      return null;
    },
    "button", errors
  );

  // Shadow
  tokens.shadow = validateObject(
    raw.shadow, KNOWN_SHADOW_KEYS,
    (_k, v) => isValidShadow(v) ? null : `invalid shadow value`,
    "shadow", errors
  );

  // headerStyle
  if (raw.headerStyle !== undefined) {
    if (typeof raw.headerStyle !== "string" || !HEADER_STYLES.has(raw.headerStyle)) {
      errors.push(`headerStyle: must be one of ${Array.from(HEADER_STYLES).join(", ")}`);
    } else {
      tokens.headerStyle = raw.headerStyle;
    }
  }

  // heroStyle
  if (raw.heroStyle !== undefined) {
    if (typeof raw.heroStyle !== "string" || !HERO_STYLES.has(raw.heroStyle)) {
      errors.push(`heroStyle: must be one of ${Array.from(HERO_STYLES).join(", ")}`);
    } else {
      tokens.heroStyle = raw.heroStyle;
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, tokens, errors: [] };
}
