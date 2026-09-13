import { supabase } from "@/lib/supabase";
import {
  initcap,
  previewFor,
  type ChatMessage,
  type ConversationListItem,
  type ConversationType,
  type MessageableUser,
} from "@/lib/messaging-types";

/**
 * Mobile Messages — Phase 2.
 *
 * Adds NO backend surface. Every call already exists and is already used by the
 * web messaging shell (src/components/messaging/MessagesShell.tsx) and
 * src/lib/messaging/hooks.ts.
 *
 * The server stays the authority throughout:
 *   - list_conversations / get_messages return only conversations the caller is
 *     a member of; RLS does the tenant isolation.
 *   - send_message validates membership and stamps organization_id server-side.
 *     No organization_id is ever sent from this client.
 *   - search_messageable_users applies messaging_policy (can_message_user), so
 *     "which parents may message which teachers" is decided server-side, not
 *     by filtering a list on the phone.
 *
 * Attachments are deliberately NOT sent from mobile this phase — see
 * docs. Sending is text-only; received attachments are labelled.
 */

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

export async function listConversations(limit = 100): Promise<ConversationListItem[]> {
  const { data, error } = await supabase.rpc("list_conversations", { p_limit: limit });
  if (error) throw new Error(error.message || "Could not load your conversations.");

  return rows(data).map((r): ConversationListItem => {
    const type = r.type as ConversationType;
    const isDirect = type === "direct";
    const memberCount = (r.member_count as number) ?? 0;
    return {
      conversationId: r.conversation_id as string,
      type,
      title: isDirect ? ((r.other_full_name as string) || "Unknown") : ((r.title as string) || "Untitled group"),
      subtitle: isDirect
        ? initcap((r.other_role as string) || "")
        : `${memberCount} member${memberCount === 1 ? "" : "s"}`,
      lastMessagePreview: previewFor(r.last_message_type as string | null, r.last_message_body as string | null),
      lastMessageAt: (r.last_message_at as string | null) ?? null,
      unreadCount: (r.unread_count as number) ?? 0,
      mutedAt: (r.muted_at as string | null) ?? null,
      pinnedAt: (r.pinned_at as string | null) ?? null,
      lockedAt: (r.locked_at as string | null) ?? null,
      archivedAt: (r.archived_at as string | null) ?? null,
      otherUserId: (r.other_user_id as string | null) ?? null,
    };
  });
}

export async function getMessages(conversationId: string, before?: string, limit = 40): Promise<ChatMessage[]> {
  const params: Record<string, unknown> = { p_conversation_id: conversationId, p_limit: limit };
  if (before) params.p_before = before;
  const { data, error } = await supabase.rpc("get_messages", params);
  if (error) throw new Error(error.message || "Could not load messages.");

  // get_messages returns newest-first; the UI renders oldest-first.
  return rows(data)
    .map(
      (r): ChatMessage => ({
        id: r.id as string,
        senderId: r.sender_id as string,
        senderName: (r.sender_name as string) || "Unknown",
        senderRole: (r.sender_role as string) || "",
        messageType: (r.message_type as ChatMessage["messageType"]) ?? "text",
        body: (r.body as string | null) ?? null,
        createdAt: r.created_at as string,
        editedAt: (r.edited_at as string | null) ?? null,
        deletedAt: (r.deleted_at as string | null) ?? null,
        pinnedAt: (r.pinned_at as string | null) ?? null,
        replyToId: (r.reply_to_id as string | null) ?? null,
        replyToBody: (r.reply_to_body as string | null) ?? null,
        attachmentCount: Array.isArray(r.attachments) ? (r.attachments as unknown[]).length : 0,
      }),
    )
    .reverse();
}

export async function markRead(conversationId: string): Promise<void> {
  try {
    await supabase.rpc("mark_messages_read", { p_conversation_id: conversationId });
  } catch {
    // Read receipts are best-effort — never block the thread on this.
  }
}

/**
 * Sends a text message. organization_id is stamped server-side by the RPC;
 * attachments are not supported from mobile this phase and are always null.
 */
export async function sendMessage(params: { conversationId: string; body: string; replyToId?: string | null }): Promise<void> {
  const body = params.body.trim();
  if (!body) return;
  const { error } = await supabase.rpc("send_message", {
    p_conversation_id: params.conversationId,
    p_body: body,
    p_message_type: "text",
    p_reply_to_id: params.replyToId ?? null,
    p_attachments: null,
  });
  if (error) throw new Error(error.message || "Could not send your message.");
}

/**
 * Who this user is allowed to message. The RPC applies messaging_policy
 * server-side (students_can_message, parents_require_child_link, and so on) —
 * the phone never decides who is reachable.
 */
export async function searchMessageableUsers(query: string, limit = 25): Promise<MessageableUser[]> {
  const { data, error } = await supabase.rpc("search_messageable_users", { p_query: query, p_limit: limit });
  if (error) throw new Error(error.message || "Could not search for people to message.");
  return rows(data).map((r) => ({
    user_id: r.user_id as string,
    full_name: (r.full_name as string) || "Unknown",
    role: (r.role as string) || "",
    subtitle: (r.subtitle as string) || "",
  }));
}

/** Opens (or reuses) a direct conversation. The RPC re-checks permission. */
export async function createDirectConversation(otherUserId: string): Promise<string> {
  const { data, error } = await supabase.rpc("create_direct_conversation", { p_other: otherUserId });
  if (error) throw new Error(error.message || "You are not permitted to message this person.");
  const id = typeof data === "string" ? data : ((data as { conversation_id?: string } | null)?.conversation_id ?? null);
  if (!id) throw new Error("Could not open that conversation.");
  return id;
}

export async function unreadBadge(): Promise<number> {
  const { data, error } = await supabase.rpc("messaging_dashboard_stats");
  if (error) return 0;
  const row = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : (data as Record<string, unknown> | null);
  const n = row?.unread_messages;
  return typeof n === "number" ? n : 0;
}

/**
 * Realtime subscription for one conversation. Mirrors the web hook: any insert,
 * update or reaction in this conversation triggers a reload.
 */
export function subscribeToConversation(conversationId: string, onChange: () => void): () => void {
  const channel = supabase
    .channel(`mobile-conv-${conversationId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
      onChange,
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
      onChange,
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

/** Realtime subscription for the conversation list. */
export function subscribeToConversationList(userId: string, onChange: () => void): () => void {
  const channel = supabase
    .channel(`mobile-conv-list-${userId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "conversation_members" }, onChange)
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}
