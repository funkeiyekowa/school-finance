"use client";

/**
 * /dashboard/platform/ai-provider — Super Admin only.
 *
 * Lets a super admin pick which AI backend (OpenAI, Groq, Gemini,
 * OpenRouter) powers the /dashboard/ai module and every "Ask AI"
 * affordance, without touching env vars or redeploying.
 *
 * Persisted to platform_settings.active_ai_provider (see
 * supabase/ai_provider_settings.sql). Row-level policy on
 * platform_settings restricts writes to super_admin / developer, so
 * a non-super-admin who lands here by URL guessing will see an
 * empty form and a save error.
 *
 * "Configured" badges come from /api/ai/providers, which reports
 * only whether each provider's API key env var is set on the
 * server — it never exposes the key itself.
 */

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { PageHeader, LoadingSpinner } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Sparkles, ShieldAlert, CheckCircle2, KeyRound, Lock } from "lucide-react";

interface ProviderStatus {
  id: string;
  label: string;
  configured: boolean;
}

export default function AiProviderSettingsPage() {
  const { isSuperAdmin } = useAuth();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [selected, setSelected] = useState<string>(""); // "" = auto (env var / first configured)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [settingsRes, statusRes] = await Promise.all([
      supabase
        .from("platform_settings")
        .select("id, active_ai_provider, updated_at")
        .eq("id", "default")
        .maybeSingle(),
      fetch("/api/ai/providers").then((r) => r.json()).catch(() => null),
    ]);

    if (settingsRes.error) {
      setError(settingsRes.error.message);
    } else if (settingsRes.data) {
      setSelected(settingsRes.data.active_ai_provider ?? "");
      setUpdatedAt(settingsRes.data.updated_at ?? null);
    }

    if (statusRes?.providers) {
      setProviders(statusRes.providers as ProviderStatus[]);
    } else {
      setError((prev) => prev ?? "Could not load provider status from the server.");
    }

    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function save(nextValue: string) {
    setSaving(true);
    setError(null);
    setSavedAt(null);

    const { error: upErr } = await supabase
      .from("platform_settings")
      .upsert(
        { id: "default", active_ai_provider: nextValue || null },
        { onConflict: "id" },
      );

    if (upErr) {
      setError(upErr.message);
    } else {
      setSelected(nextValue);
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
              This screen controls which AI provider powers the whole platform —
              only platform super admins can view or edit it.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const configuredCount = providers.filter((p) => p.configured).length;

  return (
    <div className="space-y-6 max-w-3xl">
      <PageHeader
        title="AI Provider"
        subtitle="Choose which AI backend powers AI Studio and every 'Ask AI' helper across the platform"
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles size={18} className="text-[#C9A227]" />
            Active provider
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {configuredCount === 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              No provider has an API key configured on this deployment yet. Add one
              in Vercel → Settings → Environment Variables (e.g. GROQ_API_KEY),
              redeploy, then come back here to select it.
            </div>
          )}

          <label className="block">
            <div className="text-xs font-semibold text-gray-700 mb-1">Auto (recommended default)</div>
            <ProviderOption
              active={selected === ""}
              disabled={saving}
              onSelect={() => save("")}
              label="Auto"
              description="Uses the AI_PROVIDER environment variable, or the first provider below with a key configured."
              configured
            />
          </label>

          <div className="text-xs font-semibold text-gray-700 pt-2">Or pin to a specific provider</div>
          <div className="space-y-2">
            {providers.map((p) => (
              <ProviderOption
                key={p.id}
                active={selected === p.id}
                disabled={saving || !p.configured}
                onSelect={() => save(p.id)}
                label={p.label}
                description={
                  p.configured
                    ? "API key configured on this deployment."
                    : "No API key configured — add one in Vercel to enable this option."
                }
                configured={p.configured}
              />
            ))}
          </div>

          {error && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}
          {savedAt && !error && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 flex items-center gap-2">
              <CheckCircle2 size={16} /> Saved. Takes effect on the next AI request
              — no redeploy needed.
            </div>
          )}

          <div className="text-xs text-gray-500 pt-2">
            {updatedAt ? `Last changed ${new Date(updatedAt).toLocaleString()}` : "Never changed — using Auto."}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ProviderOption({
  active, disabled, onSelect, label, description, configured,
}: {
  active: boolean;
  disabled: boolean;
  onSelect: () => void;
  label: string;
  description: string;
  configured: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={`w-full text-left rounded-lg border px-4 py-3 flex items-start gap-3 transition disabled:opacity-50 disabled:cursor-not-allowed ${
        active
          ? "border-[#C9A227] bg-amber-50/60 ring-1 ring-[#C9A227]"
          : "border-gray-200 hover:border-gray-300"
      }`}
    >
      <div className="mt-0.5">
        {configured ? (
          <KeyRound size={16} className="text-emerald-600" />
        ) : (
          <Lock size={16} className="text-gray-400" />
        )}
      </div>
      <div className="flex-1">
        <div className="text-sm font-semibold text-gray-800 flex items-center gap-2">
          {label}
          {active && <span className="text-[10px] font-bold uppercase tracking-wide text-[#C9A227]">Active</span>}
        </div>
        <div className="text-xs text-gray-500 mt-0.5">{description}</div>
      </div>
    </button>
  );
}
