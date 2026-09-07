"use client";

/**
 * /dashboard/attendance/scan
 *
 * Tablet-facing QR attendance scanner.
 *
 * Auth model: device Bearer token (Phase 2 / Phase 3 architecture).
 * An admin registers a device at /dashboard/attendance/devices, copies the
 * one-time token, and pastes it here once. The token is stored in
 * localStorage under "att_device_token" and used for every scan.
 *
 * On scan: parses { student_id, code } from QR, then POSTs directly to
 * /api/attendance/ingest with Authorization: Bearer <token>.
 * All validation (device, org, class, student, status) is enforced
 * server-side by ingest_attendance_from_device() — this page adds none.
 *
 * No user session required — works on an unattended tablet.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ArrowLeft, Camera, CheckCircle2, QrCode, XCircle, KeyRound } from "lucide-react";
import Link from "next/link";

const TOKEN_KEY = "att_device_token";
const DEBOUNCE_MS = 1500;

const SESSIONS = [
  { value: "full_day", label: "Full Day" },
  { value: "morning", label: "Morning" },
  { value: "afternoon", label: "Afternoon" },
];

interface ScanResult {
  ok: boolean;
  student_name?: string;
  student_id: string;
  message: string;
}

export default function QRScanPage() {
  const [deviceToken, setDeviceToken] = useState<string>("");
  const [tokenInput, setTokenInput] = useState("");
  const [tokenSaved, setTokenSaved] = useState(false);

  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().substring(0, 10));
  const [session, setSession] = useState("full_day");
  const [scanning, setScanning] = useState(false);
  const [scanResults, setScanResults] = useState<ScanResult[]>([]);

  const lastScanned = useRef<Map<string, number>>(new Map());
  const scannerRef = useRef<HTMLDivElement>(null);
  const html5QrScannerRef = useRef<{ clear: () => Promise<void> } | null>(null);

  // Load token from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(TOKEN_KEY) ?? "";
      setDeviceToken(stored);
      setTokenInput(stored);
    } catch { /* ignore — localStorage may throw in some contexts */ }
  }, []);

  function saveToken() {
    const t = tokenInput.trim();
    try { localStorage.setItem(TOKEN_KEY, t); } catch { /* ignore */ }
    setDeviceToken(t);
    setTokenSaved(true);
    setTimeout(() => setTokenSaved(false), 2000);
  }

  // Process a scanned QR payload
  const processQR = useCallback(async (rawText: string) => {
    if (!deviceToken) {
      setScanResults(prev => [{
        ok: false, student_id: "—",
        message: "No device token set. Paste your device token above.",
      }, ...prev.slice(0, 9)]);
      return;
    }

    // Parse QR: expect { student_id, code } — student_id is the UUID
    let studentId: string;
    let displayId: string;
    try {
      const parsed = JSON.parse(rawText);
      studentId = parsed?.student_id ?? "";
      displayId = parsed?.code ?? parsed?.student_id ?? rawText.trim();
    } catch {
      // Legacy plain-text student_code QRs are not supported by ingest (needs UUID).
      setScanResults(prev => [{
        ok: false, student_id: rawText.trim(),
        message: "Unrecognised QR format. Re-print QR codes from the QR Print page.",
      }, ...prev.slice(0, 9)]);
      return;
    }

    if (!studentId) {
      setScanResults(prev => [{
        ok: false, student_id: displayId,
        message: "QR missing student_id. Re-print QR codes from the QR Print page.",
      }, ...prev.slice(0, 9)]);
      return;
    }

    // Debounce: ignore same student within DEBOUNCE_MS
    const now = Date.now();
    const last = lastScanned.current.get(studentId) ?? 0;
    if (now - last < DEBOUNCE_MS) return;
    lastScanned.current.set(studentId, now);

    try {
      const res = await fetch("/api/attendance/ingest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${deviceToken}`,
        },
        body: JSON.stringify({
          date: selectedDate,
          session,
          marks: [{ student_id: studentId, status_code: "present" }],
        }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setScanResults(prev => [{
          ok: true,
          student_id: displayId,
          message: `Marked present (${data.count ?? 1} record)`,
        }, ...prev.slice(0, 9)]);
      } else {
        setScanResults(prev => [{
          ok: false,
          student_id: displayId,
          message: data.error ?? `Error ${res.status}`,
        }, ...prev.slice(0, 9)]);
      }
    } catch {
      setScanResults(prev => [{
        ok: false, student_id: displayId,
        message: "Network error — check connection.",
      }, ...prev.slice(0, 9)]);
    }
  }, [deviceToken, selectedDate, session]);

  const startScanner = useCallback(async () => {
    if (!scannerRef.current) return;
    const { Html5QrcodeScanner } = await import("html5-qrcode");
    const scanner = new Html5QrcodeScanner(
      "qr-reader",
      { fps: 10, qrbox: { width: 250, height: 250 }, disableFlip: false },
      false
    );
    scanner.render(
      (decodedText) => { processQR(decodedText); },
      () => {}
    );
    html5QrScannerRef.current = scanner;
    setScanning(true);
  }, [processQR]);

  const stopScanner = useCallback(async () => {
    if (html5QrScannerRef.current) {
      try { await html5QrScannerRef.current.clear(); } catch { /* ignore */ }
      html5QrScannerRef.current = null;
    }
    setScanning(false);
  }, []);

  // Restart scanner when session params change
  useEffect(() => {
    if (scanning) {
      stopScanner().then(() => startScanner());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, session, deviceToken]);

  useEffect(() => { return () => { stopScanner(); }; }, [stopScanner]);

  return (
    <div className="space-y-5 max-w-2xl mx-auto p-4">
      <div className="flex items-center gap-3">
        <Link href="/dashboard/attendance">
          <Button variant="ghost" size="sm"><ArrowLeft size={14} /> Back</Button>
        </Link>
        <div className="flex items-center gap-2">
          <QrCode size={20} className="text-[#C9A227]" />
          <h1 className="text-lg font-bold text-gray-800">QR Attendance Scanner</h1>
        </div>
      </div>

      {/* Device token setup */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><KeyRound size={15} /> Device Token</CardTitle></CardHeader>
        <CardContent className="flex gap-2 flex-wrap items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="text-xs font-medium text-gray-600 block mb-1">
              Paste the token from <Link href="/dashboard/attendance/devices" className="underline text-[#C9A227]">Device Management</Link>
            </label>
            <input
              type="password"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
              placeholder="att_…"
              value={tokenInput}
              onChange={e => setTokenInput(e.target.value)}
            />
          </div>
          <Button variant="gold" size="sm" onClick={saveToken}>
            {tokenSaved ? "Saved ✓" : "Save Token"}
          </Button>
          {deviceToken && (
            <span className="text-xs text-green-600 font-medium">Token active</span>
          )}
          {!deviceToken && (
            <span className="text-xs text-red-500 font-medium">No token — scanning will fail</span>
          )}
        </CardContent>
      </Card>

      {/* Session setup */}
      <Card>
        <CardHeader><CardTitle>Session</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Date</label>
            <input
              type="date"
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Session</label>
            <select
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
              value={session}
              onChange={e => setSession(e.target.value)}
            >
              {SESSIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <p className="text-xs text-gray-400 self-end pb-2">
            Class is determined by the registered device — set during device registration.
          </p>
        </CardContent>
      </Card>

      {/* Camera */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2"><Camera size={16} /> Camera</CardTitle>
          {!scanning
            ? <Button variant="gold" size="sm" onClick={startScanner}>Start Scanner</Button>
            : <Button variant="ghost" size="sm" onClick={stopScanner}>Stop Scanner</Button>
          }
        </CardHeader>
        <CardContent>
          <div id="qr-reader" ref={scannerRef} className="w-full" />
          {!scanning && (
            <div className="flex flex-col items-center justify-center py-10 text-gray-400 gap-2">
              <QrCode size={40} className="opacity-30" />
              <p className="text-sm">Press Start Scanner to activate the camera.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Scan log */}
      {scanResults.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Scan Log</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {scanResults.map((r, i) => (
              <div key={i} className={`flex items-start gap-3 rounded-lg px-3 py-2 text-sm ${r.ok ? "bg-green-50 border border-green-100" : "bg-red-50 border border-red-100"}`}>
                {r.ok
                  ? <CheckCircle2 size={16} className="text-green-600 mt-0.5 shrink-0" />
                  : <XCircle size={16} className="text-red-500 mt-0.5 shrink-0" />
                }
                <div>
                  <div className="font-mono text-xs text-gray-500">{r.student_id}</div>
                  <div className={r.ok ? "text-green-700" : "text-red-600"}>{r.message}</div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
