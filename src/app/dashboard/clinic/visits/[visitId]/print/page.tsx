"use client";

/**
 * Printable clinic visit summary.
 *
 * Renders a single visit as a formatted medical summary sheet the nurse
 * can hand to the parent or attach to a paper chart. The visit + its
 * dispensed medications + linked patient chart come from the same
 * tenant-scoped tables the dashboard reads; the print stylesheet
 * squeezes it onto a single A4 page.
 */

import { useEffect, useState, useMemo } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useBranding } from "@/lib/hooks/useBranding";
import { fmtDate } from "@/lib/utils";
import { LoadingSpinner } from "@/components/ui/PageHeader";
import { PrintableLetterhead, PrintableFooter } from "@/components/print/PrintableLetterhead";
import { Printer } from "lucide-react";

interface VisitRow {
  id: string; visit_code: string; subject_type: string; student_id: string | null; staff_id: string | null;
  visit_date: string; chief_complaint: string;
  temperature_c: number | null; blood_pressure: string | null; pulse_bpm: number | null;
  diagnosis: string | null; treatment_given: string | null; outcome: string;
  referred_to: string | null; parent_notified: boolean;
  attended_by_staff_id: string | null; notes: string | null;
}
interface DispensedRow {
  id: string; medication_name: string; dosage: string | null; quantity_dispensed: number;
}
interface StudentRow {
  id: string; first_name: string | null; last_name: string | null; admission_number: string | null;
  date_of_birth: string | null; class_id: string | null;
}
interface StaffRow {
  id: string; first_name: string | null; last_name: string | null; staff_code: string | null;
}
interface PatientRow {
  id: string; subject_type: string; student_id: string | null; staff_id: string | null;
  blood_group: string | null; allergies: string | null; chronic_conditions: string | null;
  emergency_contact_name: string | null; emergency_contact_phone: string | null;
}

export default function ClinicVisitPrintPage() {
  const params = useParams<{ visitId: string }>();
  const visitId = params.visitId;
  const supabase = useMemo(() => createClient(), []);
  const branding = useBranding();

  const [loading, setLoading] = useState(true);
  const [visit, setVisit] = useState<VisitRow | null>(null);
  const [dispensed, setDispensed] = useState<DispensedRow[]>([]);
  const [subject, setSubject] = useState<StudentRow | StaffRow | null>(null);
  const [patient, setPatient] = useState<PatientRow | null>(null);
  const [attendedBy, setAttendedBy] = useState<StaffRow | null>(null);

  useEffect(() => {
    (async () => {
      const { data: vd } = await supabase.from("clinic_visits").select("*").eq("id", visitId).maybeSingle();
      const v = vd as VisitRow | null;
      setVisit(v);
      if (!v) { setLoading(false); return; }

      const { data: dd } = await supabase.from("clinic_dispensed_medications").select("*").eq("visit_id", visitId);
      setDispensed((dd as DispensedRow[]) ?? []);

      // Subject: student or staff
      if (v.student_id) {
        const { data } = await supabase.from("students").select("id, first_name, last_name, admission_number, date_of_birth, class_id").eq("id", v.student_id).maybeSingle();
        setSubject(data as StudentRow ?? null);
        // patient record via student_id
        const { data: p } = await supabase.from("clinic_patient_records").select("*").eq("student_id", v.student_id).maybeSingle();
        setPatient(p as PatientRow ?? null);
      } else if (v.staff_id) {
        const { data } = await supabase.from("staff").select("id, first_name, last_name, staff_code").eq("id", v.staff_id).maybeSingle();
        setSubject(data as StaffRow ?? null);
        const { data: p } = await supabase.from("clinic_patient_records").select("*").eq("staff_id", v.staff_id).maybeSingle();
        setPatient(p as PatientRow ?? null);
      }

      if (v.attended_by_staff_id) {
        const { data } = await supabase.from("staff").select("id, first_name, last_name, staff_code").eq("id", v.attended_by_staff_id).maybeSingle();
        setAttendedBy(data as StaffRow ?? null);
      }

      setLoading(false);
    })();
  }, [supabase, visitId]);

  if (loading || !branding) return <div className="p-8"><LoadingSpinner /></div>;
  if (!visit) return <div className="p-8 text-center text-gray-500">Visit not found.</div>;

  const subjectName = subject ? `${(subject as StudentRow | StaffRow).first_name ?? ""} ${(subject as StudentRow | StaffRow).last_name ?? ""}`.trim() : "Unknown";
  const subjectCode = subject
    ? ("admission_number" in subject ? subject.admission_number : (subject as StaffRow).staff_code) ?? ""
    : "";
  const attName = attendedBy ? `${attendedBy.first_name ?? ""} ${attendedBy.last_name ?? ""}`.trim() : "";

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      <div className="no-print sticky top-0 z-10 bg-[#0F2A47] text-white px-6 py-3 flex items-center justify-between shadow-md">
        <div>
          <p className="text-xs uppercase tracking-wider text-[#C9A227] font-bold">Clinic Visit Summary</p>
          <p className="text-sm font-medium">Visit {visit.visit_code} — {branding.schoolName}</p>
        </div>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 bg-[#C9A227] text-[#0F2A47] px-4 py-2 rounded-lg text-sm font-bold hover:bg-[#e6bf39] transition-colors"
        >
          <Printer size={14} /> Print / Save as PDF
        </button>
      </div>

      <div className="max-w-3xl mx-auto py-6 print:py-0 print:max-w-full">
        <div className="bg-white shadow-sm rounded-lg p-8 print:shadow-none print:rounded-none">
          <PrintableLetterhead
            branding={branding}
            eyebrow="Clinic Visit Summary"
            accent="emerald"
            right={
              <div>
                <p className="text-[10px] text-gray-500 uppercase font-bold">Visit code</p>
                <p className="text-sm font-bold" style={{ color: branding.primaryColor }}>{visit.visit_code}</p>
                <p className="text-xs text-gray-500">{fmtDate(visit.visit_date)}</p>
              </div>
            }
          />

          {/* Patient block */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 mb-4 text-sm">
            <div>
              <p className="text-[10px] text-gray-500 uppercase font-bold">Patient</p>
              <p className="font-semibold text-[#0F2A47]">{subjectName}</p>
              <p className="text-xs text-gray-500 capitalize">{visit.subject_type}{subjectCode ? ` · ${subjectCode}` : ""}</p>
            </div>
            <div>
              <p className="text-[10px] text-gray-500 uppercase font-bold">Attended by</p>
              <p className="font-medium">{attName || "—"}</p>
            </div>
            {patient?.blood_group && (
              <div>
                <p className="text-[10px] text-gray-500 uppercase font-bold">Blood group</p>
                <p className="font-medium">{patient.blood_group}</p>
              </div>
            )}
            {patient?.allergies && (
              <div>
                <p className="text-[10px] text-red-600 uppercase font-bold">Allergies</p>
                <p className="text-xs text-red-700 font-medium">{patient.allergies}</p>
              </div>
            )}
            {patient?.chronic_conditions && (
              <div className="col-span-2">
                <p className="text-[10px] text-amber-700 uppercase font-bold">Chronic conditions</p>
                <p className="text-xs text-amber-800">{patient.chronic_conditions}</p>
              </div>
            )}
          </div>

          {/* Vitals */}
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 mb-4">
            <p className="text-[10px] text-gray-500 uppercase font-bold mb-2">Vitals</p>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <p className="text-[10px] text-gray-500">Temp (°C)</p>
                <p className="font-semibold">{visit.temperature_c ?? "—"}</p>
              </div>
              <div>
                <p className="text-[10px] text-gray-500">BP (mmHg)</p>
                <p className="font-semibold">{visit.blood_pressure ?? "—"}</p>
              </div>
              <div>
                <p className="text-[10px] text-gray-500">Pulse (bpm)</p>
                <p className="font-semibold">{visit.pulse_bpm ?? "—"}</p>
              </div>
            </div>
          </div>

          {/* Clinical */}
          <div className="space-y-3 mb-4 text-sm">
            <div>
              <p className="text-[10px] text-gray-500 uppercase font-bold">Chief complaint</p>
              <p className="whitespace-pre-wrap">{visit.chief_complaint || "—"}</p>
            </div>
            {visit.diagnosis && (
              <div>
                <p className="text-[10px] text-gray-500 uppercase font-bold">Diagnosis</p>
                <p className="whitespace-pre-wrap">{visit.diagnosis}</p>
              </div>
            )}
            {visit.treatment_given && (
              <div>
                <p className="text-[10px] text-gray-500 uppercase font-bold">Treatment given</p>
                <p className="whitespace-pre-wrap">{visit.treatment_given}</p>
              </div>
            )}
          </div>

          {/* Dispensed meds */}
          {dispensed.length > 0 && (
            <div className="mb-4">
              <p className="text-[10px] text-gray-500 uppercase font-bold mb-1">Dispensed medications</p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-1 font-semibold">Medication</th>
                    <th className="text-left py-1 font-semibold">Dosage</th>
                    <th className="text-right py-1 font-semibold">Quantity</th>
                  </tr>
                </thead>
                <tbody>
                  {dispensed.map((d) => (
                    <tr key={d.id} className="border-b border-gray-100">
                      <td className="py-1">{d.medication_name}</td>
                      <td className="py-1">{d.dosage ?? "—"}</td>
                      <td className="py-1 text-right">{d.quantity_dispensed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Outcome */}
          <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
            <div>
              <p className="text-[10px] text-gray-500 uppercase font-bold">Outcome</p>
              <p className="font-medium capitalize">{visit.outcome.replace(/_/g, " ")}</p>
            </div>
            {visit.referred_to && (
              <div>
                <p className="text-[10px] text-gray-500 uppercase font-bold">Referred to</p>
                <p className="font-medium">{visit.referred_to}</p>
              </div>
            )}
            <div>
              <p className="text-[10px] text-gray-500 uppercase font-bold">Parent notified</p>
              <p className="font-medium">{visit.parent_notified ? "Yes" : "No"}</p>
            </div>
            {patient?.emergency_contact_name && (
              <div>
                <p className="text-[10px] text-gray-500 uppercase font-bold">Emergency contact</p>
                <p className="text-xs">{patient.emergency_contact_name}{patient.emergency_contact_phone ? ` · ${patient.emergency_contact_phone}` : ""}</p>
              </div>
            )}
          </div>

          {visit.notes && (
            <div className="mb-4 text-sm">
              <p className="text-[10px] text-gray-500 uppercase font-bold">Notes</p>
              <p className="whitespace-pre-wrap text-xs">{visit.notes}</p>
            </div>
          )}

          {/* Footer */}
          <div className="pt-4 mt-6 border-t border-gray-200 grid grid-cols-2 gap-6 text-[10px] text-gray-500">
            <div>
              <p>_______________________________</p>
              <p>Attending Nurse&apos;s Signature</p>
            </div>
            <div className="text-right">
              <p>_______________________________</p>
              <p>Parent / Guardian Acknowledgement</p>
            </div>
          </div>
          <PrintableFooter branding={branding} />
        </div>
      </div>

      <style>{`
        @media print {
          @page { size: A4; margin: 15mm; }
        }
      `}</style>
    </div>
  );
}
