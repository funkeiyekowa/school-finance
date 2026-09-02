"use client";

/**
 * Printable welcome pack for a new student.
 *
 * Bundles into ONE PDF (three A4 pages with page breaks):
 *   1. Admission letter
 *   2. Fee schedule applicable to the student's grade
 *   3. Term-ahead school calendar
 *
 * Perfect to email or hand to a family at admission.
 */

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { useBranding } from "@/lib/hooks/useBranding";
import { fmtDate, fmtMoney } from "@/lib/utils";
import { LoadingSpinner } from "@/components/ui/PageHeader";
import { PrintableLetterhead, PrintableFooter } from "@/components/print/PrintableLetterhead";
import { Printer } from "lucide-react";

interface Student {
  id: string; student_code: string; full_name: string; grade: string | null;
  gender: string | null; admission_date: string | null; guardian_name: string | null;
  guardian_email: string | null; address: string | null;
}
interface Fee { id: string; name: string; amount: number; category: string | null; grade: string | null; term: string | null; }
interface Event { id: string; title: string; starts_at: string; location: string | null; category: string | null; all_day: boolean; }

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

export default function WelcomePackPage() {
  const params = useParams<{ id: string }>();
  const supabase = useMemo(() => createClient(), []);
  const { profile } = useAuth();
  const branding = useBranding();

  const [student, setStudent] = useState<Student | null>(null);
  const [fees, setFees] = useState<Fee[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: s } = await supabase.from("students").select("*").eq("id", params.id).maybeSingle();
      const stu = s as Student | null;
      setStudent(stu);
      if (!stu) { setLoading(false); return; }
      const [f, e] = await Promise.all([
        supabase.from("fee_schedules").select("id, name, amount, category, grade, term").eq("active", true),
        supabase.from("website_events").select("id, title, starts_at, location, category, all_day").neq("status", "cancelled").gte("starts_at", new Date().toISOString().slice(0, 10)).order("starts_at").limit(25),
      ]);
      setFees(((f.data as Fee[]) ?? []).filter(fee => !fee.grade || fee.grade === stu.grade));
      setEvents((e.data as Event[]) ?? []);
      setLoading(false);
    })();
  }, [supabase, params.id]);

  if (loading || !branding) return <div className="p-8"><LoadingSpinner /></div>;
  if (!student) return <div className="p-8 text-center text-gray-500">Student not found.</div>;

  const total = fees.reduce((s, f) => s + Number(f.amount), 0);
  const today = new Date();
  const letterDate = fmtDate(today.toISOString().slice(0, 10));

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      <div className="no-print sticky top-0 z-10 text-white px-6 py-3 flex items-center justify-between shadow-md" style={{ background: branding.primaryColor }}>
        <div>
          <p className="text-xs uppercase tracking-wider font-bold" style={{ color: branding.accentColor }}>Welcome Pack · {branding.schoolName}</p>
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
        {/* PAGE 1 — ADMISSION LETTER */}
        <div className="bg-white shadow-sm rounded-lg p-10 print:shadow-none print:rounded-none pack-page">
          <PrintableLetterhead
            branding={branding}
            eyebrow="Letter of Admission"
            accent="gold"
            right={
              <div>
                <p className="text-[10px] text-gray-500 uppercase font-bold">Reference</p>
                <p className="text-sm font-bold" style={{ color: branding.primaryColor }}>WPK/{student.student_code}</p>
                <p className="text-[11px] text-gray-500 mt-0.5">{letterDate}</p>
              </div>
            }
          />

          <p className="mb-3 font-semibold text-sm">Dear {student.guardian_name ?? "Parent/Guardian"},</p>

          <div className="text-sm leading-relaxed space-y-3">
            <p>
              On behalf of the Management of <strong>{branding.schoolName}</strong>, it is my pleasure to
              welcome your ward, <strong>{student.full_name}</strong> (Admission Number
              <strong> {student.student_code}</strong>), to our school{student.grade ? <>, joining <strong>{student.grade}</strong></> : ""}.
            </p>
            <p>
              This welcome pack contains everything you need for a smooth start: this letter of
              admission, the fee schedule that applies to your ward&apos;s class, and the school
              calendar of upcoming events.
            </p>
            <p className="mt-4">Yours faithfully,</p>
            <div className="mt-6">
              <p style={{ borderTop: `1px solid ${branding.primaryColor}`, width: "220px" }}></p>
              <p className="font-semibold text-sm mt-1" style={{ color: branding.primaryColor }}>{profile?.full_name ?? "The Principal"}</p>
              <p className="text-xs text-gray-500">{branding.schoolName}</p>
            </div>
          </div>
          <PrintableFooter branding={branding} />
        </div>

        {/* PAGE 2 — FEE SCHEDULE */}
        <div className="bg-white shadow-sm rounded-lg p-10 print:shadow-none print:rounded-none pack-page">
          <PrintableLetterhead
            branding={branding}
            eyebrow="Fee Schedule"
            accent="emerald"
            right={
              <div>
                <p className="text-[10px] text-gray-500 uppercase font-bold">Applies to</p>
                <p className="text-sm font-bold" style={{ color: branding.primaryColor }}>{student.grade ?? "All grades"}</p>
              </div>
            }
          />
          {fees.length === 0 ? (
            <p className="py-6 text-center text-gray-400 italic">No fee schedule configured for this grade yet — the school will contact you directly.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: branding.primaryColor, color: "#fff" }}>
                  <th className="text-left px-2 py-2">Item</th>
                  <th className="text-left px-2 py-2">Category</th>
                  <th className="text-left px-2 py-2">Term</th>
                  <th className="text-right px-2 py-2">Amount</th>
                </tr>
              </thead>
              <tbody>
                {fees.map(f => (
                  <tr key={f.id} className="border-b border-gray-100">
                    <td className="px-2 py-1.5">{f.name}</td>
                    <td className="px-2 py-1.5 text-gray-500">{f.category ?? "—"}</td>
                    <td className="px-2 py-1.5 text-gray-500">{f.term ?? "—"}</td>
                    <td className="px-2 py-1.5 text-right">{fmtMoney(f.amount)}</td>
                  </tr>
                ))}
                <tr style={{ background: branding.accentColor, color: branding.primaryColor }}>
                  <td colSpan={3} className="px-2 py-2 font-bold">TOTAL</td>
                  <td className="px-2 py-2 text-right font-bold">{fmtMoney(total)}</td>
                </tr>
              </tbody>
            </table>
          )}
          <PrintableFooter branding={branding} />
        </div>

        {/* PAGE 3 — CALENDAR */}
        <div className="bg-white shadow-sm rounded-lg p-10 print:shadow-none print:rounded-none pack-page">
          <PrintableLetterhead
            branding={branding}
            eyebrow="Upcoming Events"
            accent="navy"
          />
          {events.length === 0 ? (
            <p className="py-6 text-center text-gray-400 italic">No upcoming events on file yet — visit our website for the latest dates.</p>
          ) : (
            <div className="space-y-1">
              {events.map(e => {
                const d = new Date(e.starts_at);
                return (
                  <div key={e.id} className="flex items-start gap-3 p-2 border-b border-gray-100 text-sm">
                    <div className="text-center w-12 shrink-0">
                      <p className="text-[9px] text-gray-500 uppercase font-bold">{MONTHS[d.getMonth()].slice(0, 3)}</p>
                      <p className="text-lg font-bold leading-none" style={{ color: branding.primaryColor }}>{d.getDate()}</p>
                    </div>
                    <div>
                      <p className="font-semibold" style={{ color: branding.primaryColor }}>{e.title}</p>
                      <p className="text-[11px] text-gray-500">
                        {e.all_day ? "All day" : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                        {e.location ? ` · ${e.location}` : ""}
                        {e.category ? ` · ${e.category}` : ""}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <PrintableFooter branding={branding} />
        </div>
      </div>

      <style>{`
        @media print {
          .pack-page { page-break-after: always; }
          .pack-page:last-child { page-break-after: auto; }
          @page { size: A4; margin: 15mm; }
        }
      `}</style>
    </div>
  );
}
