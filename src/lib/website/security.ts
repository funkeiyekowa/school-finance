/** Output-context escaping for CMS-controlled website content. */

/** Escape text before adding the small subset of HTML markup we generate. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Convert *emphasised* spans after escaping all user-provided text. */
export function emphasisHtml(value: string): string {
  return escapeHtml(value).replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

/**
 * Serialize JSON for an inline application/ld+json script. Escaping HTML-significant
 * characters prevents a string containing </script> from ending the script element.
 */
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item === undefined ? undefined : item)
    .replace(/&/g, "\\u0026")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/** Permit only absolute HTTP(S) URLs at external navigation/embed sinks. */
export function safeExternalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/** Last-line defence for generated inline stylesheet text. */
export function safeStyleSheet(value: string): string {
  return value.replace(/<\/style/gi, match => `<\\/${match.slice(2)}`);
}
