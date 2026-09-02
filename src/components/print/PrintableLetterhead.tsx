"use client";

/**
 * PrintableLetterhead
 *
 * The letterhead every printable document (payslip, notice, report
 * card, clinic summary, receipt) starts with. Renders the school's
 * logo (or a monogram fallback), name, address, phone, and email
 * with a coloured accent band. Uses the brand navy + gold from the
 * design system so all prints share one visual language.
 *
 * Pass an `eyebrow` to say what kind of document it is
 * ("Payslip", "Report Card", "Overdue Notice", …) and an optional
 * `right` slot for the per-document identifier (visit code, run
 * label, etc).
 */

import { Branding } from "@/lib/hooks/useBranding";

interface Props {
  branding: Branding;
  eyebrow: string;
  right?: React.ReactNode;
  /** Colour of the accent bar under the letterhead. */
  accent?: "navy" | "gold" | "emerald" | "rose" | "amber" | "purple";
}

const ACCENT_COLOR: Record<NonNullable<Props["accent"]>, string> = {
  navy: "#0F2A47",
  gold: "#C9A227",
  emerald: "#059669",
  rose: "#e11d48",
  amber: "#d97706",
  purple: "#7e22ce",
};

export function PrintableLetterhead({
  branding, eyebrow, right, accent = "navy",
}: Props) {
  const accentHex = ACCENT_COLOR[accent];
  const monogram = branding.schoolName
    .split(/\s+/).filter(Boolean).slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? "").join("") || "S";

  return (
    <div className="mb-4">
      <div className="flex items-start justify-between gap-4 pb-3" style={{ borderBottom: `3px solid ${accentHex}` }}>
        <div className="flex items-center gap-3 min-w-0">
          {branding.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={branding.logoUrl}
              alt={`${branding.schoolName} logo`}
              className="h-12 w-12 rounded-lg object-contain shrink-0"
              style={{ background: "#fff" }}
            />
          ) : (
            <div
              className="h-12 w-12 rounded-lg flex items-center justify-center text-white font-bold text-lg shrink-0"
              style={{ background: `linear-gradient(135deg, ${branding.primaryColor}, ${accentHex})` }}
            >
              {monogram}
            </div>
          )}
          <div className="min-w-0">
            <p className="text-[10px] uppercase font-bold tracking-widest" style={{ color: accentHex }}>
              {eyebrow}
            </p>
            <h2 className="text-lg font-bold truncate" style={{ color: branding.primaryColor }}>
              {branding.schoolName}
            </h2>
            <p className="text-[11px] text-gray-500 truncate">
              {[branding.address, branding.phone, branding.email].filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>
        {right && (
          <div className="text-right text-xs text-gray-600 shrink-0">
            {right}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * PrintableFooter
 * Small strip at the bottom of every document with the school details
 * and (optionally) a receipt footer message.
 */
export function PrintableFooter({ branding }: { branding: Branding }) {
  return (
    <div className="pt-3 mt-4 border-t border-gray-200 text-[10px] text-gray-500 flex items-center justify-between gap-3">
      <div>
        <p className="font-medium">{branding.schoolName}</p>
        {branding.address && <p>{branding.address}</p>}
      </div>
      <div className="text-right">
        {branding.phone && <p>{branding.phone}</p>}
        {branding.email && <p>{branding.email}</p>}
      </div>
    </div>
  );
}
