
import { useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { Upload, Download, AlertTriangle, CheckCircle2, X } from "lucide-react";

// Column headers expected in the uploaded sheet. Keys map 1:1 to the
// students table columns; header matching below is case/space-insensitive
// so "Full Name", "full_name", "FULL NAME" all resolve the same way.
const FIELD_DEFS: { key: string; label: string; required: boolean; aliases: string[] }[] = [
  { key: "student_code", label: "Student ID", required: false, aliases: ["student id", "student code", "id", "code", "admission no", "admission number"] },
  { key: "last_name", label: "Last Name", required: true, aliases: ["last name", "lastname", "surname", "family name"] },
  { key: "first_name", label: "First Name", required: true, aliases: ["first name", "firstname", "given name"] },
  { key: "middle_name", label: "Middle Name", required: false, aliases: ["middle name", "middlename", "other name", "other names"] },
  { key: "full_name", label: "Full Name", required: false, aliases: ["full name", "name", "student name"] },
  { key: "grade", label: "Grade / Class", required: false, aliases: ["grade", "class", "grade/class", "grade / class"] },
  { key: "academic_year", label: "Academic Year", required: false, aliases: ["academic year", "year", "session"] },
  { key: "gender", label: "Gender", required: false, aliases: ["gender", "sex"] },
  { key: "date_of_birth", label: "Date of Birth", required: false, aliases: ["date of birth", "dob", "birth date"] },
  { key: "admission_date", label: "Admission Date", required: false, aliases: ["admission date", "date admitted", "enrollment date"] },
  { key: "address", label: "Address", required: false, aliases: ["address", "home address"] },
  { key: "guardian_name", label: "Guardian Name", required: false, aliases: ["guardian name", "parent name", "guardian/parent name"] },
  { key: "guardian_phone", label: "Guardian Phone", required: false, aliases: ["guardian phone", "parent phone", "phone", "phone number", "contact"] },
  { key: "guardian_email", label: "Guardian Email", required: false, aliases: ["guardian email", "parent email", "email"] },
  { key: "notes", label: "Notes", required: false, aliases: ["notes", "remarks", "comment"] },
];

type RawRow = Record<string, unknown>;
interface MappedRow {
  rowIndex: number;
  data: Record<string, string>;
  errors: string[];
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[_\-]/g, " ").replace(/\s+/g, " ");
}

function matchColumn(header: string): string | null {
  const norm = normalizeHeader(header);
  for (const def of FIELD_DEFS) {
    if (norm === def.key.replace(/_/g, " ") || def.aliases.includes(norm)) {
      return def.key;
    }
  }
  return null;
}

function excelDateToISO(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number") {
    // Excel serial date (days since 1899-12-30)
    const ms = Math.round((value - 25569) * 86400 * 1000);
    const d = new Date(ms);
    if (!isNaN(d.getTime())) return d.toISOString().substring(0, 10);
  }
  const str = String(value).trim();
  const d = new Date(str);
  if (!isNaN(d.getTime())) return d.toISOString().substring(0, 10);
  return str; // leave as-is, DB will reject if truly invalid
}

export function ImportStudentsModal({ onCloseAction }: { onCloseAction: () => void }) {
  const supabase = createClient();
  const { profile } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<"upload" | "preview" | "importing" | "done">("upload");
  const [fileName, setFileName] = useState("");
  const [rawHeaders, setRawHeaders] = useState<string[]>([]);
  const [mappedRows, setMappedRows] = useState<MappedRow[]>([]);
  const [unmatchedHeaders, setUnmatchedHeaders] = useState<string[]>([]);
  const [importResult, setImportResult] = useState<{ inserted: number; failed: number; errors: string[] }>({ inserted: 0, failed: 0, errors: [] });
  const [dragOver, setDragOver] = useState(false);

  function downloadTemplate() {
    const headers = FIELD_DEFS.map(f => f.label);
    const sample = [
      "STU-0100", "Jane Doe", "Grade 5", "2025/2026", "Female",
      "2015-03-14", "2021-09-01", "12 Allen Avenue, Ikeja",
      "John Doe", "+2348012345678", "john.doe@example.com", "",
    ];
    const csv = [headers.join(","), sample.map(v => `"${v}"`).join(",")].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "student_import_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleFile(file: File) {
    setFileName(file.name);
    const XLSX = await import("xlsx");
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array", cellDates: false });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows: RawRow[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    if (rows.length === 0) {
      setMappedRows([]);
      setStep("preview");
      return;
    }

    const headers = Object.keys(rows[0]);
    setRawHeaders(headers);

    const headerMap: Record<string, string> = {};
    const unmatched: string[] = [];
    headers.forEach(h => {
      const matched = matchColumn(h);
      if (matched) headerMap[h] = matched;
      else unmatched.push(h);
    });
    setUnmatchedHeaders(unmatched);

    const mapped: MappedRow[] = rows.map((row, i) => {
      const data: Record<string, string> = {};
      Object.entries(row).forEach(([h, v]) => {
        const key = headerMap[h];
        if (!key) return;
        if (key === "date_of_birth" || key === "admission_date") {
          data[key] = excelDateToISO(v);
        } else {
          data[key] = String(v ?? "").trim();
        }
      });

      const errors: string[] = [];
      if (!data.last_name && !data.full_name) errors.push("Missing last name");
      if (!data.first_name && !data.full_name) errors.push("Missing first name");

      // If they have full_name but not last/first, split it
      if (data.full_name && !data.last_name) {
        const parts = data.full_name.trim().split(/\s+/);
        data.last_name = parts[0] || "";
        data.first_name = parts[1] || "";
        data.middle_name = parts.slice(2).join(" ") || "";
      }

      // Generate full_name from parts
      if (data.last_name) {
        data.full_name = [data.last_name, data.first_name, data.middle_name].filter(Boolean).join(" ");
      }

      return { rowIndex: i + 2, data, errors }; // +2: header row + 1-index
    });

    setMappedRows(mapped);
    setStep("preview");
  }

  function onFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  const validRows = mappedRows.filter(r => r.errors.length === 0);
  const invalidRows = mappedRows.filter(r => r.errors.length > 0);

  async function runImport() {
    setStep("importing");

    // Generate random unique student codes for rows missing one
    const { data: existing } = await supabase.from("students").select("student_code");
    const existingCodes = new Set((existing ?? []).map(s => s.student_code));

    let inserted = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const row of validRows) {
      let code = row.data.student_code;
      if (!code) {
        // Generate S + 3 random digits, unique
        do {
          code = `S${String(Math.floor(Math.random() * 1000)).padStart(3, "0")}`;
        } while (existingCodes.has(code));
      } else if (existingCodes.has(code)) {
        // Avoid unique constraint collision — keep original but note it
        errors.push(`Row ${row.rowIndex}: Student ID "${code}" already exists, skipped`);
        failed++;
        continue;
      }
      existingCodes.add(code);

      const payload = {
        student_code: code,
        full_name: row.data.full_name || [row.data.last_name, row.data.first_name, row.data.middle_name].filter(Boolean).join(" "),
        last_name: row.data.last_name || null,
        first_name: row.data.first_name || null,
        middle_name: row.data.middle_name || null,
        grade: row.data.grade || null,
        academic_year: row.data.academic_year || null,
        gender: row.data.gender || null,
        date_of_birth: row.data.date_of_birth || null,
        admission_date: row.data.admission_date || null,
        address: row.data.address || null,
        guardian_name: row.data.guardian_name || null,
        guardian_phone: row.data.guardian_phone || null,
        guardian_email: row.data.guardian_email || null,
        notes: row.data.notes || null,
        status: "active",
      };

      const { error } = await supabase.from("students").insert(payload);
      if (error) {
        failed++;
        errors.push(`Row ${row.rowIndex} (${row.data.full_name}): ${error.message}`);
      } else {
        inserted++;
      }
    }

    await supabase.from("activity_log").insert({
      user_email: profile?.email, user_name: profile?.full_name,
      action: "Import Students", details: `${inserted} imported, ${failed} failed from ${fileName}`,
    });

    setImportResult({ inserted, failed, errors });
    setStep("done");
  }

  return (
    <Modal open onClose={onCloseAction} title="Import Students" size="xl">
      {step === "upload" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between bg-blue-50 border border-blue-100 rounded-lg p-3">
            <p className="text-sm text-blue-700">
              Upload an Excel (.xlsx) or CSV file with your student records.
            </p>
            <Button size="sm" variant="secondary" onClick={downloadTemplate}>
              <Download size={13} /> Download Template
            </Button>
          </div>

          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors",
              dragOver ? "border-[#C9A227] bg-[#FBF6E8]" : "border-gray-300 hover:border-gray-400"
            )}
          >
            <Upload size={32} className="mx-auto text-gray-400 mb-3" />
            <p className="text-sm font-medium text-gray-700">Click to browse or drag a file here</p>
            <p className="text-xs text-gray-400 mt-1">.xlsx, .xls, or .csv</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={onFileInputChange}
            />
          </div>

          <div className="text-xs text-gray-500">
            <p className="font-medium mb-1">Recognized columns (header names are flexible):</p>
            <div className="flex flex-wrap gap-1.5">
              {FIELD_DEFS.map(f => (
                <span key={f.key} className={cn(
                  "px-2 py-0.5 rounded-full border",
                  f.required ? "bg-red-50 border-red-200 text-red-700" : "bg-gray-50 border-gray-200 text-gray-600"
                )}>
                  {f.label}{f.required && " *"}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {step === "preview" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 text-sm">
              <span className="flex items-center gap-1.5 text-green-700 font-medium">
                <CheckCircle2 size={14} /> {validRows.length} ready to import
              </span>
              {invalidRows.length > 0 && (
                <span className="flex items-center gap-1.5 text-red-700 font-medium">
                  <AlertTriangle size={14} /> {invalidRows.length} with errors
                </span>
              )}
            </div>
            <button onClick={() => setStep("upload")} className="text-xs text-gray-400 hover:text-gray-600 underline">
              Choose different file
            </button>
          </div>

          {unmatchedHeaders.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700">
              <strong>Unrecognized columns (ignored):</strong> {unmatchedHeaders.join(", ")}
            </div>
          )}

          <div className="border border-gray-200 rounded-lg overflow-hidden max-h-80 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-[#0F2A47] text-white">
                <tr>
                  <th className="text-left px-3 py-2">Row</th>
                  <th className="text-left px-3 py-2">Student ID</th>
                  <th className="text-left px-3 py-2">Full Name</th>
                  <th className="text-left px-3 py-2">Grade</th>
                  <th className="text-left px-3 py-2">Guardian</th>
                  <th className="text-left px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {mappedRows.map(row => (
                  <tr key={row.rowIndex} className={cn("border-b border-gray-50", row.errors.length > 0 && "bg-red-50")}>
                    <td className="px-3 py-2 text-gray-400">{row.rowIndex}</td>
                    <td className="px-3 py-2 font-mono">{row.data.student_code || <span className="text-gray-400">auto</span>}</td>
                    <td className="px-3 py-2 font-medium">{row.data.full_name || "—"}</td>
                    <td className="px-3 py-2">{row.data.grade || "—"}</td>
                    <td className="px-3 py-2">{row.data.guardian_name || "—"}</td>
                    <td className="px-3 py-2">
                      {row.errors.length > 0
                        ? <span className="text-red-600">{row.errors.join(", ")}</span>
                        : <span className="text-green-600">OK</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={onCloseAction}>Cancel</Button>
            <Button variant="gold" disabled={validRows.length === 0} onClick={runImport}>
              Import {validRows.length} Student{validRows.length !== 1 ? "s" : ""}
            </Button>
          </div>
        </div>
      )}

      {step === "importing" && (
        <div className="py-12 text-center">
          <div className="w-8 h-8 border-4 border-[#F4E9C7] border-t-[#C9A227] rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm text-gray-500">Importing students…</p>
        </div>
      )}

      {step === "done" && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-lg p-4">
            <CheckCircle2 size={20} className="text-green-600 shrink-0" />
            <div>
              <p className="font-semibold text-green-800">{importResult.inserted} students imported successfully</p>
              {importResult.failed > 0 && <p className="text-sm text-red-600 mt-0.5">{importResult.failed} rows failed</p>}
            </div>
          </div>
          {importResult.errors.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 max-h-40 overflow-y-auto">
              <ul className="text-xs text-red-700 space-y-1">
                {importResult.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}
          <div className="flex justify-end">
            <Button variant="gold" onClick={onCloseAction}>Done</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
