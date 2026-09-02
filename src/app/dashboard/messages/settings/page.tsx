"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { PageHeader, LoadingSpinner } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/lib/hooks/useToast";
import type { MessagingPolicy } from "@/lib/messaging/types";
import { Settings, ShieldCheck } from "lucide-react";

type BooleanPolicyKey = {
  [K in keyof MessagingPolicy]: MessagingPolicy[K] extends boolean ? K : never;
}[keyof MessagingPolicy];

const TOGGLES: Array<{ key: BooleanPolicyKey; label: string; help: string; group: string }> = [
  { key: "parents_can_message", label: "Parents can use messaging", help: "Master switch for all parent messaging.", group: "Parents" },
  { key: "parents_can_message_teachers", label: "Parents can message teachers", help: "Requires a shared child unless disabled below.", group: "Parents" },
  { key: "parents_require_child_link", label: "Require a shared child", help: "A parent can only message a teacher who actually teaches their child.", group: "Parents" },
  { key: "parents_can_message_staff", label: "Parents can message other staff", help: "Bursar, admin, front office, etc.", group: "Parents" },
  { key: "students_can_message", label: "Students can use messaging", help: "Master switch — off by default for safeguarding.", group: "Students" },
  { key: "students_can_initiate_dm", label: "Students can start new conversations", help: "If off, students can only reply within existing threads a teacher started.", group: "Students" },
  { key: "students_can_message_teachers", label: "Students can message teachers", help: "", group: "Students" },
  { key: "students_can_message_students", label: "Students can message other students", help: "Off by default — enable only if your school policy allows peer messaging.", group: "Students" },
  { key: "teachers_can_message_students", label: "Teachers can message students directly", help: "", group: "Staff" },
  { key: "staff_can_message_all_staff", label: "Staff can message any other staff member", help: "", group: "Staff" },
  { key: "admins_can_audit_conversations", label: "Admins can review reported conversations", help: "Admins never see ordinary private conversations — only ones with an open report.", group: "Moderation" },
];

export default function MessagingSettingsPage() {
  const supabase = createClient();
  const router = useRouter();
  const { isOrgAdmin, hasModule } = useAuth();
  const { notify, ToastHost } = useToast();
  const [policy, setPolicy] = useState<MessagingPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [maxMb, setMaxMb] = useState(15);

  useEffect(() => {
    supabase.from("messaging_policy").select("*").maybeSingle().then(({ data }) => {
      setPolicy(data as MessagingPolicy);
      if (data) setMaxMb((data as MessagingPolicy).max_attachment_mb);
      setLoading(false);
    });
  }, [supabase]);

  if (!hasModule("communication")) {
    return <div className="p-6 text-gray-500">Communication is not enabled for your school.</div>;
  }
  if (!isOrgAdmin) {
    return <div className="p-6 text-gray-500">Only school administrators can configure messaging.</div>;
  }
  if (loading || !policy) return <div className="p-6"><LoadingSpinner /></div>;

  function toggle(key: BooleanPolicyKey) {
    setPolicy((p) => p ? { ...p, [key]: !p[key] } : p);
  }

  async function save() {
    if (!policy) return;
    setSaving(true);
    const settings: Record<string, unknown> = { max_attachment_mb: maxMb };
    for (const t of TOGGLES) settings[t.key] = policy[t.key];
    const { error } = await supabase.rpc("configure_messaging", { p_settings: settings });
    setSaving(false);
    if (error) { notify(error.message, "error"); return; }
    notify("Messaging configuration saved");
    router.push("/dashboard/messages");
  }

  const groups = Array.from(new Set(TOGGLES.map((t) => t.group)));

  return (
    <div className="p-6 space-y-5 max-w-3xl">
      <PageHeader
        title="Configure Communication"
        subtitle="Control who can message whom at your school, and your safeguarding defaults."
        icon={<Settings size={22} />}
      />
      {groups.map((g) => (
        <Card key={g}>
          <CardHeader><CardTitle>{g}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {TOGGLES.filter((t) => t.group === g).map((t) => (
              <label key={t.key} className="flex items-start gap-3 py-1 cursor-pointer">
                <input type="checkbox" checked={!!policy[t.key]} onChange={() => toggle(t.key)} className="mt-1 h-4 w-4 accent-[#0F2A47]" />
                <span>
                  <span className="block text-sm font-medium text-gray-800">{t.label}</span>
                  {t.help && <span className="block text-xs text-gray-400">{t.help}</span>}
                </span>
              </label>
            ))}
          </CardContent>
        </Card>
      ))}
      <Card>
        <CardHeader><CardTitle>Attachments</CardTitle></CardHeader>
        <CardContent>
          <Input label="Maximum attachment size (MB)" type="number" min={1} max={100} value={maxMb}
            onChange={(e) => setMaxMb(Number(e.target.value))} className="max-w-[160px]" />
        </CardContent>
      </Card>
      <div className="flex items-center gap-2">
        <Button onClick={save} loading={saving}><ShieldCheck size={16} /> Save configuration</Button>
        <Button variant="secondary" onClick={() => router.push("/dashboard/messages")}>Cancel</Button>
      </div>
      <ToastHost />
    </div>
  );
}
