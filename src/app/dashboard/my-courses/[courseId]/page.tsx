"use client";

/**
 * Student course view — lesson list with progress, leaderboard.
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { cn } from "@/lib/utils";
import { PageHeader, LoadingSpinner, EmptyState } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { ArrowLeft, BookOpen, CheckCircle2, Circle, PlayCircle, Trophy, HelpCircle } from "lucide-react";

interface CourseRow { id: string; title: string; description: string | null; cover_color: string; leaderboard_enabled: boolean; }
interface LessonRow { id: string; title: string; sort_order: number; estimated_minutes: number | null; }
interface ProgressRow { lessons_total: number; lessons_completed: number; quizzes_taken: number; quiz_average_percent: number | null; }
interface LessonProgressRow { lesson_id: string; status: string; }
interface LeaderRow { student_id: string; student_name: string; lessons_done: number; avg_quiz_percent: number | null; rank_position: number; }
interface QuizRow { id: string; lesson_id: string; }

export default function StudentCoursePage() {
  const params = useParams<{ courseId: string }>();
  const courseId = params.courseId;
  const { user } = useAuth();
  const supabase = useMemo(() => createClient(), []);

  const [loading, setLoading] = useState(true);
  const [studentId, setStudentId] = useState<string | null>(null);
  const [course, setCourse] = useState<CourseRow | null>(null);
  const [lessons, setLessons] = useState<LessonRow[]>([]);
  const [lessonProgress, setLessonProgress] = useState<Record<string, string>>({});
  const [quizByLesson, setQuizByLesson] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState<ProgressRow | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderRow[]>([]);

  const load = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    setLoading(true);

    let stuId: string | null = null;
    const { data: byProfile } = await supabase.from("students").select("id").eq("profile_id", user.id).maybeSingle();
    stuId = (byProfile as { id: string } | null)?.id ?? null;
    if (!stuId) {
      const { data: byEmail } = await supabase.from("students").select("id").eq("guardian_email", user.email).eq("status", "active").limit(1).maybeSingle();
      stuId = (byEmail as { id: string } | null)?.id ?? null;
    }
    if (!stuId) { setLoading(false); return; }
    setStudentId(stuId);

    const [cRes, lRes, progRes, lbRes] = await Promise.all([
      supabase.from("lms_courses").select("id, title, description, cover_color, leaderboard_enabled").eq("id", courseId).maybeSingle(),
      supabase.from("lms_lessons").select("id, title, sort_order, estimated_minutes").eq("course_id", courseId).eq("status", "published").order("sort_order"),
      supabase.rpc("lms_student_course_progress", { p_course_id: courseId, p_student_id: stuId }),
      supabase.rpc("lms_leaderboard", { p_course_id: courseId }),
    ]);
    const c = cRes.data as CourseRow | null;
    setCourse(c);
    const lessonRows = (lRes.data as LessonRow[]) ?? [];
    setLessons(lessonRows);
    setProgress((progRes.data?.[0] as ProgressRow) ?? null);
    setLeaderboard((lbRes.data as LeaderRow[]) ?? []);

    const lessonIds = lessonRows.map((l) => l.id);
    if (lessonIds.length > 0) {
      const [lpRes, qRes] = await Promise.all([
        supabase.from("lms_lesson_progress").select("lesson_id, status").eq("student_id", stuId).in("lesson_id", lessonIds),
        supabase.from("lms_quizzes").select("id, lesson_id").in("lesson_id", lessonIds),
      ]);
      const lp: Record<string, string> = {};
      for (const row of (lpRes.data as LessonProgressRow[]) ?? []) lp[row.lesson_id] = row.status;
      setLessonProgress(lp);
      const qb: Record<string, string> = {};
      for (const row of (qRes.data as QuizRow[]) ?? []) qb[row.lesson_id] = row.id;
      setQuizByLesson(qb);
    }

    setLoading(false);
  }, [user, supabase, courseId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="p-6"><LoadingSpinner /></div>;
  if (!studentId) return <div className="p-6"><EmptyState message="No student record is linked to this account yet." /></div>;
  if (!course) return <div className="p-6"><EmptyState message="Course not found or not published." /></div>;

  const pct = progress && progress.lessons_total > 0 ? Math.round((progress.lessons_completed / progress.lessons_total) * 100) : 0;

  return (
    <div className="p-6 space-y-5">
      <Link href="/dashboard/my-courses" className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-[#0F2A47]">
        <ArrowLeft size={14} /> Back to My Courses
      </Link>

      <PageHeader title={course.title} subtitle={course.description || undefined} />

      <div className="grid md:grid-cols-3 gap-4">
        <Card className="md:col-span-2">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-xs font-bold text-gray-600 uppercase tracking-wide">Your progress</h3>
            <span className="text-sm font-bold text-[#0F2A47]">{pct}%</span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-2">
            <div className="h-full bg-[#C9A227] rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-xs text-gray-500">{progress?.lessons_completed ?? 0} of {progress?.lessons_total ?? 0} lessons completed{progress?.quizzes_taken ? ` · ${progress.quizzes_taken} quizzes taken, ${progress.quiz_average_percent ?? 0}% average` : ""}</p>
        </Card>
        {course.leaderboard_enabled && (
          <Card>
            <h3 className="text-xs font-bold text-gray-600 uppercase tracking-wide flex items-center gap-1 mb-2"><Trophy size={12} className="text-[#C9A227]" /> Leaderboard</h3>
            {leaderboard.length === 0 ? <p className="text-xs text-gray-400 italic">No rankings yet.</p> : (
              <div className="space-y-1">
                {leaderboard.slice(0, 5).map((r) => (
                  <div key={r.student_id} className={cn("flex items-center justify-between text-xs py-0.5", r.student_id === studentId && "font-bold text-[#0F2A47]")}>
                    <span>{r.rank_position}. {r.student_name}</span>
                    <span className="text-gray-400">{r.lessons_done}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}
      </div>

      <div>
        <h2 className="text-sm font-bold text-[#0F2A47] mb-3">Lessons</h2>
        {lessons.length === 0 ? (
          <EmptyState message="No lessons published yet — check back soon." icon={<BookOpen size={36} />} />
        ) : (
          <div className="space-y-2">
            {lessons.map((l, i) => {
              const status = lessonProgress[l.id] || "not_started";
              return (
                <Link key={l.id} href={`/dashboard/my-courses/${courseId}/lessons/${l.id}`}>
                  <Card className="flex items-center justify-between hover:shadow-md transition-shadow cursor-pointer !p-3.5">
                    <div className="flex items-center gap-3">
                      {status === "completed" ? <CheckCircle2 size={18} className="text-emerald-500 shrink-0" /> :
                        status === "in_progress" ? <PlayCircle size={18} className="text-[#C9A227] shrink-0" /> :
                        <Circle size={18} className="text-gray-300 shrink-0" />}
                      <div>
                        <p className="text-sm font-medium text-gray-700">{i + 1}. {l.title}</p>
                        <p className="text-xs text-gray-400">{l.estimated_minutes || 15} min{quizByLesson[l.id] ? " · includes quiz" : ""}</p>
                      </div>
                    </div>
                    {quizByLesson[l.id] && <HelpCircle size={14} className="text-gray-300" />}
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
