"use client";

/**
 * Printable staff directory.
 *
 * Every active staff member with role, contact info, department,
 * and joined date — on the school letterhead. Useful for the
 * termly staff meeting handout or the front-office phone list.
 */

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { useBranding } from "@/lib/hooks/useBranding";
import { fmtDate } from "@/lib/utils";
import { LoadingSpinner } from "@/components/ui/PageHeader";
import { PrintableLetterhead, PrintableFooter } from "@/components/print/PrintableLetterhead";
import { Printer } from "lucide-react";

interface Staff {
  id: string; staff_code: string; full_name: string;
  job_title: string | null; email: string | null; phone: string | null;
  staff_type: string; department_id: string | null; date_joined: string | null;
}
interface Dept { id: string; name: string; }

export default function StaffDirectoryPage() {
  const supabase = useMemo(() => createClient(), []);
  const { orgId } = useAuth();
  const branding = useBranding();
  const [staff, setStaff] = useState<Staff[]>([]);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId) return;
    (async () => {
      const [s, d] = await Promise.all([
        supabase.from("staff_members")
          .select("id, staff_code, full_name, job_title, email, phone, staff_type, department_id, date_joined")
          .eq("status", "active").order("full_name"),
        supabase.from("departments").select("id, name"),
      ]);
      setStaff((s.data as Staff[]) ?? []);
      setDepts((d.data as Dept[]) ?? []);
      setLoading(false);
    })();
  }, [supabase, orgId]);

  if (loading || !branding) return <div className="p-8"><LoadingSpinner /></div>;

  const deptById = new Map(depts.map(d => [d.id, d]));
  // Group by department for a cleaner directory
  const groups: { dept: string; rows: Staff[] }[] = [];
  for (const s of staff) {
    const dept = s.department_id ? deptById.get(s.department_id)?.name ?? "Other" : "Other";
    const g = groups.find(x => x.dept === dept);
    if (g) g.rows.push(s); else groups.push({ dept, rows: [s] });
  }
  groups.sort((a, b) => a.dept.localeCompare(b.dept));

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      <div className="no-print sticky top-0 z-10 text-white px-6 py-3 flex items-center justify-between shadow-md" style={{ background: branding.primaryColor }}>
        <div>
          <p className="text-xs uppercase tracking-wider font-bold" style={{ color: branding.accentColor }}>Staff Directory · {branding.schoolName}</p>
          <p className="text-sm font-medium">{staff.length} active staff · {groups.length} department{groups.length === 1 ? "" : "s"}</p>
        </div>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold hover:opacity-90"
          style={{ background: branding.accentColor, color: branding.primaryColor }}
        >
          <Printer size={14} /> Print / Save as PDF
        </button>
      </div>

      <div className="max-w-4xl mx-auto py-6 print:py-0 print:max-w-full">
        <div className="bg-white shadow-sm rounded-lg p-8 print:shadow-none print:rounded-none">
          <PrintableLetterhead
            branding={branding}
            eyebrow="Staff Directory"
            accent="navy"
            right={
              <div>
                <p className="text-[10px] text-gray-500 uppercase font-bold">Printed</p>
                <p className="text-sm font-bold" style={{ color: branding.primaryColor }}>{fmtDate(new Date().toISOString().slice(0, 10))}</p>
              </div>
            }
          />

          {groups.map(g => (
            <section key={g.dept} className="mb-4">
              <h3 className="text-xs uppercase font-bold tracking-widest mb-1" style={{ color: branding.accentColor }}>{g.dept}</h3>
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr style={{ background: branding.primaryColor, color: "#fff" }}>
                    <th className="text-left px-2 py-1.5 border w-24">Code</th>
                    <th className="text-left px-2 py-1.5 border">Name</th>
                    <th className="text-left px-2 py-1.5 border">Role</th>
                    <th className="text-left px-2 py-1.5 border w-32">Phone</th>
                    <th className="text-left px-2 py-1.5 border">Email</th>
                    <th className="text-left px-2 py-1.5 border w-24">Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map(s => (
                    <tr key={s.id}>
                      <td className="border px-2 py-1 font-mono text-gray-500">{s.staff_code}</td>
                      <td className="border px-2 py-1 font-medium">{s.full_name}</td>
                      <td className="border px-2 py-1">{s.job_title ?? "—"}</td>
                      <td className="border px-2 py-1">{s.phone ?? "—"}</td>
                      <td className="border px-2 py-1 text-gray-500">{s.email ?? "—"}</td>
                      <td className="border px-2 py-1 text-gray-500">{s.date_joined ? fmtDate(s.date_joined) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}

          <div className="mt-6 grid grid-cols-2 gap-8 text-[10px] text-gray-500">
            <div><p style={{ borderTop: `1px solid ${branding.primaryColor}` }}></p><p className="mt-1">Head of School</p></div>
            <div className="text-right"><p style={{ borderTop: `1px solid ${branding.primaryColor}` }}></p><p className="mt-1">HR / Admin</p></div>
          </div>

          <PrintableFooter branding={branding} />
        </div>
      </div>

      <style>{`@media print { @page { size: A4; margin: 15mm; } }`}</style>
    </div>
  );
}
