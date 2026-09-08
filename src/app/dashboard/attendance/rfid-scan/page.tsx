"use client";

/**
 * /dashboard/attendance/rfid-scan
 *
 * RFID/NFC attendance scanner page.
 *
 * Auth model: device Bearer token (same architecture as QR scan).
 * An admin registers an RFID device at /dashboard/attendance/devices,
 * copies the one-time token, and pastes it here once.
 * Token stored in localStorage under "att_rfid_device_token" (separate
 * from QR's "att_device_token").
 *
 * Input model: RFID/NFC readers present as HID keyboard devices.
 * They type the card UID followed by Enter. We capture keydown events,
 * buffer characters, and flush on Enter or 100ms of silence.
 * Minimum UID length: 4 characters.
 * Debounce: 2000ms per card UID to prevent duplicate scans.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ArrowLeft, CheckCircle2, KeyRound, Radio, XCircle } from "lucide-react";
import Link from "next/link";

const TOKEN_KEY = "att_rfid_device_token";
const DEBOUNCE_MS = 2000;
const FLUSH_TIMEOUT_MS = 100;
const MIN_UID_LENGTH = 4;

const SESSIONS = [
  { value: "full_day", label: "Full Day" },
  { value: "morning", label: "Morning" },
  { value: "afternoon", label: "Afternoon" },
];

interface ScanEntry {
  ok: boolean;
  uid: string;
  student_name?: string;
  message: string;
  ts: string;
}

export default function RfidScanPage() {
  const [deviceToken, setDeviceToken] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [tokenSaved, setTokenSaved] = useState(false);

  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().substring(0, 10)
  );
  const [session, setSession] = useState("full_day");
  const [listening, setListening] = useState(false);
  const [scanLog, setScanLog] = useState<ScanEntry[]>([]);
  const [lastUid, setLastUid] = useState<string>("");

  const buffer = useRef("");
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastScanned = useRef<Map<string, number>>(new Map());

  // Stable refs so the keydown handler doesn't go stale
  const deviceTokenRef = useRef(deviceToken);
  const selectedDateRef = useRef(selectedDate);
  const sessionRef = useRef(session);
  useEffect(() => { deviceTokenRef.current = deviceToken; }, [deviceToken]);
  useEffect(() => { selectedDateRef.current = selectedDate; }, [selectedDate]);
  useEffect(() => { sessionRef.current = session; }, [session]);

  // Load token from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(TOKEN_KEY) ?? "";
      setDeviceToken(stored);
      setTokenInput(stored);
    } catch { /* ignore */ }
  }, []);

  function saveToken() {
    const t = tokenInput.trim();
    try { localStorage.setItem(TOKEN_KEY, t); } catch { /* ignore */ }
    setDeviceToken(t);
    setTokenSaved(true);
    setTimeout(() => setTokenSaved(false), 2000);
  }

  const processUid = useCallback(async (rawUid: string) => {
    const uid = rawUid.trim().toUpperCase();
    if (uid.length < MIN_UID_LENGTH) return;

    setLastUid(uid);

    if (!deviceTokenRef.current) {
      setScanLog(prev => [{
        ok: false, uid,
        message: "No device token set. Save your token above.",
        ts: new Date().toLocaleTimeString(),
      }, ...prev.slice(0, 49)]);
      return;
    }

    // Debounce: ignore same UID within DEBOUNCE_MS
    const now = Date.now();
    const last = lastScanned.current.get(uid) ?? 0;
    if (now - last < DEBOUNCE_MS) return;
    lastScanned.current.set(uid, now);

    try {
      const res = await fetch("/api/attendance/rfid-ingest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${deviceTokenRef.current}`,
        },
        body: JSON.stringify({
          card_uid: uid,
          date: selectedDateRef.current,
          session: sessionRef.current,
          status_code: "present",
        }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setScanLog(prev => [{
          ok: true,
          uid,
          student_name: data.student_name,
          message: `Marked present`,
          ts: new Date().toLocaleTimeString(),
        }, ...prev.slice(0, 49)]);
      } else {
        setScanLog(prev => [{
          ok: false,
          uid,
          message: data.error ?? `Error ${res.status}`,
          ts: new Date().toLocaleTimeString(),
        }, ...prev.slice(0, 49)]);
      }
    } catch {
      setScanLog(prev => [{
        ok: false,
        uid,
        message: "Network error — check connection.",
        ts: new Date().toLocaleTimeString(),
      }, ...prev.slice(0, 49)]);
    }
  }, []);

  const flushBuffer = useCallback(() => {
    const uid = buffer.current;
    buffer.current = "";
    if (uid) processUid(uid);
  }, [processUid]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Ignore modifier keys
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
    if (!listening) return;
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (flushTimer.current) clearTimeout(flushTimer.current);
      buffer.current = "";
    };
  }, [listening, handleKeyDown]);

  return (
    <div className="space-y-5 max-w-2xl mx-auto p-4">
      <div className="flex items-center gap-3">
        <Link href="/dashboard/attendance">
          <Button variant="ghost" size="sm"><ArrowLeft size={14} /> Back</Button>
        </Link>
        <div className="flex items-center gap-2">
          <Radio size={20} className="text-[#C9A227]" />
          <h1 className="text-lg font-bold text-gray-800">RFID Attendance Scanner</h1>
        </div>
      </div>

      {/* Device token */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound size={15} /> Device Token
          </CardTitle>
        </CardHeader>
        <CardContent className="flex gap-2 flex-wrap items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="text-xs font-medium text-gray-600 block mb-1">
              Paste the RFID token from{" "}
              <Link href="/dashboard/attendance/devices" className="underline text-[#C9A227]">
                Device Management
              </Link>
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
          {deviceToken
            ? <span className="text-xs text-green-600 font-medium">Token active</span>
            : <span className="text-xs text-red-500 font-medium">No token — scanning will fail</span>
          }
        </CardContent>
      </Card>

      {/* Session */}
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
              {SESSIONS.map(s => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
          <p className="text-xs text-gray-400 self-end pb-2">
            Class is set by the registered device.
          </p>
        </CardContent>
      </Card>

      {/* Scanner status */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Radio size={16} /> RFID Reader
          </CardTitle>
          {!listening
            ? (
              <Button variant="gold" size="sm" onClick={() => setListening(true)}>
                Start Listening
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setListening(false)}>
                Stop Listening
              </Button>
            )
          }
        </CardHeader>
        <CardContent>
          {listening ? (
            <div className="flex flex-col items-center justify-center py-8 gap-3">
              <div className="relative">
                <Radio size={48} className="text-[#C9A227] animate-pulse" />
              </div>
              <p className="text-sm font-medium text-gray-700">
                Ready — tap or swipe a card
              </p>
              {lastUid && (
                <p className="text-xs text-gray-400 font-mono">Last UID: {lastUid}</p>
              )}
              <p className="text-xs text-gray-400 mt-1">
                Keep this page focused while scanning.
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-10 text-gray-400 gap-2">
              <Radio size={40} className="opacity-30" />
              <p className="text-sm">Press Start Listening to activate the RFID reader.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Scan log */}
      {scanLog.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Scan Log</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {scanLog.map((entry, i) => (
              <div
                key={i}
                className={`flex items-start gap-3 rounded-lg px-3 py-2 text-sm ${
                  entry.ok
                    ? "bg-green-50 border border-green-100"
                    : "bg-red-50 border border-red-100"
                }`}
              >
                {entry.ok
                  ? <CheckCircle2 size={16} className="text-green-600 mt-0.5 shrink-0" />
                  : <XCircle size={16} className="text-red-500 mt-0.5 shrink-0" />
                }
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-gray-800 truncate">
                      {entry.student_name ?? entry.uid}
                    </span>
                    <span className="text-xs text-gray-400 shrink-0">{entry.ts}</span>
                  </div>
                  <div className="font-mono text-xs text-gray-400">UID: {entry.uid}</div>
                  <div className={entry.ok ? "text-green-700 text-xs" : "text-red-600 text-xs"}>
                    {entry.message}
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
