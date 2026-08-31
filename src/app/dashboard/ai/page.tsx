"use client";

/**
 * AI dashboard — a workspace for drafting communications,
 * report-card comments, and website copy with a helpful model.
 *
 * The design is deliberately generic: pick a task, tweak the input,
 * hit "Generate", edit the result, copy it. Every request goes
 * through /api/ai/generate which enforces staff-only access, per-IP
 * rate limits, and structured logging to ai_generation_log.
 *
 * The Result panel renders the model's markdown-ish output (bold,
 * italics, headers, lists, links, quotes) as styled HTML by default
 * (see @/lib/ai/richText) — a toggle switches to a plain textarea for
 * manual edits, and Copy writes both a plain-text AND a rich-HTML
 * clipboard entry so pasting into Word/Gmail/Docs keeps the formatting.
 */

import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { generateWithAi } from "@/lib/ai/client";
import { AI_PRESETS, type AiTaskKind, presetOptions } from "@/lib/ai/prompts";
import { renderAiOutputHtml } from "@/lib/ai/richText";
import { useToast } from "@/lib/hooks/useToast";
import { Sparkles, Copy, Loader2, Clock, Eye, Pencil, Check } from "lucide-react";

const CATEGORIES: Array<{ heading: string; kinds: AiTaskKind[]; blurb: string }> = [
  {
    heading: "Report cards",
    kinds: ["principal_comment", "class_teacher_comment", "polish", "rewrite_encouraging", "rewrite_positive"],
    blurb: "Draft or polish teacher and principal comments with the student's name and score in context.",
  },
  {
    heading: "Announcements & messages",
    kinds: ["announcement_draft", "sms_reminder", "polish", "shorten", "translate_formal"],
    blurb: "Turn a brief note into a school-wide announcement, a parent SMS, or a shorter version.",
  },
  {
    heading: "Website copy",
    kinds: ["website_tagline", "website_paragraph", "seo_description", "polish", "expand"],
    blurb: "Draft home-page paragraphs, taglines, and search-engine descriptions.",
  },
  {
    heading: "General",
    kinds: ["free_form", "expand", "shorten", "polish"],
    blurb: "Freeform prompt for anything else — meeting notes, staff memos, drafts.",
  },
];

export default function AiPage() {
  const { notify, ToastHost } = useToast();
  const [kind, setKind] = useState<AiTaskKind>("announcement_draft");
  const [input, setInput] = useState("");
  const [studentName, setStudentName] = useState("");
  const [averageScore, setAverageScore] = useState("");
  const [position, setPosition] = useState("");
  const [schoolName, setSchoolName] = useState("");
  const [audience, setAudience] = useState("");
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState("");
  const [viewMode, setViewMode] = useState<"preview" | "edit">("preview");
  const [justCopied, setJustCopied] = useState(false);
  const [tokens, setTokens] = useState<{ prompt: number; response: number } | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);

  const preset = AI_PRESETS[kind];
  const needsStudent = kind === "principal_comment" || kind === "class_teacher_comment";
  const needsSchool = kind === "website_tagline" || kind === "website_paragraph" || kind === "seo_description";

  async function generate() {
    setBusy(true);
    setOutput("");
    setTokens(null);
    try {
      const extra: Record<string, string> = {};
      if (needsStudent) {
        if (studentName.trim()) extra.student_name = studentName.trim();
        if (averageScore.trim()) extra.average_score = averageScore.trim();
        if (position.trim()) extra.position = position.trim();
      }
      if (needsSchool) {
        if (schoolName.trim()) extra.school_name = schoolName.trim();
        if (audience.trim()) extra.audience = audience.trim();
      }
      const result = await generateWithAi({
        kind,
        input,
        extra,
        source: "ai_module",
      });
      setOutput(result.output);
      setViewMode("preview");
      setTokens(result.tokens);
      setElapsedMs(result.elapsed_ms);
    } catch (err) {
      notify(err instanceof Error ? err.message : "AI request failed", "error");
    } finally {
      setBusy(false);
    }
  }

  async function copyOutput() {
    if (!output) return;
    try {
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        const html = renderAiOutputHtml(output);
        const item = new ClipboardItem({
          "text/plain": new Blob([output], { type: "text/plain" }),
          "text/html": new Blob([html], { type: "text/html" }),
        });
        await navigator.clipboard.write([item]);
        notify("Copied — formatting is kept when you paste into Word, Gmail, or Docs.");
      } else {
        await navigator.clipboard.writeText(output);
        notify("Copied to clipboard.");
      }
      setJustCopied(true);
      setTimeout(() => setJustCopied(false), 1800);
    } catch {
      try {
        await navigator.clipboard.writeText(output);
        notify("Copied as plain text.");
        setJustCopied(true);
        setTimeout(() => setJustCopied(false), 1800);
      } catch {
        notify("Copy blocked by browser. Select and press Ctrl+C.", "error");
      }
    }
  }

  return (
    <div className="p-6 space-y-5">
      <PageHeader
        title="AI Studio"
        subtitle="A drafting assistant for report cards, announcements, and website copy. Every request is logged."
      />

      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-1">
          <CardHeader><CardTitle>Choose a task</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {CATEGORIES.map((cat) => (
              <div key={cat.heading}>
                <div className="text-xs font-bold text-[#0F2A47] uppercase tracking-wide mb-1">{cat.heading}</div>
                <p className="text-xs text-gray-500 mb-2">{cat.blurb}</p>
                <div className="grid gap-1.5">
                  {cat.kinds.map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setKind(k)}
                      className={
                        "text-left px-3 py-2 rounded-lg border text-xs transition-colors " +
                        (kind === k
                          ? "bg-[#0F2A47] text-white border-[#0F2A47]"
                          : "bg-white border-gray-200 hover:border-[#C9A227] text-gray-700")
                      }
                    >
                      <div className="font-semibold">{AI_PRESETS[k].label}</div>
                      <div className={kind === k ? "text-white/70 mt-0.5" : "text-gray-500 mt-0.5"}>
                        {AI_PRESETS[k].description}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles size={16} className="text-[#C9A227]" />
                {preset.label}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-gray-500">{preset.description}</p>

              {needsStudent && (
                <div className="grid grid-cols-3 gap-2">
                  <input
                    value={studentName}
                    onChange={(e) => setStudentName(e.target.value)}
                    placeholder="Student name"
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                  <input
                    value={averageScore}
                    onChange={(e) => setAverageScore(e.target.value)}
                    placeholder="Average (e.g. 72%)"
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                  <input
                    value={position}
                    onChange={(e) => setPosition(e.target.value)}
                    placeholder="Position (e.g. 3 of 25)"
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
              )}

              {needsSchool && (
                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={schoolName}
                    onChange={(e) => setSchoolName(e.target.value)}
                    placeholder="School name"
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                  <input
                    value={audience}
                    onChange={(e) => setAudience(e.target.value)}
                    placeholder="Audience (parents, staff…)"
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
              )}

              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={
                  needsStudent
                    ? "Optional teacher notes to include in the comment…"
                    : kind === "sms_reminder"
                      ? "e.g. Second-term fees due Friday 15 Nov. Kindly settle to avoid disruption."
                      : "Your brief, notes, or the text you want polished…"
                }
                rows={7}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
              />
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-gray-400">{input.length} characters</span>
                <Button variant="gold" onClick={generate} loading={busy}>
                  <Sparkles size={14} /> {busy ? "Generating…" : "Generate"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className={output && !busy ? "ring-1 ring-[#C9A227]/30" : ""}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Result</CardTitle>
                {output && !busy && (
                  <div className="flex items-center gap-1">
                    <div className="flex items-center rounded-lg border border-gray-200 p-0.5 mr-1">
                      <button
                        type="button"
                        onClick={() => setViewMode("preview")}
                        title="Formatted preview"
                        className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                          viewMode === "preview" ? "bg-[#0F2A47] text-white" : "text-gray-500 hover:text-gray-700"
                        }`}
                      >
                        <Eye size={12} /> Preview
                      </button>
                      <button
                        type="button"
                        onClick={() => setViewMode("edit")}
                        title="Edit as plain text"
                        className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                          viewMode === "edit" ? "bg-[#0F2A47] text-white" : "text-gray-500 hover:text-gray-700"
                        }`}
                      >
                        <Pencil size={12} /> Edit
                      </button>
                    </div>
                    <button
                      onClick={copyOutput}
                      className="inline-flex items-center gap-1 text-xs text-[#0F2A47] hover:text-[#C9A227] px-2 py-1"
                    >
                      {justCopied ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
                      {justCopied ? "Copied" : "Copy"}
                    </button>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {busy && (
                <div className="flex items-center gap-2 text-sm text-gray-500 py-6 justify-center">
                  <Loader2 size={16} className="animate-spin" />
                  Drafting your response…
                </div>
              )}
              {!busy && !output && (
                <p className="text-sm text-gray-400 italic py-4">Your generated text appears here.</p>
              )}
              {!busy && output && viewMode === "preview" && (
                <div
                  className="rounded-lg border border-gray-200 bg-white px-4 py-3 min-h-[10rem] text-sm"
                  dangerouslySetInnerHTML={{ __html: renderAiOutputHtml(output) }}
                />
              )}
              {!busy && output && viewMode === "edit" && (
                <textarea
                  value={output}
                  onChange={(e) => setOutput(e.target.value)}
                  rows={8}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
                />
              )}
              {!busy && output && tokens && (
                <p className="text-[11px] text-gray-400 mt-2 flex items-center gap-3">
                  <Clock size={11} /> {elapsedMs}ms · {tokens.prompt} prompt tokens · {tokens.response} response tokens
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <ToastHost />
    </div>
  );
}
