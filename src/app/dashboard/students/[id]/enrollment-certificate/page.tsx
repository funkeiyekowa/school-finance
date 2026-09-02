"use client";

/**
 * Printable enrollment / continuation certificate.
 *
 * Formal proof-of-enrollment letter on the school letterhead —
 * commonly requested for visa applications, guardianship changes,
 * or scholarship applications.
 */

import { useEffect, useState, useMemo } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { useBranding } from "@/lib/hooks/useBranding";
import { fmtDate } from "@/lib/utils";
import { LoadingSpinner } from "@/components/ui/PageHeader";
import { PrintableLetterhead, PrintableFooter } from "@/components/print/PrintableLetterhead";
import { Printer } from "lucide-react";

interface Student {
  id: string; student_code: string; full_name: string;
  grade: string | null; gender: string | null; date_of_birth: string | null;
  admission_date: string | null; academic_year: string | null;
  guardian_name: string | null; address: string | null;
}

export default function EnrollmentCertificatePage() {
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
  const admDate = student.admission_date ? fmtDate(student.admission_date) : "—";
  const pronoun = student.gender === "female" ? "she" : student.gender === "male" ? "he" : "the student";
  const possessive = student.gender === "female" ? "her" : student.gender === "male" ? "his" : "their";
  const objectPr = student.gender === "female" ? "her" : student.gender === "male" ? "him" : "them";

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      <div className="no-print sticky top-0 z-10 text-white px-6 py-3 flex items-center justify-between shadow-md" style={{ background: branding.primaryColor }}>
        <div>
          <p className="text-xs uppercase tracking-wider font-bold" style={{ color: branding.accentColor }}>Enrolment Certificate · {branding.schoolName}</p>
          <p className="text-sm font-medium">{student.full_name}</p>
        </div>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold hover:opacity-90"
          style={{ background: branding.accentColor, color: branding.primaryColor }}
        >
          <Printer size={14} /> Print / Save as PDF
        </button>
      </div>

      <div className="max-w-3xl mx-auto py-6 print:py-0 print:max-w-full">
        <div className="bg-white shadow-sm rounded-lg p-10 print:shadow-none print:rounded-none">
          <PrintableLetterhead
            branding={branding}
            eyebrow="Certificate of Enrolment"
            accent="emerald"
            right={
              <div>
                <p className="text-[10px] text-gray-500 uppercase font-bold">Reference</p>
                <p className="text-sm font-bold" style={{ color: branding.primaryColor }}>ENR/{student.student_code}</p>
                <p className="text-[11px] text-gray-500 mt-0.5">{letterDate}</p>
              </div>
            }
          />

          <div className="mb-6 text-sm">
            <p className="font-semibold">To Whom It May Concern,</p>
          </div>

          <h3 className="text-base font-bold uppercase tracking-wide mb-3" style={{ color: branding.primaryColor }}>
            Confirmation of Enrolment
          </h3>

          <div className="text-sm leading-relaxed space-y-4">
            <p>
              This is to certify that <strong>{student.full_name}</strong> (Admission Number
              <strong> {student.student_code}</strong>) is a bona-fide student of
              <strong> {branding.schoolName}</strong>{student.grade ? <>, currently in <strong>{student.grade}</strong></> : ""}
              {student.academic_year ? <> for the <strong>{student.academic_year}</strong> academic session</> : ""}.
            </p>

            <div className="rounded-lg p-4 grid grid-cols-2 gap-x-6 gap-y-2 text-xs" style={{ background: "#F0FDF4", border: `1px solid ${branding.primaryColor}` }}>
              <div>
                <p className="text-[10px] uppercase font-bold text-emerald-700">Admission date</p>
                <p className="font-semibold">{admDate}</p>
              </div>
              {student.date_of_birth && (
                <div>
                  <p className="text-[10px] uppercase font-bold text-emerald-700">Date of birth</p>
                  <p className="font-semibold">{fmtDate(student.date_of_birth)}</p>
                </div>
              )}
              {student.grade && (
                <div>
                  <p className="text-[10px] uppercase font-bold text-emerald-700">Class</p>
                  <p className="font-semibold">{student.grade}</p>
                </div>
              )}
              {student.gender && (
                <div>
                  <p className="text-[10px] uppercase font-bold text-emerald-700">Gender</p>
                  <p className="font-semibold capitalize">{student.gender}</p>
                </div>
              )}
              {student.guardian_name && (
                <div className="col-span-2">
                  <p className="text-[10px] uppercase font-bold text-emerald-700">Parent / Guardian</p>
                  <p className="font-semibold">{student.guardian_name}</p>
                </div>
              )}
            </div>

            <p>
              {pronoun.charAt(0).toUpperCase() + pronoun.slice(1)} is in good standing with this
              institution and has been regularly attending classes since the date stated above.
              This certificate is issued at the request of {possessive} parent / guardian and is
              valid for all official purposes.
            </p>

            <p>
              Should you require any further information regarding {objectPr}, please do not
              hesitate to contact the school office.
            </p>

            <p className="mt-6">Yours faithfully,</p>

            <div className="mt-10">
              <p style={{ borderTop: `1px solid ${branding.primaryColor}`, width: "220px" }}></p>
              <p className="font-semibold text-sm mt-1" style={{ color: branding.primaryColor }}>
                {profile?.full_name ?? "The Principal"}
              </p>
              <p className="text-xs text-gray-500">{branding.schoolName}</p>
              <p className="text-xs text-gray-500 mt-4">Official school seal</p>
              <p className="text-[10px] text-gray-400">(This certificate is not valid without the school stamp.)</p>
            </div>
          </div>

          <PrintableFooter branding={branding} />
        </div>
      </div>

      <style>{`
        @media print { @page { size: A4; margin: 20mm; } }
      `}</style>
    </div>
  );
}
