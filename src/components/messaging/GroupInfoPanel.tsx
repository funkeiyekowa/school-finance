"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/messaging/Avatar";
import type { Conversation } from "@/lib/messaging/types";
import { UserPlus, Shield, Archive, LogOut } from "lucide-react";
import { useToast } from "@/lib/hooks/useToast";

interface MemberRow { user_id: string; full_name: string; role: string; member_role: string; }

interface Props {
  open: boolean;
  onClose: () => void;
  conversation: Conversation;
  myUserId: string;
  isAdminHere: boolean;
  onArchived: () => void;
  onLeft: () => void;
}

export function GroupInfoPanel({ open, onClose, conversation, myUserId, isAdminHere, onArchived, onLeft }: Props) {
  const supabase = createClient();
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const { notify, ToastHost } = useToast();

  const load = async () => {
    const { data, error } = await supabase.rpc("get_conversation_members", { p_conversation_id: conversation.id });
    if (error) { notify(error.message, "error"); return; }
    setMembers((data as MemberRow[]) ?? []);
  };

  useEffect(() => { if (open) load(); }, [open, conversation.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function removeMember(userId: string) {
    setBusy(true);
    const { error } = await supabase.rpc("remove_group_member", { p_conversation_id: conversation.id, p_user_id: userId });
    setBusy(false);
    if (error) { notify(error.message, "error"); return; }
    load();
  }

  async function promote(userId: string, role: string) {
    setBusy(true);
    const { error } = await supabase.rpc("set_group_member_role", { p_conversation_id: conversation.id, p_user_id: userId, p_role: role });
    setBusy(false);
    if (error) { notify(error.message, "error"); return; }
    load();
  }

  async function archive() {
    setBusy(true);
    const { error } = await supabase.rpc("archive_conversation", { p_conversation_id: conversation.id, p_archived: true });
    setBusy(false);
    if (error) { notify(error.message, "error"); return; }
    onArchived();
  }

  async function leave() {
    setBusy(true);
    const { error } = await supabase.rpc("remove_group_member", { p_conversation_id: conversation.id, p_user_id: myUserId });
    setBusy(false);
    if (error) { notify(error.message, "error"); return; }
    onLeft();
  }

  return (
    <>
      <Modal open={open} onClose={onClose} title={conversation.title || "Group info"} size="md">
        <div className="space-y-4">
          {conversation.description && <p className="text-sm text-gray-500">{conversation.description}</p>}
          {conversation.is_auto && (
            <p className="text-xs bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-gray-500">
              This group&apos;s membership is kept in sync automatically from the school&apos;s class and staff records.
            </p>
          )}

          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-700">{members.length} members</span>
            {isAdminHere && !conversation.is_auto && (
              <button onClick={() => setAddOpen(true)} className="flex items-center gap-1 text-xs text-[#0F2A47] font-medium hover:underline">
                <UserPlus size={14} /> Add
              </button>
            )}
          </div>

          <div className="max-h-64 overflow-y-auto divide-y divide-gray-100">
            {members.map((m) => (
              <div key={m.user_id} className="flex items-center gap-2 py-2">
                <Avatar name={m.full_name} seed={m.user_id} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-800 truncate">{m.full_name}{m.user_id === myUserId ? " (you)" : ""}</p>
                  <p className="text-xs text-gray-400 capitalize">{m.member_role} · {m.role}</p>
                </div>
                {isAdminHere && !conversation.is_auto && m.member_role !== "owner" && m.user_id !== myUserId && (
                  <div className="flex items-center gap-2">
                    {m.member_role !== "admin" && (
                      <button disabled={busy} onClick={() => promote(m.user_id, "admin")} title="Make admin" className="text-gray-400 hover:text-[#0F2A47]">
                        <Shield size={15} />
                      </button>
                    )}
                    <button disabled={busy} onClick={() => removeMember(m.user_id)} className="text-xs text-red-500 hover:underline">Remove</button>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
            {isAdminHere && (
              <Button variant="secondary" size="sm" onClick={archive} loading={busy}>
                <Archive size={14} /> Archive group
              </Button>
            )}
            {!conversation.is_auto && (
              <Button variant="ghost" size="sm" onClick={leave} loading={busy}>
                <LogOut size={14} /> Leave group
              </Button>
            )}
          </div>
        </div>
      </Modal>
      {addOpen && (
        <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add members" size="sm">
          <AddMembersInline conversationId={conversation.id} onAdded={() => { setAddOpen(false); load(); }} />
        </Modal>
      )}
      <ToastHost />
    </>
  );
}

function AddMembersInline({ conversationId, onAdded }: { conversationId: string; onAdded: () => void }) {
  const supabase = createClient();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ user_id: string; full_name: string; subtitle: string }[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc("search_messageable_users", { p_query: query, p_limit: 20 });
      if (!error) setResults((data as typeof results) ?? []);
    }, 250);
    return () => clearTimeout(t);
  }, [query, supabase]);

  async function add(userId: string) {
    setBusy(userId);
    setError(null);
    const { error } = await supabase.rpc("add_group_member", { p_conversation_id: conversationId, p_user_id: userId });
    setBusy(null);
    if (error) { setError(error.message); return; }
    onAdded();
  }

  return (
    <div className="space-y-2">
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search people…"
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" autoFocus />
      {error && <div className="text-xs text-red-600">{error}</div>}
      <div className="max-h-56 overflow-y-auto divide-y divide-gray-100">
        {results.map((u) => (
          <button key={u.user_id} disabled={busy === u.user_id} onClick={() => add(u.user_id)}
            className="w-full flex items-center gap-2 py-2 text-left hover:bg-gray-50 disabled:opacity-50">
            <Avatar name={u.full_name} seed={u.user_id} size={28} />
            <span className="text-sm truncate">{u.full_name}</span>
            <span className="text-xs text-gray-400 ml-auto">{u.subtitle}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
