"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { cn } from "@/lib/utils";
import { LoadingSpinner } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { CheckCircle2, Clock, Flag, ChevronLeft, ChevronRight } from "lucide-react";

interface ExamData { id: string; title: string; duration_minutes: number; total_marks: number; pass_mark: number; shuffle_questions: boolean; shuffle_options: boolean; show_results: boolean; show_answers: boolean; }
interface QuestionData { id: string; question_text: string; question_type: string; options: { id: string; text: string; is_correct: boolean }[]; marks: number; sort_order: number; }
interface AttemptData { id: string; started_at: string; status: string; total_score: number | null; percentage: number | null; passed: boolean | null; }

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function TakeExamPage() {
  const { examId } = useParams<{ examId: string }>();
  const router = useRouter();
  const { user, orgId } = useAuth();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [exam, setExam] = useState<ExamData | null>(null);
  const [questions, setQuestions] = useState<QuestionData[]>([]);
  const [attempt, setAttempt] = useState<AttemptData | null>(null);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [flagged, setFlagged] = useState<Set<string>>(new Set());
  const [timeLeft, setTimeLeft] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Load exam + questions + create/resume attempt
  const init = useCallback(async () => {
    if (!user) return;

    // Get student record for this user
    const { data: studentData } = await supabase
      .from("students")
      .select("id")
      .eq("guardian_email", user.email)
      .limit(1)
      .maybeSingle();

    // Also try matching by the user's profile email directly (for testing)
    let studentId = studentData?.id;
    if (!studentId) {
      const { data: stu2 } = await supabase.from("students").select("id").limit(1).maybeSingle();
      studentId = stu2?.id; // Fallback for demo/testing
    }
    if (!studentId) { setLoading(false); return; }

    // Load exam
    const { data: examData } = await supabase.from("exams").select("*").eq("id", examId).single();
    if (!examData || examData.status !== "published") { setLoading(false); return; }
    setExam(examData as unknown as ExamData);

    // Load questions via exam_questions join
    const { data: eqData } = await supabase
      .from("exam_questions")
      .select("question_id, sort_order")
      .eq("exam_id", examId)
      .order("sort_order");

    if (!eqData || eqData.length === 0) { setLoading(false); return; }

    const qIds = eqData.map(eq => eq.question_id);
    const { data: qData } = await supabase
      .from("questions")
      .select("id, question_text, question_type, options, marks")
      .in("id", qIds);

    let questionList: QuestionData[] = (qData ?? []).map(q => ({
      ...q,
      options: (q.options as { id: string; text: string; is_correct: boolean }[]) || [],
      sort_order: eqData.find(eq => eq.question_id === q.id)?.sort_order || 0,
    }));

    // Sort by order, optionally shuffle
    questionList.sort((a, b) => a.sort_order - b.sort_order);
    if (examData.shuffle_questions) questionList = shuffleArray(questionList);
    if (examData.shuffle_options) {
      questionList = questionList.map(q => ({ ...q, options: shuffleArray(q.options) }));
    }
    setQuestions(questionList);

    // Find or create attempt
    const { data: existingAttempt } = await supabase
      .from("exam_attempts")
      .select("*")
      .eq("exam_id", examId)
      .eq("student_id", studentId)
      .eq("status", "in_progress")
      .limit(1)
      .maybeSingle();

    if (existingAttempt) {
      setAttempt(existingAttempt as unknown as AttemptData);
      // Load existing answers
      const { data: ansData } = await supabase
        .from("exam_answers")
        .select("question_id, selected_option, flagged")
        .eq("attempt_id", existingAttempt.id);
      const loadedAnswers: Record<string, string> = {};
      const loadedFlagged = new Set<string>();
      for (const a of (ansData ?? [])) {
        if (a.selected_option) loadedAnswers[a.question_id] = a.selected_option;
        if (a.flagged) loadedFlagged.add(a.question_id);
      }
      setAnswers(loadedAnswers);
      setFlagged(loadedFlagged);
      // Calculate remaining time
      const elapsed = Math.floor((Date.now() - new Date(existingAttempt.started_at).getTime()) / 1000);
      setTimeLeft(Math.max(0, examData.duration_minutes * 60 - elapsed));
    } else {
      // Create new attempt
      const { data: newAttempt } = await supabase.from("exam_attempts").insert({
        exam_id: examId,
        student_id: studentId,
        attempt_number: 1,
        status: "in_progress",
        organization_id: orgId,
      }).select("id, started_at, status").single();
      if (newAttempt) {
        setAttempt(newAttempt as unknown as AttemptData);
        setTimeLeft(examData.duration_minutes * 60);
      }
    }

    setLoading(false);
  }, [examId, user, orgId, supabase]);

  useEffect(() => { init(); }, [init]);

  // Timer countdown
  useEffect(() => {
    if (submitted || !attempt || timeLeft <= 0) return;
    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          submitExam(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [attempt, submitted]); // eslint-disable-line react-hooks/exhaustive-deps

  function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  // Save answer to DB (auto-save)
  async function saveAnswer(questionId: string, optionId: string) {
    if (!attempt) return;
    setAnswers(prev => ({ ...prev, [questionId]: optionId }));
    await supabase.from("exam_answers").upsert({
      attempt_id: attempt.id,
      question_id: questionId,
      selected_option: optionId,
      flagged: flagged.has(questionId),
    }, { onConflict: "attempt_id,question_id" });
  }

  function toggleFlag(questionId: string) {
    setFlagged(prev => {
      const next = new Set(prev);
      next.has(questionId) ? next.delete(questionId) : next.add(questionId);
      return next;
    });
  }

  async function submitExam(timedOut = false) {
    if (!attempt || !exam) return;
    setSubmitting(true);
    if (timerRef.current) clearInterval(timerRef.current);

    // Grade objective questions
    let totalScore = 0;
    for (const q of questions) {
      const selected = answers[q.id];
      if (!selected) continue;
      const correct = q.options.find(o => o.is_correct);
      const isCorrect = correct?.id === selected;
      const marksAwarded = isCorrect ? q.marks : 0;
      totalScore += marksAwarded;

      await supabase.from("exam_answers").upsert({
        attempt_id: attempt.id,
        question_id: q.id,
        selected_option: selected,
        is_correct: isCorrect,
        marks_awarded: marksAwarded,
        flagged: flagged.has(q.id),
      }, { onConflict: "attempt_id,question_id" });
    }

    const percentage = exam.total_marks > 0 ? Math.round((totalScore / exam.total_marks) * 100) : 0;
    const passed = exam.pass_mark > 0 ? totalScore >= exam.pass_mark : null;
    const elapsed = Math.floor((Date.now() - new Date(attempt.started_at).getTime()) / 1000);

    await supabase.from("exam_attempts").update({
      status: timedOut ? "timed_out" : "submitted",
      submitted_at: new Date().toISOString(),
      total_score: totalScore,
      total_marks: exam.total_marks,
      percentage,
      passed,
      time_spent_seconds: elapsed,
    }).eq("id", attempt.id);

    setAttempt(prev => prev ? { ...prev, status: "submitted", total_score: totalScore, percentage, passed } : null);
    setSubmitted(true);
    setSubmitting(false);
  }

  if (loading) return <div className="flex items-center justify-center min-h-screen"><LoadingSpinner /></div>;
  if (!exam) return <div className="flex items-center justify-center min-h-screen text-gray-500">Exam not found or not available.</div>;
  if (!attempt) return <div className="flex items-center justify-center min-h-screen text-gray-500">Unable to start exam.</div>;

  // Results screen
  if (submitted && exam.show_results) {
    return (
      <div className="min-h-screen bg-[#F7F5F0] flex items-center justify-center p-6">
        <Card className="max-w-md w-full">
          <CardContent className="py-8 text-center space-y-4">
            <CheckCircle2 size={48} className={cn("mx-auto", attempt.passed ? "text-green-600" : attempt.passed === false ? "text-red-500" : "text-[#C9A227]")} />
            <h1 className="text-xl font-bold text-[#0F2A47]">Exam Submitted</h1>
            <p className="text-gray-600">{exam.title}</p>
            <div className="grid grid-cols-3 gap-3 pt-4">
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-2xl font-bold text-[#0F2A47]">{attempt.total_score ?? 0}</div>
                <div className="text-xs text-gray-500">Score</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-2xl font-bold text-[#0F2A47]">{exam.total_marks}</div>
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
            <Button variant="gold" onClick={() => router.push("/dashboard/cbt")} className="mt-4">
              Back to CBT
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const currentQ = questions[currentIdx];
  const answered = Object.keys(answers).length;

  return (
    <div className="min-h-screen bg-[#F7F5F0] flex flex-col">
      {/* Header bar */}
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

      <div className="flex-1 flex overflow-hidden">
        {/* Question navigation sidebar */}
        <div className="w-16 sm:w-20 bg-white border-r shrink-0 overflow-y-auto p-2 space-y-1">
          {questions.map((q, i) => (
            <button key={q.id} onClick={() => setCurrentIdx(i)}
              className={cn(
                "w-full aspect-square rounded-lg flex items-center justify-center text-xs font-bold transition-all relative",
                currentIdx === i ? "bg-[#C9A227] text-white" :
                answers[q.id] ? "bg-green-100 text-green-700 border border-green-200" :
                "bg-gray-100 text-gray-500 hover:bg-gray-200"
              )}>
              {i + 1}
              {flagged.has(q.id) && <Flag size={8} className="absolute top-0.5 right-0.5 text-red-500" />}
            </button>
          ))}
        </div>

        {/* Main question area */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {currentQ && (
            <div className="max-w-2xl mx-auto space-y-6">
              {/* Question header */}
              <div className="flex items-start justify-between">
                <span className="text-xs text-gray-400">Question {currentIdx + 1} of {questions.length}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">{currentQ.marks} mark{currentQ.marks !== 1 ? "s" : ""}</span>
                  <button onClick={() => toggleFlag(currentQ.id)}
                    className={cn("p-1 rounded", flagged.has(currentQ.id) ? "text-red-500 bg-red-50" : "text-gray-300 hover:text-red-400")}>
                    <Flag size={14} />
                  </button>
                </div>
              </div>

              {/* Question text */}
              <div className="text-base sm:text-lg font-medium text-[#0F2A47] leading-relaxed">
                {currentQ.question_text}
              </div>

              {/* Options */}
              <div className="space-y-2">
                {currentQ.options.map(opt => (
                  <button key={opt.id} onClick={() => saveAnswer(currentQ.id, opt.id)}
                    className={cn(
                      "w-full text-left px-4 py-3 rounded-xl border-2 transition-all",
                      answers[currentQ.id] === opt.id
                        ? "border-[#C9A227] bg-[#FBF6E8] text-[#0F2A47] font-medium"
                        : "border-gray-200 hover:border-gray-300 bg-white text-gray-700"
                    )}>
                    <span className="inline-flex items-center gap-3">
                      <span className={cn(
                        "w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0",
                        answers[currentQ.id] === opt.id ? "bg-[#C9A227] text-white" : "bg-gray-100 text-gray-500"
                      )}>{opt.id}</span>
                      <span>{opt.text}</span>
                    </span>
                  </button>
                ))}
              </div>

              {/* Navigation */}
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
