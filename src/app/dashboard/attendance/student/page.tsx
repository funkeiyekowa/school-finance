"use client";

/**
 * /dashboard/attendance/student
 *
 * Per-student attendance report for a chosen date range.
 *
 * Authorization: inherited from layout.tsx (ModuleGuard "attendance").
 * RLS on attendance_records and students scopes all queries to the
 * caller's organization automatically — no explicit org filter needed.
 *
 * No service-role client, no API route, no RPC, no migration.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { fmtDate } from "@/lib/utils";
import { PageHeader, LoadingSpinner } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { ArrowLeft, User } from "lucide-react";

interface StudentRow {
  id: string;
  student_code: string;
  full_name: string;
}

interface ClassRow {
  id: string;
  name: string;
}

interface RecordRow {
  id: string;
  date: string;
  session: string;
  status_code: string;
  class_id: string | null;
  capture_method: string;
}

function isPresent(statusCode: string): boolean {
  // Identical to the existing summary page present check.
  return statusCode === "P" || statusCode === "present";
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

export default function AttendanceStudentPage() {
  return (
    <Suspense fallback={<div className="p-6"><LoadingSpinner /></div>}>
      <Inner />
    </Suspense>
  );
}

function Inner() {
  const router = useRouter();
  const params = useSearchParams();
  const supabase = useMemo(() => createClient(), []);
  const { orgId } = useAuth();

  const defaults = useMemo(() => defaultDateRange(), []);
  const [from, setFrom] = useState(params.get("from") ?? defaults.from);
  const [to, setTo] = useState(params.get("to") ?? defaults.to);
  const [selectedStudentId, setSelectedStudentId] = useState(params.get("student") ?? "");

  const [students, setStudents] = useState<StudentRow[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [records, setRecords] = useState<RecordRow[]>([]);

  const [loadingBase, setLoadingBase] = useState(true);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load student list and class lookup once on mount.
  useEffect(() => {
    if (!orgId) return;
    (async () => {
      const [stuRes, clsRes] = await Promise.all([
        supabase
          .from("students")
          .select("id, student_code, full_name")
          .eq("status", "active")
          .order("full_name"),
        supabase
          .from("classes")
          .select("id, name")
          .eq("active", true)
          .order("name"),
      ]);
      setStudents((stuRes.data as StudentRow[]) ?? []);
      setClasses((clsRes.data as ClassRow[]) ?? []);
      setLoadingBase(false);
    })();
  }, [supabase, orgId]);

  // Load attendance records when student or date range changes.
  const loadRecords = useCallback(async () => {
    if (!selectedStudentId) {
      setRecords([]);
      return;
    }
    setLoadingRecords(true);
    setError(null);
    const { data, error: err } = await supabase
      .from("attendance_records")
      .select("id, date, session, status_code, class_id, capture_method")
      .eq("student_id", selectedStudentId)
      .gte("date", from)
      .lte("date", to)
      .order("date", { ascending: false })
      .order("session");

    if (err) {
      setError(err.message);
      setRecords([]);
    } else {
      setRecords((data as RecordRow[]) ?? []);
    }
    setLoadingRecords(false);
  }, [supabase, selectedStudentId, from, to]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  const classMap = useMemo(
    () => new Map(classes.map((c) => [c.id, c.name])),
    [classes],
  );

  const presentCount = useMemo(
    () => records.filter((r) => isPresent(r.status_code)).length,
    [records],
  );
  const rate =
    records.length > 0
      ? Math.round((presentCount / records.length) * 100)
      : null;

  const selectedStudent = students.find((s) => s.id === selectedStudentId);

  if (loadingBase) {
    return <div className="p-6"><LoadingSpinner /></div>;
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <div>
        <button
          onClick={() => router.push("/dashboard/attendance")}
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-3"
        >
          <ArrowLeft className="w-4 h-4" /> Attendance
        </button>
        <PageHeader
          title="Student Attendance Report"
          subtitle="View attendance records and rate for an individual student."
        />
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Student
              </label>
              <select
                className="w-full border rounded-md px-3 py-2 text-sm"
                value={selectedStudentId}
                onChange={(e) => setSelectedStudentId(e.target.value)}
              >
                <option value="">— select student —</option>
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.full_name}
                    {s.student_code ? ` (${s.student_code})` : ""}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                From
              </label>
              <input
                type="date"
                className="border rounded-md px-3 py-2 text-sm"
                value={from}
                max={to}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                To
              </label>
              <input
                type="date"
                className="border rounded-md px-3 py-2 text-sm"
                value={to}
                min={from}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Summary stats */}
      {selectedStudentId && !loadingRecords && (
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-4 text-center">
              <p className="text-2xl font-bold text-gray-800">{records.length}</p>
              <p className="text-xs text-gray-500 mt-1">Total records</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <p className="text-2xl font-bold text-emerald-700">{presentCount}</p>
              <p className="text-xs text-gray-500 mt-1">Present</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <p
                className="text-2xl font-bold"
                style={{
                  color:
                    rate === null
                      ? "#6B7280"
                      : rate >= 90
                      ? "#065F46"
                      : rate >= 75
                      ? "#92400E"
                      : "#991B1B",
                }}
              >
                {rate !== null ? `${rate}%` : "—"}
              </p>
              <p className="text-xs text-gray-500 mt-1">Attendance rate</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Records table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <User className="w-4 h-4" />
            {selectedStudent
              ? `${selectedStudent.full_name} — ${fmtDate(from)} to ${fmtDate(to)}`
              : "Select a student to view records"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadingRecords ? (
            <div className="py-4"><LoadingSpinner /></div>
          ) : !selectedStudentId ? (
            <p className="text-sm text-gray-400 italic">
              Choose a student and date range above.
            </p>
          ) : records.length === 0 ? (
            <p className="text-sm text-gray-400 italic">
              No attendance records found for this student in the selected period.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-gray-500 text-xs">
                    <th className="pb-2 pr-4 font-medium">Date</th>
                    <th className="pb-2 pr-4 font-medium">Session</th>
                    <th className="pb-2 pr-4 font-medium">Status</th>
                    <th className="pb-2 pr-4 font-medium">Class</th>
                    <th className="pb-2 font-medium">Capture</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {records.map((r) => (
                    <tr key={r.id}>
                      <td className="py-2 pr-4 font-mono text-xs">{r.date}</td>
                      <td className="py-2 pr-4 text-xs capitalize">
                        {r.session.replace(/_/g, " ")}
                      </td>
                      <td className="py-2 pr-4">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            isPresent(r.status_code)
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-red-100 text-red-700"
                          }`}
                        >
                          {r.status_code}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-xs text-gray-600">
                        {r.class_id
                          ? (classMap.get(r.class_id) ?? r.class_id)
                          : "—"}
                      </td>
                      <td className="py-2 text-xs text-gray-500 font-mono">
                        {r.capture_method ?? "manual"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
