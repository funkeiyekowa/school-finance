"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { cn } from "@/lib/utils";
import { PageHeader, LoadingSpinner } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import Link from "next/link";
import { Users, Clock, FileBarChart, CheckCircle2, BookOpen } from "lucide-react";

interface AssignmentRow { id: string; class_id: string; subject_id: string | null; role: string; }
interface ClassRow { id: string; name: string; short_code: string; }
interface SubjectRow { id: string; name: string; short_code: string; }
interface TimetableRow { id: string; class_id: string; subject_id: string; period_id: string; day_of_week: number; teacher_name: string | null; }
interface PeriodRow { id: string; name: string; short_code: string; start_time: string; end_time: string; is_break: boolean; sort_order: number; }

const DAYS = [
  { num: 1, short: "Mon" },
  { num: 2, short: "Tue" },
  { num: 3, short: "Wed" },
  { num: 4, short: "Thu" },
  { num: 5, short: "Fri" },
];

export default function TeachingPage() {
  const { user, profile } = useAuth();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);

  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [timetable, setTimetable] = useState<TimetableRow[]>([]);
  const [periods, setPeriods] = useState<PeriodRow[]>([]);
  const [studentCounts, setStudentCounts] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    if (!user) { setLoading(false); return; }

    const [assRes, clsRes, subRes, ttRes, perRes] = await Promise.all([
      supabase.from("teacher_assignments").select("*").eq("user_id", user.id).eq("active", true),
      supabase.from("classes").select("id, name, short_code").eq("active", true).order("sequence"),
      supabase.from("subjects").select("id, name, short_code").eq("active", true).order("name"),
      supabase.from("timetable_entries").select("*"),
      supabase.from("periods").select("*").eq("active", true).order("sort_order"),
    ]);

    const myAssignments = assRes.data as AssignmentRow[] ?? [];
    setAssignments(myAssignments);
    setClasses(clsRes.data as ClassRow[] ?? []);
    setSubjects(subRes.data as SubjectRow[] ?? []);
    setTimetable(ttRes.data as TimetableRow[] ?? []);
    setPeriods(perRes.data as PeriodRow[] ?? []);

    // Count students per class
    const myClassIds = Array.from(new Set(myAssignments.map(a => a.class_id)));
    const counts: Record<string, number> = {};
    for (const classId of myClassIds) {
      const cls = (clsRes.data as ClassRow[] ?? []).find(c => c.id === classId);
      if (cls) {
        const { count } = await supabase
          .from("students")
          .select("id", { count: "exact", head: true })
          .eq("status", "active")
          .or(`grade.eq.${cls.name},grade.eq.${cls.short_code}`);
        counts[classId] = count ?? 0;
      }
    }
    setStudentCounts(counts);
    setLoading(false);
  }, [user, supabase]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="p-6"><LoadingSpinner /></div>;

  const myClassIds = Array.from(new Set(assignments.map(a => a.class_id)));
  const myClasses = classes.filter(c => myClassIds.includes(c.id));

  // Teacher's timetable entries (matched by teacher_name = profile name, or by class assignment)
  const teacherName = profile?.full_name?.toLowerCase() || "";
  const myTimetable = timetable.filter(t =>
    myClassIds.includes(t.class_id) ||
    (t.teacher_name && t.teacher_name.toLowerCase() === teacherName)
  );

  const today = new Date().getDay(); // 0=Sun, 1=Mon...
  const todayNum = today === 0 ? 7 : today;
  const todayEntries = myTimetable
    .filter(t => t.day_of_week === todayNum)
    .sort((a, b) => {
      const pa = periods.find(p => p.id === a.period_id);
      const pb = periods.find(p => p.id === b.period_id);
      return (pa?.sort_order ?? 0) - (pb?.sort_order ?? 0);
    });

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="My Teaching" subtitle={`Welcome, ${profile?.full_name || "Teacher"}`} />

      {/* Quick stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border p-4 text-center">
          <div className="text-2xl font-bold text-[#0F2A47]">{myClasses.length}</div>
          <div className="text-xs text-gray-500">My Classes</div>
        </div>
        <div className="bg-white rounded-xl border p-4 text-center">
          <div className="text-2xl font-bold text-[#0F2A47]">{assignments.length}</div>
          <div className="text-xs text-gray-500">Assignments</div>
        </div>
        <div className="bg-white rounded-xl border p-4 text-center">
          <div className="text-2xl font-bold text-[#0F2A47]">{Object.values(studentCounts).reduce((s, c) => s + c, 0)}</div>
          <div className="text-xs text-gray-500">Total Students</div>
        </div>
        <div className="bg-white rounded-xl border p-4 text-center">
          <div className="text-2xl font-bold text-[#0F2A47]">{todayEntries.length}</div>
          <div className="text-xs text-gray-500">Classes Today</div>
        </div>
      </div>

      {/* Today's schedule */}
      <Card>
        <CardHeader><CardTitle>Today&apos;s Schedule ({DAYS.find(d => d.num === todayNum)?.short || "—"})</CardTitle></CardHeader>
        <CardContent>
          {todayEntries.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">No classes scheduled for today.</p>
          ) : (
            <div className="space-y-2">
              {todayEntries.map(entry => {
                const period = periods.find(p => p.id === entry.period_id);
                const cls = classes.find(c => c.id === entry.class_id);
                const sub = subjects.find(s => s.id === entry.subject_id);
                return (
                  <div key={entry.id} className="flex items-center gap-3 p-3 rounded-lg border hover:bg-gray-50">
                    <div className="shrink-0 text-center w-16">
                      <div className="text-xs font-bold text-[#0F2A47]">{period?.short_code}</div>
                      <div className="text-[10px] text-gray-400">{String(period?.start_time || "").substring(0, 5)}</div>
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-semibold text-gray-900">{sub?.name || "—"}</div>
                      <div className="text-xs text-gray-500">{cls?.name}</div>
                    </div>
                    <Link href="/dashboard/attendance">
                      <Button size="sm" variant="secondary"><Users size={12} /> Attendance</Button>
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* My Classes */}
      <Card>
        <CardHeader><CardTitle>My Classes</CardTitle></CardHeader>
        <CardContent>
          {myClasses.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">No class assignments found. Ask your admin to assign you to classes.</p>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {myClasses.map(cls => {
                const classAssignments = assignments.filter(a => a.class_id === cls.id);
                const classSubjects = classAssignments
                  .filter(a => a.subject_id)
                  .map(a => subjects.find(s => s.id === a.subject_id)?.short_code)
                  .filter(Boolean);
                const isClassTeacher = classAssignments.some(a => a.role === "class_teacher");

                return (
                  <div key={cls.id} className="p-4 rounded-xl border hover:border-[#C9A227] transition-colors">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <div className="font-semibold text-[#0F2A47]">{cls.name}</div>
                        <div className="text-xs text-gray-400">{studentCounts[cls.id] ?? 0} students</div>
                      </div>
                      {isClassTeacher && (
                        <span className="text-[10px] font-bold text-green-700 bg-green-50 px-2 py-0.5 rounded">Class Teacher</span>
                      )}
                    </div>
                    {classSubjects.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-3">
                        {classSubjects.map(code => (
                          <span key={code} className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded font-medium">{code}</span>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <Link href="/dashboard/attendance" className="text-xs text-[#0F2A47] hover:underline flex items-center gap-1">
                        <CheckCircle2 size={11} /> Attendance
                      </Link>
                      <Link href="/dashboard/assessments" className="text-xs text-[#0F2A47] hover:underline flex items-center gap-1">
                        <FileBarChart size={11} /> Scores
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick links */}
      <div className="grid sm:grid-cols-3 gap-3">
        <Link href="/dashboard/attendance">
          <Card className="hover:border-[#C9A227] transition-colors cursor-pointer">
            <CardContent className="py-4 flex items-center gap-3">
              <Users size={20} className="text-[#C9A227]" />
              <div><div className="font-semibold text-sm">Record Attendance</div><div className="text-xs text-gray-400">Mark daily attendance</div></div>
            </CardContent>
          </Card>
        </Link>
        <Link href="/dashboard/assessments">
          <Card className="hover:border-[#C9A227] transition-colors cursor-pointer">
            <CardContent className="py-4 flex items-center gap-3">
              <FileBarChart size={20} className="text-[#C9A227]" />
              <div><div className="font-semibold text-sm">Enter Scores</div><div className="text-xs text-gray-400">CA, tests, exams</div></div>
            </CardContent>
          </Card>
        </Link>
        <Link href="/dashboard/cbt">
          <Card className="hover:border-[#C9A227] transition-colors cursor-pointer">
            <CardContent className="py-4 flex items-center gap-3">
              <BookOpen size={20} className="text-[#C9A227]" />
              <div><div className="font-semibold text-sm">CBT / Exams</div><div className="text-xs text-gray-400">Create and manage</div></div>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
