import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Card, SectionTitle, ui } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { colors } from "@/lib/theme";
import { listConversations, subscribeToConversationList } from "@/lib/messaging-service";
import { CONVERSATION_TYPE_LABELS, shortStamp, type ConversationListItem } from "@/lib/messaging-types";

export default function MessagesScreen() {
  const { identity } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<ConversationListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setItems(await listConversations());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your conversations.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Refresh on return from a thread so unread counts settle immediately.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useEffect(() => {
    if (!identity) return;
    return subscribeToConversationList(identity.userId, () => void load());
  }, [identity, load]);

  if (!identity) return null;

  if (loading) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator size="large" color={colors.gold} />
      </View>
    );
  }

  const pinned = items.filter((i) => i.pinnedAt && !i.archivedAt);
  const rest = items.filter((i) => !i.pinnedAt && !i.archivedAt);

  function Row({ item }: { item: ConversationListItem }) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open conversation with ${item.title}`}
        onPress={() =>
          router.push({ pathname: "/(app)/chat/[conversationId]", params: { conversationId: item.conversationId, title: item.title } } as never)
        }
        style={({ pressed }) => pressed && styles.pressed}
      >
        <Card>
          <View style={styles.rowTop}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={styles.stamp}>{shortStamp(item.lastMessageAt)}</Text>
          </View>
          <Text style={styles.rowSub} numberOfLines={1}>
            {item.type === "direct" ? item.subtitle : `${CONVERSATION_TYPE_LABELS[item.type]} · ${item.subtitle}`}
          </Text>
          <View style={styles.rowBottom}>
            <Text style={[styles.preview, item.unreadCount > 0 && styles.previewUnread]} numberOfLines={1}>
              {item.lastMessagePreview ?? "No messages yet"}
            </Text>
            {item.unreadCount > 0 ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{item.unreadCount > 99 ? "99+" : item.unreadCount}</Text>
              </View>
            ) : null}
          </View>
          {item.mutedAt ? <Text style={styles.flag}>Muted</Text> : null}
          {item.lockedAt ? <Text style={styles.flagLocked}>Locked by a moderator</Text> : null}
        </Card>
      </Pressable>
    );
  }

  return (
    <View style={ui.screen}>
      <ScrollView
        contentContainerStyle={ui.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
            tintColor={colors.navy}
          />
        }
      >
        {error ? <Text style={ui.error}>{error}</Text> : null}

        {items.length === 0 ? (
          <Card>
            <Text style={styles.rowTitle}>No conversations yet</Text>
            <Text style={ui.muted}>
              Start one with the New message button, or wait for your school to add you to a class or group.
            </Text>
          </Card>
        ) : (
          <>
            {pinned.length > 0 ? (
              <>
                <SectionTitle title="Pinned" />
                {pinned.map((i) => (
                  <Row key={i.conversationId} item={i} />
                ))}
              </>
            ) : null}
            {rest.map((i) => (
              <Row key={i.conversationId} item={i} />
            ))}
          </>
        )}
      </ScrollView>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="New message"
        onPress={() => router.push("/(app)/new-message" as never)}
        style={({ pressed }) => [styles.fab, pressed && styles.pressed]}
      >
        <Text style={styles.fabText}>New message</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.canvas },
  rowTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  rowTitle: { color: colors.navy, fontSize: 16, fontWeight: "800", flex: 1 },
  stamp: { color: colors.muted, fontSize: 11, fontWeight: "600" },
  rowSub: { color: colors.muted, fontSize: 12, marginTop: -4 },
  rowBottom: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 2 },
  preview: { color: colors.muted, fontSize: 14, flex: 1 },
  previewUnread: { color: colors.ink, fontWeight: "700" },
  badge: { minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 7, backgroundColor: colors.gold, alignItems: "center", justifyContent: "center" },
  badgeText: { color: colors.navy, fontWeight: "900", fontSize: 12 },
  flag: { color: colors.muted, fontSize: 11, fontWeight: "700", marginTop: 2 },
  flagLocked: { color: colors.danger, fontSize: 11, fontWeight: "700", marginTop: 2 },
  fab: { position: "absolute", right: 18, bottom: 22, backgroundColor: colors.navy, borderRadius: 99, paddingHorizontal: 20, paddingVertical: 14 },
  fabText: { color: colors.white, fontWeight: "800", fontSize: 14 },
  pressed: { opacity: 0.75 },
});
