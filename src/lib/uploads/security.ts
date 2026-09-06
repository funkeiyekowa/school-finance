const MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/svg+xml": "svg",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "text/plain": "txt",
  "text/csv": "csv",
};

export function extensionForMime(mime: string): string {
  return MIME_EXTENSIONS[mime.toLowerCase()] ?? "bin";
}

/** Remove path syntax and dangerous extension tricks from a client filename. */
export function safeUploadName(name: string, mime: string): string {
  const base = (name.split(/[\\/]/).pop() ?? name)
    .normalize("NFKC")
    .replace(/[\\/\u0000-\u001f\u007f]+/g, "_")
    .replace(/[^a-zA-Z0-9._ -]+/g, "_")
    .replace(/\s+/g, " ")
    .replace(/^\.+|\.+$/g, "")
    .trim()
    .slice(0, 100) || "upload";
  const withoutExtension = base.replace(/\.[a-z0-9]{1,8}$/i, "") || "upload";
  return `${withoutExtension}.${extensionForMime(mime)}`;
}

function startsWithBytes(bytes: Uint8Array, expected: number[]): boolean {
  return expected.every((value, index) => bytes[index] === value);
}

function ascii(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/** Validate magic bytes/content rather than trusting the browser MIME header. */
export async function validateFileSignature(file: File, allowedTypes: ReadonlySet<string>): Promise<string | null> {
  const mime = file.type.toLowerCase();
  if (!allowedTypes.has(mime)) return "That file type is not supported.";
  const sample = new Uint8Array(await file.slice(0, 65536).arrayBuffer());

  if (mime === "image/jpeg" && startsWithBytes(sample, [0xff, 0xd8, 0xff])) return null;
  if (mime === "image/png" && startsWithBytes(sample, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return null;
  if (mime === "image/gif" && (ascii(sample.slice(0, 6)) === "GIF87a" || ascii(sample.slice(0, 6)) === "GIF89a")) return null;
  if (mime === "image/webp" && ascii(sample.slice(0, 4)) === "RIFF" && ascii(sample.slice(8, 12)) === "WEBP") return null;
  if (mime === "image/heic" && ascii(sample.slice(4, 12)).includes("ftyp") && /heic|heix|hevc|hevx/i.test(ascii(sample.slice(8, 16)))) return null;
  if (mime === "application/pdf" && ascii(sample.slice(0, 5)) === "%PDF-") return null;
  if (mime === "image/svg+xml") {
    // SVG is text, so inspect the complete file rather than only the magic
    // sample; a script or javascript URL may appear after the first 64 KiB.
    const text = (await file.text()).replace(/^\uFEFF/, "");
    if (!/<svg(?:\s|>)/i.test(text)) return "The SVG file is invalid.";
    if (/<script(?:\s|>)/i.test(text) || /(?:on[a-z]+\s*=|javascript\s*:)/i.test(text)) {
      return "SVG files containing scripts or executable links are not allowed.";
    }
    return null;
  }
  if (mime === "text/plain" || mime === "text/csv") {
    if (sample.includes(0)) return "The text file contains binary data.";
    return null;
  }
  if (mime.startsWith("application/vnd.") || mime === "application/msword") {
    if (startsWithBytes(sample, [0x50, 0x4b, 0x03, 0x04]) || startsWithBytes(sample, [0xd0, 0xcf, 0x11, 0xe0])) return null;
  }
  return "The file contents do not match the declared file type.";
}

export function requestSizeExceeds(request: Request, maxBytes: number): boolean {
  const length = Number(request.headers.get("content-length"));
  return Number.isFinite(length) && length > maxBytes + 64 * 1024;
}

export function sanitizePathSegments(value: string, maxSegments = 3): string {
  return value
    .split(/[\\/]+/)
    .map((segment) => segment.normalize("NFKC").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 48))
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .slice(0, maxSegments)
    .join("/");
}
