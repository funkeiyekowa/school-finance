/**
 * Types for the Communication / Chat module.
 *
 * These tables (conversations, messages, ...) are hand-defined here
 * rather than derived from Database["public"]["Tables"] in
 * src/lib/types/database.ts, matching the convention already used by
 * newer modules (LMS, clinic, hostel, etc.) whose tables also predate
 * (or postdate) the last time that generated file was refreshed.
 */

export type ConversationType =
  | "direct" | "group" | "class" | "subject" | "parent_group" | "department" | "announcement";

export type ConversationMemberRole = "owner" | "admin" | "moderator" | "member";
export type NotificationPref = "all" | "mentions" | "important" | "muted";
export type MessageType = "text" | "image" | "document" | "voice" | "system";

export interface Conversation {
  id: string;
  organization_id: string;
  type: ConversationType;
  title: string | null;
  description: string | null;
  avatar_url: string | null;
  context: Record<string, unknown>;
  auto_key: string | null;
  is_auto: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  archived_by: string | null;
  locked_at: string | null;
  locked_by: string | null;
  locked_reason: string | null;
}

export interface ConversationMember {
  id: string;
  conversation_id: string;
  organization_id: string;
  user_id: string;
  member_role: ConversationMemberRole;
  joined_at: string;
  left_at: string | null;
  muted_at: string | null;
  pinned_at: string | null;
  last_read_at: string;
  notification_pref: NotificationPref;
  context: Record<string, unknown>;
}

export interface MessageAttachment {
  id: string;
  organization_id: string;
  message_id: string;
  storage_path: string;
  file_name: string;
  file_type: string;
  file_size_bytes: number;
  width: number | null;
  height: number | null;
  created_at: string;
  /** Populated client-side after generating a signed URL — not a DB column. */
  signed_url?: string;
}

export interface MessageReaction {
  id: string;
  organization_id: string;
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
}

export interface Message {
  id: string;
  organization_id: string;
  conversation_id: string;
  sender_id: string;
  message_type: MessageType;
  body: string | null;
  reply_to_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  pinned_at: string | null;
  pinned_by: string | null;
  removed_by_moderator: boolean;
  // Joined/denormalized client-side fields:
  attachments?: MessageAttachment[];
  reactions?: MessageReaction[];
  sender_name?: string;
  sender_role?: string;
  reply_to?: Pick<Message, "id" | "body" | "sender_id" | "message_type"> | null;
}

export interface MessagingPolicy {
  id: string;
  organization_id: string;
  students_can_message: boolean;
  students_can_message_students: boolean;
  students_can_message_teachers: boolean;
  students_can_initiate_dm: boolean;
  parents_can_message: boolean;
  parents_can_message_teachers: boolean;
  parents_can_message_staff: boolean;
  parents_require_child_link: boolean;
  teachers_can_message_students: boolean;
  staff_can_message_all_staff: boolean;
  group_creator_roles: string[];
  max_attachment_mb: number;
  allowed_attachment_types: string[];
  admins_can_audit_conversations: boolean;
  moderator_roles: string[];
  default_notification_pref: NotificationPref;
  configured: boolean;
  configured_by: string | null;
  configured_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ModerationReport {
  id: string;
  organization_id: string;
  conversation_id: string;
  message_id: string | null;
  reported_by: string;
  reason: string;
  details: string | null;
  status: "open" | "reviewing" | "actioned" | "dismissed";
  reviewed_by: string | null;
  reviewed_at: string | null;
  resolution_notes: string | null;
  created_at: string;
  // Joined client-side:
  conversation_title?: string | null;
  message_body?: string | null;
  reporter_name?: string;
}

/** A row in the conversation list — conversation + this user's membership + a display summary. */
export interface ConversationListItem {
  conversation: Conversation;
  membership: ConversationMember;
  display_title: string;
  display_subtitle: string;
  avatar_seed: string;
  last_message_preview: string | null;
  last_message_at: string | null;
  unread_count: number;
  other_member_ids: string[];
}

export interface MessageableUser {
  user_id: string;
  full_name: string;
  role: string;
  subtitle: string;
}

export interface MessagingDashboardStats {
  unread_messages: number;
  active_conversations: number;
  active_groups: number | null;
  pending_reports: number | null;
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

export const REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
