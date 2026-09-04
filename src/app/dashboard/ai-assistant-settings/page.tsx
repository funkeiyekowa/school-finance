"use client";

/**
 * Admin configuration for the AI Learning Assistant (org_assistant_config).
 * Admin-only: sets whether the assistant is on, which roles may use it, the
 * house rules injected into the system prompt, banned topics, the max
 * question length and student-safe mode. Persisted via the
 * set_org_assistant_config RPC (authorized server-side).
 */

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { PageHeader, LoadingSpinner } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/lib/hooks/useToast";
import { cn } from "@/lib/utils";
import { Sparkles, ShieldAlert } from "lucide-react";

const ROLE_OPTIONS: { key: string; label: string }[] = [
  { key: "teacher", label: "Teachers" },
  { key: "student", label: "Students" },
  { key: "parent", label: "Parents" },
  { key: "staff", label: "Staff" },
  { key: "editor", label: "Editors" },
  { key: "bursar", label: "Bursars" },
  { key: "accountant", label: "Accountants" },
  { key: "admin", label: "Admins" },
  { key: "owner", label: "Owners" },
];

interface Cfg {
  enabled: boolean;
  allowed_roles: string[];
  custom_rules: string;
  banned_topics: string;
  max_input_chars: number;
  student_safe_mode: boolean;
}

export default function AiAssistantSettingsPage() {
  const { orgId, isAdmin } = useAuth();
  const supabase = createClient();
  const { notify, ToastHost } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cfg, setCfg] = useState<Cfg>({
    enabled: true,
    allowed_roles: ["owner", "admin", "editor", "staff", "teacher", "bursar", "accountant", "student", "parent"],
    custom_rules: "",
    banned_topics: "",
    max_input_chars: 2000,
    student_safe_mode: true,
  });

  const load = useCallback(async () => {
    if (!orgId) { setLoading(false); return; }
    const { data } = await supabase.rpc("get_org_assistant_config", { p_org: orgId }).maybeSingle();
    if (data) {
      const d = data as {
        enabled: boolean; allowed_roles: string[]; custom_rules: string | null;
        banned_topics: string[]; max_input_chars: number; student_safe_mode: boolean;
      };
      setCfg({
        enabled: d.enabled,
        allowed_roles: d.allowed_roles ?? [],
        custom_rules: d.custom_rules ?? "",
        banned_topics: (d.banned_topics ?? []).join(", "),
        max_input_chars: d.max_input_chars ?? 2000,
        student_safe_mode: d.student_safe_mode,
      });
    }
    setLoading(false);
  }, [orgId, supabase]);

  useEffect(() => { load(); }, [load]);

  function toggleRole(key: string) {
    setCfg(c => ({
      ...c,
      allowed_roles: c.allowed_roles.includes(key)
        ? c.allowed_roles.filter(r => r !== key)
        : [...c.allowed_roles, key],
    }));
  }

  async function save() {
    if (!orgId) return;
    setSaving(true);
    const banned = cfg.banned_topics.split(",").map(s => s.trim()).filter(Boolean);
    const { data, error } = await supabase.rpc("set_org_assistant_config", {
      p_org: orgId,
      p_enabled: cfg.enabled,
      p_allowed_roles: cfg.allowed_roles,
      p_custom_rules: cfg.custom_rules.trim() || null,
      p_banned_topics: banned,
      p_max_input_chars: cfg.max_input_chars,
      p_student_safe_mode: cfg.student_safe_mode,
    });
    setSaving(false);
    const res = (data ?? {}) as { ok?: boolean };
    if (error || !res.ok) {
      notify(error?.message || "Could not save the settings.", "error");
      return;
    }
    notify("AI Assistant settings saved.");
  }

  if (loading) return <LoadingSpinner />;

  if (!isAdmin) {
    return (
      <div className="p-6">
        <Card><CardContent className="py-10 text-center">
          <ShieldAlert size={32} className="mx-auto text-amber-500 mb-3" />
          <p className="text-sm text-gray-600">Only administrators can configure the AI Assistant.</p>
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5 max-w-2xl">
      <PageHeader icon={<Sparkles size={24} />} gradient="navy" title="AI Assistant Settings"
        subtitle="Control who can use the assistant and how it behaves for your school." />

      <Card>
        <CardHeader><CardTitle>Availability</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={cfg.enabled} onChange={e => setCfg(c => ({ ...c, enabled: e.target.checked }))} className="w-4 h-4 mt-0.5 rounded text-[#C9A227]" />
            <span>
              <span className="block text-sm font-medium text-gray-900">{cfg.enabled ? "Assistant is ON" : "Assistant is OFF"}</span>
              <span className="block text-xs text-gray-500">When off, no one at your school can use the AI assistant.</span>
            </span>
          </label>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Who can use it</label>
            <div className="flex flex-wrap gap-2">
              {ROLE_OPTIONS.map(r => (
                <button key={r.key} type="button" onClick={() => toggleRole(r.key)}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                    cfg.allowed_roles.includes(r.key)
                      ? "bg-[#0F2A47] text-white border-[#0F2A47]"
                      : "bg-white text-gray-600 border-gray-300 hover:border-[#C9A227]"
                  )}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Rules &amp; restrictions</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={cfg.student_safe_mode} onChange={e => setCfg(c => ({ ...c, student_safe_mode: e.target.checked }))} className="w-4 h-4 mt-0.5 rounded text-[#C9A227]" />
            <span>
              <span className="block text-sm font-medium text-gray-900">Student-safe mode</span>
              <span className="block text-xs text-gray-500">Adds age-appropriate guardrails and refuses unsafe content. Recommended when students have access.</span>
            </span>
          </label>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">House rules for the assistant</label>
            <textarea
              rows={5}
              value={cfg.custom_rules}
              onChange={e => setCfg(c => ({ ...c, custom_rules: e.target.value }))}
              placeholder={"e.g.\n- Never give the final answer to homework; explain the method and give a worked example on a different problem.\n- Answer in British English.\n- Encourage students to show their working."}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]"
            />
            <p className="text-xs text-gray-500 mt-1">These instructions are always applied on top of the built-in safety rules. They can tighten behaviour, not loosen it.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Banned topics</label>
            <Input
              value={cfg.banned_topics}
              onChange={e => setCfg(c => ({ ...c, banned_topics: e.target.value }))}
              placeholder="Comma-separated, e.g. exam answers, politics, gambling"
            />
            <p className="text-xs text-gray-500 mt-1">The assistant will politely refuse questions on these topics.</p>
          </div>

          <Input
            label="Maximum question length (characters)"
            type="number"
            min={100}
            max={8000}
            value={String(cfg.max_input_chars)}
            onChange={e => setCfg(c => ({ ...c, max_input_chars: Math.min(8000, Math.max(100, parseInt(e.target.value) || 2000)) }))}
          />
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button variant="gold" loading={saving} onClick={save}>Save settings</Button>
      </div>
      <ToastHost />
    </div>
  );
}
