"use client";

/**
 * /dashboard/attendance/devices
 *
 * Admin-only page for managing attendance capture devices (QR / RFID).
 *
 * Authorization: isOrgAdmin from useAuth() — consistent with
 * /dashboard/setup/class-teachers/page.tsx and other setup pages.
 * All mutations go through authenticated API routes that independently
 * re-verify the caller's org and role server-side.
 *
 * The plaintext device token is never stored. It is shown once immediately
 * after registration and never retrievable again.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { PageHeader, LoadingSpinner } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { ArrowLeft, Plus, ShieldOff, Cpu } from "lucide-react";

const VALID_DEVICE_TYPES = ["qr", "rfid"] as const;
type DeviceType = (typeof VALID_DEVICE_TYPES)[number];

interface DeviceRow {
  id: string;
  device_type: DeviceType;
  class_id: string;
  label: string | null;
  active: boolean;
  created_at: string;
  class_name?: string;
}

interface ClassRow {
  id: string;
  name: string;
}

export default function AttendanceDevicesPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const { isOrgAdmin } = useAuth();

  const [loading, setLoading] = useState(true);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [showRegister, setShowRegister] = useState(false);
  const [form, setForm] = useState<{
    device_type: DeviceType;
    class_id: string;
    label: string;
  }>({ device_type: "qr", class_id: "", label: "" });
  const [registering, setRegistering] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [newToken, setNewToken] = useState<string | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);

  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [devicesRes, classesRes] = await Promise.all([
      supabase
        .from("attendance_capture_devices")
        .select("id, device_type, class_id, label, active, created_at")
        .order("created_at", { ascending: false }),
      supabase
        .from("classes")
        .select("id, name")
        .eq("active", true)
        .order("sequence"),
    ]);

    if (devicesRes.error) {
      setError(devicesRes.error.message);
      setLoading(false);
      return;
    }

    const classList = (classesRes.data as ClassRow[]) ?? [];
    const classMap = new Map(classList.map((c) => [c.id, c.name]));

    const enriched: DeviceRow[] = ((devicesRes.data as DeviceRow[]) ?? []).map(
      (d) => ({ ...d, class_name: classMap.get(d.class_id) ?? d.class_id }),
    );

    setDevices(enriched);
    setClasses(classList);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  if (!isOrgAdmin) {
    return (
      <div className="p-6 text-gray-500">
        Only school administrators can manage attendance capture devices.
      </div>
    );
  }

  if (loading) return <div className="p-6"><LoadingSpinner /></div>;

  async function handleRegister() {
    setFormError(null);
    if (!form.class_id) {
      setFormError("Please select a class.");
      return;
    }
    setRegistering(true);
    try {
      const res = await fetch("/api/attendance/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          device_type: form.device_type,
          class_id: form.class_id,
          label: form.label.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setFormError(json.error ?? "Registration failed.");
        return;
      }
      setShowRegister(false);
      setForm({ device_type: "qr", class_id: "", label: "" });
      setNewToken(json.token);
      setTokenCopied(false);
      await load();
    } catch {
      setFormError("Network error. Please try again.");
    } finally {
      setRegistering(false);
    }
  }

  async function handleDeactivate(id: string) {
    setDeactivatingId(id);
    try {
      const res = await fetch(`/api/attendance/devices/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: false }),
      });
      if (!res.ok) {
        const json = await res.json();
        setError(json.error ?? "Deactivation failed.");
        return;
      }
      await load();
    } catch {
      setError("Network error during deactivation.");
    } finally {
      setDeactivatingId(null);
    }
  }

  async function copyToken() {
    if (!newToken) return;
    await navigator.clipboard.writeText(newToken);
    setTokenCopied(true);
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <PageHeader
        title="Attendance Capture Devices"
        subtitle="Manage QR and RFID devices that record student attendance."
        left={
          <button
            onClick={() => router.push("/dashboard/attendance")}
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
          >
            <ArrowLeft className="w-4 h-4" /> Attendance
          </button>
        }
        right={
          <Button onClick={() => setShowRegister(true)} className="flex items-center gap-2">
            <Plus className="w-4 h-4" /> Register Device
          </Button>
        }
      />

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cpu className="w-5 h-5" /> Registered Devices
          </CardTitle>
        </CardHeader>
        <CardContent>
          {devices.length === 0 ? (
            <p className="text-sm text-gray-500">
              No devices registered yet. Click &quot;Register Device&quot; to add one.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-gray-500">
                    <th className="pb-2 pr-4 font-medium">Label</th>
                    <th className="pb-2 pr-4 font-medium">Type</th>
                    <th className="pb-2 pr-4 font-medium">Class</th>
                    <th className="pb-2 pr-4 font-medium">Status</th>
                    <th className="pb-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {devices.map((d) => (
                    <tr key={d.id} className="py-2">
                      <td className="py-2 pr-4 font-medium">
                        {d.label ?? <span className="text-gray-400 italic">unlabelled</span>}
                      </td>
                      <td className="py-2 pr-4 uppercase text-xs font-mono tracking-wider">
                        {d.device_type}
                      </td>
                      <td className="py-2 pr-4">{d.class_name}</td>
                      <td className="py-2 pr-4">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            d.active
                              ? "bg-green-100 text-green-800"
                              : "bg-gray-100 text-gray-500"
                          }`}
                        >
                          {d.active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="py-2">
                        {d.active && (
                          <button
                            onClick={() => handleDeactivate(d.id)}
                            disabled={deactivatingId === d.id}
                            className="flex items-center gap-1 text-xs text-red-600 hover:text-red-800 disabled:opacity-50"
                          >
                            <ShieldOff className="w-3.5 h-3.5" />
                            {deactivatingId === d.id ? "Deactivating…" : "Deactivate"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {showRegister && (
        <Modal
          title="Register New Device"
          onClose={() => { setShowRegister(false); setFormError(null); }}
        >
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Device Type
              </label>
              <select
                className="w-full border rounded-md px-3 py-2 text-sm"
                value={form.device_type}
                onChange={(e) =>
                  setForm((f) => ({ ...f, device_type: e.target.value as DeviceType }))
                }
              >
                {VALID_DEVICE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.toUpperCase()}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Class
              </label>
              <select
                className="w-full border rounded-md px-3 py-2 text-sm"
                value={form.class_id}
                onChange={(e) => setForm((f) => ({ ...f, class_id: e.target.value }))}
              >
                <option value="">— select class —</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Label <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <Input
                placeholder="e.g. Main Gate Scanner"
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
              />
            </div>

            {formError && (
              <p className="text-sm text-red-600">{formError}</p>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <Button
                variant="ghost"
                onClick={() => { setShowRegister(false); setFormError(null); }}
              >
                Cancel
              </Button>
              <Button onClick={handleRegister} disabled={registering}>
                {registering ? "Registering…" : "Register Device"}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {newToken && (
        <Modal
          title="Device Registered — Save Your Token"
          onClose={() => setNewToken(null)}
        >
          <div className="space-y-4">
            <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
              <strong>Important:</strong> This token will not be shown again. Copy it now
              and store it securely. Configure your device to send it as the{" "}
              <code className="font-mono text-xs bg-amber-100 px-1 rounded">
                Authorization: Bearer &lt;token&gt;
              </code>{" "}
              header on every ingest request.
            </div>

            <div className="rounded-md bg-gray-50 border border-gray-200 p-3 font-mono text-xs break-all select-all">
              {newToken}
            </div>

            <div className="flex justify-end gap-3">
              <Button onClick={copyToken} variant="ghost">
                {tokenCopied ? "Copied!" : "Copy Token"}
              </Button>
              <Button onClick={() => setNewToken(null)}>Done</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
