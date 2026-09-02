"use client";

import { useCallback, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import { useConversationList, useMessages, useMessagingPolicy } from "@/lib/messaging/hooks";
import { uploadMessageAttachment, getAttachmentSignedUrl } from "@/lib/messaging/storage";
import { ConversationListPanel } from "@/components/messaging/ConversationListPanel";
import { ChatHeader } from "@/components/messaging/ChatHeader";
import { MessageBubble } from "@/components/messaging/MessageBubble";
import { Composer } from "@/components/messaging/Composer";
import { NewMessageModal } from "@/components/messaging/NewMessageModal";
import { GroupCreateModal } from "@/components/messaging/GroupCreateModal";
import { GroupInfoPanel } from "@/components/messaging/GroupInfoPanel";
import { ReportMessageModal } from "@/components/messaging/ReportMessageModal";
import { AutoGroupsModal } from "@/components/messaging/AutoGroupsModal";
import { SetupHero } from "@/components/ui/SetupHero";
import { LoadingSpinner } from "@/components/ui/PageHeader";
import { Modal } from "@/components/ui/Modal";
import type { Message } from "@/lib/messaging/types";
import { MessageSquare, Users, ShieldAlert, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";

const STAFF_ROLES = new Set(["owner", "admin", "editor", "staff", "bursar", "accountant", "developer", "teacher"]);

interface Props {
  activeConversationId: string | null;
}

export function MessagesShell({ activeConversationId }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const { user, profile, orgId, isOrgAdmin, hasModule, membership } = useAuth();
  const myRole = membership?.role ?? "";
  const isStaff = STAFF_ROLES.has(myRole);

  const { policy, loading: policyLoading, configured } = useMessagingPolicy();
  const { items, loading: listLoading, refresh: refreshList } = useConversationList();
  const { messages, loading: msgLoading, loadingMore, hasMore, loadMore, refresh: refreshMessages, typingUsers, setTyping } =
    useMessages(activeConversationId);

  const [newMsgOpen, setNewMsgOpen] = useState(false);
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [autoGroupsOpen, setAutoGroupsOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportTarget, setReportTarget] = useState<Message | null>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  const active = items.find((i) => i.conversation.id === activeConversationId) ?? null;

  const handleSend = useCallback(async (body: string, files: File[]) => {
    if (!activeConversationId || !orgId) return;
    let attachments: unknown[] | undefined;
    if (files.length > 0) {
      attachments = await Promise.all(files.map((f) => uploadMessageAttachment(orgId, activeConversationId, f)));
    }
    const messageType = files.length > 0 && files[0].type.startsWith("image/") ? "image"
      : files.length > 0 ? "document" : "text";
    const { error } = await supabase.rpc("send_message", {
      p_conversation_id: activeConversationId,
      p_body: body || null,
      p_message_type: messageType,
      p_reply_to_id: replyTo?.id ?? null,
      p_attachments: attachments ?? null,
    });
    if (error) throw new Error(error.message);
    setReplyTo(null);
    refreshMessages();
    refreshList();
  }, [supabase, activeConversationId, orgId, replyTo, refreshMessages, refreshList]);

  const handleSaveEdit = useCallback(async (body: string) => {
    if (!editing) return;
    await supabase.rpc("edit_message", { p_message_id: editing.id, p_body: body });
    setEditing(null);
    refreshMessages();
  }, [supabase, editing, refreshMessages]);

  const handleDelete = useCallback(async (m: Message) => {
    if (!confirm("Delete this message?")) return;
    await supabase.rpc("delete_message", { p_message_id: m.id });
    refreshMessages();
  }, [supabase, refreshMessages]);

  const handleReact = useCallback(async (m: Message, emoji: string) => {
    await supabase.rpc("react_to_message", { p_message_id: m.id, p_emoji: emoji });
    refreshMessages();
  }, [supabase, refreshMessages]);

  const handlePin = useCallback(async (m: Message, pinned: boolean) => {
    await supabase.rpc("pin_message", { p_message_id: m.id, p_pinned: pinned });
    refreshMessages();
  }, [supabase, refreshMessages]);

  const handleOpenAttachment = useCallback(async (path: string, fileName: string) => {
    const url = await getAttachmentSignedUrl(path);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
    else alert(`Could not open ${fileName}`);
  }, []);

  if (policyLoading) {
    return <div className="flex items-center justify-center h-full"><LoadingSpinner /></div>;
  }

  if (!hasModule("communication")) {
    return (
      <div className="p-8 max-w-lg mx-auto text-center">
        <ShieldAlert className="mx-auto mb-3 text-gray-300" size={40} />
        <p className="text-gray-500">Communication is not enabled for your school yet. Ask your platform administrator to enable it.</p>
      </div>
    );
  }

  if (!configured) {
    return (
      <div className="p-6 md:p-10 max-w-2xl mx-auto">
        <SetupHero
          icon={<MessageSquare size={36} />}
          title="Set up school communication"
          description="Secure messaging between staff, teachers, parents and students — with safeguarding rules your school controls."
          bullets={[
            "Parents can message their child's teachers directly",
            "Class, subject, department and staff groups, kept in sync automatically",
            "Configurable safeguarding: control student messaging, moderation and more",
          ]}
          primaryCta={isOrgAdmin
            ? { label: "Configure Communication", onClick: () => router.push("/dashboard/messages/settings") }
            : { label: "Ask an administrator to set this up", onClick: () => {}, disabled: true }}
          tone="navy"
        />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-64px)] md:h-[calc(100vh-72px)] -m-6 bg-gray-50">
      <ConversationListPanel
        items={items}
        activeId={activeConversationId}
        onNewMessage={() => setNewMsgOpen(true)}
        onNewGroup={() => setNewGroupOpen(true)}
        canCreateGroup={isStaff || isOrgAdmin}
        hideOnMobileWhenActive
        isOrgAdmin={isOrgAdmin}
      />

      <div className={`flex-1 flex-col ${activeConversationId ? "flex" : "hidden md:flex"}`}>
        {!activeConversationId || !active ? (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400 p-8 text-center">
            <MessageSquare size={40} className="mb-3 opacity-30" />
            <p className="text-sm">Select a conversation, or start a new one.</p>
            {isStaff && (
              <button onClick={() => setAutoGroupsOpen(true)} className="mt-4 text-xs text-[#0F2A47] font-medium hover:underline flex items-center gap-1">
                <Users size={13} /> Browse school groups
              </button>
            )}
          </div>
        ) : (
          <>
            <ChatHeader
              title={active.display_title}
              subtitle={active.display_subtitle}
              avatarSeed={active.avatar_seed}
              avatarUrl={active.conversation.avatar_url}
              type={active.conversation.type}
              typingLabel={Object.values(typingUsers)[0] ? `${Object.values(typingUsers)[0]} is typing…` : null}
              onOpenInfo={() => setInfoOpen(true)}
              showSummarize={isStaff && messages.length > 15}
              threadTextForSummary={messages.slice(-60).map((m) => `${m.sender_name}: ${m.body ?? "[attachment]"}`).join("\n")}
              onSummary={setSummary}
            />
            <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2">
              {hasMore && (
                <button onClick={loadMore} disabled={loadingMore} className="mx-auto text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1 py-2">
                  {loadingMore && <Loader2 size={12} className="animate-spin" />} Load earlier messages
                </button>
              )}
              {msgLoading ? (
                <div className="flex-1 flex items-center justify-center"><LoadingSpinner /></div>
              ) : messages.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">No messages yet — say hello!</div>
              ) : (
                messages.map((m, idx) => (
                  <MessageBubble
                    key={m.id}
                    message={m}
                    mine={m.sender_id === user?.id}
                    showSender={idx === 0 || messages[idx - 1].sender_id !== m.sender_id}
                    isGroup={active.conversation.type !== "direct"}
                    canModerate={active.membership.member_role === "owner" || active.membership.member_role === "admin"}
                    onReply={setReplyTo}
                    onEdit={setEditing}
                    onDelete={handleDelete}
                    onReport={(msg) => { setReportTarget(msg); setReportOpen(true); }}
                    onReact={handleReact}
                    onPin={handlePin}
                    onOpenAttachment={handleOpenAttachment}
                    myUserId={user?.id ?? ""}
                  />
                ))
              )}
            </div>
            <Composer
              onSend={handleSend}
              replyTo={replyTo}
              onCancelReply={() => setReplyTo(null)}
              editing={editing}
              onCancelEdit={() => setEditing(null)}
              onSaveEdit={handleSaveEdit}
              disabled={!!active.conversation.locked_at || !!active.conversation.archived_at}
              disabledReason={active.conversation.locked_at ? "A moderator has locked this conversation." : active.conversation.archived_at ? "This conversation is archived." : undefined}
              onTyping={(t) => setTyping(t, profile?.full_name || user?.email || "Someone")}
              showAiAssist={isStaff}
              maxAttachmentMb={policy?.max_attachment_mb ?? 15}
              allowedAttachmentTypes={policy?.allowed_attachment_types ?? []}
            />
          </>
        )}
      </div>

      <NewMessageModal open={newMsgOpen} onClose={() => setNewMsgOpen(false)} onStarted={(id) => router.push(`/dashboard/messages/${id}`)} />
      <GroupCreateModal open={newGroupOpen} onClose={() => setNewGroupOpen(false)} onCreated={(id) => { refreshList(); router.push(`/dashboard/messages/${id}`); }} isAdmin={isOrgAdmin} />
      <AutoGroupsModal open={autoGroupsOpen} onClose={() => setAutoGroupsOpen(false)} onOpened={(id) => { refreshList(); router.push(`/dashboard/messages/${id}`); }} />
      {active && (
        <GroupInfoPanel
          open={infoOpen}
          onClose={() => setInfoOpen(false)}
          conversation={active.conversation}
          myUserId={user?.id ?? ""}
          isAdminHere={active.membership.member_role === "owner" || active.membership.member_role === "admin" || isOrgAdmin}
          onArchived={() => { setInfoOpen(false); refreshList(); router.push("/dashboard/messages"); }}
          onLeft={() => { setInfoOpen(false); refreshList(); router.push("/dashboard/messages"); }}
        />
      )}
      {activeConversationId && (
        <ReportMessageModal
          open={reportOpen}
          onClose={() => setReportOpen(false)}
          conversationId={activeConversationId}
          message={reportTarget}
          onReported={() => alert("Thanks — a school administrator will review this.")}
        />
      )}
      {summary && (
        <Modal open={!!summary} onClose={() => setSummary(null)} title="Conversation summary" size="md">
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{summary}</p>
        </Modal>
      )}
    </div>
  );
}
