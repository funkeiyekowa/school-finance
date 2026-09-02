"use client";

/**
 * Mass import for LMS courses.
 *
 * Accepts .docx, .xlsx/.csv, .md/.txt file uploads OR a pasted body,
 * runs the AI parser (lms_bulk_parse preset) to structure it into
 * lessons + quizzes, and lets the teacher review before one-click
 * committing to the DB.
 *
 * Supports three source shapes:
 *   1. Structured (xlsx/csv with header row containing a
 *      "title" column) — bypasses AI and imports directly.
 *   2. Semi-structured (docx / md / txt with headings) — AI
 *      splits sensibly, keeping content intact.
 *   3. Free prose — AI infers lessons from topic shifts.
 *
 * Every lesson gets a 3-5 question quiz generated from its own
 * content. Every insert sets organization_id per this repo's RLS
 * convention.
 */

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { useToast } from "@/lib/hooks/useToast";
import { extractErrorMessage } from "@/lib/errors/extractErrorMessage";
import { PageHeader, LoadingSpinner } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { generateWithAi } from "@/lib/ai/client";
import { extractContent, parseCsv, type RawContent } from "@/lib/import/docParser";
import {
  UploadCloud, FileText, Sparkles, ChevronDown, ChevronRight, Loader2,
  Save, ArrowLeft, CheckCircle2, HelpCircle, AlertTriangle,
} from "lucide-react";

interface CourseRow {
  id: string; title: string; description: string | null; status: string;
  subject_id: string | null; class_id: string | null;
}

interface ParsedQuestion {
  question_text: string;
  options: { id: string; text: string; is_correct: boolean }[];
  explanation?: string;
}
interface ParsedQuiz {
  pass_mark_percent: number;
  questions: ParsedQuestion[];
}
interface ParsedLesson {
  title: string;
  content: string;
  estimated_minutes: number;
  quiz?: ParsedQuiz;
}
interface ParsedCourse {
  course_description: string;
  lessons: ParsedLesson[];
}

export default function LmsMassImportPage() {
  const params = useParams<{ courseId: string }>();
  const courseId = params.courseId;
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const { orgId } = useAuth();
  const { notify, ToastHost } = useToast();

  const [course, setCourse] = useState<CourseRow | null>(null);
  const [loading, setLoading] = useState(true);

  // Source input
  const [pasted, setPasted] = useState("");
  const [subject, setSubject] = useState("");
  const [grade, setGrade] = useState("");
  const [raw, setRaw] = useState<RawContent | null>(null);
  const [uploading, setUploading] = useState(false);

  // Parsed result
  const [parsed, setParsed] = useState<ParsedCourse | null>(null);
  const [parsing, setParsing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [aiUsed, setAiUsed] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("lms_courses").select("*").eq("id", courseId).maybeSingle();
      setCourse((data as CourseRow) ?? null);
      setLoading(false);
    })();
  }, [supabase, courseId]);

  async function onFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const rc = await extractContent(file);
      setRaw(rc);
      setPasted(rc.text);
      notify(`Loaded ${file.name} (${rc.kind.toUpperCase()}, ${rc.text.length.toLocaleString()} chars).`);
    } catch (err) {
      notify(extractErrorMessage(err, "Could not read that file."), "error");
    } finally {
      setUploading(false);
    }
  }

  /** Try to parse a spreadsheet with a header row directly, no AI. */
  function tryStructuredParse(rows: string[][]): ParsedCourse | null {
    if (rows.length < 2) return null;
    const header = rows[0].map(h => h.toLowerCase().replace(/[^a-z0-9]+/g, "_"));
    const titleCol = header.indexOf("title");
    if (titleCol < 0) return null;
    const contentCol = ["content", "body", "notes", "description"].map(k => header.indexOf(k)).find(i => i >= 0) ?? -1;
    const objectiveCol = header.indexOf("objective");
    const minutesCol = ["estimated_minutes", "minutes", "duration"].map(k => header.indexOf(k)).find(i => i >= 0) ?? -1;
    const lessons: ParsedLesson[] = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const title = (r[titleCol] ?? "").trim();
      if (!title) continue;
      const bodyParts: string[] = [];
      if (objectiveCol >= 0 && r[objectiveCol]) bodyParts.push(`**Learning objective**\n\n${r[objectiveCol]}`);
      if (contentCol >= 0 && r[contentCol]) bodyParts.push(r[contentCol]);
      const est = minutesCol >= 0 ? parseInt(r[minutesCol] ?? "", 10) : NaN;
      lessons.push({
        title,
        content: bodyParts.join("\n\n"),
        estimated_minutes: isFinite(est) && est > 0 ? est : 15,
      });
    }
    if (lessons.length === 0) return null;
    return { course_description: "", lessons };
  }

  async function runParse() {
    setParsing(true);
    setParsed(null);
    setExpanded(new Set());
    setAiUsed(false);
    try {
      const src = pasted.trim();
      if (!src) throw new Error("Paste content or upload a file first.");

      // Fast path: structured CSV/XLSX with header row
      let structured: ParsedCourse | null = null;
      if (raw?.kind === "xlsx" || raw?.kind === "csv") {
        structured = tryStructuredParse(raw.rows);
      } else if (src.split("\n").length > 2 && src.includes(",")) {
        // Might be pasted CSV — try
        structured = tryStructuredParse(parseCsv(src));
      }
      if (structured) {
        setParsed(structured);
        setExpanded(new Set([0]));
        notify(`Parsed ${structured.lessons.length} lesson${structured.lessons.length === 1 ? "" : "s"} from structured columns. AI will not be used unless you ask for quizzes.`);
        return;
      }

      // AI path
      const result = await generateWithAi({
        kind: "lms_bulk_parse",
        input: src.slice(0, 20000), // safety cap
        extra: { subject, grade },
        source: "lms_bulk_import",
      });
      let cleaned = result.output.trim();
      if (cleaned.startsWith("```")) cleaned = cleaned.replace(/^```(?:json)?/, "").replace(/```$/, "").trim();
      const p = JSON.parse(cleaned) as ParsedCourse;
      if (!Array.isArray(p.lessons)) throw new Error("AI returned malformed output.");
      setParsed(p);
      setAiUsed(true);
      setExpanded(new Set([0]));
      notify(`AI extracted ${p.lessons.length} lesson${p.lessons.length === 1 ? "" : "s"}.`);
    } catch (err) {
      notify(extractErrorMessage(err, "Parse failed."), "error");
    } finally {
      setParsing(false);
    }
  }

  /** Ask AI to generate a 3-5 question quiz for a single lesson that lacks one. */
  async function generateQuizFor(idx: number) {
    if (!parsed) return;
    const lesson = parsed.lessons[idx];
    if (!lesson) return;
    try {
      const result = await generateWithAi({
        kind: "lms_quiz_generate",
        input: lesson.content || lesson.title,
        extra: { question_count: "4" },
        source: "lms_bulk_import",
      });
      let cleaned = result.output.trim();
      if (cleaned.startsWith("```")) cleaned = cleaned.replace(/^```(?:json)?/, "").replace(/```$/, "").trim();
      const q = JSON.parse(cleaned) as { questions: ParsedQuestion[] };
      const next: ParsedCourse = {
        ...parsed,
        lessons: parsed.lessons.map((l, i) => i === idx ? { ...l, quiz: { pass_mark_percent: 50, questions: q.questions } } : l),
      };
      setParsed(next);
      notify(`Added quiz to "${lesson.title}".`);
    } catch (err) {
      notify(extractErrorMessage(err, "Quiz generation failed."), "error");
    }
  }

  /** Fill full lesson content when only a title is present. */
  async function generateContentFor(idx: number) {
    if (!parsed) return;
    const lesson = parsed.lessons[idx];
    if (!lesson) return;
    try {
      const result = await generateWithAi({
        kind: "lms_lesson_generate",
        input: lesson.title,
        extra: { lesson_title: lesson.title, subject, grade },
        source: "lms_bulk_import",
      });
      const next: ParsedCourse = {
        ...parsed,
        lessons: parsed.lessons.map((l, i) => i === idx ? { ...l, content: result.output } : l),
      };
      setParsed(next);
      notify(`Filled content for "${lesson.title}".`);
    } catch (err) {
      notify(extractErrorMessage(err, "Content generation failed."), "error");
    }
  }

  async function commitAll() {
    if (!parsed || !orgId || !course) return;
    setCommitting(true);
    try {
      // Update course description if empty
      if (parsed.course_description && (!course.description || !course.description.trim())) {
        await supabase.from("lms_courses").update({ description: parsed.course_description }).eq("id", course.id);
      }

      // Existing lesson count → sort_order offset
      const { data: existingLessons } = await supabase
        .from("lms_lessons").select("id").eq("course_id", course.id);
      const startOrder = (existingLessons as { id: string }[] | null)?.length ?? 0;

      // Insert lessons
      const lessonRows = parsed.lessons.map((l, i) => ({
        organization_id: orgId,
        course_id: course.id,
        title: l.title,
        content: l.content ?? "",
        estimated_minutes: l.estimated_minutes || 15,
        sort_order: startOrder + i,
        status: "draft",
        ai_generated: aiUsed,
        ai_source_prompt: aiUsed ? `Mass import (${raw?.kind ?? "paste"}: ${raw?.name ?? "clipboard"})` : null,
      }));
      const { data: inserted, error: insErr } = await supabase.from("lms_lessons").insert(lessonRows).select("id, title");
      if (insErr) throw insErr;

      // Insert quizzes + questions
      let quizzesCreated = 0;
      let questionsCreated = 0;
      const insertedIds = (inserted as { id: string; title: string }[]) ?? [];
      for (let i = 0; i < parsed.lessons.length; i++) {
        const lesson = parsed.lessons[i];
        const lessonId = insertedIds[i]?.id;
        if (!lessonId || !lesson.quiz || !Array.isArray(lesson.quiz.questions) || lesson.quiz.questions.length === 0) continue;
        const { data: quizRow, error: quizErr } = await supabase.from("lms_quizzes").insert({
          organization_id: orgId,
          lesson_id: lessonId,
          title: `${lesson.title} — Quiz`,
          pass_mark_percent: lesson.quiz.pass_mark_percent || 50,
          ai_generated: aiUsed,
        }).select("id").single();
        if (quizErr) throw quizErr;
        quizzesCreated++;
        const qRows = lesson.quiz.questions.map((q, j) => ({
          organization_id: orgId,
          quiz_id: (quizRow as { id: string }).id,
          question_text: q.question_text,
          options: q.options,
          explanation: q.explanation ?? null,
          marks: 1,
          sort_order: j,
        }));
        const { error: qErr } = await supabase.from("lms_quiz_questions").insert(qRows);
        if (qErr) throw qErr;
        questionsCreated += qRows.length;
      }

      notify(`Imported ${insertedIds.length} lesson${insertedIds.length === 1 ? "" : "s"}, ${quizzesCreated} quiz${quizzesCreated === 1 ? "" : "zes"}, ${questionsCreated} question${questionsCreated === 1 ? "" : "s"}.`);
      router.push(`/dashboard/lms/${course.id}`);
    } catch (err) {
      notify(extractErrorMessage(err, "Import failed."), "error");
    } finally {
      setCommitting(false);
    }
  }

  function toggleExpanded(i: number) {
    const s = new Set(expanded);
    if (s.has(i)) s.delete(i); else s.add(i);
    setExpanded(s);
  }

  if (loading) return <div className="p-6"><LoadingSpinner /></div>;
  if (!course) return <div className="p-6 text-center text-gray-500">Course not found.</div>;

  const lessonsWithoutQuizzes = parsed?.lessons.filter(l => !l.quiz || l.quiz.questions.length === 0).length ?? 0;
  const lessonsWithoutContent = parsed?.lessons.filter(l => !l.content || l.content.length < 40).length ?? 0;

  return (
    <div className="p-6 space-y-5">
      <PageHeader
        icon={<UploadCloud size={24} />}
        gradient="purple"
        title="Mass import"
        subtitle={`Add lessons, content and quizzes to ${course.title} from any file or paste.`}
      >
        <Link href={`/dashboard/lms/${course.id}`}>
          <Button size="sm" variant="ghost"><ArrowLeft size={14} /> Back to course</Button>
        </Link>
      </PageHeader>

      {/* Input */}
      <Card>
        <CardHeader>
          <CardTitle>1. Bring in your material</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
            <p className="font-semibold mb-1">Any of these work — pick what you already have:</p>
            <ul className="list-disc pl-4 space-y-0.5">
              <li><strong>Word document</strong> (.docx) with headings for each lesson → AI splits it into lessons and drafts a quiz per lesson.</li>
              <li><strong>Excel / CSV</strong> with columns like <code>title, content, objective, minutes</code> → imported directly with no AI cost.</li>
              <li><strong>Plain text or Markdown</strong> notes → AI splits by heading/topic and drafts quizzes.</li>
              <li><strong>Paste anything</strong> from a curriculum PDF or teacher notes into the box below.</li>
            </ul>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="cursor-pointer flex items-center justify-center gap-2 p-4 border-2 border-dashed border-gray-300 rounded-lg text-sm hover:border-[#C9A227] hover:bg-[#FBF6E8] transition-colors">
              {uploading ? <Loader2 size={16} className="animate-spin" /> : <UploadCloud size={16} />}
              <span>Upload .docx / .xlsx / .csv / .md / .txt</span>
              <input type="file" className="hidden" accept=".docx,.xlsx,.xls,.csv,.md,.txt" onChange={onFileUpload} />
            </label>
            <div className="md:col-span-2 grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs font-semibold text-gray-500">Subject (helps AI)</label>
                <input value={subject} onChange={e => setSubject(e.target.value)}
                  placeholder="e.g. Mathematics"
                  className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500">Class / Grade</label>
                <input value={grade} onChange={e => setGrade(e.target.value)}
                  placeholder="e.g. JSS 2"
                  className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-500">Source content</label>
            <textarea
              value={pasted}
              onChange={e => setPasted(e.target.value)}
              placeholder="Paste your curriculum, notes, or a lesson plan here…"
              className="w-full mt-1 h-48 p-3 border border-gray-300 rounded-lg text-sm font-mono"
            />
            {raw && (
              <p className="mt-1 text-xs text-gray-500">
                {raw.name} · {raw.kind.toUpperCase()} · {pasted.length.toLocaleString()} characters
              </p>
            )}
          </div>

          <div className="flex justify-end">
            <Button variant="gold" onClick={runParse} loading={parsing} disabled={!pasted.trim()}>
              <Sparkles size={14} /> {parsing ? "Parsing…" : "Parse into lessons"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Preview */}
      {parsed && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle>2. Review — {parsed.lessons.length} lesson{parsed.lessons.length === 1 ? "" : "s"}</CardTitle>
              <div className="flex items-center gap-2 flex-wrap text-xs">
                {aiUsed && (
                  <span className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 font-semibold uppercase tracking-wider">
                    <Sparkles size={10} className="inline mr-0.5" /> AI parsed
                  </span>
                )}
                {lessonsWithoutContent > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold flex items-center gap-1">
                    <AlertTriangle size={10} /> {lessonsWithoutContent} lesson{lessonsWithoutContent === 1 ? "" : "s"} need content
                  </span>
                )}
                {lessonsWithoutQuizzes > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold flex items-center gap-1">
                    <HelpCircle size={10} /> {lessonsWithoutQuizzes} lesson{lessonsWithoutQuizzes === 1 ? "" : "s"} without quiz
                  </span>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {parsed.course_description && (
              <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-900">
                <p className="font-semibold mb-1">Course description (will be applied if the course has none)</p>
                <p>{parsed.course_description}</p>
              </div>
            )}

            <div className="space-y-2 max-h-96 overflow-y-auto pr-2">
              {parsed.lessons.map((l, i) => {
                const open = expanded.has(i);
                const qCount = l.quiz?.questions.length ?? 0;
                const contentPreview = (l.content || "").slice(0, 160);
                return (
                  <div key={i} className="border border-gray-200 rounded-lg bg-white">
                    <button onClick={() => toggleExpanded(i)} className="w-full flex items-center justify-between gap-3 p-3 text-left hover:bg-gray-50">
                      <div className="flex items-center gap-2 min-w-0">
                        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        <span className="text-xs text-gray-500 shrink-0">{i + 1}.</span>
                        <span className="font-semibold text-[#0F2A47] truncate">{l.title}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 text-[10px]">
                        <span className="text-gray-500">{(l.content || "").length.toLocaleString()} chars</span>
                        {qCount > 0 ? (
                          <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-semibold">
                            {qCount} quiz Q
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-semibold">no quiz</span>
                        )}
                      </div>
                    </button>
                    {!open && contentPreview && (
                      <p className="px-3 pb-3 text-xs text-gray-500 line-clamp-1">{contentPreview}…</p>
                    )}
                    {open && (
                      <div className="px-3 pb-3 space-y-3">
                        <div>
                          <p className="text-[10px] uppercase font-bold text-gray-500 mb-1">Content</p>
                          <textarea
                            value={l.content}
                            onChange={e => {
                              const next = { ...parsed, lessons: parsed.lessons.map((x, idx) => idx === i ? { ...x, content: e.target.value } : x) };
                              setParsed(next);
                            }}
                            className="w-full h-32 p-2 border border-gray-200 rounded text-xs font-mono"
                          />
                          <div className="flex justify-end mt-1">
                            <Button size="sm" variant="ghost" onClick={() => generateContentFor(i)}>
                              <Sparkles size={11} /> Generate content
                            </Button>
                          </div>
                        </div>
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <p className="text-[10px] uppercase font-bold text-gray-500">Quiz ({qCount} question{qCount === 1 ? "" : "s"})</p>
                            {qCount === 0 && (
                              <Button size="sm" variant="ghost" onClick={() => generateQuizFor(i)}>
                                <Sparkles size={11} /> Generate quiz
                              </Button>
                            )}
                          </div>
                          {qCount > 0 && (
                            <ul className="text-xs space-y-1">
                              {l.quiz!.questions.map((q, qi) => (
                                <li key={qi} className="border border-gray-100 rounded p-2 bg-gray-50">
                                  <p className="font-medium">{qi + 1}. {q.question_text}</p>
                                  <ul className="mt-1 pl-4 space-y-0.5">
                                    {q.options.map(o => (
                                      <li key={o.id} className={o.is_correct ? "text-emerald-700 font-semibold" : "text-gray-600"}>
                                        {o.is_correct && <CheckCircle2 size={10} className="inline mr-1" />}
                                        {o.text}
                                      </li>
                                    ))}
                                  </ul>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between gap-2 pt-2 border-t border-gray-100 flex-wrap">
              <p className="text-xs text-gray-500 italic">
                Everything above will be inserted as drafts. You can still edit each lesson afterwards.
              </p>
              <div className="flex items-center gap-2">
                <Button variant="secondary" onClick={() => { setParsed(null); setExpanded(new Set()); }}>
                  Discard preview
                </Button>
                <Button variant="gold" onClick={commitAll} loading={committing}>
                  <Save size={14} /> Add {parsed.lessons.length} lesson{parsed.lessons.length === 1 ? "" : "s"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <ToastHost />
    </div>
  );
}
