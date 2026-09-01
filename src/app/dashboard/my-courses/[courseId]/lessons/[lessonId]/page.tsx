"use client";

/**
 * Student lesson viewer.
 *
 * Renders lesson content, marks it in-progress on open and completed
 * when the student clicks "Mark Complete" (which also calls
 * lms_check_and_award_badges so new badges appear immediately), offers
 * the quiz for this lesson (server-scored via lms_submit_quiz_attempt
 * -- never trusts a client-computed score), a discussion/Q&A thread,
 * and an AI study helper chat scoped to this one lesson's content via
 * /api/ai/lms-study-help (never /api/ai/generate, which is staff-only).
 */

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { useToast } from "@/lib/hooks/useToast";
import { extractErrorMessage } from "@/lib/errors/extractErrorMessage";
import { renderAiOutputHtml } from "@/lib/ai/richText";
import { cn, fmtDateTime } from "@/lib/utils";
import { PageHeader, LoadingSpinner, EmptyState } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import {
  ArrowLeft, CheckCircle2, Sparkles, Send, MessageSquare, Loader2,
  Award, Trophy, X as XIcon,
} from "lucide-react";

interface LessonRow { id: string; course_id: string; title: string; content: string | null; estimated_minutes: number | null; }
interface QuizRow { id: string; title: string; pass_mark_percent: number; max_attempts: number; }
interface QuestionRow { id: string; question_text: string; options: { id: string; text: string; is_correct: boolean }[]; explanation: string | null; marks: number; }
interface AttemptRow { id: string; attempt_number: number; score: number | null; percentage: number | null; passed: boolean | null; submitted_at: string | null; }
interface AnswerRow { question_id: string; selected_option_id: string | null; is_correct: boolean | null; }
interface DiscussionRow { id: string; title: string; body: string | null; student_id: string | null; staff_id: string | null; status: string; created_at: string; }
interface ReplyRow { id: string; discussion_id: string; body: string; student_id: string | null; staff_id: string | null; is_ai_generated: boolean; created_at: string; }
interface StudyChatMsg { role: "student" | "ai"; text: string; }
interface BadgeAward { id: string; name: string; }

export default function LessonViewerPage() {
  const params = useParams<{ courseId: string; lessonId: string }>();
  const { courseId, lessonId } = params;
  const { user } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const { notify, ToastHost } = useToast();

  const [loading, setLoading] = useState(true);
  const [studentId, setStudentId] = useState<string | null>(null);
  const [studentName, setStudentName] = useState<string>("");
  const [lesson, setLesson] = useState<LessonRow | null>(null);
  const [progressStatus, setProgressStatus] = useState<string>("not_started");
  const [quiz, setQuiz] = useState<QuizRow | null>(null);
  const [questions, setQuestions] = useState<QuestionRow[]>([]);
  const [attempts, setAttempts] = useState<AttemptRow[]>([]);
  const [lastAnswers, setLastAnswers] = useState<AnswerRow[]>([]);
  const [discussions, setDiscussions] = useState<DiscussionRow[]>([]);
  const [replies, setReplies] = useState<Record<string, ReplyRow[]>>({});
  const [newBadges, setNewBadges] = useState<BadgeAward[]>([]);

  const load = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    setLoading(true);

    let stuId: string | null = null;
    let stuName = "";
    const { data: byProfile } = await supabase.from("students").select("id, full_name").eq("profile_id", user.id).maybeSingle();
    if (byProfile) { stuId = (byProfile as { id: string }).id; stuName = (byProfile as { full_name: string }).full_name; }
    if (!stuId) {
      const { data: byEmail } = await supabase.from("students").select("id, full_name").eq("guardian_email", user.email).eq("status", "active").limit(1).maybeSingle();
      if (byEmail) { stuId = (byEmail as { id: string }).id; stuName = (byEmail as { full_name: string }).full_name; }
    }
    if (!stuId) { setLoading(false); return; }
    setStudentId(stuId);
    setStudentName(stuName);

    const { data: l } = await supabase.from("lms_lessons").select("id, course_id, title, content, estimated_minutes").eq("id", lessonId).maybeSingle();
    setLesson(l as LessonRow | null);

    const { data: lp } = await supabase.from("lms_lesson_progress").select("status").eq("lesson_id", lessonId).eq("student_id", stuId).maybeSingle();
    const currentStatus = (lp as { status: string } | null)?.status ?? "not_started";
    setProgressStatus(currentStatus);
    if (currentStatus === "not_started") {
      await supabase.from("lms_lesson_progress").upsert(
        { lesson_id: lessonId, student_id: stuId, status: "in_progress", started_at: new Date().toISOString() },
        { onConflict: "lesson_id,student_id" }
      );
      setProgressStatus("in_progress");
    }

    const { data: q } = await supabase.from("lms_quizzes").select("id, title, pass_mark_percent, max_attempts").eq("lesson_id", lessonId).maybeSingle();
    const quizRow = q as QuizRow | null;
    setQuiz(quizRow);
    if (quizRow) {
      const [qqRes, attRes] = await Promise.all([
        supabase.from("lms_quiz_questions").select("id, question_text, options, explanation, marks").eq("quiz_id", quizRow.id).order("sort_order"),
        supabase.from("lms_quiz_attempts").select("id, attempt_number, score, percentage, passed, submitted_at").eq("quiz_id", quizRow.id).eq("student_id", stuId).order("attempt_number", { ascending: false }),
      ]);
      setQuestions((qqRes.data as QuestionRow[]) ?? []);
      const attemptRows = (attRes.data as AttemptRow[]) ?? [];
      setAttempts(attemptRows);
      if (attemptRows.length > 0) {
        const { data: ans } = await supabase.from("lms_quiz_answers").select("question_id, selected_option_id, is_correct").eq("attempt_id", attemptRows[0].id);
        setLastAnswers((ans as AnswerRow[]) ?? []);
      }
    }

    const { data: disc } = await supabase.from("lms_discussions").select("*").eq("lesson_id", lessonId).order("created_at", { ascending: false });
    const discRows = (disc as DiscussionRow[]) ?? [];
    setDiscussions(discRows);
    if (discRows.length > 0) {
      const { data: rep } = await supabase.from("lms_discussion_replies").select("*").in("discussion_id", discRows.map((d) => d.id)).order("created_at");
      const byDisc: Record<string, ReplyRow[]> = {};
      for (const row of (rep as ReplyRow[]) ?? []) (byDisc[row.discussion_id] ||= []).push(row);
      setReplies(byDisc);
    }

    setLoading(false);
  }, [user, supabase, lessonId]);

  useEffect(() => { load(); }, [load]);

  async function markComplete() {
    if (!studentId) return;
    const { error } = await supabase.from("lms_lesson_progress").upsert(
      { lesson_id: lessonId, student_id: studentId, status: "completed", completed_at: new Date().toISOString() },
      { onConflict: "lesson_id,student_id" }
    );
    if (error) { notify(extractErrorMessage(error, "Failed to update progress."), "error"); return; }
    setProgressStatus("completed");
    notify("Lesson marked complete!");
    const { data: awarded } = await supabase.rpc("lms_check_and_award_badges", { p_student_id: studentId });
    if (typeof awarded === "number" && awarded > 0) {
      const { data: myBadges } = await supabase
        .from("lms_student_badges")
        .select("earned_at, lms_badges(id, name)")
        .eq("student_id", studentId)
        .order("earned_at", { ascending: false })
        .limit(awarded);
      const rows = ((myBadges as unknown[]) ?? []).map((row) => {
        const r = row as { lms_badges: { id: string; name: string } | null };
        return r.lms_badges;
      }).filter((b): b is BadgeAward => b !== null);
      if (rows.length > 0) setNewBadges(rows);
    }
  }

  /* ---------------- Quiz taking ---------------- */
  const [taking, setTaking] = useState(false);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [submittingQuiz, setSubmittingQuiz] = useState(false);
  const [lastResult, setLastResult] = useState<{ score: number; percentage: number; passed: boolean } | null>(null);

  const attemptsUsed = attempts.length;
  const canAttempt = quiz ? attemptsUsed < quiz.max_attempts : false;

  async function submitQuiz() {
    if (!quiz || !studentId) return;
    if (Object.keys(selections).length < questions.length) {
      notify("Answer every question before submitting.", "error");
      return;
    }
    setSubmittingQuiz(true);
    try {
      const answers = questions.map((q) => ({ question_id: q.id, selected_option_id: selections[q.id] }));
      const { data, error } = await supabase.rpc("lms_submit_quiz_attempt", { p_quiz_id: quiz.id, p_student_id: studentId, p_answers: answers }).maybeSingle();
      if (error) throw error;
      const result = data as { attempt_id: string; score_result: number; percentage_result: number; passed_result: boolean };
      setLastResult({ score: result.score_result, percentage: result.percentage_result, passed: result.passed_result });
      notify(result.passed_result ? `Passed with ${result.percentage_result}%!` : `Scored ${result.percentage_result}% — you can review and try again.`, result.passed_result ? "success" : "info");
      setTaking(false);
      setSelections({});
      await load();
      const { data: awarded } = await supabase.rpc("lms_check_and_award_badges", { p_student_id: studentId });
      if (typeof awarded === "number" && awarded > 0) {
        const { data: myBadges } = await supabase.from("lms_student_badges").select("earned_at, lms_badges(id, name)").eq("student_id", studentId).order("earned_at", { ascending: false }).limit(awarded);
        const rows = ((myBadges as unknown[]) ?? []).map((row) => (row as { lms_badges: { id: string; name: string } | null }).lms_badges).filter((b): b is BadgeAward => b !== null);
        if (rows.length > 0) setNewBadges(rows);
      }
    } catch (err) {
      notify(extractErrorMessage(err, "Failed to submit quiz."), "error");
    } finally {
      setSubmittingQuiz(false);
    }
  }

  /* ---------------- Discussion ---------------- */
  const [showNewThread, setShowNewThread] = useState(false);
  const [threadTitle, setThreadTitle] = useState("");
  const [threadBody, setThreadBody] = useState("");
  const [postingThread, setPostingThread] = useState(false);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [postingReply, setPostingReply] = useState<string | null>(null);

  async function postThread() {
    if (!studentId || !threadTitle.trim()) { notify("Add a title for your question.", "error"); return; }
    setPostingThread(true);
    try {
      const { error } = await supabase.from("lms_discussions").insert({ lesson_id: lessonId, student_id: studentId, title: threadTitle.trim(), body: threadBody.trim() || null });
      if (error) throw error;
      notify("Question posted.");
      setShowNewThread(false);
      setThreadTitle("");
      setThreadBody("");
      load();
    } catch (err) {
      notify(extractErrorMessage(err, "Failed to post question."), "error");
    } finally {
      setPostingThread(false);
    }
  }

  async function postReply(discussionId: string) {
    const text = (replyDrafts[discussionId] || "").trim();
    if (!text || !studentId) return;
    setPostingReply(discussionId);
    try {
      const { error } = await supabase.from("lms_discussion_replies").insert({ discussion_id: discussionId, student_id: studentId, body: text });
      if (error) throw error;
      setReplyDrafts({ ...replyDrafts, [discussionId]: "" });
      load();
    } catch (err) {
      notify(extractErrorMessage(err, "Failed to post reply."), "error");
    } finally {
      setPostingReply(null);
    }
  }

  /* ---------------- AI Study Helper ---------------- */
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<StudyChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMessages, chatOpen]);

  async function askStudyHelper() {
    const question = chatInput.trim();
    if (!question) return;
    setChatMessages((m) => [...m, { role: "student", text: question }]);
    setChatInput("");
    setChatBusy(true);
    try {
      const resp = await fetch("/api/ai/lms-study-help", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lesson_id: lessonId, question }),
      });
      const payload = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(payload.error || "The study helper couldn't answer that.");
      setChatMessages((m) => [...m, { role: "ai", text: payload.output }]);
    } catch (err) {
      setChatMessages((m) => [...m, { role: "ai", text: err instanceof Error ? err.message : "Something went wrong — try again." }]);
    } finally {
      setChatBusy(false);
    }
  }

  if (loading) return <div className="p-6"><LoadingSpinner /></div>;
  if (!studentId) return <div className="p-6"><EmptyState message="No student record is linked to this account yet." /></div>;
  if (!lesson) return <div className="p-6"><EmptyState message="Lesson not found." /></div>;

  return (
    <div className="p-6 space-y-5 relative">
      <Link href={`/dashboard/my-courses/${courseId}`} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-[#0F2A47]">
        <ArrowLeft size={14} /> Back to course
      </Link>

      <PageHeader title={lesson.title} subtitle={`${lesson.estimated_minutes || 15} min read`}>
        {progressStatus === "completed" ? (
          <span className="text-xs font-semibold text-emerald-600 flex items-center gap-1"><CheckCircle2 size={14} /> Completed</span>
        ) : (
          <Button variant="gold" size="sm" onClick={markComplete}><CheckCircle2 size={14} /> Mark Complete</Button>
        )}
      </PageHeader>

      <Card>
        <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: renderAiOutputHtml(lesson.content || "No content yet.") }} />
      </Card>

      {quiz && (
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-[#0F2A47]">{quiz.title}</h3>
            <span className="text-xs text-gray-500">{attemptsUsed} / {quiz.max_attempts} attempts used</span>
          </div>

          {!taking && lastResult && (
            <div className={cn("rounded-lg px-3 py-2 mb-3 text-sm", lastResult.passed ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-amber-50 text-amber-700 border border-amber-200")}>
              Scored {lastResult.percentage}% ({lastResult.score} pts) — {lastResult.passed ? "Passed!" : `Pass mark is ${quiz.pass_mark_percent}%.`}
            </div>
          )}

          {!taking && attempts.length > 0 && !lastResult && (
            <div className="rounded-lg px-3 py-2 mb-3 text-sm bg-gray-50 border border-gray-100 text-gray-600">
              Last attempt: {attempts[0].percentage}% — {attempts[0].passed ? "Passed" : "Not passed"}
            </div>
          )}

          {!taking ? (
            canAttempt ? (
              <Button variant="secondary" size="sm" onClick={() => { setTaking(true); setSelections({}); setLastResult(null); }}>
                {attemptsUsed > 0 ? "Retake Quiz" : "Start Quiz"}
              </Button>
            ) : (
              <p className="text-xs text-gray-400 italic">No attempts remaining.</p>
            )
          ) : (
            <div className="space-y-4">
              {questions.map((q, i) => (
                <div key={q.id}>
                  <p className="text-sm font-medium text-gray-700 mb-1.5">{i + 1}. {q.question_text}</p>
                  <div className="space-y-1">
                    {q.options.map((o) => (
                      <label key={o.id} className={cn("flex items-center gap-2 px-3 py-2 rounded-lg border text-sm cursor-pointer", selections[q.id] === o.id ? "border-[#C9A227] bg-[#FFFBEB]" : "border-gray-200 hover:bg-gray-50")}>
                        <input type="radio" name={`q-${q.id}`} checked={selections[q.id] === o.id} onChange={() => setSelections({ ...selections, [q.id]: o.id })} />
                        {o.text}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
              <div className="flex justify-end gap-2">
                <Button variant="secondary" size="sm" onClick={() => setTaking(false)}>Cancel</Button>
                <Button variant="gold" size="sm" onClick={submitQuiz} loading={submittingQuiz}>Submit Quiz</Button>
              </div>
            </div>
          )}

          {!taking && lastAnswers.length > 0 && attempts.length > 0 && (
            <details className="mt-3">
              <summary className="text-xs text-gray-500 cursor-pointer hover:text-[#0F2A47]">Review your last attempt</summary>
              <div className="mt-2 space-y-2">
                {questions.map((q) => {
                  const ans = lastAnswers.find((a) => a.question_id === q.id);
                  return (
                    <div key={q.id} className="text-xs bg-gray-50 rounded-lg px-3 py-2">
                      <p className={cn("font-medium", ans?.is_correct ? "text-emerald-600" : "text-red-500")}>{q.question_text}</p>
                      <p className="text-gray-500 mt-0.5">Correct answer: {q.options.find((o) => o.is_correct)?.text}</p>
                      {q.explanation && <p className="text-gray-400 mt-0.5 italic">{q.explanation}</p>}
                    </div>
                  );
                })}
              </div>
            </details>
          )}
        </Card>
      )}

      <Card>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-[#0F2A47] flex items-center gap-1.5"><MessageSquare size={14} /> Discussion &amp; Q&amp;A</h3>
          <Button variant="secondary" size="sm" onClick={() => setShowNewThread(!showNewThread)}>{showNewThread ? "Cancel" : "Ask a question"}</Button>
        </div>

        {showNewThread && (
          <div className="space-y-2 mb-4 p-3 bg-gray-50 rounded-lg">
            <input value={threadTitle} onChange={(e) => setThreadTitle(e.target.value)} placeholder="Question title" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            <textarea value={threadBody} onChange={(e) => setThreadBody(e.target.value)} placeholder="Add more detail (optional)" rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            <div className="flex justify-end">
              <Button variant="gold" size="sm" onClick={postThread} loading={postingThread}>Post</Button>
            </div>
          </div>
        )}

        {discussions.length === 0 ? (
          <p className="text-xs text-gray-400 italic">No questions yet — be the first to ask.</p>
        ) : (
          <div className="space-y-3">
            {discussions.map((d) => (
              <div key={d.id} className="border border-gray-100 rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-gray-700">{d.title}</p>
                  <span className={cn("text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full", d.status === "resolved" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700")}>{d.status}</span>
                </div>
                {d.body && <p className="text-xs text-gray-500 mt-1">{d.body}</p>}
                <p className="text-[10px] text-gray-400 mt-1">{fmtDateTime(d.created_at)}</p>
                {(replies[d.id] || []).length > 0 && (
                  <div className="mt-2 space-y-1.5 pl-3 border-l-2 border-gray-100">
                    {(replies[d.id] || []).map((r) => (
                      <div key={r.id} className="text-xs">
                        <span className={cn("font-medium", r.staff_id ? "text-[#0F2A47]" : "text-gray-600")}>{r.staff_id ? "Teacher" : "Student"}:</span> {r.body}
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-2 flex gap-2">
                  <input
                    value={replyDrafts[d.id] || ""}
                    onChange={(e) => setReplyDrafts({ ...replyDrafts, [d.id]: e.target.value })}
                    placeholder="Write a reply…"
                    className="flex-1 px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs"
                    onKeyDown={(e) => { if (e.key === "Enter") postReply(d.id); }}
                  />
                  <Button variant="secondary" size="sm" onClick={() => postReply(d.id)} loading={postingReply === d.id}>Reply</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* AI Study Helper floating widget */}
      {!chatOpen && (
        <button
          onClick={() => setChatOpen(true)}
          className="fixed bottom-6 right-6 z-40 flex items-center gap-2 bg-[#0F2A47] text-white rounded-full px-4 py-3 shadow-lg hover:bg-[#1B3E63] transition-colors"
        >
          <Sparkles size={16} className="text-[#C9A227]" /> Ask AI about this lesson
        </button>
      )}
      {chatOpen && (
        <div className="fixed bottom-6 right-6 z-40 w-80 sm:w-96 bg-white rounded-xl shadow-2xl border border-gray-200 flex flex-col max-h-[28rem]">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-[#0F2A47] rounded-t-xl">
            <span className="text-sm font-semibold text-white flex items-center gap-1.5"><Sparkles size={14} className="text-[#C9A227]" /> Study Helper</span>
            <button onClick={() => setChatOpen(false)} className="text-white/70 hover:text-white"><XIcon size={16} /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {chatMessages.length === 0 && (
              <p className="text-xs text-gray-400 italic">Ask a question about &quot;{lesson.title}&quot; — I can only help with this lesson&apos;s content.</p>
            )}
            {chatMessages.map((m, i) => (
              <div key={i} className={cn("text-xs rounded-lg px-3 py-2 max-w-[85%]", m.role === "student" ? "bg-[#0F2A47] text-white ml-auto" : "bg-gray-100 text-gray-700")}>
                {m.text}
              </div>
            ))}
            {chatBusy && <div className="flex items-center gap-1 text-xs text-gray-400"><Loader2 size={12} className="animate-spin" /> Thinking…</div>}
            <div ref={chatEndRef} />
          </div>
          <div className="p-2 border-t border-gray-100 flex gap-1.5">
            <input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !chatBusy) askStudyHelper(); }}
              placeholder="Ask a question…"
              maxLength={600}
              className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
            />
            <button onClick={askStudyHelper} disabled={chatBusy || !chatInput.trim()} className="p-2 rounded-lg bg-[#C9A227] text-[#0F2A47] disabled:opacity-40">
              <Send size={14} />
            </button>
          </div>
        </div>
      )}

      {/* New badge celebration */}
      {newBadges.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setNewBadges([])}>
          <div className="bg-white rounded-2xl p-6 max-w-xs text-center space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="w-16 h-16 mx-auto rounded-full bg-gradient-to-br from-[#C9A227] to-[#0F2A47] flex items-center justify-center text-white">
              <Trophy size={28} />
            </div>
            <h3 className="font-bold text-[#0F2A47]">New badge{newBadges.length > 1 ? "s" : ""} earned!</h3>
            <div className="space-y-1">
              {newBadges.map((b) => (
                <p key={b.id} className="text-sm text-gray-600 flex items-center justify-center gap-1"><Award size={14} className="text-[#C9A227]" /> {b.name}</p>
              ))}
            </div>
            <Button variant="gold" size="sm" className="w-full" onClick={() => setNewBadges([])}>Nice!</Button>
          </div>
        </div>
      )}

      <ToastHost />
    </div>
  );
}
