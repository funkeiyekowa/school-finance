"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { cn } from "@/lib/utils";
import { PageHeader, LoadingSpinner } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Save, CheckCircle2, Users, ClipboardCheck } from "lucide-react";

interface ClassRow { id: string; name: string; short_code: string; sequence: number; }
interface StatusRow { id: string; code: string; label: string; color: string; counts_as_present: boolean; is_default: boolean; sort_order: number; }
interface StudentRow { id: string; student_code: string; full_name: string; grade: string | null; }
interface RecordRow { id: string; student_id: string; status_code: string; remarks: string | null; }

export default function AttendancePage() {
  const { profile, canEdit, orgId, user, membership } = useAuth();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [statuses, setStatuses] = useState<StatusRow[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [existingRecords, setExistingRecords] = useState<RecordRow[]>([]);

  const [selectedClassId, setSelectedClassId] = useState<string>("");
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().substring(0, 10));
  const [session, setSession] = useState("full_day");

  // Attendance state: student_id → status_code
  const [marks, setMarks] = useState<Record<string, string>>({});

  const loadBase = useCallback(async () => {
    const [clsRes, statusRes] = await Promise.all([
      supabase.from("classes").select("id, name, short_code, sequence").eq("active", true).order("sequence"),
      supabase.from("attendance_statuses").select("*").eq("active", true).order("sort_order"),
    ]);

    let allClasses = (clsRes.data as ClassRow[]) ?? [];

    // Teacher scoping: if the user is a teacher (not admin/owner), restrict
    // the class list to the ones assigned to them via teacher_assignments.
    const role = membership?.role ?? "";
    const isTeacher = role === "teacher";
    if (isTeacher && user) {
      const { data: ta } = await supabase
        .from("teacher_assignments")
        .select("class_id")
        .eq("user_id", user.id)
        .eq("active", true);
      const myClassIds = new Set((ta ?? []).map((r: { class_id: string }) => r.class_id));
      allClasses = allClasses.filter(c => myClassIds.has(c.id));
    }

    setClasses(allClasses);
    setStatuses((statusRes.data as StatusRow[]) ?? []);
    setLoading(false);
  }, [supabase, user, membership]);

  useEffect(() => { loadBase(); }, [loadBase]);

  // Load students for selected class + existing records for selected date
  const loadClassData = useCallback(async () => {
    if (!selectedClassId) { setStudents([]); setExistingRecords([]); setMarks({}); return; }

    const selectedClass = classes.find(c => c.id === selectedClassId);
    if (!selectedClass) return;

    // Students matching this class (by grade name or enrollment)
    const { data: stuData } = await supabase
      .from("students")
      .select("id, student_code, full_name, grade")
      .eq("status", "active")
      .or(`grade.eq.${selectedClass.name},grade.eq.${selectedClass.short_code}`)
      .order("full_name");

    const stuList = stuData as StudentRow[] ?? [];
    setStudents(stuList);

    // Load existing records for this date/session/class
    if (stuList.length > 0) {
      const { data: recData } = await supabase
        .from("attendance_records")
        .select("id, student_id, status_code, remarks")
        .eq("date", selectedDate)
        .eq("session", session)
        .eq("class_id", selectedClassId);

      const records = recData as RecordRow[] ?? [];
      setExistingRecords(records);

      // Pre-fill marks from existing records
      const defaultStatus = statuses.find(s => s.is_default)?.code || "present";
      const newMarks: Record<string, string> = {};
      for (const stu of stuList) {
        const existing = records.find(r => r.student_id === stu.id);
        newMarks[stu.id] = existing?.status_code || defaultStatus;
      }
      setMarks(newMarks);
    }
  }, [selectedClassId, selectedDate, session, classes, statuses, supabase]);

  useEffect(() => { loadClassData(); }, [loadClassData]);

  async function saveAttendance() {
    if (!selectedClassId || students.length === 0) return;
    setSaving(true);

    // Find the current academic year
    const { data: yearData } = await supabase
      .from("academic_years")
      .select("id")
      .eq("status", "current")
      .limit(1)
      .maybeSingle();
    const yearId = yearData?.id || null;

    // Upsert attendance records for each student
    const records = students.map(stu => ({
      student_id: stu.id,
      class_id: selectedClassId,
      academic_year_id: yearId,
      subject_id: null,
      date: selectedDate,
      status_code: marks[stu.id] || "present",
      session,
      recorded_by: profile?.full_name || profile?.email,
      organization_id: orgId,
    }));

    // Delete existing records for this class/date/session then insert fresh
    // (upsert with the composite unique constraint)
    const studentIds = students.map(s => s.id);
    const { error: delErr } = await supabase
      .from("attendance_records")
      .delete()
      .eq("date", selectedDate)
      .eq("session", session)
      .eq("class_id", selectedClassId)
      .in("student_id", studentIds);
    if (delErr) {
      console.warn("attendance delete failed:", delErr.message);
      alert(`Could not clear previous marks: ${delErr.message}`);
      setSaving(false);
      return;
    }

    const { error: insErr } = await supabase.from("attendance_records").insert(records);
    if (insErr) {
      alert(`Could not save attendance: ${insErr.message}`);
      setSaving(false);
      return;
    }

    await supabase.from("activity_log").insert({
      user_email: profile?.email,
      user_name: profile?.full_name,
      action: "Record Attendance",
      details: `${classes.find(c => c.id === selectedClassId)?.name} — ${selectedDate} — ${students.length} students`,
      organization_id: orgId,
    });

    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
    loadClassData();
  }

  function markAll(statusCode: string) {
    const newMarks: Record<string, string> = {};
    for (const stu of students) {
      newMarks[stu.id] = statusCode;
    }
    setMarks(newMarks);
  }

  // Stats
  const presentCount = Object.values(marks).filter(code => {
    const st = statuses.find(s => s.code === code);
    return st?.counts_as_present;
  }).length;
  const absentCount = students.length - presentCount;

  if (loading) return <div className="p-6"><LoadingSpinner /></div>;

  return (
    <div className="p-6 space-y-5">
      <PageHeader
        icon={<ClipboardCheck size={24} />}
        gradient="emerald" title="Attendance" subtitle="Record daily student attendance by class" />

      {/* Controls */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Class</label>
              <select value={selectedClassId} onChange={e => setSelectedClassId(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227] min-w-[160px]">
                <option value="">Select class...</option>
                {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Date</label>
              <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Session</label>
              <select value={session} onChange={e => setSession(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]">
                <option value="full_day">Full Day</option>
                <option value="morning">Morning</option>
                <option value="afternoon">Afternoon</option>
              </select>
            </div>
            {selectedClassId && students.length > 0 && (
              <div className="flex items-center gap-2 ml-auto">
                <span className="text-xs text-gray-500">Quick:</span>
                {statuses.map(s => (
                  <button key={s.code} onClick={() => markAll(s.code)}
                    className="px-2 py-1 rounded text-[10px] font-bold border hover:opacity-80"
                    style={{ borderColor: s.color, color: s.color }}>
                    All {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      {selectedClassId && students.length > 0 && (
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-sm">
            <Users size={14} className="text-gray-400" />
            <span className="font-medium">{students.length} students</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-green-700">
            <span className="w-2 h-2 rounded-full bg-green-500" />
            {presentCount} present
          </div>
          <div className="flex items-center gap-2 text-sm text-red-700">
            <span className="w-2 h-2 rounded-full bg-red-500" />
            {absentCount} absent
          </div>
          <div className="text-sm text-gray-500">
            ({students.length > 0 ? Math.round((presentCount / students.length) * 100) : 0}% attendance)
          </div>
        </div>
      )}

      {/* Student grid */}
      {selectedClassId && students.length > 0 && (
        <Card>
          <CardContent className="py-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50">
                    <th className="text-left px-3 py-3 font-semibold text-gray-600 w-12">#</th>
                    <th className="text-left px-3 py-3 font-semibold text-gray-600">Student</th>
                    {statuses.map(s => (
                      <th key={s.code} className="text-center px-2 py-3 font-semibold text-gray-600 text-xs whitespace-nowrap">
                        <span style={{ color: s.color }}>{s.label}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {students.map((stu, idx) => (
                    <tr key={stu.id} className="border-b hover:bg-gray-50">
                      <td className="px-3 py-2 text-gray-400 text-xs">{idx + 1}</td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-gray-900">{stu.full_name}</div>
                        <div className="text-[10px] text-gray-400 font-mono">{stu.student_code}</div>
                      </td>
                      {statuses.map(s => (
                        <td key={s.code} className="text-center px-2 py-2">
                          <label className="cursor-pointer">
                            <input
                              type="radio"
                              name={`att-${stu.id}`}
                              checked={marks[stu.id] === s.code}
                              onChange={() => setMarks(m => ({ ...m, [stu.id]: s.code }))}
                              className="w-4 h-4 border-gray-300 focus:ring-[#C9A227]"
                              style={{ accentColor: s.color }}
                            />
                          </label>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty states */}
      {selectedClassId && students.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <Users size={32} className="mx-auto mb-2 opacity-50" />
          <p className="text-sm">No active students found for this class.</p>
          <p className="text-xs mt-1">Make sure students have their Grade set to match this class name.</p>
        </div>
      )}

      {!selectedClassId && (
        <div className="text-center py-12 text-gray-400">
          <p className="text-sm">Select a class above to record attendance.</p>
        </div>
      )}

      {/* Save button */}
      {selectedClassId && students.length > 0 && canEdit && (
        <div className="flex items-center gap-3">
          <Button variant="gold" loading={saving} onClick={saveAttendance}>
            <Save size={14} /> Save Attendance
          </Button>
          {saved && (
            <span className="flex items-center gap-1 text-green-600 text-sm font-medium">
              <CheckCircle2 size={14} /> Saved
            </span>
          )}
          {existingRecords.length > 0 && (
            <span className="text-xs text-gray-400">
              Previously recorded — saving will update.
            </span>
          )}
        </div>
      )}
    </div>
  );
}
