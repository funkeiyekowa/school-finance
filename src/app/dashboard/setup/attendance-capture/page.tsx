"use client";

/**
 * /dashboard/setup/attendance-capture
 *
 * Lets an org admin configure which attendance capture methods are
 * enabled for their school, and toggle the AI insights layer.
 *
 * Backed by attendance_capture_settings (one row per org).
 * RLS: any org member can read; only org admins can write.
 * Gated by /dashboard/setup layout's server-side admin-only guard.
 *
 * Does NOT modify /api/attendance/ingest — registered devices can
 * always push regardless of this config. Config gates the UI only.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader, LoadingSpinner } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ArrowLeft, Save, CheckCircle2, ScanLine } from "lucide-react";
import Link from "next/link";

const SUPPORTED_METHODS = [
  { code: "manual",  label: "Manual",      description: "Teachers mark attendance by hand on the attendance page." },
  { code: "qr",      label: "QR / Camera", description: "Students present a printed QR code; a camera-equipped device scans it." },
  { code: "rfid",    label: "RFID / NFC",  description: "Students tap an RFID card on a registered reader device." },
] as const;

type CaptureMethod = "manual" | "qr" | "rfid";

interface ACSRow {
  id: string;
  organization_id: string;
  enabled_capture_methods: CaptureMethod[];
  ai_insights_enabled: boolean;
}

export default function AttendanceCaptureSettingsPage() {
  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rowId, setRowId] = useState<string | null>(null);
  const [enabled, setEnabled] = useState<Set<CaptureMethod>>(new Set(["manual"]));
  const [aiEnabled, setAiEnabled] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase.rpc("get_my_attendance_capture_settings");
    if (err || !data) {
      setError(err?.message ?? "Could not load settings.");
    } else {
      const row = data as unknown as ACSRow;
      setRowId(row.id);
      setEnabled(new Set((row.enabled_capture_methods ?? ["manual"]) as CaptureMethod[]));
      setAiEnabled(row.ai_insights_enabled ?? false);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  function toggle(code: CaptureMethod) {
    if (code === "manual") return; // always on
    setEnabled(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code); else next.add(code);
      return next;
    });
  }

  async function save() {
    if (!rowId) return;
    setSaving(true);
    setError(null);
    const { error: err } = await supabase
      .from("attendance_capture_settings")
      .update({
        enabled_capture_methods: Array.from(enabled),
        ai_insights_enabled: aiEnabled,
        updated_at: new Date().toISOString(),
      })
      .eq("id", rowId);
    if (err) { setError(err.message); } else {
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    }
    setSaving(false);
  }

  if (loading) return <div className="p-6"><LoadingSpinner /></div>;

  return (
    <div className="p-6 space-y-5 max-w-2xl">
      <PageHeader
        icon={<ScanLine size={22} />}
        gradient="emerald"
        title="Attendance Capture"
        subtitle="Configure which capture methods your school uses"
      />
      <div className="flex items-center gap-3">
        <Link href="/dashboard/setup">
          <Button variant="ghost" size="sm"><ArrowLeft size={14} /> Back to Setup</Button>
        </Link>
      </div>
      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2">{error}</div>
      )}
      <Card>
        <CardHeader><CardTitle>Capture Methods</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {SUPPORTED_METHODS.map(m => {
            const isOn = enabled.has(m.code);
            const isLocked = m.code === "manual";
            return (
              <div key={m.code} className={`flex items-start gap-4 rounded-lg border p-4 transition-colors ${isOn ? "border-emerald-200 bg-emerald-50" : "border-gray-200 bg-white"}`}>
                <div className="mt-0.5">
                  <button
                    type="button"
                    disabled={isLocked}
                    onClick={() => toggle(m.code)}
                    className={`w-11 h-6 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[#C9A227] ${isOn ? "bg-emerald-500" : "bg-gray-300"} ${isLocked ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
                    aria-checked={isOn}
                    role="switch"
                  >
                    <span className={`block w-5 h-5 rounded-full bg-white shadow transform transition-transform mx-0.5 ${isOn ? "translate-x-5" : "translate-x-0"}`} />
                  </button>
                </div>
                <div>
                  <div className="font-semibold text-sm text-gray-800">
                    {m.label}
                    {isLocked && <span className="ml-2 text-[10px] text-gray-400 font-normal">always on</span>}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">{m.description}</div>
                </div>
              </div>
            );
          })}
          <p className="text-xs text-gray-400 pt-1">
            Additional methods (fingerprint, facial, PIN, Bluetooth) will appear here when those features are available.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>AI Attendance Intelligence</CardTitle></CardHeader>
        <CardContent>
          <div className={`flex items-start gap-4 rounded-lg border p-4 transition-colors ${aiEnabled ? "border-blue-200 bg-blue-50" : "border-gray-200 bg-white"}`}>
            <div className="mt-0.5">
              <button
                type="button"
                onClick={() => setAiEnabled(v => !v)}
                className={`w-11 h-6 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[#C9A227] ${aiEnabled ? "bg-blue-500" : "bg-gray-300"} cursor-pointer`}
                aria-checked={aiEnabled}
                role="switch"
              >
                <span className={`block w-5 h-5 rounded-full bg-white shadow transform transition-transform mx-0.5 ${aiEnabled ? "translate-x-5" : "translate-x-0"}`} />
              </button>
            </div>
            <div>
              <div className="font-semibold text-sm text-gray-800">AI Insights</div>
              <div className="text-xs text-gray-500 mt-0.5">
                Enable AI-powered attendance analysis: anomaly detection, chronic absence alerts, class-level summaries, and recommendations. Requires an AI provider configured under{" "}
                <Link href="/dashboard/setup" className="underline text-blue-600">AI Settings</Link>.
              </div>
              {aiEnabled && (
                <div className="text-xs text-blue-600 mt-1 font-medium">Insights panel will appear on the attendance page once the AI intelligence feature ships.</div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button variant="gold" loading={saving} onClick={save}>
          <Save size={14} /> Save Settings
        </Button>
        {saved && (
          <span className="flex items-center gap-1 text-green-600 text-sm font-medium">
            <CheckCircle2 size={14} /> Saved
          </span>
        )}
      </div>
    </div>
  );
}
