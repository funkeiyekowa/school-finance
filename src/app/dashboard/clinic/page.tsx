"use client";

/**
 * Health / Clinic module — school nurse dashboard.
 *
 * Four tabs:
 *   Visits         — append-only visit log; new visits go through the
 *                    clinic_log_visit RPC which atomically inserts the
 *                    visit + dispensed medications AND decrements
 *                    clinic_medications_inventory in one transaction.
 *   Patients       — per-subject medical profile (blood group,
 *                    allergies, chronic conditions, emergency contact).
 *   Medications    — nurse's stand-alone stock, with a low-stock filter.
 *   Vaccinations   — immunization history with next-dose reminders.
 *   Incidents      — parent-notifiable events (injuries, illness,
 *                    outbreaks), can link to a clinic_visit.
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { useToast } from "@/lib/hooks/useToast";
import { extractErrorMessage } from "@/lib/errors/extractErrorMessage";
import { fmtDate, fmtDateTime, cn, generateCode, today } from "@/lib/utils";
import { PageHeader, LoadingSpinner, EmptyState, KpiCard } from "@/components/ui/PageHeader";
import { Tabs, TabDef } from "@/components/ui/Tabs";
import { SetupHero } from "@/components/ui/SetupHero";
import { exportRowsAsCsv } from "@/lib/export/csv";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Stethoscope, Plus, HeartPulse, Pill, Syringe, AlertTriangle, Trash2, Users, AlertCircle, CheckCircle2, Download, Printer } from "lucide-react";

/* ---------------- Types ---------------- */
interface StudentOption { id: string; full_name: string; }
interface StaffOption { id: string; full_name: string; }

interface PatientRow {
  id: string; subject_type: string; student_id: string | null; staff_id: string | null;
  blood_group: string | null; allergies: string | null; chronic_conditions: string | null;
  current_medications: string | null; emergency_contact_name: string | null;
  emergency_contact_phone: string | null; emergency_contact_relationship: string | null;
  physician_name: string | null; physician_phone: string | null; insurance_provider: string | null;
  notes: string | null; created_at: string;
}
interface VisitRow {
  id: string; visit_code: string; subject_type: string; student_id: string | null; staff_id: string | null;
  visit_date: string; chief_complaint: string; temperature_c: number | null; blood_pressure: string | null;
  pulse_bpm: number | null; diagnosis: string | null; treatment_given: string | null; outcome: string;
  referred_to: string | null; parent_notified: boolean; attended_by_staff_id: string | null; notes: string | null;
  created_at: string;
}
interface MedicationRow {
  id: string; medication_code: string; name: string; dosage_form: string | null; strength: string | null;
  quantity_on_hand: number; unit: string; reorder_level: number; expiry_date: string | null;
  active: boolean; notes: string | null; created_at: string;
}
interface DispensedRow {
  id: string; visit_id: string; medication_id: string | null; medication_name: string;
  dosage: string | null; quantity_dispensed: number;
}
interface VaccinationRow {
  id: string; subject_type: string; student_id: string | null; staff_id: string | null;
  vaccine_name: string; administered_date: string; administered_by: string | null;
  dose_number: number | null; batch_number: string | null; next_dose_due: string | null; notes: string | null;
}
interface IncidentRow {
  id: string; incident_code: string; incident_type: string; incident_date: string;
  student_id: string | null; location: string | null; description: string; action_taken: string | null;
  severity: string; parent_notified: boolean; parent_notified_at: string | null;
  reported_by_staff_id: string | null; visit_id: string | null; created_at: string;
}
interface Stats {
  visits_today: number; visits_this_week: number; open_referrals: number;
  patients_with_allergies: number; low_stock_medications: number;
  incidents_this_month: number; vaccinations_due_soon: number;
}

type Tab = "visits" | "patients" | "medications" | "vaccinations" | "incidents";

/* ---------------- Blank form defaults ---------------- */
const emptyVisitForm = {
  subject_type: "student" as "student" | "staff",
  student_id: "", staff_id: "",
  chief_complaint: "", temperature_c: "", blood_pressure: "", pulse_bpm: "",
  diagnosis: "", treatment_given: "",
  outcome: "resolved", referred_to: "", parent_notified: false,
  attended_by_staff_id: "", notes: "",
};
const emptyMedLine = { medication_id: "", medication_name: "", dosage: "", quantity_dispensed: "1" };

const emptyPatientForm = {
  subject_type: "student" as "student" | "staff",
  student_id: "", staff_id: "",
  blood_group: "", allergies: "", chronic_conditions: "", current_medications: "",
  emergency_contact_name: "", emergency_contact_phone: "", emergency_contact_relationship: "",
  physician_name: "", physician_phone: "", insurance_provider: "", notes: "",
};

const emptyMedInventoryForm = {
  medication_code: "", name: "", dosage_form: "tablet", strength: "",
  quantity_on_hand: "0", unit: "tablet", reorder_level: "10", expiry_date: "",
};

const emptyVaccinationForm = {
  subject_type: "student" as "student" | "staff",
  student_id: "", staff_id: "",
  vaccine_name: "", administered_date: today(), administered_by: "",
  dose_number: "", batch_number: "", next_dose_due: "", notes: "",
};

const emptyIncidentForm = {
  incident_type: "injury", student_id: "", location: "",
  description: "", action_taken: "", severity: "minor",
  parent_notified: false, reported_by_staff_id: "",
};

export default function ClinicPage() {
  const { canEdit, orgId } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const { notify, ToastHost } = useToast();

  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("visits");

  const [students, setStudents] = useState<StudentOption[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [visits, setVisits] = useState<VisitRow[]>([]);
  const [dispensed, setDispensed] = useState<DispensedRow[]>([]);
  const [medications, setMedications] = useState<MedicationRow[]>([]);
  const [vaccinations, setVaccinations] = useState<VaccinationRow[]>([]);
  const [incidents, setIncidents] = useState<IncidentRow[]>([]);
  const [stats, setStats] = useState<Stats>({
    visits_today: 0, visits_this_week: 0, open_referrals: 0,
    patients_with_allergies: 0, low_stock_medications: 0,
    incidents_this_month: 0, vaccinations_due_soon: 0,
  });

  const load = useCallback(async () => {
    setLoading(true);
    const [stRes, sfRes, pRes, vRes, dRes, mRes, vacRes, incRes, statsRes] = await Promise.all([
      supabase.from("students").select("id, full_name").order("full_name"),
      supabase.from("staff_members").select("id, full_name").eq("status", "active").order("full_name"),
      supabase.from("clinic_patient_records").select("*").order("created_at", { ascending: false }),
      supabase.from("clinic_visits").select("*").order("visit_date", { ascending: false }),
      supabase.from("clinic_medications_dispensed").select("*"),
      supabase.from("clinic_medications_inventory").select("*").order("name"),
      supabase.from("clinic_vaccinations").select("*").order("administered_date", { ascending: false }),
      supabase.from("clinic_health_incidents").select("*").order("incident_date", { ascending: false }),
      supabase.rpc("clinic_stats"),
    ]);
    setStudents((stRes.data as StudentOption[]) ?? []);
    setStaff((sfRes.data as StaffOption[]) ?? []);
    setPatients((pRes.data as PatientRow[]) ?? []);
    setVisits((vRes.data as VisitRow[]) ?? []);
    setDispensed((dRes.data as DispensedRow[]) ?? []);
    setMedications((mRes.data as MedicationRow[]) ?? []);
    setVaccinations((vacRes.data as VaccinationRow[]) ?? []);
    setIncidents((incRes.data as IncidentRow[]) ?? []);
    if (statsRes.data && statsRes.data[0]) {
      const s = statsRes.data[0];
      setStats({
        visits_today: s.visits_today || 0,
        visits_this_week: s.visits_this_week || 0,
        open_referrals: s.open_referrals || 0,
        patients_with_allergies: s.patients_with_allergies || 0,
        low_stock_medications: s.low_stock_medications || 0,
        incidents_this_month: s.incidents_this_month || 0,
        vaccinations_due_soon: s.vaccinations_due_soon || 0,
      });
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const studentById = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);
  const staffById = useMemo(() => new Map(staff.map((s) => [s.id, s])), [staff]);
  const medById = useMemo(() => new Map(medications.map((m) => [m.id, m])), [medications]);
  const dispensedByVisit = useMemo(() => {
    const map: Record<string, DispensedRow[]> = {};
    for (const d of dispensed) (map[d.visit_id] ||= []).push(d);
    return map;
  }, [dispensed]);

  function subjectName(subjectType: string, studentId: string | null, staffId: string | null): string {
    if (subjectType === "student" && studentId) return studentById.get(studentId)?.full_name || "Unknown student";
    if (subjectType === "staff" && staffId) return staffById.get(staffId)?.full_name || "Unknown staff";
    return "—";
  }

  /* ---------------- New Visit ---------------- */
  const [showVisitForm, setShowVisitForm] = useState(false);
  const [visitForm, setVisitForm] = useState({ ...emptyVisitForm });
  const [visitMeds, setVisitMeds] = useState([{ ...emptyMedLine }]);
  const [savingVisit, setSavingVisit] = useState(false);

  function updateMedLine(idx: number, patch: Partial<typeof emptyMedLine>) {
    setVisitMeds((prev) => prev.map((l, i) => i === idx ? { ...l, ...patch } : l));
  }
  function addMedLine() { setVisitMeds((prev) => [...prev, { ...emptyMedLine }]); }
  function removeMedLine(idx: number) { setVisitMeds((prev) => prev.filter((_, i) => i !== idx)); }

  async function submitVisit() {
    if (!visitForm.chief_complaint.trim()) { notify("Chief complaint is required.", "error"); return; }
    if (visitForm.subject_type === "student" && !visitForm.student_id) { notify("Choose a student.", "error"); return; }
    if (visitForm.subject_type === "staff" && !visitForm.staff_id) { notify("Choose a staff member.", "error"); return; }
    setSavingVisit(true);
    try {
      const code = generateCode("CV-", visits.map((v) => v.visit_code));
      const validMeds = visitMeds.filter((m) => {
        // Either a medication is picked from stock, or a free-text medication name was typed
        if (m.medication_id) return true;
        return (m.medication_name || "").trim().length > 0;
      }).map((m) => {
        // When picking from stock and no free-text override, snapshot the med name from inventory
        const stockMed = m.medication_id ? medById.get(m.medication_id) : null;
        return {
          medication_id: m.medication_id || null,
          medication_name: (m.medication_name.trim() || stockMed?.name || "Unnamed"),
          dosage: m.dosage.trim() || null,
          quantity_dispensed: parseFloat(m.quantity_dispensed) || 0,
        };
      });

      const { error } = await supabase.rpc("clinic_log_visit", {
        p_subject_type: visitForm.subject_type,
        p_student_id: visitForm.subject_type === "student" ? visitForm.student_id : null,
        p_staff_id: visitForm.subject_type === "staff" ? visitForm.staff_id : null,
        p_visit_code: code,
        p_chief_complaint: visitForm.chief_complaint.trim(),
        p_temperature_c: visitForm.temperature_c.trim() ? parseFloat(visitForm.temperature_c) : null,
        p_blood_pressure: visitForm.blood_pressure.trim() || null,
        p_pulse_bpm: visitForm.pulse_bpm.trim() ? parseInt(visitForm.pulse_bpm) : null,
        p_diagnosis: visitForm.diagnosis.trim() || null,
        p_treatment_given: visitForm.treatment_given.trim() || null,
        p_outcome: visitForm.outcome,
        p_referred_to: visitForm.referred_to.trim() || null,
        p_parent_notified: visitForm.parent_notified,
        p_attended_by_staff_id: visitForm.attended_by_staff_id || null,
        p_notes: visitForm.notes.trim() || null,
        p_meds: validMeds,
      });
      if (error) throw error;
      notify(`Visit ${code} logged.`);
      setShowVisitForm(false);
      setVisitForm({ ...emptyVisitForm });
      setVisitMeds([{ ...emptyMedLine }]);
      load();
    } catch (err) {
      notify(extractErrorMessage(err, "Failed to log visit."), "error");
    } finally {
      setSavingVisit(false);
    }
  }

  /* ---------------- Patient records ---------------- */
  const [showPatientForm, setShowPatientForm] = useState(false);
  const [editingPatient, setEditingPatient] = useState<PatientRow | null>(null);
  const [patientForm, setPatientForm] = useState({ ...emptyPatientForm });
  const [savingPatient, setSavingPatient] = useState(false);

  function openNewPatient() {
    setEditingPatient(null);
    setPatientForm({ ...emptyPatientForm });
    setShowPatientForm(true);
  }
  function openEditPatient(p: PatientRow) {
    setEditingPatient(p);
    setPatientForm({
      subject_type: (p.subject_type as "student" | "staff"),
      student_id: p.student_id || "", staff_id: p.staff_id || "",
      blood_group: p.blood_group || "", allergies: p.allergies || "",
      chronic_conditions: p.chronic_conditions || "", current_medications: p.current_medications || "",
      emergency_contact_name: p.emergency_contact_name || "",
      emergency_contact_phone: p.emergency_contact_phone || "",
      emergency_contact_relationship: p.emergency_contact_relationship || "",
      physician_name: p.physician_name || "", physician_phone: p.physician_phone || "",
      insurance_provider: p.insurance_provider || "", notes: p.notes || "",
    });
    setShowPatientForm(true);
  }

  async function savePatient() {
    if (patientForm.subject_type === "student" && !patientForm.student_id) { notify("Choose a student.", "error"); return; }
    if (patientForm.subject_type === "staff" && !patientForm.staff_id) { notify("Choose a staff member.", "error"); return; }
    setSavingPatient(true);
    try {
      const payload = {
        subject_type: patientForm.subject_type,
        student_id: patientForm.subject_type === "student" ? patientForm.student_id : null,
        staff_id: patientForm.subject_type === "staff" ? patientForm.staff_id : null,
        blood_group: patientForm.blood_group.trim() || null,
        allergies: patientForm.allergies.trim() || null,
        chronic_conditions: patientForm.chronic_conditions.trim() || null,
        current_medications: patientForm.current_medications.trim() || null,
        emergency_contact_name: patientForm.emergency_contact_name.trim() || null,
        emergency_contact_phone: patientForm.emergency_contact_phone.trim() || null,
        emergency_contact_relationship: patientForm.emergency_contact_relationship.trim() || null,
        physician_name: patientForm.physician_name.trim() || null,
        physician_phone: patientForm.physician_phone.trim() || null,
        insurance_provider: patientForm.insurance_provider.trim() || null,
        notes: patientForm.notes.trim() || null,
        organization_id: orgId,
      };
      if (editingPatient) {
        const { error } = await supabase.from("clinic_patient_records").update(payload).eq("id", editingPatient.id);
        if (error) throw error;
        notify("Patient record updated.");
      } else {
        const { error } = await supabase.from("clinic_patient_records").insert(payload);
        if (error) throw error;
        notify("Patient record created.");
      }
      setShowPatientForm(false);
      load();
    } catch (err) {
      notify(extractErrorMessage(err, "Failed to save patient record."), "error");
    } finally {
      setSavingPatient(false);
    }
  }

  /* ---------------- Medication inventory ---------------- */
  const [showMedForm, setShowMedForm] = useState(false);
  const [editingMed, setEditingMed] = useState<MedicationRow | null>(null);
  const [medForm, setMedForm] = useState({ ...emptyMedInventoryForm });
  const [savingMed, setSavingMed] = useState(false);
  const [medFilter, setMedFilter] = useState<"all" | "low_stock" | "expiring">("all");

  function openNewMed() {
    setEditingMed(null);
    setMedForm({ ...emptyMedInventoryForm, medication_code: generateCode("MED-", medications.map((m) => m.medication_code)) });
    setShowMedForm(true);
  }
  function openEditMed(m: MedicationRow) {
    setEditingMed(m);
    setMedForm({
      medication_code: m.medication_code, name: m.name, dosage_form: m.dosage_form || "tablet",
      strength: m.strength || "", quantity_on_hand: String(m.quantity_on_hand), unit: m.unit,
      reorder_level: String(m.reorder_level), expiry_date: m.expiry_date || "",
    });
    setShowMedForm(true);
  }

  async function saveMed() {
    if (!medForm.name.trim()) { notify("Medication name is required.", "error"); return; }
    setSavingMed(true);
    try {
      const payload = {
        medication_code: medForm.medication_code.trim() || generateCode("MED-", medications.map((m) => m.medication_code)),
        name: medForm.name.trim(),
        dosage_form: medForm.dosage_form || null,
        strength: medForm.strength.trim() || null,
        quantity_on_hand: parseFloat(medForm.quantity_on_hand) || 0,
        unit: medForm.unit || "unit",
        reorder_level: parseFloat(medForm.reorder_level) || 0,
        expiry_date: medForm.expiry_date || null,
        organization_id: orgId,
      };
      if (editingMed) {
        const { error } = await supabase.from("clinic_medications_inventory").update(payload).eq("id", editingMed.id);
        if (error) throw error;
        notify("Medication updated.");
      } else {
        const { error } = await supabase.from("clinic_medications_inventory").insert(payload);
        if (error) throw error;
        notify("Medication added.");
      }
      setShowMedForm(false);
      load();
    } catch (err) {
      notify(extractErrorMessage(err, "Failed to save medication."), "error");
    } finally {
      setSavingMed(false);
    }
  }

  const filteredMedications = medications.filter((m) => {
    if (medFilter === "low_stock") return m.active && m.quantity_on_hand <= m.reorder_level;
    if (medFilter === "expiring") {
      if (!m.expiry_date) return false;
      const days = (new Date(m.expiry_date).getTime() - Date.now()) / (86400 * 1000);
      return days < 90;
    }
    return true;
  });

  /* ---------------- Vaccinations ---------------- */
  const [showVaccinationForm, setShowVaccinationForm] = useState(false);
  const [vaccinationForm, setVaccinationForm] = useState({ ...emptyVaccinationForm });
  const [savingVaccination, setSavingVaccination] = useState(false);

  async function saveVaccination() {
    if (!vaccinationForm.vaccine_name.trim()) { notify("Vaccine name required.", "error"); return; }
    if (vaccinationForm.subject_type === "student" && !vaccinationForm.student_id) { notify("Choose a student.", "error"); return; }
    if (vaccinationForm.subject_type === "staff" && !vaccinationForm.staff_id) { notify("Choose a staff member.", "error"); return; }
    setSavingVaccination(true);
    try {
      const payload = {
        subject_type: vaccinationForm.subject_type,
        student_id: vaccinationForm.subject_type === "student" ? vaccinationForm.student_id : null,
        staff_id: vaccinationForm.subject_type === "staff" ? vaccinationForm.staff_id : null,
        vaccine_name: vaccinationForm.vaccine_name.trim(),
        administered_date: vaccinationForm.administered_date,
        administered_by: vaccinationForm.administered_by.trim() || null,
        dose_number: vaccinationForm.dose_number.trim() ? parseInt(vaccinationForm.dose_number) : null,
        batch_number: vaccinationForm.batch_number.trim() || null,
        next_dose_due: vaccinationForm.next_dose_due || null,
        notes: vaccinationForm.notes.trim() || null,
        organization_id: orgId,
      };
      const { error } = await supabase.from("clinic_vaccinations").insert(payload);
      if (error) throw error;
      notify("Vaccination recorded.");
      setShowVaccinationForm(false);
      setVaccinationForm({ ...emptyVaccinationForm });
      load();
    } catch (err) {
      notify(extractErrorMessage(err, "Failed to record vaccination."), "error");
    } finally {
      setSavingVaccination(false);
    }
  }

  /* ---------------- Incidents ---------------- */
  const [showIncidentForm, setShowIncidentForm] = useState(false);
  const [incidentForm, setIncidentForm] = useState({ ...emptyIncidentForm });
  const [savingIncident, setSavingIncident] = useState(false);

  async function saveIncident() {
    if (!incidentForm.description.trim()) { notify("Description is required.", "error"); return; }
    setSavingIncident(true);
    try {
      const code = generateCode("HI-", incidents.map((i) => i.incident_code));
      const payload = {
        incident_code: code,
        incident_type: incidentForm.incident_type,
        student_id: incidentForm.student_id || null,
        location: incidentForm.location.trim() || null,
        description: incidentForm.description.trim(),
        action_taken: incidentForm.action_taken.trim() || null,
        severity: incidentForm.severity,
        parent_notified: incidentForm.parent_notified,
        parent_notified_at: incidentForm.parent_notified ? new Date().toISOString() : null,
        reported_by_staff_id: incidentForm.reported_by_staff_id || null,
        organization_id: orgId,
      };
      const { error } = await supabase.from("clinic_health_incidents").insert(payload);
      if (error) throw error;
      notify(`Incident ${code} logged.`);
      setShowIncidentForm(false);
      setIncidentForm({ ...emptyIncidentForm });
      load();
    } catch (err) {
      notify(extractErrorMessage(err, "Failed to log incident."), "error");
    } finally {
      setSavingIncident(false);
    }
  }

  async function markParentNotified(id: string) {
    try {
      const { error } = await supabase.from("clinic_health_incidents")
        .update({ parent_notified: true, parent_notified_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
      notify("Marked parent notified.");
      load();
    } catch (err) {
      notify(extractErrorMessage(err, "Update failed."), "error");
    }
  }

  /* ---------------- Detail view (visit expansion) ---------------- */
  const [expandedVisit, setExpandedVisit] = useState<string | null>(null);

  const TABS: TabDef<Tab>[] = [
    { key: "visits", label: "Visits", icon: <Stethoscope size={14} />, count: stats.visits_today },
    { key: "patients", label: "Patients", icon: <Users size={14} />, count: stats.patients_with_allergies },
    { key: "medications", label: "Medications", icon: <Pill size={14} />, count: stats.low_stock_medications },
    { key: "vaccinations", label: "Vaccinations", icon: <Syringe size={14} />, count: stats.vaccinations_due_soon },
    { key: "incidents", label: "Incidents", icon: <AlertTriangle size={14} />, count: stats.incidents_this_month },
  ];

  return (
    <div className="p-6 space-y-5">
      <PageHeader
        title="Health / Clinic"
        subtitle="Nurse's dashboard — visits, patient records, medications, vaccinations, incidents."
        eyebrow="Operations"
        icon={<Stethoscope size={22} />}
        gradient="rose"
        breadcrumb={[{ label: "Operations" }, { label: "Health" }]}
      >
        {tab === "visits" && visits.length > 0 && (
          <Button variant="secondary" onClick={() => exportRowsAsCsv(`clinic-visits-${new Date().toISOString().slice(0,10)}.csv`, visits, [
            { key: "visit_code", label: "Code" },
            { key: "visit_date", label: "Date" },
            { key: "subject_type", label: "Subject" },
            { key: "chief_complaint", label: "Complaint" },
            { key: "diagnosis", label: "Diagnosis" },
            { key: "outcome", label: "Outcome" },
            { key: "parent_notified", label: "Parent notified" },
          ])}><Download size={14} /> Export</Button>
        )}
        {canEdit && tab === "visits" && (
          <Button variant="gold" onClick={() => setShowVisitForm(true)}><Plus size={16} /> New Visit</Button>
        )}
        {canEdit && tab === "patients" && (
          <Button variant="gold" onClick={openNewPatient}><Plus size={16} /> New Patient Record</Button>
        )}
        {canEdit && tab === "medications" && (
          <Button variant="gold" onClick={openNewMed}><Plus size={16} /> Add Medication</Button>
        )}
        {canEdit && tab === "vaccinations" && (
          <Button variant="gold" onClick={() => setShowVaccinationForm(true)}><Plus size={16} /> Log Vaccination</Button>
        )}
        {canEdit && tab === "incidents" && (
          <Button variant="gold" onClick={() => setShowIncidentForm(true)}><Plus size={16} /> Log Incident</Button>
        )}
      </PageHeader>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Visits Today" value={String(stats.visits_today)} icon={<Stethoscope size={18} />} colorClass={stats.visits_today > 0 ? "text-emerald-600" : "text-[#0F2A47]"} />
        <KpiCard label="Visits This Week" value={String(stats.visits_this_week)} icon={<HeartPulse size={18} />} />
        <KpiCard label="Low-Stock Meds" value={String(stats.low_stock_medications)} icon={<Pill size={18} />} colorClass={stats.low_stock_medications > 0 ? "text-red-600" : "text-[#0F2A47]"} />
        <KpiCard label="Incidents This Month" value={String(stats.incidents_this_month)} icon={<AlertTriangle size={18} />} colorClass={stats.incidents_this_month > 0 ? "text-amber-600" : "text-[#0F2A47]"} />
      </div>

      <Tabs<Tab> tabs={TABS} value={tab} onChange={setTab} />

      {loading ? <LoadingSpinner /> : (
        <>
          {/* ---------------- VISITS ---------------- */}
          {tab === "visits" && (
            visits.length === 0 ? (
              <SetupHero
                icon={<Stethoscope size={40} />}
                title="Log your first clinic visit"
                description="Capture vitals, diagnosis, treatment, and dispensed medications for every student or staff visit. Medications are auto-decremented from clinic stock in the same transaction as the visit."
                bullets={[
                  "Vitals + diagnosis + treatment in one form",
                  "Server-side stock decrement (row-locked)",
                  "Parent-notification tracking",
                  "Full history per student across visits",
                ]}
                tone="rose"
                primaryCta={canEdit ? { label: "Log a visit", onClick: () => setShowVisitForm(true) } : { label: "Editors only", onClick: () => {}, disabled: true }}
              />
            ) : (
              <div className="space-y-2">
                {visits.map((v) => {
                  const meds = dispensedByVisit[v.id] || [];
                  const expanded = expandedVisit === v.id;
                  return (
                    <Card key={v.id}>
                      <div className="cursor-pointer" onClick={() => setExpandedVisit(expanded ? null : v.id)}>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-semibold text-[#0F2A47]">{v.visit_code}</span>
                              <span className={cn(
                                "text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full",
                                v.outcome === "resolved" ? "bg-emerald-100 text-emerald-700" :
                                v.outcome === "referred_out" ? "bg-red-100 text-red-700" :
                                v.outcome === "admitted" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"
                              )}>{v.outcome.replace("_", " ")}</span>
                              {v.parent_notified && <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700">parent notified</span>}
                            </div>
                            <p className="text-xs text-gray-500 mt-0.5">
                              {subjectName(v.subject_type, v.student_id, v.staff_id)} · {v.chief_complaint}
                            </p>
                            <p className="text-[11px] text-gray-400 mt-0.5">
                              {fmtDateTime(v.visit_date)}
                              {v.attended_by_staff_id ? ` · attended by ${staffById.get(v.attended_by_staff_id)?.full_name || "—"}` : ""}
                            </p>
                          </div>
                        </div>
                        {expanded && (
                          <div className="mt-3 pt-3 border-t border-gray-100 space-y-2 text-xs">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                              {v.temperature_c != null && <div><span className="text-gray-400">Temp</span><p>{v.temperature_c}°C</p></div>}
                              {v.blood_pressure && <div><span className="text-gray-400">BP</span><p>{v.blood_pressure}</p></div>}
                              {v.pulse_bpm != null && <div><span className="text-gray-400">Pulse</span><p>{v.pulse_bpm} bpm</p></div>}
                              {v.referred_to && <div><span className="text-gray-400">Referred</span><p>{v.referred_to}</p></div>}
                            </div>
                            {v.diagnosis && <p><span className="text-gray-400">Diagnosis:</span> {v.diagnosis}</p>}
                            {v.treatment_given && <p><span className="text-gray-400">Treatment:</span> {v.treatment_given}</p>}
                            {meds.length > 0 && (
                              <div>
                                <p className="text-gray-400 mb-1">Medications dispensed:</p>
                                <div className="space-y-1">
                                  {meds.map((m) => (
                                    <div key={m.id} className="bg-gray-50 rounded-lg px-3 py-1.5 flex items-center justify-between">
                                      <span className="text-gray-700">{m.medication_name}{m.dosage ? ` — ${m.dosage}` : ""}</span>
                                      <span className="text-gray-400">× {m.quantity_dispensed}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            {v.notes && <p className="italic text-gray-500">&ldquo;{v.notes}&rdquo;</p>}
                            <div className="pt-2 flex justify-end">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  window.open(`/dashboard/clinic/visits/${v.id}/print`, "_blank");
                                }}
                                className="text-xs text-[#0F2A47] hover:text-[#C9A227] flex items-center gap-1"
                                title="Open printable visit summary"
                              >
                                <Printer size={11} /> Print summary
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </Card>
                  );
                })}
              </div>
            )
          )}

          {/* ---------------- PATIENTS ---------------- */}
          {tab === "patients" && (
            patients.length === 0 ? (
              <EmptyState message="No patient medical records yet." icon={<Users size={40} />} />
            ) : (
              <div className="space-y-2">
                {patients.map((p) => (
                  <Card key={p.id} className="!p-4 cursor-pointer hover:shadow-md transition-shadow" onClick={() => canEdit && openEditPatient(p)}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-[#0F2A47]">{subjectName(p.subject_type, p.student_id, p.staff_id)}</span>
                          {p.blood_group && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">{p.blood_group}</span>}
                          {p.allergies && <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 flex items-center gap-0.5"><AlertCircle size={10} /> allergies</span>}
                          {p.chronic_conditions && <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700">chronic</span>}
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {p.allergies ? `Allergies: ${p.allergies}` : ""}
                          {p.allergies && p.chronic_conditions ? " · " : ""}
                          {p.chronic_conditions ? `Chronic: ${p.chronic_conditions}` : ""}
                        </p>
                        {p.emergency_contact_name && (
                          <p className="text-[11px] text-gray-400 mt-0.5">
                            Emergency: {p.emergency_contact_name}{p.emergency_contact_relationship ? ` (${p.emergency_contact_relationship})` : ""}{p.emergency_contact_phone ? ` — ${p.emergency_contact_phone}` : ""}
                          </p>
                        )}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )
          )}

          {/* ---------------- MEDICATIONS ---------------- */}
          {tab === "medications" && (
            <div className="space-y-3">
              <div className="flex gap-1.5 flex-wrap">
                {(["all", "low_stock", "expiring"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setMedFilter(f)}
                    className={cn(
                      "text-xs font-medium px-3 py-1.5 rounded-full border",
                      medFilter === f ? "bg-[#0F2A47] text-white border-[#0F2A47]" : "bg-white border-gray-200 text-gray-600"
                    )}
                  >
                    {f === "all" ? "All" : f === "low_stock" ? "Low stock" : "Expiring < 90 days"}
                  </button>
                ))}
              </div>
              {filteredMedications.length === 0 ? (
                <EmptyState message="No medications match this filter." icon={<Pill size={40} />} />
              ) : (
                <div className="space-y-2">
                  {filteredMedications.map((m) => {
                    const lowStock = m.quantity_on_hand <= m.reorder_level;
                    return (
                      <Card key={m.id} className="!p-4 cursor-pointer hover:shadow-md transition-shadow" onClick={() => canEdit && openEditMed(m)}>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-semibold text-[#0F2A47]">{m.medication_code} · {m.name}</span>
                              {m.strength && <span className="text-[10px] text-gray-400">{m.strength}</span>}
                              {lowStock && <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">low stock</span>}
                            </div>
                            <p className="text-xs text-gray-500 mt-0.5">
                              {m.quantity_on_hand} {m.unit}{m.reorder_level > 0 ? ` · reorder at ${m.reorder_level}` : ""}
                              {m.expiry_date ? ` · exp ${fmtDate(m.expiry_date)}` : ""}
                            </p>
                          </div>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ---------------- VACCINATIONS ---------------- */}
          {tab === "vaccinations" && (
            vaccinations.length === 0 ? (
              <EmptyState message="No vaccinations recorded yet." icon={<Syringe size={40} />} />
            ) : (
              <div className="space-y-2">
                {vaccinations.map((v) => {
                  const overdue = v.next_dose_due && new Date(v.next_dose_due) <= new Date();
                  return (
                    <Card key={v.id} className="!p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold text-[#0F2A47]">{v.vaccine_name}</span>
                            {v.dose_number && <span className="text-[10px] text-gray-400">Dose {v.dose_number}</span>}
                            {overdue && <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">next dose overdue</span>}
                            {!overdue && v.next_dose_due && <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">next dose {fmtDate(v.next_dose_due)}</span>}
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {subjectName(v.subject_type, v.student_id, v.staff_id)}
                            {" · "}{fmtDate(v.administered_date)}
                            {v.administered_by ? ` · by ${v.administered_by}` : ""}
                            {v.batch_number ? ` · batch ${v.batch_number}` : ""}
                          </p>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )
          )}

          {/* ---------------- INCIDENTS ---------------- */}
          {tab === "incidents" && (
            incidents.length === 0 ? (
              <EmptyState message="No health incidents logged." icon={<AlertTriangle size={40} />} />
            ) : (
              <div className="space-y-2">
                {incidents.map((i) => (
                  <Card key={i.id} className="!p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-[#0F2A47]">{i.incident_code}</span>
                          <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 capitalize">{i.incident_type.replace("_", " ")}</span>
                          <span className={cn(
                            "text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full",
                            i.severity === "severe" ? "bg-red-100 text-red-700" :
                            i.severity === "moderate" ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600"
                          )}>{i.severity}</span>
                          {i.parent_notified ? (
                            <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 flex items-center gap-0.5"><CheckCircle2 size={10} /> parent notified</span>
                          ) : (
                            <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">notify parent</span>
                          )}
                        </div>
                        <p className="text-xs text-gray-600 mt-0.5">{i.description}</p>
                        <p className="text-[11px] text-gray-400 mt-0.5">
                          {fmtDateTime(i.incident_date)}
                          {i.student_id ? ` · ${studentById.get(i.student_id)?.full_name || "Unknown student"}` : ""}
                          {i.location ? ` · ${i.location}` : ""}
                        </p>
                        {i.action_taken && <p className="text-[11px] text-gray-500 italic mt-0.5">Action: {i.action_taken}</p>}
                      </div>
                      {canEdit && !i.parent_notified && (
                        <Button variant="secondary" size="sm" onClick={() => markParentNotified(i.id)}>Mark Notified</Button>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            )
          )}
        </>
      )}

      {/* ---------------- New Visit Modal ---------------- */}
      <Modal open={showVisitForm} onClose={() => setShowVisitForm(false)} title="New Clinic Visit" size="xl">
        <div className="space-y-3">
          <div className="flex gap-1.5">
            {(["student", "staff"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setVisitForm({ ...visitForm, subject_type: t, student_id: "", staff_id: "" })}
                className={cn(
                  "text-xs font-medium px-3 py-1.5 rounded-full border capitalize",
                  visitForm.subject_type === t ? "bg-[#0F2A47] text-white border-[#0F2A47]" : "bg-white border-gray-200 text-gray-600"
                )}
              >{t}</button>
            ))}
          </div>

          {visitForm.subject_type === "student" ? (
            <Select label="Student" value={visitForm.student_id}
              onChange={(e) => setVisitForm({ ...visitForm, student_id: e.target.value })}
              options={students.map((s) => ({ value: s.id, label: s.full_name }))}
              placeholder="Choose a student" />
          ) : (
            <Select label="Staff" value={visitForm.staff_id}
              onChange={(e) => setVisitForm({ ...visitForm, staff_id: e.target.value })}
              options={staff.map((s) => ({ value: s.id, label: s.full_name }))}
              placeholder="Choose a staff member" />
          )}

          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Chief complaint</label>
            <textarea
              value={visitForm.chief_complaint}
              onChange={(e) => setVisitForm({ ...visitForm, chief_complaint: e.target.value })}
              rows={2}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Input label="Temperature (°C)" type="number" step="0.1" value={visitForm.temperature_c} onChange={(e) => setVisitForm({ ...visitForm, temperature_c: e.target.value })} />
            <Input label="Blood pressure" placeholder="120/80" value={visitForm.blood_pressure} onChange={(e) => setVisitForm({ ...visitForm, blood_pressure: e.target.value })} />
            <Input label="Pulse (bpm)" type="number" value={visitForm.pulse_bpm} onChange={(e) => setVisitForm({ ...visitForm, pulse_bpm: e.target.value })} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">Diagnosis</label>
              <textarea
                value={visitForm.diagnosis}
                onChange={(e) => setVisitForm({ ...visitForm, diagnosis: e.target.value })}
                rows={2}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">Treatment given</label>
              <textarea
                value={visitForm.treatment_given}
                onChange={(e) => setVisitForm({ ...visitForm, treatment_given: e.target.value })}
                rows={2}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Select label="Outcome" value={visitForm.outcome} onChange={(e) => setVisitForm({ ...visitForm, outcome: e.target.value })}
              options={[
                { value: "resolved", label: "Resolved on site" },
                { value: "sent_home", label: "Sent home" },
                { value: "referred_out", label: "Referred out" },
                { value: "admitted", label: "Admitted" },
              ]} />
            <Input label="Referred to (if applicable)" value={visitForm.referred_to} onChange={(e) => setVisitForm({ ...visitForm, referred_to: e.target.value })} />
          </div>

          <Select label="Attended by (nurse)" value={visitForm.attended_by_staff_id}
            onChange={(e) => setVisitForm({ ...visitForm, attended_by_staff_id: e.target.value })}
            options={staff.map((s) => ({ value: s.id, label: s.full_name }))}
            placeholder="Not recorded" />

          {/* Meds dispensed */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-gray-700">Medications dispensed</label>
              <button onClick={addMedLine} className="text-xs text-[#0F2A47] hover:text-[#C9A227] flex items-center gap-1"><Plus size={12} /> Add med</button>
            </div>
            {visitMeds.map((line, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-start">
                <div className="col-span-4">
                  <select
                    value={line.medication_id}
                    onChange={(e) => {
                      const stockMed = e.target.value ? medById.get(e.target.value) : null;
                      updateMedLine(idx, { medication_id: e.target.value, medication_name: stockMed?.name || line.medication_name });
                    }}
                    className="w-full px-2.5 py-2 border border-gray-300 rounded-lg text-xs bg-white"
                  >
                    <option value="">From stock (or free-text)</option>
                    {medications.filter((m) => m.active).map((m) => (
                      <option key={m.id} value={m.id}>{m.name} ({m.quantity_on_hand} {m.unit})</option>
                    ))}
                  </select>
                </div>
                <div className="col-span-3">
                  <input
                    value={line.medication_name}
                    onChange={(e) => updateMedLine(idx, { medication_name: e.target.value })}
                    placeholder="Med name (if not in stock)"
                    className="w-full px-2.5 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
                <div className="col-span-3">
                  <input
                    value={line.dosage}
                    onChange={(e) => updateMedLine(idx, { dosage: e.target.value })}
                    placeholder="Dosage (e.g. 1 tab bid × 3d)"
                    className="w-full px-2.5 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
                <div className="col-span-1">
                  <input
                    type="number"
                    value={line.quantity_dispensed}
                    onChange={(e) => updateMedLine(idx, { quantity_dispensed: e.target.value })}
                    placeholder="Qty"
                    className="w-full px-2.5 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
                <div className="col-span-1 flex justify-center pt-2">
                  {visitMeds.length > 1 && (
                    <button onClick={() => removeMedLine(idx)} className="text-red-400 hover:text-red-600"><Trash2 size={14} /></button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={visitForm.parent_notified} onChange={(e) => setVisitForm({ ...visitForm, parent_notified: e.target.checked })} />
            Parent notified
          </label>

          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Notes (optional)</label>
            <textarea
              value={visitForm.notes}
              onChange={(e) => setVisitForm({ ...visitForm, notes: e.target.value })}
              rows={2}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowVisitForm(false)}>Cancel</Button>
            <Button variant="gold" onClick={submitVisit} loading={savingVisit}>Log Visit</Button>
          </div>
        </div>
      </Modal>

      {/* ---------------- Patient Modal ---------------- */}
      <Modal open={showPatientForm} onClose={() => setShowPatientForm(false)} title={editingPatient ? "Edit Patient Record" : "New Patient Record"} size="lg">
        <div className="space-y-3">
          {!editingPatient && (
            <div className="flex gap-1.5">
              {(["student", "staff"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setPatientForm({ ...patientForm, subject_type: t, student_id: "", staff_id: "" })}
                  className={cn(
                    "text-xs font-medium px-3 py-1.5 rounded-full border capitalize",
                    patientForm.subject_type === t ? "bg-[#0F2A47] text-white border-[#0F2A47]" : "bg-white border-gray-200 text-gray-600"
                  )}
                >{t}</button>
              ))}
            </div>
          )}
          {!editingPatient && (
            patientForm.subject_type === "student" ? (
              <Select label="Student" value={patientForm.student_id}
                onChange={(e) => setPatientForm({ ...patientForm, student_id: e.target.value })}
                options={students.map((s) => ({ value: s.id, label: s.full_name }))} placeholder="Choose a student" />
            ) : (
              <Select label="Staff" value={patientForm.staff_id}
                onChange={(e) => setPatientForm({ ...patientForm, staff_id: e.target.value })}
                options={staff.map((s) => ({ value: s.id, label: s.full_name }))} placeholder="Choose a staff member" />
            )
          )}

          <div className="grid grid-cols-3 gap-3">
            <Input label="Blood group" placeholder="O+" value={patientForm.blood_group} onChange={(e) => setPatientForm({ ...patientForm, blood_group: e.target.value })} />
            <Input label="Physician name" value={patientForm.physician_name} onChange={(e) => setPatientForm({ ...patientForm, physician_name: e.target.value })} />
            <Input label="Physician phone" value={patientForm.physician_phone} onChange={(e) => setPatientForm({ ...patientForm, physician_phone: e.target.value })} />
          </div>

          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Allergies</label>
            <textarea value={patientForm.allergies} onChange={(e) => setPatientForm({ ...patientForm, allergies: e.target.value })}
              rows={2} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Chronic conditions</label>
            <textarea value={patientForm.chronic_conditions} onChange={(e) => setPatientForm({ ...patientForm, chronic_conditions: e.target.value })}
              rows={2} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Current medications (taken at home)</label>
            <textarea value={patientForm.current_medications} onChange={(e) => setPatientForm({ ...patientForm, current_medications: e.target.value })}
              rows={2} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm" />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Input label="Emergency contact" value={patientForm.emergency_contact_name} onChange={(e) => setPatientForm({ ...patientForm, emergency_contact_name: e.target.value })} />
            <Input label="Relationship" value={patientForm.emergency_contact_relationship} onChange={(e) => setPatientForm({ ...patientForm, emergency_contact_relationship: e.target.value })} />
            <Input label="Phone" value={patientForm.emergency_contact_phone} onChange={(e) => setPatientForm({ ...patientForm, emergency_contact_phone: e.target.value })} />
          </div>

          <Input label="Insurance provider" value={patientForm.insurance_provider} onChange={(e) => setPatientForm({ ...patientForm, insurance_provider: e.target.value })} />

          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Notes (optional)</label>
            <textarea value={patientForm.notes} onChange={(e) => setPatientForm({ ...patientForm, notes: e.target.value })}
              rows={2} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm" />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowPatientForm(false)}>Cancel</Button>
            <Button variant="gold" onClick={savePatient} loading={savingPatient}>{editingPatient ? "Save Changes" : "Create Record"}</Button>
          </div>
        </div>
      </Modal>

      {/* ---------------- Medication Inventory Modal ---------------- */}
      <Modal open={showMedForm} onClose={() => setShowMedForm(false)} title={editingMed ? `Edit ${editingMed.medication_code}` : "Add Medication"}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Medication code" value={medForm.medication_code} onChange={(e) => setMedForm({ ...medForm, medication_code: e.target.value })} />
            <Input label="Name" value={medForm.name} onChange={(e) => setMedForm({ ...medForm, name: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Select label="Dosage form" value={medForm.dosage_form} onChange={(e) => setMedForm({ ...medForm, dosage_form: e.target.value })}
              options={[
                { value: "tablet", label: "Tablet" }, { value: "capsule", label: "Capsule" },
                { value: "syrup", label: "Syrup" }, { value: "ointment", label: "Ointment" },
                { value: "injection", label: "Injection" }, { value: "other", label: "Other" },
              ]} />
            <Input label="Strength" placeholder="500mg" value={medForm.strength} onChange={(e) => setMedForm({ ...medForm, strength: e.target.value })} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Input label="Quantity" type="number" value={medForm.quantity_on_hand} onChange={(e) => setMedForm({ ...medForm, quantity_on_hand: e.target.value })} />
            <Input label="Unit" value={medForm.unit} onChange={(e) => setMedForm({ ...medForm, unit: e.target.value })} />
            <Input label="Reorder at" type="number" value={medForm.reorder_level} onChange={(e) => setMedForm({ ...medForm, reorder_level: e.target.value })} />
          </div>
          <Input label="Expiry date" type="date" value={medForm.expiry_date} onChange={(e) => setMedForm({ ...medForm, expiry_date: e.target.value })} />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowMedForm(false)}>Cancel</Button>
            <Button variant="gold" onClick={saveMed} loading={savingMed}>{editingMed ? "Save Changes" : "Add"}</Button>
          </div>
        </div>
      </Modal>

      {/* ---------------- Vaccination Modal ---------------- */}
      <Modal open={showVaccinationForm} onClose={() => setShowVaccinationForm(false)} title="Log Vaccination">
        <div className="space-y-3">
          <div className="flex gap-1.5">
            {(["student", "staff"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setVaccinationForm({ ...vaccinationForm, subject_type: t, student_id: "", staff_id: "" })}
                className={cn(
                  "text-xs font-medium px-3 py-1.5 rounded-full border capitalize",
                  vaccinationForm.subject_type === t ? "bg-[#0F2A47] text-white border-[#0F2A47]" : "bg-white border-gray-200 text-gray-600"
                )}
              >{t}</button>
            ))}
          </div>
          {vaccinationForm.subject_type === "student" ? (
            <Select label="Student" value={vaccinationForm.student_id}
              onChange={(e) => setVaccinationForm({ ...vaccinationForm, student_id: e.target.value })}
              options={students.map((s) => ({ value: s.id, label: s.full_name }))} placeholder="Choose a student" />
          ) : (
            <Select label="Staff" value={vaccinationForm.staff_id}
              onChange={(e) => setVaccinationForm({ ...vaccinationForm, staff_id: e.target.value })}
              options={staff.map((s) => ({ value: s.id, label: s.full_name }))} placeholder="Choose a staff member" />
          )}
          <Input label="Vaccine name" value={vaccinationForm.vaccine_name} onChange={(e) => setVaccinationForm({ ...vaccinationForm, vaccine_name: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Administered date" type="date" value={vaccinationForm.administered_date} onChange={(e) => setVaccinationForm({ ...vaccinationForm, administered_date: e.target.value })} />
            <Input label="Administered by" value={vaccinationForm.administered_by} onChange={(e) => setVaccinationForm({ ...vaccinationForm, administered_by: e.target.value })} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Input label="Dose number" type="number" value={vaccinationForm.dose_number} onChange={(e) => setVaccinationForm({ ...vaccinationForm, dose_number: e.target.value })} />
            <Input label="Batch number" value={vaccinationForm.batch_number} onChange={(e) => setVaccinationForm({ ...vaccinationForm, batch_number: e.target.value })} />
            <Input label="Next dose due" type="date" value={vaccinationForm.next_dose_due} onChange={(e) => setVaccinationForm({ ...vaccinationForm, next_dose_due: e.target.value })} />
          </div>
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Notes (optional)</label>
            <textarea value={vaccinationForm.notes} onChange={(e) => setVaccinationForm({ ...vaccinationForm, notes: e.target.value })}
              rows={2} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowVaccinationForm(false)}>Cancel</Button>
            <Button variant="gold" onClick={saveVaccination} loading={savingVaccination}>Save</Button>
          </div>
        </div>
      </Modal>

      {/* ---------------- Incident Modal ---------------- */}
      <Modal open={showIncidentForm} onClose={() => setShowIncidentForm(false)} title="Log Health Incident">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Select label="Type" value={incidentForm.incident_type} onChange={(e) => setIncidentForm({ ...incidentForm, incident_type: e.target.value })}
              options={[
                { value: "injury", label: "Injury" }, { value: "illness", label: "Illness" },
                { value: "outbreak", label: "Outbreak" }, { value: "allergic_reaction", label: "Allergic reaction" },
                { value: "other", label: "Other" },
              ]} />
            <Select label="Severity" value={incidentForm.severity} onChange={(e) => setIncidentForm({ ...incidentForm, severity: e.target.value })}
              options={[{ value: "minor", label: "Minor" }, { value: "moderate", label: "Moderate" }, { value: "severe", label: "Severe" }]} />
          </div>
          <Select label="Student (optional)" value={incidentForm.student_id}
            onChange={(e) => setIncidentForm({ ...incidentForm, student_id: e.target.value })}
            options={students.map((s) => ({ value: s.id, label: s.full_name }))} placeholder="No specific student" />
          <Input label="Location" placeholder="Science Lab 2 / Football Field" value={incidentForm.location} onChange={(e) => setIncidentForm({ ...incidentForm, location: e.target.value })} />
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Description</label>
            <textarea value={incidentForm.description} onChange={(e) => setIncidentForm({ ...incidentForm, description: e.target.value })}
              rows={2} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Action taken</label>
            <textarea value={incidentForm.action_taken} onChange={(e) => setIncidentForm({ ...incidentForm, action_taken: e.target.value })}
              rows={2} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm" />
          </div>
          <Select label="Reported by (staff)" value={incidentForm.reported_by_staff_id}
            onChange={(e) => setIncidentForm({ ...incidentForm, reported_by_staff_id: e.target.value })}
            options={staff.map((s) => ({ value: s.id, label: s.full_name }))} placeholder="Not recorded" />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={incidentForm.parent_notified} onChange={(e) => setIncidentForm({ ...incidentForm, parent_notified: e.target.checked })} />
            Parent notified
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowIncidentForm(false)}>Cancel</Button>
            <Button variant="gold" onClick={saveIncident} loading={savingIncident}>Log Incident</Button>
          </div>
        </div>
      </Modal>

      <ToastHost />
    </div>
  );
}
