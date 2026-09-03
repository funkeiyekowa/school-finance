"use client";

/**
 * /dashboard/announcements/broadcast-settings
 *
 * Lets a school admin plug in their own SMS and email provider
 * credentials so Communication > Announcements can broadcast on those
 * channels, in addition to the in-app inbox (always on, no setup
 * needed) and the manual WhatsApp/CSV assist tools already on the
 * Announcements page.
 *
 * Same shape as /dashboard/ai-provider: reads/writes through
 * /api/notifications/provider-settings, which encrypts the API key
 * server-side before it ever reaches Postgres (see
 * src/lib/ai/keyCrypto.ts) and never returns it once saved -- this
 * page only ever knows "configured: true/false", never the key itself.
 *
 * IMPORTANT: saving credentials here does NOT send anything by
 * itself. It stores them so the next build step (wiring
 * src/lib/notifications/send.ts to each provider's actual API) can
 * use them. That's called out explicitly in the UI so nobody assumes
 * SMS/email broadcasting is already live the moment a key is saved.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/context/AuthContext";
import { PageHeader, LoadingSpinner } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  MessageSquareText, Mail, KeyRound, Eye, EyeOff, CheckCircle2, Circle,
  Info, ArrowLeft,
} from "lucide-react";

interface NotificationSettings {
  sms_provider: string | null;
  sms_sender_id: string | null;
  sms_configured: boolean;
  sms_configured_at: string | null;
  email_provider: string | null;
  email_from_address: string | null;
  email_from_name: string | null;
  email_configured: boolean;
  email_configured_at: string | null;
}

const SMS_PROVIDERS: { id: string; label: string; help: string; keyLabel: string; extraFields?: { key: string; label: string; placeholder?: string }[] }[] = [
  { id: "termii", label: "Termii", help: "Popular Nigerian SMS gateway. Get your API key from the Termii dashboard.", keyLabel: "Termii API Key" },
  { id: "africastalking", label: "Africa's Talking", help: "Pan-African SMS/USSD gateway.", keyLabel: "API Key", extraFields: [{ key: "username", label: "Username", placeholder: "sandbox or your live username" }] },
  { id: "twilio", label: "Twilio", help: "Global SMS provider.", keyLabel: "Auth Token", extraFields: [{ key: "account_sid", label: "Account SID" }] },
  { id: "webhook", label: "Custom webhook", help: "Point at your own HTTP endpoint that accepts {to, message} and sends the SMS itself.", keyLabel: "Webhook secret / API key (optional)", extraFields: [{ key: "webhook_url", label: "Webhook URL", placeholder: "https://..." }] },
];

const EMAIL_PROVIDERS: { id: string; label: string; help: string; keyLabel: string }[] = [
  { id: "resend", label: "Resend", help: "Developer-friendly transactional email. Recommended for most schools.", keyLabel: "Resend API Key" },
  { id: "sendgrid", label: "SendGrid", help: "Widely used transactional email provider.", keyLabel: "SendGrid API Key" },
  { id: "smtp", label: "Custom SMTP", help: "Any SMTP server your school already has (Google Workspace, Zoho Mail, cPanel hosting, etc.)", keyLabel: "SMTP password" },
];

export default function BroadcastSettingsPage() {
  const router = useRouter();
  const { orgId, isOrgAdmin, hasModule } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<"sms" | "email" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [settings, setSettings] = useState<NotificationSettings | null>(null);

  const [smsProvider, setSmsProvider] = useState("");
  const [smsSenderId, setSmsSenderId] = useState("");
  const [smsKey, setSmsKey] = useState("");
  const [smsShowKey, setSmsShowKey] = useState(false);
  const [smsExtra, setSmsExtra] = useState<Record<string, string>>({});

  const [emailProvider, setEmailProvider] = useState("");
  const [emailFromAddress, setEmailFromAddress] = useState("");
  const [emailFromName, setEmailFromName] = useState("");
  const [emailKey, setEmailKey] = useState("");
  const [emailShowKey, setEmailShowKey] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setError(null);
    const resp = await fetch(`/api/notifications/provider-settings?organizationId=${encodeURIComponent(orgId)}`);
    const payload = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      setError(payload.error || "Could not load broadcast settings.");
      setLoading(false);
      return;
    }
    const s = payload.settings as NotificationSettings;
    setSettings(s);
    setSmsProvider(s.sms_provider ?? "");
    setSmsSenderId(s.sms_sender_id ?? "");
    setEmailProvider(s.email_provider ?? "");
    setEmailFromAddress(s.email_from_address ?? "");
    setEmailFromName(s.email_from_name ?? "");
    setLoading(false);
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  if (!hasModule("communication")) {
    return <div className="p-6 text-gray-500">Communication is not enabled for your school.</div>;
  }
  if (!isOrgAdmin) {
    return <div className="p-6 text-gray-500">Only school administrators can configure broadcast providers.</div>;
  }
  if (loading || !settings) return <div className="p-6"><LoadingSpinner /></div>;

  async function saveSms() {
    if (!orgId) return;
    setSaving("sms");
    setError(null);
    setNotice(null);
    const resp = await fetch("/api/notifications/provider-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organizationId: orgId,
        smsProvider: smsProvider || "",
        smsSenderId,
        smsExtra,
        ...(smsKey.trim() ? { smsApiKey: smsKey.trim() } : {}),
      }),
    });
    const payload = await resp.json().catch(() => ({}));
    setSaving(null);
    if (!resp.ok) { setError(payload.error || "Could not save SMS settings."); return; }
    setSmsKey("");
    setNotice("SMS provider saved.");
    await load();
  }

  async function clearSms() {
    if (!orgId) return;
    setSaving("sms");
    await fetch("/api/notifications/provider-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId: orgId, smsProvider: "", smsApiKey: "" }),
    });
    setSmsProvider(""); setSmsSenderId(""); setSmsKey(""); setSmsExtra({});
    setSaving(null);
    await load();
  }

  async function saveEmail() {
    if (!orgId) return;
    setSaving("email");
    setError(null);
    setNotice(null);
    const resp = await fetch("/api/notifications/provider-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organizationId: orgId,
        emailProvider: emailProvider || "",
        emailFromAddress,
        emailFromName,
        ...(emailKey.trim() ? { emailApiKey: emailKey.trim() } : {}),
      }),
    });
    const payload = await resp.json().catch(() => ({}));
    setSaving(null);
    if (!resp.ok) { setError(payload.error || "Could not save email settings."); return; }
    setEmailKey("");
    setNotice("Email provider saved.");
    await load();
  }

  async function clearEmail() {
    if (!orgId) return;
    setSaving("email");
    await fetch("/api/notifications/provider-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId: orgId, emailProvider: "", emailApiKey: "" }),
    });
    setEmailProvider(""); setEmailFromAddress(""); setEmailFromName(""); setEmailKey("");
    setSaving(null);
    await load();
  }

  const selectedSms = SMS_PROVIDERS.find((p) => p.id === smsProvider);
  const selectedEmail = EMAIL_PROVIDERS.find((p) => p.id === emailProvider);

  return (
    <div className="p-6 space-y-5 max-w-3xl">
      <button
        onClick={() => router.push("/dashboard/announcements")}
        className="text-xs text-gray-500 hover:text-[#0F2A47] flex items-center gap-1"
      >
        <ArrowLeft size={12} /> Back to Announcements
      </button>

      <PageHeader
        title="Broadcast Channels"
        subtitle="Plug in your school's own SMS and email accounts so announcements can send automatically."
        icon={<MessageSquareText size={22} />}
      />

      <Card className="border-blue-200 bg-blue-50">
        <CardContent className="py-3 flex items-start gap-2.5">
          <Info size={15} className="text-blue-600 mt-0.5 shrink-0" />
          <p className="text-xs text-blue-800">
            The in-app inbox and WhatsApp/CSV broadcast tools on the Announcements page work today with
            no setup. SMS and email need your own provider account below — saving your key here stores
            it securely, but actual sending goes live once that provider is wired up on our end using
            these credentials.
          </p>
        </CardContent>
      </Card>

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}
      {notice && (
        <div role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">{notice}</div>
      )}

      {/* SMS */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquareText size={16} /> SMS
            {settings.sms_configured
              ? <span className="inline-flex items-center gap-1 text-[10px] font-bold text-green-700 bg-green-100 px-2 py-0.5 rounded-full"><CheckCircle2 size={11} /> Configured</span>
              : <span className="inline-flex items-center gap-1 text-[10px] font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full"><Circle size={11} /> Not set up</span>}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {SMS_PROVIDERS.map((p) => (
              <button
                key={p.id}
                onClick={() => setSmsProvider(p.id)}
                className={`text-left p-3 rounded-lg border text-sm transition-colors ${smsProvider === p.id ? "border-[#C9A227] bg-[#FBF6E8]" : "border-gray-200 hover:border-gray-300"}`}
              >
                <div className="font-semibold text-[#0F2A47]">{p.label}</div>
                <div className="text-[11px] text-gray-500 mt-0.5">{p.help}</div>
              </button>
            ))}
          </div>

          {selectedSms && (
            <div className="space-y-3 pt-2 border-t border-gray-100">
              <Input label="Sender ID" value={smsSenderId} onChange={(e) => setSmsSenderId(e.target.value)} placeholder="Your school's short sender name" />
              {selectedSms.extraFields?.map((f) => (
                <Input
                  key={f.key}
                  label={f.label}
                  placeholder={f.placeholder}
                  value={smsExtra[f.key] ?? ""}
                  onChange={(e) => setSmsExtra((prev) => ({ ...prev, [f.key]: e.target.value }))}
                />
              ))}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">{selectedSms.keyLabel}</label>
                <div className="relative">
                  <KeyRound size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type={smsShowKey ? "text" : "password"}
                    value={smsKey}
                    onChange={(e) => setSmsKey(e.target.value)}
                    placeholder={settings.sms_configured ? "Saved — enter a new key to replace it" : "Paste your API key"}
                    className="w-full rounded-lg border border-gray-300 pl-8 pr-9 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
                  />
                  <button type="button" onClick={() => setSmsShowKey((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 p-1">
                    {smsShowKey ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={saveSms} loading={saving === "sms"}>Save SMS settings</Button>
                {settings.sms_configured && (
                  <Button variant="secondary" onClick={clearSms} disabled={saving === "sms"}>Remove</Button>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Email */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail size={16} /> Email
            {settings.email_configured
              ? <span className="inline-flex items-center gap-1 text-[10px] font-bold text-green-700 bg-green-100 px-2 py-0.5 rounded-full"><CheckCircle2 size={11} /> Configured</span>
              : <span className="inline-flex items-center gap-1 text-[10px] font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full"><Circle size={11} /> Not set up</span>}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {EMAIL_PROVIDERS.map((p) => (
              <button
                key={p.id}
                onClick={() => setEmailProvider(p.id)}
                className={`text-left p-3 rounded-lg border text-sm transition-colors ${emailProvider === p.id ? "border-[#C9A227] bg-[#FBF6E8]" : "border-gray-200 hover:border-gray-300"}`}
              >
                <div className="font-semibold text-[#0F2A47]">{p.label}</div>
                <div className="text-[11px] text-gray-500 mt-0.5">{p.help}</div>
              </button>
            ))}
          </div>

          {selectedEmail && (
            <div className="space-y-3 pt-2 border-t border-gray-100">
              <div className="grid grid-cols-2 gap-3">
                <Input label="From address" type="email" value={emailFromAddress} onChange={(e) => setEmailFromAddress(e.target.value)} placeholder="school@yourschool.com" />
                <Input label="From name" value={emailFromName} onChange={(e) => setEmailFromName(e.target.value)} placeholder="Your School Name" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">{selectedEmail.keyLabel}</label>
                <div className="relative">
                  <KeyRound size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type={emailShowKey ? "text" : "password"}
                    value={emailKey}
                    onChange={(e) => setEmailKey(e.target.value)}
                    placeholder={settings.email_configured ? "Saved — enter a new key to replace it" : "Paste your API key / SMTP password"}
                    className="w-full rounded-lg border border-gray-300 pl-8 pr-9 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
                  />
                  <button type="button" onClick={() => setEmailShowKey((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 p-1">
                    {emailShowKey ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={saveEmail} loading={saving === "email"}>Save email settings</Button>
                {settings.email_configured && (
                  <Button variant="secondary" onClick={clearEmail} disabled={saving === "email"}>Remove</Button>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
