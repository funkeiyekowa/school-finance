"use client";

/**
 * Printable transport route roster.
 *
 * Every student assigned to a route, with pickup/drop-off, contact
 * details, and vehicle info — on the school letterhead. Drivers use
 * this daily.
 */

import { useEffect, useState, useMemo } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useBranding } from "@/lib/hooks/useBranding";
import { LoadingSpinner } from "@/components/ui/PageHeader";
import { PrintableLetterhead, PrintableFooter } from "@/components/print/PrintableLetterhead";
import { Printer } from "lucide-react";

interface Route {
  id: string; route_code: string; name: string; description: string | null;
  departure_time: string | null; return_time: string | null;
  vehicle_id: string | null; fee_per_term: number | null;
}
interface Vehicle { id: string; plate_number: string; make: string | null; model: string | null; capacity: number | null; driver_name: string | null; driver_phone: string | null; }
interface Assignment { id: string; student_id: string; pickup_point: string | null; drop_off_point: string | null; }
interface Student { id: string; full_name: string; student_code: string; grade: string | null; guardian_phone: string | null; }

export default function TransportRosterPrintPage() {
  const params = useParams<{ routeId: string }>();
  const supabase = useMemo(() => createClient(), []);
  const branding = useBranding();

  const [route, setRoute] = useState<Route | null>(null);
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [rows, setRows] = useState<{ assignment: Assignment; student: Student }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: r } = await supabase.from("transport_routes").select("*").eq("id", params.routeId).maybeSingle();
      const route = r as Route | null;
      setRoute(route);
      if (!route) { setLoading(false); return; }
      if (route.vehicle_id) {
        const { data: v } = await supabase.from("transport_vehicles").select("*").eq("id", route.vehicle_id).maybeSingle();
        setVehicle(v as Vehicle ?? null);
      }
      const { data: asg } = await supabase.from("transport_student_assignments").select("*").eq("route_id", route.id).eq("status", "active");
      const asgList = (asg as Assignment[]) ?? [];
      const studentIds = asgList.map(a => a.student_id);
      const { data: st } = studentIds.length
        ? await supabase.from("students").select("id, full_name, student_code, grade, guardian_phone").in("id", studentIds)
        : { data: [] };
      const stMap = new Map((st as Student[] ?? []).map(s => [s.id, s]));
      setRows(asgList.filter(a => stMap.has(a.student_id)).map(a => ({ assignment: a, student: stMap.get(a.student_id)! })));
      setLoading(false);
    })();
  }, [supabase, params.routeId]);

  if (loading || !branding) return <div className="p-8"><LoadingSpinner /></div>;
  if (!route) return <div className="p-8 text-center text-gray-500">Route not found.</div>;

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      <div className="no-print sticky top-0 z-10 text-white px-6 py-3 flex items-center justify-between shadow-md" style={{ background: branding.primaryColor }}>
        <div>
          <p className="text-xs uppercase tracking-wider font-bold" style={{ color: branding.accentColor }}>Route Roster · {branding.schoolName}</p>
          <p className="text-sm font-medium">{route.route_code} — {route.name}</p>
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
            eyebrow="Transport Route Roster"
            accent="amber"
            right={
              <div>
                <p className="text-[10px] text-gray-500 uppercase font-bold">Route</p>
                <p className="text-sm font-bold" style={{ color: branding.primaryColor }}>{route.route_code} — {route.name}</p>
                {route.departure_time && <p className="text-[11px] text-gray-500">Depart {route.departure_time}</p>}
                {route.return_time && <p className="text-[11px] text-gray-500">Return {route.return_time}</p>}
              </div>
            }
          />

          {vehicle && (
            <div className="grid grid-cols-2 gap-4 mb-4 text-xs">
              <div>
                <p className="text-[10px] uppercase font-bold" style={{ color: branding.accentColor }}>Vehicle</p>
                <p className="font-semibold">{vehicle.plate_number}</p>
                <p className="text-gray-500">{[vehicle.make, vehicle.model].filter(Boolean).join(" ")}</p>
                {vehicle.capacity && <p className="text-gray-500">Capacity: {vehicle.capacity}</p>}
              </div>
              <div>
                <p className="text-[10px] uppercase font-bold" style={{ color: branding.accentColor }}>Driver</p>
                <p className="font-semibold">{vehicle.driver_name ?? "—"}</p>
                {vehicle.driver_phone && <p className="text-gray-500">{vehicle.driver_phone}</p>}
              </div>
            </div>
          )}

          <table className="w-full text-xs border-collapse mb-4">
            <thead>
              <tr style={{ background: branding.primaryColor, color: "#fff" }}>
                <th className="text-left px-2 py-2 border w-10">#</th>
                <th className="text-left px-2 py-2 border">Student</th>
                <th className="text-left px-2 py-2 border w-24">Class</th>
                <th className="text-left px-2 py-2 border">Pickup</th>
                <th className="text-left px-2 py-2 border">Drop-off</th>
                <th className="text-left px-2 py-2 border w-32">Guardian phone</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={6} className="py-4 text-center text-gray-400 italic">No students on this route.</td></tr>
              ) : rows.map(({ assignment, student }, i) => (
                <tr key={assignment.id}>
                  <td className="border px-2 py-1.5 text-gray-500">{i + 1}</td>
                  <td className="border px-2 py-1.5">{student.full_name} <span className="text-gray-400 font-mono">({student.student_code})</span></td>
                  <td className="border px-2 py-1.5">{student.grade ?? "—"}</td>
                  <td className="border px-2 py-1.5">{assignment.pickup_point ?? "—"}</td>
                  <td className="border px-2 py-1.5">{assignment.drop_off_point ?? "—"}</td>
                  <td className="border px-2 py-1.5">{student.guardian_phone ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="text-[10px] text-gray-500 italic">Total on this route: <strong>{rows.length}</strong>{vehicle?.capacity ? ` of ${vehicle.capacity} seats` : ""}</p>

          <div className="mt-6 grid grid-cols-2 gap-8 text-[10px] text-gray-500">
            <div><p style={{ borderTop: `1px solid ${branding.primaryColor}` }}></p><p className="mt-1">Driver&apos;s Signature</p></div>
            <div><p style={{ borderTop: `1px solid ${branding.primaryColor}` }}></p><p className="mt-1">Transport Coordinator</p></div>
          </div>

          <PrintableFooter branding={branding} />
        </div>
      </div>

      <style>{`
        @media print { @page { size: A4 landscape; margin: 12mm; } }
      `}</style>
    </div>
  );
}
