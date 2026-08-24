"use client";

import { useMemo } from "react";
import { auditContrast, type ContrastAudit } from "@/lib/website/contrast";
import { cn } from "@/lib/utils";
import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";

interface ContrastCheckerProps {
  colors: Record<string, string>;
}

export function ContrastChecker({ colors }: ContrastCheckerProps) {
  const audit: ContrastAudit | null = useMemo(() => {
    if (!colors.text || !colors.background) return null;
    return auditContrast(colors);
  }, [colors]);

  if (!audit) {
    return (
      <div className="text-xs text-gray-500 py-3">
        Set at least a text and background colour to see contrast results.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {audit.allPassAA ? (
          <CheckCircle2 size={16} className="text-green-600" />
        ) : (
          <AlertTriangle size={16} className="text-amber-600" />
        )}
        <span className="text-sm font-medium">
          {audit.allPassAA
            ? "All pairings meet WCAG AA (4.5:1)"
            : `${audit.failCount} of ${audit.pairings.length} pairings fail WCAG AA`}
        </span>
      </div>

      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-50 border-b">
              <th className="text-left px-2 py-1.5 font-semibold text-gray-600" colSpan={2}>Pairing</th>
              <th className="text-center px-2 py-1.5 font-semibold text-gray-600">Ratio</th>
              <th className="text-center px-2 py-1.5 font-semibold text-gray-600">AA</th>
              <th className="text-center px-2 py-1.5 font-semibold text-gray-600">AAA</th>
            </tr>
          </thead>
          <tbody>
            {audit.pairings.map((p) => (
              <tr key={p.id} className={cn("border-b last:border-0", !p.aa && "bg-red-50/50")}>
                <td className="px-2 py-1.5" colSpan={2}>
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className="w-3 h-3 rounded-sm border border-gray-300 shrink-0"
                      style={{ background: p.foreground }}
                    />
                    <span className="text-gray-400">/</span>
                    <span
                      className="w-3 h-3 rounded-sm border border-gray-300 shrink-0"
                      style={{ background: p.background }}
                    />
                    <span className="truncate">{p.label}</span>
                  </span>
                </td>
                <td className="px-2 py-1.5 text-center font-mono">
                  {p.ratio.toFixed(1)}:1
                </td>
                <td className="px-2 py-1.5 text-center">
                  {p.aa ? (
                    <CheckCircle2 size={13} className="inline text-green-600" />
                  ) : (
                    <XCircle size={13} className="inline text-red-500" />
                  )}
                </td>
                <td className="px-2 py-1.5 text-center">
                  {p.aaa ? (
                    <CheckCircle2 size={13} className="inline text-green-600" />
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[10px] text-gray-500">
        WCAG AA requires 4.5:1 for normal text, 3:1 for large text. AAA requires 7:1.
        This checks normal text contrast only.
      </p>
    </div>
  );
}
