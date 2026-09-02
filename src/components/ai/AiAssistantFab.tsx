"use client";

/**
 * Floating AI assistant.
 *
 * A small always-available bottom-right button that opens a
 * lightweight AI chat scoped to "how do I use this platform?"
 * questions. Uses the free_form preset with a system prompt
 * that grounds it in the platform's capabilities without
 * pretending to have live data access.
 */

import { useState, useCallback } from "react";
import { Sparkles, X, Loader2, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { generateWithAi } from "@/lib/ai/client";

interface Turn { role: "user" | "ai"; text: string; }

export function AiAssistantFab() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);

  const ask = useCallback(async () => {
    const question = q.trim();
    if (!question || busy) return;
    setTurns(t => [...t, { role: "user", text: question }]);
    setQ("");
    setBusy(true);
    try {
      const result = await generateWithAi({
        kind: "free_form",
        input:
          "You are a friendly platform assistant for a Nigerian K-12 school-management app. " +
          "Answer briefly and practically. If the user asks 'how do I…', point to the correct dashboard section and steps. " +
          "You do not have access to live school data — if they ask about a specific number, tell them where to look for it. " +
          "Use British English.\n\n" +
          "USER QUESTION:\n" + question,
        source: "ai_fab",
      });
      setTurns(t => [...t, { role: "ai", text: result.output }]);
    } catch (err) {
      setTurns(t => [...t, { role: "ai", text: err instanceof Error ? err.message : "AI failed" }]);
    } finally {
      setBusy(false);
    }
  }, [q, busy]);

  return (
    <>
      <button
        onClick={() => setOpen(o => !o)}
        className={cn(
          "no-print fixed bottom-5 right-5 z-40 w-12 h-12 rounded-full shadow-lg flex items-center justify-center transition-transform hover:scale-105",
          open ? "bg-gray-800 text-white" : "bg-gradient-to-br from-[#C9A227] to-[#e6bf39] text-[#0F2A47]"
        )}
        title="Ask the platform assistant"
      >
        {open ? <X size={18} /> : <Sparkles size={18} />}
      </button>

      {open && (
        <div className="no-print fixed bottom-20 right-5 z-40 w-80 max-w-[calc(100vw-2.5rem)] rounded-xl shadow-2xl bg-white border border-gray-200 flex flex-col overflow-hidden">
          <div className="px-3 py-2 flex items-center gap-2 text-xs" style={{ background: "#0F2A47", color: "#fff" }}>
            <Sparkles size={12} className="text-[#C9A227]" />
            <span className="font-bold uppercase tracking-wider">Platform assistant</span>
            <button onClick={() => setOpen(false)} className="ml-auto opacity-60 hover:opacity-100"><X size={12} /></button>
          </div>
          <div className="p-3 h-64 overflow-y-auto space-y-2 bg-gray-50">
            {turns.length === 0 && (
              <p className="text-xs text-gray-500 italic">
                Ask &ldquo;how do I bulk-import staff?&rdquo;, &ldquo;where can I print report cards?&rdquo;, &ldquo;what does the AI digest include?&rdquo; …
              </p>
            )}
            {turns.map((t, i) => (
              <div key={i} className={cn("rounded-lg px-2.5 py-1.5 text-xs whitespace-pre-wrap", t.role === "user" ? "bg-[#0F2A47] text-white ml-6" : "bg-white border border-gray-200 mr-6")}>
                {t.text}
              </div>
            ))}
            {busy && (
              <div className="rounded-lg px-2.5 py-1.5 text-xs bg-white border border-gray-200 mr-6 flex items-center gap-2 text-gray-500">
                <Loader2 size={11} className="animate-spin" /> Thinking…
              </div>
            )}
          </div>
          <div className="p-2 border-t border-gray-100 flex gap-2">
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") ask(); }}
              placeholder="Ask a question…"
              className="flex-1 px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
              disabled={busy}
            />
            <button onClick={ask} disabled={busy || !q.trim()} className="px-2.5 py-1.5 rounded-lg bg-[#C9A227] text-[#0F2A47] disabled:opacity-40" title="Ask">
              <Send size={12} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
