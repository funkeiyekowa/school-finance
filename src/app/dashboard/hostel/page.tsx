"use client";

/**
 * Hostel / Boarding module — houses, rooms, beds, student allocation,
 * a front-desk visitor log, and an incident/inspection log. Four tabs,
 * matching the Transport/Library modules' list+modal CRUD convention.
 *
 *   Houses      — boarding houses with rooms and beds, expandable to
 *                 manage the room/bed hierarchy directly.
 *   Allocations — active student-to-bed assignments; allocate/check-out
 *                 go through server-side RPCs (hostel_allocate_bed /
 *                 hostel_checkout_bed) so two staff can't double-book a
 *                 bed and "one active allocation per student" is a real
 *                 constraint, not just a UI assumption.
 *   Visitors    — front-desk sign-in/out log per house.
 *   Incidents   — house-parent write-ups: curfew, damage, health,
 *                 discipline, or room-inspection entries, with a
 *                 resolve flow.
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { useToast } from "@/lib/hooks/useToast";
import { extractErrorMessage } from "@/lib/errors/extractErrorMessage";
import { fmtDateTime, cn } from "@/lib/utils";
import { PageHeader, LoadingSpinner, EmptyState, KpiCard } from "@/components/ui/PageHeader";
import { Tabs, TabDef } from "@/components/ui/Tabs";
import { SetupHero } from "@/components/ui/SetupHero";
import { exportRowsAsCsv } from "@/lib/export/csv";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Home, Plus, Users, BedDouble, DoorOpen, UserCheck, AlertTriangle, Trash2, Pencil, LogOut, CheckCircle2, Download, Printer } from "lucide-react";

interface HouseRow {
  id: string; name: string; gender: string; house_parent_staff_id: string | null;
  capacity: number | null; description: string | null; status: string;
}
interface RoomRow { id: string; house_id: string; room_number: string; floor_level: string | null; status: string; }
interface BedRow { id: string; room_id: string; bed_label: string; status: string; }
interface AllocationRow {
  id: string; bed_id: string; student_id: string; academic_year: string | null; status: string;
  checked_in_at: string; checked_out_at: string | null; notes: string | null;
}
interface VisitorRow {
  id: string; house_id: string; visitor_name: string; visitor_phone: string | null; relationship: string | null;
  student_id: string | null; purpose: string | null; signed_in_at: string; signed_out_at: string | null;
}
interface IncidentRow {
  id: string; house_id: string; room_id: string | null; student_id: string | null; category: string; severity: string;
  description: string; status: string; resolution_notes: string | null; created_at: string; resolved_at: string | null;
}
interface StudentOption { id: string; full_name: string; student_code: string; gender: string | null; }
interface StaffOption { id: string; full_name: string; }
interface Stats { total_houses: number; total_beds: number; occupied_beds: number; available_beds: number; open_incidents: number; visitors_on_site: number; }

type Tab = "houses" | "allocations" | "visitors" | "incidents";

export default function HostelPage() {
  const { canEdit, orgId } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const { notify, ToastHost } = useToast();

  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("houses");

  const [houses, setHouses] = useState<HouseRow[]>([]);
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [beds, setBeds] = useState<BedRow[]>([]);
  const [allocations, setAllocations] = useState<AllocationRow[]>([]);
  const [visitors, setVisitors] = useState<VisitorRow[]>([]);
  const [incidents, setIncidents] = useState<IncidentRow[]>([]);
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [stats, setStats] = useState<Stats>({ total_houses: 0, total_beds: 0, occupied_beds: 0, available_beds: 0, open_incidents: 0, visitors_on_site: 0 });

  const load = useCallback(async () => {
    setLoading(true);
    const [hRes, rRes, bRes, aRes, vRes, iRes, sRes, stfRes, statsRes] = await Promise.all([
      supabase.from("hostel_houses").select("*").order("name"),
      supabase.from("hostel_rooms").select("*").order("room_number"),
      supabase.from("hostel_beds").select("*").order("bed_label"),
      supabase.from("hostel_allocations").select("*").order("checked_in_at", { ascending: false }),
      supabase.from("hostel_visitor_log").select("*").order("signed_in_at", { ascending: false }).limit(200),
      supabase.from("hostel_incidents").select("*").order("created_at", { ascending: false }),
      supabase.from("students").select("id, full_name, student_code, gender").eq("status", "active").order("full_name"),
      supabase.from("staff_members").select("id, full_name").eq("status", "active").order("full_name"),
      supabase.rpc("hostel_stats"),
    ]);
    setHouses((hRes.data as HouseRow[]) ?? []);
    setRooms((rRes.data as RoomRow[]) ?? []);
    setBeds((bRes.data as BedRow[]) ?? []);
    setAllocations((aRes.data as AllocationRow[]) ?? []);
    setVisitors((vRes.data as VisitorRow[]) ?? []);
    setIncidents((iRes.data as IncidentRow[]) ?? []);
    setStudents((sRes.data as StudentOption[]) ?? []);
    setStaff((stfRes.data as StaffOption[]) ?? []);
    if (statsRes.data && statsRes.data[0]) {
      const s = statsRes.data[0];
      setStats({
        total_houses: s.total_houses || 0,
        total_beds: s.total_beds || 0,
        occupied_beds: s.occupied_beds || 0,
        available_beds: s.available_beds || 0,
        open_incidents: s.open_incidents || 0,
        visitors_on_site: s.visitors_on_site || 0,
      });
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const houseById = useMemo(() => new Map(houses.map((h) => [h.id, h])), [houses]);
  const roomById = useMemo(() => new Map(rooms.map((r) => [r.id, r])), [rooms]);
  const bedById = useMemo(() => new Map(beds.map((b) => [b.id, b])), [beds]);
  const studentById = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);
  const staffById = useMemo(() => new Map(staff.map((s) => [s.id, s])), [staff]);
  const roomsByHouse = useMemo(() => {
    const map: Record<string, RoomRow[]> = {};
    for (const r of rooms) (map[r.house_id] ||= []).push(r);
    return map;
  }, [rooms]);
  const bedsByRoom = useMemo(() => {
    const map: Record<string, BedRow[]> = {};
    for (const b of beds) (map[b.room_id] ||= []).push(b);
    return map;
  }, [beds]);
  const allocationByBed = useMemo(() => {
    const map: Record<string, AllocationRow> = {};
    for (const a of allocations) if (a.status === "active") map[a.bed_id] = a;
    return map;
  }, [allocations]);

  function bedLocationLabel(bedId: string): string {
    const bed = bedById.get(bedId);
    if (!bed) return "Unknown bed";
    const room = roomById.get(bed.room_id);
    const house = room ? houseById.get(room.house_id) : null;
    return `${house?.name || "?"} · Room ${room?.room_number || "?"} · Bed ${bed.bed_label}`;
  }

  /* ---------------- Houses / rooms / beds ---------------- */
  const [showHouseForm, setShowHouseForm] = useState(false);
  const [editingHouse, setEditingHouse] = useState<HouseRow | null>(null);
  const emptyHouseForm = { name: "", gender: "mixed", house_parent_staff_id: "", capacity: "", description: "" };
  const [houseForm, setHouseForm] = useState(emptyHouseForm);
  const [savingHouse, setSavingHouse] = useState(false);
  const [expandedHouse, setExpandedHouse] = useState<string | null>(null);

  function openHouseForm(h?: HouseRow) {
    if (h) {
      setEditingHouse(h);
      setHouseForm({ name: h.name, gender: h.gender, house_parent_staff_id: h.house_parent_staff_id || "", capacity: h.capacity ? String(h.capacity) : "", description: h.description || "" });
    } else {
      setEditingHouse(null);
      setHouseForm(emptyHouseForm);
    }
    setShowHouseForm(true);
  }

  async function saveHouse() {
    if (!houseForm.name.trim()) { notify("House name is required.", "error"); return; }
    setSavingHouse(true);
    try {
      const payload = {
        name: houseForm.name.trim(),
        gender: houseForm.gender,
        house_parent_staff_id: houseForm.house_parent_staff_id || null,
        capacity: houseForm.capacity ? parseInt(houseForm.capacity, 10) : null,
        description: houseForm.description.trim() || null,
      };
      if (editingHouse) {
        const { error } = await supabase.from("hostel_houses").update(payload).eq("id", editingHouse.id);
        if (error) throw error;
        notify("House updated.");
      } else {
        const { error } = await supabase.from("hostel_houses").insert({ ...payload, organization_id: orgId });
        if (error) throw error;
        notify("House added.");
      }
      setShowHouseForm(false);
      load();
    } catch (err) {
      notify(extractErrorMessage(err, "Failed to save house."), "error");
    } finally {
      setSavingHouse(false);
    }
  }

  async function closeHouse(h: HouseRow) {
    if (!confirm(`Close "${h.name}"? Rooms and beds are kept but the house is hidden from new allocations.`)) return;
    const { error } = await supabase.from("hostel_houses").update({ status: "closed" }).eq("id", h.id);
    if (error) { notify(extractErrorMessage(error, "Failed to close house."), "error"); return; }
    notify("House closed.");
    load();
  }

  const [addingRoomFor, setAddingRoomFor] = useState<HouseRow | null>(null);
  const [roomNumber, setRoomNumber] = useState("");
  const [roomFloor, setRoomFloor] = useState("");
  const [savingRoom, setSavingRoom] = useState(false);

  async function addRoom() {
    if (!addingRoomFor || !roomNumber.trim()) { notify("Room number is required.", "error"); return; }
    setSavingRoom(true);
    try {
      const { error } = await supabase.from("hostel_rooms").insert({
        house_id: addingRoomFor.id,
        room_number: roomNumber.trim(),
        floor_level: roomFloor.trim() || null,
        organization_id: orgId,
      });
      if (error) throw error;
      notify(`Room ${roomNumber.trim()} added.`);
      setAddingRoomFor(null);
      setRoomNumber("");
      setRoomFloor("");
      load();
    } catch (err) {
      notify(extractErrorMessage(err, "Failed to add room."), "error");
    } finally {
      setSavingRoom(false);
    }
  }

  async function deleteRoom(r: RoomRow) {
    const hasOccupiedBed = (bedsByRoom[r.id] || []).some((b) => b.status === "occupied");
    if (hasOccupiedBed) { notify("This room has an occupied bed — check the student out first.", "error"); return; }
    if (!confirm(`Delete room ${r.room_number}? All its beds are removed too.`)) return;
    const { error } = await supabase.from("hostel_rooms").delete().eq("id", r.id);
    if (error) { notify(extractErrorMessage(error, "Failed to delete room."), "error"); return; }
    load();
  }

  const [addingBedFor, setAddingBedFor] = useState<RoomRow | null>(null);
  const [bedLabel, setBedLabel] = useState("");
  const [savingBed, setSavingBed] = useState(false);

  async function addBed() {
    if (!addingBedFor || !bedLabel.trim()) { notify("Bed label is required.", "error"); return; }
    setSavingBed(true);
    try {
      const { error } = await supabase.from("hostel_beds").insert({
        room_id: addingBedFor.id,
        bed_label: bedLabel.trim(),
        organization_id: orgId,
      });
      if (error) throw error;
      notify(`Bed ${bedLabel.trim()} added.`);
      setAddingBedFor(null);
      setBedLabel("");
      load();
    } catch (err) {
      notify(extractErrorMessage(err, "Failed to add bed."), "error");
    } finally {
      setSavingBed(false);
    }
  }

  async function deleteBed(b: BedRow) {
    if (b.status === "occupied") { notify("This bed is occupied — check the student out first.", "error"); return; }
    if (!confirm(`Delete bed ${b.bed_label}?`)) return;
    const { error } = await supabase.from("hostel_beds").delete().eq("id", b.id);
    if (error) { notify(extractErrorMessage(error, "Failed to delete bed."), "error"); return; }
    load();
  }

  /* ---------------- Allocations ---------------- */
  const [showAllocate, setShowAllocate] = useState<BedRow | null>(null);
  const [allocSearch, setAllocSearch] = useState("");
  const [selectedStudent, setSelectedStudent] = useState("");
  const [academicYear, setAcademicYear] = useState("");
  const [allocating, setAllocating] = useState(false);
  const [checkingOut, setCheckingOut] = useState<string | null>(null);

  const unallocatedStudents = useMemo(() => {
    const allocatedIds = new Set(allocations.filter((a) => a.status === "active").map((a) => a.student_id));
    return students.filter((s) => !allocatedIds.has(s.id) && s.full_name.toLowerCase().includes(allocSearch.toLowerCase()));
  }, [students, allocations, allocSearch]);

  function openAllocate(bed: BedRow) {
    setShowAllocate(bed);
    setAllocSearch("");
    setSelectedStudent("");
    setAcademicYear("");
  }

  async function confirmAllocate() {
    if (!showAllocate || !selectedStudent) { notify("Select a student.", "error"); return; }
    setAllocating(true);
    try {
      const { error } = await supabase.rpc("hostel_allocate_bed", {
        p_bed_id: showAllocate.id,
        p_student_id: selectedStudent,
        p_academic_year: academicYear.trim() || null,
      });
      if (error) throw error;
      notify("Student allocated.");
      setShowAllocate(null);
      load();
    } catch (err) {
      notify(extractErrorMessage(err, "Allocation failed."), "error");
    } finally {
      setAllocating(false);
    }
  }

  async function checkOutAllocation(a: AllocationRow) {
    if (!confirm("Check this student out of their bed?")) return;
    setCheckingOut(a.id);
    try {
      const { error } = await supabase.rpc("hostel_checkout_bed", { p_allocation_id: a.id });
      if (error) throw error;
      notify("Checked out.");
      load();
    } catch (err) {
      notify(extractErrorMessage(err, "Check-out failed."), "error");
    } finally {
      setCheckingOut(null);
    }
  }

  /* ---------------- Visitors ---------------- */
  const [showVisitorForm, setShowVisitorForm] = useState(false);
  const emptyVisitorForm = { house_id: "", visitor_name: "", visitor_phone: "", relationship: "", student_id: "", purpose: "" };
  const [visitorForm, setVisitorForm] = useState(emptyVisitorForm);
  const [savingVisitor, setSavingVisitor] = useState(false);
  const [visitorStudentSearch, setVisitorStudentSearch] = useState("");
  const [signingOut, setSigningOut] = useState<string | null>(null);

  async function signInVisitor() {
    if (!visitorForm.house_id) { notify("Select a house.", "error"); return; }
    if (!visitorForm.visitor_name.trim()) { notify("Visitor name is required.", "error"); return; }
    setSavingVisitor(true);
    try {
      const { error } = await supabase.from("hostel_visitor_log").insert({
        house_id: visitorForm.house_id,
        visitor_name: visitorForm.visitor_name.trim(),
        visitor_phone: visitorForm.visitor_phone.trim() || null,
        relationship: visitorForm.relationship.trim() || null,
        student_id: visitorForm.student_id || null,
        purpose: visitorForm.purpose.trim() || null,
        organization_id: orgId,
      });
      if (error) throw error;
      notify("Visitor signed in.");
      setShowVisitorForm(false);
      setVisitorForm(emptyVisitorForm);
      load();
    } catch (err) {
      notify(extractErrorMessage(err, "Failed to sign in visitor."), "error");
    } finally {
      setSavingVisitor(false);
    }
  }

  async function signOutVisitor(v: VisitorRow) {
    setSigningOut(v.id);
    const { error } = await supabase.from("hostel_visitor_log").update({ signed_out_at: new Date().toISOString() }).eq("id", v.id);
    if (error) { notify(extractErrorMessage(error, "Failed to sign out visitor."), "error"); setSigningOut(null); return; }
    load();
    setSigningOut(null);
  }

  /* ---------------- Incidents ---------------- */
  const [showIncidentForm, setShowIncidentForm] = useState(false);
  const emptyIncidentForm = { house_id: "", room_id: "", student_id: "", category: "other", severity: "low", description: "" };
  const [incidentForm, setIncidentForm] = useState(emptyIncidentForm);
  const [savingIncident, setSavingIncident] = useState(false);
  const [resolvingIncident, setResolvingIncident] = useState<IncidentRow | null>(null);
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [savingResolution, setSavingResolution] = useState(false);

  async function logIncident() {
    if (!incidentForm.house_id) { notify("Select a house.", "error"); return; }
    if (!incidentForm.description.trim()) { notify("Description is required.", "error"); return; }
    setSavingIncident(true);
    try {
      const { error } = await supabase.from("hostel_incidents").insert({
        house_id: incidentForm.house_id,
        room_id: incidentForm.room_id || null,
        student_id: incidentForm.student_id || null,
        category: incidentForm.category,
        severity: incidentForm.severity,
        description: incidentForm.description.trim(),
        organization_id: orgId,
      });
      if (error) throw error;
      notify("Incident logged.");
      setShowIncidentForm(false);
      setIncidentForm(emptyIncidentForm);
      load();
    } catch (err) {
      notify(extractErrorMessage(err, "Failed to log incident."), "error");
    } finally {
      setSavingIncident(false);
    }
  }

  async function saveResolution() {
    if (!resolvingIncident) return;
    setSavingResolution(true);
    const { error } = await supabase.from("hostel_incidents").update({
      status: "resolved",
      resolution_notes: resolutionNotes.trim() || null,
      resolved_at: new Date().toISOString(),
    }).eq("id", resolvingIncident.id);
    setSavingResolution(false);
    if (error) { notify(extractErrorMessage(error, "Failed to resolve incident."), "error"); return; }
    notify("Incident resolved.");
    setResolvingIncident(null);
    setResolutionNotes("");
    load();
  }

  const activeAllocations = allocations.filter((a) => a.status === "active");
  const onSiteVisitors = visitors.filter((v) => !v.signed_out_at);
  const openIncidents = incidents.filter((i) => i.status === "open");

  const TABS: TabDef<Tab>[] = [
    { key: "houses", label: "Houses", icon: <Home size={14} /> },
    { key: "allocations", label: "Allocations", icon: <BedDouble size={14} />, count: activeAllocations.length },
    { key: "visitors", label: "Visitors", icon: <UserCheck size={14} />, count: onSiteVisitors.length },
    { key: "incidents", label: "Incidents", icon: <AlertTriangle size={14} />, count: openIncidents.length },
  ];

  return (
    <div className="p-6 space-y-5">
      <PageHeader
        title="Hostel / Boarding"
        subtitle="Houses, rooms, beds, allocations, and visitor tracking."
        eyebrow="Operations"
        icon={<BedDouble size={22} />}
        gradient="purple"
        breadcrumb={[{ label: "Operations" }, { label: "Hostel" }]}
      >
        {tab === "houses" && houses.length > 0 && (
          <Button variant="secondary" onClick={() => exportRowsAsCsv(`hostel-houses-${new Date().toISOString().slice(0,10)}.csv`, houses, [
            { key: "name", label: "Name" }, { key: "gender", label: "Gender" },
            { key: "capacity", label: "Capacity" }, { key: "status", label: "Status" },
          ])}><Download size={14} /> Export</Button>
        )}
        {tab === "allocations" && allocations.length > 0 && (
          <Button variant="secondary" onClick={() => exportRowsAsCsv(`hostel-allocations-${new Date().toISOString().slice(0,10)}.csv`, allocations, [
            { key: "student_id", label: "Student", format: (a) => studentById.get(a.student_id)?.full_name || "" },
            { key: "bed_id", label: "Bed", format: (a) => bedById.get(a.bed_id)?.bed_label || "" },
            { key: "checked_in_at", label: "Check in" }, { key: "checked_out_at", label: "Check out" }, { key: "status", label: "Status" },
          ])}><Download size={14} /> Export</Button>
        )}
        {canEdit && tab === "houses" && (
          <Button variant="gold" onClick={() => openHouseForm()}><Plus size={16} /> Add House</Button>
        )}
        {canEdit && tab === "visitors" && (
          <Button variant="gold" onClick={() => setShowVisitorForm(true)}><Plus size={16} /> Sign In Visitor</Button>
        )}
        {canEdit && tab === "incidents" && (
          <Button variant="gold" onClick={() => setShowIncidentForm(true)}><Plus size={16} /> Log Incident</Button>
        )}
      </PageHeader>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        <KpiCard label="Houses" value={String(stats.total_houses)} icon={<Home size={18} />} />
        <KpiCard label="Beds" value={String(stats.total_beds)} icon={<BedDouble size={18} />} />
        <KpiCard label="Occupied" value={String(stats.occupied_beds)} icon={<Users size={18} />} />
        <KpiCard label="Available" value={String(stats.available_beds)} icon={<CheckCircle2 size={18} />} colorClass="text-emerald-600" />
        <KpiCard label="On Site" value={String(stats.visitors_on_site)} icon={<UserCheck size={18} />} />
        <KpiCard label="Open Incidents" value={String(stats.open_incidents)} icon={<AlertTriangle size={18} />} colorClass={stats.open_incidents > 0 ? "text-red-600" : "text-[#0F2A47]"} />
      </div>

      <Tabs<Tab> tabs={TABS} value={tab} onChange={setTab} />

      {loading ? <LoadingSpinner /> : (
        <>
          {tab === "houses" && (
            houses.filter((h) => h.status === "active").length === 0 ? (
              <SetupHero
                icon={<Home size={40} />}
                title="Set up your boarding houses"
                description="Model your dormitories as houses → rooms → beds, then allocate students to beds. Visitor log and incident tracking come free. Only one active allocation per student, enforced by the database."
                bullets={[
                  "Houses → rooms → beds hierarchy",
                  "One active allocation per student (DB-enforced)",
                  "Visitor sign-in/out log",
                  "Incidents log for supervisors",
                ]}
                tone="purple"
                primaryCta={canEdit ? { label: "Add your first house", onClick: openHouseForm } : { label: "Editors only", onClick: () => {}, disabled: true }}
              />
            ) : (
              <div className="space-y-3">
                {houses.filter((h) => h.status === "active").map((h) => {
                  const houseRooms = roomsByHouse[h.id] || [];
                  const totalBeds = houseRooms.reduce((sum, r) => sum + (bedsByRoom[r.id] || []).length, 0);
                  const occupiedBeds = houseRooms.reduce((sum, r) => sum + (bedsByRoom[r.id] || []).filter((b) => b.status === "occupied").length, 0);
                  const expanded = expandedHouse === h.id;
                  return (
                    <Card key={h.id}>
                      <div className="flex items-start justify-between gap-3 cursor-pointer" onClick={() => setExpandedHouse(expanded ? null : h.id)}>
                        <div className="flex items-start gap-3">
                          <div className="w-9 h-9 rounded-lg bg-[#0F2A47] text-white flex items-center justify-center shrink-0"><Home size={16} /></div>
                          <div>
                            <h3 className="font-semibold text-[#0F2A47] text-sm">{h.name}</h3>
                            <p className="text-xs text-gray-500 capitalize">{h.gender} · {h.house_parent_staff_id ? staffById.get(h.house_parent_staff_id)?.full_name || "House parent assigned" : "No house parent assigned"}</p>
                            <p className="text-xs text-gray-400 mt-0.5">{houseRooms.length} room{houseRooms.length === 1 ? "" : "s"} · {occupiedBeds}/{totalBeds} beds occupied</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => window.open(`/dashboard/hostel/houses/${h.id}/roster`, "_blank")}
                            title="Print roster"
                            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"
                          >
                            <Printer size={14} />
                          </button>
                          {canEdit && <>
                            <button onClick={() => openHouseForm(h)} title="Edit" className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"><Pencil size={14} /></button>
                            <button onClick={() => closeHouse(h)} title="Close house" className="p-1.5 rounded-lg hover:bg-red-50 text-red-500"><Trash2 size={14} /></button>
                          </>}
                        </div>
                      </div>

                      {expanded && (
                        <div className="mt-3 pt-3 border-t border-gray-100 space-y-3">
                          {h.description && <p className="text-xs text-gray-500">{h.description}</p>}
                          <div className="flex items-center justify-between">
                            <h4 className="text-xs font-bold text-gray-600 uppercase tracking-wide flex items-center gap-1"><DoorOpen size={12} /> Rooms</h4>
                            {canEdit && (
                              <button onClick={() => setAddingRoomFor(h)} className="text-xs text-[#0F2A47] hover:text-[#C9A227] flex items-center gap-1"><Plus size={12} /> Add room</button>
                            )}
                          </div>
                          {houseRooms.length === 0 ? (
                            <p className="text-xs text-gray-400 italic">No rooms yet.</p>
                          ) : (
                            <div className="space-y-2">
                              {houseRooms.map((r) => {
                                const roomBeds = bedsByRoom[r.id] || [];
                                return (
                                  <div key={r.id} className="bg-gray-50 rounded-lg px-3 py-2">
                                    <div className="flex items-center justify-between mb-1.5">
                                      <span className="text-xs font-medium text-gray-700">Room {r.room_number}{r.floor_level ? ` · ${r.floor_level}` : ""}</span>
                                      {canEdit && (
                                        <div className="flex items-center gap-2">
                                          <button onClick={() => setAddingBedFor(r)} className="text-[11px] text-[#0F2A47] hover:text-[#C9A227] flex items-center gap-0.5"><Plus size={11} /> Bed</button>
                                          <button onClick={() => deleteRoom(r)} className="text-red-400 hover:text-red-600"><Trash2 size={12} /></button>
                                        </div>
                                      )}
                                    </div>
                                    {roomBeds.length === 0 ? (
                                      <p className="text-[11px] text-gray-400 italic">No beds yet.</p>
                                    ) : (
                                      <div className="flex flex-wrap gap-1.5">
                                        {roomBeds.map((b) => {
                                          const alloc = allocationByBed[b.id];
                                          const student = alloc ? studentById.get(alloc.student_id) : null;
                                          return (
                                            <div key={b.id} className={cn(
                                              "text-[11px] rounded-md px-2 py-1 flex items-center gap-1.5 border",
                                              b.status === "occupied" ? "bg-amber-50 border-amber-200 text-amber-700" : "bg-white border-gray-200 text-gray-600"
                                            )}>
                                              <span className="font-medium">{b.bed_label}</span>
                                              {student ? <span>{student.full_name}</span> : <span className="text-emerald-600">Available</span>}
                                              {canEdit && b.status === "available" && (
                                                <button onClick={() => openAllocate(b)} className="text-[#0F2A47] hover:text-[#C9A227] underline">Allocate</button>
                                              )}
                                              {canEdit && b.status !== "occupied" && (
                                                <button onClick={() => deleteBed(b)} className="text-red-400 hover:text-red-600"><Trash2 size={10} /></button>
                                              )}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>
            )
          )}

          {tab === "allocations" && (
            activeAllocations.length === 0 ? (
              <EmptyState message="No active bed allocations." icon={<BedDouble size={40} />} />
            ) : (
              <div className="space-y-2">
                {activeAllocations.map((a) => {
                  const student = studentById.get(a.student_id);
                  return (
                    <Card key={a.id} className="flex items-center justify-between !p-3.5">
                      <div>
                        <p className="text-sm font-medium text-gray-700">{student?.full_name || "Unknown student"} <span className="text-xs text-gray-400">{student?.student_code}</span></p>
                        <p className="text-xs text-gray-500">{bedLocationLabel(a.bed_id)}</p>
                        <p className="text-xs text-gray-400 mt-0.5">Checked in {fmtDateTime(a.checked_in_at)}{a.academic_year ? ` · ${a.academic_year}` : ""}</p>
                      </div>
                      {canEdit && (
                        <Button variant="secondary" size="sm" onClick={() => checkOutAllocation(a)} loading={checkingOut === a.id}><LogOut size={12} /> Check Out</Button>
                      )}
                    </Card>
                  );
                })}
              </div>
            )
          )}

          {tab === "visitors" && (
            visitors.length === 0 ? (
              <EmptyState message="No visitor log entries yet." icon={<UserCheck size={40} />} />
            ) : (
              <div className="space-y-2">
                {visitors.map((v) => {
                  const house = houseById.get(v.house_id);
                  const student = v.student_id ? studentById.get(v.student_id) : null;
                  return (
                    <Card key={v.id} className="flex items-center justify-between !p-3.5">
                      <div>
                        <p className="text-sm font-medium text-gray-700">{v.visitor_name} {v.relationship ? <span className="text-xs text-gray-400">({v.relationship})</span> : null}</p>
                        <p className="text-xs text-gray-500">{house?.name || "Unknown house"}{student ? ` · visiting ${student.full_name}` : ""}{v.purpose ? ` · ${v.purpose}` : ""}</p>
                        <p className="text-xs text-gray-400 mt-0.5">Signed in {fmtDateTime(v.signed_in_at)}{v.signed_out_at ? ` · out ${fmtDateTime(v.signed_out_at)}` : ""}</p>
                      </div>
                      {!v.signed_out_at ? (
                        canEdit && <Button variant="secondary" size="sm" onClick={() => signOutVisitor(v)} loading={signingOut === v.id}>Sign Out</Button>
                      ) : (
                        <span className="text-[10px] font-bold uppercase text-gray-400 bg-gray-100 px-2 py-1 rounded-full">Signed out</span>
                      )}
                    </Card>
                  );
                })}
              </div>
            )
          )}

          {tab === "incidents" && (
            incidents.length === 0 ? (
              <EmptyState message="No incidents logged." icon={<AlertTriangle size={40} />} />
            ) : (
              <div className="space-y-2">
                {incidents.map((i) => {
                  const house = houseById.get(i.house_id);
                  const room = i.room_id ? roomById.get(i.room_id) : null;
                  const student = i.student_id ? studentById.get(i.student_id) : null;
                  return (
                    <Card key={i.id} className={cn("!p-3.5", i.status === "open" && i.severity === "high" && "border-red-200")}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className={cn(
                              "text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full",
                              i.severity === "high" ? "bg-red-100 text-red-700" : i.severity === "medium" ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600"
                            )}>{i.severity}</span>
                            <span className="text-xs font-medium text-gray-700 capitalize">{i.category}</span>
                            <span className={cn("text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full", i.status === "open" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700")}>{i.status}</span>
                          </div>
                          <p className="text-sm text-gray-700 mt-1">{i.description}</p>
                          <p className="text-xs text-gray-400 mt-1">{house?.name}{room ? ` · Room ${room.room_number}` : ""}{student ? ` · ${student.full_name}` : ""} · {fmtDateTime(i.created_at)}</p>
                          {i.status === "resolved" && i.resolution_notes && (
                            <p className="text-xs text-emerald-700 mt-1 italic">Resolved: {i.resolution_notes}</p>
                          )}
                        </div>
                        {canEdit && i.status === "open" && (
                          <Button variant="secondary" size="sm" onClick={() => { setResolvingIncident(i); setResolutionNotes(""); }}>Resolve</Button>
                        )}
                      </div>
                    </Card>
                  );
                })}
              </div>
            )
          )}
        </>
      )}

      {/* House form */}
      <Modal open={showHouseForm} onClose={() => setShowHouseForm(false)} title={editingHouse ? "Edit House" : "Add House"} size="lg">
        <div className="space-y-3">
          <Input label="Name" value={houseForm.name} onChange={(e) => setHouseForm({ ...houseForm, name: e.target.value })} placeholder="e.g. Unity House" />
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Gender"
              value={houseForm.gender}
              onChange={(e) => setHouseForm({ ...houseForm, gender: e.target.value })}
              options={[{ value: "mixed", label: "Mixed" }, { value: "male", label: "Male" }, { value: "female", label: "Female" }]}
            />
            <Select
              label="House parent"
              value={houseForm.house_parent_staff_id}
              onChange={(e) => setHouseForm({ ...houseForm, house_parent_staff_id: e.target.value })}
              options={staff.map((s) => ({ value: s.id, label: s.full_name }))}
              placeholder="Unassigned"
            />
          </div>
          <Input label="Capacity (optional)" type="number" value={houseForm.capacity} onChange={(e) => setHouseForm({ ...houseForm, capacity: e.target.value })} />
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Description</label>
            <textarea
              value={houseForm.description}
              onChange={(e) => setHouseForm({ ...houseForm, description: e.target.value })}
              rows={2}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowHouseForm(false)}>Cancel</Button>
            <Button variant="gold" onClick={saveHouse} loading={savingHouse}>{editingHouse ? "Save Changes" : "Add House"}</Button>
          </div>
        </div>
      </Modal>

      {/* Add room */}
      <Modal open={!!addingRoomFor} onClose={() => setAddingRoomFor(null)} title={`Add Room — ${addingRoomFor?.name ?? ""}`}>
        <div className="space-y-3">
          <Input label="Room number" value={roomNumber} onChange={(e) => setRoomNumber(e.target.value)} placeholder="e.g. 12" />
          <Input label="Floor (optional)" value={roomFloor} onChange={(e) => setRoomFloor(e.target.value)} placeholder="e.g. 2nd Floor" />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setAddingRoomFor(null)}>Cancel</Button>
            <Button variant="gold" onClick={addRoom} loading={savingRoom}>Add Room</Button>
          </div>
        </div>
      </Modal>

      {/* Add bed */}
      <Modal open={!!addingBedFor} onClose={() => setAddingBedFor(null)} title={`Add Bed — Room ${addingBedFor?.room_number ?? ""}`}>
        <div className="space-y-3">
          <Input label="Bed label" value={bedLabel} onChange={(e) => setBedLabel(e.target.value)} placeholder="e.g. A, B, Upper, Lower" />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setAddingBedFor(null)}>Cancel</Button>
            <Button variant="gold" onClick={addBed} loading={savingBed}>Add Bed</Button>
          </div>
        </div>
      </Modal>

      {/* Allocate bed */}
      <Modal open={!!showAllocate} onClose={() => setShowAllocate(null)} title={`Allocate ${showAllocate ? bedLocationLabel(showAllocate.id) : ""}`} size="lg">
        <div className="space-y-3">
          <Input placeholder="Search students…" value={allocSearch} onChange={(e) => setAllocSearch(e.target.value)} />
          <div className="max-h-48 overflow-y-auto space-y-1 border border-gray-100 rounded-lg p-1.5">
            {unallocatedStudents.slice(0, 30).map((s) => (
              <button
                key={s.id}
                onClick={() => setSelectedStudent(s.id)}
                className={cn("w-full text-left px-2.5 py-1.5 rounded-md text-sm", selectedStudent === s.id ? "bg-[#FFFBEB] border border-[#C9A227]" : "hover:bg-gray-50")}
              >
                {s.full_name} <span className="text-xs text-gray-400">{s.student_code}{s.gender ? ` · ${s.gender}` : ""}</span>
              </button>
            ))}
            {unallocatedStudents.length === 0 && <p className="text-xs text-gray-400 italic py-2 text-center">No unallocated students match.</p>}
          </div>
          <Input label="Academic year (optional)" value={academicYear} onChange={(e) => setAcademicYear(e.target.value)} placeholder="e.g. 2026/2027" />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowAllocate(null)}>Cancel</Button>
            <Button variant="gold" onClick={confirmAllocate} loading={allocating}>Allocate</Button>
          </div>
        </div>
      </Modal>

      {/* Visitor sign-in */}
      <Modal open={showVisitorForm} onClose={() => setShowVisitorForm(false)} title="Sign In Visitor" size="lg">
        <div className="space-y-3">
          <Select
            label="House"
            value={visitorForm.house_id}
            onChange={(e) => setVisitorForm({ ...visitorForm, house_id: e.target.value })}
            options={houses.filter((h) => h.status === "active").map((h) => ({ value: h.id, label: h.name }))}
            placeholder="Select a house"
          />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Visitor name" value={visitorForm.visitor_name} onChange={(e) => setVisitorForm({ ...visitorForm, visitor_name: e.target.value })} />
            <Input label="Phone (optional)" value={visitorForm.visitor_phone} onChange={(e) => setVisitorForm({ ...visitorForm, visitor_phone: e.target.value })} />
          </div>
          <Input label="Relationship (optional)" value={visitorForm.relationship} onChange={(e) => setVisitorForm({ ...visitorForm, relationship: e.target.value })} placeholder="e.g. Parent, Guardian" />
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Visiting student (optional)</label>
            <Input placeholder="Search students…" value={visitorStudentSearch} onChange={(e) => setVisitorStudentSearch(e.target.value)} />
            <div className="max-h-32 overflow-y-auto space-y-1 border border-gray-100 rounded-lg p-1.5 mt-1">
              {students.filter((s) => s.full_name.toLowerCase().includes(visitorStudentSearch.toLowerCase())).slice(0, 20).map((s) => (
                <button
                  key={s.id}
                  onClick={() => setVisitorForm({ ...visitorForm, student_id: s.id })}
                  className={cn("w-full text-left px-2.5 py-1.5 rounded-md text-xs", visitorForm.student_id === s.id ? "bg-[#FFFBEB] border border-[#C9A227]" : "hover:bg-gray-50")}
                >
                  {s.full_name}
                </button>
              ))}
            </div>
          </div>
          <Input label="Purpose (optional)" value={visitorForm.purpose} onChange={(e) => setVisitorForm({ ...visitorForm, purpose: e.target.value })} />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowVisitorForm(false)}>Cancel</Button>
            <Button variant="gold" onClick={signInVisitor} loading={savingVisitor}>Sign In</Button>
          </div>
        </div>
      </Modal>

      {/* Log incident */}
      <Modal open={showIncidentForm} onClose={() => setShowIncidentForm(false)} title="Log Incident" size="lg">
        <div className="space-y-3">
          <Select
            label="House"
            value={incidentForm.house_id}
            onChange={(e) => setIncidentForm({ ...incidentForm, house_id: e.target.value, room_id: "" })}
            options={houses.filter((h) => h.status === "active").map((h) => ({ value: h.id, label: h.name }))}
            placeholder="Select a house"
          />
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Room (optional)"
              value={incidentForm.room_id}
              onChange={(e) => setIncidentForm({ ...incidentForm, room_id: e.target.value })}
              options={(roomsByHouse[incidentForm.house_id] || []).map((r) => ({ value: r.id, label: `Room ${r.room_number}` }))}
              placeholder="Whole house"
            />
            <Select
              label="Category"
              value={incidentForm.category}
              onChange={(e) => setIncidentForm({ ...incidentForm, category: e.target.value })}
              options={[
                { value: "curfew", label: "Curfew" }, { value: "damage", label: "Damage" }, { value: "health", label: "Health" },
                { value: "discipline", label: "Discipline" }, { value: "inspection", label: "Inspection" }, { value: "other", label: "Other" },
              ]}
            />
          </div>
          <Select
            label="Severity"
            value={incidentForm.severity}
            onChange={(e) => setIncidentForm({ ...incidentForm, severity: e.target.value })}
            options={[{ value: "low", label: "Low" }, { value: "medium", label: "Medium" }, { value: "high", label: "High" }]}
          />
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Description</label>
            <textarea
              value={incidentForm.description}
              onChange={(e) => setIncidentForm({ ...incidentForm, description: e.target.value })}
              rows={3}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowIncidentForm(false)}>Cancel</Button>
            <Button variant="gold" onClick={logIncident} loading={savingIncident}>Log Incident</Button>
          </div>
        </div>
      </Modal>

      {/* Resolve incident */}
      <Modal open={!!resolvingIncident} onClose={() => setResolvingIncident(null)} title="Resolve Incident">
        <div className="space-y-3">
          <p className="text-sm text-gray-600">{resolvingIncident?.description}</p>
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Resolution notes</label>
            <textarea
              value={resolutionNotes}
              onChange={(e) => setResolutionNotes(e.target.value)}
              rows={3}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
              placeholder="What was done?"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setResolvingIncident(null)}>Cancel</Button>
            <Button variant="gold" onClick={saveResolution} loading={savingResolution}><CheckCircle2 size={14} /> Mark Resolved</Button>
          </div>
        </div>
      </Modal>

      <ToastHost />
    </div>
  );
}
