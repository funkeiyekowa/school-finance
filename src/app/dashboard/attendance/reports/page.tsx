"use client";

/**
 * /dashboard/attendance/reports
 *
 * Attendance summary report for a class × date range.
 * Fetches from /api/attendance/reports (server-side auth + org scoping).
 *
 * Features:
 *  - Class selector (teacher sees only assigned classes)
 *  - Date range picker
 *  - Summary: present / absent / total counts per student
 *  - Daily grid: colour-coded status per student per date
 *  - CSV export (triggers browser download via /api/attendance/reports?format=csv)
 */

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { PageHeader, LoadingSpinner } from "@/components/ui/PageHeader";
import { ArrowLeft, Download, BarChart3 } from "lucide-react";
import Link from "next/link";

const supabase = createClient();

interface ClassRow { id: string; name: string; }
interface SubjectRow { id: string; name: string; short_code: string; }
interface StatusMeta { code: string; label: string; counts_as_present: boolean; }
interface StudentSummary {
  student_id: string; student_code: string; full_name: string;
  present: number; absent: number; total: number;
}
interface ReportData {
  class_name: string;
  date_from: string; date_to: string;
  students: { student_id: string; student_code: string; full_name: string }[];
  dates: string[];
  records: { student_id: string; date: string; session: string; status_code: string }[];
  statuses: StatusMeta[];
}

function defaultDateRange() {
  const today = new Date();
  const monthAgo = new Date(today);
  monthAgo.setDate(today.getDate() - 30);
  return {
    from: monthAgo.toISOString().slice(0, 10),
    to: today.toISOString().slice(0, 10),
  };
}

export default function AttendanceReportsPage() {
  const { user } = useAuth();
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [classId, setClassId] = useState("");
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [subjectId, setSubjectId] = useState("");
  const range = defaultDateRange();
  const [dateFrom, setDateFrom] = useState(range.from);
  const [dateTo, setDateTo] = useState(range.to);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<ReportData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // Load classes the user can see (teacher: assigned only; admin: all)
  const loadClasses = useCallback(async () => {
    if (!user) return;
    const { data: roleData } = await supabase.rpc("phase1_active_role");
    const role = (roleData as string | null) ?? "";

    let q = supabase.from("classes").select("id, name").order("name");

    if (role === "teacher") {
      const { data: asgn } = await supabase
        .from("teacher_assignments")
        .select("class_id")
        .eq("user_id", user.id);
      const ids = (asgn ?? []).map((a: { class_id: string }) => a.class_id);
      if (ids.length === 0) { setClasses([]); return; }
      q = q.in("id", ids);
    }

    const { data } = await q;
    const rows = (data ?? []) as ClassRow[];
    setClasses(rows);
    if (rows.length > 0 && !classId) setClassId(rows[0].id);
  }, [user, classId]);

  useEffect(() => { loadClasses(); }, [loadClasses]);

  // Fetch subjects for the selected class
  useEffect(() => {
    setSubjectId("");
    setSubjects([]);
    if (!classId) return;
    fetch(`/api/attendance/subjects?class_id=${classId}`)
      .then(r => r.json())
      .then(d => setSubjects(d.subjects ?? []))
      .catch(() => setSubjects([]));
  }, [classId]);

  const fetchReport = useCallback(async () => {
    if (!classId) return;
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      const subjectParam = subjectId ? `&subject_id=${encodeURIComponent(subjectId)}` : "";
      const url = `/api/attendance/reports?class_id=${encodeURIComponent(classId)}&date_from=${dateFrom}&date_to=${dateTo}${subjectParam}`;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? `Error ${res.status}`); return; }
      setReport(data as ReportData);
    } catch {
      setError("Network error — check connection.");
    } finally {
      setLoading(false);
    }
  }, [classId, subjectId, dateFrom, dateTo]);

  async function exportCsv() {
    if (!classId) return;
    setExporting(true);
    try {
      const subjectParam = subjectId ? `&subject_id=${encodeURIComponent(subjectId)}` : "";
      const url = `/api/attendance/reports?class_id=${encodeURIComponent(classId)}&date_from=${dateFrom}&date_to=${dateTo}${subjectParam}&format=csv`;
      const res = await fetch(url);
      if (!res.ok) { setError("Export failed."); return; }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match?.[1] ?? `attendance_${dateFrom}_to_${dateTo}.csv`;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    } finally {
      setExporting(false);
    }
  }

  // Compute per-student summary
  const presentCodes = new Set(
    (report?.statuses ?? []).filter(s => s.counts_as_present).map(s => s.code)
  );

  const summaries: StudentSummary[] = (report?.students ?? []).map(stu => {
    const recs = (report?.records ?? []).filter(r => r.student_id === stu.student_id);
    const present = recs.filter(r => presentCodes.has(r.status_code)).length;
    return {
      ...stu,
      present,
      absent: recs.length - present,
      total: recs.length,
    };
  });

  // Quick lookup: student × date → status_code
  const cellKey = (studentId: string, date: string) => `${studentId}|${date}`;
  const cellMap = new Map<string, string>();
  for (const r of report?.records ?? []) {
    cellMap.set(cellKey(r.student_id, r.date), r.status_code);
  }

  function cellColor(code: string | undefined): string {
    if (!code) return "bg-gray-50";
    return presentCodes.has(code)
      ? "bg-green-100 text-green-800"
      : "bg-red-100 text-red-700";
  }

  return (
    <div className="space-y-5 max-w-6xl mx-auto p-4">
      <div className="flex items-center gap-3">
        <Link href="/dashboard/attendance">
          <Button variant="ghost" size="sm"><ArrowLeft size={14} /> Back</Button>
        </Link>
        <div className="flex items-center gap-2">
          <BarChart3 size={20} className="text-[#C9A227]" />
          <h1 className="text-lg font-bold text-gray-800">Attendance Reports</h1>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4 flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1 min-w-[160px] flex-1">
            <label className="text-xs font-medium text-gray-600">Class</label>
            <select
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
              value={classId}
              onChange={e => setClassId(e.target.value)}
            >
              {classes.length === 0 && <option value="">No classes available</option>}
              {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          {subjects.length > 0 && (
            <div className="flex flex-col gap-1 min-w-[160px]">
              <label className="text-xs font-medium text-gray-600">Subject <span className="font-normal text-gray-400">(optional)</span></label>
              <select
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
                value={subjectId}
                onChange={e => setSubjectId(e.target.value)}
              >
                <option value="">Class-level (no subject)</option>
                {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">From</label>
            <input type="date" className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
              value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">To</label>
            <input type="date" className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
              value={dateTo} onChange={e => setDateTo(e.target.value)} />
          </div>
          <Button variant="gold" size="sm" onClick={fetchReport} disabled={!classId || loading}>
            {loading ? "Loading…" : "Generate Report"}
          </Button>
          {report && (
            <Button variant="ghost" size="sm" onClick={exportCsv} disabled={exporting}>
              <Download size={14} /> {exporting ? "Exporting…" : "Export CSV"}
            </Button>
          )}
        </CardContent>
      </Card>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {loading && (
        <div className="flex justify-center py-12"><LoadingSpinner /></div>
      )}

      {report && !loading && (
        <>
          {/* Summary table */}
          <Card>
            <CardHeader>
              <CardTitle>
                {report.class_name} — {report.date_from} to {report.date_to}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {summaries.length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center">No records found for this period.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="text-left py-2 px-2 font-medium text-gray-600">Code</th>
                        <th className="text-left py-2 px-2 font-medium text-gray-600">Student</th>
                        <th className="text-center py-2 px-2 font-medium text-green-700">Present</th>
                        <th className="text-center py-2 px-2 font-medium text-red-600">Absent</th>
                        <th className="text-center py-2 px-2 font-medium text-gray-600">Total Sessions</th>
                        <th className="text-center py-2 px-2 font-medium text-gray-600">Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summaries.map(s => (
                        <tr key={s.student_id} className="border-b border-gray-50 hover:bg-gray-50">
                          <td className="py-2 px-2 font-mono text-xs text-gray-500">{s.student_code}</td>
                          <td className="py-2 px-2 font-medium text-gray-800">{s.full_name}</td>
                          <td className="py-2 px-2 text-center text-green-700 font-semibold">{s.present}</td>
                          <td className="py-2 px-2 text-center text-red-600 font-semibold">{s.absent}</td>
                          <td className="py-2 px-2 text-center text-gray-600">{s.total}</td>
                          <td className="py-2 px-2 text-center">
                            {s.total > 0 ? (
                              <span className={`font-semibold ${s.present / s.total >= 0.8 ? "text-green-700" : s.present / s.total >= 0.6 ? "text-yellow-600" : "text-red-600"}`}>
                                {Math.round((s.present / s.total) * 100)}%
                              </span>
                            ) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Daily grid (only shown when ≤31 dates to keep it readable) */}
          {report.dates.length > 0 && report.dates.length <= 31 && report.students.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Daily Breakdown</CardTitle></CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="text-xs border-collapse">
                    <thead>
                      <tr>
                        <th className="text-left py-1 px-2 font-medium text-gray-600 min-w-[120px] sticky left-0 bg-white z-10">Student</th>
                        {report.dates.map(d => (
                          <th key={d} className="py-1 px-1 font-medium text-gray-500 min-w-[36px] text-center">
                            {d.slice(5)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {report.students.map(stu => (
                        <tr key={stu.student_id} className="border-t border-gray-50">
                          <td className="py-1 px-2 text-gray-700 sticky left-0 bg-white z-10 truncate max-w-[150px]">
                            {stu.full_name}
                          </td>
                          {report.dates.map(d => {
                            const code = cellMap.get(cellKey(stu.student_id, d));
                            return (
                              <td key={d} className={`py-1 px-1 text-center rounded ${cellColor(code)}`}
                                title={code ?? "—"}>
                                {code ?? ""}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-gray-400 mt-2">
                  Dates shown as MM-DD. Colours: green = present, red = absent/other.
                </p>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
