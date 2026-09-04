"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { AlertCircle, CheckCircle2, Upload, Download } from "lucide-react";

interface ImportStudentsModalProps {
  onCloseAction: () => void;
}

const TEMPLATE_HEADERS = [
  "student_code", "first_name", "last_name", "middle_name", "grade",
  "gender", "status", "guardian_name", "guardian_phone", "guardian_email",
  "date_of_birth", "admission_date", "academic_year", "address", "notes",
];
const TEMPLATE_SAMPLE_ROW = [
  "STU-0001", "Adaeze", "Okafor", "", "JSS 1",
  "female", "active", "Mrs C. Okafor", "08012345678", "c.okafor@example.com",
  "2013-04-12", "2026-09-01", "2026/2027", "12 Ogui Road, Enugu", "",
];

function downloadStudentImportTemplate() {
  const csv = TEMPLATE_HEADERS.join(",") + "\n" + TEMPLATE_SAMPLE_ROW.join(",");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "student-import-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export function ImportStudentsModal({ onCloseAction }: ImportStudentsModalProps) {
  const supabase = createClient();
  const { profile, orgId } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ count: number } | null>(null);

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      // Parse CSV/Excel
      const text = await file.text();
      const lines = text
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      if (lines.length < 2) {
        setError("File must contain at least a header row and one data row.");
        setLoading(false);
        return;
      }

      const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
      const rows = lines.slice(1).map((line) => {
        const values = line.split(",").map((v) => v.trim());
        const row: Record<string, string | null> = {};
        headers.forEach((h, i) => {
          row[h] = values[i] || null;
        });
        return row;
      });

      // Use the ACTIVE org (orgId ~ current_user_org_id()); the students RLS
      // WITH CHECK requires organization_id = current_user_org_id(), so using
      // profile.organization_id fails when switched into another school.
      const activeOrgId = orgId || profile?.organization_id || null;
      if (!activeOrgId) {
        setError("No active school context. Refresh or switch to a school and try again.");
        setLoading(false);
        return;
      }
      // Prepare data for bulk insert - INCLUDE org_id (active org)
      const studentsToInsert = rows.map((row) => ({
        organization_id: activeOrgId,
        student_code: (row.student_code || row.id || "").toUpperCase(),
        first_name: row.first_name || row.firstname || "",
        last_name: row.last_name || row.lastname || "",
        middle_name: row.middle_name || null,
        full_name: [
          row.last_name || row.lastname || "",
          row.first_name || row.firstname || "",
          row.middle_name || "",
        ]
          .filter(Boolean)
          .join(" "),
        grade: row.grade || row.class || null,
        gender: row.gender || null,
        status: row.status || "active",
        guardian_name: row.guardian_name || row.parent_name || null,
        guardian_phone: row.guardian_phone || row.phone || null,
        guardian_email: row.guardian_email || null,
        date_of_birth: row.date_of_birth || row.dob || null,
        admission_date: row.admission_date || null,
        academic_year: row.academic_year || null,
        address: row.address || null,
        notes: row.notes || null,
      }));

      // Bulk insert
      const { error: insertError, count } = await supabase
        .from("students")
        .insert(studentsToInsert);

      if (insertError) {
        setError(`Import failed: ${insertError.message}`);
      } else {
        setSuccess({ count: studentsToInsert.length });
        // Log activity
        await supabase.from("activity_log").insert({
          user_email: profile?.email,
          user_name: profile?.full_name,
          action: "Bulk Import Students",
          details: `Imported ${studentsToInsert.length} students`,
        });
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "An error occurred during import."
      );
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <Modal open onClose={onCloseAction} title="Import Complete" size="sm">
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 size={20} className="text-green-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-green-900">
                Successfully imported {success.count} students
              </p>
              <p className="text-sm text-green-700 mt-1">
                The data has been added to your student roster.
              </p>
            </div>
          </div>
          <div className="flex justify-end">
            <Button variant="gold" onClick={onCloseAction}>
              Done
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onCloseAction} title="Import Students" size="lg">
      <div className="space-y-4">
        {error && (
          <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-lg">
            <AlertCircle size={16} className="text-red-600 shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700">
            CSV or Excel File
          </label>
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
            <Upload size={24} className="mx-auto mb-2 text-gray-400" />
            <label className="inline-block">
              <span className="text-sm font-medium text-[#0F2A47] hover:underline cursor-pointer">
                Choose file
              </span>
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={handleFileUpload}
                disabled={loading}
                className="hidden"
              />
            </label>
            <p className="text-xs text-gray-500 mt-2">
              CSV or Excel with columns: student_code, first_name, last_name,
              grade, gender, status, guardian_name, guardian_phone
            </p>
          </div>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-2">
          <p className="text-xs text-blue-700">
            <strong>Tip:</strong> Use these column headers in your file:
            student_code, first_name, last_name, grade, gender, status,
            guardian_name, guardian_phone, guardian_email
          </p>
          <button
            type="button"
            onClick={downloadStudentImportTemplate}
            className="text-blue-700 hover:text-blue-900 underline text-xs flex items-center gap-1"
          >
            <Download size={11} /> Download CSV template
          </button>
        </div>

        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onCloseAction} disabled={loading}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}
