"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { PageHeader, KpiCard, LoadingSpinner, EmptyState } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/utils";
import { FileBarChart, Users, GraduationCap, Award, Plus, Search, ChevronRight, Printer, CheckCircle2 } from "lucide-react";

interface ReportCard {
  id: string;
  student_id: string;
  academic_year_id: string | null;
  class_id: string | null;
  term: string;
  total_score: number;
  average_score: number;
  total_subjects: number;
  position_in_class: number | null;
  class_size: number | null;
  grade_overall: string | null;
  published: boolean;
  created_at: string;
}

interface Student { id: string; student_code: string; full_name: string; grade: string | null; }
interface AcademicYear { id: string; name: string; status: string; }
interface ClassRow { id: string; name: string; }

export default function ReportCardsHubPage() {
  const { isAdmin, orgId } = useAuth();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [reportCards, setReportCards] = useState<ReportCard[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);

  const [filterTerm, setFilterTerm] = useState("");
  const [filterYear, setFilterYear] = useState("");
  const [filterClass, setFilterClass] = useState("");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [rc, st, yr, cl] = await Promise.all([
      supabase.from("report_cards").select("*").order("created_at", { ascending: false }),
      supabase.from("students").select("id, student_code, full_name, grade").eq("status", "active"),
      supabase.from("academic_years").select("*").order("name", { ascending: false }),
      supabase.from("classes").select("id, name").eq("active", true).order("sequence"),
    ]);
    setReportCards((rc.data ?? []) as ReportCard[]);
    setStudents((st.data ?? []) as Student[]);
    setYears((yr.data ?? []) as AcademicYear[]);
    setClasses((cl.data ?? []) as ClassRow[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const studentMap = useMemo(() => new Map(students.map(s => [s.id, s])), [students]);
  const classMap = useMemo(() => new Map(classes.map(c => [c.id, c.name])), [classes]);
  const yearMap = useMemo(() => new Map(years.map(y => [y.id, y.name])), [years]);

  const filtered = useMemo(() => reportCards.filter(rc => {
    if (filterTerm && rc.term !== filterTerm) return false;
    if (filterYear && rc.academic_year_id !== filterYear) return false;
    if (filterClass && rc.class_id !== filterClass) return false;
    const stu = studentMap.get(rc.student_id);
    if (search && stu && !stu.full_name.toLowerCase().includes(search.toLowerCase()) && !stu.student_code.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [reportCards, filterTerm, filterYear, filterClass, search, studentMap]);

  const stats = useMemo(() => ({
    total: reportCards.length,
    published: reportCards.filter(r => r.published).length,
    draft: reportCards.filter(r => !r.published).length,
    avgScore: reportCards.length > 0
      ? (reportCards.reduce((s, r) => s + Number(r.average_score || 0), 0) / reportCards.length).toFixed(1)
      : "0.0",
  }), [reportCards]);

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Report Cards"
        subtitle="Generate, publish, and manage student report cards & master sheets"
      >
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            const ids = filtered.map((r) => r.id).join(",");
            if (!ids) return;
            window.open(`/dashboard/report-cards/print-batch?ids=${ids}`, "_blank");
          }}
          disabled={filtered.length === 0}
          title="Open every filtered report card in a printable page — Print / Save as PDF from your browser"
        >
          <Printer size={14} /> Print batch
        </Button>
        {isAdmin && (
          <>
            <Link href="/dashboard/report-cards/generate">
              <Button variant="gold" size="sm"><Plus size={14} /> Generate</Button>
            </Link>
            <Link href="/dashboard/report-cards/master-sheet">
              <Button variant="secondary" size="sm"><FileBarChart size={14} /> Master Sheet</Button>
            </Link>
          </>
        )}
      </PageHeader>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Total Report Cards" value={String(stats.total)} icon={<FileBarChart size={18} />} colorClass="text-blue-700" />
        <KpiCard label="Published" value={String(stats.published)} icon={<CheckCircle2 size={18} />} colorClass="text-green-700" />
        <KpiCard label="Drafts" value={String(stats.draft)} icon={<Award size={18} />} colorClass="text-amber-700" />
        <KpiCard label="Average Score" value={`${stats.avgScore}%`} icon={<GraduationCap size={18} />} colorClass="text-[#C9A227]" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Report Card Records</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-4">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search student…"
                className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
              />
            </div>
            <select value={filterYear} onChange={e => setFilterYear(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
              <option value="">All Years</option>
              {years.map(y => <option key={y.id} value={y.id}>{y.name}</option>)}
            </select>
            <select value={filterTerm} onChange={e => setFilterTerm(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
              <option value="">All Terms</option>
              <option value="Term 1">Term 1</option>
              <option value="Term 2">Term 2</option>
              <option value="Term 3">Term 3</option>
            </select>
            <select value={filterClass} onChange={e => setFilterClass(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
              <option value="">All Classes</option>
              {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          {filtered.length === 0 ? (
            <EmptyState message="No report cards yet. Click 'Generate' to create one." icon={<FileBarChart />} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b">
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Student</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Class</th>
                    <th className="text-left px-3 py-2 font-semibold text-gray-600">Term / Year</th>
                    <th className="text-right px-3 py-2 font-semibold text-gray-600">Average</th>
                    <th className="text-center px-3 py-2 font-semibold text-gray-600">Grade</th>
                    <th className="text-center px-3 py-2 font-semibold text-gray-600">Position</th>
                    <th className="text-center px-3 py-2 font-semibold text-gray-600">Status</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(rc => {
                    const stu = studentMap.get(rc.student_id);
                    return (
                      <tr key={rc.id} className="border-b hover:bg-gray-50">
                        <td className="px-3 py-2">
                          <div className="font-medium">{stu?.full_name || "—"}</div>
                          <div className="text-xs text-gray-500 font-mono">{stu?.student_code}</div>
                        </td>
                        <td className="px-3 py-2 text-gray-600">{rc.class_id ? classMap.get(rc.class_id) : stu?.grade || "—"}</td>
                        <td className="px-3 py-2 text-gray-600">
                          <div>{rc.term}</div>
                          <div className="text-xs text-gray-400">{rc.academic_year_id ? yearMap.get(rc.academic_year_id) : "—"}</div>
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-semibold">{Number(rc.average_score).toFixed(1)}%</td>
                        <td className="px-3 py-2 text-center">
                          <span className={cn("px-2 py-0.5 rounded text-xs font-bold",
                            rc.grade_overall === "A" ? "bg-green-100 text-green-700" :
                            rc.grade_overall === "B" ? "bg-blue-100 text-blue-700" :
                            rc.grade_overall === "C" ? "bg-amber-100 text-amber-700" :
                            "bg-gray-100 text-gray-600"
                          )}>{rc.grade_overall || "—"}</span>
                        </td>
                        <td className="px-3 py-2 text-center text-sm">
                          {rc.position_in_class ? `${rc.position_in_class}${rc.class_size ? ` / ${rc.class_size}` : ""}` : "—"}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className={cn("px-2 py-0.5 rounded text-xs font-semibold",
                            rc.published ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
                          )}>{rc.published ? "Published" : "Draft"}</span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Link href={`/dashboard/report-cards/${rc.id}`} className="inline-flex items-center gap-1 text-xs text-[#C9A227] hover:underline font-semibold">
                            View <ChevronRight size={12} />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
