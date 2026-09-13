import { supabase } from "@/lib/supabase";
import { requestPushForMessage } from "@/lib/push-service";
import type { UploadedAttachment } from "@/lib/attachment-service";
import {
  initcap,
  previewFor,
  type ChatAttachment,
  type ChatMessage,
  type ConversationListItem,
  type ConversationType,
  type MessageableUser,
  type NotificationPref,
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
 * Attachments: sendMessage() now accepts already-uploaded attachment
 * metadata (see attachment-service.ts for the upload step) and forwards it
 * to send_message()'s p_attachments jsonb param exactly as the web app
 * does — organization_id and message_id are stamped server-side inside the
 * function, never read from this payload.
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
      notificationPref: ((r.notification_pref as string | null) || "all") as NotificationPref,
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
        attachments: mapAttachments(r.attachments),
      }),
    )
    .reverse();
}

function mapAttachments(value: unknown): ChatAttachment[] {
  if (!Array.isArray(value)) return [];
  return (value as Record<string, unknown>[]).map((a) => ({
    id: a.id as string,
    storagePath: a.storage_path as string,
    fileName: (a.file_name as string) || "Attachment",
    fileType: (a.file_type as string) || "application/octet-stream",
    fileSizeBytes: (a.file_size_bytes as number) ?? 0,
    width: (a.width as number | null) ?? null,
    height: (a.height as number | null) ?? null,
  }));
}

/**
 * Attachment limits from messaging_policy, for the client-side courtesy
 * check before uploading — mirrors useMessagingPolicy() on web. Falls back
 * to generous defaults if the row can't be read; the upload route enforces
 * its own backstop regardless (25MB, a fixed type allowlist), so a missed
 * read here never widens what the server actually accepts.
 */
export async function fetchAttachmentLimits(): Promise<{ maxAttachmentMb: number; allowedTypes: string[] }> {
  const { data } = await supabase.from("messaging_policy").select("max_attachment_mb, allowed_attachment_types").maybeSingle();
  const row = data as { max_attachment_mb?: number; allowed_attachment_types?: string[] } | null;
  return {
    maxAttachmentMb: row?.max_attachment_mb ?? 15,
    allowedTypes: row?.allowed_attachment_types ?? [],
  };
}

export async function markRead(conversationId: string): Promise<void> {
  try {
    await supabase.rpc("mark_messages_read", { p_conversation_id: conversationId });
  } catch {
    // Read receipts are best-effort — never block the thread on this.
  }
}

/**
 * Reads this user's own notification preference for one conversation, for
 * the chat screen's settings sheet. Falls back to 'all' (the column
 * default) on any read failure — never blocks opening the thread.
 */
export async function getNotificationPref(conversationId: string): Promise<NotificationPref> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth.user?.id;
    if (!userId) return "all";
    const { data } = await supabase
      .from("conversation_members")
      .select("notification_pref")
      .eq("conversation_id", conversationId)
      .eq("user_id", userId)
      .maybeSingle();
    const row = data as { notification_pref?: string } | null;
    return (row?.notification_pref as NotificationPref) || "all";
  } catch {
    return "all";
  }
}

/**
 * Sets this user's own notification preference for one conversation.
 * conversation_members.notification_pref already exists (CHECK constrained
 * to 'all'|'mentions'|'important'|'muted') and the conv_members_self_update
 * RLS policy already permits a member to update their own row directly — no
 * RPC, no migration. muted_at is kept in lockstep with the 'muted' value
 * because push_targets_for_message() ANDs both (cm.muted_at IS NULL AND
 * notification_pref <> 'muted'); setting only one and not the other would
 * leave the two mute signals inconsistent for a caller reading either alone.
 *
 * The update payload below is a literal object of exactly these two
 * columns — never a spread of a fetched conversation_members row. The RLS
 * policy is row-scoped only (organization_id + user_id), not column-scoped,
 * so a full-row update could otherwise silently rewrite member_role or
 * other fields it was never meant to touch.
 */
export async function setNotificationPref(conversationId: string, pref: NotificationPref): Promise<void> {
  if (!conversationId) return;
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error("You are signed out.");

  const { error } = await supabase
    .from("conversation_members")
    .update({
      notification_pref: pref,
      muted_at: pref === "muted" ? new Date().toISOString() : null,
    })
    .eq("conversation_id", conversationId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message || "Could not update notification settings.");
}

/**
 * Sends a message, optionally with attachments already uploaded via
 * uploadAttachment(). organization_id and the message id are stamped
 * server-side by the RPC; message_type is inferred from the first
 * attachment the same way the web Composer does.
 */
export async function sendMessage(params: {
  conversationId: string;
  body: string;
  replyToId?: string | null;
  attachments?: UploadedAttachment[];
}): Promise<void> {
  const body = params.body.trim();
  const attachments = params.attachments ?? [];
  if (!body && attachments.length === 0) return;

  const messageType = attachments.length > 0 && attachments[0].file_type.startsWith("image/")
    ? "image"
    : attachments.length > 0
      ? "document"
      : "text";

  const { data, error } = await supabase.rpc("send_message", {
    p_conversation_id: params.conversationId,
    p_body: body || null,
    p_message_type: messageType,
    p_reply_to_id: params.replyToId ?? null,
    p_attachments: attachments.length > 0 ? attachments : null,
  });
  if (error) throw new Error(error.message || "Could not send your message.");

  // Ask the server to deliver push to the other members. Fire-and-forget: the
  // message is already persisted, and the route re-verifies that we are the
  // sender before it resolves anyone's device token.
  const messageId = extractMessageId(data);
  if (messageId) void requestPushForMessage(messageId);
}

/** send_message may return a bare uuid or an object; accept either. */
function extractMessageId(data: unknown): string | null {
  if (typeof data === "string" && data.length > 0) return data;
  const row = Array.isArray(data) ? data[0] : data;
  if (row && typeof row === "object") {
    const candidate = (row as { id?: unknown; message_id?: unknown }).message_id ?? (row as { id?: unknown }).id;
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  }
  return null;
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
