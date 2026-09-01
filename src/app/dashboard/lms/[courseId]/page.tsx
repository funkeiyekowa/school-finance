"use client";

/**
 * Teacher course detail — the authoring workspace for one course.
 *
 * Four tabs:
 *   Lessons     — create/edit/publish lessons; "Generate with AI" drafts
 *                 full lesson content from a topic (lms_lesson_generate).
 *   Quiz        — one quiz per lesson; "Generate Quiz from Lesson" turns
 *                 the lesson's own content into MCQs via strict-JSON AI
 *                 output (lms_quiz_generate), parsed into
 *                 lms_quiz_questions rows. Teacher can edit/delete any
 *                 AI-authored question before publishing.
 *   Assignments — free-text assignments; grading view lists submissions
 *                 with "AI Suggest Grade" (lms_grading_assist) — the
 *                 suggestion is shown separately and never auto-applied;
 *                 the teacher must type/confirm the final score.
 *   Roster      — enrolled students, enroll/unenroll, per-student
 *                 progress (lms_student_course_progress) and leaderboard
 *                 preview (lms_leaderboard).
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { useToast } from "@/lib/hooks/useToast";
import { extractErrorMessage } from "@/lib/errors/extractErrorMessage";
import { generateWithAi } from "@/lib/ai/client";
import { renderAiOutputHtml } from "@/lib/ai/richText";
import { cn, fmtDate } from "@/lib/utils";
import { PageHeader, LoadingSpinner, EmptyState } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import {
  ArrowLeft, Plus, Sparkles, BookOpen, HelpCircle, ClipboardList, Users,
  Trash2, Pencil, Check, X as XIcon, Trophy, Loader2, Eye, EyeOff,
} from "lucide-react";

interface CourseRow {
  id: string; title: string; description: string | null; status: string;
  cover_color: string; leaderboard_enabled: boolean; subject_id: string | null; class_id: string | null;
}
interface LessonRow {
  id: string; course_id: string; title: string; content: string | null; sort_order: number;
  estimated_minutes: number | null; status: string; ai_generated: boolean;
}
interface QuizRow { id: string; lesson_id: string; title: string; pass_mark_percent: number; max_attempts: number; ai_generated: boolean; }
interface QuestionRow { id: string; quiz_id: string; question_text: string; options: { id: string; text: string; is_correct: boolean }[]; explanation: string | null; marks: number; sort_order: number; }
interface AssignmentRow { id: string; lesson_id: string; title: string; instructions: string | null; max_score: number; due_date: string | null; ai_generated: boolean; }
interface SubmissionRow {
  id: string; assignment_id: string; student_id: string; response_text: string | null; status: string;
  score: number | null; feedback: string | null; ai_suggested_score: number | null; ai_suggested_feedback: string | null; submitted_at: string;
}
interface EnrollmentRow { id: string; course_id: string; student_id: string; status: string; enrolled_at: string; }
interface StudentOption { id: string; full_name: string; student_code: string; grade: string | null; }
interface ProgressRow { lessons_total: number; lessons_completed: number; quizzes_taken: number; quiz_average_percent: number | null; }
interface LeaderRow { student_id: string; student_name: string; lessons_done: number; avg_quiz_percent: number | null; rank_position: number; }

type Tab = "lessons" | "roster";

export default function CourseDetailPage() {
  const params = useParams<{ courseId: string }>();
  const router = useRouter();
  const courseId = params.courseId;
  const { canEdit, orgId } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const { notify, ToastHost } = useToast();

  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("lessons");
  const [course, setCourse] = useState<CourseRow | null>(null);
  const [lessons, setLessons] = useState<LessonRow[]>([]);
  const [quizzes, setQuizzes] = useState<Record<string, QuizRow>>({});
  const [questions, setQuestions] = useState<Record<string, QuestionRow[]>>({});
  const [assignments, setAssignments] = useState<Record<string, AssignmentRow[]>>({});
  const [submissions, setSubmissions] = useState<Record<string, SubmissionRow[]>>({});
  const [enrollments, setEnrollments] = useState<EnrollmentRow[]>([]);
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderRow[]>([]);
  const [expandedLesson, setExpandedLesson] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [cRes, lRes, qRes, enRes, stuRes] = await Promise.all([
      supabase.from("lms_courses").select("*").eq("id", courseId).maybeSingle(),
      supabase.from("lms_lessons").select("*").eq("course_id", courseId).order("sort_order"),
      supabase.from("lms_quizzes").select("*"),
      supabase.from("lms_enrollments").select("*").eq("course_id", courseId).order("enrolled_at", { ascending: false }),
      supabase.from("students").select("id, full_name, student_code, grade").eq("status", "active").order("full_name"),
    ]);
    const c = cRes.data as CourseRow | null;
    setCourse(c);
    const lessonRows = (lRes.data as LessonRow[]) ?? [];
    setLessons(lessonRows);
    setEnrollments((enRes.data as EnrollmentRow[]) ?? []);
    setStudents((stuRes.data as StudentOption[]) ?? []);

    const lessonIds = lessonRows.map((l) => l.id);
    const allQuizzes = ((qRes.data as QuizRow[]) ?? []).filter((q) => lessonIds.includes(q.lesson_id));
    const quizByLesson: Record<string, QuizRow> = {};
    for (const q of allQuizzes) quizByLesson[q.lesson_id] = q;
    setQuizzes(quizByLesson);

    if (allQuizzes.length > 0) {
      const { data: qq } = await supabase.from("lms_quiz_questions").select("*").in("quiz_id", allQuizzes.map((q) => q.id)).order("sort_order");
      const byQuiz: Record<string, QuestionRow[]> = {};
      for (const row of (qq as QuestionRow[]) ?? []) {
        (byQuiz[row.quiz_id] ||= []).push(row);
      }
      setQuestions(byQuiz);
    } else {
      setQuestions({});
    }

    if (lessonIds.length > 0) {
      const { data: asg } = await supabase.from("lms_assignments").select("*").in("lesson_id", lessonIds).order("created_at", { ascending: false });
      const byLesson: Record<string, AssignmentRow[]> = {};
      for (const row of (asg as AssignmentRow[]) ?? []) (byLesson[row.lesson_id] ||= []).push(row);
      setAssignments(byLesson);

      const asgIds = ((asg as AssignmentRow[]) ?? []).map((a) => a.id);
      if (asgIds.length > 0) {
        const { data: subs } = await supabase.from("lms_submissions").select("*").in("assignment_id", asgIds).order("submitted_at", { ascending: false });
        const bySubAsg: Record<string, SubmissionRow[]> = {};
        for (const row of (subs as SubmissionRow[]) ?? []) (bySubAsg[row.assignment_id] ||= []).push(row);
        setSubmissions(bySubAsg);
      } else {
        setSubmissions({});
      }
    } else {
      setAssignments({});
      setSubmissions({});
    }

    if (c?.leaderboard_enabled) {
      const { data: lb } = await supabase.rpc("lms_leaderboard", { p_course_id: courseId });
      setLeaderboard((lb as LeaderRow[]) ?? []);
    }

    setLoading(false);
  }, [supabase, courseId]);

  useEffect(() => { load(); }, [load]);

  const studentById = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);

  async function setCourseStatus(status: string) {
    const { error } = await supabase.from("lms_courses").update({ status }).eq("id", courseId);
    if (error) { notify(extractErrorMessage(error, "Failed to update course."), "error"); return; }
    notify(status === "published" ? "Course published." : "Course updated.");
    load();
  }

  /* ---------------- Lessons ---------------- */
  const [showLessonForm, setShowLessonForm] = useState(false);
  const [editingLesson, setEditingLesson] = useState<LessonRow | null>(null);
  const emptyLessonForm = { title: "", content: "", estimated_minutes: "15", ai_topic: "" };
  const [lessonForm, setLessonForm] = useState(emptyLessonForm);
  const [savingLesson, setSavingLesson] = useState(false);
  const [generatingLesson, setGeneratingLesson] = useState(false);

  function openLessonForm(l?: LessonRow) {
    if (l) {
      setEditingLesson(l);
      setLessonForm({ title: l.title, content: l.content || "", estimated_minutes: String(l.estimated_minutes ?? 15), ai_topic: "" });
    } else {
      setEditingLesson(null);
      setLessonForm(emptyLessonForm);
    }
    setShowLessonForm(true);
  }

  async function generateLessonContent() {
    if (!lessonForm.title.trim() && !lessonForm.ai_topic.trim()) {
      notify("Enter a lesson title or topic first.", "error");
      return;
    }
    setGeneratingLesson(true);
    try {
      const result = await generateWithAi({
        kind: "lms_lesson_generate",
        input: lessonForm.ai_topic.trim() || lessonForm.title.trim(),
        extra: {
          lesson_title: lessonForm.title.trim() || lessonForm.ai_topic.trim(),
          subject: course?.subject_id ? "the course subject" : "",
          grade: course?.class_id ? "the course's class level" : "",
        },
        source: "lms_lesson_authoring",
      });
      setLessonForm((f) => ({ ...f, content: result.output, title: f.title || f.ai_topic }));
      notify("Lesson content generated — review and edit before saving.");
    } catch (err) {
      notify(err instanceof Error ? err.message : "AI generation failed.", "error");
    } finally {
      setGeneratingLesson(false);
    }
  }

  async function saveLesson() {
    if (!lessonForm.title.trim()) { notify("Lesson title is required.", "error"); return; }
    setSavingLesson(true);
    try {
      const wasAiUsed = !editingLesson && lessonForm.ai_topic.trim().length > 0;
      if (editingLesson) {
        const { error } = await supabase.from("lms_lessons").update({
          title: lessonForm.title.trim(),
          content: lessonForm.content,
          estimated_minutes: parseInt(lessonForm.estimated_minutes, 10) || 15,
        }).eq("id", editingLesson.id);
        if (error) throw error;
        notify("Lesson updated.");
      } else {
        const { error } = await supabase.from("lms_lessons").insert({
          course_id: courseId,
          title: lessonForm.title.trim(),
          content: lessonForm.content,
          estimated_minutes: parseInt(lessonForm.estimated_minutes, 10) || 15,
          sort_order: lessons.length,
          status: "draft",
          ai_generated: wasAiUsed,
          ai_source_prompt: wasAiUsed ? lessonForm.ai_topic.trim() : null,
          organization_id: orgId,
        });
        if (error) throw error;
        notify("Lesson created.");
      }
      setShowLessonForm(false);
      load();
    } catch (err) {
      notify(extractErrorMessage(err, "Failed to save lesson."), "error");
    } finally {
      setSavingLesson(false);
    }
  }

  async function toggleLessonStatus(l: LessonRow) {
    const next = l.status === "published" ? "draft" : "published";
    const { error } = await supabase.from("lms_lessons").update({ status: next }).eq("id", l.id);
    if (error) { notify(extractErrorMessage(error, "Failed to update lesson."), "error"); return; }
    load();
  }

  async function deleteLesson(l: LessonRow) {
    if (!confirm(`Delete lesson "${l.title}"? This also removes its quiz and assignments.`)) return;
    const { error } = await supabase.from("lms_lessons").delete().eq("id", l.id);
    if (error) { notify(extractErrorMessage(error, "Failed to delete lesson."), "error"); return; }
    notify("Lesson deleted.");
    load();
  }

  /* ---------------- Quiz ---------------- */
  const [showQuizGen, setShowQuizGen] = useState<LessonRow | null>(null);
  const [questionCount, setQuestionCount] = useState("5");
  const [generatingQuiz, setGeneratingQuiz] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<QuestionRow | null>(null);
  const [questionDraft, setQuestionDraft] = useState<{ question_text: string; options: { id: string; text: string; is_correct: boolean }[]; explanation: string } | null>(null);

  async function ensureQuiz(lessonId: string): Promise<QuizRow> {
    const existing = quizzes[lessonId];
    if (existing) return existing;
    const { data, error } = await supabase.from("lms_quizzes").insert({ lesson_id: lessonId, title: "Lesson Quiz", organization_id: orgId }).select().single();
    if (error) throw error;
    return data as QuizRow;
  }

  async function generateQuizFromLesson(lesson: LessonRow) {
    if (!lesson.content || lesson.content.trim().length < 20) {
      notify("This lesson needs content before a quiz can be generated from it.", "error");
      return;
    }
    setGeneratingQuiz(true);
    try {
      const result = await generateWithAi({
        kind: "lms_quiz_generate",
        input: lesson.content,
        extra: { question_count: questionCount },
        source: "lms_quiz_authoring",
      });
      let parsed: { questions: { question_text: string; options: { id: string; text: string; is_correct: boolean }[]; explanation?: string }[] };
      try {
        const cleaned = result.output.trim().replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```\s*$/, "");
        parsed = JSON.parse(cleaned);
      } catch {
        throw new Error("The AI response wasn't valid JSON — try again, or add questions manually.");
      }
      if (!Array.isArray(parsed.questions) || parsed.questions.length === 0) {
        throw new Error("No questions were returned — try again.");
      }
      const quiz = await ensureQuiz(lesson.id);
      const existingCount = (questions[quiz.id] || []).length;
      const rows = parsed.questions.map((q, idx) => ({
        quiz_id: quiz.id,
        question_text: q.question_text,
        options: q.options,
        explanation: q.explanation || null,
        marks: 1,
        sort_order: existingCount + idx,
        organization_id: orgId,
      }));
      const { error } = await supabase.from("lms_quiz_questions").insert(rows);
      if (error) throw error;
      await supabase.from("lms_quizzes").update({ ai_generated: true }).eq("id", quiz.id);
      notify(`${parsed.questions.length} questions generated — review before publishing the quiz.`);
      setShowQuizGen(null);
      load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Quiz generation failed.", "error");
    } finally {
      setGeneratingQuiz(false);
    }
  }

  function openQuestionEditor(q: QuestionRow) {
    setEditingQuestion(q);
    setQuestionDraft({ question_text: q.question_text, options: q.options.map((o) => ({ ...o })), explanation: q.explanation || "" });
  }

  async function saveQuestion() {
    if (!editingQuestion || !questionDraft) return;
    if (!questionDraft.question_text.trim()) { notify("Question text is required.", "error"); return; }
    if (!questionDraft.options.some((o) => o.is_correct)) { notify("Mark one option as correct.", "error"); return; }
    const { error } = await supabase.from("lms_quiz_questions").update({
      question_text: questionDraft.question_text.trim(),
      options: questionDraft.options,
      explanation: questionDraft.explanation.trim() || null,
    }).eq("id", editingQuestion.id);
    if (error) { notify(extractErrorMessage(error, "Failed to save question."), "error"); return; }
    notify("Question saved.");
    setEditingQuestion(null);
    setQuestionDraft(null);
    load();
  }

  async function deleteQuestion(q: QuestionRow) {
    if (!confirm("Delete this question?")) return;
    const { error } = await supabase.from("lms_quiz_questions").delete().eq("id", q.id);
    if (error) { notify(extractErrorMessage(error, "Failed to delete question."), "error"); return; }
    load();
  }

  async function addBlankQuestion(lessonId: string) {
    const quiz = await ensureQuiz(lessonId).catch((err) => {
      notify(extractErrorMessage(err, "Failed to create quiz."), "error");
      return null;
    });
    if (!quiz) return;
    const existingCount = (questions[quiz.id] || []).length;
    const { data, error } = await supabase.from("lms_quiz_questions").insert({
      quiz_id: quiz.id,
      question_text: "New question",
      options: [
        { id: "a", text: "Option A", is_correct: true },
        { id: "b", text: "Option B", is_correct: false },
      ],
      sort_order: existingCount,
      organization_id: orgId,
    }).select().single();
    if (error) { notify(extractErrorMessage(error, "Failed to add question."), "error"); return; }
    await load();
    openQuestionEditor(data as QuestionRow);
  }

  async function toggleQuizPublish(quiz: QuizRow, lessonId: string) {
    // Quizzes don't have their own status column; "published" is
    // implied by the lesson being published AND having >=1 question.
    // Publishing the quiz here means publishing the parent lesson.
    const lesson = lessons.find((l) => l.id === lessonId);
    if (!lesson) return;
    if ((questions[quiz.id] || []).length === 0) {
      notify("Add at least one question before publishing.", "error");
      return;
    }
    await toggleLessonStatus(lesson);
  }

  /* ---------------- Assignments & grading ---------------- */
  const [showAssignForm, setShowAssignForm] = useState<LessonRow | null>(null);
  const emptyAssignForm = { title: "", instructions: "", max_score: "100", due_date: "" };
  const [assignForm, setAssignForm] = useState(emptyAssignForm);
  const [savingAssign, setSavingAssign] = useState(false);
  const [gradingSubmission, setGradingSubmission] = useState<SubmissionRow | null>(null);
  const [gradingAssignment, setGradingAssignment] = useState<AssignmentRow | null>(null);
  const [scoreDraft, setScoreDraft] = useState("");
  const [feedbackDraft, setFeedbackDraft] = useState("");
  const [suggestingGrade, setSuggestingGrade] = useState(false);
  const [savingGrade, setSavingGrade] = useState(false);

  async function saveAssignment() {
    if (!showAssignForm) return;
    if (!assignForm.title.trim()) { notify("Assignment title is required.", "error"); return; }
    setSavingAssign(true);
    try {
      const { error } = await supabase.from("lms_assignments").insert({
        lesson_id: showAssignForm.id,
        title: assignForm.title.trim(),
        instructions: assignForm.instructions.trim() || null,
        max_score: parseFloat(assignForm.max_score) || 100,
        due_date: assignForm.due_date || null,
        organization_id: orgId,
      });
      if (error) throw error;
      notify("Assignment created.");
      setShowAssignForm(null);
      setAssignForm(emptyAssignForm);
      load();
    } catch (err) {
      notify(extractErrorMessage(err, "Failed to create assignment."), "error");
    } finally {
      setSavingAssign(false);
    }
  }

  function openGrading(sub: SubmissionRow, assignment: AssignmentRow) {
    setGradingSubmission(sub);
    setGradingAssignment(assignment);
    setScoreDraft(sub.score != null ? String(sub.score) : (sub.ai_suggested_score != null ? String(sub.ai_suggested_score) : ""));
    setFeedbackDraft(sub.feedback || sub.ai_suggested_feedback || "");
  }

  async function suggestGrade() {
    if (!gradingSubmission || !gradingAssignment) return;
    setSuggestingGrade(true);
    try {
      const result = await generateWithAi({
        kind: "lms_grading_assist",
        input: gradingSubmission.response_text || "(no response text submitted)",
        extra: { instructions: gradingAssignment.instructions || "", max_score: String(gradingAssignment.max_score) },
        source: "lms_grading",
      });
      const cleaned = result.output.trim().replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```\s*$/, "");
      const parsed = JSON.parse(cleaned) as { suggested_score: number; feedback: string };
      await supabase.from("lms_submissions").update({
        ai_suggested_score: parsed.suggested_score,
        ai_suggested_feedback: parsed.feedback,
      }).eq("id", gradingSubmission.id);
      setGradingSubmission({ ...gradingSubmission, ai_suggested_score: parsed.suggested_score, ai_suggested_feedback: parsed.feedback });
      // Pre-fill the editable fields with the suggestion, but the teacher
      // still has to hit "Save Grade" to actually apply anything.
      setScoreDraft(String(parsed.suggested_score));
      setFeedbackDraft(parsed.feedback);
      notify("AI suggestion ready — review before saving.");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not get an AI suggestion.", "error");
    } finally {
      setSuggestingGrade(false);
    }
  }

  async function saveGrade() {
    if (!gradingSubmission) return;
    const score = parseFloat(scoreDraft);
    if (Number.isNaN(score)) { notify("Enter a numeric score.", "error"); return; }
    setSavingGrade(true);
    try {
      const { error } = await supabase.from("lms_submissions").update({
        score,
        feedback: feedbackDraft.trim() || null,
        status: "graded",
        graded_at: new Date().toISOString(),
      }).eq("id", gradingSubmission.id);
      if (error) throw error;
      notify("Grade saved.");
      setGradingSubmission(null);
      setGradingAssignment(null);
      load();
    } catch (err) {
      notify(extractErrorMessage(err, "Failed to save grade."), "error");
    } finally {
      setSavingGrade(false);
    }
  }

  /* ---------------- Roster ---------------- */
  const [enrollPickerOpen, setEnrollPickerOpen] = useState(false);
  const [enrollSearch, setEnrollSearch] = useState("");
  const [progressByStudent, setProgressByStudent] = useState<Record<string, ProgressRow>>({});
  const [loadingProgress, setLoadingProgress] = useState(false);

  const enrolledIds = useMemo(() => new Set(enrollments.filter((e) => e.status === "active").map((e) => e.student_id)), [enrollments]);
  const availableStudents = useMemo(
    () => students.filter((s) => !enrolledIds.has(s.id) && s.full_name.toLowerCase().includes(enrollSearch.toLowerCase())),
    [students, enrolledIds, enrollSearch]
  );

  async function enrollStudent(studentId: string) {
    const { error } = await supabase.from("lms_enrollments").insert({ course_id: courseId, student_id: studentId, organization_id: orgId });
    if (error) { notify(extractErrorMessage(error, "Failed to enroll student."), "error"); return; }
    notify("Student enrolled.");
    load();
  }

  async function unenrollStudent(enrollment: EnrollmentRow) {
    if (!confirm("Remove this student from the course?")) return;
    const { error } = await supabase.from("lms_enrollments").update({ status: "dropped" }).eq("id", enrollment.id);
    if (error) { notify(extractErrorMessage(error, "Failed to unenroll student."), "error"); return; }
    load();
  }

  useEffect(() => {
    if (tab !== "roster" || enrollments.length === 0) return;
    let cancelled = false;
    setLoadingProgress(true);
    (async () => {
      const active = enrollments.filter((e) => e.status === "active");
      const results = await Promise.all(active.map((e) =>
        supabase.rpc("lms_student_course_progress", { p_course_id: courseId, p_student_id: e.student_id })
      ));
      if (cancelled) return;
      const map: Record<string, ProgressRow> = {};
      active.forEach((e, i) => {
        const row = results[i].data?.[0] as ProgressRow | undefined;
        if (row) map[e.student_id] = row;
      });
      setProgressByStudent(map);
      setLoadingProgress(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, enrollments, courseId]);

  if (loading) return <div className="p-6"><LoadingSpinner /></div>;
  if (!course) return <div className="p-6"><EmptyState message="Course not found." /></div>;

  return (
    <div className="p-6 space-y-5">
      <Link href="/dashboard/lms" className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-[#0F2A47]">
        <ArrowLeft size={14} /> Back to courses
      </Link>

      <PageHeader title={course.title} subtitle={course.description || undefined}>
        <span className={cn(
          "text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full",
          course.status === "published" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
        )}>
          {course.status}
        </span>
        {canEdit && course.status !== "published" && (
          <Button variant="gold" size="sm" onClick={() => setCourseStatus("published")}>Publish Course</Button>
        )}
        {canEdit && course.status === "published" && (
          <Button variant="secondary" size="sm" onClick={() => setCourseStatus("draft")}>Unpublish</Button>
        )}
      </PageHeader>

      <div className="flex gap-1 border-b border-gray-200">
        {([
          { key: "lessons" as Tab, label: "Lessons & Quizzes", icon: <BookOpen size={14} /> },
          { key: "roster" as Tab, label: "Roster & Progress", icon: <Users size={14} /> },
        ]).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
              tab === t.key ? "border-[#C9A227] text-[#0F2A47]" : "border-transparent text-gray-500 hover:text-gray-700"
            )}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === "lessons" && (
        <div className="space-y-4">
          {canEdit && (
            <Button variant="gold" size="sm" onClick={() => openLessonForm()}>
              <Plus size={14} /> New Lesson
            </Button>
          )}

          {lessons.length === 0 ? (
            <EmptyState message="No lessons yet." icon={<BookOpen size={36} />} />
          ) : (
            <div className="space-y-3">
              {lessons.map((l) => {
                const quiz = quizzes[l.id];
                const qList = quiz ? questions[quiz.id] || [] : [];
                const asgList = assignments[l.id] || [];
                const expanded = expandedLesson === l.id;
                return (
                  <Card key={l.id}>
                    <div className="flex items-start justify-between gap-3 cursor-pointer" onClick={() => setExpandedLesson(expanded ? null : l.id)}>
                      <div className="flex items-start gap-2">
                        <BookOpen size={16} className="text-[#C9A227] mt-0.5 shrink-0" />
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold text-[#0F2A47] text-sm">{l.title}</h3>
                            {l.ai_generated && <span className="text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full flex items-center gap-0.5"><Sparkles size={9} />AI</span>}
                            <span className={cn("text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full", l.status === "published" ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500")}>{l.status}</span>
                          </div>
                          <p className="text-xs text-gray-400 mt-0.5">{l.estimated_minutes || 15} min · {qList.length} quiz question{qList.length === 1 ? "" : "s"} · {asgList.length} assignment{asgList.length === 1 ? "" : "s"}</p>
                        </div>
                      </div>
                      {canEdit && (
                        <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                          <button onClick={() => toggleLessonStatus(l)} title={l.status === "published" ? "Unpublish" : "Publish"} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
                            {l.status === "published" ? <EyeOff size={14} /> : <Eye size={14} />}
                          </button>
                          <button onClick={() => openLessonForm(l)} title="Edit" className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"><Pencil size={14} /></button>
                          <button onClick={() => deleteLesson(l)} title="Delete" className="p-1.5 rounded-lg hover:bg-red-50 text-red-500"><Trash2 size={14} /></button>
                        </div>
                      )}
                    </div>

                    {expanded && (
                      <div className="mt-3 pt-3 border-t border-gray-100 space-y-4">
                        {l.content && (
                          <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2 text-xs max-h-40 overflow-y-auto" dangerouslySetInnerHTML={{ __html: renderAiOutputHtml(l.content) }} />
                        )}

                        <div>
                          <div className="flex items-center justify-between mb-1.5">
                            <h4 className="text-xs font-bold text-gray-600 uppercase tracking-wide flex items-center gap-1"><HelpCircle size={12} /> Quiz</h4>
                            {canEdit && (
                              <div className="flex items-center gap-2">
                                <button onClick={() => setShowQuizGen(l)} className="text-xs text-[#0F2A47] hover:text-[#C9A227] flex items-center gap-1"><Sparkles size={12} /> Generate from lesson</button>
                                <button onClick={() => addBlankQuestion(l.id)} className="text-xs text-[#0F2A47] hover:text-[#C9A227] flex items-center gap-1"><Plus size={12} /> Add question</button>
                              </div>
                            )}
                          </div>
                          {qList.length === 0 ? (
                            <p className="text-xs text-gray-400 italic">No quiz questions yet.</p>
                          ) : (
                            <div className="space-y-1.5">
                              {qList.map((q, i) => (
                                <div key={q.id} className="text-xs bg-white border border-gray-100 rounded-lg px-3 py-2 flex items-start justify-between gap-2">
                                  <div>
                                    <span className="font-medium text-gray-700">{i + 1}. {q.question_text}</span>
                                    <div className="text-gray-400 mt-0.5">{q.options.map((o) => o.is_correct ? `✓ ${o.text}` : o.text).join(" · ")}</div>
                                  </div>
                                  {canEdit && (
                                    <div className="flex items-center gap-1 shrink-0">
                                      <button onClick={() => openQuestionEditor(q)} className="p-1 rounded hover:bg-gray-100 text-gray-400"><Pencil size={12} /></button>
                                      <button onClick={() => deleteQuestion(q)} className="p-1 rounded hover:bg-red-50 text-red-400"><Trash2 size={12} /></button>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        <div>
                          <div className="flex items-center justify-between mb-1.5">
                            <h4 className="text-xs font-bold text-gray-600 uppercase tracking-wide flex items-center gap-1"><ClipboardList size={12} /> Assignments</h4>
                            {canEdit && (
                              <button onClick={() => setShowAssignForm(l)} className="text-xs text-[#0F2A47] hover:text-[#C9A227] flex items-center gap-1"><Plus size={12} /> New assignment</button>
                            )}
                          </div>
                          {asgList.length === 0 ? (
                            <p className="text-xs text-gray-400 italic">No assignments yet.</p>
                          ) : (
                            <div className="space-y-2">
                              {asgList.map((a) => {
                                const subs = submissions[a.id] || [];
                                const ungraded = subs.filter((s) => s.status !== "graded").length;
                                return (
                                  <div key={a.id} className="bg-white border border-gray-100 rounded-lg px-3 py-2">
                                    <div className="flex items-center justify-between">
                                      <span className="text-xs font-medium text-gray-700">{a.title}</span>
                                      <span className="text-[11px] text-gray-400">Max {a.max_score} pts{a.due_date ? ` · due ${fmtDate(a.due_date)}` : ""}</span>
                                    </div>
                                    <p className="text-[11px] text-gray-400 mt-1">{subs.length} submission{subs.length === 1 ? "" : "s"}{ungraded > 0 ? ` · ${ungraded} to grade` : ""}</p>
                                    {subs.length > 0 && (
                                      <div className="mt-2 space-y-1">
                                        {subs.map((s) => {
                                          const stu = studentById.get(s.student_id);
                                          return (
                                            <button
                                              key={s.id}
                                              onClick={() => openGrading(s, a)}
                                              className="w-full flex items-center justify-between text-[11px] px-2 py-1.5 rounded-md hover:bg-gray-50 border border-transparent hover:border-gray-200"
                                            >
                                              <span className="text-gray-600">{stu?.full_name || "Unknown student"}</span>
                                              <span className={cn("font-medium", s.status === "graded" ? "text-emerald-600" : "text-amber-600")}>
                                                {s.status === "graded" ? `${s.score} / ${a.max_score}` : "Pending review"}
                                              </span>
                                            </button>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === "roster" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[#0F2A47]">{enrolledIds.size} enrolled</h3>
            {canEdit && (
              <Button variant="secondary" size="sm" onClick={() => setEnrollPickerOpen(true)}><Plus size={14} /> Enroll student</Button>
            )}
          </div>

          {course.leaderboard_enabled && leaderboard.length > 0 && (
            <Card>
              <h4 className="text-xs font-bold text-gray-600 uppercase tracking-wide flex items-center gap-1 mb-2"><Trophy size={12} className="text-[#C9A227]" /> Leaderboard</h4>
              <div className="space-y-1">
                {leaderboard.slice(0, 10).map((r) => (
                  <div key={r.student_id} className="flex items-center justify-between text-xs py-1 px-2 rounded-md odd:bg-gray-50">
                    <span className="flex items-center gap-2"><span className="font-bold text-[#0F2A47] w-5">{r.rank_position}</span>{r.student_name}</span>
                    <span className="text-gray-500">{r.lessons_done} lessons · {r.avg_quiz_percent ?? 0}% avg</span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {enrollments.filter((e) => e.status === "active").length === 0 ? (
            <EmptyState message="No students enrolled yet." icon={<Users size={36} />} />
          ) : (
            <div className="space-y-2">
              {enrollments.filter((e) => e.status === "active").map((e) => {
                const stu = studentById.get(e.student_id);
                const prog = progressByStudent[e.student_id];
                return (
                  <Card key={e.id} className="flex items-center justify-between !p-3">
                    <div>
                      <p className="text-sm font-medium text-gray-700">{stu?.full_name || "Unknown student"}</p>
                      <p className="text-xs text-gray-400">{stu?.student_code}{stu?.grade ? ` · ${stu.grade}` : ""}</p>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-gray-500">
                      {loadingProgress ? <Loader2 size={12} className="animate-spin" /> : prog ? (
                        <span>{prog.lessons_completed}/{prog.lessons_total} lessons · {prog.quiz_average_percent ?? "—"}% quiz avg</span>
                      ) : null}
                      {canEdit && (
                        <button onClick={() => unenrollStudent(e)} className="text-red-500 hover:text-red-700"><Trash2 size={14} /></button>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Lesson form */}
      <Modal open={showLessonForm} onClose={() => setShowLessonForm(false)} title={editingLesson ? "Edit Lesson" : "New Lesson"} size="xl">
        <div className="space-y-3">
          <Input label="Title" value={lessonForm.title} onChange={(e) => setLessonForm({ ...lessonForm, title: e.target.value })} placeholder="e.g. Solving Linear Equations" />
          {!editingLesson && (
            <Input
              label="AI topic (optional)"
              value={lessonForm.ai_topic}
              onChange={(e) => setLessonForm({ ...lessonForm, ai_topic: e.target.value })}
              placeholder="Describe the topic to generate content for, if different from the title"
              helpText="Leave blank to write content yourself, or use it with Generate below."
            />
          )}
          <div className="flex items-center justify-between">
            <label className="block text-sm font-medium text-gray-700">Content</label>
            <button
              type="button"
              onClick={generateLessonContent}
              disabled={generatingLesson}
              className="text-xs text-[#0F2A47] hover:text-[#C9A227] flex items-center gap-1 disabled:opacity-50"
            >
              {generatingLesson ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
              {generatingLesson ? "Generating…" : "Generate with AI"}
            </button>
          </div>
          <textarea
            value={lessonForm.content}
            onChange={(e) => setLessonForm({ ...lessonForm, content: e.target.value })}
            rows={10}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
            placeholder="Lesson content (markdown-style formatting supported: ## headers, **bold**, lists)…"
          />
          <Input
            label="Estimated minutes"
            type="number"
            value={lessonForm.estimated_minutes}
            onChange={(e) => setLessonForm({ ...lessonForm, estimated_minutes: e.target.value })}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowLessonForm(false)}>Cancel</Button>
            <Button variant="gold" onClick={saveLesson} loading={savingLesson}>Save Lesson</Button>
          </div>
        </div>
      </Modal>

      {/* Quiz generation */}
      <Modal open={!!showQuizGen} onClose={() => setShowQuizGen(null)} title={`Generate Quiz — ${showQuizGen?.title ?? ""}`}>
        <div className="space-y-3">
          <p className="text-xs text-gray-500">Generates multiple-choice questions from this lesson&apos;s saved content. Review every question before publishing — nothing is shown to students until the lesson is published.</p>
          <Input label="Number of questions" type="number" min={1} max={15} value={questionCount} onChange={(e) => setQuestionCount(e.target.value)} />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowQuizGen(null)}>Cancel</Button>
            <Button variant="gold" onClick={() => showQuizGen && generateQuizFromLesson(showQuizGen)} loading={generatingQuiz}>
              <Sparkles size={14} /> Generate
            </Button>
          </div>
        </div>
      </Modal>

      {/* Question editor */}
      <Modal open={!!editingQuestion} onClose={() => { setEditingQuestion(null); setQuestionDraft(null); }} title="Edit Question" size="lg">
        {questionDraft && (
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">Question</label>
              <textarea
                value={questionDraft.question_text}
                onChange={(e) => setQuestionDraft({ ...questionDraft, question_text: e.target.value })}
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
              />
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">Options (select the correct one)</label>
              {questionDraft.options.map((o, i) => (
                <div key={o.id} className="flex items-center gap-2">
                  <input
                    type="radio"
                    checked={o.is_correct}
                    onChange={() => setQuestionDraft({
                      ...questionDraft,
                      options: questionDraft.options.map((opt, j) => ({ ...opt, is_correct: j === i })),
                    })}
                  />
                  <input
                    value={o.text}
                    onChange={(e) => setQuestionDraft({
                      ...questionDraft,
                      options: questionDraft.options.map((opt, j) => j === i ? { ...opt, text: e.target.value } : opt),
                    })}
                    className="flex-1 px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm"
                  />
                  {questionDraft.options.length > 2 && (
                    <button
                      onClick={() => setQuestionDraft({ ...questionDraft, options: questionDraft.options.filter((_, j) => j !== i) })}
                      className="text-red-400 hover:text-red-600"
                    ><Trash2 size={14} /></button>
                  )}
                </div>
              ))}
              {questionDraft.options.length < 6 && (
                <button
                  onClick={() => setQuestionDraft({ ...questionDraft, options: [...questionDraft.options, { id: String.fromCharCode(97 + questionDraft.options.length), text: "", is_correct: false }] })}
                  className="text-xs text-[#0F2A47] hover:text-[#C9A227] flex items-center gap-1"
                ><Plus size={12} /> Add option</button>
              )}
            </div>
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">Explanation (shown after answering)</label>
              <textarea
                value={questionDraft.explanation}
                onChange={(e) => setQuestionDraft({ ...questionDraft, explanation: e.target.value })}
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => { setEditingQuestion(null); setQuestionDraft(null); }}>Cancel</Button>
              <Button variant="gold" onClick={saveQuestion}><Check size={14} /> Save Question</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Assignment form */}
      <Modal open={!!showAssignForm} onClose={() => setShowAssignForm(null)} title={`New Assignment — ${showAssignForm?.title ?? ""}`} size="lg">
        <div className="space-y-3">
          <Input label="Title" value={assignForm.title} onChange={(e) => setAssignForm({ ...assignForm, title: e.target.value })} />
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Instructions</label>
            <textarea
              value={assignForm.instructions}
              onChange={(e) => setAssignForm({ ...assignForm, instructions: e.target.value })}
              rows={4}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Max score" type="number" value={assignForm.max_score} onChange={(e) => setAssignForm({ ...assignForm, max_score: e.target.value })} />
            <Input label="Due date" type="date" value={assignForm.due_date} onChange={(e) => setAssignForm({ ...assignForm, due_date: e.target.value })} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowAssignForm(null)}>Cancel</Button>
            <Button variant="gold" onClick={saveAssignment} loading={savingAssign}>Create Assignment</Button>
          </div>
        </div>
      </Modal>

      {/* Grading */}
      <Modal open={!!gradingSubmission} onClose={() => { setGradingSubmission(null); setGradingAssignment(null); }} title="Grade Submission" size="lg">
        {gradingSubmission && gradingAssignment && (
          <div className="space-y-3">
            <div>
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Student response</p>
              <div className="text-sm bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 max-h-40 overflow-y-auto whitespace-pre-wrap">
                {gradingSubmission.response_text || "(no text submitted)"}
              </div>
            </div>

            <button
              onClick={suggestGrade}
              disabled={suggestingGrade}
              className="text-xs text-[#0F2A47] hover:text-[#C9A227] flex items-center gap-1 disabled:opacity-50"
            >
              {suggestingGrade ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
              {suggestingGrade ? "Asking AI…" : "AI Suggest Grade"}
            </button>

            {gradingSubmission.ai_suggested_score != null && (
              <div className="rounded-lg border border-purple-200 bg-purple-50 px-3 py-2 text-xs text-purple-800">
                <p className="font-semibold flex items-center gap-1"><Sparkles size={11} /> AI suggests {gradingSubmission.ai_suggested_score} / {gradingAssignment.max_score}</p>
                <p className="mt-1">{gradingSubmission.ai_suggested_feedback}</p>
                <p className="mt-1.5 text-[10px] text-purple-500 italic">This is only a suggestion. Edit the fields below and confirm — nothing is saved until you click Save Grade.</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Input label={`Score (out of ${gradingAssignment.max_score})`} type="number" value={scoreDraft} onChange={(e) => setScoreDraft(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">Feedback</label>
              <textarea
                value={feedbackDraft}
                onChange={(e) => setFeedbackDraft(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => { setGradingSubmission(null); setGradingAssignment(null); }}>Cancel</Button>
              <Button variant="gold" onClick={saveGrade} loading={savingGrade}><Check size={14} /> Save Grade</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Enroll picker */}
      <Modal open={enrollPickerOpen} onClose={() => setEnrollPickerOpen(false)} title="Enroll Student">
        <div className="space-y-3">
          <Input placeholder="Search students…" value={enrollSearch} onChange={(e) => setEnrollSearch(e.target.value)} />
          <div className="max-h-72 overflow-y-auto space-y-1">
            {availableStudents.length === 0 ? (
              <p className="text-xs text-gray-400 italic py-4 text-center">No matching students.</p>
            ) : availableStudents.slice(0, 50).map((s) => (
              <button
                key={s.id}
                onClick={() => { enrollStudent(s.id); }}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-gray-50 text-left text-sm"
              >
                <span>{s.full_name} <span className="text-gray-400 text-xs">{s.student_code}</span></span>
                <Plus size={14} className="text-[#C9A227]" />
              </button>
            ))}
          </div>
        </div>
      </Modal>

      <ToastHost />
    </div>
  );
}
