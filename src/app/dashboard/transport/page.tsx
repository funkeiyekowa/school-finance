"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { useToast } from "@/lib/hooks/useToast";
import { extractErrorMessage } from "@/lib/errors/extractErrorMessage";
import { fmtMoney, cn } from "@/lib/utils";
import { PageHeader, LoadingSpinner, EmptyState } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Plus, Save, Bus, Search, Route as RouteIcon, Users } from "lucide-react";

interface VehicleRow {
  id: string;
  vehicle_code: string;
  plate_number: string | null;
  make_model: string | null;
  capacity: number | null;
  vehicle_type: string;
  status: string;
  driver_staff_id: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  insurance_expiry: string | null;
  roadworthiness_expiry: string | null;
}

interface RouteRow {
  id: string;
  route_code: string;
  name: string;
  description: string | null;
  vehicle_id: string | null;
  departure_time: string | null;
  return_time: string | null;
  fee_per_term: number | null;
  status: string;
}

interface AssignmentRow {
  id: string;
  student_id: string;
  route_id: string;
  pickup_point: string | null;
  drop_off_point: string | null;
  status: string;
  start_date: string | null;
}

interface StudentOption { id: string; full_name: string; student_code: string; }
interface StaffOption { id: string; full_name: string; }

interface TransportStats {
  total_vehicles: number;
  active_vehicles: number;
  total_routes: number;
  total_riders: number;
}

type Tab = "vehicles" | "routes" | "riders";

export default function TransportPage() {
  const { canEdit, orgId } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const { notify, ToastHost } = useToast();

  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("vehicles");
  const [search, setSearch] = useState("");

  const [vehicles, setVehicles] = useState<VehicleRow[]>([]);
  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [stats, setStats] = useState<TransportStats>({ total_vehicles: 0, active_vehicles: 0, total_routes: 0, total_riders: 0 });

  const load = useCallback(async () => {
    setLoading(true);
    const [vRes, rRes, aRes, sRes, stRes, statsRes] = await Promise.all([
      supabase.from("transport_vehicles").select("*").order("vehicle_code"),
      supabase.from("transport_routes").select("*").order("route_code"),
      supabase.from("transport_student_assignments").select("*").order("created_at", { ascending: false }),
      supabase.from("students").select("id, full_name, student_code").eq("status", "active").order("full_name"),
      supabase.from("staff_members").select("id, full_name").eq("status", "active").order("full_name"),
      supabase.rpc("transport_stats"),
    ]);
    setVehicles((vRes.data as VehicleRow[]) ?? []);
    setRoutes((rRes.data as RouteRow[]) ?? []);
    setAssignments((aRes.data as AssignmentRow[]) ?? []);
    setStudents((sRes.data as StudentOption[]) ?? []);
    setStaff((stRes.data as StaffOption[]) ?? []);
    if (statsRes.data && statsRes.data[0]) {
      const s = statsRes.data[0];
      setStats({
        total_vehicles: s.total_vehicles || 0,
        active_vehicles: s.active_vehicles || 0,
        total_routes: s.total_routes || 0,
        total_riders: s.total_riders || 0,
      });
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  /* ---------------- Vehicles ---------------- */
  const [showVehicleForm, setShowVehicleForm] = useState(false);
  const [savingVehicle, setSavingVehicle] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<VehicleRow | null>(null);
  const emptyVehicleForm = { vehicle_code: "", plate_number: "", make_model: "", capacity: "", vehicle_type: "bus", status: "active", driver_staff_id: "", driver_name: "", driver_phone: "", insurance_expiry: "", roadworthiness_expiry: "" };
  const [vehicleForm, setVehicleForm] = useState(emptyVehicleForm);

  function openVehicleForm(v?: VehicleRow) {
    if (v) {
      setEditingVehicle(v);
      setVehicleForm({
        vehicle_code: v.vehicle_code, plate_number: v.plate_number || "", make_model: v.make_model || "",
        capacity: v.capacity ? String(v.capacity) : "", vehicle_type: v.vehicle_type, status: v.status,
        driver_staff_id: v.driver_staff_id || "", driver_name: v.driver_name || "", driver_phone: v.driver_phone || "",
        insurance_expiry: v.insurance_expiry || "", roadworthiness_expiry: v.roadworthiness_expiry || "",
      });
    } else {
      setEditingVehicle(null);
      setVehicleForm(emptyVehicleForm);
    }
    setShowVehicleForm(true);
  }

  async function saveVehicle() {
    if (!vehicleForm.vehicle_code.trim()) { notify("Vehicle code is required.", "error"); return; }
    setSavingVehicle(true);
    const payload = {
      vehicle_code: vehicleForm.vehicle_code.trim(),
      plate_number: vehicleForm.plate_number.trim() || null,
      make_model: vehicleForm.make_model.trim() || null,
      capacity: vehicleForm.capacity ? parseInt(vehicleForm.capacity, 10) : null,
      vehicle_type: vehicleForm.vehicle_type,
      status: vehicleForm.status,
      driver_staff_id: vehicleForm.driver_staff_id || null,
      driver_name: vehicleForm.driver_name.trim() || null,
      driver_phone: vehicleForm.driver_phone.trim() || null,
      insurance_expiry: vehicleForm.insurance_expiry || null,
      roadworthiness_expiry: vehicleForm.roadworthiness_expiry || null,
      organization_id: orgId,
      updated_at: new Date().toISOString(),
    };
    const { error } = editingVehicle
      ? await supabase.from("transport_vehicles").update(payload).eq("id", editingVehicle.id)
      : await supabase.from("transport_vehicles").insert(payload);
    setSavingVehicle(false);
    if (error) { notify(extractErrorMessage(error, "Could not save vehicle"), "error"); return; }
    setShowVehicleForm(false); setEditingVehicle(null);
    notify(editingVehicle ? "Vehicle updated" : "Vehicle added");
    load();
  }

  async function deleteVehicle(v: VehicleRow) {
    if (!confirm(`Delete vehicle ${v.vehicle_code}? Routes using it will be unassigned.`)) return;
    const { error } = await supabase.from("transport_vehicles").delete().eq("id", v.id);
    if (error) { notify(extractErrorMessage(error, "Could not delete vehicle"), "error"); return; }
    notify("Vehicle deleted");
    load();
  }

  /* ---------------- Routes ---------------- */
  const [showRouteForm, setShowRouteForm] = useState(false);
  const [savingRoute, setSavingRoute] = useState(false);
  const [editingRoute, setEditingRoute] = useState<RouteRow | null>(null);
  const emptyRouteForm = { route_code: "", name: "", description: "", vehicle_id: "", departure_time: "", return_time: "", fee_per_term: "", status: "active" };
  const [routeForm, setRouteForm] = useState(emptyRouteForm);

  function openRouteForm(r?: RouteRow) {
    if (r) {
      setEditingRoute(r);
      setRouteForm({
        route_code: r.route_code, name: r.name, description: r.description || "",
        vehicle_id: r.vehicle_id || "", departure_time: r.departure_time || "", return_time: r.return_time || "",
        fee_per_term: r.fee_per_term ? String(r.fee_per_term) : "", status: r.status,
      });
    } else {
      setEditingRoute(null);
      setRouteForm(emptyRouteForm);
    }
    setShowRouteForm(true);
  }

  async function saveRoute() {
    if (!routeForm.route_code.trim() || !routeForm.name.trim()) { notify("Route code and name are required.", "error"); return; }
    setSavingRoute(true);
    const payload = {
      route_code: routeForm.route_code.trim(),
      name: routeForm.name.trim(),
      description: routeForm.description.trim() || null,
      vehicle_id: routeForm.vehicle_id || null,
      departure_time: routeForm.departure_time || null,
      return_time: routeForm.return_time || null,
      fee_per_term: routeForm.fee_per_term ? parseFloat(routeForm.fee_per_term) : null,
      status: routeForm.status,
      organization_id: orgId,
      updated_at: new Date().toISOString(),
    };
    const { error } = editingRoute
      ? await supabase.from("transport_routes").update(payload).eq("id", editingRoute.id)
      : await supabase.from("transport_routes").insert(payload);
    setSavingRoute(false);
    if (error) { notify(extractErrorMessage(error, "Could not save route"), "error"); return; }
    setShowRouteForm(false); setEditingRoute(null);
    notify(editingRoute ? "Route updated" : "Route added");
    load();
  }

  async function deleteRoute(r: RouteRow) {
    if (!confirm(`Delete route ${r.name}? Student assignments on it will be removed.`)) return;
    const { error } = await supabase.from("transport_routes").delete().eq("id", r.id);
    if (error) { notify(extractErrorMessage(error, "Could not delete route"), "error"); return; }
    notify("Route deleted");
    load();
  }

  /* ---------------- Riders (student assignments) ---------------- */
  const [showAssignForm, setShowAssignForm] = useState(false);
  const [savingAssign, setSavingAssign] = useState(false);
  const emptyAssignForm = { student_id: "", route_id: "", pickup_point: "", drop_off_point: "" };
  const [assignForm, setAssignForm] = useState(emptyAssignForm);

  function openAssignForm() {
    setAssignForm(emptyAssignForm);
    setShowAssignForm(true);
  }

  async function saveAssignment() {
    if (!assignForm.student_id || !assignForm.route_id) { notify("Select both a student and a route.", "error"); return; }
    setSavingAssign(true);
    const { error } = await supabase.from("transport_student_assignments").insert({
      student_id: assignForm.student_id,
      route_id: assignForm.route_id,
      pickup_point: assignForm.pickup_point.trim() || null,
      drop_off_point: assignForm.drop_off_point.trim() || null,
      organization_id: orgId,
    });
    setSavingAssign(false);
    if (error) { notify(extractErrorMessage(error, "Could not assign student to route"), "error"); return; }
    setShowAssignForm(false);
    notify("Student assigned to route");
    load();
  }

  async function removeAssignment(a: AssignmentRow) {
    if (!confirm("Remove this student from the route?")) return;
    const { error } = await supabase.from("transport_student_assignments").delete().eq("id", a.id);
    if (error) { notify(extractErrorMessage(error, "Could not remove assignment"), "error"); return; }
    notify("Removed");
    load();
  }

  /* ---------------- Derived / lookups ---------------- */
  const vehicleByIdMap = useMemo(() => new Map(vehicles.map(v => [v.id, v])), [vehicles]);
  const routeByIdMap = useMemo(() => new Map(routes.map(r => [r.id, r])), [routes]);
  const studentByIdMap = useMemo(() => new Map(students.map(s => [s.id, s])), [students]);

  const filteredVehicles = vehicles.filter(v => {
    const q = search.toLowerCase();
    return !q || v.vehicle_code.toLowerCase().includes(q) || (v.plate_number || "").toLowerCase().includes(q) || (v.driver_name || "").toLowerCase().includes(q);
  });
  const filteredRoutes = routes.filter(r => {
    const q = search.toLowerCase();
    return !q || r.route_code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q);
  });
  const filteredAssignments = assignments.filter(a => {
    const q = search.toLowerCase();
    if (!q) return true;
    const s = studentByIdMap.get(a.student_id);
    const r = routeByIdMap.get(a.route_id);
    return (s?.full_name || "").toLowerCase().includes(q) || (s?.student_code || "").toLowerCase().includes(q) || (r?.name || "").toLowerCase().includes(q);
  });

  if (loading) return <div className="p-6"><LoadingSpinner /></div>;

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="Transport" subtitle="Fleet, routes, and student ride assignments">
        {canEdit && tab === "vehicles" && <Button variant="gold" onClick={() => openVehicleForm()}><Plus size={14} /> Add Vehicle</Button>}
        {canEdit && tab === "routes" && <Button variant="gold" onClick={() => openRouteForm()}><Plus size={14} /> Add Route</Button>}
        {canEdit && tab === "riders" && <Button variant="gold" onClick={openAssignForm}><Plus size={14} /> Assign Student</Button>}
      </PageHeader>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border p-4 text-center">
          <div className="text-xl font-bold text-[#0F2A47]">{stats.total_vehicles}</div>
          <div className="text-xs text-gray-500">Vehicles</div>
        </div>
        <div className="bg-white rounded-xl border p-4 text-center">
          <div className="text-xl font-bold text-green-700">{stats.active_vehicles}</div>
          <div className="text-xs text-gray-500">Active</div>
        </div>
        <div className="bg-white rounded-xl border p-4 text-center">
          <div className="text-xl font-bold text-[#0F2A47]">{stats.total_routes}</div>
          <div className="text-xs text-gray-500">Routes</div>
        </div>
        <div className="bg-white rounded-xl border p-4 text-center">
          <div className="text-xl font-bold text-blue-700">{stats.total_riders}</div>
          <div className="text-xs text-gray-500">Riders</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        {([
          { id: "vehicles" as const, label: "Vehicles", icon: <Bus size={14} /> },
          { id: "routes" as const, label: "Routes", icon: <RouteIcon size={14} /> },
          { id: "riders" as const, label: "Riders", icon: <Users size={14} /> },
        ]).map(t => (
          <button
            key={t.id}
            onClick={() => { setTab(t.id); setSearch(""); }}
            className={cn(
              "flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors",
              tab === t.id ? "bg-[#0F2A47] text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            )}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          placeholder={tab === "vehicles" ? "Search by code, plate, driver..." : tab === "routes" ? "Search by code or name..." : "Search by student or route..."}
          value={search} onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
        />
      </div>

      {/* Vehicles tab */}
      {tab === "vehicles" && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-[#0F2A47] text-white">
                <th className="text-left px-4 py-3 text-xs font-semibold">Code</th>
                <th className="text-left px-4 py-3 text-xs font-semibold">Plate</th>
                <th className="text-left px-4 py-3 text-xs font-semibold">Make/Model</th>
                <th className="text-left px-4 py-3 text-xs font-semibold">Type</th>
                <th className="text-right px-4 py-3 text-xs font-semibold">Capacity</th>
                <th className="text-left px-4 py-3 text-xs font-semibold">Driver</th>
                <th className="text-left px-4 py-3 text-xs font-semibold">Status</th>
                <th className="px-4 py-3" />
              </tr></thead>
              <tbody>
                {filteredVehicles.length === 0 ? (
                  <tr><td colSpan={8}><EmptyState message="No vehicles found." icon={<Bus size={32} />} /></td></tr>
                ) : filteredVehicles.map(v => (
                  <tr key={v.id} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-medium">{v.vehicle_code}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-gray-500">{v.plate_number || "—"}</td>
                    <td className="px-4 py-2.5 text-gray-600">{v.make_model || "—"}</td>
                    <td className="px-4 py-2.5 text-gray-600 capitalize">{v.vehicle_type}</td>
                    <td className="px-4 py-2.5 text-right text-gray-600">{v.capacity ?? "—"}</td>
                    <td className="px-4 py-2.5 text-gray-600">
                      {v.driver_staff_id ? (staff.find(s => s.id === v.driver_staff_id)?.full_name || "—") : (v.driver_name || "—")}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={cn("px-2 py-0.5 rounded text-[10px] font-bold uppercase",
                        v.status === "active" ? "bg-green-100 text-green-700" : v.status === "maintenance" ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-500")}>
                        {v.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right space-x-2">
                      {canEdit && <>
                        <button onClick={() => openVehicleForm(v)} className="text-xs text-[#0F2A47] hover:underline">Edit</button>
                        <button onClick={() => deleteVehicle(v)} className="text-xs text-red-600 hover:underline">Delete</button>
                      </>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Routes tab */}
      {tab === "routes" && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-[#0F2A47] text-white">
                <th className="text-left px-4 py-3 text-xs font-semibold">Code</th>
                <th className="text-left px-4 py-3 text-xs font-semibold">Name</th>
                <th className="text-left px-4 py-3 text-xs font-semibold">Vehicle</th>
                <th className="text-left px-4 py-3 text-xs font-semibold">Departure</th>
                <th className="text-left px-4 py-3 text-xs font-semibold">Return</th>
                <th className="text-right px-4 py-3 text-xs font-semibold">Fee/Term</th>
                <th className="text-left px-4 py-3 text-xs font-semibold">Status</th>
                <th className="px-4 py-3" />
              </tr></thead>
              <tbody>
                {filteredRoutes.length === 0 ? (
                  <tr><td colSpan={8}><EmptyState message="No routes found." icon={<RouteIcon size={32} />} /></td></tr>
                ) : filteredRoutes.map(r => (
                  <tr key={r.id} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-medium">{r.route_code}</td>
                    <td className="px-4 py-2.5 text-gray-700">{r.name}</td>
                    <td className="px-4 py-2.5 text-gray-600">{r.vehicle_id ? (vehicleByIdMap.get(r.vehicle_id)?.vehicle_code || "—") : "—"}</td>
                    <td className="px-4 py-2.5 text-gray-500">{r.departure_time || "—"}</td>
                    <td className="px-4 py-2.5 text-gray-500">{r.return_time || "—"}</td>
                    <td className="px-4 py-2.5 text-right text-gray-600">{r.fee_per_term ? fmtMoney(r.fee_per_term) : "—"}</td>
                    <td className="px-4 py-2.5">
                      <span className={cn("px-2 py-0.5 rounded text-[10px] font-bold uppercase", r.status === "active" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500")}>
                        {r.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right space-x-2">
                      {canEdit && <>
                        <button onClick={() => openRouteForm(r)} className="text-xs text-[#0F2A47] hover:underline">Edit</button>
                        <button onClick={() => deleteRoute(r)} className="text-xs text-red-600 hover:underline">Delete</button>
                      </>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Riders tab */}
      {tab === "riders" && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-[#0F2A47] text-white">
                <th className="text-left px-4 py-3 text-xs font-semibold">Student</th>
                <th className="text-left px-4 py-3 text-xs font-semibold">Code</th>
                <th className="text-left px-4 py-3 text-xs font-semibold">Route</th>
                <th className="text-left px-4 py-3 text-xs font-semibold">Pickup</th>
                <th className="text-left px-4 py-3 text-xs font-semibold">Drop-off</th>
                <th className="text-left px-4 py-3 text-xs font-semibold">Status</th>
                <th className="px-4 py-3" />
              </tr></thead>
              <tbody>
                {filteredAssignments.length === 0 ? (
                  <tr><td colSpan={7}><EmptyState message="No students assigned to routes yet." icon={<Users size={32} />} /></td></tr>
                ) : filteredAssignments.map(a => {
                  const s = studentByIdMap.get(a.student_id);
                  const r = routeByIdMap.get(a.route_id);
                  return (
                    <tr key={a.id} className="border-b hover:bg-gray-50">
                      <td className="px-4 py-2.5 font-medium">{s?.full_name || "Unknown student"}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-gray-500">{s?.student_code || "—"}</td>
                      <td className="px-4 py-2.5 text-gray-600">{r?.name || "Unknown route"}</td>
                      <td className="px-4 py-2.5 text-gray-500">{a.pickup_point || "—"}</td>
                      <td className="px-4 py-2.5 text-gray-500">{a.drop_off_point || "—"}</td>
                      <td className="px-4 py-2.5">
                        <span className={cn("px-2 py-0.5 rounded text-[10px] font-bold uppercase", a.status === "active" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500")}>
                          {a.status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {canEdit && <button onClick={() => removeAssignment(a)} className="text-xs text-red-600 hover:underline">Remove</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Vehicle Modal */}
      {showVehicleForm && (
        <Modal open onClose={() => { setShowVehicleForm(false); setEditingVehicle(null); }} title={editingVehicle ? "Edit Vehicle" : "Add Vehicle"} size="lg">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Input label="Vehicle Code *" value={vehicleForm.vehicle_code} onChange={e => setVehicleForm(f => ({ ...f, vehicle_code: e.target.value }))} placeholder="BUS-01" />
              <Input label="Plate Number" value={vehicleForm.plate_number} onChange={e => setVehicleForm(f => ({ ...f, plate_number: e.target.value }))} placeholder="ABC-123-XY" />
              <Input label="Make / Model" value={vehicleForm.make_model} onChange={e => setVehicleForm(f => ({ ...f, make_model: e.target.value }))} placeholder="Toyota Hiace" />
              <Input label="Capacity" type="number" value={vehicleForm.capacity} onChange={e => setVehicleForm(f => ({ ...f, capacity: e.target.value }))} placeholder="18" />
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Vehicle Type</label>
                <select value={vehicleForm.vehicle_type} onChange={e => setVehicleForm(f => ({ ...f, vehicle_type: e.target.value }))} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227] bg-white">
                  <option value="bus">Bus</option><option value="van">Van</option><option value="car">Car</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                <select value={vehicleForm.status} onChange={e => setVehicleForm(f => ({ ...f, status: e.target.value }))} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227] bg-white">
                  <option value="active">Active</option><option value="maintenance">Maintenance</option><option value="retired">Retired</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Driver (staff)</label>
                <select value={vehicleForm.driver_staff_id} onChange={e => setVehicleForm(f => ({ ...f, driver_staff_id: e.target.value }))} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227] bg-white">
                  <option value="">None / see below</option>
                  {staff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                </select>
              </div>
              <Input label="Driver Name (if not staff)" value={vehicleForm.driver_name} onChange={e => setVehicleForm(f => ({ ...f, driver_name: e.target.value }))} placeholder="External driver name" />
              <Input label="Driver Phone" value={vehicleForm.driver_phone} onChange={e => setVehicleForm(f => ({ ...f, driver_phone: e.target.value }))} placeholder="0801..." />
              <Input label="Insurance Expiry" type="date" value={vehicleForm.insurance_expiry} onChange={e => setVehicleForm(f => ({ ...f, insurance_expiry: e.target.value }))} />
              <Input label="Roadworthiness Expiry" type="date" value={vehicleForm.roadworthiness_expiry} onChange={e => setVehicleForm(f => ({ ...f, roadworthiness_expiry: e.target.value }))} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setShowVehicleForm(false)}>Cancel</Button>
              <Button variant="gold" loading={savingVehicle} onClick={saveVehicle} disabled={!vehicleForm.vehicle_code.trim()}><Save size={14} /> {editingVehicle ? "Update" : "Add"}</Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Route Modal */}
      {showRouteForm && (
        <Modal open onClose={() => { setShowRouteForm(false); setEditingRoute(null); }} title={editingRoute ? "Edit Route" : "Add Route"} size="lg">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Input label="Route Code *" value={routeForm.route_code} onChange={e => setRouteForm(f => ({ ...f, route_code: e.target.value }))} placeholder="RT-01" />
              <Input label="Route Name *" value={routeForm.name} onChange={e => setRouteForm(f => ({ ...f, name: e.target.value }))} placeholder="Lekki - Ajah Route" />
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Vehicle</label>
                <select value={routeForm.vehicle_id} onChange={e => setRouteForm(f => ({ ...f, vehicle_id: e.target.value }))} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227] bg-white">
                  <option value="">Unassigned</option>
                  {vehicles.map(v => <option key={v.id} value={v.id}>{v.vehicle_code}{v.plate_number ? ` (${v.plate_number})` : ""}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                <select value={routeForm.status} onChange={e => setRouteForm(f => ({ ...f, status: e.target.value }))} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227] bg-white">
                  <option value="active">Active</option><option value="suspended">Suspended</option>
                </select>
              </div>
              <Input label="Departure Time" type="time" value={routeForm.departure_time} onChange={e => setRouteForm(f => ({ ...f, departure_time: e.target.value }))} />
              <Input label="Return Time" type="time" value={routeForm.return_time} onChange={e => setRouteForm(f => ({ ...f, return_time: e.target.value }))} />
              <Input label="Fee per Term (₦)" type="number" value={routeForm.fee_per_term} onChange={e => setRouteForm(f => ({ ...f, fee_per_term: e.target.value }))} placeholder="15000" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea value={routeForm.description} onChange={e => setRouteForm(f => ({ ...f, description: e.target.value }))} rows={2}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]" placeholder="Stops: Chevron, Ikate, Ajah roundabout..." />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setShowRouteForm(false)}>Cancel</Button>
              <Button variant="gold" loading={savingRoute} onClick={saveRoute} disabled={!routeForm.route_code.trim() || !routeForm.name.trim()}><Save size={14} /> {editingRoute ? "Update" : "Add"}</Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Assign Student Modal */}
      {showAssignForm && (
        <Modal open onClose={() => setShowAssignForm(false)} title="Assign Student to Route" size="lg">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Student *</label>
                <select value={assignForm.student_id} onChange={e => setAssignForm(f => ({ ...f, student_id: e.target.value }))} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227] bg-white">
                  <option value="">Select student...</option>
                  {students.map(s => <option key={s.id} value={s.id}>{s.full_name} ({s.student_code})</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Route *</label>
                <select value={assignForm.route_id} onChange={e => setAssignForm(f => ({ ...f, route_id: e.target.value }))} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227] bg-white">
                  <option value="">Select route...</option>
                  {routes.filter(r => r.status === "active").map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
              <Input label="Pickup Point" value={assignForm.pickup_point} onChange={e => setAssignForm(f => ({ ...f, pickup_point: e.target.value }))} placeholder="Chevron bus stop" />
              <Input label="Drop-off Point" value={assignForm.drop_off_point} onChange={e => setAssignForm(f => ({ ...f, drop_off_point: e.target.value }))} placeholder="Same as pickup" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setShowAssignForm(false)}>Cancel</Button>
              <Button variant="gold" loading={savingAssign} onClick={saveAssignment} disabled={!assignForm.student_id || !assignForm.route_id}><Save size={14} /> Assign</Button>
            </div>
          </div>
        </Modal>
      )}

      <ToastHost />
    </div>
  );
}
