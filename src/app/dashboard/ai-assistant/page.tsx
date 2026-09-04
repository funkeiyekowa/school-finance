"use client";

/**
 * AI Learning Assistant — an ask-anything chat available to teachers,
 * students, parents and staff. Behaviour is controlled per-school by an
 * admin via org_assistant_config; this page just reads the config to
 * decide whether to show the assistant (and its limits) and posts each
 * question to /api/ai/ask, which enforces the rules server-side.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { askLearningAssistant } from "@/lib/ai/client";
import { PageHeader, LoadingSpinner, EmptyState } from "@/components/ui/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Sparkles, Send, Bot, User as UserIcon, AlertTriangle, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChatTurn { role: "user" | "assistant"; text: string; }

interface AssistantConfig {
  enabled: boolean;
  allowed_roles: string[];
  max_input_chars: number;
}

export default function AiAssistantPage() {
  const { orgId, membership, isSuperAdmin } = useAuth();
  const supabase = createClient();
  const role = membership?.role ?? "";

  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<AssistantConfig | null>(null);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [examLock, setExamLock] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!orgId) { setLoading(false); return; }
    const [cfgRes, examRes] = await Promise.all([
      supabase.rpc("get_org_assistant_config", { p_org: orgId }).maybeSingle(),
      // Client-side courtesy check; the server (/api/ai/ask) is the real gate.
      supabase.rpc("has_active_exam_attempt"),
    ]);
    setConfig((cfgRes.data as AssistantConfig) ?? { enabled: true, allowed_roles: [], max_input_chars: 2000 });
    setExamLock(examRes.data === true);
    setLoading(false);
  }, [orgId, supabase]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, asking]);

  // The platform super admin is never restricted (matches the server, which
  // bypasses all per-school AI gates for super admins in /api/ai/ask).
  const roleAllowed = config?.enabled && (config.allowed_roles.length === 0 || config.allowed_roles.includes(role));
  const allowed = isSuperAdmin || (roleAllowed && !examLock);
  const maxChars = isSuperAdmin ? 8000 : (config?.max_input_chars ?? 2000);

  async function ask() {
    const q = input.trim();
    if (!q || asking) return;
    setError(null);
    setInput("");
    setTurns(prev => [...prev, { role: "user", text: q }]);
    setAsking(true);
    try {
      const res = await askLearningAssistant(q);
      setTurns(prev => [...prev, { role: "assistant", text: res.output }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The assistant could not answer just now.");
      // Roll the failed question back into the box so it isn't lost.
      setInput(q);
      setTurns(prev => prev.slice(0, -1));
    } finally {
      setAsking(false);
    }
  }

  if (loading) return <LoadingSpinner />;

  return (
    <div className="p-6 space-y-5 max-w-3xl mx-auto flex flex-col h-[calc(100vh-2rem)]">
      <PageHeader
        icon={<Sparkles size={24} />}
        gradient="navy"
        title="AI Assistant"
        subtitle="Ask questions and get help with your studies or your work."
      >
        {turns.length > 0 && (
          <Button variant="secondary" size="sm" onClick={() => { setTurns([]); setError(null); }}>
            <Trash2 size={14} /> Clear chat
          </Button>
        )}
      </PageHeader>

      {!allowed ? (
        <Card>
          <CardContent className="py-10">
            <EmptyState
              icon={<Bot size={32} />}
              message={
                examLock
                  ? "AI Assistant is unavailable while you are taking an exam."
                  : config?.enabled === false
                  ? "The AI assistant is currently turned off for your school."
                  : "Your account type does not have access to the AI assistant. Please contact an administrator."
              }
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-4 pr-1">
            {turns.length === 0 && (
              <div className="text-center py-10 text-gray-400">
                <Bot size={36} className="mx-auto mb-3 text-[#C9A227]" />
                <p className="text-sm">Ask me anything — a concept you&apos;re stuck on, how to approach a problem, or help drafting something.</p>
                <p className="text-xs mt-2">Tip: I explain the method, so you learn — I won&apos;t just hand over answers.</p>
              </div>
            )}
            {turns.map((t, i) => (
              <div key={i} className={cn("flex gap-3", t.role === "user" ? "justify-end" : "justify-start")}>
                {t.role === "assistant" && (
                  <div className="shrink-0 w-8 h-8 rounded-full bg-[#0F2A47] text-white flex items-center justify-center"><Bot size={16} /></div>
                )}
                <div className={cn(
                  "rounded-2xl px-4 py-2.5 text-sm max-w-[80%] whitespace-pre-wrap leading-relaxed",
                  t.role === "user" ? "bg-[#C9A227] text-white rounded-br-sm" : "bg-white border border-gray-200 text-gray-800 rounded-bl-sm"
                )}>
                  {t.text}
                </div>
                {t.role === "user" && (
                  <div className="shrink-0 w-8 h-8 rounded-full bg-gray-200 text-gray-600 flex items-center justify-center"><UserIcon size={16} /></div>
                )}
              </div>
            ))}
            {asking && (
              <div className="flex gap-3 justify-start">
                <div className="shrink-0 w-8 h-8 rounded-full bg-[#0F2A47] text-white flex items-center justify-center"><Bot size={16} /></div>
                <div className="rounded-2xl px-4 py-2.5 bg-white border border-gray-200 text-gray-400 text-sm rounded-bl-sm">Thinking…</div>
              </div>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {error}
            </div>
          )}

          <div className="shrink-0">
            <div className="flex items-end gap-2 bg-white border border-gray-300 rounded-xl p-2 focus-within:ring-2 focus-within:ring-[#C9A227]">
              <textarea
                rows={1}
                value={input}
                maxLength={maxChars}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(); } }}
                placeholder="Type your question…  (Enter to send, Shift+Enter for a new line)"
                className="flex-1 resize-none max-h-32 px-2 py-1.5 text-sm focus:outline-none"
              />
              <Button variant="gold" onClick={ask} loading={asking} disabled={!input.trim()}>
                <Send size={15} />
              </Button>
            </div>
            <div className="text-[10px] text-gray-400 text-right mt-1">{input.length}/{maxChars}</div>
          </div>
        </>
      )}
    </div>
  );
}
