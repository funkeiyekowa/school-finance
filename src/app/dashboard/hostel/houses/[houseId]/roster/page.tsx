"use client";

/**
 * Printable hostel/house roster.
 *
 * Every occupied bed in a house, with student + room + emergency
 * contact. House parent uses this to check the house every evening.
 */

import { useEffect, useState, useMemo } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useBranding } from "@/lib/hooks/useBranding";
import { fmtDate } from "@/lib/utils";
import { LoadingSpinner } from "@/components/ui/PageHeader";
import { PrintableLetterhead, PrintableFooter } from "@/components/print/PrintableLetterhead";
import { Printer } from "lucide-react";

interface House { id: string; name: string; gender: string; capacity: number | null; house_parent_staff_id: string | null; }
interface Room { id: string; house_id: string; room_number: string; floor_level: string | null; }
interface Bed { id: string; room_id: string; bed_label: string; }
interface Alloc { id: string; bed_id: string; student_id: string; checked_in_at: string; }
interface Student { id: string; full_name: string; student_code: string; grade: string | null; guardian_phone: string | null; }
interface Staff { id: string; full_name: string; }

export default function HostelRosterPage() {
  const params = useParams<{ houseId: string }>();
  const supabase = useMemo(() => createClient(), []);
  const branding = useBranding();
  const [house, setHouse] = useState<House | null>(null);
  const [rows, setRows] = useState<{ room: Room; bed: Bed; alloc: Alloc | null; student: Student | null }[]>([]);
  const [parent, setParent] = useState<Staff | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: h } = await supabase.from("hostel_houses").select("*").eq("id", params.houseId).maybeSingle();
      const hs = h as House | null;
      setHouse(hs);
      if (!hs) { setLoading(false); return; }
      const [{ data: rooms }, { data: allBeds }, { data: allocs }] = await Promise.all([
        supabase.from("hostel_rooms").select("*").eq("house_id", hs.id).order("room_number"),
        supabase.from("hostel_beds").select("*"),
        supabase.from("hostel_allocations").select("*").eq("status", "active"),
      ]);
      const roomList = (rooms as Room[]) ?? [];
      const roomIds = new Set(roomList.map(r => r.id));
      const beds = ((allBeds as Bed[]) ?? []).filter(b => roomIds.has(b.room_id));
      const bedIds = new Set(beds.map(b => b.id));
      const houseAllocs = ((allocs as Alloc[]) ?? []).filter(a => bedIds.has(a.bed_id));
      const studentIds = houseAllocs.map(a => a.student_id);
      const { data: st } = studentIds.length
        ? await supabase.from("students").select("id, full_name, student_code, grade, guardian_phone").in("id", studentIds)
        : { data: [] };
      const stMap = new Map(((st as Student[]) ?? []).map(s => [s.id, s]));
      const allocByBed = new Map(houseAllocs.map(a => [a.bed_id, a]));
      const roomById = new Map(roomList.map(r => [r.id, r]));
      const rows = beds
        .sort((a, b) => (roomById.get(a.room_id)?.room_number ?? "").localeCompare(roomById.get(b.room_id)?.room_number ?? "") || a.bed_label.localeCompare(b.bed_label))
        .map(b => {
          const room = roomById.get(b.room_id)!;
          const alloc = allocByBed.get(b.id) ?? null;
          const student = alloc ? stMap.get(alloc.student_id) ?? null : null;
          return { room, bed: b, alloc, student };
        });
      setRows(rows);
      if (hs.house_parent_staff_id) {
        const { data: p } = await supabase.from("staff_members").select("id, full_name").eq("id", hs.house_parent_staff_id).maybeSingle();
        setParent(p as Staff ?? null);
      }
      setLoading(false);
    })();
  }, [supabase, params.houseId]);

  if (loading || !branding) return <div className="p-8"><LoadingSpinner /></div>;
  if (!house) return <div className="p-8 text-center text-gray-500">House not found.</div>;

  const occupied = rows.filter(r => r.alloc).length;
  const total = rows.length;
  const today = fmtDate(new Date().toISOString().slice(0, 10));

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      <div className="no-print sticky top-0 z-10 text-white px-6 py-3 flex items-center justify-between shadow-md" style={{ background: branding.primaryColor }}>
        <div>
          <p className="text-xs uppercase tracking-wider font-bold" style={{ color: branding.accentColor }}>House Roster · {branding.schoolName}</p>
          <p className="text-sm font-medium">{house.name} · {occupied} / {total} beds occupied</p>
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
            eyebrow="Hostel / House Roster"
            accent="purple"
            right={
              <div>
                <p className="text-[10px] text-gray-500 uppercase font-bold">House</p>
                <p className="text-lg font-bold" style={{ color: branding.primaryColor }}>{house.name}</p>
                <p className="text-[11px] text-gray-500 mt-0.5 capitalize">{house.gender}</p>
                {parent && <p className="text-[11px] text-gray-500">House parent: {parent.full_name}</p>}
                <p className="text-[11px] text-gray-500">Printed {today}</p>
              </div>
            }
          />

          <table className="w-full text-xs border-collapse">
            <thead>
              <tr style={{ background: branding.primaryColor, color: "#fff" }}>
                <th className="text-left px-2 py-2 border w-16">Room</th>
                <th className="text-left px-2 py-2 border w-14">Bed</th>
                <th className="text-left px-2 py-2 border">Student</th>
                <th className="text-left px-2 py-2 border w-20">Class</th>
                <th className="text-left px-2 py-2 border w-24">Checked in</th>
                <th className="text-left px-2 py-2 border w-32">Guardian phone</th>
                <th className="text-center px-2 py-2 border w-16">Present</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={7} className="py-4 text-center text-gray-400 italic">No beds in this house yet.</td></tr>
              ) : rows.map(({ room, bed, alloc, student }) => (
                <tr key={bed.id} className={!alloc ? "bg-gray-50" : ""}>
                  <td className="border px-2 py-1.5">{room.room_number}{room.floor_level ? ` (${room.floor_level})` : ""}</td>
                  <td className="border px-2 py-1.5 font-mono">{bed.bed_label}</td>
                  <td className="border px-2 py-1.5">
                    {student ? (
                      <>
                        <span className="font-semibold">{student.full_name}</span>
                        <span className="text-gray-400 font-mono ml-1">({student.student_code})</span>
                      </>
                    ) : <span className="text-gray-400 italic">Vacant</span>}
                  </td>
                  <td className="border px-2 py-1.5 text-gray-500">{student?.grade ?? "—"}</td>
                  <td className="border px-2 py-1.5 text-gray-500">{alloc ? fmtDate(alloc.checked_in_at.slice(0, 10)) : "—"}</td>
                  <td className="border px-2 py-1.5 text-gray-500">{student?.guardian_phone ?? "—"}</td>
                  <td className="border h-8"></td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="text-[10px] text-gray-500 mt-2 italic">Tick the &ldquo;Present&rdquo; column during evening roll call. Any missing student must be reported to the House Master immediately.</p>

          <div className="mt-6 grid grid-cols-2 gap-8 text-[10px] text-gray-500">
            <div><p style={{ borderTop: `1px solid ${branding.primaryColor}` }}></p><p className="mt-1">House Parent&apos;s Signature</p></div>
            <div><p style={{ borderTop: `1px solid ${branding.primaryColor}` }}></p><p className="mt-1">Duty Master</p></div>
          </div>

          <PrintableFooter branding={branding} />
        </div>
      </div>

      <style>{`@media print { @page { size: A4 landscape; margin: 12mm; } }`}</style>
    </div>
  );
}
