"use client";

/**
 * /dashboard/platform/landing — Super Admin only.
 *
 * Edits the public marketing landing page's contact email and other
 * knobs. Persisted to the platform_settings singleton row.
 *
 * Row-level policy on platform_settings restricts writes to
 * super_admin / developer, so a non-super-admin who lands here by
 * URL guessing will see an empty form and a save error.
 */

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { PageHeader, LoadingSpinner } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Globe, Save, ShieldAlert, CheckCircle2 } from "lucide-react";

interface PlatformSettings {
  id: string;
  contact_email: string;
  marketing_phone: string | null;
  tagline: string | null;
  updated_at: string | null;
}

export default function LandingSettingsPage() {
  const { isSuperAdmin } = useAuth();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [form, setForm] = useState<PlatformSettings>({
    id: "default",
    contact_email: "",
    marketing_phone: "",
    tagline: "",
    updated_at: null,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: qErr } = await supabase
      .from("platform_settings")
      .select("id, contact_email, marketing_phone, tagline, updated_at")
      .eq("id", "default")
      .maybeSingle();

    if (qErr) {
      setError(qErr.message);
    } else if (data) {
      setForm({
        id: data.id,
        contact_email: data.contact_email ?? "",
        marketing_phone: data.marketing_phone ?? "",
        tagline: data.tagline ?? "",
        updated_at: data.updated_at ?? null,
      });
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    setSaving(true);
    setError(null);
    setSavedAt(null);

    // Basic email validation.
    const email = (form.contact_email || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Enter a valid contact email address.");
      setSaving(false);
      return;
    }

    const { error: upErr } = await supabase
      .from("platform_settings")
      .upsert(
        {
          id: "default",
          contact_email: email,
          marketing_phone: (form.marketing_phone || "").trim() || null,
          tagline: (form.tagline || "").trim() || null,
        },
        { onConflict: "id" },
      );

    if (upErr) {
      setError(upErr.message);
    } else {
      setSavedAt(new Date().toISOString());
      await load();
    }
    setSaving(false);
  }

  if (loading) return <LoadingSpinner />;

  if (!isSuperAdmin) {
    return (
      <div className="max-w-xl mx-auto mt-16">
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 flex items-start gap-3">
          <ShieldAlert size={22} className="text-red-600 mt-0.5" />
          <div>
            <div className="font-semibold text-red-800">Super Admin only</div>
            <p className="text-sm text-red-700 mt-1">
              This screen configures the public landing page — only platform
              super admins can view or edit it.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <PageHeader
        icon={<Globe size={24} />}
        gradient="navy"
        title="Landing Page Settings"
        subtitle="Configure the public marketing site at smartandthrive.com"
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe size={18} className="text-[#C9A227]" />
            Contact details
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <Field
            label="Contact email"
            hint="Shown on every 'Book a demo' and pricing CTA on the landing page."
            value={form.contact_email}
            onChange={(v) => setForm((f) => ({ ...f, contact_email: v }))}
            placeholder="hello@smartandthrive.com"
            type="email"
          />
          <Field
            label="Marketing phone (optional)"
            hint="Reserved for future use — appears in the footer once wired up."
            value={form.marketing_phone ?? ""}
            onChange={(v) => setForm((f) => ({ ...f, marketing_phone: v }))}
            placeholder="+234 800 000 0000"
          />
          <Field
            label="Tagline override (optional)"
            hint="Leave empty to keep the default hero tagline."
            value={form.tagline ?? ""}
            onChange={(v) => setForm((f) => ({ ...f, tagline: v }))}
            placeholder="One connected suite for your school"
          />

          {error && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}
          {savedAt && !error && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 flex items-center gap-2">
              <CheckCircle2 size={16} /> Saved. The landing page will use the
              new values on the next page load.
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <div className="text-xs text-gray-500">
              {form.updated_at
                ? `Last updated ${new Date(form.updated_at).toLocaleString()}`
                : "Never updated"}
            </div>
            <button
              type="button"
              disabled={saving}
              onClick={save}
              className="inline-flex items-center gap-2 rounded-lg bg-[#0F2A47] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0a1f36] disabled:opacity-50"
            >
              <Save size={15} /> {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({
  label, hint, value, onChange, placeholder, type = "text",
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="block">
      <div className="text-xs font-semibold text-gray-700 mb-1">{label}</div>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
      />
      {hint && <div className="text-[11px] text-gray-500 mt-1">{hint}</div>}
    </label>
  );
}
