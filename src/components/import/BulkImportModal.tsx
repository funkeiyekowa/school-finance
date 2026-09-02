"use client";

/**
 * Generic bulk-import modal.
 *
 * A reusable single-file solution that any list page can drop in for
 * "add many rows at once". Accepts CSV paste or file upload
 * (.csv / .xlsx / .txt), maps by header row against the caller's
 * column schema, validates per-line, and calls back with the parsed
 * rows so the parent handles the actual DB insert.
 */

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Upload, Loader2, Download } from "lucide-react";
import { extractContent, parseCsv } from "@/lib/import/docParser";

export interface ImportColumn {
  key: string;
  label: string;
  required?: boolean;
  hint?: string;
  transform?: (raw: string) => unknown;
}

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  columns: ImportColumn[];
  onImport: (rows: Record<string, unknown>[]) => Promise<{ ok: boolean; message?: string; errors?: string[] }>;
  example?: Record<string, string>;
}

export function BulkImportModal({ open, onClose, title, columns, onImport, example }: Props) {
  const [text, setText] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [flash, setFlash] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setExtracting(true);
    setErrors([]);
    try {
      const rc = await extractContent(f);
      if ((rc.kind === "csv" || rc.kind === "xlsx") && rc.rows.length > 0) {
        setText(rc.rows.map(r => r.map(c => c.includes(",") || c.includes('"') || c.includes("\n") ? `"${c.replace(/"/g, '""')}"` : c).join(",")).join("\n"));
      } else {
        setText(rc.text);
      }
    } catch (err) {
      setErrors([err instanceof Error ? err.message : "Could not read file"]);
    } finally {
      setExtracting(false);
    }
  }

  function downloadTemplate() {
    const header = columns.map(c => c.key).join(",");
    const sample = columns.map(c => example?.[c.key] ?? (c.required ? "REQUIRED" : "")).join(",");
    const csv = header + "\n" + sample;
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-template.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function commit() {
    setErrors([]);
    setFlash(null);
    const trimmed = text.trim();
    if (!trimmed) { setErrors(["Paste content or upload a file first."]); return; }
    const rows = parseCsv(trimmed);
    if (rows.length < 2) { setErrors(["Paste at least a header row and one data row."]); return; }
    const rawHeader = rows[0].map(h => h.toLowerCase().replace(/[^a-z0-9]+/g, "_"));
    const missing = columns.filter(c => c.required && !rawHeader.includes(c.key)).map(c => c.key);
    if (missing.length) { setErrors([`Missing required column(s): ${missing.join(", ")}`]); return; }

    const parsed: Record<string, unknown>[] = [];
    const errs: string[] = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (r.length === 1 && r[0] === "") continue;
      const obj: Record<string, unknown> = {};
      let rowOk = true;
      for (const col of columns) {
        const idx = rawHeader.indexOf(col.key);
        const raw = idx >= 0 ? (r[idx] ?? "").trim() : "";
        if (col.required && !raw) {
          errs.push(`Line ${i + 1}: missing ${col.key}`);
          rowOk = false;
          break;
        }
        obj[col.key] = col.transform ? col.transform(raw) : raw || null;
      }
      if (rowOk) parsed.push(obj);
    }
    if (errs.length) { setErrors(errs.slice(0, 20)); return; }
    if (parsed.length === 0) { setErrors(["No valid data rows to import."]); return; }

    setImporting(true);
    const result = await onImport(parsed);
    setImporting(false);
    if (!result.ok) {
      setErrors(result.errors ?? [result.message ?? "Import failed."]);
      return;
    }
    setFlash(result.message ?? `Imported ${parsed.length} row${parsed.length === 1 ? "" : "s"}.`);
    setText("");
    setTimeout(() => { setFlash(null); onClose(); }, 1200);
  }

  if (!open) return null;

  return (
    <Modal open onClose={onClose} title={title} size="lg">
      <div className="space-y-3">
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
          <p className="font-semibold mb-1">Columns (header row required):</p>
          <p className="font-mono text-[11px] break-all">{columns.map(c => c.key + (c.required ? "*" : "")).join(", ")}</p>
          <p className="mt-1">
            <strong>*</strong> = required.
            {columns.some(c => c.hint) && (
              <span className="ml-2">
                {columns.filter(c => c.hint).map(c => `${c.key}: ${c.hint}`).join(" · ")}
              </span>
            )}
          </p>
          <div className="mt-2 flex items-center gap-3">
            <button onClick={downloadTemplate} className="text-blue-700 hover:text-blue-900 underline text-xs flex items-center gap-1">
              <Download size={11} /> Download template
            </button>
            <label className="cursor-pointer text-blue-700 hover:text-blue-900 underline text-xs flex items-center gap-1">
              {extracting ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
              Upload .csv / .xlsx / .txt
              <input type="file" className="hidden" accept=".csv,.xlsx,.xls,.txt" onChange={onFile} />
            </label>
          </div>
        </div>
        <textarea
          className="w-full h-56 p-3 border border-gray-300 rounded-lg font-mono text-xs"
          placeholder="Paste CSV content here (including header row)…"
          value={text}
          onChange={e => setText(e.target.value)}
        />
        {errors.length > 0 && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800 max-h-40 overflow-y-auto">
            <p className="font-semibold mb-1">Import failed:</p>
            <ul className="list-disc pl-5 space-y-0.5">
              {errors.map((e, i) => (<li key={i}>{e}</li>))}
            </ul>
          </div>
        )}
        {flash && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
            {flash}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="gold" onClick={commit} loading={importing} disabled={!text.trim()}>Import</Button>
        </div>
      </div>
    </Modal>
  );
}
