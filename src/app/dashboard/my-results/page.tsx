"use client";

import { useStudentResults } from "@/lib/hooks/useStudentResults";
import { formatScore } from "@/lib/exams/examState";
import { cn } from "@/lib/utils";
import { PageHeader, LoadingSpinner } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Award } from "lucide-react";

export default function MyResultsPage() {
  const { found, assessment_types, subjects, attempts, attendance, loading, error, reload } = useStudentResults();

  if (loading) return <div className="p-6"><LoadingSpinner /></div>;

  if (error) {
    return (
      <div className="p-6 space-y-5">
        <PageHeader
          icon={<Award size={24} />}
          gradient="gold" title="My Results" subtitle="View your academic performance, exam results, and attendance" />
        <Card>
          <CardContent className="p-6 text-center space-y-3">
            <p className="text-sm text-gray-600">We couldn&apos;t load your dashboard.</p>
            <p className="text-xs text-gray-500">{error}</p>
            <Button size="sm" variant="secondary" onClick={() => void reload()}>Retry</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!found) return <div className="p-6 text-gray-500">No student record linked to your account.</div>;

  const attendancePercentage = attendance?.percentage ?? null;

  return (
    <div className="p-6 space-y-5">
      <PageHeader
        icon={<Award size={24} />}
        gradient="gold" title="My Results" subtitle="View your academic performance, exam results, and attendance" />

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border p-4 text-center">
          <div className="text-2xl font-bold text-[#0F2A47]">{subjects.length}</div>
          <div className="text-xs text-gray-500">Subjects</div>
        </div>
        <div className="bg-white rounded-xl border p-4 text-center">
          <div className="text-2xl font-bold text-green-700">{attempts.filter(a => a.passed).length}</div>
          <div className="text-xs text-gray-500">Exams Passed</div>
        </div>
        <div className="bg-white rounded-xl border p-4 text-center">
          <div className="text-2xl font-bold text-[#0F2A47]">{attempts.length}</div>
          <div className="text-xs text-gray-500">CBT Attempts</div>
        </div>
        <div className="bg-white rounded-xl border p-4 text-center">
          <div className={cn("text-2xl font-bold",
            attendancePercentage === null ? "text-gray-500" :
            attendancePercentage >= 75 ? "text-green-700" :
            attendancePercentage >= 50 ? "text-amber-700" : "text-red-700"
          )}>{attendancePercentage === null ? "—" : `${attendancePercentage}%`}</div>
          <div className="text-xs text-gray-500">Attendance</div>
        </div>
      </div>

      {/* Subject scores */}
      {subjects.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Subject Results</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="bg-gray-50 border-b">
                  <th className="text-left px-3 py-2 font-semibold text-gray-600">Subject</th>
                  {assessment_types.map(t => <th key={t.id} className="text-center px-2 py-2 font-semibold text-gray-600 text-xs">{t.short_code}<br /><span className="font-normal text-gray-400">/{t.max_score}</span></th>)}
                  <th className="text-center px-3 py-2 font-semibold text-gray-600">Total</th>
                  <th className="text-center px-3 py-2 font-semibold text-gray-600">Grade</th>
                </tr></thead>
                <tbody>
                  {subjects.map(row => (
                    <tr key={row.id} className="border-b">
                      <td className="px-3 py-2 font-medium">{row.name}</td>
                      {assessment_types.map(t => (
                        <td key={t.id} className="text-center px-2 py-2 text-gray-600">
                          {row.breakdown.find(b => b.assessment_type_id === t.id)?.score ?? "—"}
                        </td>
                      ))}
                      <td className="text-center px-3 py-2 font-bold">{row.total}/{row.max_total}</td>
                      <td className="text-center px-3 py-2">
                        {row.grade && <span className={cn("px-2 py-0.5 rounded text-xs font-bold",
                          row.grade === "A" ? "bg-green-100 text-green-700" :
                          row.grade === "B" ? "bg-blue-100 text-blue-700" :
                          row.grade === "F" ? "bg-red-100 text-red-700" :
                          "bg-gray-100 text-gray-700"
                        )}>{row.grade}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* CBT results */}
      {attempts.length > 0 && (
        <Card>
          <CardHeader><CardTitle>CBT / Online Exam Results</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {attempts.map(att => (
                <div key={att.id} className="flex items-center justify-between p-3 rounded-lg border">
                  <div>
                    <div className="text-sm font-semibold">{att.exam_title}</div>
                    <div className="text-xs text-gray-400">{att.submitted_at ? new Date(att.submitted_at).toLocaleDateString() : ""}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold">{formatScore(att.total_score, att.total_marks, att.percentage)}</span>
                    {att.passed !== null && (
                      <span className={cn("text-xs font-bold px-2 py-0.5 rounded", att.passed ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700")}>
                        {att.passed ? "PASSED" : "FAILED"}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
