"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { PageHeader, LoadingSpinner, EmptyState } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { ArrowLeft, Printer, FileBarChart } from "lucide-react";

interface ReportCard {
  id: string; student_id: string; academic_year_id: string | null; class_id: string | null;
  term: string; total_score: number; average_score: number; total_subjects: number;
  grade_overall: string | null; position_in_class: number | null;
}
interface Subject { id: string; report_card_id: string; subject_name: string; total_score: number | null; grade: string | null; }
interface Student { id: string; student_code: string; full_name: string; }
interface AcademicYear { id: string; name: string; status: string; }
interface ClassRow { id: string; name: string; }

export default function MasterSheetPage() {
  const { orgId } = useAuth();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [reportCards, setReportCards] = useState<ReportCard[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);

  const [yearId, setYearId] = useState("");
  const [classId, setClassId] = useState("");
  const [term, setTerm] = useState("Term 1");

  const load = useCallback(async () => {
    setLoading(true);
    const [rc, sub, st, yr, cl] = await Promise.all([
      supabase.from("report_cards").select("*"),
      supabase.from("report_card_subjects").select("id, report_card_id, subject_name, total_score, grade"),
      supabase.from("students").select("id, student_code, full_name"),
      supabase.from("academic_years").select("*").order("name", { ascending: false }),
      supabase.from("classes").select("id, name").eq("active", true).order("sequence"),
    ]);
    setReportCards((rc.data ?? []) as ReportCard[]);
    setSubjects((sub.data ?? []) as Subject[]);
    setStudents((st.data ?? []) as Student[]);
    setYears((yr.data ?? []) as AcademicYear[]);
    setClasses((cl.data ?? []) as ClassRow[]);
    const cur = (yr.data ?? []).find((y) => (y as { status: string }).status === "current");
    if (cur) setYearId((cur as { id: string }).id);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const filteredCards = useMemo(() => reportCards.filter(rc => {
    if (yearId && rc.academic_year_id !== yearId) return false;
    if (classId && rc.class_id !== classId) return false;
    if (term && rc.term !== term) return false;
    return true;
  }), [reportCards, yearId, classId, term]);

  const studentMap = useMemo(() => new Map(students.map(s => [s.id, s])), [students]);

  const subjectsByCard = useMemo(() => {
    const map = new Map<string, Subject[]>();
    subjects.forEach(s => {
      const arr = map.get(s.report_card_id) || [];
      arr.push(s);
      map.set(s.report_card_id, arr);
    });
    return map;
  }, [subjects]);

  // Collect all unique subject names for column headers
  const allSubjectNames = useMemo(() => {
    const set = new Set<string>();
    filteredCards.forEach(rc => (subjectsByCard.get(rc.id) || []).forEach(s => set.add(s.subject_name)));
    return Array.from(set).sort();
  }, [filteredCards, subjectsByCard]);

  // Sort by average score descending, assign positions
  const rankedCards = useMemo(() => {
    return filteredCards
      .slice()
      .sort((a, b) => Number(b.average_score) - Number(a.average_score))
      .map((rc, i) => ({ ...rc, position: i + 1 }));
  }, [filteredCards]);

  function printSheet() { window.print(); }

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between print:hidden">
        <Link href="/dashboard/report-cards" className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-[#C9A227]">
          <ArrowLeft size={14} /> Back
        </Link>
        <Button variant="secondary" size="sm" onClick={printSheet}><Printer size={14} /> Print</Button>
      </div>

      <PageHeader
        title="Result Master Sheet"
        subtitle="Class-wide performance summary across all subjects"
      />

      <Card className="print:hidden">
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Academic Year</label>
              <select value={yearId} onChange={e => setYearId(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                <option value="">All Years</option>
                {years.map(y => <option key={y.id} value={y.id}>{y.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Term</label>
              <select value={term} onChange={e => setTerm(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                <option value="Term 1">Term 1</option>
                <option value="Term 2">Term 2</option>
                <option value="Term 3">Term 3</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Class</label>
              <select value={classId} onChange={e => setClassId(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                <option value="">All Classes</option>
                {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            Master Sheet — {classes.find(c => c.id === classId)?.name || "All Classes"} · {term} · {years.find(y => y.id === yearId)?.name || "All Years"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {rankedCards.length === 0 ? (
            <EmptyState message="No report cards match your filters." icon={<FileBarChart />} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-[#0F2A47] text-white">
                    <th className="px-2 py-2 border border-white/20 text-center">Pos</th>
                    <th className="px-2 py-2 border border-white/20 text-left">Code</th>
                    <th className="px-2 py-2 border border-white/20 text-left">Student</th>
                    {allSubjectNames.map(sn => (
                      <th key={sn} className="px-2 py-2 border border-white/20 text-center min-w-[60px]">{sn}</th>
                    ))}
                    <th className="px-2 py-2 border border-white/20 text-center">Total</th>
                    <th className="px-2 py-2 border border-white/20 text-center">Avg</th>
                    <th className="px-2 py-2 border border-white/20 text-center">Grade</th>
                  </tr>
                </thead>
                <tbody>
                  {rankedCards.map(rc => {
                    const stu = studentMap.get(rc.student_id);
                    const cardSubs = subjectsByCard.get(rc.id) || [];
                    const subMap = new Map(cardSubs.map(s => [s.subject_name, s]));
                    return (
                      <tr key={rc.id} className="border-b hover:bg-gray-50">
                        <td className="px-2 py-2 border border-gray-200 text-center font-bold">{rc.position}</td>
                        <td className="px-2 py-2 border border-gray-200 font-mono">{stu?.student_code}</td>
                        <td className="px-2 py-2 border border-gray-200 font-medium">{stu?.full_name || "—"}</td>
                        {allSubjectNames.map(sn => {
                          const s = subMap.get(sn);
                          return (
                            <td key={sn} className="px-2 py-2 border border-gray-200 text-center">
                              {s?.total_score !== null && s?.total_score !== undefined ? (
                                <span className={cn("font-semibold",
                                  Number(s.total_score) >= 75 ? "text-green-700" :
                                  Number(s.total_score) >= 50 ? "text-gray-700" :
                                  "text-red-600"
                                )}>{Number(s.total_score).toFixed(0)}</span>
                              ) : "—"}
                            </td>
                          );
                        })}
                        <td className="px-2 py-2 border border-gray-200 text-center font-semibold">{Number(rc.total_score).toFixed(0)}</td>
                        <td className="px-2 py-2 border border-gray-200 text-center font-bold">{Number(rc.average_score).toFixed(1)}%</td>
                        <td className="px-2 py-2 border border-gray-200 text-center">
                          <span className={cn("px-1.5 py-0.5 rounded text-xs font-bold",
                            rc.grade_overall === "A" ? "bg-green-100 text-green-700" :
                            rc.grade_overall === "B" ? "bg-blue-100 text-blue-700" :
                            "bg-amber-100 text-amber-700"
                          )}>{rc.grade_overall || "—"}</span>
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
