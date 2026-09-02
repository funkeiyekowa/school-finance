"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { fmtDateTime, cn } from "@/lib/utils";
import { PageHeader, LoadingSpinner, EmptyState } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { AiAssistButton } from "@/components/ai/AiAssistButton";
import { Plus, Save, Send, Bell, Printer } from "lucide-react";

interface ClassRow { id: string; name: string; }
interface AnnRow { id: string; title: string; body: string; target: string; target_class_id: string | null; priority: string; published: boolean; published_at: string | null; created_by: string | null; created_at: string; }

export default function AnnouncementsPage() {
  const { canEdit, profile, orgId } = useAuth();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [announcements, setAnnouncements] = useState<AnnRow[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ title: "", body: "", target: "all", target_class_id: "", priority: "normal" });

  const load = useCallback(async () => {
    const [annRes, clsRes] = await Promise.all([
      supabase.from("announcements").select("*").order("created_at", { ascending: false }),
      supabase.from("classes").select("id, name").eq("active", true).order("sequence"),
    ]);
    setAnnouncements(annRes.data as AnnRow[] ?? []);
    setClasses(clsRes.data as ClassRow[] ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  async function saveAnnouncement(publish = false) {
    setSaving(true);
    const { error: insErr } = await supabase.from("announcements").insert({
      title: form.title.trim(),
      body: form.body.trim(),
      target: form.target,
      target_class_id: form.target === "class" ? form.target_class_id || null : null,
      priority: form.priority,
      published: publish,
      published_at: publish ? new Date().toISOString() : null,
      created_by: profile?.full_name || profile?.email,
      organization_id: orgId,
    });
    if (insErr) {
      alert(`Could not save announcement: ${insErr.message}`);
      setSaving(false);
      return;
    }
    await supabase.from("activity_log").insert({
      user_email: profile?.email, user_name: profile?.full_name,
      action: publish ? "Publish Announcement" : "Draft Announcement",
      details: form.title, organization_id: orgId,
    });
    setSaving(false); setShowForm(false);
    setForm({ title: "", body: "", target: "all", target_class_id: "", priority: "normal" });
    load();
  }

  async function publishAnnouncement(id: string) {
    const { error } = await supabase.from("announcements")
      .update({ published: true, published_at: new Date().toISOString() })
      .eq("id", id);
    if (error) alert(`Could not publish: ${error.message}`);
    load();
  }

  if (loading) return <div className="p-6"><LoadingSpinner /></div>;

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="Announcements" subtitle="Send targeted messages to staff, parents, students, or specific classes">
        {canEdit && <Button variant="gold" onClick={() => setShowForm(true)}><Plus size={14} /> New Announcement</Button>}
      </PageHeader>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border p-4 text-center">
          <div className="text-xl font-bold text-[#0F2A47]">{announcements.length}</div>
          <div className="text-xs text-gray-500">Total</div>
        </div>
        <div className="bg-white rounded-xl border p-4 text-center">
          <div className="text-xl font-bold text-green-700">{announcements.filter(a => a.published).length}</div>
          <div className="text-xs text-gray-500">Published</div>
        </div>
        <div className="bg-white rounded-xl border p-4 text-center">
          <div className="text-xl font-bold text-amber-700">{announcements.filter(a => !a.published).length}</div>
          <div className="text-xs text-gray-500">Drafts</div>
        </div>
      </div>

      {/* Announcements list */}
      <Card>
        <CardContent>
          {announcements.length === 0 ? (
            <EmptyState message="No announcements yet." icon={<Bell size={32} />} />
          ) : (
            <div className="space-y-3">
              {announcements.map(ann => (
                <div key={ann.id} className={cn("p-4 rounded-lg border", ann.published ? "bg-white" : "bg-amber-50 border-amber-200")}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-sm font-semibold text-[#0F2A47]">{ann.title}</h3>
                        <span className={cn("px-2 py-0.5 rounded text-[10px] font-bold uppercase",
                          ann.priority === "urgent" ? "bg-red-100 text-red-700" :
                          ann.priority === "high" ? "bg-amber-100 text-amber-700" :
                          "bg-gray-100 text-gray-500"
                        )}>{ann.priority}</span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 uppercase">{ann.target === "class" ? classes.find(c => c.id === ann.target_class_id)?.name || "Class" : ann.target}</span>
                      </div>
                      <p className="text-sm text-gray-600 line-clamp-2">{ann.body}</p>
                      <div className="text-[10px] text-gray-400 mt-2">
                        By {ann.created_by} · {fmtDateTime(ann.published_at || ann.created_at)}
                      </div>
                    </div>
                    <div className="shrink-0 flex items-center gap-2">
                      <button
                        onClick={() => window.open(`/dashboard/announcements/${ann.id}/print`, "_blank")}
                        className="text-xs text-[#0F2A47] hover:text-[#C9A227] flex items-center gap-1 border border-gray-200 hover:border-[#C9A227] px-2 py-1 rounded"
                        title="Open a printable, letterhead version of this announcement to send home"
                      >
                        <Printer size={11} /> Print
                      </button>
                      <button
                        onClick={() => {
                          const params = new URLSearchParams({
                            title: ann.title,
                            body: ann.body,
                            target: ann.target,
                          });
                          window.open(`/dashboard/parents/notify?${params.toString()}`, "_blank");
                        }}
                        className="text-xs text-[#0F2A47] hover:text-[#C9A227] flex items-center gap-1 border border-gray-200 hover:border-[#C9A227] px-2 py-1 rounded"
                        title="Send this announcement to every relevant parent via SMS / WhatsApp / email"
                      >
                        <Send size={11} /> Broadcast
                      </button>
                      {ann.published ? (
                        <span className="text-[10px] font-bold text-green-700 bg-green-50 px-2 py-1 rounded">Published</span>
                      ) : canEdit ? (
                        <Button size="sm" variant="gold" onClick={() => publishAnnouncement(ann.id)}><Send size={12} /> Publish</Button>
                      ) : (
                        <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-2 py-1 rounded">Draft</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Modal */}
      {showForm && (
        <Modal open onClose={() => setShowForm(false)} title="New Announcement" size="lg">
          <div className="space-y-4">
            <Input label="Title" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="School resumes on..." />
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-gray-700">Message</label>
                <AiAssistButton
                  compact
                  kinds={["announcement_draft", "polish", "shorten", "translate_formal", "sms_reminder"]}
                  currentValue={form.body || form.title}
                  onApply={(text) => setForm((f) => ({ ...f, body: text }))}
                  source="announcement"
                  label="AI draft"
                />
              </div>
              <textarea rows={4} value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227]" placeholder="Write your announcement, or use AI draft on the right..." />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Target</label>
                <select value={form.target} onChange={e => setForm(f => ({ ...f, target: e.target.value }))} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227] bg-white">
                  <option value="all">Everyone</option>
                  <option value="staff">Staff Only</option>
                  <option value="parents">Parents Only</option>
                  <option value="students">Students Only</option>
                  <option value="class">Specific Class</option>
                </select>
              </div>
              {form.target === "class" && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Class</label>
                  <select value={form.target_class_id} onChange={e => setForm(f => ({ ...f, target_class_id: e.target.value }))} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227] bg-white">
                    <option value="">Select...</option>
                    {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#C9A227] bg-white">
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button variant="secondary" loading={saving} onClick={() => saveAnnouncement(false)} disabled={!form.title.trim() || !form.body.trim()}>
                <Save size={14} /> Save Draft
              </Button>
              <Button variant="gold" loading={saving} onClick={() => saveAnnouncement(true)} disabled={!form.title.trim() || !form.body.trim()}>
                <Send size={14} /> Publish Now
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
