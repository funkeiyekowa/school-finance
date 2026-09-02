"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/context/AuthContext";
import type {
  ConversationListItem, ConversationType, Message, MessagingDashboardStats, MessagingPolicy,
} from "@/lib/messaging/types";

/* ------------------------------------------------------------------ */
/* Messaging policy (Section 20 setup gate + Section 8 safeguarding)   */
/* ------------------------------------------------------------------ */
export function useMessagingPolicy() {
  const supabase = useMemo(() => createClient(), []);
  const { orgId } = useAuth();
  const [policy, setPolicy] = useState<MessagingPolicy | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!orgId) { setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase.from("messaging_policy").select("*").eq("organization_id", orgId).maybeSingle();
    setPolicy((data as MessagingPolicy) ?? null);
    setLoading(false);
  }, [supabase, orgId]);

  useEffect(() => { refresh(); }, [refresh]);

  return { policy, loading, refresh, configured: policy?.configured ?? false };
}

/* ------------------------------------------------------------------ */
/* Conversation list — sidebar. Realtime-refreshed on any message,     */
/* membership or conversation change touching this user.               */
/* ------------------------------------------------------------------ */
export function useConversationList() {
  const supabase = useMemo(() => createClient(), []);
  const { user, orgId } = useAuth();
  const [items, setItems] = useState<ConversationListItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!orgId) { setLoading(false); return; }
    const { data, error } = await supabase.rpc("list_conversations", { p_limit: 100 });
    if (!error && data) {
      const rows = (data as Record<string, unknown>[]).map((r): ConversationListItem => {
        const type = r.type as ConversationType;
        const isDirect = type === "direct";
        const displayTitle = isDirect
          ? (r.other_full_name as string) || "Unknown"
          : (r.title as string) || "Untitled group";
        const displaySubtitle = isDirect
          ? initcap((r.other_role as string) || "")
          : `${r.member_count as number} member${(r.member_count as number) === 1 ? "" : "s"}`;
        return {
          conversation: {
            id: r.conversation_id as string, organization_id: orgId, type,
            title: r.title as string | null, description: r.description as string | null,
            avatar_url: r.avatar_url as string | null, context: (r.context as Record<string, unknown>) ?? {},
            auto_key: null, is_auto: r.is_auto as boolean, created_by: null,
            created_at: "", updated_at: r.updated_at as string,
            archived_at: r.archived_at as string | null, archived_by: null,
            locked_at: r.locked_at as string | null, locked_by: null, locked_reason: null,
          },
          membership: {
            id: "", conversation_id: r.conversation_id as string, organization_id: orgId,
            user_id: user?.id ?? "", member_role: r.member_role as ConversationListItem["membership"]["member_role"],
            joined_at: "", left_at: null, muted_at: r.muted_at as string | null,
            pinned_at: r.pinned_at as string | null, last_read_at: r.last_read_at as string,
            notification_pref: r.notification_pref as ConversationListItem["membership"]["notification_pref"], context: {},
          },
          display_title: displayTitle,
          display_subtitle: displaySubtitle,
          avatar_seed: isDirect ? (r.other_user_id as string) || displayTitle : (r.conversation_id as string),
          last_message_preview: previewFor(r.last_message_type as string | null, r.last_message_body as string | null),
          last_message_at: (r.last_message_at as string | null) ?? null,
          unread_count: (r.unread_count as number) ?? 0,
          other_member_ids: r.other_user_id ? [r.other_user_id as string] : [],
        };
      });
      setItems(rows);
    }
    setLoading(false);
  }, [supabase, orgId, user?.id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel(`conv-list-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "conversation_members", filter: `user_id=eq.${user.id}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [supabase, user?.id, load]);

  const totalUnread = items.reduce((sum, i) => sum + i.unread_count, 0);

  return { items, loading, refresh: load, totalUnread };
}

function previewFor(type: string | null, body: string | null): string | null {
  if (type === "image") return "📷 Photo";
  if (type === "document") return "📄 Document";
  if (type === "voice") return "🎙️ Voice message";
  if (type === "system") return body;
  return body;
}

function initcap(s: string): string {
  return s.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/* ------------------------------------------------------------------ */
/* Messages in one conversation — cursor-paginated + realtime + typing */
/* ------------------------------------------------------------------ */
export function useMessages(conversationId: string | null) {
  const supabase = useMemo(() => createClient(), []);
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [typingUsers, setTypingUsers] = useState<Record<string, string>>({});
  const typingChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const mapRow = (r: Record<string, unknown>): Message => ({
    id: r.id as string, organization_id: "", conversation_id: conversationId ?? "",
    sender_id: r.sender_id as string, message_type: r.message_type as Message["message_type"],
    body: r.body as string | null, reply_to_id: r.reply_to_id as string | null, metadata: {},
    created_at: r.created_at as string, edited_at: r.edited_at as string | null,
    deleted_at: r.deleted_at as string | null, deleted_by: null,
    pinned_at: r.pinned_at as string | null, pinned_by: null, removed_by_moderator: false,
    attachments: (r.attachments as Message["attachments"]) ?? [],
    reactions: (r.reactions as Message["reactions"]) ?? [],
    sender_name: r.sender_name as string, sender_role: r.sender_role as string,
    reply_to: r.reply_to_id ? {
      id: r.reply_to_id as string, body: r.reply_to_body as string | null,
      sender_id: r.reply_to_sender_id as string, message_type: "text",
    } : null,
  });

  const loadInitial = useCallback(async () => {
    if (!conversationId) { setMessages([]); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase.rpc("get_messages", { p_conversation_id: conversationId, p_limit: 40 });
    if (!error && data) {
      const rows = (data as Record<string, unknown>[]).map(mapRow).reverse();
      setMessages(rows);
      setHasMore(rows.length === 40);
    }
    setLoading(false);
    if (conversationId) supabase.rpc("mark_messages_read", { p_conversation_id: conversationId }).then(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, conversationId]);

  const loadMore = useCallback(async () => {
    if (!conversationId || messages.length === 0 || loadingMore || !hasMore) return;
    setLoadingMore(true);
    const oldest = messages[0]?.created_at;
    const { data, error } = await supabase.rpc("get_messages", {
      p_conversation_id: conversationId, p_before: oldest, p_limit: 40,
    });
    if (!error && data) {
      const rows = (data as Record<string, unknown>[]).map(mapRow).reverse();
      setMessages((prev) => [...rows, ...prev]);
      setHasMore(rows.length === 40);
    }
    setLoadingMore(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, conversationId, messages, loadingMore, hasMore]);

  useEffect(() => { loadInitial(); }, [loadInitial]);

  // Realtime: new/edited/deleted messages + reactions in this conversation.
  useEffect(() => {
    if (!conversationId) return;
    const channel = supabase
      .channel(`conv-${conversationId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
        () => { loadInitial(); })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
        () => { loadInitial(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "message_reactions" },
        () => { loadInitial(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, conversationId]);

  // Presence-based typing indicator.
  useEffect(() => {
    if (!conversationId || !user?.id) return;
    const channel = supabase.channel(`typing-${conversationId}`, { config: { presence: { key: user.id } } });
    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<{ name: string; typing: boolean }>();
        const next: Record<string, string> = {};
        for (const [uid, entries] of Object.entries(state)) {
          if (uid === user.id) continue;
          const e = entries[entries.length - 1];
          if (e?.typing) next[uid] = e.name;
        }
        setTypingUsers(next);
      })
      .subscribe();
    typingChannelRef.current = channel;
    return () => { supabase.removeChannel(channel); typingChannelRef.current = null; };
  }, [supabase, conversationId, user?.id]);

  const setTyping = useCallback((typing: boolean, name: string) => {
    typingChannelRef.current?.track({ name, typing, at: Date.now() });
  }, []);

  return { messages, loading, loadingMore, hasMore, loadMore, refresh: loadInitial, typingUsers, setTyping };
}

/* ------------------------------------------------------------------ */
/* Dashboard KPI stats (Section 22)                                    */
/* ------------------------------------------------------------------ */
export function useMessagingDashboardStats() {
  const supabase = useMemo(() => createClient(), []);
  const { orgId, hasModule } = useAuth();
  const [stats, setStats] = useState<MessagingDashboardStats | null>(null);

  useEffect(() => {
    if (!orgId || !hasModule("communication")) return;
    supabase.rpc("messaging_dashboard_stats").then(({ data, error }) => {
      if (!error && data) setStats(data as MessagingDashboardStats);
    });
  }, [supabase, orgId, hasModule]);

  return stats;
}

/* ------------------------------------------------------------------ */
/* Nav badge — lightweight poll (not a dedicated realtime subscription; */
/* the chat pages themselves stay fully realtime). Refreshed on mount   */
/* and every 30s so the sidebar count doesn't go stale while a user     */
/* works elsewhere in the app.                                         */
/* ------------------------------------------------------------------ */
export function useUnreadMessagesBadge(): number {
  const supabase = useMemo(() => createClient(), []);
  const { orgId, hasModule } = useAuth();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!orgId || !hasModule("communication")) { setCount(0); return; }
    let cancelled = false;
    const fetchCount = () => {
      supabase.rpc("messaging_dashboard_stats").then(({ data, error }) => {
        if (!cancelled && !error && data) {
          setCount((data as MessagingDashboardStats).unread_messages ?? 0);
        }
      });
    };
    fetchCount();
    const interval = setInterval(fetchCount, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [supabase, orgId, hasModule]);

  return count;
}
