export type ConversationType =
  | "direct"
  | "group"
  | "class"
  | "subject"
  | "parent_group"
  | "department"
  | "announcement";

export type MessageType = "text" | "image" | "document" | "voice" | "system";

/**
 * Mirrors src/lib/messaging/types.ts's NotificationPref exactly (same four
 * values, same CHECK constraint on conversation_members.notification_pref).
 * All four values now have real push-filtering semantics implemented server-side
 * in push_targets_for_message():
 *   'all'       — notify on every message (unchanged)
 *   'mentions'  — notify only when cm.user_id ∈ messages.mentioned_user_ids
 *   'important' — notify only when messages.is_important = true
 *   'muted'     — never notify (unchanged)
 */
export type NotificationPref = "all" | "mentions" | "important" | "muted";

export interface ConversationListItem {
  conversationId: string;
  type: ConversationType;
  title: string;
  subtitle: string;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  mutedAt: string | null;
  notificationPref: NotificationPref;
  pinnedAt: string | null;
  lockedAt: string | null;
  archivedAt: string | null;
  otherUserId: string | null;
}

export interface ChatAttachment {
  id: string;
  storagePath: string;
  fileName: string;
  fileType: string;
  fileSizeBytes: number;
  width: number | null;
  height: number | null;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderRole: string;
  messageType: MessageType;
  body: string | null;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  pinnedAt: string | null;
  replyToId: string | null;
  replyToBody: string | null;
  attachmentCount: number;
  attachments: ChatAttachment[];
  /** Users @-mentioned in this message. Drives 'mentions' notification_pref filtering. */
  mentionedUserIds: string[];
  /** Sender marked this message as important. Drives 'important' notification_pref filtering. */
  isImportant: boolean;
}

export interface MessageableUser {
  user_id: string;
  full_name: string;
  role: string;
  subtitle: string;
}

export const CONVERSATION_TYPE_LABELS: Record<ConversationType, string> = {
  direct: "Direct message",
  group: "Group",
  class: "Class group",
  subject: "Subject group",
  parent_group: "Parent group",
  department: "Department",
  announcement: "Announcement",
};

/** Order matches the picker UI, most-to-least notifications. */
export const NOTIFICATION_PREF_OPTIONS: { value: NotificationPref; label: string; hint: string }[] = [
  { value: "all",       label: "All messages",   hint: "Notify me for every new message" },
  { value: "mentions",  label: "Mentions only",  hint: "Notify me only when I'm @mentioned" },
  { value: "important", label: "Important only", hint: "Notify me only for messages marked important" },
  { value: "muted",     label: "Muted",          hint: "Don't send me notifications for this conversation" },
];

export function initcap(value: string): string {
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, " ");
}

/** Mirrors the web list preview: attachments read as a label, not empty text. */
export function previewFor(messageType: string | null, body: string | null): string | null {
  if (!messageType) return null;
  if (messageType === "image") return "📷 Photo";
  if (messageType === "document") return "📎 Document";
  if (messageType === "voice") return "🎤 Voice note";
  return body;
}

/** Short relative stamp for the conversation list. */
export function shortStamp(iso: string | null): string {
  if (!iso) return "";
  const then = new Date(iso);
  const now = new Date();
  const sameDay =
    then.getFullYear() === now.getFullYear() && then.getMonth() === now.getMonth() && then.getDate() === now.getDate();
  if (sameDay) return then.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const days = Math.floor((now.getTime() - then.getTime()) / 86_400_000);
  if (days < 7) return then.toLocaleDateString(undefined, { weekday: "short" });
  return then.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function clockStamp(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
