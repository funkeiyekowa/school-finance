"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { fmtDateTime, cn } from "@/lib/utils";
import { PageHeader, LoadingSpinner } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Plus, BookOpen, FileText, Save, Trash2, Upload, Link2, Copy, Pencil, Sparkles, Loader2 } from "lucide-react";

interface SubjectRow { id: string; name: string; short_code: string; }
interface ClassRow { id: string; name: string; }
interface QuestionRow { id: string; question_text: string; question_type: string; difficulty: string; marks: number; subject_id: string | null; topic: string | null; options: unknown; answer_text?: string | null; }
interface ExamRow { id: string; title: string; exam_type: string; status: string; duration_minutes: number; total_marks: number; pass_mark: number; max_attempts: number; class_id: string | null; subject_id: string | null; shuffle_questions: boolean; shuffle_options: boolean; show_results: boolean; show_answers: boolean; settings: Record<string, unknown>; created_at: string; }
interface ExamQuestionRow { id: string; exam_id: string; question_id: string; sort_order: number; }
interface StudentRow { id: string; full_name: string; student_code: string; grade: string | null; }
interface AssignmentRow { id: string; exam_id: string; student_id: string | null; class_id: string | null; available_from: string | null; available_to: string | null; }

/**
 * CSV template for the bulk uploader.
 *
 * Columns (in order):
 *   question_type, question_text, option_a, option_b, option_c, option_d,
 *   correct_option, answer_text, difficulty, marks, topic, explanation,
 *   case_sensitive, matching_pairs
 *
 * - `correct_option` accepts:
 *     A / B / C / D / "A|B" (piped list) for multiple_choice / multi_answer / true_false.
 * - `answer_text` holds the correct answer for short_answer / fill_blank / numeric.
 * - `explanation` is shown to the student after grading (optional).
 * - `case_sensitive` is TRUE/FALSE, only used by short_answer / fill_blank.
 * - `matching_pairs` is a semicolon-separated list of "left=right" pairs,
 *     e.g. "Nigeria=Abuja; Ghana=Accra; Kenya=Nairobi" — used only when
 *     question_type is `matching`.
 *
 * Every other column may be empty.
 */
const CSV_TEMPLATE = `question_type,question_text,option_a,option_b,option_c,option_d,correct_option,answer_text,difficulty,marks,topic,explanation,case_sensitive,matching_pairs
multiple_choice,"What is 2+2?","2","3","4","5","C","","easy","1","Math","2+2 equals 4","",""
true_false,"The sky is blue.","True","False","","","A","","easy","1","General","","",""
multi_answer,"Which are primary colours?","Red","Green","Blue","Yellow","A|C","","medium","2","Art","Red and blue are primary; green and yellow are secondary/mixed.","",""
short_answer,"Capital of France?","","","","","","Paris","medium","2","Geography","","false",""
fill_blank,"Water boils at ___ Celsius.","","","","","","100","medium","2","Science","","false",""
numeric,"What is 5 * 3?","","","","","","15","easy","1","Math","","",""
essay,"Explain photosynthesis.","","","","","","","hard","10","Biology","","",""
matching,"Match the country to its capital.","","","","","","","medium","3","Geography","","","Nigeria=Abuja; Ghana=Accra; Kenya=Nairobi"`;

export default function CbtPage() {
  const { canEdit, profile, orgId } = useAuth();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"exams" | "questions">("exams");
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [questions, setQuestions] = useState<QuestionRow[]>([]);
  const [exams, setExams] = useState<ExamRow[]>([]);

  // Question form
  const [showQForm, setShowQForm] = useState(false);
  const [savingQ, setSavingQ] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<QuestionRow | null>(null);
  const [qForm, setQForm] = useState({ question_text: "", question_type: "multiple_choice", subject_id: "", topic: "", difficulty: "medium", marks: "1", answer_text: "", options: [{ id: "A", text: "", is_correct: true }, { id: "B", text: "", is_correct: false }, { id: "C", text: "", is_correct: false }, { id: "D", text: "", is_correct: false }] });

  // Bulk upload
  const [showBulkForm, setShowBulkForm] = useState(false);
  const [bulkCsv, setBulkCsv] = useState("");
  const [bulkSubjectId, setBulkSubjectId] = useState("");
  const [bulkUploading, setBulkUploading] = useState(false);
  const [bulkResult, setBulkResult] = useState<string | null>(null);
  const [bulkExtracting, setBulkExtracting] = useState(false);
  const [bulkAiParsing, setBulkAiParsing] = useState(false);

  async function handleBulkFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBulkExtracting(true);
    try {
      const { extractContent } = await import("@/lib/import/docParser");
      const rc = await extractContent(file);
      if (rc.kind === "csv" || rc.kind === "xlsx") {
        // If the file already has a CSV/xlsx table with a header row, load
        // it in a form the existing CSV parser accepts.
        if (rc.rows.length > 0) {
          const csvLines = rc.rows.map(r => r.map(c => c.includes(",") || c.includes('"') || c.includes("\n") ? `"${c.replace(/"/g, '""')}"` : c).join(",")).join("\n");
          setBulkCsv(csvLines);
        } else {
          setBulkCsv(rc.text);
        }
      } else {
        // Free text — keep raw and offer "AI parse" button
        setBulkCsv(rc.text);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Could not read file");
    } finally {
      setBulkExtracting(false);
    }
  }

  async function bulkAiParse() {
    if (!bulkCsv.trim()) return;
    setBulkAiParsing(true);
    try {
      const { generateWithAi } = await import("@/lib/ai/client");
      const result = await generateWithAi({
        kind: "lms_quiz_generate",
        input: bulkCsv.slice(0, 15000),
        extra: { question_count: "20" },
        source: "cbt_bulk_ai_parse",
      });
      let cleaned = result.output.trim();
      if (cleaned.startsWith("```")) cleaned = cleaned.replace(/^```(?:json)?/, "").replace(/```$/, "").trim();
      const parsed = JSON.parse(cleaned) as { questions: { question_text: string; options: { id: string; text: string; is_correct: boolean }[]; explanation?: string }[] };
      // Convert to CSV rows the existing uploader understands.
      const header = "question_type,question_text,option_a,option_b,option_c,option_d,correct_option,answer_text,difficulty,marks,topic,explanation,case_sensitive,matching_pairs";
      const rows = [header];
      for (const q of parsed.questions) {
        const opts = q.options ?? [];
        const a = opts[0]?.text ?? "";
        const b = opts[1]?.text ?? "";
        const c = opts[2]?.text ?? "";
        const d = opts[3]?.text ?? "";
        const correctIdx = opts.findIndex(o => o.is_correct);
        const correct = ["A", "B", "C", "D"][correctIdx] ?? "A";
        const esc = (s: string) => `"${(s ?? "").replace(/"/g, '""')}"`;
        rows.push([
          "multiple_choice", esc(q.question_text), esc(a), esc(b), esc(c), esc(d),
          correct, "", "medium", "1", "", esc(q.explanation ?? ""), "false", "",
        ].join(","));
      }
      setBulkCsv(rows.join("\n"));
      setBulkResult(`AI extracted ${parsed.questions.length} question${parsed.questions.length === 1 ? "" : "s"} — review and click Upload.`);
    } catch (err) {
      alert(err instanceof Error ? err.message : "AI parse failed");
    } finally {
      setBulkAiParsing(false);
    }
  }


  // Exam form (create + edit)
  const [showExamForm, setShowExamForm] = useState(false);
  const [savingExam, setSavingExam] = useState(false);
  const [editingExam, setEditingExam] = useState<ExamRow | null>(null);
  const [examForm, setExamForm] = useState({ title: "", exam_type: "exam", subject_id: "", class_id: "", duration_minutes: "60", max_attempts: "1", pass_mark: "0", shuffle_questions: false, shuffle_options: false, show_results: true, show_answers: false, proctored: false, fullscreen_required: false, sign_out_on_violation: true, max_violations: "3", starts_at: "", ends_at: "" });

  // Exam questions panel
  const [selectedExam, setSelectedExam] = useState<ExamRow | null>(null);
  const [examQuestions, setExamQuestions] = useState<ExamQuestionRow[]>([]);

  // Assignment modal
  const [assignExam, setAssignExam] = useState<ExamRow | null>(null);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [existingAssignments, setExistingAssignments] = useState<AssignmentRow[]>([]);
  const [assignMode, setAssignMode] = useState<"class" | "students">("class");
  const [assignClassId, setAssignClassId] = useState<string>("");
  const [assignStudentIds, setAssignStudentIds] = useState<Set<string>>(new Set());
  const [assignFrom, setAssignFrom] = useState<string>("");
  const [assignUntil, setAssignUntil] = useState<string>("");
  const [assignSaving, setAssignSaving] = useState(false);
  const [assignFilter, setAssignFilter] = useState<string>("");

  // Exam link
  const [copiedLink, setCopiedLink] = useState(false);

  const load = useCallback(async () => {
    const [subRes, clsRes, qRes, exRes] = await Promise.all([
      supabase.from("subjects").select("id, name, short_code").eq("active", true).order("name"),
      supabase.from("classes").select("id, name").eq("active", true).order("sequence"),
      supabase.from("questions").select("*").eq("active", true).order("created_at", { ascending: false }),
      supabase.from("exams").select("*").order("created_at", { ascending: false }),
    ]);
    setSubjects(subRes.data as SubjectRow[] ?? []);
    setClasses(clsRes.data as ClassRow[] ?? []);
    setQuestions(qRes.data as QuestionRow[] ?? []);
    setExams(exRes.data as ExamRow[] ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  // --- Question CRUD ---
  const EMPTY_QFORM = { question_text: "", question_type: "multiple_choice", subject_id: "", topic: "", difficulty: "medium", marks: "1", answer_text: "", options: [{ id: "A", text: "", is_correct: true }, { id: "B", text: "", is_correct: false }, { id: "C", text: "", is_correct: false }, { id: "D", text: "", is_correct: false }] };

  // Open the question form for a NEW question, or hydrate it from an
  // existing one so its options and correct answer can be reviewed/edited
  // after saving.
  function openQForm(q?: QuestionRow) {
    if (q) {
      const rawOpts = Array.isArray(q.options) ? (q.options as { id: string; text: string; is_correct?: boolean }[]) : [];
      // Normalise to the 4-slot A–D shape the editor expects, preserving the
      // stored ids/text/correct flag. If a question has fewer/more options we
      // keep whatever is there rather than forcing exactly four.
      const options = rawOpts.length > 0
        ? rawOpts.map((o, i) => ({ id: o.id ?? ["A", "B", "C", "D"][i] ?? String(i + 1), text: o.text ?? "", is_correct: o.is_correct === true }))
        : EMPTY_QFORM.options.map(o => ({ ...o }));
      setEditingQuestion(q);
      setQForm({
        question_text: q.question_text,
        question_type: q.question_type,
        subject_id: q.subject_id || "",
        topic: q.topic || "",
        difficulty: q.difficulty || "medium",
        marks: String(q.marks ?? 1),
        answer_text: q.answer_text || "",
        options,
      });
    } else {
      setEditingQuestion(null);
      setQForm({ ...EMPTY_QFORM, options: EMPTY_QFORM.options.map(o => ({ ...o })) });
    }
    setShowQForm(true);
  }

  async function saveQuestion() {
    if (!orgId) {
      alert("No active organization. Please refresh or switch organization and try again.");
      return;
    }
    setSavingQ(true);
    const payload = {
      question_text: qForm.question_text.trim(),
      question_type: qForm.question_type,
      subject_id: qForm.subject_id || null,
      topic: qForm.topic.trim() || null,
      difficulty: qForm.difficulty,
      marks: parseFloat(qForm.marks) || 1,
      options: qForm.options,
      answer_text: qForm.answer_text || null,
      updated_at: new Date().toISOString(),
    };
    const { error } = editingQuestion
      ? await supabase.from("questions").update(payload).eq("id", editingQuestion.id)
      : await supabase.from("questions").insert({ ...payload, organization_id: orgId, created_by: profile?.full_name });
    setSavingQ(false);
    if (error) {
      alert(`Failed to save question: ${error.message}${error.hint ? "\nHint: " + error.hint : ""}`);
      console.error("saveQuestion error:", error);
      return;
    }
    setShowQForm(false);
    setEditingQuestion(null);
    setQForm({ ...EMPTY_QFORM, options: EMPTY_QFORM.options.map(o => ({ ...o })) });
    load();
  }

  // --- Bulk Upload ---
  function downloadTemplate() {
    const blob = new Blob([CSV_TEMPLATE], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "question_template.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * CSV row parser. Handles quoted commas and escaped double quotes
   * ("") within quoted cells. Does not attempt to handle embedded
   * newlines inside cells — those should not appear in this template.
   */
  function parseCsvLine(line: string): string[] {
    const out: string[] = [];
    let cur = "";
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { cur += '"'; i++; continue; }
        inQuote = !inQuote;
        continue;
      }
      if (ch === "," && !inQuote) { out.push(cur.trim()); cur = ""; continue; }
      cur += ch;
    }
    out.push(cur.trim());
    return out;
  }

  async function uploadBulk() {
    setBulkUploading(true); setBulkResult(null);
    const rawLines = bulkCsv.trim().split(/\r?\n/);
    if (rawLines.length === 0) { setBulkUploading(false); return; }
    const lines = rawLines.slice(1); // skip header

    let added = 0, failed = 0;
    const errors: string[] = [];

    const knownTypes = new Set([
      "multiple_choice", "true_false", "multi_answer",
      "short_answer", "fill_blank", "numeric", "essay", "matching",
    ]);

    for (const line of lines) {
      if (!line.trim()) continue;
      const cols = parseCsvLine(line);

      /* Column indices (may be missing on legacy rows) */
      let qType: string, qText: string, optA: string, optB: string, optC: string, optD: string;
      let correct: string, answerText: string, diff: string, marks: string, topic: string;
      let explanation = "";
      let caseSensitive = "";
      let matchingPairs = "";

      if (knownTypes.has(cols[0])) {
        [
          qType, qText, optA, optB, optC, optD, correct, answerText,
          diff, marks, topic, explanation = "", caseSensitive = "", matchingPairs = "",
        ] = cols;
      } else {
        // Legacy MCQ-only format: first col is the question text
        qType = "multiple_choice";
        [qText, optA, optB, optC, optD, correct, diff, marks, topic] = cols;
        answerText = "";
      }

      let options: unknown = null;
      let answer: string | null = null;

      if (qType === "multiple_choice") {
        const correctId = (correct || "A").toUpperCase();
        options = [
          { id: "A", text: optA, is_correct: correctId === "A" },
          { id: "B", text: optB, is_correct: correctId === "B" },
          { id: "C", text: optC, is_correct: correctId === "C" },
          { id: "D", text: optD, is_correct: correctId === "D" },
        ];
      } else if (qType === "true_false") {
        const correctId = (correct || "A").toUpperCase();
        options = [
          { id: "A", text: optA || "True",  is_correct: correctId === "A" },
          { id: "B", text: optB || "False", is_correct: correctId === "B" },
        ];
      } else if (qType === "multi_answer") {
        const correctSet = new Set((correct || "").toUpperCase().split(/[|,]/).map(s => s.trim()));
        options = [
          { id: "A", text: optA, is_correct: correctSet.has("A") },
          { id: "B", text: optB, is_correct: correctSet.has("B") },
          { id: "C", text: optC, is_correct: correctSet.has("C") },
          { id: "D", text: optD, is_correct: correctSet.has("D") },
        ].filter(o => o.text);
      } else if (qType === "matching") {
        const pairs = matchingPairs
          .split(/;\s*/)
          .map(pair => {
            const [left, right] = pair.split("=").map(s => s.trim());
            return left && right ? { left, right } : null;
          })
          .filter((p): p is { left: string; right: string } => !!p);
        if (pairs.length === 0) {
          failed++;
          errors.push(`Skipped matching row (no valid pairs): ${qText.slice(0, 40)}`);
          continue;
        }
        options = { pairs };
      } else {
        // short_answer / fill_blank / numeric / essay
        answer = answerText || null;
      }

      const payload: Record<string, unknown> = {
        question_text: qText,
        question_type: qType,
        options,
        answer_text: answer,
        explanation: explanation.trim() || null,
        case_sensitive: caseSensitive.trim().toLowerCase() === "true",
        difficulty: diff || "medium",
        marks: parseFloat(marks) || 1,
        topic: topic || null,
        subject_id: bulkSubjectId || null,
        organization_id: orgId,
        created_by: profile?.full_name,
      };

      const { error } = await supabase.from("questions").insert(payload);
      if (error) {
        failed++;
        errors.push(`${qText.slice(0, 30)}: ${error.message}`);
      } else {
        added++;
      }
    }

    const errorHint = errors.length > 0 ? `\nFirst error: ${errors[0]}` : "";
    setBulkResult(`${added} question(s) added, ${failed} failed.${errorHint}`);
    setBulkUploading(false);
    load();
  }

  // --- Exam CRUD ---
  function openExamForm(exam?: ExamRow) {
    if (exam) {
      setEditingExam(exam);
      const s = (exam.settings || {}) as Record<string, unknown>;
      setExamForm({ title: exam.title, exam_type: exam.exam_type, subject_id: exam.subject_id || "", class_id: exam.class_id || "", duration_minutes: String(exam.duration_minutes), max_attempts: String(exam.max_attempts), pass_mark: String(exam.pass_mark || 0), shuffle_questions: exam.shuffle_questions, shuffle_options: exam.shuffle_options, show_results: exam.show_results, show_answers: exam.show_answers, proctored: s.proctored === true, fullscreen_required: s.fullscreen_required === true, sign_out_on_violation: s.sign_out_on_violation !== false, max_violations: String((s.max_violations as number) || 3), starts_at: (exam as unknown as { starts_at?: string | null }).starts_at ? (exam as unknown as { starts_at?: string | null }).starts_at!.slice(0, 16) : "", ends_at: (exam as unknown as { ends_at?: string | null }).ends_at ? (exam as unknown as { ends_at?: string | null }).ends_at!.slice(0, 16) : "" });
    } else {
      setEditingExam(null);
      setExamForm({ title: "", exam_type: "exam", subject_id: "", class_id: "", duration_minutes: "60", max_attempts: "1", pass_mark: "0", shuffle_questions: false, shuffle_options: false, show_results: true, show_answers: false, proctored: false, fullscreen_required: false, sign_out_on_violation: true, max_violations: "3", starts_at: "", ends_at: "" });
    }
    setShowExamForm(true);
  }

  async function saveExam() {
    if (!orgId) {
      alert("No active organization. Please refresh or switch organization and try again.");
      return;
    }
    setSavingExam(true);
    const payload = {
      title: examForm.title.trim(), exam_type: examForm.exam_type,
      subject_id: examForm.subject_id || null, class_id: examForm.class_id || null,
      duration_minutes: parseInt(examForm.duration_minutes) || 60,
      max_attempts: parseInt(examForm.max_attempts) || 1,
      pass_mark: parseFloat(examForm.pass_mark) || 0,
      shuffle_questions: examForm.shuffle_questions, shuffle_options: examForm.shuffle_options,
      show_results: examForm.show_results, show_answers: examForm.show_answers,
      settings: {
        proctored: examForm.proctored,
        fullscreen_required: examForm.fullscreen_required,
        sign_out_on_violation: examForm.sign_out_on_violation,
        max_violations: parseInt(examForm.max_violations) || 3,
      },
      starts_at: examForm.starts_at ? new Date(examForm.starts_at).toISOString() : null,
      ends_at: examForm.ends_at ? new Date(examForm.ends_at).toISOString() : null,
      organization_id: orgId, updated_at: new Date().toISOString(),
    };
    const { error } = editingExam
      ? await supabase.from("exams").update(payload).eq("id", editingExam.id)
      : await supabase.from("exams").insert({ ...payload, status: "draft", created_by: profile?.full_name });
    setSavingExam(false);
    if (error) {
      alert(`Failed to save exam: ${error.message}${error.hint ? "\nHint: " + error.hint : ""}`);
      console.error("saveExam error:", error);
      return;
    }
    setShowExamForm(false); setEditingExam(null); load();
  }

  async function publishExam(examId: string) { await supabase.from("exams").update({ status: "published", updated_at: new Date().toISOString() }).eq("id", examId); load(); }
  async function closeExam(examId: string) { await supabase.from("exams").update({ status: "closed", updated_at: new Date().toISOString() }).eq("id", examId); load(); }

  // --- Exam Questions ---
  async function openExamQuestions(exam: ExamRow) {
    setSelectedExam(exam);
    const { data } = await supabase.from("exam_questions").select("*").eq("exam_id", exam.id).order("sort_order");
    setExamQuestions(data as ExamQuestionRow[] ?? []);
  }

  async function addQuestionToExam(questionId: string) {
    if (!selectedExam) return;
    if (!orgId) {
      alert("No active organization. Please refresh or switch organization and try again.");
      return;
    }
    const { error: insErr } = await supabase.from("exam_questions").insert({
      exam_id: selectedExam.id,
      question_id: questionId,
      sort_order: examQuestions.length + 1,
      organization_id: orgId,
    });
    if (insErr) {
      alert(`Failed to add question: ${insErr.message}${insErr.hint ? "\nHint: " + insErr.hint : ""}`);
      console.error("addQuestionToExam error:", insErr);
      return;
    }
    const q = questions.find(q => q.id === questionId);
    if (q) {
      const { error: updErr } = await supabase.from("exams")
        .update({ total_marks: (selectedExam.total_marks || 0) + q.marks })
        .eq("id", selectedExam.id);
      if (updErr) console.error("update total_marks error:", updErr);
    }
    openExamQuestions(selectedExam); load();
  }

  async function removeQuestionFromExam(eqId: string, questionId: string) {
    if (!selectedExam) return;
    const { error: delErr } = await supabase.from("exam_questions").delete().eq("id", eqId);
    if (delErr) {
      alert(`Failed to remove question: ${delErr.message}`);
      console.error("removeQuestionFromExam error:", delErr);
      return;
    }
    const q = questions.find(q => q.id === questionId);
    if (q) {
      const { error: updErr } = await supabase.from("exams")
        .update({ total_marks: Math.max(0, (selectedExam.total_marks || 0) - q.marks) })
        .eq("id", selectedExam.id);
      if (updErr) console.error("update total_marks error:", updErr);
    }
    openExamQuestions(selectedExam); load();
  }

  /* -----------------------------------------------------------
   * Exam assignment
   * ---------------------------------------------------------- */

  async function openAssignModal(exam: ExamRow) {
    setAssignExam(exam);
    setAssignMode(exam.class_id ? "class" : "class");
    setAssignClassId(exam.class_id || "");
    setAssignStudentIds(new Set());
    setAssignFilter("");
    setAssignFrom("");
    setAssignUntil("");
    const [stuRes, existRes] = await Promise.all([
      supabase.from("students").select("id, full_name, student_code, grade").eq("status", "active").order("full_name"),
      supabase.from("cbt_exam_assignments").select("*").eq("exam_id", exam.id),
    ]);
    setStudents(stuRes.data as StudentRow[] ?? []);
    setExistingAssignments(existRes.data as AssignmentRow[] ?? []);
  }

  async function saveAssignment() {
    if (!assignExam || !orgId) return;
    setAssignSaving(true);
    const from = assignFrom ? new Date(assignFrom).toISOString() : null;
    const to = assignUntil ? new Date(assignUntil).toISOString() : null;

    if (assignMode === "class") {
      if (!assignClassId) {
        alert("Pick a class to assign to."); setAssignSaving(false); return;
      }
      // Remove any prior class-only assignment for this exam+class so
      // re-saving with new dates does not accumulate rows.
      await supabase.from("cbt_exam_assignments")
        .delete()
        .eq("exam_id", assignExam.id)
        .eq("class_id", assignClassId)
        .is("student_id", null);
      const { error } = await supabase.from("cbt_exam_assignments").insert({
        organization_id: orgId,
        exam_id: assignExam.id,
        class_id: assignClassId,
        student_id: null,
        available_from: from,
        available_to: to,
        assigned_by: profile?.id ?? null,
      });
      if (error) {
        alert(`Failed to save assignment: ${error.message}`);
        setAssignSaving(false); return;
      }
    } else {
      if (assignStudentIds.size === 0) {
        alert("Pick at least one student."); setAssignSaving(false); return;
      }
      // Drop any prior per-student assignments for the selected students on
      // this exam so we can re-save cleanly.
      await supabase.from("cbt_exam_assignments")
        .delete()
        .eq("exam_id", assignExam.id)
        .in("student_id", Array.from(assignStudentIds));
      const rows = Array.from(assignStudentIds).map(sid => ({
        organization_id: orgId,
        exam_id: assignExam.id,
        student_id: sid,
        class_id: null,
        available_from: from,
        available_to: to,
        assigned_by: profile?.id ?? null,
      }));
      const { error } = await supabase.from("cbt_exam_assignments").insert(rows);
      if (error) {
        alert(`Failed to save assignment: ${error.message}`);
        setAssignSaving(false); return;
      }
    }

    // Refresh the list so the assignment count updates.
    const { data: refreshed } = await supabase.from("cbt_exam_assignments")
      .select("*").eq("exam_id", assignExam.id);
    setExistingAssignments(refreshed as AssignmentRow[] ?? []);
    setAssignSaving(false);
    setAssignExam(null);
  }

  async function unassign(row: AssignmentRow) {
    if (!confirm("Remove this assignment?")) return;
    await supabase.from("cbt_exam_assignments").delete().eq("id", row.id);
    if (assignExam) {
      const { data: refreshed } = await supabase.from("cbt_exam_assignments")
        .select("*").eq("exam_id", assignExam.id);
      setExistingAssignments(refreshed as AssignmentRow[] ?? []);
    }
  }

  function getExamLink(examId: string) {
    return `${typeof window !== "undefined" ? window.location.origin : ""}/dashboard/cbt/${examId}/take`;
  }

  function copyLink(examId: string) {
    navigator.clipboard.writeText(getExamLink(examId));
    setCopiedLink(true); setTimeout(() => setCopiedLink(false), 2000);
  }

  if (loading) return <div className="p-6"><LoadingSpinner /></div>;

  return (
    <div className="p-6 space-y-5">
      <PageHeader
        icon={<FileText size={24} />}
        gradient="navy" title="CBT / Online Exams" subtitle="Manage question bank, create and assign exams" />

      <div className="flex gap-2">
        <button onClick={() => setTab("exams")} className={cn("flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg", tab === "exams" ? "bg-[#0F2A47] text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200")}><FileText size={14} /> Exams ({exams.length})</button>
        <button onClick={() => setTab("questions")} className={cn("flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg", tab === "questions" ? "bg-[#0F2A47] text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200")}><BookOpen size={14} /> Question Bank ({questions.length})</button>
      </div>

      {/* EXAMS TAB */}
      {tab === "exams" && (
        <Card>
          <CardHeader><div className="flex items-center justify-between"><CardTitle>Exams</CardTitle>{canEdit && <Button size="sm" variant="gold" onClick={() => openExamForm()}><Plus size={14} /> Create Exam</Button>}</div></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="bg-gray-50 border-b">
                  <th className="text-left px-3 py-2 font-semibold text-gray-600">Title</th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-600">Type</th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-600">Class</th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-600">Duration</th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-600">Marks</th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-600">Status</th>
                  <th className="px-3 py-2" />
                </tr></thead>
                <tbody>
                  {exams.map(exam => (
                    <tr key={exam.id} className="border-b hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium">{exam.title}</td>
                      <td className="px-3 py-2 text-gray-500 text-xs uppercase">{exam.exam_type}</td>
                      <td className="px-3 py-2 text-gray-500">{classes.find(c => c.id === exam.class_id)?.name || "All"}</td>
                      <td className="px-3 py-2 text-gray-500">{exam.duration_minutes}m</td>
                      <td className="px-3 py-2 text-gray-500">{exam.total_marks}</td>
                      <td className="px-3 py-2"><span className={cn("px-2 py-0.5 rounded text-[10px] font-bold uppercase", exam.status === "published" ? "bg-green-100 text-green-700" : exam.status === "draft" ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-500")}>{exam.status}</span></td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center gap-1 justify-end">
                          <button onClick={() => openExamQuestions(exam)} className="text-xs text-[#0F2A47] hover:underline">Qs</button>
                          {canEdit && <button onClick={() => openAssignModal(exam)} className="text-xs text-purple-700 hover:underline">Assign</button>}
                          {canEdit && <button onClick={() => openExamForm(exam)} className="text-xs text-blue-700 hover:underline">Edit</button>}
                          {exam.status === "published" && <button onClick={() => copyLink(exam.id)} className="text-xs text-[#C9A227] hover:underline flex items-center gap-0.5"><Link2 size={10} />{copiedLink ? "Copied" : "Link"}</button>}
                          {exam.status === "draft" && canEdit && <button onClick={() => publishExam(exam.id)} className="text-xs text-green-700 hover:underline">Publish</button>}
                          {exam.status === "published" && canEdit && <button onClick={() => closeExam(exam.id)} className="text-xs text-red-600 hover:underline">Close</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {exams.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-400">No exams yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* QUESTIONS TAB */}
      {tab === "questions" && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Question Bank</CardTitle>
              <div className="flex gap-2">
                {canEdit && <Button size="sm" variant="secondary" onClick={() => setShowBulkForm(true)}><Upload size={14} /> Bulk Upload</Button>}
                {canEdit && <Button size="sm" variant="gold" onClick={() => openQForm()}><Plus size={14} /> Add Question</Button>}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-[500px] overflow-y-auto">
              {questions.map((q, i) => {
                const opts = Array.isArray(q.options) ? (q.options as { id: string; text: string; is_correct?: boolean }[]) : [];
                const isChoice = q.question_type === "multiple_choice" || q.question_type === "true_false" || q.question_type === "multi_answer";
                return (
                <div key={q.id} className="flex items-start gap-3 p-3 border rounded-lg hover:bg-gray-50">
                  <span className="shrink-0 w-6 h-6 rounded-full bg-[#0F2A47] text-white flex items-center justify-center text-[10px] font-bold mt-0.5">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900 line-clamp-2">{q.question_text}</p>
                    <div className="flex items-center gap-2 mt-1 text-[10px] text-gray-500">
                      <span className={cn("px-1.5 py-0.5 rounded font-bold uppercase", q.difficulty === "easy" ? "bg-green-50 text-green-600" : q.difficulty === "hard" ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-600")}>{q.difficulty}</span>
                      <span>{q.question_type.replace("_", " ")}</span>
                      <span>{q.marks}mk</span>
                      {q.topic && <span>· {q.topic}</span>}
                    </div>
                    {/* Answer preview so the saved answer key is visible without opening the editor. */}
                    {isChoice && opts.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {opts.map(o => (
                          <span key={o.id} className={cn(
                            "px-1.5 py-0.5 rounded text-[10px] border",
                            o.is_correct ? "bg-green-50 border-green-300 text-green-700 font-semibold" : "bg-gray-50 border-gray-200 text-gray-500"
                          )}>
                            {o.id}. {o.text || "—"}{o.is_correct ? " ✓" : ""}
                          </span>
                        ))}
                      </div>
                    )}
                    {!isChoice && q.answer_text && (
                      <div className="mt-1.5 text-[10px] text-green-700">Answer: <span className="font-semibold">{q.answer_text}</span> ✓</div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {canEdit && (
                      <Button size="sm" variant="ghost" onClick={() => openQForm(q)} title="Edit question & answers"><Pencil size={13} /></Button>
                    )}
                    {selectedExam && !examQuestions.find(eq => eq.question_id === q.id) && (
                      <Button size="sm" variant="secondary" onClick={() => addQuestionToExam(q.id)}>+ Add</Button>
                    )}
                  </div>
                </div>
                );
              })}
              {questions.length === 0 && <p className="text-center py-8 text-gray-400 text-sm">No questions yet.</p>}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Exam Questions Panel */}
      {selectedExam && (
        <Card>
          <CardHeader><div className="flex items-center justify-between"><CardTitle>Questions in: {selectedExam.title} ({examQuestions.length})</CardTitle><button onClick={() => setSelectedExam(null)} className="text-xs text-gray-500 hover:underline">Close</button></div></CardHeader>
          <CardContent>
            {examQuestions.length === 0 ? <p className="text-sm text-gray-400 text-center py-4">No questions. Go to Question Bank and click &ldquo;+ Add&rdquo;.</p> : (
              <div className="space-y-1">{examQuestions.map((eq, i) => { const q = questions.find(x => x.id === eq.question_id); return (<div key={eq.id} className="flex items-center gap-3 p-2 border rounded hover:bg-gray-50"><span className="text-xs text-gray-400 w-6">{i + 1}.</span><span className="flex-1 text-sm text-gray-800 truncate">{q?.question_text || "?"}</span><span className="text-xs text-gray-400">{q?.marks}mk</span><button onClick={() => removeQuestionFromExam(eq.id, eq.question_id)} className="text-red-400 hover:text-red-600"><Trash2 size={13} /></button></div>); })}</div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ADD / EDIT QUESTION MODAL */}
      {showQForm && (
        <Modal open onClose={() => { setShowQForm(false); setEditingQuestion(null); }} title={editingQuestion ? "Edit Question" : "Add Question"} size="lg">
          <div className="space-y-4">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Question</label><textarea rows={3} value={qForm.question_text} onChange={e => setQForm(f => ({ ...f, question_text: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]" placeholder="Enter question..." /></div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Type</label><select value={qForm.question_type} onChange={e => setQForm(f => ({ ...f, question_type: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"><option value="multiple_choice">Multiple Choice</option><option value="true_false">True / False</option><option value="short_answer">Short Answer</option><option value="essay">Essay</option><option value="fill_blank">Fill in the Blank</option><option value="numeric">Numeric</option></select></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Subject</label><select value={qForm.subject_id} onChange={e => setQForm(f => ({ ...f, subject_id: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"><option value="">Any</option>{subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Difficulty</label><select value={qForm.difficulty} onChange={e => setQForm(f => ({ ...f, difficulty: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select></div>
              <Input label="Marks" type="number" value={qForm.marks} onChange={e => setQForm(f => ({ ...f, marks: e.target.value }))} min="0.5" step="0.5" />
            </div>
            <Input label="Topic (optional)" value={qForm.topic} onChange={e => setQForm(f => ({ ...f, topic: e.target.value }))} placeholder="Algebra" />
            {(qForm.question_type === "multiple_choice" || qForm.question_type === "true_false") && (
              <div><label className="block text-sm font-medium text-gray-700 mb-2">Options (select correct)</label><div className="space-y-2">{qForm.options.map((opt, i) => (<div key={opt.id} className="flex items-center gap-2"><input type="radio" name="correct" checked={opt.is_correct} onChange={() => setQForm(f => ({ ...f, options: f.options.map((o, j) => ({ ...o, is_correct: j === i })) }))} className="w-4 h-4 text-[#C9A227]" /><span className="text-sm font-bold text-gray-500 w-5">{opt.id}.</span><input type="text" value={opt.text} placeholder={`Option ${opt.id}`} onChange={e => setQForm(f => ({ ...f, options: f.options.map((o, j) => j === i ? { ...o, text: e.target.value } : o) }))} className="flex-1 px-3 py-1.5 border border-gray-300 rounded text-sm" /></div>))}</div></div>
            )}
            {(qForm.question_type === "short_answer" || qForm.question_type === "fill_blank" || qForm.question_type === "numeric") && (
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Correct Answer</label><input type="text" value={qForm.answer_text} onChange={e => setQForm(f => ({ ...f, answer_text: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]" placeholder="Enter the expected answer (auto-graded)" /><p className="text-xs text-gray-500 mt-1">For fill-blank & short-answer, exact-match auto-grading (case-insensitive). Numeric matches value.</p></div>
            )}
            {qForm.question_type === "essay" && (
              <div className="p-3 bg-blue-50 rounded-lg text-sm text-blue-800">Essay questions are graded manually by the teacher after submission.</div>
            )}
            <div className="flex justify-end gap-2 pt-2"><Button variant="secondary" onClick={() => setShowQForm(false)}>Cancel</Button><Button variant="gold" loading={savingQ} onClick={saveQuestion} disabled={!qForm.question_text.trim()}><Save size={14} /> Save</Button></div>
          </div>
        </Modal>
      )}

      {/* BULK UPLOAD MODAL */}
      {showBulkForm && (
        <Modal open onClose={() => { setShowBulkForm(false); setBulkResult(null); }} title="Bulk Upload Questions" size="lg">
          <div className="space-y-4">
            <p className="text-sm text-gray-600">Upload multiple questions at once using CSV format. Download the template, fill it in, then paste the contents below.</p>
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm" variant="secondary" onClick={downloadTemplate}><Upload size={14} /> Download Template</Button>
              <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-[#0F2A47] hover:bg-gray-50 text-xs font-medium">
                {bulkExtracting ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                Upload file (.docx / .xlsx / .csv / .txt)
                <input type="file" className="hidden" accept=".docx,.xlsx,.xls,.csv,.md,.txt" onChange={handleBulkFileUpload} />
              </label>
              <Button size="sm" variant="secondary" loading={bulkAiParsing} onClick={bulkAiParse} disabled={!bulkCsv.trim()}>
                <Sparkles size={13} /> AI extract questions
              </Button>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Subject</label><select value={bulkSubjectId} onChange={e => setBulkSubjectId(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"><option value="">Any</option>{subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
            </div>
            <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-xs text-blue-900">
              Upload a file to fill the box below automatically. If it&apos;s a CSV/Excel with the template columns, it uploads as-is. If it&apos;s a Word doc / notes / a curriculum PDF (paste it), click <strong>AI extract questions</strong> to convert to the template shape first.
            </div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">CSV / source content</label><textarea rows={10} value={bulkCsv} onChange={e => setBulkCsv(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-[#C9A227]" placeholder={CSV_TEMPLATE} /></div>
            {bulkResult && <p className="text-sm font-medium text-green-700">{bulkResult}</p>}
            <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setShowBulkForm(false)}>Cancel</Button><Button variant="gold" loading={bulkUploading} onClick={uploadBulk} disabled={!bulkCsv.trim()}><Upload size={14} /> Upload</Button></div>
          </div>
        </Modal>
      )}

      {/* CREATE/EDIT EXAM MODAL */}
      {showExamForm && (
        <Modal open onClose={() => { setShowExamForm(false); setEditingExam(null); }} title={editingExam ? "Edit Exam" : "Create Exam"} size="lg">
          <div className="space-y-4">
            <Input label="Exam Title" value={examForm.title} onChange={e => setExamForm(f => ({ ...f, title: e.target.value }))} placeholder="Mathematics Mid-Term" />
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Type</label><select value={examForm.exam_type} onChange={e => setExamForm(f => ({ ...f, exam_type: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"><option value="exam">Exam</option><option value="test">Test</option><option value="quiz">Quiz</option><option value="assignment">Assignment</option><option value="practice">Practice</option></select></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Subject</label><select value={examForm.subject_id} onChange={e => setExamForm(f => ({ ...f, subject_id: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"><option value="">Any</option>{subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Assign to Class</label><select value={examForm.class_id} onChange={e => setExamForm(f => ({ ...f, class_id: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"><option value="">All Classes</option>{classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
              <Input label="Duration (min)" type="number" value={examForm.duration_minutes} onChange={e => setExamForm(f => ({ ...f, duration_minutes: e.target.value }))} />
              <Input label="Available From" type="datetime-local" value={examForm.starts_at} onChange={e => setExamForm(f => ({ ...f, starts_at: e.target.value }))} />
              <Input label="Available Until" type="datetime-local" value={examForm.ends_at} onChange={e => setExamForm(f => ({ ...f, ends_at: e.target.value }))} />
              <Input label="Max Attempts" type="number" value={examForm.max_attempts} onChange={e => setExamForm(f => ({ ...f, max_attempts: e.target.value }))} />
              <Input label="Pass Mark" type="number" value={examForm.pass_mark} onChange={e => setExamForm(f => ({ ...f, pass_mark: e.target.value }))} />
            </div>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={examForm.shuffle_questions} onChange={e => setExamForm(f => ({ ...f, shuffle_questions: e.target.checked }))} className="w-4 h-4 rounded text-[#C9A227]" />Shuffle questions</label>
              <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={examForm.shuffle_options} onChange={e => setExamForm(f => ({ ...f, shuffle_options: e.target.checked }))} className="w-4 h-4 rounded text-[#C9A227]" />Shuffle options</label>
              <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={examForm.show_results} onChange={e => setExamForm(f => ({ ...f, show_results: e.target.checked }))} className="w-4 h-4 rounded text-[#C9A227]" />Show results after</label>
              <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={examForm.show_answers} onChange={e => setExamForm(f => ({ ...f, show_answers: e.target.checked }))} className="w-4 h-4 rounded text-[#C9A227]" />Show correct answers</label>
              <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={examForm.proctored} onChange={e => setExamForm(f => ({ ...f, proctored: e.target.checked }))} className="w-4 h-4 rounded text-[#C9A227]" />Proctored (Exam Lock)</label>
            </div>
            {examForm.proctored && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-3">
                <p className="text-xs font-semibold text-amber-900">Exam Lock / Proctor Mode</p>
                <p className="text-[11px] text-amber-800">While a student takes this exam they are confined to it: school navigation and the AI Assistant are blocked server-side until they submit. Blocking AI for students is always enforced and cannot be turned off here.</p>
                <div className="flex flex-wrap gap-4">
                  <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={examForm.fullscreen_required} onChange={e => setExamForm(f => ({ ...f, fullscreen_required: e.target.checked }))} className="w-4 h-4 rounded text-[#C9A227]" />Require fullscreen</label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={examForm.sign_out_on_violation} onChange={e => setExamForm(f => ({ ...f, sign_out_on_violation: e.target.checked }))} className="w-4 h-4 rounded text-[#C9A227]" />Sign out after forced submission</label>
                </div>
                <div className="w-40">
                  <Input label="Max violations" type="number" min="1" max="10" value={examForm.max_violations} onChange={e => setExamForm(f => ({ ...f, max_violations: e.target.value }))} />
                </div>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2"><Button variant="secondary" onClick={() => { setShowExamForm(false); setEditingExam(null); }}>Cancel</Button><Button variant="gold" loading={savingExam} onClick={saveExam} disabled={!examForm.title.trim()}><Save size={14} /> {editingExam ? "Update" : "Create"}</Button></div>
          </div>
        </Modal>
      )}

      {/* ASSIGNMENT MODAL */}
      {assignExam && (
        <Modal open onClose={() => setAssignExam(null)} title={`Assign: ${assignExam.title}`} size="lg">
          <div className="space-y-4">
            <p className="text-xs text-gray-500">
              Choose who can take this exam and, optionally, when it becomes available to them.
              A student sees the exam only while inside the assignment window.
            </p>

            {/* Existing assignments */}
            {existingAssignments.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-gray-500 mb-1">Current assignments</div>
                <div className="space-y-1 max-h-40 overflow-y-auto rounded-lg border bg-gray-50 p-2">
                  {existingAssignments.map(a => (
                    <div key={a.id} className="flex items-center justify-between px-2 py-1 text-xs">
                      <span className="text-gray-700">
                        {a.student_id
                          ? students.find(s => s.id === a.student_id)?.full_name || "Unknown student"
                          : `Class: ${classes.find(c => c.id === a.class_id)?.name || "?"}`}
                        {a.available_from && <span className="text-gray-400"> · from {new Date(a.available_from).toLocaleString()}</span>}
                        {a.available_to && <span className="text-gray-400"> · until {new Date(a.available_to).toLocaleString()}</span>}
                      </span>
                      <button onClick={() => unassign(a)} className="text-red-500 hover:underline">Remove</button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Mode toggle */}
            <div className="flex gap-2">
              <button onClick={() => setAssignMode("class")}
                className={cn("px-3 py-1.5 text-xs font-semibold rounded-lg", assignMode === "class" ? "bg-[#0F2A47] text-white" : "bg-gray-100 text-gray-600")}>
                By class
              </button>
              <button onClick={() => setAssignMode("students")}
                className={cn("px-3 py-1.5 text-xs font-semibold rounded-lg", assignMode === "students" ? "bg-[#0F2A47] text-white" : "bg-gray-100 text-gray-600")}>
                Specific students ({assignStudentIds.size} selected)
              </button>
            </div>

            {assignMode === "class" ? (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Class</label>
                <select value={assignClassId} onChange={e => setAssignClassId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                  <option value="">Select a class…</option>
                  {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            ) : (
              <div>
                <input type="text" value={assignFilter} onChange={e => setAssignFilter(e.target.value)}
                  placeholder="Filter students by name or code…"
                  className="w-full mb-2 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                <div className="max-h-56 overflow-y-auto border border-gray-200 rounded-lg divide-y">
                  {students
                    .filter(s => {
                      const q = assignFilter.trim().toLowerCase();
                      return !q || s.full_name.toLowerCase().includes(q) || s.student_code.toLowerCase().includes(q);
                    })
                    .map(s => (
                      <label key={s.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer">
                        <input type="checkbox"
                          checked={assignStudentIds.has(s.id)}
                          onChange={e => {
                            setAssignStudentIds(prev => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(s.id); else next.delete(s.id);
                              return next;
                            });
                          }}
                          className="w-4 h-4 rounded border-gray-300 text-[#C9A227] focus:ring-[#C9A227]" />
                        <span className="text-sm text-gray-800 flex-1">{s.full_name}</span>
                        <span className="font-mono text-xs text-gray-400">{s.student_code}</span>
                        <span className="text-xs text-gray-400">{s.grade}</span>
                      </label>
                    ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Input label="Available From (optional)" type="datetime-local"
                value={assignFrom} onChange={e => setAssignFrom(e.target.value)} />
              <Input label="Available Until (optional)" type="datetime-local"
                value={assignUntil} onChange={e => setAssignUntil(e.target.value)} />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setAssignExam(null)}>Close</Button>
              <Button variant="gold" loading={assignSaving} onClick={saveAssignment}>
                <Save size={14} /> Save assignment
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
