"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { fmtDateTime, cn } from "@/lib/utils";
import { PageHeader, LoadingSpinner } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import Link from "next/link";
import { BookOpen, CheckCircle2, Clock, AlertTriangle, FileText } from "lucide-react";

interface ExamRow { id: string; title: string; exam_type: string; duration_minutes: number; total_marks: number; pass_mark: number; class_id: string | null; status: string; max_attempts: number; show_answers: boolean; starts_at: string | null; ends_at: string | null; }
interface AttemptRow { id: string; exam_id: string; attempt_number: number; total_score: number | null; percentage: number | null; passed: boolean | null; status: string; submitted_at: string | null; started_at: string; }
interface AnswerRow { question_id: string; selected_option: string | null; is_correct: boolean | null; marks_awarded: number | null; }
interface QuestionRow { id: string; question_text: string; options: { id: string; text: string; is_correct: boolean }[]; marks: number; explanation: string | null; }
interface AssignmentRow { id: string; exam_id: string; available_from: string | null; available_to: string | null; }

export default function MyExamsPage() {
  const { user } = useAuth();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [exams, setExams] = useState<ExamRow[]>([]);
  const [attempts, setAttempts] = useState<AttemptRow[]>([]);
  const [studentId, setStudentId] = useState<string | null>(null);
  const [studentGrade, setStudentGrade] = useState<string | null>(null);

  // Review state
  const [reviewAttempt, setReviewAttempt] = useState<AttemptRow | null>(null);
  const [reviewAnswers, setReviewAnswers] = useState<AnswerRow[]>([]);
  const [reviewQuestions, setReviewQuestions] = useState<QuestionRow[]>([]);

  const load = useCallback(async () => {
    if (!user) { setLoading(false); return; }

    // Find the student linked to this user. The canonical link is
    // students.profile_id; fall back to guardian_email for legacy rows.
    let stuData: { id: string; grade: string | null } | null = null;
    const { data: byProfile } = await supabase.from("students")
      .select("id, grade")
      .eq("profile_id", user.id)
      .maybeSingle();
    stuData = byProfile as { id: string; grade: string | null } | null;
    if (!stuData) {
      const { data: byEmail } = await supabase.from("students")
        .select("id, grade")
        .eq("guardian_email", user.email)
        .eq("status", "active")
        .limit(1).maybeSingle();
      stuData = byEmail as { id: string; grade: string | null } | null;
    }
    if (!stuData) { setLoading(false); return; }
    setStudentId(stuData.id);
    setStudentGrade(stuData.grade);

    const [examResp, attResp, assignResp] = await Promise.all([
      supabase.from("exams").select("*").eq("status", "published"),
      supabase.from("exam_attempts").select("*").eq("student_id", stuData.id).order("started_at", { ascending: false }),
      supabase.from("cbt_exam_assignments").select("*").eq("student_id", stuData.id),
    ]);
    const allExams = (examResp.data ?? []) as ExamRow[];
    const attemptsData = (attResp.data ?? []) as AttemptRow[];
    const assignments = (assignResp.data ?? []) as AssignmentRow[];

    // Show an exam when either (a) the student is directly assigned, or
    // (b) no per-student assignments exist for it and the exam is either
    // unscoped or scoped to their current grade. This mirrors
    // can_take_exam() in cbt_upgrade_migration.sql.
    const now = new Date();
    const directIds = new Set(
      assignments
        .filter(a =>
          (!a.available_from || new Date(a.available_from) <= now) &&
          (!a.available_to   || new Date(a.available_to)   >= now)
        )
        .map(a => a.exam_id)
    );

    const myExams = allExams.filter(e => {
      if (directIds.has(e.id)) return true;
      // no per-student assignment — allow class-scoped exams when the
      // student's current grade matches. This is a permissive UI filter;
      // the server still enforces the exact rule at start_exam_attempt.
      if (!e.class_id) return true;
      return stuData!.grade != null;
    });
    setExams(myExams);
    setAttempts(attemptsData);
    setLoading(false);
  }, [user, supabase]);

  useEffect(() => { load(); }, [load]);

  async function openReview(attempt: AttemptRow) {
    // Questions are staff-only under RLS; the review payload (questions +
    // correct answers + the student's own responses) comes from the
    // get_attempt_review RPC, which only returns data for a submitted
    // attempt the caller owns when the exam permits answer review.
    const { data, error: err } = await supabase.rpc("get_attempt_review", { p_attempt: attempt.id });
    if (err) { alert(`Could not load review: ${err.message}`); return; }
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
    setReviewAttempt(attempt);
  }

  if (loading) return <div className="p-6"><LoadingSpinner /></div>;
  if (!studentId) return <div className="p-6 text-gray-500">No student account linked. Contact your school administrator.</div>;

  // Group exams by whether the student still has attempts left.  Exams the
  // student has fully consumed still appear (in a separate 'Completed' bucket)
  // so they know it's not missing — with status shown as Completed.
  const examUsage = exams.map(e => {
    const submittedForThis = attempts.filter(a => a.exam_id === e.id && (a.status === "submitted" || a.status === "timed_out" || a.status === "graded")).length;
    const inProgress = attempts.some(a => a.exam_id === e.id && a.status === "in_progress");
    const remaining = Math.max(0, e.max_attempts - submittedForThis);
    return { exam: e, submitted: submittedForThis, inProgress, remaining };
  });
  const availableExams = examUsage.filter(u => u.remaining > 0 || u.inProgress);
  const exhaustedExams = examUsage.filter(u => u.remaining === 0 && !u.inProgress);
  const completedAttempts = attempts.filter(a => a.status === "submitted" || a.status === "timed_out" || a.status === "graded");

  return (
    <div className="p-6 space-y-5">
      <PageHeader
        icon={<FileText size={24} />}
        gradient="navy" title="My Exams" subtitle="View available exams, take tests, and review your results" />

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border p-4 text-center">
          <div className="text-xl font-bold text-[#0F2A47]">{availableExams.length}</div>
          <div className="text-xs text-gray-500">Available</div>
        </div>
        <div className="bg-white rounded-xl border p-4 text-center">
          <div className="text-xl font-bold text-green-700">{completedAttempts.filter(a => a.passed).length}</div>
          <div className="text-xs text-gray-500">Passed</div>
        </div>
        <div className="bg-white rounded-xl border p-4 text-center">
          <div className="text-xl font-bold text-red-600">{completedAttempts.filter(a => a.passed === false).length}</div>
          <div className="text-xs text-gray-500">Failed</div>
        </div>
        <div className="bg-white rounded-xl border p-4 text-center">
          <div className="text-xl font-bold text-[#0F2A47]">{completedAttempts.length}</div>
          <div className="text-xs text-gray-500">Total Attempts</div>
        </div>
      </div>

      {/* Available Exams */}
      <Card>
        <CardHeader><CardTitle>Available Exams</CardTitle></CardHeader>
        <CardContent>
          {availableExams.length === 0 ? <p className="text-sm text-gray-400 text-center py-4">No exams available right now.</p> : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {availableExams.map(({ exam, submitted, inProgress, remaining }) => (
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
                    {inProgress ? (
                      <span className="text-amber-600 font-semibold">In progress — resume to continue</span>
                    ) : submitted > 0 ? (
                      <span>Attempt {submitted + 1} of {exam.max_attempts} — {remaining} left</span>
                    ) : (
                      <span>{exam.max_attempts} attempt{exam.max_attempts === 1 ? "" : "s"} allowed</span>
                    )}
                  </div>
                  <Link href={`/dashboard/cbt/${exam.id}/take`}>
                    <Button size="sm" variant="gold" className="w-full">
                      {inProgress ? "Resume Exam" : submitted > 0 ? "Retake Exam" : "Start Exam"}
                    </Button>
                  </Link>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Exams the student has fully used up */}
      {exhaustedExams.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Completed Exams</CardTitle></CardHeader>
          <CardContent>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {exhaustedExams.map(({ exam, submitted }) => (
                <div key={exam.id} className="p-4 border rounded-xl bg-gray-50 opacity-80">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <h3 className="font-semibold text-sm text-[#0F2A47]">{exam.title}</h3>
                      <span className="text-[10px] uppercase text-gray-400">{exam.exam_type}</span>
                    </div>
                    <BookOpen size={16} className="text-gray-400" />
                  </div>
                  <div className="text-[10px] text-gray-500 mb-2">
                    All {submitted} attempt{submitted === 1 ? "" : "s"} used. See your results below.
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
      {completedAttempts.length > 0 && (
        <Card>
          <CardHeader><CardTitle>My Results</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {completedAttempts.map(att => {
                const exam = exams.find(e => e.id === att.exam_id);
                return (
                  <div key={att.id} className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50">
                    <div>
                      <div className="text-sm font-semibold">{exam?.title || "Exam"}</div>
                      <div className="text-xs text-gray-400">{att.submitted_at ? fmtDateTime(att.submitted_at) : fmtDateTime(att.started_at)} · Attempt #{att.attempt_number}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <div className="text-sm font-bold">{att.total_score ?? 0}/{exam?.total_marks || "?"}</div>
                        <div className="text-xs text-gray-400">{att.percentage ?? 0}%</div>
                      </div>
                      {att.passed !== null && (
                        <span className={cn("px-2 py-1 rounded text-xs font-bold", att.passed ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700")}>
                          {att.passed ? "PASS" : "FAIL"}
                        </span>
                      )}
                      {exam?.show_answers && (
                        <button onClick={() => openReview(att)} className="text-xs text-[#C9A227] hover:underline">Review</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Review Modal */}
      {reviewAttempt && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Answer Review — {exams.find(e => e.id === reviewAttempt.exam_id)?.title}</CardTitle>
              <button onClick={() => setReviewAttempt(null)} className="text-xs text-gray-500 hover:underline">Close</button>
            </div>
          </CardHeader>
          <CardContent>
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
