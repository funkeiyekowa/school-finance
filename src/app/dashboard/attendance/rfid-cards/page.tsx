"use client";

/**
 * /dashboard/attendance/rfid-cards
 *
 * Admin page for assigning RFID/NFC card UIDs to students.
 *
 * Only org admins can access this page (server-side enforced via RLS/RPC).
 * Teachers see it but operations will be rejected by the DB policies.
 *
 * Features:
 *   - List current card assignments (with student name, UID, active status)
 *   - Assign a new card: select student + enter UID (manually or via RFID scan)
 *   - Deactivate / reactivate a card assignment
 *   - Live UID capture from HID keyboard reader (same pattern as scan page)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ArrowLeft, CreditCard, Radio, UserPlus } from "lucide-react";
import Link from "next/link";

// Module-level singleton — stable reference, prevents useCallback/useEffect re-firing
const supabase = createClient();

const FLUSH_TIMEOUT_MS = 100;
const MIN_UID_LENGTH = 4;

interface Assignment {
  id: string;
  student_id: string;
  student_name: string;
  card_uid: string;
  active: boolean;
  assigned_at: string;
}

interface Student {
  id: string;
  name: string;
}

export default function RfidCardsPage() {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [uidInput, setUidInput] = useState("");
  const [capturing, setCapturing] = useState(false);

  // HID capture buffer
  const buffer = useRef("");
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Get current org_id
      const { data: orgData, error: orgErr } = await supabase.rpc("current_user_org_id");
      if (orgErr || !orgData) { setError("Could not resolve organisation."); setLoading(false); return; }

      // Load assignments
      const { data: asgn, error: asgnErr } = await supabase.rpc(
        "list_rfid_card_assignments",
        { p_org_id: orgData }
      );
      if (asgnErr) { setError(asgnErr.message); setLoading(false); return; }
      setAssignments(asgn ?? []);

      // Load students for the dropdown
      const { data: studs, error: studsErr } = await supabase
        .from("students")
        .select("id, first_name, last_name")
        .order("last_name");
      if (studsErr) { setError(studsErr.message); setLoading(false); return; }
      setStudents(
        (studs ?? []).map(s => ({ id: s.id, name: `${s.last_name}, ${s.first_name}` }))
      );
    } finally {
      setLoading(false);
    }
  // supabase is a module-level singleton — not a reactive dep
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // HID keyboard capture
  const flushBuffer = useCallback(() => {
    const uid = buffer.current.trim().toUpperCase();
    buffer.current = "";
    if (uid.length >= MIN_UID_LENGTH) setUidInput(uid);
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta") return;
    if (e.key === "Enter") {
      if (flushTimer.current) { clearTimeout(flushTimer.current); flushTimer.current = null; }
      flushBuffer();
      return;
    }
    if (e.key.length === 1) {
      buffer.current += e.key;
      if (flushTimer.current) clearTimeout(flushTimer.current);
      flushTimer.current = setTimeout(flushBuffer, FLUSH_TIMEOUT_MS);
    }
  }, [flushBuffer]);

  useEffect(() => {
    if (!capturing) return;
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (flushTimer.current) clearTimeout(flushTimer.current);
      buffer.current = "";
    };
  }, [capturing, handleKeyDown]);

  async function assignCard() {
    if (!selectedStudentId || !uidInput.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const { error: insertErr } = await supabase
        .from("rfid_card_assignments")
        .insert({
          student_id: selectedStudentId,
          card_uid: uidInput.trim().toUpperCase(),
          active: true,
        });
      if (insertErr) { setError(insertErr.message); return; }
      setSelectedStudentId("");
      setUidInput("");
      setCapturing(false);
      await loadData();
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(id: string, currentActive: boolean) {
    const { error: updErr } = await supabase
      .from("rfid_card_assignments")
      .update({ active: !currentActive })
      .eq("id", id);
    if (updErr) { setError(updErr.message); return; }
    await loadData();
  }

  async function deleteAssignment(id: string) {
    const { error: delErr } = await supabase
      .from("rfid_card_assignments")
      .delete()
      .eq("id", id);
    if (delErr) { setError(delErr.message); return; }
    await loadData();
  }

  return (
    <div className="space-y-5 max-w-3xl mx-auto p-4">
      <div className="flex items-center gap-3">
        <Link href="/dashboard/attendance">
          <Button variant="ghost" size="sm"><ArrowLeft size={14} /> Back</Button>
        </Link>
        <div className="flex items-center gap-2">
          <CreditCard size={20} className="text-[#C9A227]" />
          <h1 className="text-lg font-bold text-gray-800">RFID Card Assignments</h1>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Assign new card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserPlus size={16} /> Assign New Card
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs font-medium text-gray-600 block mb-1">Student</label>
              <select
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
                value={selectedStudentId}
                onChange={e => setSelectedStudentId(e.target.value)}
              >
                <option value="">— select student —</option>
                {students.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div className="flex-1 min-w-[160px]">
              <label className="text-xs font-medium text-gray-600 block mb-1">
                Card UID
                {capturing && (
                  <span className="ml-2 text-[#C9A227] font-semibold animate-pulse">
                    ● Tap card now…
                  </span>
                )}
              </label>
              <input
                type="text"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227] font-mono"
                placeholder="e.g. A3F7C201"
                value={uidInput}
                onChange={e => setUidInput(e.target.value.toUpperCase())}
              />
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCapturing(c => !c)}
            >
              <Radio size={14} />
              {capturing ? "Stop Capture" : "Scan Card UID"}
            </Button>
            <Button
              variant="gold"
              size="sm"
              onClick={assignCard}
              disabled={!selectedStudentId || !uidInput.trim() || saving}
            >
              {saving ? "Saving…" : "Assign Card"}
            </Button>
          </div>
          <p className="text-xs text-gray-400">
            Click &quot;Scan Card UID&quot; then tap the card against the reader to auto-fill the UID,
            or type it manually.
          </p>
        </CardContent>
      </Card>

      {/* Existing assignments */}
      <Card>
        <CardHeader><CardTitle>Current Assignments</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-gray-400 py-4 text-center">Loading…</p>
          ) : assignments.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">
              No cards assigned yet. Use the form above to assign a card to a student.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-2 px-2 font-medium text-gray-600">Student</th>
                    <th className="text-left py-2 px-2 font-medium text-gray-600">Card UID</th>
                    <th className="text-left py-2 px-2 font-medium text-gray-600">Status</th>
                    <th className="text-left py-2 px-2 font-medium text-gray-600">Assigned</th>
                    <th className="py-2 px-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {assignments.map(a => (
                    <tr key={a.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-2 px-2 font-medium text-gray-800">{a.student_name}</td>
                      <td className="py-2 px-2 font-mono text-xs text-gray-600">{a.card_uid}</td>
                      <td className="py-2 px-2">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          a.active
                            ? "bg-green-100 text-green-700"
                            : "bg-gray-100 text-gray-500"
                        }`}>
                          {a.active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="py-2 px-2 text-xs text-gray-400">
                        {new Date(a.assigned_at).toLocaleDateString()}
                      </td>
                      <td className="py-2 px-2">
                        <div className="flex gap-1 justify-end">
                          <button
                            onClick={() => toggleActive(a.id, a.active)}
                            className="text-xs px-2 py-1 rounded border border-gray-200 hover:bg-gray-50 text-gray-600"
                          >
                            {a.active ? "Deactivate" : "Activate"}
                          </button>
                          <button
                            onClick={() => {
                              if (confirm(`Remove card ${a.card_uid} from ${a.student_name}?`)) {
                                deleteAssignment(a.id);
                              }
                            }}
                            className="text-xs px-2 py-1 rounded border border-red-200 hover:bg-red-50 text-red-600"
                          >
                            Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
