"use client";

/**
 * Student LMS home — browse published courses, see enrolled courses
 * with progress, and view earned badges.
 *
 * Student identity resolution follows the same pattern as
 * /dashboard/my-exams: students.profile_id first, guardian_email as a
 * legacy fallback.
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { useToast } from "@/lib/hooks/useToast";
import { extractErrorMessage } from "@/lib/errors/extractErrorMessage";
import { cn } from "@/lib/utils";
import { PageHeader, LoadingSpinner, EmptyState } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { GraduationCap, BookOpen, Users, ChevronRight, Award, CheckCircle2 } from "lucide-react";

interface CourseRow {
  id: string; title: string; description: string | null; cover_color: string;
  subject_id: string | null; class_id: string | null;
}
interface EnrollmentRow { id: string; course_id: string; status: string; }
interface BadgeRow { id: string; name: string; description: string | null; icon: string; earned_at: string; }
interface ProgressRow { lessons_total: number; lessons_completed: number; quizzes_taken: number; quiz_average_percent: number | null; }

export default function MyCoursesPage() {
  const { user, orgId } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const { notify, ToastHost } = useToast();

  const [loading, setLoading] = useState(true);
  const [studentId, setStudentId] = useState<string | null>(null);
  const [allCourses, setAllCourses] = useState<CourseRow[]>([]);
  const [enrollments, setEnrollments] = useState<EnrollmentRow[]>([]);
  const [badges, setBadges] = useState<BadgeRow[]>([]);
  const [progress, setProgress] = useState<Record<string, ProgressRow>>({});

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

    const [cRes, enRes, badgeRes] = await Promise.all([
      supabase.from("lms_courses").select("id, title, description, cover_color, subject_id, class_id").eq("status", "published"),
      supabase.from("lms_enrollments").select("id, course_id, status").eq("student_id", stuId),
      supabase.from("lms_student_badges").select("id, earned_at, lms_badges(id, name, description, icon)").eq("student_id", stuId).order("earned_at", { ascending: false }),
    ]);
    setAllCourses((cRes.data as CourseRow[]) ?? []);
    const enrollRows = (enRes.data as EnrollmentRow[]) ?? [];
    setEnrollments(enrollRows);

    const badgeRows = ((badgeRes.data as unknown[]) ?? []).map((row) => {
      const r = row as { id: string; earned_at: string; lms_badges: { id: string; name: string; description: string | null; icon: string } | null };
      return r.lms_badges ? { id: r.lms_badges.id, name: r.lms_badges.name, description: r.lms_badges.description, icon: r.lms_badges.icon, earned_at: r.earned_at } : null;
    }).filter((b): b is BadgeRow => b !== null);
    setBadges(badgeRows);

    const active = enrollRows.filter((e) => e.status === "active");
    if (active.length > 0) {
      const results = await Promise.all(active.map((e) => supabase.rpc("lms_student_course_progress", { p_course_id: e.course_id, p_student_id: stuId })));
      const map: Record<string, ProgressRow> = {};
      active.forEach((e, i) => {
        const row = results[i].data?.[0] as ProgressRow | undefined;
        if (row) map[e.course_id] = row;
      });
      setProgress(map);
    }

    setLoading(false);
  }, [user, supabase]);

  useEffect(() => { load(); }, [load]);

  const enrolledCourseIds = useMemo(() => new Set(enrollments.filter((e) => e.status === "active").map((e) => e.course_id)), [enrollments]);
  const myCourses = allCourses.filter((c) => enrolledCourseIds.has(c.id));
  const availableCourses = allCourses.filter((c) => !enrolledCourseIds.has(c.id));

  async function selfEnroll(courseId: string) {
    if (!studentId) return;
    const { error } = await supabase.from("lms_enrollments").insert({ course_id: courseId, student_id: studentId, organization_id: orgId });
    if (error) { notify(extractErrorMessage(error, "Could not enroll."), "error"); return; }
    notify("Enrolled! Head into the course to get started.");
    load();
  }

  if (loading) return <div className="p-6"><LoadingSpinner /></div>;
  if (!studentId) return <div className="p-6"><EmptyState message="No student record is linked to this account yet." /></div>;

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="My Courses" subtitle="Learn at your own pace — track your progress, earn badges, and climb the leaderboard." />

      {badges.length > 0 && (
        <Card>
          <h3 className="text-xs font-bold text-gray-600 uppercase tracking-wide flex items-center gap-1 mb-2"><Award size={12} className="text-[#C9A227]" /> My Badges</h3>
          <div className="flex flex-wrap gap-3">
            {badges.map((b) => (
              <div key={b.id} className="flex flex-col items-center gap-1 w-20 text-center" title={b.description || undefined}>
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#C9A227] to-[#0F2A47] flex items-center justify-center text-white">
                  <Award size={20} />
                </div>
                <span className="text-[10px] text-gray-600 leading-tight">{b.name}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div>
        <h2 className="text-sm font-bold text-[#0F2A47] mb-3">My Courses ({myCourses.length})</h2>
        {myCourses.length === 0 ? (
          <EmptyState message="You're not enrolled in any courses yet — browse below to get started." icon={<GraduationCap size={36} />} />
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {myCourses.map((c) => {
              const prog = progress[c.id];
              const pct = prog && prog.lessons_total > 0 ? Math.round((prog.lessons_completed / prog.lessons_total) * 100) : 0;
              return (
                <Link key={c.id} href={`/dashboard/my-courses/${c.id}`}>
                  <Card className="h-full hover:shadow-md transition-shadow cursor-pointer">
                    <div className="h-2 rounded-t-xl -m-px mb-3" style={{ backgroundColor: c.cover_color }} />
                    <div className="px-4 pb-4 space-y-2">
                      <h3 className="font-semibold text-[#0F2A47] leading-snug">{c.title}</h3>
                      {c.description && <p className="text-xs text-gray-500 line-clamp-2">{c.description}</p>}
                      <div className="pt-1">
                        <div className="flex items-center justify-between text-[11px] text-gray-500 mb-1">
                          <span>{prog ? `${prog.lessons_completed}/${prog.lessons_total} lessons` : "—"}</span>
                          <span>{pct}%</span>
                        </div>
                        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-[#C9A227] rounded-full transition-all" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                      {pct === 100 && <p className="text-[11px] text-emerald-600 flex items-center gap-1"><CheckCircle2 size={12} /> Completed</p>}
                    </div>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {availableCourses.length > 0 && (
        <div>
          <h2 className="text-sm font-bold text-[#0F2A47] mb-3">Available Courses</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {availableCourses.map((c) => (
              <Card key={c.id} className="h-full">
                <div className="h-2 rounded-t-xl -m-px mb-3" style={{ backgroundColor: c.cover_color }} />
                <div className="px-4 pb-4 space-y-2">
                  <h3 className="font-semibold text-[#0F2A47] leading-snug">{c.title}</h3>
                  {c.description && <p className="text-xs text-gray-500 line-clamp-2">{c.description}</p>}
                  <Button variant="secondary" size="sm" className="w-full mt-1" onClick={() => selfEnroll(c.id)}>
                    <BookOpen size={14} /> Enroll
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      <ToastHost />
    </div>
  );
}
