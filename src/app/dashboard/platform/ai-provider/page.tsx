"use client";

/**
 * /dashboard/platform/ai-provider — Super Admin only.
 *
 * Sets the PLATFORM-WIDE default AI backend (OpenAI, Groq, Gemini,
 * OpenRouter, or any registered custom provider + model) that every
 * school inherits unless it picks its own under Dashboard → AI Provider
 * (see /dashboard/ai-provider, school-scoped, any org admin).
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
 *
 * The "Manage custom providers" panel below lets a super admin register
 * any additional OpenAI-chat-compatible provider (a slug, label, base
 * URL, the NAME of the Vercel env var holding its key, and a default
 * model) with no code change or redeploy needed — see
 * supabase/custom_ai_providers.sql and src/lib/ai/customProviders.ts.
 * Reads/writes go straight to public.platform_ai_custom_providers;
 * RLS on that table already restricts writes to is_platform_admin().
 */

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { PageHeader, LoadingSpinner } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Sparkles, ShieldAlert, CheckCircle2, KeyRound, Lock, Gauge, AlertTriangle, PlayCircle, Loader2, XCircle, Settings2, Plus, Pencil, Trash2, X, Bot } from "lucide-react";

interface ProviderStatus {
  id: string;
  label: string;
  configured: boolean;
  /** true for a platform-registered custom provider. */
  custom?: boolean;
  /** the row's pre-filled default model, for custom providers only. */
  defaultModel?: string;
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

interface CustomProviderRow {
  id: string;
  provider_key: string;
  label: string;
  base_url: string;
  api_key_env_name: string;
  default_model: string;
  enabled: boolean;
}

const BLANK_CUSTOM_FORM = {
  provider_key: "",
  label: "",
  base_url: "",
  api_key_env_name: "",
  default_model: "",
  enabled: true,
};

export default function AiProviderSettingsPage() {
  const { isSuperAdmin } = useAuth();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [freeModels, setFreeModels] = useState<FreeModelOption[]>([]);
  const [groqModels, setGroqModels] = useState<FreeModelOption[]>([]);
  const [geminiModels, setGeminiModels] = useState<FreeModelOption[]>([]);
  const [keyStatus, setKeyStatus] = useState<OpenRouterKeyStatus | null>(null);
  const [selected, setSelected] = useState<string>(""); // "" = auto (env var / first configured)
  const [selectedModel, setSelectedModel] = useState<string>(""); // "" = provider default
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string; model?: string; elapsed_ms?: number } | null>(null);

  // --- Manage custom providers ---
  const [customRows, setCustomRows] = useState<CustomProviderRow[]>([]);
  const [customLoaded, setCustomLoaded] = useState(false);
  const [customError, setCustomError] = useState<string | null>(null);
  const [customSaving, setCustomSaving] = useState(false);
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [editingCustomId, setEditingCustomId] = useState<string | null>(null);
  const [customForm, setCustomForm] = useState(BLANK_CUSTOM_FORM);

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
      setGroqModels((statusRes.groqModels as FreeModelOption[]) ?? []);
      setGeminiModels((statusRes.geminiModels as FreeModelOption[]) ?? []);
      setKeyStatus((statusRes.openRouterKeyStatus as OpenRouterKeyStatus | null) ?? null);
    } else {
      setError((prev) => prev ?? "Could not load provider status from the server.");
    }

    setLoading(false);
  }, [supabase]);

  const loadCustom = useCallback(async () => {
    setCustomError(null);
    const { data, error: err } = await supabase
      .from("platform_ai_custom_providers")
      .select("id, provider_key, label, base_url, api_key_env_name, default_model, enabled")
      .order("created_at", { ascending: true });

    if (err) {
      if (/does not exist/i.test(err.message)) {
        setCustomError("Custom providers table is missing. Run supabase/custom_ai_providers.sql in the Supabase SQL editor first.");
      } else {
        setCustomError(err.message);
      }
    } else {
      setCustomRows((data as CustomProviderRow[]) ?? []);
    }
    setCustomLoaded(true);
  }, [supabase]);

  useEffect(() => {
    load();
    loadCustom();
  }, [load, loadCustom]);

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

  function openNewCustomForm() {
    setEditingCustomId(null);
    setCustomForm(BLANK_CUSTOM_FORM);
    setCustomError(null);
    setShowCustomForm(true);
  }

  function openEditCustomForm(row: CustomProviderRow) {
    setEditingCustomId(row.id);
    setCustomForm({
      provider_key: row.provider_key,
      label: row.label,
      base_url: row.base_url,
      api_key_env_name: row.api_key_env_name,
      default_model: row.default_model,
      enabled: row.enabled,
    });
    setCustomError(null);
    setShowCustomForm(true);
  }

  async function saveCustom() {
    setCustomError(null);

    const payload = {
      provider_key: customForm.provider_key.trim().toLowerCase(),
      label: customForm.label.trim(),
      base_url: customForm.base_url.trim(),
      api_key_env_name: customForm.api_key_env_name.trim(),
      default_model: customForm.default_model.trim(),
      enabled: customForm.enabled,
    };
    if (!payload.provider_key || !payload.label || !payload.base_url || !payload.api_key_env_name || !payload.default_model) {
      setCustomError("All fields are required.");
      return;
    }

    setCustomSaving(true);
    const { error: err } = editingCustomId
      ? await supabase.from("platform_ai_custom_providers").update(payload).eq("id", editingCustomId)
      : await supabase.from("platform_ai_custom_providers").insert(payload);
    setCustomSaving(false);

    if (err) {
      if (err.code === "23505" || /duplicate key|already exists/i.test(err.message)) {
        setCustomError(`A provider with key "${payload.provider_key}" already exists.`);
      } else if (/custom_ai_providers_key_format_check/i.test(err.message)) {
        setCustomError(
          'Provider key must be lowercase letters, numbers or underscore, start with a letter, and can\'t be ' +
            '"openai", "groq", "gemini", or "openrouter".',
        );
      } else {
        setCustomError(err.message);
      }
      return;
    }

    setShowCustomForm(false);
    await loadCustom();
    await load(); // refresh the picker list + configured badges too
  }

  async function deleteCustom(row: CustomProviderRow) {
    if (!window.confirm(`Remove custom provider "${row.label}"? Any school currently pinned to it will fall back to Auto.`)) return;
    setCustomSaving(true);
    setCustomError(null);
    const { error: err } = await supabase.from("platform_ai_custom_providers").delete().eq("id", row.id);
    setCustomSaving(false);
    if (err) {
      setCustomError(err.message);
      return;
    }
    await loadCustom();
    await load();
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
  const activeProviderRow = providers.find((p) => p.id === selected);
  const isCustomProvider = Boolean(selected && activeProviderRow?.custom);

  return (
    <div className="space-y-6 max-w-3xl">
      <PageHeader
        icon={<Bot size={24} />}
        gradient="purple"
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
              redeploy, then come back here to select it — or register a custom
              provider below if it already has a Vercel env var set.
            </div>
          )}

          <label className="block">
            <div className="text-xs font-semibold text-gray-700 mb-1">Auto (recommended default)</div>
            <ProviderOption
              active={selected === ""}
              disabled={saving}
              onSelect={() => save("", "")}
              label="Auto"
              description="Uses the AI_PROVIDER environment variable, or the first provider below (built-in or custom) with a key configured."
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
                custom={p.custom}
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

          {selected === "groq" && groqModels.length > 0 && (
            <div className="pt-3 border-t border-gray-100">
              <div className="text-xs font-semibold text-gray-700 mb-2">Model (Groq)</div>
              <select
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                value={selectedModel}
                disabled={saving}
                onChange={(e) => save(selected, e.target.value)}
              >
                <option value="">Default (Llama 3.1 8B Instant)</option>
                {groqModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}{m.contextLength ? ` · ${Math.round(m.contextLength / 1000)}K context` : ""}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-400 mt-1">
                Fetched live from Groq using the configured platform key — this is exactly
                what stops a retired model (like the old default) from silently 404ing again.
              </p>
            </div>
          )}

          {selected === "gemini" && geminiModels.length > 0 && (
            <div className="pt-3 border-t border-gray-100">
              <div className="text-xs font-semibold text-gray-700 mb-2">Model (Google Gemini)</div>
              <select
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                value={selectedModel}
                disabled={saving}
                onChange={(e) => save(selected, e.target.value)}
              >
                <option value="">Default (Gemini 3.6 Flash)</option>
                {geminiModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}{m.contextLength ? ` · ${Math.round(m.contextLength / 1000)}K context` : ""}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-400 mt-1">
                Fetched live from Google using the configured platform key.
              </p>
            </div>
          )}

          {isCustomProvider && (
            <CustomProviderModelBlock
              providerLabel={activeProviderRow?.label ?? selected}
              defaultModel={activeProviderRow?.defaultModel}
              value={selectedModel}
              saving={saving}
              onSave={(model) => save(selected, model)}
            />
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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <Settings2 size={18} className="text-[#C9A227]" />
              Manage custom providers
            </span>
            {!showCustomForm && (
              <button
                type="button"
                onClick={openNewCustomForm}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:border-gray-400"
              >
                <Plus size={14} /> Add provider
              </button>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-gray-500">
            Register any additional OpenAI-chat-compatible provider (any endpoint that
            accepts an OpenAI-shaped <code>/chat/completions</code> request). You added
            an API key to Vercel first — name it here, and it shows up above in the
            provider picker, no code change or redeploy needed.
          </p>

          {!customLoaded ? (
            <LoadingSpinner />
          ) : customRows.length === 0 && !showCustomForm ? (
            <div className="rounded-lg border border-dashed border-gray-300 p-4 text-sm text-gray-500">
              No custom providers registered yet.
            </div>
          ) : (
            <div className="space-y-2">
              {customRows.map((row) => (
                <div key={row.id} className="rounded-lg border border-gray-200 p-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                      {row.label}
                      <span className="text-[10px] font-mono text-gray-400">{row.provider_key}</span>
                      {!row.enabled && (
                        <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400 border border-gray-300 rounded px-1">Disabled</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5 truncate">{row.base_url}</div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      Key from <span className="font-mono">{row.api_key_env_name}</span> · default model <span className="font-mono">{row.default_model}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => openEditCustomForm(row)}
                      disabled={customSaving}
                      className="rounded-lg border border-gray-300 p-1.5 text-gray-600 hover:border-gray-400 disabled:opacity-50"
                      aria-label={`Edit ${row.label}`}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteCustom(row)}
                      disabled={customSaving}
                      className="rounded-lg border border-red-200 p-1.5 text-red-600 hover:border-red-300 disabled:opacity-50"
                      aria-label={`Delete ${row.label}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {showCustomForm && (
            <div className="rounded-lg border border-gray-200 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-gray-800">
                  {editingCustomId ? "Edit custom provider" : "Add custom provider"}
                </div>
                <button type="button" onClick={() => setShowCustomForm(false)} className="text-gray-400 hover:text-gray-600">
                  <X size={16} />
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block">
                  <div className="text-xs font-semibold text-gray-700 mb-1">Provider key (slug)</div>
                  <input
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono"
                    value={customForm.provider_key}
                    disabled={Boolean(editingCustomId)}
                    onChange={(e) => setCustomForm((f) => ({ ...f, provider_key: e.target.value }))}
                    placeholder="zai"
                  />
                  <p className="text-[11px] text-gray-400 mt-1">Lowercase, e.g. &quot;zai&quot;. Can&apos;t be changed after creation.</p>
                </label>
                <label className="block">
                  <div className="text-xs font-semibold text-gray-700 mb-1">Label</div>
                  <input
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    value={customForm.label}
                    onChange={(e) => setCustomForm((f) => ({ ...f, label: e.target.value }))}
                    placeholder="Z.ai (GLM)"
                  />
                </label>
              </div>

              <label className="block">
                <div className="text-xs font-semibold text-gray-700 mb-1">Chat-completions base URL</div>
                <input
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono"
                  value={customForm.base_url}
                  onChange={(e) => setCustomForm((f) => ({ ...f, base_url: e.target.value }))}
                  placeholder="https://api.z.ai/api/paas/v4/chat/completions"
                />
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block">
                  <div className="text-xs font-semibold text-gray-700 mb-1">Vercel env var holding the key</div>
                  <input
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono"
                    value={customForm.api_key_env_name}
                    onChange={(e) => setCustomForm((f) => ({ ...f, api_key_env_name: e.target.value }))}
                    placeholder="GRANTSCHOOL_Z_API_KEY"
                  />
                  <p className="text-[11px] text-gray-400 mt-1">
                    The exact NAME of the env var in Vercel — never the key value itself.
                  </p>
                </label>
                <label className="block">
                  <div className="text-xs font-semibold text-gray-700 mb-1">Default model</div>
                  <input
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono"
                    value={customForm.default_model}
                    onChange={(e) => setCustomForm((f) => ({ ...f, default_model: e.target.value }))}
                    placeholder="glm-4.6"
                  />
                </label>
              </div>

              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={customForm.enabled}
                  onChange={(e) => setCustomForm((f) => ({ ...f, enabled: e.target.checked }))}
                />
                Enabled (visible in the provider picker above)
              </label>

              {customError && (
                <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {customError}
                </div>
              )}

              <div className="flex items-center gap-2 pt-1">
                <Button onClick={saveCustom} disabled={customSaving} loading={customSaving}>
                  {editingCustomId ? "Save changes" : "Add provider"}
                </Button>
                <Button variant="secondary" onClick={() => setShowCustomForm(false)} disabled={customSaving}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {customError && !showCustomForm && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {customError}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ProviderOption({
  active, disabled, onSelect, label, description, configured, custom,
}: {
  active: boolean;
  disabled: boolean;
  onSelect: () => void;
  label: string;
  description: string;
  configured: boolean;
  custom?: boolean;
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
          {custom && <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400 border border-gray-300 rounded px-1">Custom</span>}
          {active && <span className="text-[10px] font-bold uppercase tracking-wide text-[#C9A227]">Active</span>}
        </div>
        <div className="text-xs text-gray-500 mt-0.5">{description}</div>
      </div>
    </button>
  );
}

/**
 * Free-text model input for a platform-registered custom provider.
 * Built-in providers get a live-fetched <select> above; a custom
 * provider has no catalog endpoint we know how to call generically,
 * so this lets the admin type the exact model id, pre-filled with the
 * row's default_model. Local draft state avoids saving on every
 * keystroke.
 */
function CustomProviderModelBlock({
  providerLabel, defaultModel, value, saving, onSave,
}: {
  providerLabel: string;
  defaultModel?: string;
  value: string;
  saving: boolean;
  onSave: (model: string) => void;
}) {
  const [draft, setDraft] = useState(value || defaultModel || "");

  useEffect(() => {
    setDraft(value || defaultModel || "");
  }, [value, defaultModel]);

  return (
    <div className="pt-3 border-t border-gray-100">
      <label htmlFor="custom-provider-model-input" className="block text-xs font-semibold text-gray-700 mb-2">Model ({providerLabel})</label>
      <div className="flex items-center gap-2">
        <input
          id="custom-provider-model-input"
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono"
          value={draft}
          disabled={saving}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={defaultModel || "model id"}
        />
        <button
          type="button"
          onClick={() => onSave(draft.trim())}
          disabled={saving || !draft.trim()}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:border-gray-400 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Save
        </button>
      </div>
      <p className="text-xs text-gray-400 mt-1">
        Custom provider — type the exact model id it expects{defaultModel ? `; default is "${defaultModel}"` : ""}. Edit
        the row below in &quot;Manage custom providers&quot; to change the default for everyone.
      </p>
    </div>
  );
}
