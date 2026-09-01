/**
 * Small CSV export helper. Handles quoting, commas, newlines, and
 * bool/date/null coercion. Triggers a browser download in one call.
 *
 *   exportRowsAsCsv("payslips-2026-09.csv", payslips, [
 *     { key: "staff_name", label: "Staff" },
 *     { key: "net_pay", label: "Net Pay", format: (v) => fmtMoney(v) },
 *   ]);
 */
export interface CsvColumn<T> {
  key: keyof T | string;
  label: string;
  format?: (row: T) => string | number | boolean | null | undefined;
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes(",") || s.includes("\"") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, "\"\"")}"`;
  }
  return s;
}

export function toCsvString<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const header = columns.map((c) => csvCell(c.label)).join(",");
  const body = rows.map((row) =>
    columns.map((c) => {
      const value = c.format ? c.format(row) : (row as unknown as Record<string, unknown>)[c.key as string];
      return csvCell(value);
    }).join(",")
  ).join("\n");
  return header + "\n" + body;
}

export function exportRowsAsCsv<T>(filename: string, rows: T[], columns: CsvColumn<T>[]) {
  const csv = toCsvString(rows, columns);
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" }); // BOM for Excel
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : filename + ".csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

/**
 * Print helper: opens the current page's print dialog. Wrap the
 * printable content in `<div className="print:block hidden">` and
 * hide the rest with `<div className="print:hidden">` — the print
 * stylesheet in globals.css takes care of the rest.
 */
export function printPage() {
  window.print();
}
