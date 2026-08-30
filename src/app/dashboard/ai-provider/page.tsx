"use client";

/**
 * /dashboard/ai-provider — school-level AI provider settings.
 *
 * Lets an org admin (or a super admin currently switched into this
 * school via the org switcher) choose which AI backend powers THIS
 * SCHOOL's "Ask AI" affordances — independent of the platform-wide
 * default set at Dashboard → Platform → AI Provider. A school can:
 *
 *   - inherit the platform default (no choice made here)
 *   - pin to a specific provider + (for OpenRouter) a specific free model
 *   - optionally paste the school's own API key for that provider, so
 *     its usage draws from that school's own account/quota instead of
 *     the platform's shared key — stored encrypted server-side, never
 *     shown again once saved (see /api/ai/org-settings + keyCrypto.ts)
 *   - see this school's own usage over the last 30 days
 *
 * Backed by /api/ai/org-settings (GET for current state + usage,
 * POST to change provider/model/key) and /api/ai/providers (which
 * providers have a platform key + OpenRouter's live free-model list
 * and platform-key quota).
 */

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/context/AuthContext";
import { PageHeader, LoadingSpinner } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import {
  Sparkles, ShieldAlert, CheckCircle2, KeyRound, Lock, Eye, EyeOff,
  Trash2, BarChart3, Info, PlayCircle, Loader2, XCircle,
} from "lucide-react";

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

interface OrgAiSettings {
  active_provider: string | null;
  active_model: string | null;
  has_key_override: boolean;
  override_key_added_at: string | null;
  updated_at: string | null;
}

interface UsageDay {
  day: string;
  requests: number;
  errors: number;
  tokens_prompt: number;
  tokens_response: number;
}

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI", groq: "Groq", gemini: "Google Gemini", openrouter: "OpenRouter",
};

export default function SchoolAiProviderPage() {
  const { orgId, org, isOrgAdmin } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [freeModels, setFreeModels] = useState<FreeModelOption[]>([]);
  const [groqModels, setGroqModels] = useState<FreeModelOption[]>([]);
  const [geminiModels, setGeminiModels] = useState<FreeModelOption[]>([]);
  const [settings, setSettings] = useState<OrgAiSettings | null>(null);
  const [usage, setUsage] = useState<UsageDay[]>([]);

  const [selectedProvider, setSelectedProvider] = useState<string>("");
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [keyInput, setKeyInput] = useState("");
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string; model?: string; elapsed_ms?: number } | null>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setError(null);

    const [statusRes, orgRes] = await Promise.all([
      fetch("/api/ai/providers").then((r) => r.json()).catch(() => null),
      fetch(`/api/ai/org-settings?organizationId=${encodeURIComponent(orgId)}`).then((r) => r.json()).catch(() => null),
    ]);

    if (statusRes?.providers) {
      setProviders(statusRes.providers as ProviderStatus[]);
      setFreeModels((statusRes.openRouterFreeModels as FreeModelOption[]) ?? []);
      setGroqModels((statusRes.groqModels as FreeModelOption[]) ?? []);
      setGeminiModels((statusRes.geminiModels as FreeModelOption[]) ?? []);
    } else {
      setError((prev) => prev ?? "Could not load provider status.");
    }

    if (orgRes?.settings) {
      const s = orgRes.settings as OrgAiSettings;
      setSettings(s);
      setSelectedProvider(s.active_provider ?? "");
      setSelectedModel(s.active_model ?? "");
      setUsage((orgRes.usage as UsageDay[]) ?? []);
    } else if (orgRes?.error) {
      setError(orgRes.error);
    }

    setLoading(false);
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveChoice(provider: string, model: string) {
    if (!orgId) return;
    setSaving(true);
    setError(null);
    setNotice(null);

    const resp = await fetch("/api/ai/org-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId: orgId, provider: provider || "", model: model || "" }),
    });
    const payload = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      setError(payload.error || "Could not save.");
    } else {
      setSelectedProvider(provider);
      setSelectedModel(model);
      setNotice("Saved. Takes effect on the next AI request from this school.");
      await load();
    }
    setSaving(false);
  }

  async function testConnection() {
    if (!orgId) return;
    setTesting(true);
    setTestResult(null);
    try {
      const resp = await fetch("/api/ai/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organizationId: orgId,
          provider: selectedProvider || null,
          model: selectedModel || null,
        }),
      });
      const payload = await resp.json().catch(() => ({}));
      setTestResult(payload);
    } catch (err) {
      setTestResult({ ok: false, error: err instanceof Error ? err.message : "Network error running the test." });
    }
    setTesting(false);
  }

  async function saveKey() {
    if (!orgId || !keyInput.trim() || !selectedProvider) return;
    setSaving(true);
    setError(null);
    setNotice(null);

    const resp = await fetch("/api/ai/org-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId: orgId, apiKey: keyInput.trim() }),
    });
    const payload = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      setError(payload.error || "Could not save the key.");
    } else {
      setKeyInput("");
      setShowKeyInput(false);
      setNotice("Your school's API key is saved (encrypted) and will be used from now on.");
      await load();
    }
    setSaving(false);
  }

  async function removeKey() {
    if (!orgId) return;
    if (!window.confirm("Remove this school's own API key? AI requests will go back to using the platform's shared key.")) return;
    setSaving(true);
    setError(null);
    setNotice(null);

    const resp = await fetch("/api/ai/org-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId: orgId, apiKey: "" }),
    });
    const payload = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      setError(payload.error || "Could not remove the key.");
    } else {
      setNotice("Your school's key was removed. Now using the platform's shared key.");
      await load();
    }
    setSaving(false);
  }

  if (loading) return <LoadingSpinner />;

  if (!isOrgAdmin) {
    return (
      <div className="max-w-xl mx-auto mt-16">
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 flex items-start gap-3">
          <ShieldAlert size={22} className="text-red-600 mt-0.5" />
          <div>
            <div className="font-semibold text-red-800">Admins only</div>
            <p className="text-sm text-red-700 mt-1">
              Only your school&apos;s admin can choose which AI provider powers
              AI Studio here.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const isOpenRouter = selectedProvider === "openrouter";
  const totalRequests30d = usage.reduce((sum, d) => sum + d.requests, 0);
  const totalErrors30d = usage.reduce((sum, d) => sum + d.errors, 0);

  return (
    <div className="space-y-6 max-w-3xl">
      <PageHeader
        title="AI Provider"
        subtitle={`Choose which AI backend powers AI Studio for ${org?.name ?? "your school"}`}
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles size={18} className="text-[#C9A227]" />
            Active provider for this school
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="block">
            <div className="text-xs font-semibold text-gray-700 mb-1">Inherit platform default (recommended)</div>
            <ProviderOption
              active={selectedProvider === ""}
              disabled={saving}
              onSelect={() => saveChoice("", "")}
              label="Platform default"
              description="Uses whatever the platform admin has set — simplest option, no key management here."
              configured
            />
          </label>

          <div className="text-xs font-semibold text-gray-700 pt-2">Or pin this school to a specific provider</div>
          <div className="space-y-2">
            {providers.map((p) => (
              <ProviderOption
                key={p.id}
                active={selectedProvider === p.id}
                disabled={saving || (!p.configured && !settings?.has_key_override)}
                onSelect={() => saveChoice(p.id, p.id === selectedProvider ? selectedModel : "")}
                label={PROVIDER_LABELS[p.id] || p.label}
                description={
                  p.configured
                    ? "Platform key available."
                    : "No platform key — you can still use this if you add your own key below."
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
                onChange={(e) => saveChoice(selectedProvider, e.target.value)}
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

          {selectedProvider === "groq" && groqModels.length > 0 && (
            <div className="pt-3 border-t border-gray-100">
              <div className="text-xs font-semibold text-gray-700 mb-2">Model (Groq)</div>
              <select
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                value={selectedModel}
                disabled={saving}
                onChange={(e) => saveChoice(selectedProvider, e.target.value)}
              >
                <option value="">Default (Llama 3.1 8B Instant)</option>
                {groqModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}{m.contextLength ? ` · ${Math.round(m.contextLength / 1000)}K context` : ""}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-400 mt-1">
                Fetched live from Groq using the platform&apos;s configured key. If you add your own key below, its available models may differ slightly — use Test connection to confirm your chosen model works with your key.
              </p>
            </div>
          )}

          {selectedProvider === "gemini" && geminiModels.length > 0 && (
            <div className="pt-3 border-t border-gray-100">
              <div className="text-xs font-semibold text-gray-700 mb-2">Model (Google Gemini)</div>
              <select
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                value={selectedModel}
                disabled={saving}
                onChange={(e) => saveChoice(selectedProvider, e.target.value)}
              >
                <option value="">Default (Gemini 3.6 Flash)</option>
                {geminiModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}{m.contextLength ? ` · ${Math.round(m.contextLength / 1000)}K context` : ""}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-400 mt-1">
                Fetched live from Google using the platform&apos;s configured key. If you add your own key below, its available models may differ slightly — use Test connection to confirm your chosen model works with your key.
              </p>
            </div>
          )}

          <div className="pt-2 border-t border-gray-100">
            <button
              type="button"
              onClick={testConnection}
              disabled={testing || !selectedProvider}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:border-gray-400 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {testing ? <Loader2 size={15} className="animate-spin" /> : <PlayCircle size={15} />}
              {testing ? "Testing…" : "Test connection"}
            </button>
            <p className="text-xs text-gray-400 mt-1">
              Sends one tiny real request through this provider/model (and your own key,
              if you&apos;ve added one) — catches a bad model id or a rejected key right
              here, instead of finding out later on the AI Studio page.
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
          {notice && !error && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 flex items-center gap-2">
              <CheckCircle2 size={16} /> {notice}
            </div>
          )}
        </CardContent>
      </Card>

      {selectedProvider && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound size={18} className="text-[#C9A227]" />
              Bring your own API key (optional)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 flex items-start gap-2">
              <Info size={16} className="mt-0.5 shrink-0" />
              <div>
                By default this school shares the platform&apos;s {PROVIDER_LABELS[selectedProvider]} key.
                Adding your own key here means every AI request from this school
                uses YOUR account&apos;s quota instead — useful if the shared key&apos;s
                rate limit is a problem, or you want to track spend separately.
                Your key is encrypted before it&apos;s stored and is never shown again.
              </div>
            </div>

            {settings?.has_key_override ? (
              <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                <div className="text-sm text-emerald-800">
                  <div className="font-semibold flex items-center gap-1.5"><Lock size={14} /> Your own key is active</div>
                  {settings.override_key_added_at && (
                    <div className="text-xs text-emerald-600 mt-0.5">
                      Added {new Date(settings.override_key_added_at).toLocaleString()}
                    </div>
                  )}
                </div>
                <Button variant="danger" size="sm" onClick={removeKey} disabled={saving}>
                  <Trash2 size={14} /> Remove
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <input
                    type={showKeyInput ? "text" : "password"}
                    value={keyInput}
                    onChange={(e) => setKeyInput(e.target.value)}
                    placeholder={`Your ${PROVIDER_LABELS[selectedProvider]} API key`}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 pr-9 text-sm font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKeyInput((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showKeyInput ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <Button onClick={saveKey} disabled={saving || !keyInput.trim()} loading={saving}>
                  Save key
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 size={18} className="text-[#C9A227]" />
            Usage — last 30 days
          </CardTitle>
        </CardHeader>
        <CardContent>
          {usage.length === 0 ? (
            <p className="text-sm text-gray-500">No AI requests from this school yet.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="rounded-lg bg-gray-50 p-3">
                  <div className="text-xs text-gray-500 uppercase font-semibold">Requests</div>
                  <div className="text-xl font-bold text-[#0F2A47]">{totalRequests30d}</div>
                </div>
                <div className="rounded-lg bg-gray-50 p-3">
                  <div className="text-xs text-gray-500 uppercase font-semibold">Errors</div>
                  <div className={`text-xl font-bold ${totalErrors30d > 0 ? "text-red-600" : "text-[#0F2A47]"}`}>{totalErrors30d}</div>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 uppercase border-b border-gray-100">
                      <th className="py-2 pr-4">Day</th>
                      <th className="py-2 pr-4">Requests</th>
                      <th className="py-2 pr-4">Errors</th>
                      <th className="py-2 pr-4">Prompt tokens</th>
                      <th className="py-2">Response tokens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usage.map((d) => (
                      <tr key={d.day} className="border-b border-gray-50">
                        <td className="py-1.5 pr-4">{new Date(d.day).toLocaleDateString()}</td>
                        <td className="py-1.5 pr-4">{d.requests}</td>
                        <td className={`py-1.5 pr-4 ${d.errors > 0 ? "text-red-600 font-semibold" : ""}`}>{d.errors}</td>
                        <td className="py-1.5 pr-4">{d.tokens_prompt.toLocaleString()}</td>
                        <td className="py-1.5">{d.tokens_response.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
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
