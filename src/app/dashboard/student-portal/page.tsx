"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { useStudentDashboard } from "@/lib/hooks/useStudentDashboard";
import {
  bucketExams,
  nextUpExam,
  formatScore,
  formatPercentage,
  isActionable,
  EXAM_STATE_LABEL,
  EXAM_STATE_BADGE,
} from "@/lib/exams/examState";
import { cn } from "@/lib/utils";
import { PageHeader, KpiCard, LoadingSpinner, EmptyState } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { GraduationCap, BookOpen, FileBarChart, Clock, Award, Play, ChevronRight, User, Calendar } from "lucide-react";

export default function StudentPortalPage() {
  const { org } = useAuth();
  const supabase = createClient();
  const { student, exams, report_cards, stats, loading, error, reload } = useStudentDashboard();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changing, setChanging] = useState(false);
  const [changeError, setChangeError] = useState("");

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
    // Clear the "must change password" flag on the student's OWN row.
    // A direct `update students` is blocked by RLS (students is staff-write
    // only, no student self-update policy), which is why the screen used to
    // reappear -- the flag never actually cleared. Use the SECURITY DEFINER
    // RPC that clears it for the caller (auth.uid()), matching how the
    // staff/parent ForcePasswordChange flow does it.
    const { error: rpcErr } = await supabase.rpc("clear_must_change_password");

    // Do NOT trust the RPC's success blindly -- verify the flag is actually
    // cleared in the database before hiding the screen. This is what used
    // to bounce students back here forever: the old code hid the modal
    // unconditionally even when the RPC errored and the RLS-blocked
    // fallback also silently failed, so the DB flag never actually
    // cleared while the UI acted like it had.
    const { data: verifyCtx } = await supabase.rpc("get_my_student_context");
    const verified = Array.isArray(verifyCtx) && verifyCtx.length > 0
      ? (verifyCtx[0] as { must_change_password?: boolean }).must_change_password === false
      : null; // couldn't verify -- treat as unverified, not as success

    if (rpcErr || verified !== true) {
      // Last-resort fallback (works only if a self-update policy exists).
      await supabase.from("students").update({ must_change_password: false }).eq("id", student!.id);
      const { data: recheck } = await supabase.rpc("get_my_student_context");
      const stillStuck = !Array.isArray(recheck) || recheck.length === 0
        || (recheck[0] as { must_change_password?: boolean }).must_change_password !== false;
      if (stillStuck) {
        setChangeError(
          "Your password was changed, but we couldn't confirm this screen can be dismissed. " +
          "Please sign out and sign back in with your new password -- that will clear it."
        );
        setChanging(false);
        return; // keep the modal up; do not lie about success
      }
    }

    await reload();
    setChanging(false);
  }

  if (loading) return <LoadingSpinner />;

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title={org?.name ? `${org.name} · Student Portal` : "Student Portal"} subtitle="Your academic dashboard" />
        <Card>
          <CardContent className="p-6 text-center space-y-3">
            <EmptyState message="We couldn't load your dashboard." icon={<GraduationCap />} />
            <p className="text-xs text-gray-500">{error}</p>
            <Button size="sm" variant="secondary" onClick={() => void reload()}>Retry</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!student) {
    return (
      <div className="space-y-6">
        <PageHeader title={org?.name ? `${org.name} · Student Portal` : "Student Portal"} subtitle="Your academic dashboard" />
        <EmptyState message="Your student profile is not linked. Contact your school." icon={<GraduationCap />} />
      </div>
    );
  }

  if (student.must_change_password) {
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

  const buckets = bucketExams(exams);
  const nextExam = nextUpExam(exams);
  const examGroups = [
    { label: "Available now", exams: [...buckets.inProgress, ...buckets.available] },
    { label: "Upcoming", exams: buckets.upcoming },
    { label: "Completed", exams: buckets.completed },
  ].filter(group => group.exams.length > 0);

  return (
    <div className="space-y-6">
      <PageHeader title={`Welcome, ${student.full_name.split(" ")[0]}!`} subtitle={`${org?.name ? org.name + " · " : ""}${student.grade || "—"} · ${student.student_code}`} />

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <KpiCard label={stats.in_progress > 0 ? `Available (${stats.in_progress} in progress)` : "Available Exams"} value={String(stats.available)} icon={<BookOpen size={18} />} colorClass="text-[#C9A227]" />
        <KpiCard label="Completed" value={String(stats.completed)} icon={<Award size={18} />} colorClass="text-green-700" />
        <KpiCard label="Average Score" value={formatPercentage(stats.avg_percentage)} icon={<FileBarChart size={18} />} colorClass="text-blue-700" />
      </div>

      {nextExam && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs text-gray-500 mb-1">Next up</div>
                <div className="font-semibold text-sm">{nextExam.title}</div>
              </div>
              <div className="flex items-center gap-3">
                <span className={cn("px-2 py-1 rounded text-xs font-semibold", EXAM_STATE_BADGE[nextExam.state])}>{EXAM_STATE_LABEL[nextExam.state]}</span>
                <Link href={`/dashboard/cbt/${nextExam.id}`}>
                  <Button size="sm" variant="gold">{EXAM_STATE_LABEL[nextExam.state]}</Button>
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><BookOpen size={16} /> My Exams</CardTitle>
          </CardHeader>
          <CardContent>
            {exams.length === 0 ? (
              <EmptyState message="No exams assigned yet." />
            ) : (
              <div className="space-y-4">
                {examGroups.map(group => (
                  <div key={group.label} className="space-y-2">
                    <div className="text-xs font-semibold text-gray-500 uppercase">{group.label}</div>
                    {group.exams.map(exam => (
                      <div key={exam.id} className={cn("p-3 border rounded-lg", exam.state === "exhausted" || exam.state === "closed" ? "bg-gray-50" : exam.state === "upcoming" ? "bg-amber-50" : "bg-white hover:border-[#C9A227]")}>
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
                          {exam.state === "exhausted" || exam.state === "closed" ? (
                            <div className="text-right">
                              <div className="text-xs text-gray-500">Score</div>
                              <div className="font-bold text-green-700">{formatScore(exam.best_attempt?.total_score, exam.total_marks, exam.best_attempt?.percentage)}</div>
                            </div>
                          ) : isActionable(exam) ? (
                            <Link href={`/dashboard/cbt/${exam.id}`}>
                              <Button size="sm" variant="gold"><Play size={12} /> {EXAM_STATE_LABEL[exam.state]}</Button>
                            </Link>
                          ) : exam.starts_at ? (
                            <span className="text-xs text-amber-700 font-semibold">{new Date(exam.starts_at).toLocaleDateString()}</span>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><FileBarChart size={16} /> My Report Cards</CardTitle>
          </CardHeader>
          <CardContent>
            {report_cards.length === 0 ? (
              <EmptyState message="No report cards published yet." />
            ) : (
              <div className="space-y-2">
                {report_cards.map(rc => (
                  <Link key={rc.id} href={`/dashboard/report-cards/${rc.id}`}
                    className="flex items-center justify-between p-3 border rounded-lg hover:border-[#C9A227]">
                    <div>
                      <div className="text-sm font-semibold">{rc.term}</div>
                      <div className="text-xs text-gray-500">Grade {rc.grade_overall || "—"}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="font-bold text-[#0F2A47]">{formatPercentage(rc.average_score)}</div>
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
