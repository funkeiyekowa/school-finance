/**
 * Client-side document text extraction for the mass importer.
 *
 * Handles .txt / .md / .csv / .xlsx / .docx without any external
 * dependencies beyond the already-installed xlsx library. For docx
 * we parse the ZIP structure using the browser's built-in
 * DecompressionStream and pull text nodes out of word/document.xml.
 *
 * Returns a `RawContent` blob the AI parser can then structure.
 */

export interface RawContent {
  text: string;
  rows: string[][];
  kind: "txt" | "md" | "csv" | "xlsx" | "docx" | "paste";
  name: string;
}

export async function extractContent(file: File): Promise<RawContent> {
  const name = file.name.toLowerCase();

  if (name.endsWith(".txt") || name.endsWith(".md")) {
    return { text: await file.text(), rows: [], kind: name.endsWith(".md") ? "md" : "txt", name: file.name };
  }
  if (name.endsWith(".csv")) {
    const text = await file.text();
    return { text, rows: parseCsv(text), kind: "csv", name: file.name };
  }
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    return extractXlsx(file);
  }
  if (name.endsWith(".docx")) {
    return extractDocx(file);
  }
  return { text: await file.text(), rows: [], kind: "txt", name: file.name };
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    const cells: string[] = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (quoted && line[i + 1] === '"') { cur += '"'; i++; }
        else quoted = !quoted;
      } else if (c === "," && !quoted) { cells.push(cur.trim()); cur = ""; }
      else cur += c;
    }
    cells.push(cur.trim());
    rows.push(cells);
  }
  return rows;
}

async function extractXlsx(file: File): Promise<RawContent> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const rows: string[][] = [];
  const textParts: string[] = [];
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: "" });
    textParts.push(`## Sheet: ${sheetName}`);
    for (const r of data) {
      const cells = (r as unknown[]).map(v => (v ?? "").toString().trim());
      if (cells.some(c => c.length > 0)) {
        rows.push(cells);
        textParts.push(cells.join(" | "));
      }
    }
  }
  return { text: textParts.join("\n"), rows, kind: "xlsx", name: file.name };
}

async function extractDocx(file: File): Promise<RawContent> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const doc = await extractZipEntry(buf, "word/document.xml");
  if (!doc) return { text: "", rows: [], kind: "docx", name: file.name };
  const decoder = new TextDecoder("utf-8");
  let xml = decoder.decode(doc);
  xml = xml.replace(/<w:p[^>]*>/g, "\n").replace(/<w:br[^>]*\/?>/g, "\n");
  const text = xml
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#x?[0-9a-f]+;/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, rows: [], kind: "docx", name: file.name };
}

async function extractZipEntry(zip: Uint8Array, target: string): Promise<Uint8Array | null> {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65558); i--) {
    if (zip[i] === 0x50 && zip[i + 1] === 0x4b && zip[i + 2] === 0x05 && zip[i + 3] === 0x06) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const cdCount = dv.getUint16(eocd + 10, true);
  const cdOffset = dv.getUint32(eocd + 16, true);

  let p = cdOffset;
  for (let i = 0; i < cdCount; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) return null;
    const method = dv.getUint16(p + 10, true);
    const compressedSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localHeaderOffset = dv.getUint32(p + 42, true);
    const name = new TextDecoder("utf-8").decode(zip.slice(p + 46, p + 46 + nameLen));

    if (name === target) {
      const lh = localHeaderOffset;
      if (dv.getUint32(lh, true) !== 0x04034b50) return null;
      const lhNameLen = dv.getUint16(lh + 26, true);
      const lhExtraLen = dv.getUint16(lh + 28, true);
      const dataStart = lh + 30 + lhNameLen + lhExtraLen;
      const data = zip.slice(dataStart, dataStart + compressedSize);
      if (method === 0) return data;
      if (method === 8) {
        const stream = new Response(new Blob([data as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw")));
        return new Uint8Array(await stream.arrayBuffer());
      }
      return null;
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}
