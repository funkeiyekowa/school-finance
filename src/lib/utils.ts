import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, parseISO, isValid } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format amount as Nigerian Naira */
export function fmtMoney(amount: number | null | undefined): string {
  const n = Number(amount) || 0;
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString("en-NG", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return `${n < 0 ? "-" : ""}₦${formatted}`;
}

/** Format date in Africa/Lagos locale */
export function fmtDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  try {
    const d = parseISO(dateStr);
    if (!isValid(d)) return String(dateStr);
    return format(d, "d MMM yyyy");
  } catch {
    return String(dateStr);
  }
}

export function fmtDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  try {
    const d = parseISO(dateStr);
    if (!isValid(d)) return String(dateStr);
    return format(d, "d MMM yyyy, h:mm a");
  } catch {
    return String(dateStr);
  }
}

export function today(): string {
  return format(new Date(), "yyyy-MM-dd");
}

export function generateCode(prefix: string, existing: string[]): string {
  const nums = existing
    .map((e) => {
      const n = parseInt(e.replace(prefix, ""), 10);
      return isNaN(n) ? 0 : n;
    })
    .filter((n) => n > 0);
  const max = nums.length > 0 ? Math.max(...nums) : 0;
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

export function slugify(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

export function exportCSV(rows: Record<string, unknown>[], filename: string) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(","),
    ...rows.map((row) =>
      headers.map((h) => {
        const val = row[h];
        const str = val === null || val === undefined ? "" : String(val);
        return str.includes(",") || str.includes('"') || str.includes("\n")
          ? `"${str.replace(/"/g, '""')}"`
          : str;
      }).join(",")
    ),
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function getPaymentStatusColor(status: string) {
  switch (status) {
    case "paid": return "bg-green-100 text-green-800";
    case "partial": return "bg-amber-100 text-amber-800";
    case "unpaid": return "bg-red-100 text-red-800";
    case "matched": return "bg-green-100 text-green-800";
    case "needs_review": return "bg-amber-100 text-amber-800";
    case "unmatched": return "bg-gray-100 text-gray-600";
    case "duplicate": return "bg-purple-100 text-purple-800";
    case "rejected": return "bg-red-100 text-red-800";
    case "confirmed": return "bg-green-100 text-green-800";
    case "pending": return "bg-blue-100 text-blue-800";
    default: return "bg-gray-100 text-gray-600";
  }
}

export function getPaymentStatusLabel(status: string) {
  const labels: Record<string, string> = {
    paid: "Paid in full",
    partial: "Part paid",
    unpaid: "Unpaid",
    matched: "Matched",
    needs_review: "Needs review",
    unmatched: "Unmatched",
    duplicate: "Duplicate",
    rejected: "Rejected",
    confirmed: "Confirmed",
    pending: "Pending",
    parse_failed: "Parse failed",
    received: "Received",
  };
  return labels[status] ?? status;
}
