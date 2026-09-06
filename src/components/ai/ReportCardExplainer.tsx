"use client";

/**
 * Read-only, grounded "Explain this in plain language" panel for a parent
 * or student viewing their OWN published report card.
 *
 * Reuses the shared AI proxy pattern (see /api/ai/report-card-explainer):
 * the server independently re-verifies the caller owns this report card
 * before calling AI, so this component never needs to duplicate that check
 * -- it only renders for student/parent roles, as a UX nicety, and the
 * server is the real gate.
 *
 * Deliberately distinct from AiAssistButton: this is a passive, on-demand
 * explanation shown to the family, not an editable-field assist. Output is
 * always labelled AI-generated and never written into any school record.
 */

import { useState } from "react";
import { Sparkles, Loader2, AlertTriangle } from "lucide-react";
import { explainReportCard } from "@/lib/ai/client";

export function ReportCardExplainer({ reportCardId }: { reportCardId: string }) {
  const [output, setOutput] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const result = await explainReportCard(reportCardId);
      setOutput(result.output);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate an explanation.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="print:hidden rounded-xl border border-[#C9A227]/40 bg-[#FBF6E8] p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-[#0F2A47] flex items-center gap-1.5">
            <Sparkles size={14} className="text-[#C9A227]" /> Explain this report card
          </div>
          <p className="text-xs text-gray-600 mt-0.5">
            Get a plain-language summary of these results. AI-generated — not an official school
            record, and it never changes the actual grades.
          </p>
        </div>
        {!output && (
          <button
            type="button"
            onClick={run}
            disabled={busy}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-[#C9A227] bg-white px-3 py-1.5 text-xs font-semibold text-[#0F2A47] hover:bg-[#FBF6E8] disabled:opacity-50"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} className="text-[#C9A227]" />}
            {busy ? "Thinking…" : "Explain"}
          </button>
        )}
      </div>

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {output && (
        <div className="mt-3 space-y-2">
          <p className="text-sm text-gray-800 whitespace-pre-wrap">{output}</p>
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wide font-semibold text-[#C9A227]">
              AI-generated — review with your child&apos;s actual report above
            </span>
            <button
              type="button"
              onClick={() => { setOutput(null); run(); }}
              disabled={busy}
              className="text-xs text-[#0F2A47] hover:underline disabled:opacity-50"
            >
              Regenerate
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
