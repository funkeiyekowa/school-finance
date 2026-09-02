"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/messaging/Avatar";
import type { MessageableUser } from "@/lib/messaging/types";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (conversationId: string) => void;
  isAdmin: boolean;
}

export function GroupCreateModal({ open, onClose, onCreated, isAdmin }: Props) {
  const supabase = createClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<"group" | "announcement">("group");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MessageableUser[]>([]);
  const [selected, setSelected] = useState<MessageableUser[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setTitle(""); setDescription(""); setType("group"); setQuery(""); setResults([]); setSelected([]); setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc("search_messageable_users", { p_query: query, p_limit: 25 });
      if (!error) setResults((data as MessageableUser[]) ?? []);
    }, 250);
    return () => clearTimeout(t);
  }, [open, query, supabase]);

  function toggle(u: MessageableUser) {
    setSelected((prev) => prev.some((s) => s.user_id === u.user_id) ? prev.filter((s) => s.user_id !== u.user_id) : [...prev, u]);
  }

  async function create() {
    if (!title.trim()) { setError("Give the group a name"); return; }
    setSaving(true);
    setError(null);
    const { data, error } = await supabase.rpc("create_group", {
      p_title: title.trim(), p_description: description.trim() || null,
      p_member_ids: selected.map((s) => s.user_id), p_type: type,
    });
    setSaving(false);
    if (error) { setError(error.message); return; }
    onClose();
    onCreated(data as string);
  }

  return (
    <Modal open={open} onClose={onClose} title="Create a group" size="md">
      <div className="space-y-3">
        <Input label="Group name" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. SS3 Mathematics" />
        <Input label="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
        {isAdmin && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setType("group")}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${type === "group" ? "bg-[#0F2A47] text-white border-[#0F2A47]" : "bg-white border-gray-300"}`}>
                Regular group
              </button>
              <button type="button" onClick={() => setType("announcement")}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${type === "announcement" ? "bg-[#0F2A47] text-white border-[#0F2A47]" : "bg-white border-gray-300"}`}>
                Announcement channel
              </button>
            </div>
          </div>
        )}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Add members</label>
          <Input placeholder="Search people…" value={query} onChange={(e) => setQuery(e.target.value)} />
          {selected.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {selected.map((s) => (
                <span key={s.user_id} className="inline-flex items-center gap-1 bg-[#FBF6E8] border border-[#C9A227] text-[#0F2A47] text-xs rounded-full px-2 py-0.5">
                  {s.full_name}
                  <button type="button" onClick={() => toggle(s)}>×</button>
                </span>
              ))}
            </div>
          )}
          <div className="max-h-48 overflow-y-auto mt-2 border border-gray-100 rounded-lg divide-y">
            {results.map((u) => (
              <button key={u.user_id} type="button" onClick={() => toggle(u)}
                className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 text-left">
                <Avatar name={u.full_name} seed={u.user_id} size={28} />
                <span className="text-sm truncate">{u.full_name}</span>
                <span className="text-xs text-gray-400 ml-auto">{u.subtitle}</span>
              </button>
            ))}
          </div>
        </div>
        {error && <div className="text-xs text-red-600">{error}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={create} loading={saving}>Create group</Button>
        </div>
      </div>
    </Modal>
  );
}
