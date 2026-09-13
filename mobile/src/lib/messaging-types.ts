export type ConversationType =
  | "direct"
  | "group"
  | "class"
  | "subject"
  | "parent_group"
  | "department"
  | "announcement";

export type MessageType = "text" | "image" | "document" | "voice" | "system";

export interface ConversationListItem {
  conversationId: string;
  type: ConversationType;
  title: string;
  subtitle: string;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  mutedAt: string | null;
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
