"use client";

/**
 * Printable admission letter for a single student.
 *
 * Uses the school's branding (logo, name, address) plus the student's
 * details (name, admission number, grade, admission date, guardian) to
 * produce a formal letter on the school's letterhead. One click prints
 * or saves to PDF.
 */

import { useEffect, useState, useMemo } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useBranding } from "@/lib/hooks/useBranding";
import { useAuth } from "@/lib/context/AuthContext";
import { fmtDate } from "@/lib/utils";
import { LoadingSpinner } from "@/components/ui/PageHeader";
import { PrintableLetterhead, PrintableFooter } from "@/components/print/PrintableLetterhead";
import { Printer } from "lucide-react";

interface Student {
  id: string; student_code: string; full_name: string; grade: string | null;
  gender: string | null; date_of_birth: string | null; admission_date: string | null;
  guardian_name: string | null; guardian_phone: string | null;
  guardian_email: string | null; address: string | null;
}

export default function AdmissionLetterPage() {
  const params = useParams<{ id: string }>();
  const supabase = useMemo(() => createClient(), []);
  const { profile } = useAuth();
  const branding = useBranding();
  const [student, setStudent] = useState<Student | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("students").select("*").eq("id", params.id).maybeSingle();
      setStudent((data as Student) ?? null);
      setLoading(false);
    })();
  }, [supabase, params.id]);

  if (loading || !branding) return <div className="p-8"><LoadingSpinner /></div>;
  if (!student) return <div className="p-8 text-center text-gray-500">Student not found.</div>;

  const today = new Date();
  const letterDate = fmtDate(today.toISOString().slice(0, 10));
  const admissionDate = student.admission_date ? fmtDate(student.admission_date) : letterDate;
  const guardianSalutation = student.guardian_name
    ? `Dear ${student.guardian_name}`
    : "Dear Parent/Guardian";
  const pronoun = student.gender === "female" ? "her" : student.gender === "male" ? "his" : "their";

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      <div className="no-print sticky top-0 z-10 text-white px-6 py-3 flex items-center justify-between shadow-md" style={{ background: branding.primaryColor }}>
        <div>
          <p className="text-xs uppercase tracking-wider font-bold" style={{ color: branding.accentColor }}>Admission Letter · {branding.schoolName}</p>
          <p className="text-sm font-medium">{student.full_name} — {student.student_code}</p>
        </div>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold hover:opacity-90 transition-opacity"
          style={{ background: branding.accentColor, color: branding.primaryColor }}
        >
          <Printer size={14} /> Print / Save as PDF
        </button>
      </div>

      <div className="max-w-3xl mx-auto py-6 print:py-0 print:max-w-full">
        <div className="bg-white shadow-sm rounded-lg p-10 print:shadow-none print:rounded-none print:p-0 print:mx-6">
          <PrintableLetterhead
            branding={branding}
            eyebrow="Letter of Admission"
            accent="gold"
            right={
              <div>
                <p className="text-[10px] text-gray-500 uppercase font-bold">Reference</p>
                <p className="text-sm font-bold" style={{ color: branding.primaryColor }}>ADM/{student.student_code}</p>
                <p className="text-[11px] text-gray-500 mt-0.5">{letterDate}</p>
              </div>
            }
          />

          {/* Addressee */}
          <div className="mb-6 text-sm">
            <p className="font-semibold">{guardianSalutation},</p>
            {student.address && <p className="text-xs text-gray-500 mt-1">{student.address}</p>}
          </div>

          {/* Body */}
          <div className="space-y-4 text-sm leading-relaxed">
            <h3 className="text-base font-bold uppercase tracking-wide" style={{ color: branding.primaryColor }}>
              Provisional Offer of Admission
            </h3>

            <p>
              On behalf of the Management of <strong>{branding.schoolName}</strong>, it is my great
              pleasure to formally offer your ward,
              <strong> {student.full_name}</strong>, a place in our school for the current academic
              session.
            </p>

            <div className="rounded-lg p-4" style={{ background: "#FEFAEF", border: `1px solid ${branding.accentColor}` }}>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
                <div>
                  <p className="text-[10px] uppercase font-bold" style={{ color: branding.accentColor }}>Student</p>
                  <p className="font-semibold">{student.full_name}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold" style={{ color: branding.accentColor }}>Admission number</p>
                  <p className="font-semibold">{student.student_code}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold" style={{ color: branding.accentColor }}>Class / grade</p>
                  <p className="font-semibold">{student.grade ?? "—"}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold" style={{ color: branding.accentColor }}>Admission date</p>
                  <p className="font-semibold">{admissionDate}</p>
                </div>
                {student.date_of_birth && (
                  <div>
                    <p className="text-[10px] uppercase font-bold" style={{ color: branding.accentColor }}>Date of birth</p>
                    <p className="font-semibold">{fmtDate(student.date_of_birth)}</p>
                  </div>
                )}
                {student.gender && (
                  <div>
                    <p className="text-[10px] uppercase font-bold" style={{ color: branding.accentColor }}>Gender</p>
                    <p className="font-semibold capitalize">{student.gender}</p>
                  </div>
                )}
              </div>
            </div>

            <p>
              This admission is offered subject to your ward abiding by the rules and regulations
              of {branding.schoolName}, and to the terms of payment communicated separately. Kindly
              acknowledge acceptance of this offer at your earliest convenience.
            </p>

            <p>
              We look forward to welcoming {student.full_name.split(" ")[0]} to our community, and to
              partnering with you in ensuring {pronoun} academic and personal growth throughout {pronoun} time
              with us.
            </p>

            <p className="mt-6">Yours faithfully,</p>

            <div className="mt-10">
              <p style={{ borderTop: `1px solid ${branding.primaryColor}`, width: "220px" }}></p>
              <p className="font-semibold text-sm mt-1" style={{ color: branding.primaryColor }}>
                {profile?.full_name ?? "The Principal"}
              </p>
              <p className="text-xs text-gray-500">{branding.schoolName}</p>
            </div>
          </div>

          <PrintableFooter branding={branding} />
        </div>
      </div>

      <style>{`
        @media print {
          @page { size: A4; margin: 20mm; }
        }
      `}</style>
    </div>
  );
}
