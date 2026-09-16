"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useStudentDashboard } from "@/lib/hooks/useStudentDashboard";
import { useStudentResults } from "@/lib/hooks/useStudentResults";
import { bucketExams, formatScore } from "@/lib/exams/examState";
import type { ResultsAttempt } from "@/lib/types/student-dashboard";
import { fmtDateTime, cn } from "@/lib/utils";
import { PageHeader, LoadingSpinner } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import Link from "next/link";
import { BookOpen, CheckCircle2, Clock, AlertTriangle, FileText } from "lucide-react";

interface AnswerRow { question_id: string; selected_option: string | null; is_correct: boolean | null; marks_awarded: number | null; }
interface QuestionRow { id: string; question_text: string; options: { id: string; text: string; is_correct: boolean }[]; marks: number; explanation: string | null; }

export default function MyExamsPage() {
  const supabase = createClient();
  const dashboard = useStudentDashboard();
  const results = useStudentResults();

  // Review state
  const [reviewAttempt, setReviewAttempt] = useState<ResultsAttempt | null>(null);
  const [reviewAnswers, setReviewAnswers] = useState<AnswerRow[]>([]);
  const [reviewQuestions, setReviewQuestions] = useState<QuestionRow[]>([]);
  const [reviewError, setReviewError] = useState<string | null>(null);

  async function openReview(attempt: ResultsAttempt) {
    // Questions are staff-only under RLS; the review payload (questions +
    // correct answers + the student's own responses) comes from the
    // get_attempt_review RPC, which only returns data for a submitted
    // attempt the caller owns when the exam permits answer review.
    setReviewAttempt(attempt);
    setReviewError(null);
    setReviewAnswers([]);
    setReviewQuestions([]);
    const { data, error: err } = await supabase.rpc("get_attempt_review", { p_attempt: attempt.id });
    if (err) {
      setReviewError(`Could not load review: ${err.message}`);
      return;
    }
    const rows = (data ?? []) as {
      question_id: string; question_text: string; options: unknown;
      marks: number; explanation: string | null;
      selected_option: string | null; is_correct: boolean | null; marks_awarded: number | null;
    }[];
    setReviewQuestions(rows.map(r => ({
      id: r.question_id,
      question_text: r.question_text,
      options: (r.options as { id: string; text: string; is_correct: boolean }[]) ?? [],
      marks: r.marks,
      explanation: r.explanation,
    })));
    setReviewAnswers(rows.map(r => ({
      question_id: r.question_id,
      selected_option: r.selected_option,
      is_correct: r.is_correct,
      marks_awarded: r.marks_awarded,
    })));
  }

  const loading = dashboard.loading || results.loading;
  const error = dashboard.error || results.error;
  const buckets = bucketExams(dashboard.exams);
  const availableExams = [...buckets.inProgress, ...buckets.available];
  const completedExams = buckets.completed;

  if (loading) return <div className="p-6"><LoadingSpinner /></div>;

  if (error) {
    return (
      <div className="p-6 space-y-5">
        <PageHeader
          icon={<FileText size={24} />}
          gradient="navy" title="My Exams" subtitle="View available exams, take tests, and review your results" />
        <Card>
          <CardContent className="p-6 text-center space-y-3">
            <p className="text-sm text-gray-600">We couldn&apos;t load your exams.</p>
            <p className="text-xs text-gray-500">{error}</p>
            <Button size="sm" variant="secondary" onClick={() => void Promise.all([dashboard.reload(), results.reload()])}>Retry</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!dashboard.student) return <div className="p-6 text-gray-500">No student account linked. Contact your school administrator.</div>;

  return (
    <div className="p-6 space-y-5">
      <PageHeader
        icon={<FileText size={24} />}
        gradient="navy" title="My Exams" subtitle="View available exams, take tests, and review your results" />

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border p-4 text-center">
          <div className="text-xl font-bold text-[#0F2A47]">{dashboard.stats.available + dashboard.stats.in_progress}</div>
          <div className="text-xs text-gray-500">Available</div>
        </div>
        <div className="bg-white rounded-xl border p-4 text-center">
          <div className="text-xl font-bold text-green-700">{results.attempts.filter(a => a.passed).length}</div>
          <div className="text-xs text-gray-500">Passed</div>
        </div>
        <div className="bg-white rounded-xl border p-4 text-center">
          <div className="text-xl font-bold text-red-600">{results.attempts.filter(a => a.passed === false).length}</div>
          <div className="text-xs text-gray-500">Failed</div>
        </div>
        <div className="bg-white rounded-xl border p-4 text-center">
          <div className="text-xl font-bold text-[#0F2A47]">{results.attempts.length}</div>
          <div className="text-xs text-gray-500">Total Attempts</div>
        </div>
      </div>

      {/* Available Exams */}
      <Card>
        <CardHeader><CardTitle>Available Exams</CardTitle></CardHeader>
        <CardContent>
          {availableExams.length === 0 ? <p className="text-sm text-gray-400 text-center py-4">No exams available right now.</p> : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {availableExams.map(exam => (
                <div key={exam.id} className="p-4 border rounded-xl hover:border-[#C9A227] transition-colors">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <h3 className="font-semibold text-sm text-[#0F2A47]">{exam.title}</h3>
                      <span className="text-[10px] uppercase text-gray-400">{exam.exam_type}</span>
                    </div>
                    <BookOpen size={16} className="text-[#C9A227]" />
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-500 mb-3">
                    <span className="flex items-center gap-1"><Clock size={11} />{exam.duration_minutes}min</span>
                    <span>{exam.total_marks} marks</span>
                    {exam.pass_mark > 0 && <span>Pass: {exam.pass_mark}</span>}
                  </div>
                  <div className="text-[10px] text-gray-500 mb-2">
                    {exam.state === "in_progress" ? (
                      <span className="text-amber-600 font-semibold">In progress — resume to continue</span>
                    ) : exam.attempts_used > 0 ? (
                      <span>Attempt {exam.attempts_used + 1} of {exam.max_attempts} — {exam.attempts_left} left</span>
                    ) : (
                      <span>{exam.max_attempts} attempt{exam.max_attempts === 1 ? "" : "s"} allowed</span>
                    )}
                  </div>
                  <Link href={`/dashboard/cbt/${exam.id}/take`}>
                    <Button size="sm" variant="gold" className="w-full">
                      {exam.state === "in_progress" ? "Resume Exam" : exam.attempts_used > 0 ? "Retake Exam" : "Start Exam"}
                    </Button>
                  </Link>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Exams the student has fully used up */}
      {completedExams.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Completed Exams</CardTitle></CardHeader>
          <CardContent>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {completedExams.map(exam => (
                <div key={exam.id} className="p-4 border rounded-xl bg-gray-50 opacity-80">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <h3 className="font-semibold text-sm text-[#0F2A47]">{exam.title}</h3>
                      <span className="text-[10px] uppercase text-gray-400">{exam.exam_type}</span>
                    </div>
                    <BookOpen size={16} className="text-gray-400" />
                  </div>
                  <div className="text-[10px] text-gray-500 mb-2">
                    {exam.state === "closed"
                      ? "This exam is closed. See your results below."
                      : `All ${exam.attempts_used} attempt${exam.attempts_used === 1 ? "" : "s"} used. See your results below.`}
                  </div>
                  <Button size="sm" variant="secondary" className="w-full" disabled>
                    Completed
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Attempt History */}
      {results.attempts.length > 0 && (
        <Card>
          <CardHeader><CardTitle>My Results</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {results.attempts.map(att => (
                <div key={att.id} className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50">
                  <div>
                    <div className="text-sm font-semibold">{att.exam_title}</div>
                    <div className="text-xs text-gray-400">{att.submitted_at ? fmtDateTime(att.submitted_at) : "—"} · Attempt #{att.attempt_number ?? "—"}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className="text-sm font-bold">{formatScore(att.total_score, att.total_marks, att.percentage)}</div>
                    </div>
                    {att.passed !== null && (
                      <span className={cn("px-2 py-1 rounded text-xs font-bold", att.passed ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700")}>
                        {att.passed ? "PASS" : "FAIL"}
                      </span>
                    )}
                    {att.show_answers && (
                      <button onClick={() => void openReview(att)} className="text-xs text-[#C9A227] hover:underline">Review</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Review Modal */}
      {reviewAttempt && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Answer Review — {reviewAttempt.exam_title}</CardTitle>
              <button onClick={() => { setReviewAttempt(null); setReviewError(null); }} className="text-xs text-gray-500 hover:underline">Close</button>
            </div>
          </CardHeader>
          <CardContent>
            {reviewError && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{reviewError}</div>}
            <div className="space-y-4">
              {reviewQuestions.map((q, i) => {
                const answer = reviewAnswers.find(a => a.question_id === q.id);
                const opts = (q.options || []) as { id: string; text: string; is_correct: boolean }[];
                return (
                  <div key={q.id} className={cn("p-4 rounded-lg border", answer?.is_correct ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50")}>
                    <div className="flex items-start gap-2 mb-2">
                      <span className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold bg-gray-200 text-gray-600">{i + 1}</span>
                      <p className="text-sm font-medium text-gray-900">{q.question_text}</p>
                    </div>
                    <div className="ml-8 space-y-1">
                      {opts.map(opt => {
                        const isSelected = answer?.selected_option === opt.id;
                        const isCorrect = opt.is_correct;
                        return (
                          <div key={opt.id} className={cn("flex items-center gap-2 px-3 py-1.5 rounded text-sm",
                            isCorrect ? "bg-green-100 text-green-800 font-medium" :
                            isSelected && !isCorrect ? "bg-red-100 text-red-800" :
                            "text-gray-600"
                          )}>
                            <span className="font-bold text-xs w-5">{opt.id}.</span>
                            <span>{opt.text}</span>
                            {isCorrect && <CheckCircle2 size={12} className="text-green-600 ml-auto" />}
                            {isSelected && !isCorrect && <AlertTriangle size={12} className="text-red-500 ml-auto" />}
                          </div>
                        );
                      })}
                    </div>
                    {q.explanation && <p className="ml-8 mt-2 text-xs text-gray-500 italic">💡 {q.explanation}</p>}
                    <div className="ml-8 mt-1 text-xs text-gray-400">Marks: {answer?.marks_awarded ?? 0}/{q.marks}</div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
