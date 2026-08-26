"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { PageHeader, KpiCard, LoadingSpinner } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { GraduationCap, Users, Clock, BookOpen, FileBarChart, TrendingUp, ArrowRight, UserCheck, AlertCircle, Award } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, CartesianGrid } from "recharts";

interface Student { id: string; full_name: string; grade: string | null; status: string; gender: string | null; }
interface Attendance { student_id: string; date: string; status_code: string; }
interface AcademicYear { id: string; name: string; status: string; }

export default function StudentsOverviewPage() {
  const { orgId } = useAuth();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [students, setStudents] = useState<Student[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [years, setYears] = useState<AcademicYear[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const today = new Date();
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(today.getDate() - 30);

    const [st, at, yr] = await Promise.all([
      supabase.from("students").select("id, full_name, grade, status, gender"),
      supabase.from("attendance_records").select("student_id, date, status_code").gte("date", thirtyDaysAgo.toISOString().split("T")[0]),
      supabase.from("academic_years").select("*").eq("status", "current"),
    ]);
    setStudents((st.data ?? []) as Student[]);
    setAttendance((at.data ?? []) as Attendance[]);
    setYears((yr.data ?? []) as AcademicYear[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const stats = useMemo(() => {
    const active = students.filter(s => s.status === "active");
    return {
      total: students.length,
      active: active.length,
      male: active.filter(s => s.gender === "male" || s.gender === "M").length,
      female: active.filter(s => s.gender === "female" || s.gender === "F").length,
      inactive: students.length - active.length,
    };
  }, [students]);

  const byGrade = useMemo(() => {
    const map = new Map<string, number>();
    students.filter(s => s.status === "active").forEach(s => {
      const g = s.grade || "Unassigned";
      map.set(g, (map.get(g) || 0) + 1);
    });
    return Array.from(map.entries()).map(([grade, count]) => ({ grade, count })).sort((a, b) => a.grade.localeCompare(b.grade));
  }, [students]);

  const attendancePct = useMemo(() => {
    if (attendance.length === 0) return 0;
    const present = attendance.filter(a => a.status_code === "P" || a.status_code === "present").length;
    return Math.round((present / attendance.length) * 100);
  }, [attendance]);

  const genderData = useMemo(() => [
    { name: "Male", value: stats.male, color: "#0F2A47" },
    { name: "Female", value: stats.female, color: "#C9A227" },
  ], [stats]);

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Students & Academics Overview"
        subtitle={`${years[0]?.name || "Current"} · Complete academic snapshot`}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Total Students" value={String(stats.total)} icon={<GraduationCap size={18} />} colorClass="text-blue-700" />
        <KpiCard label="Active" value={String(stats.active)} icon={<UserCheck size={18} />} colorClass="text-green-700" />
        <KpiCard label="30-Day Attendance" value={`${attendancePct}%`} icon={<Clock size={18} />} colorClass="text-[#C9A227]" />
        <KpiCard label="Grade Levels" value={String(byGrade.length)} icon={<Award size={18} />} colorClass="text-amber-700" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Enrollment by Grade</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={byGrade}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="grade" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="count" fill="#C9A227" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Gender Split</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={genderData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                  {genderData.map((e, i) => <Cell key={i} fill={e.color} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <QuickAction href="/dashboard/students" label="Students" icon={<GraduationCap size={20} />} />
            <QuickAction href="/dashboard/attendance" label="Attendance" icon={<Clock size={20} />} />
            <QuickAction href="/dashboard/assessments" label="Assessments" icon={<FileBarChart size={20} />} />
            <QuickAction href="/dashboard/cbt" label="CBT / Exams" icon={<BookOpen size={20} />} />
            <QuickAction href="/dashboard/report-cards" label="Report Cards" icon={<FileBarChart size={20} />} />
            <QuickAction href="/dashboard/students/promotion" label="Promotion" icon={<TrendingUp size={20} />} />
            <QuickAction href="/dashboard/timetable" label="Timetable" icon={<Clock size={20} />} />
            <QuickAction href="/dashboard/announcements" label="Announcements" icon={<Users size={20} />} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function QuickAction({ href, label, icon }: { href: string; label: string; icon: React.ReactNode }) {
  return (
    <Link href={href} className="group p-4 rounded-xl border border-gray-200 hover:border-[#C9A227] hover:shadow-md transition-all flex flex-col items-start gap-2 bg-white">
      <div className="text-[#C9A227]">{icon}</div>
      <div className="font-semibold text-sm text-gray-800">{label}</div>
      <ArrowRight size={14} className="text-gray-400 group-hover:text-[#C9A227] transition-colors" />
    </Link>
  );
}
