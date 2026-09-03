"use client";

/**
 * Admin bulk photo upload for students, by class.
 *
 * Pick a class, drop in a batch of photos (ideally named/numbered in
 * the same order as a printed class list), confirm the match-preview
 * grid, save. See BulkPhotoUploader for why the grid exists instead of
 * trusting filenames alone.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { useToast } from "@/lib/hooks/useToast";
import { PageHeader, LoadingSpinner } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { BulkPhotoUploader, type RosterPerson } from "@/components/photos/BulkPhotoUploader";
import { Camera } from "lucide-react";

interface StudentRow {
  id: string;
  full_name: string;
  student_code: string;
  grade: string | null;
  photo_url: string | null;
}

export default function StudentPhotosPage() {
  const supabase = useMemo(() => createClient(), []);
  const { orgId, canEdit } = useAuth();
  const { notify, ToastHost } = useToast();

  const [grades, setGrades] = useState<string[]>([]);
  const [selectedGrade, setSelectedGrade] = useState("");
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [loading, setLoading] = useState(true);

  const loadGrades = useCallback(async () => {
    const { data } = await supabase
      .from("students")
      .select("grade")
      .eq("status", "active")
      .not("grade", "is", null);
    const unique = Array.from(new Set((data ?? []).map((r) => (r as { grade: string }).grade))).sort();
    setGrades(unique);
    setLoading(false);
  }, [supabase]);

  const loadStudents = useCallback(async (grade: string) => {
    if (!grade) { setStudents([]); return; }
    const { data } = await supabase
      .from("students")
      .select("id, full_name, student_code, grade, photo_url")
      .eq("status", "active")
      .eq("grade", grade)
      .order("full_name");
    setStudents((data as StudentRow[]) ?? []);
  }, [supabase]);

  useEffect(() => { loadGrades(); }, [loadGrades]);
  useEffect(() => { loadStudents(selectedGrade); }, [selectedGrade, loadStudents]);

  const roster: RosterPerson[] = students.map((s) => ({
    id: s.id,
    name: s.full_name,
    subLabel: s.student_code,
    currentPhotoUrl: s.photo_url,
  }));

  async function handleCommit(pairs: { id: string; photoUrl: string }[]) {
    const payload = pairs.map((p) => ({ student_id: p.id, photo_url: p.photoUrl }));
    const { error } = await supabase.rpc("bulk_set_student_photos", { p_pairs: payload });
    if (error) throw new Error(error.message);
    await loadStudents(selectedGrade);
  }

  if (loading) return <div className="p-6"><LoadingSpinner /></div>;

  if (!canEdit) {
    return (
      <div className="p-6">
        <Card className="p-8 text-center text-gray-500">
          You don&apos;t have permission to upload student photos.
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5">
      <PageHeader
        icon={<Camera size={24} />}
        gradient="navy"
        title="Student Photos"
        subtitle="Bulk-upload class photos for ID cards, matched against the roster before saving"
      />
      <ToastHost />

      <Card className="p-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">Class</label>
        <select
          value={selectedGrade}
          onChange={(e) => setSelectedGrade(e.target.value)}
          className="w-full max-w-xs px-3 py-2 border border-gray-300 rounded-lg text-sm"
        >
          <option value="">Choose a class…</option>
          {grades.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
      </Card>

      {selectedGrade && (
        students.length === 0 ? (
          <Card className="p-8 text-center text-gray-500">No active students found in {selectedGrade}.</Card>
        ) : orgId ? (
          <BulkPhotoUploader
            orgId={orgId}
            kind="students"
            roster={roster}
            onCommit={handleCommit}
            notify={notify}
          />
        ) : null
      )}
    </div>
  );
}
