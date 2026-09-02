"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { cn } from "@/lib/utils";
import { PageHeader, KpiCard, LoadingSpinner, EmptyState } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { GraduationCap, BookOpen, FileBarChart, Clock, Award, Play, ChevronRight, User, Calendar } from "lucide-react";

interface Student { id: string; student_code: string; full_name: string; grade: string | null; status: string; must_change_password: boolean; }
interface Exam { id: string; title: string; exam_type: string; subject_id: string | null; class_id: string | null; duration_minutes: number; status: string; starts_at: string | null; ends_at: string | null; }
interface ExamAssignment { id: string; exam_id: string; available_from: string | null; available_to: string | null; }
interface Attempt { id: string; exam_id: string; total_score: number | null; status: string; }
interface ReportCard { id: string; term: string; average_score: number; grade_overall: string | null; published: boolean; }

export default function StudentPortalPage() {
  const { user, profile, org } = useAuth();
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<Student | null>(null);
  const [exams, setExams] = useState<Exam[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [reportCards, setReportCards] = useState<ReportCard[]>([]);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changing, setChanging] = useState(false);
  const [changeError, setChangeError] = useState("");

  const load = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    setLoading(true);

    // Prefer the SECURITY DEFINER RPC — it bypasses RLS so a student
    // can always resolve their own row even if a per-org policy is
    // temporarily out of sync.
    let student: Student | null = null;
    const { data: ctx, error: ctxErr } = await supabase.rpc("get_my_student_context");
    if (!ctxErr && Array.isArray(ctx) && ctx.length > 0) {
      student = ctx[0] as Student;
    }
    if (!student) {
      const { data: stu } = await supabase
        .from("students")
        .select("*")
        .eq("profile_id", user.id)
        .maybeSingle();
      student = stu as Student | null;
    }
    if (!student) {
      // fallback by guardian_email (legacy rows)
      const { data } = await supabase.from("students").select("*")
        .eq("guardian_email", user.email).eq("status", "active").maybeSingle();
      student = data as Student | null;
    }

    if (!student) { setLoading(false); return; }
    setMe(student);

    if (student.must_change_password) setShowChangePassword(true);

    // Load exams assigned (via class or direct assignment)
    const [assign, published, att, rc] = await Promise.all([
      supabase.from("cbt_exam_assignments").select("*").eq("student_id", student.id),
      supabase.from("exams").select("*").eq("status", "published"),
      supabase.from("exam_attempts").select("id, exam_id, total_score, status").eq("student_id", student.id),
      supabase.from("report_cards").select("id, term, average_score, grade_overall, published")
        .eq("student_id", student.id).eq("published", true),
    ]);

    const assignments = (assign.data ?? []) as ExamAssignment[];
    const publishedExams = (published.data ?? []) as Exam[];
    const assignedExamIds = new Set(assignments.map(a => a.exam_id));
    const visibleExams = publishedExams.filter(e =>
      assignedExamIds.has(e.id) || e.class_id === null // open to all class if unassigned
    );

    setExams(visibleExams);
    setAttempts((att.data ?? []) as Attempt[]);
    setReportCards((rc.data ?? []) as ReportCard[]);
    setLoading(false);
  }, [user, supabase]);

  useEffect(() => { load(); }, [load]);

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setChangeError("Passwords do not match.");
      return;
    }
    if (newPassword.length < 8) {
      setChangeError("Password must be at least 8 characters.");
      return;
    }
    setChanging(true);
    setChangeError("");
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      setChangeError(error.message);
      setChanging(false);
      return;
    }
    if (me) {
      await supabase.from("students").update({ must_change_password: false }).eq("id", me.id);
    }
    setShowChangePassword(false);
    setChanging(false);
    load();
  }

  const stats = useMemo(() => {
    const availableExams = exams.filter(e => {
      const attempt = attempts.find(a => a.exam_id === e.id);
      if (attempt && attempt.status === "submitted") return false;
      const now = new Date();
      if (e.starts_at && new Date(e.starts_at) > now) return false;
      if (e.ends_at && new Date(e.ends_at) < now) return false;
      return true;
    });
    const completed = attempts.filter(a => a.status === "submitted");
    const avgScore = completed.length > 0
      ? completed.reduce((s, a) => s + Number(a.total_score || 0), 0) / completed.length
      : 0;
    return { available: availableExams.length, completed: completed.length, avgScore };
  }, [exams, attempts]);

  if (loading) return <LoadingSpinner />;

  if (!me) {
    return (
      <div className="space-y-6">
        <PageHeader title={org?.name ? `${org.name} · Student Portal` : "Student Portal"} subtitle="Your academic dashboard" />
        <EmptyState message="Your student profile is not linked. Contact your school." icon={<GraduationCap />} />
      </div>
    );
  }

  if (showChangePassword) {
    return (
      <div className="max-w-md mx-auto space-y-4 py-8">
        <div className="text-center mb-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-100 text-amber-800 text-xs font-semibold mb-3">
            <User size={12} /> First Login
          </div>
          <h2 className="text-2xl font-bold text-[#0F2A47]">Set Your New Password</h2>
          <p className="text-sm text-gray-500 mt-1">Please change your default password before continuing.</p>
        </div>
        <Card>
          <CardContent className="p-6">
            <form onSubmit={changePassword} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">New Password</label>
                <input type="password" required value={newPassword} onChange={e => setNewPassword(e.target.value)}
                  minLength={8} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Confirm Password</label>
                <input type="password" required value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                  minLength={8} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]" />
              </div>
              {changeError && <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{changeError}</div>}
              <Button type="submit" variant="gold" loading={changing} className="w-full">Set Password & Continue</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title={`Welcome, ${me.full_name.split(" ")[0]}!`} subtitle={`${org?.name ? org.name + " · " : ""}${me.grade || "—"} · ${me.student_code}`} />

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <KpiCard label="Available Exams" value={String(stats.available)} icon={<BookOpen size={18} />} colorClass="text-[#C9A227]" />
        <KpiCard label="Completed" value={String(stats.completed)} icon={<Award size={18} />} colorClass="text-green-700" />
        <KpiCard label="Average Score" value={stats.avgScore > 0 ? `${stats.avgScore.toFixed(1)}%` : "—"} icon={<FileBarChart size={18} />} colorClass="text-blue-700" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><BookOpen size={16} /> My Exams</CardTitle>
          </CardHeader>
          <CardContent>
            {exams.length === 0 ? (
              <EmptyState message="No exams assigned yet." />
            ) : (
              <div className="space-y-2">
                {exams.map(exam => {
                  const attempt = attempts.find(a => a.exam_id === exam.id);
                  const now = new Date();
                  const inWindow = (!exam.starts_at || new Date(exam.starts_at) <= now) &&
                                   (!exam.ends_at || new Date(exam.ends_at) >= now);
                  const isDone = attempt?.status === "submitted";
                  return (
                    <div key={exam.id} className={cn("p-3 border rounded-lg", isDone ? "bg-gray-50" : inWindow ? "bg-white hover:border-[#C9A227]" : "bg-amber-50")}>
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="font-semibold text-sm">{exam.title}</div>
                          <div className="text-xs text-gray-500 flex items-center gap-2 mt-0.5">
                            <span className="px-1.5 py-0.5 bg-gray-100 rounded text-[10px] font-semibold uppercase">{exam.exam_type}</span>
                            <span><Clock size={10} className="inline" /> {exam.duration_minutes} min</span>
                            {exam.ends_at && (
                              <span><Calendar size={10} className="inline" /> Until {new Date(exam.ends_at).toLocaleDateString()}</span>
                            )}
                          </div>
                        </div>
                        {isDone ? (
                          <div className="text-right">
                            <div className="text-xs text-gray-500">Score</div>
                            <div className="font-bold text-green-700">{attempt.total_score?.toFixed(1) || "—"}</div>
                          </div>
                        ) : inWindow ? (
                          <Link href={`/dashboard/cbt/${exam.id}/take`}>
                            <Button size="sm" variant="gold"><Play size={12} /> Start</Button>
                          </Link>
                        ) : (
                          <span className="text-xs text-amber-700 font-semibold">Not yet available</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><FileBarChart size={16} /> My Report Cards</CardTitle>
          </CardHeader>
          <CardContent>
            {reportCards.length === 0 ? (
              <EmptyState message="No report cards published yet." />
            ) : (
              <div className="space-y-2">
                {reportCards.map(rc => (
                  <Link key={rc.id} href={`/dashboard/report-cards/${rc.id}`}
                    className="flex items-center justify-between p-3 border rounded-lg hover:border-[#C9A227]">
                    <div>
                      <div className="text-sm font-semibold">{rc.term}</div>
                      <div className="text-xs text-gray-500">Grade {rc.grade_overall || "—"}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="font-bold text-[#0F2A47]">{Number(rc.average_score).toFixed(1)}%</div>
                      <ChevronRight size={14} className="text-gray-400" />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Quick Links</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Link href="/dashboard/my-exams" className="p-4 rounded-xl border border-gray-200 hover:border-[#C9A227]">
              <BookOpen size={20} className="text-[#C9A227] mb-2" />
              <div className="font-semibold text-sm">All Exams</div>
            </Link>
            <Link href="/dashboard/my-results" className="p-4 rounded-xl border border-gray-200 hover:border-[#C9A227]">
              <FileBarChart size={20} className="text-[#C9A227] mb-2" />
              <div className="font-semibold text-sm">My Results</div>
            </Link>
            <Link href="/dashboard/timetable" className="p-4 rounded-xl border border-gray-200 hover:border-[#C9A227]">
              <Calendar size={20} className="text-[#C9A227] mb-2" />
              <div className="font-semibold text-sm">Timetable</div>
            </Link>
            <Link href="/dashboard/announcements" className="p-4 rounded-xl border border-gray-200 hover:border-[#C9A227]">
              <User size={20} className="text-[#C9A227] mb-2" />
              <div className="font-semibold text-sm">Announcements</div>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
