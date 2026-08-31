/**
 * Turns an AI-generated markdown-ish string into safe, styled HTML for
 * the AI Studio "Result" preview — bold, italics, headers, lists,
 * blockquotes, code, and links — without pulling in a markdown library
 * or ever using unescaped model output inside dangerouslySetInnerHTML.
 *
 * Why hand-rolled instead of e.g. `marked` + `dompurify`: this deployment
 * has no guaranteed npm-registry access from every environment that
 * edits it, and the supported subset (bold/italic/code/links/headers/
 * lists/blockquotes/hr/fenced code) covers everything the AI presets in
 * @/lib/ai/prompts actually produce. Every text fragment is escaped with
 * escapeHtml() before being placed inside a tag, and every tag name and
 * class list is a fixed literal from this file — nothing from the model's
 * output is ever interpreted as markup, so the resulting string is safe
 * to render with dangerouslySetInnerHTML.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Order matters: code spans are matched first so **bold** inside a
// `code span` isn't also interpreted as emphasis.
const INLINE_PATTERN =
  /`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_|\[([^\]]+)\]\(([^)\s]+)\)/g;

function renderInlineHtml(text: string): string {
  let out = "";
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  INLINE_PATTERN.lastIndex = 0;
  while ((m = INLINE_PATTERN.exec(text)) !== null) {
    if (m.index > lastIndex) out += escapeHtml(text.slice(lastIndex, m.index));

    if (m[1] !== undefined) {
      out += `<code class="px-1 py-0.5 rounded bg-gray-100 text-[0.85em] font-mono text-[#0F2A47]">${escapeHtml(m[1])}</code>`;
    } else if (m[2] !== undefined || m[3] !== undefined) {
      out += `<strong class="font-semibold text-gray-900">${escapeHtml((m[2] ?? m[3])!)}</strong>`;
    } else if (m[4] !== undefined || m[5] !== undefined) {
      out += `<em class="italic">${escapeHtml((m[4] ?? m[5])!)}</em>`;
    } else if (m[6] !== undefined && m[7] !== undefined) {
      const href = m[7];
      const isSafe = /^https?:\/\//i.test(href) || /^mailto:/i.test(href);
      out += isSafe
        ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" class="text-[#0F2A47] underline decoration-[#C9A227] underline-offset-2 hover:text-[#C9A227]">${escapeHtml(m[6])}</a>`
        : escapeHtml(m[6]);
    }
    lastIndex = INLINE_PATTERN.lastIndex;
  }
  if (lastIndex < text.length) out += escapeHtml(text.slice(lastIndex));
  return out;
}

const HEADER_CLASSES: Record<number, string> = {
  1: "text-lg font-bold text-[#0F2A47] mt-1 mb-2",
  2: "text-base font-bold text-[#0F2A47] mt-1 mb-2",
  3: "text-sm font-bold text-[#0F2A47] mt-1 mb-1.5",
  4: "text-sm font-semibold text-gray-800 mt-1 mb-1",
};

/** Converts `source` into an HTML string safe to pass to dangerouslySetInnerHTML. */
export function renderAiOutputHtml(source: string): string {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  let i = 0;
  let paragraphBuf: string[] = [];

  const flushParagraph = () => {
    if (paragraphBuf.length === 0) return;
    const text = paragraphBuf.join(" ").trim();
    paragraphBuf = [];
    if (!text) return;
    blocks.push(`<p class="mb-3 leading-relaxed text-gray-800">${renderInlineHtml(text)}</p>`);
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Fenced code block.
    if (/^```/.test(trimmed)) {
      flushParagraph();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i].trim())) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // consume closing fence (or EOF)
      blocks.push(
        `<pre class="mb-3 rounded-lg bg-[#0F2A47] text-gray-100 text-xs p-3 overflow-x-auto font-mono"><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`,
      );
      continue;
    }

    // Horizontal rule.
    if (/^(---|\*\*\*|___)$/.test(trimmed)) {
      flushParagraph();
      blocks.push(`<hr class="my-4 border-gray-200" />`);
      i++;
      continue;
    }

    // Headers.
    const headerMatch = line.match(/^(#{1,4})\s+(.*)$/);
    if (headerMatch) {
      flushParagraph();
      const level = headerMatch[1].length;
      const tag = `h${Math.min(level + 1, 6)}`;
      const content = renderInlineHtml(headerMatch[2].trim());
      blocks.push(`<${tag} class="${HEADER_CLASSES[level]}">${content}</${tag}>`);
      i++;
      continue;
    }

    // Blockquote.
    if (/^>\s?/.test(line)) {
      flushParagraph();
      const quoteLines: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      blocks.push(
        `<blockquote class="mb-3 border-l-4 border-[#C9A227] pl-3 italic text-gray-600">${renderInlineHtml(quoteLines.join(" "))}</blockquote>`,
      );
      continue;
    }

    // Unordered list.
    if (/^\s*[-*+]\s+/.test(line)) {
      flushParagraph();
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ""));
        i++;
      }
      blocks.push(
        `<ul class="mb-3 ml-5 list-disc space-y-1 text-gray-800">${items.map((it) => `<li>${renderInlineHtml(it)}</li>`).join("")}</ul>`,
      );
      continue;
    }

    // Ordered list.
    if (/^\s*\d+[.)]\s+/.test(line)) {
      flushParagraph();
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ""));
        i++;
      }
      blocks.push(
        `<ol class="mb-3 ml-5 list-decimal space-y-1 text-gray-800">${items.map((it) => `<li>${renderInlineHtml(it)}</li>`).join("")}</ol>`,
      );
      continue;
    }

    // Blank line — paragraph break.
    if (trimmed === "") {
      flushParagraph();
      i++;
      continue;
    }

    // Default: accumulate into the current paragraph.
    paragraphBuf.push(trimmed);
    i++;
  }
  flushParagraph();

  return blocks.length > 0 ? blocks.join("") : `<p class="text-gray-400 italic">${escapeHtml(source)}</p>`;
}
