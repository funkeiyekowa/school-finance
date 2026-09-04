"use client";

/**
 * Student exam runner.
 *
 * Uses two SECURITY DEFINER RPCs (start_exam_attempt / submit_exam_attempt)
 * so assignment, release-window, max-attempts and grading are enforced on
 * the server, not the client. The take page still auto-saves answers as
 * they are chosen — those upserts are authorised by the
 * `student_own_answers_all` RLS policy which permits writes only while the
 * owning attempt is still in_progress.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { cn } from "@/lib/utils";
import { LoadingSpinner } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { CheckCircle2, Clock, Flag, ChevronLeft, ChevronRight, AlertTriangle, Lock, Maximize } from "lucide-react";

interface OptionRow { id: string; text: string; is_correct: boolean; }
interface MatchingPair { left: string; right: string; }
interface ExamData {
  id: string; title: string; duration_minutes: number; total_marks: number;
  pass_mark: number; shuffle_questions: boolean; shuffle_options: boolean;
  show_results: boolean; show_answers: boolean;
  settings: Record<string, unknown>;
}
interface QuestionData {
  id: string;
  question_text: string;
  question_type: string;
  options: OptionRow[];
  pairs?: MatchingPair[];
  marks: number;
  sort_order: number;
}
interface AttemptData {
  id: string; started_at: string; status: string;
  total_score: number | null; percentage: number | null; passed: boolean | null;
  total_marks: number | null;
}

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Answers are stored in state keyed by question id. Shape depends on type:
 *   single-option types (multiple_choice, true_false)     → { selected: "A" }
 *   multi-answer                                          → { selected: ["A","C"] }
 *   text-entry types (short_answer, fill_blank, numeric)  → { text: "..." }
 *   essay                                                 → { text: "..." }
 *   matching                                              → { pairs: [{left,right},...] }
 */
type AnswerValue = {
  selected?: string | string[];
  text?: string;
  pairs?: MatchingPair[];
};

export default function TakeExamPage() {
  const { examId } = useParams<{ examId: string }>();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exam, setExam] = useState<ExamData | null>(null);
  const [questions, setQuestions] = useState<QuestionData[]>([]);
  const [attempt, setAttempt] = useState<AttemptData | null>(null);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [flagged, setFlagged] = useState<Set<string>>(new Set());
  const [timeLeft, setTimeLeft] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const [proctored, setProctored] = useState(false);
  const [fullscreenRequired, setFullscreenRequired] = useState(false);
  const [maxViolations, setMaxViolations] = useState(3);
  const [signOutOnViolation, setSignOutOnViolation] = useState(true);
  const [violations, setViolations] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [saveWarning, setSaveWarning] = useState<string | null>(null);
  const autoSubmittingRef = useRef(false);

  const requestFullscreen = useCallback(() => {
    // Best-effort. Browsers may refuse fullscreen without a fresh user
    // gesture, and the user can always exit it — fullscreen is a deterrent
    // and a proctoring signal, never a hard guarantee (see MDN Fullscreen API).
    try {
      const el = document.documentElement;
      if (!document.fullscreenElement && el.requestFullscreen) {
        el.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
      }
    } catch { /* ignore */ }
  }, []);

  /* ---------- Proctoring ---------- */
  useEffect(() => {
    if (!proctored || submitted) return;

    // One place to count violations, whatever their source (leaving the tab,
    // minimising, switching apps, or exiting fullscreen). The functional
    // update + autoSubmittingRef guard guarantee that a burst of events from
    // a single action can only ever produce ONE forced submission.
    function registerViolation(kind: string) {
      setViolations(prev => {
        const next = prev + 1;
        if (next >= maxViolations) {
          if (!autoSubmittingRef.current) {
            autoSubmittingRef.current = true;
            alert("You have exceeded the allowed number of proctoring violations. Your exam will be submitted.");
            // Auto-submit (reason tab_switch_limit) and, per config, sign the
            // student out of the app entirely so they cannot resume/return.
            void submitExam(true, true, "tab_switch_limit", signOutOnViolation);
          }
        } else {
          const remaining = maxViolations - next;
          alert(`Proctoring warning ${next}/${maxViolations} — ${kind}. ${remaining} warning${remaining === 1 ? "" : "s"} left before your exam is auto-submitted.`);
        }
        return next;
      });
    }

    function handleVisibility() {
      if (document.hidden && !autoSubmittingRef.current) registerViolation("you left the exam");
    }
    function handleFullscreenChange() {
      const fs = !!document.fullscreenElement;
      setIsFullscreen(fs);
      // Count only EXITING fullscreen (not entering it), and only when the
      // exam requires fullscreen.
      if (!fs && fullscreenRequired && !autoSubmittingRef.current) {
        registerViolation("you left fullscreen");
      }
    }
    function block(e: Event) { e.preventDefault(); }

    document.addEventListener("visibilitychange", handleVisibility);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("copy", block);
    document.addEventListener("paste", block);
    document.addEventListener("contextmenu", block);
    requestFullscreen();

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("copy", block);
      document.removeEventListener("paste", block);
      document.removeEventListener("contextmenu", block);
    };
  }, [proctored, submitted, maxViolations, signOutOnViolation, fullscreenRequired, requestFullscreen]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- Init: start_exam_attempt RPC + load questions ---------- */
  const init = useCallback(async () => {
    if (!user) return;

    // DEFENSE IN DEPTH: independently verify that (1) the authenticated user
    // is a student with a linked profile, (2) if they have an active attempt
    // it belongs to THIS exam — not a different one, and (3) the attempt is
    // in_progress. The middleware and AppShell guard handle most navigation
    // cases, but this page must not trust that either ran.
    const { data: lockData } = await supabase.rpc("get_active_exam_lock");
    const lockRow = Array.isArray(lockData) ? lockData?.[0] : lockData;
    const lockedExamId = (lockRow as { exam_id?: string } | undefined)?.exam_id;

    // If the student has an active attempt for a DIFFERENT exam, redirect.
    if (lockedExamId && lockedExamId !== examId) {
      router.replace(`/dashboard/cbt/${lockedExamId}/take`);
      return;
    }

    // Start (or resume) the attempt via the server. The RPC validates
    // status='published', starts_at/ends_at window, cbt_exam_assignments
    // membership, and max_attempts. Any denial is surfaced verbatim.
    const { data: startRes, error: startErr } = await supabase.rpc("start_exam_attempt", {
      p_exam: examId,
    });

    if (startErr) {
      setError(startErr.message || "Unable to start the exam.");
      setLoading(false);
      return;
    }
    const res = (startRes ?? {}) as { ok?: boolean; reason?: string; attempt_id?: string; starts_at?: string; ends_at?: string };
    if (!res.ok || !res.attempt_id) {
      const map: Record<string, string> = {
        exam_not_found:      "This exam does not exist or has been withdrawn.",
        not_published:       "This exam has not been published yet.",
        not_yet_open:        `This exam opens at ${res.starts_at ? new Date(res.starts_at).toLocaleString() : "a later time"}.`,
        closed:              `This exam closed at ${res.ends_at ? new Date(res.ends_at).toLocaleString() : "an earlier time"}.`,
        not_assigned:        "You are not assigned to this exam. Please contact your teacher.",
        max_attempts_reached:"You have used all your attempts for this exam.",
      };
      setError(map[res.reason ?? ""] ?? "You cannot take this exam right now.");
      setLoading(false);
      return;
    }

    // Load exam metadata, and the questions via the sanitized RPC. The
    // questions/exam_questions tables are staff-only under RLS, so the
    // student never receives is_correct / answer_text — get_attempt_questions
    // strips them server-side.
    const [examResp, qResp] = await Promise.all([
      supabase.from("exams").select("*").eq("id", examId).single(),
      supabase.rpc("get_attempt_questions", { p_attempt: res.attempt_id }),
    ]);
    const examData = examResp.data;
    if (qResp.error) {
      setError(qResp.error.message || "Could not load the exam questions.");
      setLoading(false);
      return;
    }
    const qData = (qResp.data ?? []) as {
      id: string; question_text: string; question_type: string;
      options: unknown; marks: number; sort_order: number;
    }[];
    if (!examData || qData.length === 0) {
      setError("This exam has no questions yet.");
      setLoading(false);
      return;
    }
    setExam(examData as unknown as ExamData);
    // Proctoring config lives in exams.settings (jsonb). Sensible defaults so
    // an exam flagged proctored is locked down even without explicit knobs.
    const s = (examData.settings as Record<string, unknown>) ?? {};
    const isProctored = s.proctored === true;
    setProctored(isProctored);
    setFullscreenRequired(s.fullscreen_required === true || isProctored);
    setMaxViolations(typeof s.max_violations === "number" && s.max_violations > 0 ? s.max_violations : 3);
    setSignOutOnViolation(s.sign_out_on_violation !== false); // default true

    let questionList: QuestionData[] = qData.map(q => {
      const rawOpts = q.options;
      let opts: OptionRow[] = [];
      let pairs: MatchingPair[] | undefined;
      if (Array.isArray(rawOpts)) {
        // Sanitized options: [{ id, text }] — no is_correct present.
        opts = (rawOpts as { id: string; text: string }[]).map(o => ({ ...o, is_correct: false }));
      } else if (rawOpts && typeof rawOpts === "object") {
        const obj = rawOpts as { pairs?: { left: string }[]; choices?: string[]; options?: OptionRow[] };
        if (Array.isArray(obj.pairs)) {
          // Matching: reconstruct pairs with the shuffled right-hand choices
          // as the pickable options; correctness lives only on the server.
          const choices = Array.isArray(obj.choices) ? obj.choices : [];
          pairs = obj.pairs.map((p, i) => ({ left: p.left, right: choices[i] ?? "" }));
        }
        if (Array.isArray(obj.options)) opts = obj.options;
      }
      return {
        id: q.id,
        question_text: q.question_text,
        question_type: q.question_type,
        options: opts,
        pairs,
        marks: q.marks,
        sort_order: q.sort_order ?? 0,
      };
    });

    questionList.sort((a, b) => a.sort_order - b.sort_order);
    if (examData.shuffle_questions) questionList = shuffleArray(questionList);
    if (examData.shuffle_options) {
      questionList = questionList.map(q => ({ ...q, options: shuffleArray(q.options) }));
    }
    setQuestions(questionList);

    // Fetch the attempt row so we know started_at for the timer and any
    // previously-saved answers if this is a resume.
    const { data: attemptRow } = await supabase
      .from("exam_attempts")
      .select("id, started_at, status, total_score, total_marks, percentage, passed")
      .eq("id", res.attempt_id)
      .single();
    setAttempt(attemptRow as AttemptData);

    const { data: ansData } = await supabase
      .from("exam_answers")
      .select("question_id, selected_option, answer_text, flagged")
      .eq("attempt_id", res.attempt_id);

    const loadedAnswers: Record<string, AnswerValue> = {};
    const loadedFlagged = new Set<string>();
    for (const a of (ansData ?? [])) {
      const q = questionList.find(x => x.id === a.question_id);
      if (!q) continue;
      const v: AnswerValue = {};
      if (q.question_type === "multi_answer") {
        v.selected = (a.selected_option ?? "").split(",").filter(Boolean);
      } else if (q.question_type === "matching") {
        try { v.pairs = a.selected_option ? JSON.parse(a.selected_option) : []; }
        catch { v.pairs = []; }
      } else if (["short_answer", "fill_blank", "numeric", "essay"].includes(q.question_type)) {
        v.text = a.answer_text ?? "";
      } else {
        v.selected = a.selected_option ?? undefined;
      }
      loadedAnswers[a.question_id] = v;
      if (a.flagged) loadedFlagged.add(a.question_id);
    }
    setAnswers(loadedAnswers);
    setFlagged(loadedFlagged);

    const elapsed = Math.floor(
      (Date.now() - new Date(attemptRow!.started_at).getTime()) / 1000
    );
    setTimeLeft(Math.max(0, (examData.duration_minutes * 60) - elapsed));

    setLoading(false);
  }, [examId, user, supabase, router]);

  useEffect(() => { init(); }, [init]);

  /* ---------- Timer ---------- */
  //
  // The interval starts only once we have BOTH the attempt row and a
  // positive timeLeft.  Previously the effect depended only on [attempt,
  // submitted] and bailed on the first render (timeLeft was still 0 in the
  // same tick).  Adding timeLeft to the deps re-arms the interval as soon
  // as init() writes the real remaining seconds.  We also use a ref to make
  // sure only one interval is ever live.
  useEffect(() => {
    if (submitted || !attempt || timeLeft <= 0) return;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          timerRef.current = null;
          if (!autoSubmittingRef.current) {
            autoSubmittingRef.current = true;
            void submitExam(true, true);
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [attempt, submitted, timeLeft > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  /* ---------- Auto-save ---------- */
  async function persistAnswer(questionId: string, value: AnswerValue, flag?: boolean) {
    if (!attempt) return;
    const q = questions.find(x => x.id === questionId);
    let selected_option: string | null = null;
    let answer_text: string | null = null;
    if (q?.question_type === "multi_answer") {
      selected_option = Array.isArray(value.selected) ? value.selected.join(",") : null;
    } else if (q?.question_type === "matching") {
      selected_option = JSON.stringify(value.pairs ?? []);
    } else if (q && ["short_answer","fill_blank","numeric","essay"].includes(q.question_type)) {
      answer_text = value.text ?? "";
    } else {
      selected_option = (typeof value.selected === "string" ? value.selected : null) ?? null;
    }
    // Persist via a SECURITY DEFINER RPC rather than a direct table upsert.
    // The direct upsert was silently rejected by RLS (the row carried no
    // organization_id, which tenant_exam_answers_all's WITH CHECK requires),
    // so answers were never saved and every paper graded 0. The RPC verifies
    // ownership + in_progress and stamps organization_id server-side.
    const { data, error } = await supabase.rpc("save_exam_answer", {
      p_attempt: attempt.id,
      p_question: questionId,
      p_selected_option: selected_option,
      p_answer_text: answer_text,
      p_flagged: flag ?? flagged.has(questionId),
    });
    const res = (data ?? {}) as { ok?: boolean; reason?: string };
    if (error || !res.ok) {
      // Surface the problem instead of losing the answer silently. Keep the
      // exam usable — the student can retry by re-selecting — but make it
      // visible so a save outage never again hides behind a 0 score.
      setSaveWarning(
        "We couldn't save your last answer. Check your connection; your answer will be re-saved when you change it again."
      );
      return false;
    }
    setSaveWarning(null);
    return true;
  }

  function updateAnswer(questionId: string, patch: AnswerValue) {
    setAnswers(prev => {
      const next = { ...prev, [questionId]: { ...(prev[questionId] ?? {}), ...patch } };
      // Fire-and-forget the autosave; we intentionally don't await here so the
      // UI stays snappy. The final submit_exam_attempt RPC re-grades every
      // answer server-side so a lost autosave never leaves a stale mark.
      void persistAnswer(questionId, next[questionId]);
      return next;
    });
  }

  function toggleFlag(questionId: string) {
    setFlagged(prev => {
      const next = new Set(prev);
      if (next.has(questionId)) next.delete(questionId);
      else next.add(questionId);
      void persistAnswer(questionId, answers[questionId] ?? {}, next.has(questionId));
      return next;
    });
  }

  /* ---------- Submit ---------- */
  // Flush every answer currently in state through the save RPC before we
  // grade, so a fast manual submit or an auto-submit (timeout / tab-switch)
  // can never grade a paper that's missing its last few answers. Awaited,
  // unlike the per-keystroke autosave.
  async function flushAllAnswers() {
    if (!attempt) return;
    const entries = Object.entries(answers);
    await Promise.all(entries.map(([qid, val]) => persistAnswer(qid, val)));
  }

  async function submitExam(timedOut = false, autoRedirect = false, reason?: string, signOutAfter = false) {
    if (!attempt) return;
    setSubmitting(true);
    if (timerRef.current) clearInterval(timerRef.current);

    // Make sure nothing the student picked is left unsaved before grading.
    // Awaited so no answer is lost on a fast manual submit or an auto-submit.
    await flushAllAnswers();

    // Prefer the 3-arg RPC that records WHY the attempt ended. If the DB
    // hasn't had cbt_ai_integration.sql applied yet, that overload won't
    // exist (PostgREST returns PGRST202 / "Could not find the function"),
    // so we transparently fall back to the original 2-arg call. This keeps
    // exam submission working regardless of migration/deploy ordering — a
    // student's paper is never blocked by a not-yet-applied migration.
    let { data, error: err } = await supabase.rpc("submit_exam_attempt", {
      p_attempt: attempt.id,
      p_timed_out: timedOut,
      p_reason: reason ?? (timedOut ? "timed_out" : "manual"),
    });
    if (err && (err.code === "PGRST202" || /Could not find the function/i.test(err.message))) {
      ({ data, error: err } = await supabase.rpc("submit_exam_attempt", {
        p_attempt: attempt.id,
        p_timed_out: timedOut,
      }));
    }

    if (err) {
      setError(err.message);
      setSubmitting(false);
      return;
    }
    const res = data as { ok: boolean; total_score: number; total_marks: number; percentage: number; passed: boolean | null };
    setAttempt(prev => prev ? {
      ...prev, status: timedOut ? "timed_out" : "submitted",
      total_score: res.total_score, total_marks: res.total_marks,
      percentage: res.percentage, passed: res.passed,
    } : null);
    setSubmitted(true);
    setSubmitting(false);

    try { if (document.fullscreenElement) await document.exitFullscreen(); } catch { /* ignore */ }

    // A CBT integrity violation (tab-switch limit exceeded) submits the paper
    // AND signs the student out of the app entirely, so they cannot resume,
    // reopen, or navigate anywhere in the session after cheating was detected.
    if (signOutAfter) {
      try {
        alert("Your exam has been submitted and you are being signed out due to repeated tab switching.");
        await signOut();
      } finally {
        // signOut redirects on its own, but guarantee we leave the exam page.
        router.push("/login");
      }
      return;
    }

    // Other auto-submits (time expired) leave the exam screen automatically so
    // the student can't keep interacting with it. A normal manual submit stays
    // on the in-page results/summary card.
    if (autoRedirect) {
      router.push("/dashboard/my-exams");
    }
  }

  /* ---------- Rendering ---------- */
  if (loading) return <div className="flex items-center justify-center min-h-screen"><LoadingSpinner /></div>;

  if (error) return (
    <div className="min-h-screen bg-[#F7F5F0] flex items-center justify-center p-6">
      <Card className="max-w-md w-full">
        <CardContent className="py-8 text-center space-y-4">
          <AlertTriangle size={40} className="mx-auto text-amber-500" />
          <h1 className="text-lg font-bold text-[#0F2A47]">Cannot start this exam</h1>
          <p className="text-sm text-gray-600">{error}</p>
          <Button variant="gold" onClick={() => router.push("/dashboard/my-exams")}>Back to my exams</Button>
        </CardContent>
      </Card>
    </div>
  );

  if (!exam || !attempt) return null;

  // Post-submit summary — always shown, honours exam.show_results for detail.
  //   * show_results=true  -> shows score, total, %, pass/fail
  //   * show_results=false -> confirmation only (no numbers), matches the
  //     exam owner's setting so students don't see leaked scores.
  //   * Regardless of setting we hand the student a "Back to My Exams"
  //     button so they never get stuck on a blank page.
  if (submitted) {
    const showDetail = !!exam.show_results;
    return (
      <div className="min-h-screen bg-[#F7F5F0] flex items-center justify-center p-6">
        <Card className="max-w-md w-full">
          <CardContent className="py-8 text-center space-y-4">
            <CheckCircle2 size={48} className={cn("mx-auto", showDetail && attempt.passed ? "text-green-600" : showDetail && attempt.passed === false ? "text-red-500" : "text-[#C9A227]")} />
            <h1 className="text-xl font-bold text-[#0F2A47]">Exam Submitted</h1>
            <p className="text-gray-600">{exam.title}</p>
            {showDetail ? (
              <>
                <div className="grid grid-cols-3 gap-3 pt-4">
                  <div className="bg-gray-50 rounded-lg p-3">
                    <div className="text-2xl font-bold text-[#0F2A47]">{attempt.total_score ?? 0}</div>
                    <div className="text-xs text-gray-500">Score</div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <div className="text-2xl font-bold text-[#0F2A47]">{attempt.total_marks ?? exam.total_marks}</div>
                    <div className="text-xs text-gray-500">Total</div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <div className="text-2xl font-bold text-[#0F2A47]">{attempt.percentage ?? 0}%</div>
                    <div className="text-xs text-gray-500">Percentage</div>
                  </div>
                </div>
                {attempt.passed !== null && (
                  <div className={cn("text-sm font-bold", attempt.passed ? "text-green-600" : "text-red-600")}>
                    {attempt.passed ? "PASSED" : "FAILED"}
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-gray-500">
                Thank you. Your answers have been recorded. Results will be released by your teacher.
              </p>
            )}
            <Button variant="gold" onClick={() => router.push("/dashboard/my-exams")} className="mt-4">
              Back to My Exams
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const currentQ = questions[currentIdx];
  const answered = Object.keys(answers).filter(k => {
    const v = answers[k];
    return v && (
      (typeof v.selected === "string" && v.selected) ||
      (Array.isArray(v.selected) && v.selected.length > 0) ||
      (v.text && v.text.trim() !== "") ||
      (v.pairs && v.pairs.length > 0)
    );
  }).length;

  return (
    <div className="min-h-screen bg-[#F7F5F0] flex flex-col">
      <div className="bg-[#0F2A47] text-white px-4 py-3 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-sm font-bold">{exam.title}</h1>
          <span className="text-[10px] text-gray-300">{questions.length} questions · {exam.total_marks} marks</span>
        </div>
        <div className="flex items-center gap-4">
          <div className={cn("flex items-center gap-1 text-sm font-mono font-bold", timeLeft < 60 ? "text-red-400 animate-pulse" : "text-[#C9A227]")}>
            <Clock size={14} /> {formatTime(timeLeft)}
          </div>
          <Button size="sm" variant="gold" loading={submitting} onClick={() => { if (confirm("Submit your exam? You cannot change answers after submission.")) submitExam(); }}>
            Submit
          </Button>
        </div>
      </div>

      {proctored && (
        <div className="bg-[#0b1f34] text-white/90 px-4 py-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] shrink-0 border-b border-[#1B3E63]">
          <span className="inline-flex items-center gap-1 font-bold text-[#C9A227]"><Lock size={12} /> EXAM LOCK ACTIVE</span>
          <span className="text-white/60 hidden sm:inline">You may only use this exam until it is submitted.</span>
          <span className="ml-auto inline-flex items-center gap-3">
            <span className={cn("inline-flex items-center gap-1", isFullscreen ? "text-green-300" : "text-amber-300")}>
              <Maximize size={11} /> {isFullscreen ? "Fullscreen" : "Not fullscreen"}
            </span>
            {!isFullscreen && fullscreenRequired && (
              <button onClick={requestFullscreen} className="underline hover:text-white">Re-enter</button>
            )}
            <span className={saveWarning ? "text-amber-300" : "text-green-300"}>{saveWarning ? "Save issue" : "Saved"}</span>
            <span className="text-white/80">Violations {violations}/{maxViolations}</span>
          </span>
        </div>
      )}

      {saveWarning && (
        <div className="bg-amber-100 border-b border-amber-300 text-amber-900 px-4 py-2 text-xs flex items-center gap-2 shrink-0">
          <AlertTriangle size={14} className="shrink-0" /> {saveWarning}
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        <div className="w-16 sm:w-20 bg-white border-r shrink-0 overflow-y-auto p-2 space-y-1">
          {questions.map((q, i) => {
            const v = answers[q.id];
            const isAnswered = !!(v && (
              (typeof v.selected === "string" && v.selected) ||
              (Array.isArray(v.selected) && v.selected.length > 0) ||
              (v.text && v.text.trim() !== "") ||
              (v.pairs && v.pairs.length > 0)
            ));
            return (
              <button key={q.id} onClick={() => setCurrentIdx(i)}
                className={cn(
                  "w-full aspect-square rounded-lg flex items-center justify-center text-xs font-bold transition-all relative",
                  currentIdx === i ? "bg-[#C9A227] text-white" :
                  isAnswered ? "bg-green-100 text-green-700 border border-green-200" :
                  "bg-gray-100 text-gray-500 hover:bg-gray-200"
                )}>
                {i + 1}
                {flagged.has(q.id) && <Flag size={8} className="absolute top-0.5 right-0.5 text-red-500" />}
              </button>
            );
          })}
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {currentQ && (
            <div className="max-w-2xl mx-auto space-y-6">
              <div className="flex items-start justify-between">
                <span className="text-xs text-gray-400">
                  Question {currentIdx + 1} of {questions.length}
                  <span className="ml-2 uppercase tracking-wide">{currentQ.question_type.replace("_", " ")}</span>
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">{currentQ.marks} mark{currentQ.marks !== 1 ? "s" : ""}</span>
                  <button onClick={() => toggleFlag(currentQ.id)}
                    className={cn("p-1 rounded", flagged.has(currentQ.id) ? "text-red-500 bg-red-50" : "text-gray-300 hover:text-red-400")}>
                    <Flag size={14} />
                  </button>
                </div>
              </div>

              <div className="text-base sm:text-lg font-medium text-[#0F2A47] leading-relaxed whitespace-pre-wrap">
                {currentQ.question_text}
              </div>

              <AnswerControl
                question={currentQ}
                value={answers[currentQ.id] ?? {}}
                onChange={(patch) => updateAnswer(currentQ.id, patch)}
              />

              <div className="flex items-center justify-between pt-4">
                <Button variant="secondary" size="sm" disabled={currentIdx === 0} onClick={() => setCurrentIdx(i => i - 1)}>
                  <ChevronLeft size={14} /> Previous
                </Button>
                <span className="text-xs text-gray-400">{answered}/{questions.length} answered</span>
                <Button variant="secondary" size="sm" disabled={currentIdx === questions.length - 1} onClick={() => setCurrentIdx(i => i + 1)}>
                  Next <ChevronRight size={14} />
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ */
/* Per-type answer input                                        */
/* ------------------------------------------------------------ */

function AnswerControl({
  question, value, onChange,
}: {
  question: QuestionData;
  value: AnswerValue;
  onChange: (patch: AnswerValue) => void;
}) {
  const type = question.question_type;

  if (type === "multiple_choice" || type === "true_false") {
    return (
      <div className="space-y-2">
        {question.options.map(opt => (
          <button key={opt.id} onClick={() => onChange({ selected: opt.id })}
            className={cn(
              "w-full text-left px-4 py-3 rounded-xl border-2 transition-all",
              value.selected === opt.id
                ? "border-[#C9A227] bg-[#FBF6E8] text-[#0F2A47] font-medium"
                : "border-gray-200 hover:border-gray-300 bg-white text-gray-700"
            )}>
            <span className="inline-flex items-center gap-3">
              <span className={cn(
                "w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0",
                value.selected === opt.id ? "bg-[#C9A227] text-white" : "bg-gray-100 text-gray-500"
              )}>{opt.id}</span>
              <span>{opt.text}</span>
            </span>
          </button>
        ))}
      </div>
    );
  }

  if (type === "multi_answer") {
    const selected = new Set(Array.isArray(value.selected) ? value.selected : []);
    return (
      <div className="space-y-2">
        <p className="text-xs text-gray-500">Select all that apply.</p>
        {question.options.map(opt => (
          <button key={opt.id} onClick={() => {
            const next = new Set(selected);
            if (next.has(opt.id)) next.delete(opt.id); else next.add(opt.id);
            onChange({ selected: Array.from(next).sort() });
          }} className={cn(
              "w-full text-left px-4 py-3 rounded-xl border-2 transition-all",
              selected.has(opt.id)
                ? "border-[#C9A227] bg-[#FBF6E8] text-[#0F2A47] font-medium"
                : "border-gray-200 hover:border-gray-300 bg-white text-gray-700"
            )}>
            <span className="inline-flex items-center gap-3">
              <span className={cn(
                "w-5 h-5 rounded flex items-center justify-center shrink-0 border-2",
                selected.has(opt.id) ? "bg-[#C9A227] border-[#C9A227]" : "border-gray-300"
              )}>
                {selected.has(opt.id) && <CheckCircle2 size={12} className="text-white" />}
              </span>
              <span>{opt.text}</span>
            </span>
          </button>
        ))}
      </div>
    );
  }

  if (type === "short_answer" || type === "fill_blank" || type === "numeric") {
    return (
      <input
        type={type === "numeric" ? "number" : "text"}
        step={type === "numeric" ? "any" : undefined}
        value={value.text ?? ""}
        onChange={e => onChange({ text: e.target.value })}
        placeholder={type === "numeric" ? "Enter a number" : "Type your answer…"}
        className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-base focus:outline-none focus:border-[#C9A227]"
      />
    );
  }

  if (type === "essay") {
    return (
      <div className="space-y-2">
        <textarea
          rows={10}
          value={value.text ?? ""}
          onChange={e => onChange({ text: e.target.value })}
          placeholder="Write your answer here. This will be graded manually by your teacher."
          className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-sm leading-relaxed focus:outline-none focus:border-[#C9A227]"
        />
        <p className="text-xs text-gray-400">
          Essay answers are graded after submission — your score for this question will appear once your teacher has marked it.
        </p>
      </div>
    );
  }

  if (type === "matching") {
    const expectedPairs = question.pairs ?? [];
    const currentPairs = value.pairs ?? [];
    const rightOptions = expectedPairs.map(p => p.right);
    return (
      <div className="space-y-2">
        <p className="text-xs text-gray-500">Match each item on the left to the correct item on the right.</p>
        {expectedPairs.map((p, i) => {
          const current = currentPairs.find(cp => cp.left === p.left)?.right ?? "";
          return (
            <div key={i} className="flex items-center gap-3">
              <div className="flex-1 px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 text-sm">
                {p.left}
              </div>
              <span className="text-gray-300">→</span>
              <select
                value={current}
                onChange={e => {
                  const next = currentPairs.filter(cp => cp.left !== p.left);
                  if (e.target.value) next.push({ left: p.left, right: e.target.value });
                  onChange({ pairs: next });
                }}
                className="flex-1 px-3 py-2 border-2 border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:border-[#C9A227]"
              >
                <option value="">Select a match…</option>
                {rightOptions.map((r, j) => <option key={j} value={r}>{r}</option>)}
              </select>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <p className="text-sm text-gray-400 italic">
      This question type ({type}) is not supported yet.
    </p>
  );
}
