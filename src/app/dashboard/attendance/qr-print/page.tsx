"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Printer, ArrowLeft } from "lucide-react";
import Link from "next/link";
import QRCode from "react-qr-code";

interface ClassRow { id: string; name: string; short_code: string; sequence: number; organization_id: string; }
interface StudentRow { id: string; student_code: string; full_name: string; grade: string | null; }

export default function QRPrintPage() {
  const { orgId, user, membership } = useAuth();
  const supabase = createClient();

  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [selectedClassId, setSelectedClassId] = useState("");
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  // Load classes (with teacher scoping matching main attendance page)
  const loadClasses = useCallback(async () => {
    setLoading(true);
    const { data: clsData } = await supabase
      .from("classes")
      .select("id, name, short_code, sequence, organization_id")
      .eq("active", true)
      .order("sequence");

    let allClasses = (clsData as ClassRow[]) ?? [];

    const role = membership?.role ?? "";
    if (role === "teacher" && user) {
      const { data: ta } = await supabase
        .from("teacher_assignments")
        .select("class_id")
        .eq("user_id", user.id)
        .eq("active", true);
      const myClassIds = new Set((ta ?? []).map((r: { class_id: string }) => r.class_id));
      allClasses = allClasses.filter(c => myClassIds.has(c.id));
    }

    setClasses(allClasses);
    setLoading(false);
  }, [supabase, user, membership]);

  useEffect(() => { loadClasses(); }, [loadClasses]);

  // Load students when class changes
  useEffect(() => {
    if (!selectedClassId) { setStudents([]); return; }
    const cls = classes.find(c => c.id === selectedClassId);
    if (!cls) return;

    setLoadingStudents(true);
    supabase
      .from("students")
      .select("id, student_code, full_name, grade")
      .eq("status", "active")
      .eq("organization_id", cls.organization_id)
      .or(`grade.eq.${cls.name},grade.eq.${cls.short_code}`)
      .order("full_name")
      .then(({ data }) => {
        setStudents((data as StudentRow[]) ?? []);
        setLoadingStudents(false);
      });
  }, [selectedClassId, classes, supabase]);

  const selectedClass = classes.find(c => c.id === selectedClassId);

  function handlePrint() {
    window.print();
  }

  if (loading) return (
    <div className="p-8 text-center text-gray-400 text-sm">Loading classes…</div>
  );

  return (
    <div className="space-y-6">
      {/* Hide nav/controls during print */}
      <style>{`@media print { .no-print { display: none !important; } body { margin: 0; } }`}</style>

      <div className="no-print">
        <PageHeader
          title="QR Code Print"
          subtitle="Print student QR codes for attendance scanning"
          icon={<Printer size={20} />}
        />
      </div>

      {/* Controls */}
      <div className="no-print flex items-center gap-3 flex-wrap">
        <Link href="/dashboard/attendance">
          <Button variant="ghost" size="sm">
            <ArrowLeft size={14} /> Back to Attendance
          </Button>
        </Link>

        <select
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
          value={selectedClassId}
          onChange={e => setSelectedClassId(e.target.value)}
        >
          <option value="">— Select a class —</option>
          {classes.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        {selectedClassId && students.length > 0 && (
          <Button variant="gold" size="sm" onClick={handlePrint}>
            <Printer size={14} /> Print QR Codes
          </Button>
        )}
      </div>

      {/* QR Grid */}
      {loadingStudents && (
        <div className="text-center py-12 text-gray-400 text-sm no-print">Loading students…</div>
      )}

      {!loadingStudents && selectedClassId && students.length === 0 && (
        <div className="text-center py-12 text-gray-400 text-sm no-print">
          No active students found for this class.
        </div>
      )}

      {!loadingStudents && students.length > 0 && (
        <div ref={printRef}>
          {/* Print header */}
          <div className="hidden print:block mb-4 text-center">
            <h1 className="text-xl font-bold">{selectedClass?.name} — Student QR Codes</h1>
          </div>

          <div
            className="grid gap-4"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}
          >
            {students.map(stu => (
              <Card key={stu.id} className="text-center p-4 break-inside-avoid">
                <CardContent className="flex flex-col items-center gap-2 pt-2">
                  <div className="bg-white p-2 rounded border border-gray-100">
                    <QRCode
                      value={JSON.stringify({ student_id: stu.id, code: stu.student_code })}
                      size={120}
                      level="M"
                    />
                  </div>
                  <div className="text-sm font-semibold text-gray-800 leading-tight text-center">
                    {stu.full_name}
                  </div>
                  <div className="text-[10px] font-mono text-gray-400">{stu.student_code}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {!selectedClassId && (
        <div className="text-center py-12 text-gray-400 text-sm no-print">
          Select a class above to generate QR codes.
        </div>
      )}
    </div>
  );
}
