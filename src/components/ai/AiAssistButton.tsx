"use client";

/**
 * Small drop-in "Ask AI" affordance for any text input or textarea.
 *
 * Shows a popover of preset actions relevant to the field. On click,
 * calls the AI proxy with the field's current value and swaps the
 * result back via onApply. The caller decides which preset kinds
 * are relevant (comments only, message drafts only, etc).
 *
 * Deliberately compact — this is glue, not a page.
 */

import { useState } from "react";
import { Sparkles, Loader2, ChevronDown } from "lucide-react";
import { generateWithAi } from "@/lib/ai/client";
import { AI_PRESETS, type AiTaskKind } from "@/lib/ai/prompts";

interface Props {
  /** Which presets to expose. */
  kinds: AiTaskKind[];
  /** Current text in the target field. */
  currentValue: string;
  /** Optional structured context (student name, average, etc). */
  extra?: Record<string, string>;
  /** Called when the AI returns a candidate — caller writes it into the field. */
  onApply: (text: string) => void;
  /** Origin tag for audit log. */
  source: string;
  /** Optional label — default "Ask AI". */
  label?: string;
  /** Compact vs full-size. */
  compact?: boolean;
}

export function AiAssistButton({
  kinds, currentValue, extra, onApply, source, label = "Ask AI", compact = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: AiTaskKind) {
    setBusy(true);
    setError(null);
    setOpen(false);
    try {
      const result = await generateWithAi({
        kind,
        input: currentValue,
        extra,
        source,
      });
      onApply(result.output);
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        disabled={busy}
        onClick={() => setOpen((o) => !o)}
        className={
          "inline-flex items-center gap-1 rounded-md border border-[#C9A227] bg-white text-[#0F2A47] font-semibold hover:bg-[#FBF6E8] disabled:opacity-50 transition-colors " +
          (compact ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-xs")
        }
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} className="text-[#C9A227]" />}
        <span>{busy ? "Thinking…" : label}</span>
        {!busy && <ChevronDown size={11} />}
      </button>

      {open && !busy && (
        <div
          role="menu"
          className="absolute right-0 mt-1 w-64 z-40 bg-white border border-gray-200 rounded-lg shadow-lg p-1 max-h-72 overflow-y-auto"
        >
          {kinds.map((k) => (
            <button
              key={k}
              type="button"
              role="menuitem"
              onClick={() => run(k)}
              className="w-full text-left px-3 py-2 rounded hover:bg-[#FBF6E8] focus:outline-none focus:bg-[#FBF6E8]"
            >
              <div className="text-xs font-semibold text-[#0F2A47]">{AI_PRESETS[k].label}</div>
              <div className="text-[11px] text-gray-500">{AI_PRESETS[k].description}</div>
            </button>
          ))}
        </div>
      )}
      {error && (
        <div className="absolute right-0 top-full mt-1 w-64 z-40 bg-red-50 border border-red-200 rounded-lg p-2 text-[11px] text-red-700">
          {error}
        </div>
      )}
    </div>
  );
}
