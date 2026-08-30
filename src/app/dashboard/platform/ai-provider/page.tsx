"use client";

/**
 * /dashboard/platform/ai-provider — Super Admin only.
 *
 * Sets the PLATFORM-WIDE default AI backend (OpenAI, Groq, Gemini,
 * OpenRouter + model) that every school inherits unless it picks its
 * own under Dashboard → AI Provider (see /dashboard/ai-provider,
 * school-scoped, any org admin).
 *
 * Persisted to platform_settings.active_ai_provider / active_ai_model
 * (see supabase/ai_provider_settings.sql + ai_provider_settings_v2.sql).
 * Row-level policy on platform_settings restricts writes to
 * super_admin / developer.
 *
 * "Configured" badges and the OpenRouter free-model list come from
 * /api/ai/providers, which reports only whether each provider's API
 * key env var is set on the server, plus OpenRouter's live catalog
 * of $0-priced models and (if a platform OpenRouter key exists) that
 * key's live quota — never the key itself.
 */

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { PageHeader, LoadingSpinner } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Sparkles, ShieldAlert, CheckCircle2, KeyRound, Lock, Gauge, AlertTriangle, PlayCircle, Loader2, XCircle } from "lucide-react";

interface ProviderStatus {
  id: string;
  label: string;
  configured: boolean;
}

interface FreeModelOption {
  id: string;
  label: string;
  contextLength: number | null;
}

interface OpenRouterKeyStatus {
  ok: boolean;
  label?: string;
  usage?: number;
  limit?: number | null;
  isFreeTier?: boolean;
  rateLimit?: { requests: number; interval: string } | null;
  error?: string;
}

export default function AiProviderSettingsPage() {
  const { isSuperAdmin } = useAuth();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [freeModels, setFreeModels] = useState<FreeModelOption[]>([]);
  const [keyStatus, setKeyStatus] = useState<OpenRouterKeyStatus | null>(null);
  const [selected, setSelected] = useState<string>(""); // "" = auto (env var / first configured)
  const [selectedModel, setSelectedModel] = useState<string>(""); // "" = provider default
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string; model?: string; elapsed_ms?: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [settingsRes, statusRes] = await Promise.all([
      supabase
        .from("platform_settings")
        .select("id, active_ai_provider, active_ai_model, updated_at")
        .eq("id", "default")
        .maybeSingle(),
      fetch("/api/ai/providers").then((r) => r.json()).catch(() => null),
    ]);

    if (settingsRes.error) {
      setError(settingsRes.error.message);
    } else if (settingsRes.data) {
      const row = settingsRes.data as { active_ai_provider: string | null; active_ai_model?: string | null; updated_at: string | null };
      setSelected(row.active_ai_provider ?? "");
      setSelectedModel(row.active_ai_model ?? "");
      setUpdatedAt(row.updated_at ?? null);
    }

    if (statusRes?.providers) {
      setProviders(statusRes.providers as ProviderStatus[]);
      setFreeModels((statusRes.openRouterFreeModels as FreeModelOption[]) ?? []);
      setKeyStatus((statusRes.openRouterKeyStatus as OpenRouterKeyStatus | null) ?? null);
    } else {
      setError((prev) => prev ?? "Could not load provider status from the server.");
    }

    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function save(nextProvider: string, nextModel: string) {
    setSaving(true);
    setError(null);
    setSavedAt(null);

    const { error: upErr } = await supabase
      .from("platform_settings")
      .upsert(
        { id: "default", active_ai_provider: nextProvider || null, active_ai_model: nextModel || null },
        { onConflict: "id" },
      );

    if (upErr) {
      setError(upErr.message);
    } else {
      setSelected(nextProvider);
      setSelectedModel(nextModel);
      setSavedAt(new Date().toISOString());
      await load();
    }
    setSaving(false);
  }

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const resp = await fetch("/api/ai/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: selected || null, model: selectedModel || null }),
      });
      const payload = await resp.json().catch(() => ({}));
      setTestResult(payload);
    } catch (err) {
      setTestResult({ ok: false, error: err instanceof Error ? err.message : "Network error running the test." });
    }
    setTesting(false);
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
              This screen controls the platform-wide default AI provider —
              only platform super admins can view or edit it. Individual
              schools can still pick their own under Dashboard → AI Provider.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const configuredCount = providers.filter((p) => p.configured).length;
  const isOpenRouter = selected === "openrouter";

  return (
    <div className="space-y-6 max-w-3xl">
      <PageHeader
        title="AI Provider (Platform Default)"
        subtitle="Choose the fallback AI backend every school inherits unless it sets its own"
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
              onSelect={() => save("", "")}
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
                onSelect={() => save(p.id, p.id === selected ? selectedModel : "")}
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

          {isOpenRouter && freeModels.length > 0 && (
            <div className="pt-3 border-t border-gray-100">
              <div className="text-xs font-semibold text-gray-700 mb-2">Model (OpenRouter free models)</div>
              <select
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                value={selectedModel}
                disabled={saving}
                onChange={(e) => save(selected, e.target.value)}
              >
                <option value="">Default (Llama 3.3 70B)</option>
                {freeModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}{m.contextLength ? ` · ${Math.round(m.contextLength / 1000)}K context` : ""}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-400 mt-1">
                Fetched live from OpenRouter — only models currently priced at $0 are listed.
              </p>
            </div>
          )}

          {isOpenRouter && keyStatus && (
            <div className={`rounded-lg border p-3 text-sm flex items-start gap-2 ${
              keyStatus.ok ? "border-blue-200 bg-blue-50 text-blue-800" : "border-red-200 bg-red-50 text-red-700"
            }`}>
              {keyStatus.ok ? <Gauge size={16} className="mt-0.5 shrink-0" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0" />}
              {keyStatus.ok ? (
                <div>
                  <div className="font-semibold">Platform OpenRouter key usage</div>
                  <div className="text-xs mt-0.5">
                    {typeof keyStatus.usage === "number" ? `$${keyStatus.usage.toFixed(4)} used` : "Usage unknown"}
                    {keyStatus.limit != null ? ` of $${keyStatus.limit} limit` : " · no hard limit set"}
                    {keyStatus.isFreeTier ? " · free tier" : ""}
                  </div>
                  {keyStatus.rateLimit && (
                    <div className="text-xs mt-0.5">
                      Rate limit: {keyStatus.rateLimit.requests} requests / {keyStatus.rateLimit.interval}
                    </div>
                  )}
                </div>
              ) : (
                <div>{keyStatus.error || "Could not read OpenRouter key status."}</div>
              )}
            </div>
          )}

          <div className="pt-2 border-t border-gray-100">
            <button
              type="button"
              onClick={testConnection}
              disabled={testing || configuredCount === 0}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:border-gray-400 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {testing ? <Loader2 size={15} className="animate-spin" /> : <PlayCircle size={15} />}
              {testing ? "Testing…" : "Test connection"}
            </button>
            <p className="text-xs text-gray-400 mt-1">
              Sends one tiny real request through the currently-selected provider and model
              — catches a bad model id or a rejected key immediately, without needing to
              save first or go find it later in AI Studio.
            </p>

            {testResult && (
              <div
                role="alert"
                className={`mt-3 rounded-lg border p-3 text-sm flex items-start gap-2 ${
                  testResult.ok ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"
                }`}
              >
                {testResult.ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <XCircle size={16} className="mt-0.5 shrink-0" />}
                <div>
                  {testResult.ok ? (
                    <>
                      <div className="font-semibold">Working — {testResult.model}</div>
                      <div className="text-xs mt-0.5">Responded in {testResult.elapsed_ms}ms.</div>
                    </>
                  ) : (
                    <>
                      <div className="font-semibold">Test failed{testResult.model ? ` — ${testResult.model}` : ""}</div>
                      <div className="text-xs mt-0.5 break-words">{testResult.error}</div>
                    </>
                  )}
                </div>
              </div>
            )}
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
